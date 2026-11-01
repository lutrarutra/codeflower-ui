import assert from 'node:assert/strict';
import test from 'node:test';
import { arrange, chatPhase, listed, nextUp, RECENT_MS, step, type FocusChat } from '../src/web/lib/focusList.ts';

Reflect.set(globalThis, '$state', Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T): T => structuredClone(value) }));
const { shownFiles } = await import('../src/web/lib/chatSession.svelte.ts');

const NOW = 10 * RECENT_MS;

function chat(key: string, fields: Partial<FocusChat> = {}): FocusChat {
  return { workerId: 'w', key, title: key, sandbox: 'box', phase: 'idle', since: NOW, pinned: false, unseen: false, ...fields };
}

const keys = (chats: FocusChat[] | undefined) => (chats ?? []).map((one) => one.key);

test('an open chat says its phase; the others go by the poll', () => {
  assert.equal(chatPhase('ready', { key: 'a', title: '', state: 'working' }), 'idle');
  assert.equal(chatPhase('waiting', undefined), 'waiting');
  assert.equal(chatPhase(undefined, { key: 'a', title: '', state: 'working' }), 'working');
  assert.equal(chatPhase('offline', { key: 'a', title: '', state: 'waiting' }), 'waiting');
  assert.equal(chatPhase(undefined, undefined), 'idle');
});

test('waiting chats come first, longest waiting first, then working, done and idle ones', () => {
  const groups = arrange(
    [
      chat('idle', { updatedAt: NOW - 1000 }),
      chat('working', { phase: 'working', since: NOW - 5000 }),
      chat('late', { phase: 'waiting', since: NOW - 1000 }),
      chat('done', { unseen: true }),
      chat('early', { phase: 'waiting', since: NOW - 9000 })
    ],
    NOW
  );
  assert.deepEqual(
    groups.map((group) => group.id),
    ['waiting', 'working', 'done', 'idle']
  );
  assert.deepEqual(keys(groups[0]?.chats), ['early', 'late']);
});

test('idle chats stay listed while recent, pinned or unseen', () => {
  const old = NOW - RECENT_MS - 1;
  assert.equal(listed(chat('a', { since: old, updatedAt: old }), NOW), false);
  assert.equal(listed(chat('a', { since: old, updatedAt: NOW - 1000 }), NOW), true);
  assert.equal(listed(chat('a', { since: old, pinned: true }), NOW), true);
  assert.equal(listed(chat('a', { since: old, unseen: true }), NOW), true);
  assert.equal(listed(chat('a', { since: old, phase: 'working' }), NOW), true);
});

test('pinned idle chats come before the other idle ones', () => {
  const groups = arrange([chat('recent', { updatedAt: NOW }), chat('pinned', { since: 0, pinned: true })], NOW);
  assert.deepEqual(keys(groups[0]?.chats), ['pinned', 'recent']);
});

test('next is the chat waiting longest, else the first done one, never the current one', () => {
  const groups = arrange(
    [chat('a', { phase: 'waiting', since: 1 }), chat('b', { phase: 'waiting', since: 2 }), chat('d', { unseen: true }), chat('w', { phase: 'working' })],
    NOW
  );
  assert.equal(nextUp(groups, null)?.key, 'a');
  assert.equal(nextUp(groups, { workerId: 'w', key: 'a' })?.key, 'b');
  const doneOnly = arrange([chat('d', { unseen: true }), chat('w', { phase: 'working' })], NOW);
  assert.equal(nextUp(doneOnly, null)?.key, 'd');
  assert.equal(nextUp(doneOnly, { workerId: 'w', key: 'd' }), undefined);
});

test("next skips chats whose computer does not answer; they stay listed", () => {
  const groups = arrange(
    [chat('far', { phase: 'waiting', since: NOW - 5000, unreachable: true }), chat('near', { phase: 'waiting', since: NOW - 1000 })],
    NOW
  );
  assert.deepEqual(keys(groups[0]?.chats), ['far', 'near']);
  assert.equal(nextUp(groups, null)?.key, 'near');
  assert.equal(nextUp(groups, { workerId: 'w', key: 'near' }), undefined);
});

test('stepping follows the list and stops at its ends', () => {
  const groups = arrange([chat('a', { phase: 'waiting' }), chat('b', { phase: 'working' })], NOW);
  assert.equal(step(groups, null, 1)?.key, 'a');
  assert.equal(step(groups, { workerId: 'w', key: 'a' }, 1)?.key, 'b');
  assert.equal(step(groups, { workerId: 'w', key: 'b' }, 1)?.key, 'b');
  assert.equal(step(groups, { workerId: 'w', key: 'a' }, -1)?.key, 'a');
});

test('shown files keep the latest last, each once', () => {
  const entries = [
    { t: '1', kind: 'show' as const, files: ['/a.png', '/b.html'] },
    { t: '2', kind: 'user' as const, text: 'x' },
    { t: '3', kind: 'show' as const, files: ['/a.png'] }
  ];
  assert.deepEqual(shownFiles(entries as never, []), ['/b.html', '/a.png']);
  assert.deepEqual(shownFiles([{ t: '4', kind: 'show', files: ['/b.html'] }], ['/b.html', '/a.png']), ['/a.png', '/b.html']);
});
