import assert from 'node:assert/strict';
import test from 'node:test';
import { formatInterval, watchActive, watchesOfChat, watchOfFile, watchStatus, type Watch } from '../src/protocol/watches.ts';

function watch(id: string, extra: Partial<Watch> = {}): Watch {
  return {
    id,
    name: 'PR 12',
    command: 'gh pr view 12 --json state',
    cwd: '/workspace',
    every: 120_000,
    timeout: 86_400_000,
    until: 'match:MERGED|CLOSED',
    state: 'watching',
    running: false,
    runs: 3,
    failures: 0,
    started: '2026-11-25T10:00:00.000Z',
    deadline: '2026-11-26T10:00:00.000Z',
    log: `/codeflower-state/watches/${id}/output.log`,
    agent: 'claude',
    sessionId: 's1',
    key: 'claude-s1',
    ...extra
  };
}

test("a chat's watches: its own, the running ones first, then the newest", () => {
  const list = [
    watch('w-00000001', { state: 'met', started: '2026-11-25T12:00:00.000Z' }),
    watch('w-00000002', { started: '2026-11-25T09:00:00.000Z' }),
    watch('w-00000003', { key: 'claude-other' }),
    watch('w-00000004', { started: '2026-11-25T11:00:00.000Z' })
  ];
  assert.deepEqual(
    watchesOfChat(list, 'claude-s1').map((each) => each.id),
    ['w-00000004', 'w-00000002', 'w-00000001']
  );
  assert.equal(watchActive(list[0]), false);
  assert.equal(watchActive(list[1]), true);
});

test("a watch's state for people, and the watch a file belongs to", () => {
  assert.equal(formatInterval(90_000), '1m30s');
  assert.equal(formatInterval(50), '50ms');
  assert.equal(
    watchStatus(watch('w-00000001', { lastRun: { run: 3, at: '', exitCode: 0, verdict: 'waiting', ms: 400 } })),
    'every 2m until match:MERGED|CLOSED · run 3 · last exit 0, not yet'
  );
  assert.equal(watchStatus(watch('w-00000001', { state: 'failing', reason: '3 runs in a row failed (exit 2)' })), 'failing: 3 runs in a row failed (exit 2) · 3 runs');
  const list = [watch('w-0000000a')];
  // By the id in the path: the sandbox may give the real path, under another folder.
  assert.equal(watchOfFile(list, '/private/state/watches/w-0000000a/output.log')?.id, 'w-0000000a');
  assert.equal(watchOfFile(list, '/codeflower-state/watches/w-0000000b/output.log'), undefined);
  assert.equal(watchOfFile(list, '/codeflower-state/jobs/j-000001/output.log'), undefined);
});

test("a watch need's state on the map", async () => {
  const { watchNeedState } = await import('../src/protocol/roots.ts');
  assert.equal(watchNeedState({ watch: 'w-00000001', text: 'PR 12', met: false }), 'watching');
  assert.equal(watchNeedState({ watch: 'w-00000001', text: 'PR 12', met: true }), 'met');
  assert.equal(watchNeedState({ watch: 'w-00000001', text: 'PR 12', met: false, ended: 'failing' }), 'failing');
});
