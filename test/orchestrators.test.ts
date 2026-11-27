import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ACCESS, orchestration, orchestratorsOfChat, shareable, type Orchestrator } from '../src/protocol/orchestrators.ts';

const orchestrator = (key: string, executor: string, disconnected = false): Orchestrator => ({
  key,
  agent: 'claude',
  title: key,
  executor,
  executorTitle: executor,
  access: DEFAULT_ACCESS,
  state: 'idle',
  sent: 0,
  ...(disconnected ? { disconnected: true } : {})
});

test("a chat's orchestrators, connected ones first, and the one a chat is", () => {
  const list = [orchestrator('claude-a', 'dsh-1', true), orchestrator('claude-b', 'dsh-1'), orchestrator('claude-c', 'dsh-2')];
  assert.deepEqual(orchestratorsOfChat(list, 'dsh-1').map((one) => one.key), ['claude-b', 'claude-a']);
  assert.equal(orchestration(list, 'claude-c').orchestrator?.executor, 'dsh-2');
  assert.deepEqual(orchestration(list, 'claude-c').orchestrators, []);
});

test('figures and reports can be shared; data files cannot', () => {
  assert.equal(shareable('/w/km.PNG'), 'figure');
  assert.equal(shareable('/w/report.html'), 'report');
  assert.equal(shareable('/w/patients.csv'), undefined);
});
