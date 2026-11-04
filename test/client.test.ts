import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { agentPresentation, type TranscriptEntry } from '../src/protocol/messages.ts';
import { sessionKey } from '../src/client/sessionKey.ts';
import { TAKEN_OVER, WorkerConnection, mcpNotice, type WorkerHandlers } from '../src/client/workerConnection.ts';
import { FakeAgent, agentState, tick } from './fakeAgent.ts';

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
test('works with an agent it knows nothing about', async () => {
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
  }, [agentState('pi', { name: 'Pi' })]);
  const { entries, events, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.open, handlers, client);

  assert.deepEqual(connection.agents.map((state) => state.id), ['pi']);
  assert.deepEqual(connection.presentation('pi'), { id: 'pi', name: 'Pi' });
  // Its own connection opens for what only it tells: its sign-in methods.
  assert.equal(connection.agentConnected('pi'), false);
  assert.deepEqual((await connection.authMethods('pi')).map((method) => method.id), ['pi-login']);
  assert.equal(connection.promptCapabilities('pi').image, true);

  const key = await connection.newSession('pi');
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
  await connection.resumeSession('pi', 'older', null);
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
  const connection = await WorkerConnection.connect(agent.open, handlers, client);
  assert.deepEqual(connection.presentation('claude'), { id: 'claude', name: 'Claude Code', color: 'var(--cf-orange)' });
  // A worker that names its agent's color: a palette name follows the theme, anything else is used as given.
  assert.deepEqual(agentPresentation('pi', { name: 'Pi', color: 'teal' }), { id: 'pi', name: 'Pi', color: 'var(--cf-teal)' });
  assert.equal(agentPresentation('pi', { color: '#3a7bd5' })?.color, '#3a7bd5');
  const attached = await connection.resumeSession('claude', 'abc', null);
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
  const connection = await WorkerConnection.connect(agent.open, handlers, client);
  const key = await connection.newSession('pi');
  connection.setAutoApprove(key, true);
  const answer = agent.request('session/request_permission', {
    sessionId: 'one',
    toolCall: { toolCallId: 't', title: 'rm -rf data' },
    options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }]
  });
  await tick();
  assert.ok(events.includes(`permission ${key} yes`));
  connection.answerPermission(key, 1, 'yes');
  assert.deepEqual((await answer).result, { outcome: { outcome: 'selected', optionId: 'yes' } });
  assert.deepEqual(entries.map(([, entry]) => entry.kind), ['permission', 'permission_outcome']);
});

test('auto-approves DSH permission requests when enabled', async () => {
  const agent = new FakeAgent({
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'dsh', version: '1' } }),
    'session/new': () => ({ sessionId: 'one' })
  }, [agentState('dsh')]);
  const { entries, events, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.open, handlers, client);
  const key = await connection.newSession('dsh');
  connection.setAutoApprove(key, true);

  const answer = agent.request('session/request_permission', {
    sessionId: 'one',
    toolCall: { toolCallId: 't' },
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }
    ]
  });
  assert.deepEqual((await answer).result, {
    outcome: { outcome: 'selected', optionId: 'allow-once' }
  });
  assert.ok(!events.includes(`permission ${key} allow-once,reject-once`));
  assert.deepEqual(entries.map(([, entry]) => entry.kind), ['permission', 'permission_outcome']);
});

test('turning on DSH auto-approval answers an open request', async () => {
  const agent = new FakeAgent({
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'dsh', version: '1' } }),
    'session/new': () => ({ sessionId: 'one' })
  }, [agentState('dsh')]);
  const { events, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.open, handlers, client);
  const key = await connection.newSession('dsh');
  const answer = agent.request('session/request_permission', {
    sessionId: 'one',
    toolCall: { toolCallId: 't' },
    options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }]
  });
  await tick();
  assert.ok(events.includes(`permission ${key} allow-once`));

  connection.setAutoApprove(key, true);
  assert.deepEqual((await answer).result, {
    outcome: { outcome: 'selected', optionId: 'allow-once' }
  });
  assert.ok(events.includes(`permission ${key} none`));
});

