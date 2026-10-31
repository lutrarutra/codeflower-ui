import assert from 'node:assert/strict';
import test from 'node:test';
import type { LayoutNode } from '../src/web/lib/layout.svelte.ts';

Reflect.set(globalThis, '$state', Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T): T => structuredClone(value) }));
const { Layout } = await import('../src/web/lib/layout.svelte.ts');

/** The grid as nested lists of tabs, e.g. `row[col[a, b], c]`. */
function shape(node: LayoutNode): string {
  if (node.kind === 'group') return `${node.tabs.map((tab) => (tab === node.active ? `*${tab}` : tab)).join(' ')}`;
  return `${node.direction}[${node.children.map(shape).join(' | ')}]`;
}

test('opens tabs in a group and moves them along its strip', () => {
  const layout = new Layout();
  const group = layout.groups()[0]!.id;
  layout.place('a', { group });
  layout.place('b', { group });
  layout.place('c', { group, index: 0 });
  assert.equal(shape(layout.root), '*c a b');
  layout.place('c', { group, index: 3 });
  assert.equal(shape(layout.root), 'a b *c');
  layout.activate('a');
  assert.equal(layout.visible('a'), true);
  assert.equal(layout.visible('c'), false);
});

test('a tab dropped on an edge splits the group, and a split of the same direction grows', () => {
  const layout = new Layout();
  const first = layout.groups()[0]!.id;
  for (const tab of ['chat', 'figure', 'table']) layout.place(tab, { group: first });
  layout.place('figure', { group: first, side: 'right' });
  assert.equal(shape(layout.root), 'row[chat *table | *figure]');
  const right = layout.groupOf('figure')!.id;
  assert.equal(layout.focused, right);

  layout.place('table', { group: right, side: 'bottom' });
  assert.equal(shape(layout.root), 'row[*chat | column[*figure | *table]]');
  assert.deepEqual(layout.root.kind === 'split' && layout.root.sizes, [50, 50]);

  // Beside the chat on the left: the row gets a third column, sharing the chat's half.
  layout.place('table', { group: layout.groupOf('chat')!.id, side: 'left' });
  assert.equal(shape(layout.root), 'row[*table | *chat | *figure]');
  assert.deepEqual(layout.root.kind === 'split' && layout.root.sizes, [25, 25, 50]);
});

test('the last tab leaving a group closes it, and the space goes to its neighbour', () => {
  const layout = new Layout();
  const first = layout.groups()[0]!.id;
  layout.place('chat', { group: first });
  layout.place('figure', { group: first, side: 'right' });
  layout.place('report', { group: layout.groupOf('figure')!.id, side: 'bottom' });
  assert.equal(shape(layout.root), 'row[*chat | column[*figure | *report]]');

  layout.place('figure', { group: first });
  assert.equal(shape(layout.root), 'row[chat *figure | *report]');
  layout.close('report');
  assert.equal(shape(layout.root), 'chat *figure');
  assert.equal(layout.focused, first);
  layout.close('figure');
  layout.close('chat');
  assert.equal(shape(layout.root), '');
  assert.equal(layout.groups().length, 1);
});

test('a group cannot split off its only tab', () => {
  const layout = new Layout();
  const first = layout.groups()[0]!.id;
  layout.place('chat', { group: first });
  layout.place('chat', { group: first, side: 'right' });
  assert.equal(shape(layout.root), '*chat');
});

test('sizes change with the divider, and the grid comes back from what was saved', () => {
  const layout = new Layout();
  const first = layout.groups()[0]!.id;
  layout.place('chat:1', { group: first });
  layout.place('#files', { group: first, side: 'right' });
  layout.place('/out/figure.png', { group: layout.groupOf('#files')!.id });
  layout.resize(layout.root.id, [70, 30]);

  const saved = JSON.parse(JSON.stringify(layout.save((tab) => !tab.startsWith('/'))));
  const restored = new Layout(saved);
  assert.equal(shape(restored.root), 'row[*chat:1 | *#files]');
  assert.deepEqual(restored.root.kind === 'split' && restored.root.sizes, [70, 30]);
  // The layout itself keeps the preview.
  assert.equal(shape(layout.root), 'row[*chat:1 | #files */out/figure.png]');

  // Nothing worth keeping, or something that is no grid: an empty one.
  assert.equal(shape(new Layout({ kind: 'split', id: 'x', direction: 'row', children: [] }).root), '');
  assert.equal(shape(new Layout('nonsense').root), '');
});

test('recency picks the group the user worked in last', () => {
  const layout = new Layout();
  const first = layout.groups()[0]!.id;
  layout.place('chat', { group: first });
  layout.place('figure', { group: first, side: 'right' }, false);
  assert.equal(layout.focused, first);
  assert.deepEqual(
    layout.byRecency().map((group) => group.tabs[0]),
    ['chat', 'figure']
  );
  layout.activate('figure');
  assert.deepEqual(
    layout.byRecency().map((group) => group.tabs[0]),
    ['figure', 'chat']
  );
});
