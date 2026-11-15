import assert from 'node:assert/strict';
import test from 'node:test';
import { appPath, tunnelConnectorId } from '../src/tunnel/connect.ts';
import { Kind, MAX_CHUNK, muxFrame, muxJsonFrame, parts, unframe, unmux } from '../src/tunnel/envelope.ts';
import type { Outgoing } from '../src/tunnel/http.ts';
import { MAX_IN_FLIGHT, MuxSession, StreamClosedError, type MuxStream } from '../src/tunnel/mux.ts';
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

/** A stream the test plays the connector on: it reads what was sent and answers. */
class FakeStream implements MuxStream {
  closed = false;
  sent: Array<{ kind: number; id: number; data: Uint8Array }> = [];
  closedWith: number | undefined;
  private frameListeners: Array<(kind: number, data: Uint8Array) => void> = [];
  private closeListeners: Array<(code: number, reason: string) => void> = [];
  send(frame: Uint8Array): void {
    if (this.closed) throw new Error('closed');
    const { kind, data } = unframe(frame);
    this.sent.push({ kind, ...unmux(data) });
  }
  onFrame(listener: (kind: number, data: Uint8Array) => void): void {
    this.frameListeners.push(listener);
  }
  onClose(listener: (code: number, reason: string) => void): void {
    this.closeListeners.push(listener);
  }
  close(code = 1000): void {
    if (this.closed) return;
    this.closed = true;
    this.closedWith = code;
    for (const listener of this.closeListeners) listener(code, '');
  }
  answer(frame: Uint8Array): void {
    const { kind, data } = unframe(frame);
    for (const listener of this.frameListeners) listener(kind, data);
  }
  opened(): number[] {
    return this.sent.filter((message) => message.kind === Kind.open).map((message) => message.id);
  }
}

const get = (path: string): Outgoing => ({ method: 'GET', path, headers: {}, body: new Uint8Array(0) });
const text = (value: string) => new TextEncoder().encode(value);
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('multiplexed messages carry the request ID after the kind', () => {
  const { kind, data } = unframe(muxFrame(Kind.data, 0x01020304, text('hi')));
  assert.equal(kind, Kind.data);
  assert.deepEqual(unmux(data), { id: 0x01020304, data: text('hi') });
});

test('one stream answers many requests, each as its response ends', async () => {
  const stream = new FakeStream();
  const session = new MuxSession(stream);
  const first = session.fetch(get('/api/workers'));
  const second = session.fetch({ method: 'POST', path: '/api/x', headers: { 'content-type': 'text/plain' }, body: text('body') });
  await tick();
  const [a, b] = stream.opened();
  assert.deepEqual([a, b], [1, 2]);
  assert.deepEqual(stream.sent.filter((message) => message.id === b).map((message) => message.kind), [Kind.open, Kind.data, Kind.end]);
  // Interleaved: the second ends first.
  stream.answer(muxJsonFrame(Kind.head, a, { status: 200 }));
  stream.answer(muxJsonFrame(Kind.head, b, { status: 201 }));
  stream.answer(muxFrame(Kind.data, a, text('[1,')));
  stream.answer(muxFrame(Kind.data, b, text('ok')));
  stream.answer(muxFrame(Kind.end, b));
  assert.equal(await (await second).text(), 'ok');
  stream.answer(muxFrame(Kind.data, a, text('2]')));
  stream.answer(muxFrame(Kind.end, a));
  assert.equal(await (await first).text(), '[1,2]');
  session.close();
});

test('an aborted request tells the computer and drops what still comes for it', async () => {
  const stream = new FakeStream();
  const session = new MuxSession(stream);
  const controller = new AbortController();
  const request = session.fetch(get('/slow'), controller.signal);
  await tick();
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.deepEqual(stream.sent.at(-1)?.kind, Kind.close);
  stream.answer(muxJsonFrame(Kind.head, 1, { status: 200 }));
  assert.equal(stream.closed, false);
  session.close();
});

test('requests beyond what the computer takes at once wait their turn', async () => {
  const stream = new FakeStream();
  const session = new MuxSession(stream);
  const requests = Array.from({ length: MAX_IN_FLIGHT + 1 }, (_, i) => session.fetch(get(`/${i}`)));
  await tick();
  assert.equal(stream.opened().length, MAX_IN_FLIGHT);
  stream.answer(muxJsonFrame(Kind.close, 1, { code: 1011, reason: 'code flower did not answer' }));
  await assert.rejects(requests[0], /did not answer/);
  await tick();
  assert.equal(stream.opened().length, MAX_IN_FLIGHT + 1);
  session.close();
  await Promise.allSettled(requests);
});

test('a closed stream fails what is in flight, saying whether the computer had answered', async () => {
  const stream = new FakeStream();
  const session = new MuxSession(stream);
  const unanswered = session.fetch(get('/a'));
  const answered = session.fetch(get('/b'));
  await tick();
  stream.answer(muxJsonFrame(Kind.head, 2, { status: 200 }));
  stream.close(1006);
  await assert.rejects(unanswered, (error) => error instanceof StreamClosedError && !error.answered);
  await assert.rejects(answered, (error) => error instanceof StreamClosedError && error.answered);
  assert.equal(session.closed, true);
  await assert.rejects(session.fetch(get('/c')), StreamClosedError);
});

test('an idle session closes its stream', async () => {
  const stream = new FakeStream();
  const session = new MuxSession(stream, 10);
  const request = session.fetch(get('/a'));
  await tick();
  stream.answer(muxJsonFrame(Kind.head, 1, { status: 204 }));
  stream.answer(muxFrame(Kind.end, 1));
  assert.equal((await request).status, 204);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(stream.closedWith, 1000);
  assert.equal(session.closed, true);
});
