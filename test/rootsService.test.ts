import assert from 'node:assert/strict';
import test from 'node:test';
import { serveRoots } from '../src/client/rootsService.ts';
import type { WorkerConnection } from '../src/client/workerConnection.ts';
import { continuePrompt, ideaFilePath, needMet, unansweredComments, type Idea, type RootsHostMessage, type RootsMap } from '../src/protocol/roots.ts';

const idea = (fields: Partial<Idea>): Idea => ({
  id: 1, title: 'QC', status: 'active', from: [], needs: [], todos: [], files: [], chats: [], comments: [],
  created: '', updated: '', conclusion: '', file: '001-qc.md', ...fields
});

// A connection that answers the roots methods and lets the test say the map changed.
function fakeConnection(calls: string[], options: { roots?: boolean } = {}) {
  const listeners = new Set<(map: RootsMap) => void>();
  const connection = {
    connected: true,
    hasRoots: options.roots ?? true,
    onRootsChanged(listener: (map: RootsMap) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async roots() {
      calls.push('roots');
      return { ideas: [idea({})], errors: [], workspace: '/codeflower-state/workspace' };
    },
    async updateIdea(id: number, patch: object) {
      calls.push(`update ${id} ${JSON.stringify(patch)}`);
      if (id === 9) throw new Error('there is no idea 9');
      return idea({ id });
    },
    async commentIdea(id: number, text: string) {
      calls.push(`comment ${id} ${text}`);
      return { idea: idea({ id }), told: 'claude:s1' };
    }
  };
  return {
    connection: connection as unknown as WorkerConnection,
    changed: (map: RootsMap) => listeners.forEach((listener) => listener(map)),
    listeners
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('answers the view from the connection, and sends the map when it changes', async () => {
  const calls: string[] = [];
  const sent: RootsHostMessage[] = [];
  const opened: string[] = [];
  const fake = fakeConnection(calls);
  const service = serveRoots({
    connection: () => fake.connection,
    send: (message) => sent.push(message),
    label: () => 'pbmc-study',
    chats: () => [{ key: 'claude:s1', title: 'QC', state: 'working' }],
    openChat: (key) => opened.push(`chat ${key}`),
    newChat: (prompt) => opened.push(`new ${prompt}`),
    openFile: (path) => opened.push(`file ${path}`)
  });

  service.focus(3);
  service.receive({ type: 'ready' });
  assert.deepEqual(sent.splice(0), [
    { type: 'context', label: 'pbmc-study' },
    { type: 'chats', chats: [{ key: 'claude:s1', title: 'QC', state: 'working' }] },
    { type: 'focus', idea: 3 }
  ]);

  service.receive({ type: 'call', id: 1, method: 'list' });
  service.receive({ type: 'call', id: 2, method: 'update', params: { id: 1, patch: { status: 'done' } } });
  service.receive({ type: 'call', id: 3, method: 'update', params: { id: 9, patch: {} } });
  service.receive({ type: 'call', id: 4, method: 'comment', params: { id: 1, text: 'Try scVI' } });
  await settle();
  assert.deepEqual(calls, ['roots', 'update 1 {"status":"done"}', 'update 9 {}', 'comment 1 Try scVI']);
  const results = sent.splice(0);
  assert.equal(results.filter((message) => message.type === 'map').length, 1);
  assert.deepEqual(results.find((message) => message.type === 'result' && message.id === 3), { type: 'result', id: 3, error: 'there is no idea 9' });
  assert.deepEqual((results.find((message) => message.type === 'result' && message.id === 4) as { result: { told: string } }).result.told, 'claude:s1');

  // A change from the worker keeps the workspace the list said.
  fake.changed({ ideas: [idea({ title: 'QC v2' })], errors: [] });
  const map = sent.pop();
  assert.equal(map?.type === 'map' && map.map.workspace, '/codeflower-state/workspace');

  // Files resolve against the workspace; a new chat gets the prompt that continues the idea.
  service.receive({ type: 'openFile', path: 'figures/umap.png' });
  service.receive({ type: 'openFile', path: '/data/output/x/report.html' });
  service.receive({ type: 'openChat', key: 'claude:s1' });
  service.receive({ type: 'newChat', idea: 6, title: 'scVI' });
  assert.deepEqual(opened, [
    'file /codeflower-state/workspace/figures/umap.png',
    'file /data/output/x/report.html',
    'chat claude:s1',
    `new ${continuePrompt(6, 'scVI')}`
  ]);

  service.chatsChanged();
  assert.deepEqual(sent.splice(-2).map((message) => message.type), ['context', 'chats']);
  service.dispose();
  assert.equal(fake.listeners.size, 0);
});

test('says when the sandbox is older than Roots', async () => {
  const sent: RootsHostMessage[] = [];
  const fake = fakeConnection([], { roots: false });
  const service = serveRoots({
    connection: () => fake.connection,
    send: (message) => sent.push(message),
    label: () => 'x',
    chats: () => [],
    openChat: () => {},
    newChat: () => {},
    openFile: () => {}
  });
  service.receive({ type: 'call', id: 1, method: 'list' });
  await settle();
  assert.match((sent[0] as { error: string }).error, /older than Roots/);
});

test('reads needs, unanswered comments, paths and the continuing prompt', () => {
  const ideas = new Map([[1, idea({ status: 'done' })], [2, idea({ id: 2, status: 'active' })]]);
  assert.equal(needMet({ idea: 1 }, ideas), true);
  assert.equal(needMet({ idea: 2 }, ideas), false);
  assert.equal(needMet({ text: 'sheet', met: true }, ideas), true);
  const comments = [
    { by: 'user' as const, text: 'a', at: '' },
    { by: 'agent' as const, text: 'b', at: '' },
    { by: 'user' as const, text: 'c', at: '' }
  ];
  assert.deepEqual(unansweredComments(idea({ comments })).map((comment) => comment.text), ['c']);
  assert.equal(ideaFilePath('figures/a.png', '/w/'), '/w/figures/a.png');
  assert.equal(ideaFilePath('/data/x', '/w'), '/data/x');
  assert.match(continuePrompt(4, 'Harmony'), /^Continue idea 4 \(Harmony\) from Roots: read it with `codeflower-roots show 4`/);
});
