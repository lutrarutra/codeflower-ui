import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatActivity, Worker } from '../src/web/lib/api.ts';

Reflect.set(globalThis, '$state', Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T): T => structuredClone(value) }));
Reflect.set(globalThis, '$derived', <T>(value: T) => value);
Reflect.set(globalThis, '$effect', Object.assign(() => {}, { root: () => () => {} }));
const { Attention } = await import('../src/web/lib/attention.svelte.ts');

// A chat the page has not open, as the app polls it, while the user looks elsewhere.
function tracker(shown = () => false) {
  const worker = { id: 'w', name: 'box', activity: { chats: [] as ChatActivity[], working: 0, waiting: 0 } } as unknown as Worker;
  const attention = new Attention({ workers: () => [worker], agent: () => undefined, shows: () => shown(), open: () => {} });
  const poll = (...chats: Partial<ChatActivity>[]) => {
    worker.activity!.chats = chats.map((chat) => ({ key: 'a', title: 'A', state: 'working', ...chat }) as ChatActivity);
    (attention as unknown as { track(): void }).track();
    return attention.need('w', 'a');
  };
  return poll;
}

test('a chat finishes when its turn ends, not when background work does', () => {
  const poll = tracker();
  assert.equal(poll({ turn: true }), undefined);
  // A background command ends while the turn still runs.
  assert.equal(poll({ turn: true }), undefined);
  // The turn ends; a background command still runs: not finished yet.
  assert.equal(poll({ turn: false }), undefined);
  assert.equal(poll(), 'done');
});

test('background work alone does not finish a chat', () => {
  const poll = tracker();
  poll();
  assert.equal(poll({ turn: false }), undefined);
  assert.equal(poll(), undefined);
});

test('a chat seen after its turn does not finish again when its background work ends', () => {
  let looking = true;
  const poll = tracker(() => looking);
  poll({ turn: true });
  // The turn ends while the user looks; a background subagent goes on.
  poll({ turn: false });
  looking = false;
  assert.equal(poll({ turn: false }), undefined);
  assert.equal(poll(), undefined);
});