test('tells the host when another window takes the worker over', async () => {
  const agent = new FakeAgent({
    '_codeflower/status': () => ({ agent: 'codex', agentLabel: 'Codex' }),
    initialize: () => ({ protocolVersion: 1 }),
    'session/new': () => ({ sessionId: 'one' }),
    'session/prompt': () => new Promise(() => {})
  });
  const { events, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.open, handlers, client);
  const key = await connection.newSession('codex');
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

test('reads worker actions and keeps old bridge images compatible', async () => {
  const action = {
    id: 'checkpoint',
    title: 'Checkpoint',
    description: 'Save progress',
    icon: 'save',
    mode: 'queue' as const,
    prompt: 'Save progress.'
  };
  const agent = new FakeAgent({
    '_codeflower/actions/list': () => ({ actions: [action] }),
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'pi' } })
  });
  const connection = await WorkerConnection.connect(agent.open, recorder().handlers, client);
  assert.deepEqual(await connection.actions(), [action]);

  const olderAgent = new FakeAgent({
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'pi' } })
  });
  const olderConnection = await WorkerConnection.connect(olderAgent.open, recorder().handlers, client);
  assert.equal(await olderConnection.actions(), undefined);
});

test('records action prompt metadata without changing its text', async () => {
  const agent = new FakeAgent({
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'pi' } }),
    'session/new': () => ({ sessionId: 'one' }),
    'session/prompt': () => ({ stopReason: 'end_turn' })
  });
  const connection = await WorkerConnection.connect(agent.open, recorder().handlers, client);
  const key = await connection.newSession('pi');
  await connection.prompt(key, 'Make a checkpoint.', { id: 'checkpoint', title: 'Checkpoint' });
  const request = agent.received.findLast((message) => message.method === 'session/prompt');
  assert.deepEqual(request?.params?.prompt, [
    { type: 'text', text: 'Make a checkpoint.', _meta: { 'codeflower/action': { id: 'checkpoint', title: 'Checkpoint' } } }
  ]);
});

test('shows the prompts, answers and shell commands of other windows on a bridge for several windows', async () => {
  const agent = new FakeAgent({
    '_codeflower/status': () => ({ agent: 'claude', agentLabel: 'Claude Code', signedIn: true }),
    initialize: () => ({ protocolVersion: 1, _meta: { 'codeflower/multiClient': true } }),
    'session/new': () => ({ sessionId: 'one' }),
    'session/prompt': async (params: { sessionId: string; prompt: unknown[] }) => {
      // The bridge echoes the prompt to every window, this one too.
      agent.notify('_codeflower/prompted', { key: 'claude-one', sessionId: params.sessionId, prompt: params.prompt });
      return { stopReason: 'end_turn' };
    }
  });
  const { entries, events, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.open, handlers, client);
  const key = await connection.newSession('claude');

  // Its own prompt shows once, as the bridge echoes it.
  assert.equal(await connection.prompt(key, 'hello'), 'end_turn');
  assert.deepEqual(entries.map(([, entry]) => entry.kind), ['prompt', 'turn_end']);

  // Another window's prompt.
  agent.notify('_codeflower/prompted', { key, sessionId: 'one', prompt: [{ type: 'text', text: 'from VS Code' }] });
  await tick();
  assert.deepEqual(entries.at(-1), [key, { t: entries.at(-1)![1].t, kind: 'prompt', prompt: [{ type: 'text', text: 'from VS Code' }] }]);

  // A permission request another window answers closes here with that answer.
  const answer = agent.request('session/request_permission', {
    sessionId: 'one',
    toolCall: { toolCallId: 't', title: 'ls' },
    options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }],
    _meta: { 'codeflower/requestKey': '"r1"' }
  });
  await tick();
  assert.ok(events.includes(`permission ${key} yes`));
  const allow = { outcome: { outcome: 'selected', optionId: 'yes' } };
  agent.notify('_codeflower/requestResolved', { key, sessionId: 'one', requestKey: '"r1"', result: allow });
  await tick();
  assert.equal(events.at(-1), `permission ${key} none`);
  assert.deepEqual((entries.at(-1)![1] as { outcome: unknown }).outcome, allow.outcome);
  assert.deepEqual((await answer).result, allow);

  // Another window's shell command, live.
  agent.notify('_codeflower/shell/started', { key, sessionId: 'one', runId: 'run-1', command: 'ls' });
  agent.notify('_codeflower/shell/output', { runId: 'run-1', data: 'a.txt\n' });
  agent.notify('_codeflower/shell/ended', { key, sessionId: 'one', runId: 'run-1', exitCode: 0, timedOut: false });
  await tick();
  assert.deepEqual(
    entries.slice(-3).map(([, entry]) => entry.kind),
    ['shell', 'shell_output', 'shell_end']
  );
});

