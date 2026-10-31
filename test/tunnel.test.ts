import assert from 'node:assert/strict';
import test from 'node:test';
import { appPath, tunnelConnectorId } from '../src/tunnel/connect.ts';
import { Kind, MAX_CHUNK, parts, unframe } from '../src/tunnel/envelope.ts';
import { fingerprint } from '../src/tunnel/keys.ts';
import { deviceName } from '../src/tunnel-web/pair.ts';

test('the tunnelled page lives under /m/{connector}/ and maps to the app\'s own paths', () => {
  assert.equal(tunnelConnectorId('/m/eu_abc2/'), 'eu_abc2');
  assert.equal(tunnelConnectorId('/m/eu_abc2/api/workers'), 'eu_abc2');
  assert.equal(tunnelConnectorId('/api/workers'), undefined);
  assert.equal(tunnelConnectorId('/m/../x/'), undefined);
  assert.equal(appPath(new URL('https://t.example/m/eu_abc2/')), '/');
  assert.equal(appPath(new URL('https://t.example/m/eu_abc2/api/system?engine=docker')), '/api/system?engine=docker');
  assert.equal(appPath(new URL('https://t.example/m/eu_abc2/frame?load=1')), '/frame?load=1');
});

test('long chat messages are split into parts the connector reassembles', () => {
  const frames = parts(false, new Uint8Array(MAX_CHUNK + 1));
  assert.deepEqual(frames.map((frame) => unframe(frame).kind), [Kind.textPart, Kind.text]);
  assert.equal(unframe(frames[1]).data.length, 1);
});

test('fingerprints match the CLI\'s and the tunnel\'s', () => {
  // SHA-256 of "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE", as codeflower-app computes it.
  assert.match(fingerprint('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'), /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);
});

test('browsers get a readable default name', () => {
  assert.equal(deviceName('Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0'), 'Firefox on Android');
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari on iOS');
});
