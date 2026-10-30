import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { TranscriptEntry } from '../src/protocol/messages.ts';
import { sessionKey } from '../src/client/sessionKey.ts';
import { TAKEN_OVER, WorkerConnection, type WorkerHandlers } from '../src/client/workerConnection.ts';
import { FakeAgent, tick } from './fakeAgent.ts';

function recorder() {
  const entries: Array<[string, TranscriptEntry]> = [];
  const events: string[] = [];
  const handlers: WorkerHandlers = {
    entry: (key, entry) => entries.push([key, entry]),
    permission: (key, request) => events.push(`permission ${key} ${request ? request.options.map((o) => o.optionId) : 'none'}`),
    question: (key, request) => events.push(`question ${key} ${request ? request.message : 'none'}`),
    busy: (key, busy) => events.push(`busy ${key} ${busy}`),
    config: (key, options) => events.push(`config ${key} ${options.map((o) => `${o.id}=${String(o.currentValue)}`).join(',')}`),
    elicitUrl: async () => 'accept',
    elicitationComplete: () => {},
    show: () => {},
    terminalOutput: () => {},
    terminalExit: () => {},
    usage: () => {},
    wrapUp: () => {},
    closed: (reason, code) => events.push(`closed ${code} ${reason}`)
  };
  return { entries, events, handlers };
}

const client = { name: 'test', version: '0' };

// No agent's name appears in the client: one it has never heard of works the
// same, from what it advertises.
test('works with an agent it knows nothing about, without a code flower bridge', async () => {
  const agent = new FakeAgent({
    initialize: () => ({
      protocolVersion: 1,
      agentInfo: { name: 'pi', title: 'Pi', version: '1.0' },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      authMethods: [{ id: 'pi-login', name: 'Log in to Pi' }]
    }),
    'session/new': () => ({
      sessionId: 's/1',
      modes: { currentModeId: 'ask', availableModes: [{ id: 'ask', name: 'Ask' }, { id: 'act', name: 'Act' }] }
    }),
    'session/set_mode': () => ({}),
    'session/load': () => ({ configOptions: [] }),
    'session/prompt': async (params: { sessionId: string }) => {
      agent.notify('session/update', {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'pi_thinking_meter', level: 3, _meta: { pi: true } }
      });
      return { stopReason: 'end_turn' };
    }
  });
  const { entries, events, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.transport, handlers, client);

  assert.equal(connection.workerStatus, undefined);
  assert.equal(connection.agent, 'pi');
  assert.deepEqual(connection.presentation, { id: 'pi', name: 'Pi' });
  assert.deepEqual(connection.authMethods.map((method) => method.id), ['pi-login']);
  assert.equal(connection.promptCapabilities.image, true);

  const key = await connection.newSession();
  assert.equal(key, `pi-${createHash('sha256').update('s/1').digest('hex').slice(0, 32)}`);
  // Modes only: offered as a setting, changed with session/set_mode.
  await connection.setConfigOption(key, 'mode', 'act');
  assert.deepEqual(events.filter((event) => event.startsWith('config')), [`config ${key} mode=ask`, `config ${key} mode=act`]);

  assert.equal(await connection.prompt(key, 'hello'), 'end_turn');
  // An update kind the client does not know reaches the chat as sent.
  const update = entries.find(([, entry]) => entry.kind === 'update')![1] as Extract<TranscriptEntry, { kind: 'update' }>;
  assert.deepEqual(update.update, { sessionUpdate: 'pi_thinking_meter', level: 3, _meta: { pi: true } });
  assert.deepEqual(entries.map(([, entry]) => entry.kind), ['prompt', 'update', 'turn_end']);

  // Resuming follows the capabilities: this agent loads.
  await connection.resumeSession('older', null);
  assert.ok(agent.received.some((message) => message.method === 'session/load'));
  assert.ok(!agent.received.some((message) => message.method === 'session/resume'));
});

test('falls back from resume to load when the agent advertises neither', async () => {
  const agent = new FakeAgent({
    '_codeflower/status': () => ({ agent: 'claude', agentLabel: 'Claude Code', signedIn: true }),
    initialize: () => ({ protocolVersion: 1 }),
    'session/load': () => ({ _meta: { 'codeflower/busy': true, 'codeflower/transcriptEntries': 7 } })
  });
  const { events, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.transport, handlers, client);
  assert.deepEqual(connection.presentation, { id: 'claude', name: 'Claude Code', color: 'var(--cf-orange)' });
  const attached = await connection.resumeSession('abc', null);
  assert.deepEqual(attached, { key: 'claude-abc', transcriptEntries: 7 });
  assert.deepEqual(
    agent.received.filter((message) => message.method?.startsWith('session/')).map((message) => message.method),
    ['session/resume', 'session/load']
  );
  assert.ok(events.includes('busy claude-abc true'));
});

test('asks the user for permission and answers the agent', async () => {
  const agent = new FakeAgent({
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'pi', version: '1' } }),
    'session/new': () => ({ sessionId: 'one' })
  });
  const { entries, events, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.transport, handlers, client);
  const key = await connection.newSession();
  const answer = agent.request('session/request_permission', {
    sessionId: 'one',
    toolCall: { toolCallId: 't', title: 'rm -rf data' },
    options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }]
  });
  await tick();
  assert.ok(events.includes(`permission ${key} yes`));
  connection.answerPermission(1, 'yes');
  assert.deepEqual((await answer).result, { outcome: { outcome: 'selected', optionId: 'yes' } });
  assert.deepEqual(entries.map(([, entry]) => entry.kind), ['permission', 'permission_outcome']);
});

test('tells the host when another window takes the worker over', async () => {
  const agent = new FakeAgent({
    '_codeflower/status': () => ({ agent: 'codex', agentLabel: 'Codex' }),
    initialize: () => ({ protocolVersion: 1 }),
    'session/new': () => ({ sessionId: 'one' }),
    'session/prompt': () => new Promise(() => {})
  });
  const { events, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.transport, handlers, client);
  const key = await connection.newSession();
  const turn = connection.prompt(key, 'long work');
  await tick();
  agent.close(TAKEN_OVER, 'taken over');
  await assert.rejects(turn, /taken over/);
  assert.equal(connection.connected, false);
  assert.ok(events.includes(`closed ${TAKEN_OVER} taken over`));
});

test('session keys match the bridge', () => {
  assert.equal(sessionKey('claude', 'abc-123'), 'claude-abc-123');
  const unreadable = 'ses/with spaces';
  assert.equal(sessionKey('dsh', unreadable), `dsh-${createHash('sha256').update(unreadable).digest('hex').slice(0, 32)}`);
  assert.equal(sessionKey('codex', 'x'.repeat(97)), `codex-${createHash('sha256').update('x'.repeat(97)).digest('hex').slice(0, 32)}`);
});