test('echoes its own prompt itself on an older bridge', async () => {
  const agent = new FakeAgent({
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'pi', version: '1' } }),
    'session/new': () => ({ sessionId: 'one' }),
    'session/prompt': () => ({ stopReason: 'end_turn' })
  });
  const { entries, handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.open, handlers, client);
  const key = await connection.newSession('pi');
  await connection.prompt(key, 'hello');
  assert.deepEqual(entries.map(([, entry]) => entry.kind), ['prompt', 'turn_end']);
});

test("keeps the MCP servers from the app's config a session is without, for the chat's notice", async () => {
  const leftOut = [{ name: 'docs', reason: 'it did not start' }];
  const agent = new FakeAgent({
    '_codeflower/status': () => ({ agent: 'dsh', agentLabel: 'DeepSeek Harness', signedIn: true }),
    initialize: () => ({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } }),
    'session/new': () => ({ sessionId: 'new', _meta: { 'codeflower/mcpLeftOut': leftOut } }),
    'session/resume': () => ({})
  });
  const { handlers } = recorder();
  const connection = await WorkerConnection.connect(agent.open, handlers, client);
  const key = await connection.newSession('dsh');
  assert.equal(
    connection.mcpNotice(key),
    'This chat is without MCP servers from your config: docs (it did not start). Fix them under mcp_servers: in config.yaml, then restart the sandbox.'
  );
  // A session with all its servers has no notice.
  const resumed = await connection.resumeSession('dsh', 'old', null);
  assert.equal(connection.mcpNotice(resumed.key), undefined);
  assert.equal(mcpNotice([]), undefined);
});

test("hears which chats are open in the agent's terminal UI: on connect, and as that changes", async () => {
  const terminal = {
    terminalId: 'term-1',
    sessionKey: 'claude-s1',
    sessionId: 's1',
    mode: 'handoff' as const,
    viewers: 1,
    startedAt: '2026-11-02T10:00:00.000Z'
  };
  const agent = new FakeAgent({
    '_codeflower/status': () => ({ agent: 'claude', agentLabel: 'Claude Code', signedIn: true, capabilities: { chatTerminals: true } }),
    '_codeflower/terminal/list': () => ({ terminals: [terminal] }),
    initialize: () => ({ protocolVersion: 1, agentCapabilities: {} })
  });
  const heard: string[][] = [];
  const { handlers } = recorder();
  await WorkerConnection.connect(agent.open, { ...handlers, terminals: (list) => heard.push(list.map((entry) => `${entry.sessionKey} ${entry.mode}`)) }, client);
  assert.deepEqual(heard, [['claude-s1 handoff']]);
  agent.notify('_codeflower/terminal/changed', { terminals: [] });
  await tick();
  assert.deepEqual(heard, [['claude-s1 handoff'], []]);

  // A worker without terminal UIs is not asked; a window without the handler hears nothing.
  const older = new FakeAgent({
    '_codeflower/status': () => ({ agent: 'claude', agentLabel: 'Claude Code', signedIn: true }),
    initialize: () => ({ protocolVersion: 1, agentCapabilities: {} })
  });
  await WorkerConnection.connect(older.open, recorder().handlers, client);
  assert.equal(older.received.some((message) => message.method === '_codeflower/terminal/list'), false);
});

test("hears the user's shells apart from the chats' terminals, and attaches to one with its size", async () => {
  const chat = { terminalId: 'term-1', kind: 'chat' as const, sessionKey: 'opencode-s1', sessionId: 's1', mode: 'shared' as const, viewers: 0, startedAt: '2026-11-04T10:00:00.000Z' };
  const shell = { terminalId: 'term-2', kind: 'shell' as const, viewers: 1, startedAt: '2026-11-04T10:01:00.000Z' };
  const agent = new FakeAgent({
    '_codeflower/status': () => ({ agent: 'opencode', agentLabel: 'OpenCode', signedIn: true, capabilities: { chatTerminals: true, shellTerminals: true } }),
    '_codeflower/terminal/list': () => ({ terminals: [chat, shell] }),
    '_codeflower/terminal/start': () => ({ terminalId: 'term-3' }),
    '_codeflower/terminal/attach': () => ({}),
    initialize: () => ({ protocolVersion: 1, agentCapabilities: {} })
  });
  const chats: string[][] = [];
  const shells: string[][] = [];
  const output: [string, string, boolean | undefined][] = [];
  const { handlers } = recorder();
  const connection = await WorkerConnection.connect(
    agent.open,
    {
      ...handlers,
      terminals: (list) => chats.push(list.map((entry) => entry.terminalId)),
      shells: (list) => shells.push(list.map((entry) => entry.terminalId)),
      terminalOutput: (terminalId, data, replayed) => output.push([terminalId, data, replayed])
    },
    client
  );
  assert.equal(connection.shellTerminals, true);
  assert.deepEqual(chats, [['term-1']]);
  assert.deepEqual(shells, [['term-2']]);
  agent.notify('_codeflower/terminal/changed', { terminals: [shell] });
  await tick();
  assert.deepEqual(chats.at(-1), []);
  assert.deepEqual(shells.at(-1), ['term-2']);

  assert.equal(await connection.startShell(90, 25), 'term-3');
  await connection.attachTerminal('term-2', 120, 40);
  const sent = (method: string) => agent.received.find((message) => message.method === method)?.params;
  assert.deepEqual(sent('_codeflower/terminal/start'), { kind: 'shell', columns: 90, rows: 25 });
  assert.deepEqual(sent('_codeflower/terminal/attach'), { terminalId: 'term-2', columns: 120, rows: 40 });
  agent.notify('_codeflower/terminal/output', { terminalId: 'term-2', data: '$ ', replayed: true });
  await tick();
  assert.deepEqual(output, [['term-2', '$ ', true]]);
});

