import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { cryptoStaticKey, importPrivateKey } from '../src/tunnel/keys.ts';
import { Initiator, PROTOCOL_NAME, keypairFrom, staticKeyFrom, type StaticKey } from '../src/tunnel/noise.ts';

// Written by codeflower-app's Go tests (internal/tunnel/testdata), from flynn/noise.
const vectors = JSON.parse(readFileSync(new URL('./fixtures/noise-vectors.json', import.meta.url), 'utf8'));

async function handshake(local: StaticKey = staticKeyFrom(keypairFrom(hexToBytes(vectors.browserStatic.private)))) {
  const initiator = new Initiator(
    local,
    vectors.connectorId,
    hexToBytes(vectors.connectorStatic.public),
    keypairFrom(hexToBytes(vectors.browserEphemeral.private))
  );
  const first = await initiator.start(utf8ToBytes(vectors.hello));
  return { initiator, first };
}

test('the browser side reproduces the connector\'s Noise IK handshake byte for byte', async () => {
  assert.equal(vectors.protocol, PROTOCOL_NAME);
  const { initiator, first } = await handshake();
  assert.equal(bytesToHex(first), vectors.message1);

  const { payload, channel } = await initiator.finish(hexToBytes(vectors.message2));
  assert.equal(new TextDecoder().decode(payload), vectors.welcome);

  for (const message of vectors.transport) {
    if (message.from === 'browser') {
      assert.equal(bytesToHex(channel.send.encrypt(hexToBytes(message.plaintext))), message.ciphertext);
    } else {
      assert.equal(bytesToHex(channel.receive.decrypt(hexToBytes(message.ciphertext))), message.plaintext);
    }
  }
});

test('a non-extractable WebCrypto key makes the same handshake, and cannot be read out', async () => {
  const keys = keypairFrom(hexToBytes(vectors.browserStatic.private));
  const privateKey = await importPrivateKey(keys.privateKey, keys.publicKey);
  assert.equal(privateKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('jwk', privateKey));
  const { initiator, first } = await handshake(cryptoStaticKey(privateKey, keys.publicKey));
  assert.equal(bytesToHex(first), vectors.message1);
  const { payload } = await initiator.finish(hexToBytes(vectors.message2));
  assert.equal(new TextDecoder().decode(payload), vectors.welcome);
});

test('a tampered answer fails the handshake', async () => {
  const { initiator } = await handshake();
  const tampered = hexToBytes(vectors.message2);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(initiator.finish(tampered));
});

test('a connector message out of order fails to decrypt', async () => {
  const { initiator } = await handshake();
  const { channel } = await initiator.finish(hexToBytes(vectors.message2));
  const fromConnector = vectors.transport.find((message: { from: string }) => message.from === 'connector');
  channel.receive.decrypt(hexToBytes(fromConnector.ciphertext));
  assert.throws(() => channel.receive.decrypt(hexToBytes(fromConnector.ciphertext)));
});
