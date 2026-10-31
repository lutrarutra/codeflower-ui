// The browser's tunnel keys, in IndexedDB on the tunnel's origin, shared by
// its pages and its service worker. The private key is stored wrapped with a
// non-extractable AES key: page code can still use it, but it cannot be read
// out of the database or the browser profile as plain bytes.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { generateKeypair, keypairFrom, type Keypair } from './noise.ts';

const DATABASE = 'codeflower-tunnel';
const STORE = 'keys';

/** A computer (connector) this browser is paired with. */
export interface PairedConnector {
  id: string;
  /** Its static public key, base64url. */
  key: string;
  pairedAt: number;
}

interface StoredKey {
  wrapping: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  wrapped: ArrayBuffer;
  publicKey: Uint8Array<ArrayBuffer>;
}

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

/** This browser's static key pair, made on first use. */
export async function browserKeypair(): Promise<Keypair> {
  const stored = await run<StoredKey | undefined>('readonly', (store) => store.get('browser'));
  if (stored) {
    const privateKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv }, stored.wrapping, stored.wrapped);
    return { privateKey: new Uint8Array(privateKey), publicKey: stored.publicKey };
  }
  const keys = generateKeypair();
  const wrapping = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapping, keys.privateKey as Uint8Array<ArrayBuffer>);
  const record: StoredKey = { wrapping, iv, wrapped, publicKey: keys.publicKey as Uint8Array<ArrayBuffer> };
  await run('readwrite', (store) => store.put(record, 'browser'));
  return keypairFrom(keys.privateKey);
}

export async function pairedConnector(id: string): Promise<PairedConnector | undefined> {
  return run<PairedConnector | undefined>('readonly', (store) => store.get(`connector:${id}`));
}

export async function rememberConnector(connector: PairedConnector): Promise<void> {
  await run('readwrite', (store) => store.put(connector, `connector:${connector.id}`));
}

export async function forgetConnector(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(`connector:${id}`));
}