// OpenCode lists its slash commands while it creates the chat, before the
// window attached: the window reads them from the transcript, up to here.
test('a new chat says how many transcript entries came before its live updates', async () => {
  let entries: number | undefined = 1;
  const agent = new FakeAgent({
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'pi', version: '1.0' }, agentCapabilities: {} }),
    'session/new': () => ({ sessionId: `s${entries}`, _meta: entries === undefined ? {} : { 'codeflower/transcriptEntries': entries } })
  });
  const connection = await WorkerConnection.connect(agent.open, recorder().handlers, client);
  const started = await connection.startSession('pi');
  assert.equal(started.transcriptEntries, 1);
  assert.equal(connection.isAttached(started.key), true);
  entries = undefined;
  assert.equal((await connection.startSession('pi')).transcriptEntries, undefined);
});

// One sandbox, several agents: each chat goes to its own agent's connection,
// opened when it is first needed, and one agent's restart leaves the others'.
test("routes each chat to its agent's own connection, and an agent's restart leaves the others", async () => {
  const agent = new FakeAgent(
    {
      initialize: () => ({ protocolVersion: 1, agentCapabilities: {} }),
      'session/new': () => ({ sessionId: 'one' }),
      'session/prompt': () => ({ stopReason: 'end_turn' })
    },
    [agentState('claude', { name: 'Claude Code' }), agentState('codex', { name: 'Codex', signedIn: false })]
  );
  const { events, handlers } = recorder();
  const closedAgents: string[] = [];
  const usage: string[] = [];
  const connection = await WorkerConnection.connect(
    agent.open,
    { ...handlers, agentClosed: (name, _reason, code) => closedAgents.push(`${name} ${code}`), usage: (name) => usage.push(name) },
    client
  );
  // The sandbox's own connection starts no agent.
  assert.equal(agent.received.some((message) => message.method === 'initialize'), false);
  assert.deepEqual(connection.agents.map((state) => [state.id, state.signedIn]), [['claude', true], ['codex', false]]);

  const claude = await connection.newSession('claude');
  const codex = await connection.newSession('codex');
  assert.deepEqual([claude, codex], ['claude-one', 'codex-one']);
  assert.equal(agent.received.filter((message) => message.method === 'initialize').length, 2);
  assert.equal(await connection.prompt(codex, 'hi'), 'end_turn');
  assert.equal(connection.isAttached(claude), true);

  // The agent's usage, which the sandbox's own connection hears, names the agent.
  agent.notify('_codeflower/usage', { agent: 'codex', auth: { kind: 'api_key' }, limits: [], limitsUpdatedAt: null, costEstimate: false, totals: {}, sessions: [] });
  await tick();
  assert.deepEqual(usage, ['codex']);

  // An agent's connection ends (it restarted): its chats detach, the sandbox stays connected.
  agent.closeAgents(1011, 'Agent process ended');
  await tick();
  assert.deepEqual(closedAgents.sort(), ['claude 1011', 'codex 1011']);
  assert.equal(connection.connected, true);
  assert.equal(connection.isAttached(claude), false);
  assert.ok(!events.some((event) => event.startsWith('closed')));
  // The next chat opens a fresh connection.
  assert.equal(await connection.newSession('claude'), 'claude-one');
  assert.equal(connection.agentConnected('claude'), true);
});
