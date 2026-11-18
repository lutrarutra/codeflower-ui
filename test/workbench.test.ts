import assert from 'node:assert/strict';
import test from 'node:test';

Reflect.set(globalThis, '$state', Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T): T => structuredClone(value) }));
const { Workbench, chatTab, commandTab, splitTab, tabOf, terminalIdOf, terminalTab } = await import('../src/web/lib/workbench.svelte.ts');

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

test('opens a clicked file beside the chat, and in a narrow grid, which shows only the focused group, in front', () => {
  const workbench = new Workbench();
  workbench.openChat('one', 'x');
  const chat = tabOf('one', chatTab('x'));
  const plot = tabOf('one', '/work/plot.png');
  const shown = () => workbench.layout.group(workbench.layout.focused)!.active;

  // Wide: the file opens beside the chat, which keeps the focus, clicked or not.
  workbench.openFile('one', '/work/plot.png', true);
  assert.equal(shown(), chat);
  assert.ok(workbench.layout.visible(plot));

  // Narrow: shown by the agent, it waits behind the chat; clicked, it comes in front, also once open.
  workbench.narrow = true;
  workbench.openFile('one', '/work/table.csv');
  assert.equal(shown(), chat);
  workbench.openFile('one', '/work/table.csv', true);
  assert.equal(shown(), tabOf('one', '/work/table.csv'));
  workbench.activate(chat);
  workbench.openFile('one', '/work/plot.png', true);
  assert.equal(shown(), plot);
});

test('opens a shell in a panel across the foot of the grid, and remembers it with the chats but not the files', () => {
  const stored = new Map<string, string>();
  Reflect.set(globalThis, 'localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  try {
    const workbench = new Workbench();
    workbench.openChat('one', 'x');
    workbench.openTerminal('one', 't1');
    const shell = tabOf('one', terminalTab('t1'));
    const chatGroup = workbench.layout.groupOf(tabOf('one', chatTab('x')))!;
    const shellGroup = workbench.layout.groupOf(shell)!;
    assert.notEqual(shellGroup.id, chatGroup.id);
    assert.equal(shellGroup.active, shell);
    // Below everything, as VS Code's panel: the grid splits in a column, the panel last.
    const root = workbench.layout.root;
    assert.equal(root.kind === 'split' && root.direction, 'column');
    assert.equal(root.kind === 'split' && root.children.at(-1)!.id, shellGroup.id);
    assert.equal(terminalIdOf(splitTab(shell).local), 't1');
    // Again: the same tab comes to the front.
    workbench.openTerminal('one', 't1');
    assert.equal(workbench.layout.tabs().filter((tab) => tab === shell).length, 1);

    workbench.openFile('one', '/work/plot.png');
    workbench.save();
    const reloaded = new Workbench();
    assert.deepEqual(reloaded.layout.tabs().sort(), [shell, tabOf('one', chatTab('x'))].sort());
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('keeps terminals and watched commands together in the panel, and files out of it', () => {
  const workbench = new Workbench();
  workbench.openChat('one', 'x');
  workbench.openFile('one', '/work/plot.png');
  // The chat and the file side by side; the panel goes below both.
  workbench.openTerminal('one', 't1');
  const panel = workbench.layout.groupOf(tabOf('one', terminalTab('t1')))!;
  const root = workbench.layout.root;
  assert.ok(root.kind === 'split' && root.direction === 'column' && root.children.length === 2);
  assert.equal(root.kind === 'split' && root.children[1]!.id, panel.id);

  workbench.openTerminal('one', 't2');
  workbench.openCommand('one', 'c1');
  assert.deepEqual(workbench.layout.groupOf(tabOf('one', commandTab('c1')))!.tabs, [
    tabOf('one', terminalTab('t1')),
    tabOf('one', terminalTab('t2')),
    tabOf('one', commandTab('c1'))
  ]);
  assert.equal(workbench.latestTerminal(), tabOf('one', commandTab('c1')));

  // The panel has the focus now; a file still goes with the files.
  workbench.openFile('one', '/work/table.csv');
  assert.equal(workbench.layout.groupOf(tabOf('one', '/work/table.csv'))!.id, workbench.layout.groupOf(tabOf('one', '/work/plot.png'))!.id);

  // Dragged out of the panel into the chat's group, a terminal stays there; the next opens with the others.
  const chatGroup = workbench.layout.groupOf(tabOf('one', chatTab('x')))!;
  workbench.drop(tabOf('one', terminalTab('t1')), { group: chatGroup.id });
  assert.equal(workbench.layout.groupOf(tabOf('one', terminalTab('t1')))!.id, chatGroup.id);
  workbench.openTerminal('one', 't3');
  assert.equal(workbench.layout.groupOf(tabOf('one', terminalTab('t3')))!.id, panel.id);
});

test('makes the panel the only group of an empty grid, and adds it below a grid split in rows', () => {
  const empty = new Workbench();
  empty.openTerminal('one', 't1');
  assert.equal(empty.layout.root.kind, 'group');

  const rows = new Workbench();
  rows.openChat('one', 'x');
  rows.openChat('one', 'y');
  const chatGroup = rows.layout.groupOf(tabOf('one', chatTab('x')))!;
  rows.drop(tabOf('one', chatTab('y')), { group: chatGroup.id, side: 'bottom' });
  rows.openTerminal('one', 't1');
  const root = rows.layout.root;
  assert.ok(root.kind === 'split' && root.direction === 'column');
  assert.equal(root.kind === 'split' && root.children.length, 3);
  assert.equal(root.kind === 'split' && Math.round(root.sizes.reduce((sum, size) => sum + size, 0)), 100);
  assert.equal(root.kind === 'split' && root.sizes.at(-1), 30);
});
