import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { PendingPermission, TranscriptEntry } from '../src/protocol/messages.ts';
import { buildItems } from '../src/chat/lib/transcript.ts';
import { sortSubagents, subagentStatus, withSubagent, type SubagentSummary } from '../src/protocol/subagents.ts';
import { WorkerConnection, type WorkerHandlers } from '../src/client/workerConnection.ts';
import { FakeAgent, tick } from './fakeAgent.ts';

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 2, 10, 0, seconds)).toISOString();
const update = (t: number, value: unknown): TranscriptEntry => ({ t: at(t), kind: 'update', update: value as SessionUpdate });

test("a chat shows each subagent as one card where it started, with its task and reply", () => {
  const items = buildItems([
    { t: at(0), kind: 'prompt', prompt: [{ type: 'text', text: 'Look around' }] },
    update(1, { sessionUpdate: 'subagent_update', sessionId: 'c', title: 'Explorer', state: { state: 'running' } }),
    update(1, { sessionUpdate: 'session_message', senderSessionId: 'p', recipientSessionId: 'c', content: [{ type: 'text', text: 'Find the notes' }] }),
    update(2, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Waiting for it' } }),
    update(9, { sessionUpdate: 'session_message', senderSessionId: 'c', recipientSessionId: 'p', content: [{ type: 'text', text: 'In notes.txt' }] }),
    update(9, { sessionUpdate: 'subagent_update', sessionId: 'c', state: { state: 'idle', stopReason: 'end_turn' } })
  ]);
  assert.deepEqual(
    items.map((item) => item.kind),
    ['user', 'subagent', 'assistant']
  );
  const card = items[1] as Extract<(typeof items)[number], { kind: 'subagent' }>;
  assert.deepEqual(
    { title: card.title, prompt: card.prompt, reply: card.reply, state: card.state, stopReason: card.stopReason, took: card.ended! - card.started! },
    { title: 'Explorer', prompt: 'Find the notes', reply: 'In notes.txt', state: 'idle', stopReason: 'end_turn', took: 8000 }
  );
});

test("a subagent's chat starts with the task its parent gave it", () => {
  const items = buildItems([
    update(1, { sessionUpdate: 'session_message', senderSessionId: 'p', recipientSessionId: 'c', content: [{ type: 'text', text: 'Find the notes' }] }),
    update(2, { sessionUpdate: 'tool_call', toolCallId: 't', title: 'Read notes.txt', status: 'completed' })
  ]);
  assert.deepEqual(items.map((item) => (item.kind === 'task' ? `task ${item.text}` : item.kind)), ['task Find the notes', 'tool']);
});

test('lists running subagents first, then the latest ended', () => {
  const subagent = (key: string, state: SubagentSummary['state'], endedAt?: string): SubagentSummary => ({
    key,
    parentKey: 'p',
    sessionId: key,
    state,
    startedAt: at(0),
    ...(endedAt ? { endedAt } : {})
  });
  const list = [subagent('old', 'idle', at(5)), subagent('run', 'running'), subagent('new', 'idle', at(9))];
  assert.deepEqual(sortSubagents(list).map((entry) => entry.key), ['run', 'new', 'old']);
  assert.deepEqual(withSubagent(list, { ...list[1]!, state: 'idle' }).map((entry) => entry.state), ['idle', 'idle', 'idle']);
  assert.equal(subagentStatus({ state: 'idle', stopReason: 'cancelled' }), 'stopped');
  assert.equal(subagentStatus({ state: 'requires_action' }), 'waiting for you');
});

test("a subagent's updates reach its chat only once opened, and its requests go to its parent's chat", async () => {
  const features = { reports: { model: true, effort: true, usage: 'none', result: true }, settings: {} };
  const agent = new FakeAgent({
    '_codeflower/status': () => ({ instanceId: 'i', agent: 'claude', agentLabel: 'Claude Code', signedIn: true, capabilities: { subagents: features } }),
    initialize: () => ({ protocolVersion: 1, agentCapabilities: {} }),
    'session/new': () => ({ sessionId: 'p' }),
    '_codeflower/subagents/list': () => ({ subagents: [{ key: 'claude-c', parentKey: 'claude-p', sessionId: 'c', state: 'running' }] }),
    '_codeflower/subagents/open': () => ({ key: 'claude-c', parentKey: 'claude-p', live: true, sessionId: 'c', transcriptEntries: 3 }),
    '_codeflower/subagents/close': () => ({})
  });
  const entries: string[] = [];
  const permissions: Array<[string, PendingPermission | null]> = [];
  const changed: string[] = [];
  const handlers: WorkerHandlers = {
    entry: (key, entry) => entries.push(`${key} ${entry.kind === 'update' ? entry.update.sessionUpdate : entry.kind}`),
    permission: (key, request) => permissions.push([key, request]),
    question: () => {},
    busy: () => {},
    config: () => {},
    elicitUrl: async () => 'accept',
    elicitationComplete: () => {},
    show: () => {},
    terminalOutput: () => {},
    terminalExit: () => {},
    usage: () => {},
    wrapUp: () => {},
    subagent: (parentKey, subagent) => changed.push(`${parentKey} ${subagent.key} ${subagent.state}`),
    closed: () => {}
  };
  const connection = await WorkerConnection.connect(agent.transport, handlers, { name: 'test', version: '0' });
  const initialize = agent.received.find((message) => message.method === 'initialize');
  assert.deepEqual(initialize?.params.clientCapabilities.subagents, {});
  assert.deepEqual(connection.subagentFeatures, features);

  const parent = await connection.newSession();
  assert.deepEqual((await connection.subagents(parent)).map((subagent) => subagent.key), ['claude-c']);
  const childUpdate = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } };
  agent.notify('session/update', { sessionId: 'c', update: childUpdate });
  await tick();
  assert.equal(entries.length, 0);

  const opened = await connection.openSubagent('claude-c');
  assert.equal(opened.transcriptEntries, 3);
  agent.notify('session/update', { sessionId: 'c', update: childUpdate });
  await tick();
  assert.deepEqual(entries, ['claude-c agent_message_chunk']);

  // The subagent asks; its parent's chat shows it, saying whose it is.
  const answer = agent.request('session/request_permission', {
    sessionId: 'c',
    toolCall: { toolCallId: 't', title: 'Run grep' },
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    _meta: { 'codeflower/parentSessionIds': ['p'] }
  });
  await tick();
  const [key, request] = permissions.at(-1)!;
  assert.equal(key, parent);
  assert.deepEqual(request?.subagent, { key: 'claude-c' });
  connection.answerPermission(request!.requestId, 'allow');
  assert.deepEqual((await answer).result, { outcome: { outcome: 'selected', optionId: 'allow' } });

  agent.notify('_codeflower/subagents/changed', { parentKey: parent, subagent: { key: 'claude-c', parentKey: parent, sessionId: 'c', state: 'idle' } });
  await tick();
  assert.deepEqual(changed, [`${parent} claude-c idle`]);

  // The request and its answer belong to the parent's chat.
  assert.deepEqual(entries.slice(1), [`${parent} permission`, `${parent} permission_outcome`]);

  await connection.closeSubagent('claude-c');
  agent.notify('session/update', { sessionId: 'c', update: childUpdate });
  await tick();
  assert.equal(entries.filter((entry) => entry.startsWith('claude-c')).length, 1);
  connection.close();
});
