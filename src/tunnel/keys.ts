// The browser's tunnel keys, in IndexedDB on the tunnel's origin, shared by
// its pages and its service worker. The private key is a WebCrypto X25519 key
// that cannot be exported: code on the tunnel's origin (which includes the
// pages paired computers serve) can use it while it runs, but never read it,
// so it cannot be taken elsewhere. Browsers without X25519 in WebCrypto keep
// it wrapped with a non-extractable AES key instead, which protects it only
// at rest.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { generateKeypair, keypairFrom, staticKeyFrom, type StaticKey } from './noise.ts';

const DATABASE = 'codeflower-tunnel';
const STORE = 'keys';

/** A computer (connector) this browser is paired with. */
export interface PairedConnector {
  id: string;
  /** Its static public key, base64url. */
  key: string;
  pairedAt: number;
}

/** The private key as a non-extractable WebCrypto key. */
interface StoredCryptoKey {
  privateKey: CryptoKey;
  publicKey: Uint8Array<ArrayBuffer>;
}

/** The private key's bytes, wrapped: browsers without X25519 in WebCrypto, and records from before. */
interface StoredWrappedKey {
  wrapping: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  wrapped: ArrayBuffer;
  publicKey: Uint8Array<ArrayBuffer>;
}

type StoredKey = StoredCryptoKey | StoredWrappedKey;

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** What the CLI and the tunnel's pages show for a key: SHA-256 of its base64url text, 16 hex digits. */
export function fingerprint(key: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(key))).slice(0, 16).match(/.{4}/g)!.join(' ');
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

/** Diffie-Hellman with a WebCrypto X25519 private key. */
export function cryptoStaticKey(privateKey: CryptoKey, publicKey: Uint8Array): StaticKey {
  return {
    publicKey,
    dh: async (peer) => {
      const key = await crypto.subtle.importKey('raw', peer as Uint8Array<ArrayBuffer>, { name: 'X25519' }, true, []);
      // Throws for a low-order point (an all-zero secret), as Noise requires.
      return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: key }, privateKey, 256));
    }
  };
}

/** Imports a private key's bytes as a non-extractable WebCrypto key (moving a wrapped key over). */
export async function importPrivateKey(privateKey: Uint8Array, publicKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'X25519', d: base64url(privateKey), x: base64url(publicKey) },
    { name: 'X25519' },
    false,
    ['deriveBits']
  );
}

async function unwrap(stored: StoredWrappedKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv }, stored.wrapping, stored.wrapped));
}

/** A new private key, non-extractable; undefined where WebCrypto has no X25519. */
async function generateCryptoKey(): Promise<StoredCryptoKey | undefined> {
  try {
    const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    return { privateKey: pair.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
  } catch {
    return undefined;
  }
}

/** This browser's static key, made on first use. */
export async function browserKey(): Promise<StaticKey> {
  const stored = await run<StoredKey | undefined>('readonly', (store) => store.get('browser'));
  if (stored && 'privateKey' in stored) return cryptoStaticKey(stored.privateKey, stored.publicKey);
  if (stored) {
    // A wrapped key: moved into a non-extractable key once, where the browser can.
    const privateKey = await unwrap(stored);
    try {
      const imported = await importPrivateKey(privateKey, stored.publicKey);
      await run('readwrite', (store) => store.put({ privateKey: imported, publicKey: stored.publicKey } satisfies StoredCryptoKey, 'browser'));
      return cryptoStaticKey(imported, stored.publicKey);
    } catch {
      return staticKeyFrom(keypairFrom(privateKey));
    }
  }
  const created = await generateCryptoKey();
  if (created) {
    await run('readwrite', (store) => store.put(created, 'browser'));
    return cryptoStaticKey(created.privateKey, created.publicKey);
  }
  const keys = generateKeypair();
  const wrapping = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapping, keys.privateKey as Uint8Array<ArrayBuffer>);
  const record: StoredWrappedKey = { wrapping, iv, wrapped, publicKey: keys.publicKey as Uint8Array<ArrayBuffer> };
  await run('readwrite', (store) => store.put(record, 'browser'));
  return staticKeyFrom(keypairFrom(keys.privateKey));
}

export async function pairedConnector(id: string): Promise<PairedConnector | undefined> {
  return run<PairedConnector | undefined>('readonly', (store) => store.get(`connector:${id}`));
}

/** Every computer this browser is paired with. */
export async function pairedConnectors(): Promise<PairedConnector[]> {
  const range = IDBKeyRange.bound('connector:', 'connector;', false, true);
  return run<PairedConnector[]>('readonly', (store) => store.getAll(range));
}

export async function rememberConnector(connector: PairedConnector): Promise<void> {
  await run('readwrite', (store) => store.put(connector, `connector:${connector.id}`));
}

export async function forgetConnector(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(`connector:${id}`));
  await clearPageCode();
}

/**
 * Removes every computer's kept page code (the service worker's caches). The
 * caches are the tunnel origin's, so a paired computer's page could have put
 * code in another's: once a computer is forgotten, or answers with another
 * key or not at all as paired, none of the kept code is trusted.
 */
export async function clearPageCode(): Promise<void> {
  if (typeof caches === 'undefined') return;
  for (const name of await caches.keys()) if (name.startsWith(PAGE_CACHE)) await caches.delete(name);
}

/** The service worker's caches of the computers' page code: `cf-page:{connector}:{build}`. */
export const PAGE_CACHE = 'cf-page:';
