import assert from 'node:assert/strict';
import test from 'node:test';

Reflect.set(globalThis, '$state', Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T): T => structuredClone(value) }));
const { Workbench, chatTab, splitTab, tabOf } = await import('../src/web/lib/workbench.svelte.ts');

test('names a tab by its sandbox, also one whose id has slashes', () => {
  const tab = tabOf('added/host:7710', chatTab('a/b'));
  assert.deepEqual(splitTab(tab), { workerId: 'added/host:7710', local: 'chat:a/b' });
});

test('holds chats from several sandboxes, and closes one sandbox\'s tabs', () => {
  const workbench = new Workbench();
  const focused: unknown[] = [];
  workbench.onChatFocus = (chat) => focused.push(chat);
  workbench.openChat('one', 'x');
  workbench.openChat('two', 'y');
  workbench.openFile('one', '/work/plot.png');
  assert.deepEqual(workbench.focusedChat(), { workerId: 'two', key: 'y' });
  assert.equal(workbench.layout.tabs().length, 3);
  workbench.removeWorker('two');
  assert.deepEqual(workbench.layout.tabs().sort(), [tabOf('one', '/work/plot.png'), tabOf('one', chatTab('x'))].sort());
  assert.deepEqual(workbench.focusedChat(), { workerId: 'one', key: 'x' });
  assert.deepEqual(focused.at(-1), { workerId: 'one', key: 'x' });
});
