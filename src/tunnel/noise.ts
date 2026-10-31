// Noise_IK_25519_ChaChaPoly_SHA256, the browser's (initiator's) side, as
// specified in noiseprotocol.org/noise.html revision 34. The connector runs
// flynn/noise; test/fixtures/noise-vectors.json, written by codeflower-app's
// tests, pins both to the same bytes.

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const PROTOCOL = 1;
export const PROTOCOL_NAME = 'Noise_IK_25519_ChaChaPoly_SHA256';
/** Noise's limit on one message, less the tag. */
export const MAX_PLAINTEXT = 65535 - 16;

export interface Keypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export function keypairFrom(privateKey: Uint8Array): Keypair {
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export function generateKeypair(): Keypair {
  return keypairFrom(x25519.utils.randomSecretKey());
}

export function prologue(connectorId: string): Uint8Array {
  return utf8ToBytes(`codeflower-tunnel/1 ${connectorId}`);
}

function hkdf(chainingKey: Uint8Array, input: Uint8Array): [Uint8Array, Uint8Array] {
  const temp = hmac(sha256, chainingKey, input);
  const first = hmac(sha256, temp, Uint8Array.of(1));
  const second = hmac(sha256, temp, concatBytes(first, Uint8Array.of(2)));
  return [first, second];
}

function nonceBytes(counter: number): Uint8Array {
  // 32 zero bits, then the counter as 64-bit little endian.
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(counter), true);
  return nonce;
}

/** One direction of a channel: a key and a message counter. */
export class CipherState {
  private counter = 0;
  private readonly key: Uint8Array;

  constructor(key: Uint8Array) {
    this.key = key;
  }

  encrypt(plaintext: Uint8Array, associated: Uint8Array = new Uint8Array(0)): Uint8Array {
    return chacha20poly1305(this.key, nonceBytes(this.counter++), associated).encrypt(plaintext);
  }

  /** Throws on a tampered, repeated or reordered message. */
  decrypt(ciphertext: Uint8Array, associated: Uint8Array = new Uint8Array(0)): Uint8Array {
    const plaintext = chacha20poly1305(this.key, nonceBytes(this.counter), associated).decrypt(ciphertext);
    this.counter++;
    return plaintext;
  }
}

class SymmetricState {
  private chainingKey: Uint8Array;
  private hash: Uint8Array;
  private cipher: CipherState | undefined;

  constructor() {
    const name = utf8ToBytes(PROTOCOL_NAME);
    // A name of at most 32 bytes is padded, not hashed; this one is exactly 32.
    this.hash = name.length <= 32 ? concatBytes(name, new Uint8Array(32 - name.length)) : sha256(name);
    this.chainingKey = this.hash;
  }

  mixHash(data: Uint8Array): void {
    this.hash = sha256(concatBytes(this.hash, data));
  }

  mixKey(input: Uint8Array): void {
    const [chainingKey, key] = hkdf(this.chainingKey, input);
    this.chainingKey = chainingKey;
    this.cipher = new CipherState(key);
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.cipher ? this.cipher.encrypt(plaintext, this.hash) : plaintext;
    this.mixHash(ciphertext);
    return ciphertext;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.cipher ? this.cipher.decrypt(ciphertext, this.hash) : ciphertext;
    this.mixHash(ciphertext);
    return plaintext;
  }

  split(): [CipherState, CipherState] {
    const [first, second] = hkdf(this.chainingKey, new Uint8Array(0));
    return [new CipherState(first), new CipherState(second)];
  }
}

/** An open channel: `send` encrypts to the connector, `receive` decrypts from it. */
export interface Channel {
  send: CipherState;
  receive: CipherState;
}

/**
 * The browser's handshake with a connector whose static key it knows (from
 * pairing). `start` writes the first message; `finish` reads the answer.
 */
export class Initiator {
  private readonly state = new SymmetricState();
  private readonly ephemeral: Keypair;
  private readonly local: Keypair;
  private readonly remote: Uint8Array;

  constructor(local: Keypair, connectorId: string, connectorKey: Uint8Array, ephemeral: Keypair = generateKeypair()) {
    this.local = local;
    this.remote = connectorKey;
    this.ephemeral = ephemeral;
    this.state.mixHash(prologue(connectorId));
    // Pre-message: <- s
    this.state.mixHash(connectorKey);
  }

  /** -> e, es, s, ss, with `payload`. */
  start(payload: Uint8Array): Uint8Array {
    const e = this.ephemeral.publicKey;
    this.state.mixHash(e);
    this.state.mixKey(x25519.getSharedSecret(this.ephemeral.privateKey, this.remote));
    const s = this.state.encryptAndHash(this.local.publicKey);
    this.state.mixKey(x25519.getSharedSecret(this.local.privateKey, this.remote));
    return concatBytes(e, s, this.state.encryptAndHash(payload));
  }

  /** <- e, ee, se: returns the connector's payload and the channel. */
  finish(message: Uint8Array): { payload: Uint8Array; channel: Channel } {
    if (message.length < 32 + 16) throw new Error('The connector\'s handshake message is too short');
    const e = message.subarray(0, 32);
    this.state.mixHash(e);
    this.state.mixKey(x25519.getSharedSecret(this.ephemeral.privateKey, e));
    this.state.mixKey(x25519.getSharedSecret(this.local.privateKey, e));
    const payload = this.state.decryptAndHash(message.subarray(32));
    const [toConnector, toBrowser] = this.state.split();
    return { payload, channel: { send: toConnector, receive: toBrowser } };
  }
}
