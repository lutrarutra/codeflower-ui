import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { Initiator, PROTOCOL_NAME, keypairFrom } from '../src/tunnel/noise.ts';

// Written by codeflower-app's Go tests (internal/tunnel/testdata), from flynn/noise.
const vectors = JSON.parse(readFileSync(new URL('./fixtures/noise-vectors.json', import.meta.url), 'utf8'));

function handshake() {
  const initiator = new Initiator(
    keypairFrom(hexToBytes(vectors.browserStatic.private)),
    vectors.connectorId,
    hexToBytes(vectors.connectorStatic.public),
    keypairFrom(hexToBytes(vectors.browserEphemeral.private))
  );
  const first = initiator.start(utf8ToBytes(vectors.hello));
  return { initiator, first };
}

test('the browser side reproduces the connector\'s Noise IK handshake byte for byte', () => {
  assert.equal(vectors.protocol, PROTOCOL_NAME);
  const { initiator, first } = handshake();
  assert.equal(bytesToHex(first), vectors.message1);

  const { payload, channel } = initiator.finish(hexToBytes(vectors.message2));
  assert.equal(new TextDecoder().decode(payload), vectors.welcome);

  for (const message of vectors.transport) {
    if (message.from === 'browser') {
      assert.equal(bytesToHex(channel.send.encrypt(hexToBytes(message.plaintext))), message.ciphertext);
    } else {
      assert.equal(bytesToHex(channel.receive.decrypt(hexToBytes(message.ciphertext))), message.plaintext);
    }
  }
});

test('a tampered answer fails the handshake', () => {
  const { initiator } = handshake();
  const tampered = hexToBytes(vectors.message2);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => initiator.finish(tampered));
});

test('a connector message out of order fails to decrypt', () => {
  const { initiator } = handshake();
  const { channel } = initiator.finish(hexToBytes(vectors.message2));
  const fromConnector = vectors.transport.find((message: { from: string }) => message.from === 'connector');
  channel.receive.decrypt(hexToBytes(fromConnector.ciphertext));
  assert.throws(() => channel.receive.decrypt(hexToBytes(fromConnector.ciphertext)));
});
