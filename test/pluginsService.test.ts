import assert from 'node:assert/strict';
import test from 'node:test';
import { servePlugins } from '../src/client/pluginsService.ts';
import type { PluginsHostMessage } from '../src/protocol/plugins.ts';
import type { WorkerConnection } from '../src/client/workerConnection.ts';

// A connection that answers the plugin methods and lets the test say they changed.
function fakeConnection(calls: string[]) {
  const listeners = new Set<() => void>();
  const connection = {
    connected: true,
    onPluginsChanged(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async plugins() {
      calls.push('plugins');
      return { available: true, entries: [] };
    },
    async addPlugin(source: string) {
      calls.push(`add ${source}`);
      if (source === 'bad') throw new Error('not a source');
      return { id: `claude:${source}`, pendingFetch: true };
    }
  };
  return { connection: connection as unknown as WorkerConnection, changed: () => listeners.forEach((listener) => listener()), listeners };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('answers the view from the connection and passes on that the plugins changed', async () => {
  const calls: string[] = [];
  const sent: PluginsHostMessage[] = [];
  let current = fakeConnection(calls);
  const restarted = fakeConnection(calls);
  const service = servePlugins({
    connection: () => current.connection,
    send: (message) => sent.push(message),
    agentLabel: 'Claude Code',
    restart: async () => {
      current = restarted;
    },
    fetchHint: 'run codeflower plugins fetch'
  });

  service.receive({ type: 'ready' });
  assert.deepEqual(sent.shift(), { type: 'context', agentLabel: 'Claude Code', appFetch: false, fetchHint: 'run codeflower plugins fetch' });

  service.receive({ type: 'call', id: 1, method: 'add', params: { source: 'github:a/b' } });
  service.receive({ type: 'call', id: 2, method: 'add', params: { source: 'bad' } });
  service.receive({ type: 'call', id: 3, method: 'appFetch' });
  await settle();
  // Each call answers when it is done, in any order.
  assert.deepEqual(sent.splice(0).sort((a, b) => (a.type === 'result' && b.type === 'result' ? a.id - b.id : 0)), [
    { type: 'result', id: 1, result: { id: 'claude:github:a/b', pendingFetch: true } },
    { type: 'result', id: 2, error: 'not a source' },
    { type: 'result', id: 3, error: 'run codeflower plugins fetch' }
  ]);

  current.changed();
  assert.deepEqual(sent.splice(0), [{ type: 'changed' }]);

  // After a restart the view follows the new connection.
  service.receive({ type: 'call', id: 4, method: 'restart' });
  await settle();
  assert.deepEqual(sent.splice(0), [{ type: 'changed' }, { type: 'result', id: 4, result: {} }]);
  restarted.changed();
  assert.deepEqual(sent.splice(0), [{ type: 'changed' }]);

  service.dispose();
  assert.equal(restarted.listeners.size, 0);
});
