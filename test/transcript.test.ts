import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionUpdate, ToolCallUpdate } from '@agentclientprotocol/sdk';
import { FORK_CONTEXT_META, STEER_NOTE, STEER_NOTE_META, type TranscriptEntry } from '../src/protocol/messages.ts';
import { activity, buildItems, foldTurns, shownFiles, withKnownToolCall, type ChatItem, type Turn, type TurnPart } from '../src/chat/lib/transcript.ts';

const update = (value: SessionUpdate): TranscriptEntry => ({ t: '', kind: 'update', update: value });
const chunk = (text: string, messageId?: string) =>
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text }, ...(messageId ? { messageId } : {}) });

test('shows what /compact freed and the output of /context once', () => {
  const context = `## Context Usage\n\n| Category | Tokens |\n|---|---|\n| Skills | 12k |`;
  const items = buildItems([
    { t: '', kind: 'prompt', prompt: [{ type: 'text', text: '/compact' }] },
    update({ sessionUpdate: 'tool_call', toolCallId: 'c', title: 'Compact conversation', kind: 'think', status: 'in_progress' }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'c', status: 'completed' }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'c', rawOutput: { trigger: 'manual', preTokens: 24343, postTokens: 5987 } }),
    { t: '', kind: 'prompt', prompt: [{ type: 'text', text: '/context' }] },
    chunk(context, 'a'),
    chunk(`${context}\n`, 'b'),
    { t: '', kind: 'prompt', prompt: [{ type: 'text', text: '/context' }] },
    chunk(context),
    chunk(context)
  ]);
  assert.deepEqual(
    items.map((item) => (item.kind === 'tool' ? item.title : item.kind)),
    ['user', 'Compacted the conversation: 24.3k → 6.0k tokens', 'user', 'assistant', 'user', 'assistant']
  );
  assert.equal(items.filter((item) => item.kind === 'assistant' && item.text === context).length, 2);
});

test('joins the chunks of one message', () => {
  const items = buildItems([chunk('Hello ', 'm'), chunk('there', 'm'), chunk('!')]);
  assert.deepEqual(
    items.map((item) => (item.kind === 'assistant' ? item.text : item.kind)),
    ['Hello there!']
  );
});

test('renders action prompts compactly and falls back when metadata is missing', () => {
  const action = buildItems([
    {
      t: '',
      kind: 'prompt',
      prompt: [
        {
          type: 'text',
          text: 'Make a checkpoint.',
          _meta: { 'codeflower/action': { id: 'checkpoint', title: 'Checkpoint' } }
        }
      ]
    }
  ]);
  const plain = buildItems([{ t: '', kind: 'prompt', prompt: [{ type: 'text', text: 'Make a checkpoint.' }] }]);
  assert.deepEqual(action, [{ kind: 'action', id: '0', title: 'Checkpoint', text: 'Make a checkpoint.', started: null, ended: null }]);
  assert.deepEqual(plain, [{ kind: 'user', id: '0', text: 'Make a checkpoint.', started: null, ended: null }]);
});

test("shows the bridge's notices apart from the user's messages, each starting the agent's turn", () => {
  const at = (seconds: number) => new Date(seconds * 1000).toISOString();
  const text = 'A batch job you submitted ended:\n- align (j-2d5d65, slurm 1): done (6 done, 0 failed)';
  const items = buildItems([
    { t: at(0), kind: 'prompt', prompt: [{ type: 'text', text: 'Run the alignment.' }] },
    chunk('Submitted.'),
    { t: at(5), kind: 'turn_end', stopReason: 'end_turn' },
    {
      t: at(60),
      kind: 'prompt',
      prompt: [{ type: 'text', text, _meta: { 'codeflower/notice': { title: 'Batch job ended', summary: 'align done (6 done)' } } }]
    },
    chunk('The alignment is done.'),
    { t: at(70), kind: 'turn_end', stopReason: 'end_turn' },
    // A notice without a summary.
    { t: at(80), kind: 'prompt', prompt: [{ type: 'text', text: 'Wrap up.', _meta: { 'codeflower/notice': { title: 'Wrap up' } } }] }
  ]);
  assert.deepEqual(items[2], {
    kind: 'notice',
    id: '3',
    title: 'Batch job ended',
    summary: 'align done (6 done)',
    text,
    started: 60_000,
    ended: 70_000
  });
  assert.deepEqual(
    items.map((item) => item.kind),
    ['user', 'assistant', 'notice', 'assistant', 'notice']
  );
  const last = items.at(-1);
  assert.equal(last?.kind === 'notice' ? last.summary : undefined, null);
  // The agent's answer to a notice is that notice's turn, not the user's prompt's.
  const turns = foldTurns(items);
  assert.deepEqual(
    turns.map((turn) => turn.prompt?.kind),
    ['user', 'notice', 'notice']
  );
});

test("shows a message sent while the agent worked without the client's note to the agent", () => {
  const items = buildItems([
    {
      t: '',
      kind: 'prompt',
      prompt: [
        { type: 'text', text: STEER_NOTE, _meta: { [STEER_NOTE_META]: true } },
        { type: 'text', text: 'btw, also X' }
      ]
    }
  ]);
  assert.deepEqual(items, [{ kind: 'user', id: '0', text: 'btw, also X', started: null, ended: null }]);
});

test('times tool calls, until the turn ends for those left running', () => {
  const at = (seconds: number) => new Date(seconds * 1000).toISOString();
  const items = buildItems([
    { t: at(0), kind: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'sleep 5', status: 'in_progress' } },
    { t: at(5), kind: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed' } },
    { t: at(6), kind: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'sleep 99', status: 'in_progress' } },
    { t: at(9), kind: 'turn_end', stopReason: 'cancelled' }
  ]);
  assert.deepEqual(
    items.flatMap((item) => (item.kind === 'tool' ? [[item.started, item.ended]] : [])),
    [[0, 5000], [6000, 9000]]
  );
});

const at = (seconds: number) => new Date(seconds * 1000).toISOString();
const prompt = (text: string, seconds = 0): TranscriptEntry => ({ t: at(seconds), kind: 'prompt', prompt: [{ type: 'text', text }] });
const tool = (toolCallId: string, title: string, rawInput?: unknown) =>
  update({ sessionUpdate: 'tool_call', toolCallId, title, kind: 'execute', status: 'completed', ...(rawInput ? { rawInput } : {}) });
const thought = (text: string) => update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } });
const describe = (items: ChatItem[]) => items.map((item) => (item.kind === 'assistant' ? item.text : item.kind));

// Each message shows as one string; the steps between messages fold, as one array.
const parts = (turn: Turn) => turn.parts.map((part) => (part.kind === 'item' ? describe([part.item])[0] : describe(part.steps)));

test('folds the steps between the agent\'s messages, which keep their place', () => {
  const [turn, ...rest] = foldTurns(
    buildItems([
      prompt('Cluster the data', 10),
      thought('Hm'),
      tool('a', 'ls /data'),
      chunk('Let me check the files.', 'm1'),
      tool('b', 'python cluster.py'),
      chunk('I found 8 clusters.', 'm2'),
      { t: at(250), kind: 'turn_end', stopReason: 'end_turn' }
    ])
  );
  assert.equal(rest.length, 0);
  assert.equal(turn!.prompt?.kind, 'user');
  assert.equal(turn!.prompt?.started, 10_000);
  assert.equal(turn!.prompt?.ended, 250_000);
  assert.deepEqual(parts(turn!), [['thought', 'tool'], 'Let me check the files.', ['tool'], 'I found 8 clusters.']);
  assert.equal(turn!.steps, 3);
});

test('messages in a row show in a row, and steps after the last message fold too', () => {
  const [turn] = foldTurns(
    buildItems([
      prompt('Plot it'),
      chunk('First.', 'm1'),
      chunk('Then.', 'm2'),
      tool('a', 'python plot.py'),
      chunk('Here is the figure.', 'm3'),
      tool('b', 'codeflower-show umap.png'),
      { t: '', kind: 'show', files: ['umap.png'] },
      { t: '', kind: 'turn_end', stopReason: 'end_turn' }
    ])
  );
  assert.deepEqual(parts(turn!), ['First.', 'Then.', ['tool'], 'Here is the figure.', ['tool'], 'show']);
  // A folded row keeps the id of its first step, so it stays open while more steps join it.
  assert.equal((turn!.parts[2] as Extract<TurnPart, { kind: 'steps' }>).id, turn!.work[2]!.id);
});

test('keeps what the user did and a stopped turn in sight, and pages that start mid-turn', () => {
  const turns = foldTurns(
    buildItems([
      tool('a', 'ls'),
      chunk('Done before.'),
      prompt('Go on'),
      { t: '', kind: 'shell', runId: 'r', command: 'ls' },
      { t: '', kind: 'shell_end', runId: 'r', exitCode: 0, timedOut: false, output: '' },
      tool('b', 'sleep 100'),
      { t: '', kind: 'turn_end', stopReason: 'cancelled' }
    ])
  );
  assert.deepEqual(
    turns.map((turn) => [turn.id, turn.prompt?.kind ?? null, parts(turn)]),
    [
      ['start', null, [['tool'], 'Done before.']],
      ['2', 'user', ['shell', ['tool'], 'stop']]
    ]
  );
});

test('a failed call that ended the turn shows, once the turn is over', () => {
  const failing = [
    prompt('/compact'),
    thought('Compacting'),
    update({ sessionUpdate: 'tool_call', toolCallId: 'c', title: 'Compact conversation', kind: 'think', status: 'failed' })
  ];
  // While the turn runs, the agent may still recover from it.
  assert.deepEqual(parts(foldTurns(buildItems(failing))[0]!), [['thought', 'tool']]);
  const [turn] = foldTurns(buildItems([...failing, { t: at(5), kind: 'turn_end', stopReason: 'end_turn' }]));
  assert.deepEqual(parts(turn!), [['thought'], 'tool']);
  assert.equal(turn!.steps, 1);
  // One the agent went on from stays folded.
  const [recovered] = foldTurns(
    buildItems([...failing, chunk('Compaction failed: the session limit is hit.'), { t: at(5), kind: 'turn_end', stopReason: 'end_turn' }])
  );
  assert.deepEqual(parts(recovered!), [['thought', 'tool'], 'Compaction failed: the session limit is hit.']);
});

test('output after a turn ended, with no new prompt, belongs to that turn', () => {
  const [turn] = foldTurns(
    buildItems([
      prompt('Run the subagents'),
      chunk('They run in the background.', 'm1'),
      { t: '', kind: 'turn_end', stopReason: 'end_turn' },
      tool('a', 'read results'),
      chunk('Both finished: all good.', 'm2')
    ])
  );
  assert.deepEqual(parts(turn!), ['They run in the background.', ['tool'], 'Both finished: all good.']);
});

test('says what the agent does now, from its latest step', () => {
  const now = (...entries: TranscriptEntry[]) => activity(foldTurns(buildItems([prompt('x'), ...entries]))[0]!.work);
  assert.equal(now(), null);
  assert.equal(now(tool('a', 'pytest -q')), 'pytest -q');
  assert.equal(now(tool('a', 'pytest -q', { description: 'Run the tests' })), 'Run the tests');
  assert.equal(now(thought('Hm')), 'Thinking…');
  assert.equal(now(chunk('Looking at the data.')), 'Writing…');
  assert.equal(now(tool('a', 'ls'), { t: '', kind: 'show', files: ['a.png'] }), 'ls');
  assert.equal(
    now(
      update({
        sessionUpdate: 'plan',
        entries: [
          { content: 'Load', priority: 'medium', status: 'completed' },
          { content: 'Cluster', priority: 'medium', status: 'in_progress' }
        ]
      })
    ),
    'Cluster'
  );
});

// dsh's permission requests name only the tool call (recorded); the card shows what the chat knows of it.
test('a permission request takes what it leaves out from the tool call it names', () => {
  const entries: TranscriptEntry[] = [
    { t: 't1', kind: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'write-1', title: 'Write /codeflower-state/x.txt', kind: 'edit', status: 'in_progress', rawInput: { file_path: '/codeflower-state/x.txt' }, locations: [{ path: '/codeflower-state/x.txt' }] } },
    { t: 't2', kind: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'bash-1', title: 'bash', kind: 'other', status: 'in_progress', rawInput: { command: 'touch /codeflower-state/y' } } },
    { t: 't3', kind: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'bash-1', title: 'Touch y' } }
  ];
  const request = (toolCall: ToolCallUpdate) => ({ requestId: 1, toolCall, options: [] });
  assert.deepEqual(withKnownToolCall(request({ toolCallId: 'write-1' }), entries).toolCall, {
    toolCallId: 'write-1',
    title: 'Write /codeflower-state/x.txt',
    kind: 'edit',
    rawInput: { file_path: '/codeflower-state/x.txt' },
    locations: [{ path: '/codeflower-state/x.txt' }]
  });
  // Later updates count, and what the request says itself comes first.
  assert.equal(withKnownToolCall(request({ toolCallId: 'bash-1' }), entries).toolCall?.title, 'Touch y');
  assert.equal(withKnownToolCall(request({ toolCallId: 'bash-1', title: 'Run touch' }), entries).toolCall?.title, 'Run touch');
  assert.deepEqual((withKnownToolCall(request({ toolCallId: 'bash-1' }), entries).toolCall?.rawInput as { command: string }).command, 'touch /codeflower-state/y');
  // An unknown call, or none, as it came.
  assert.deepEqual(withKnownToolCall(request({ toolCallId: 'other' }), entries).toolCall, { toolCallId: 'other' });
  const none = { requestId: 2, toolCall: null, options: [] };
  assert.equal(withKnownToolCall(none, entries), none);
});

test("shows a command's output streamed on its tool call (Codex's terminal _meta)", () => {
  const meta = (value: Record<string, unknown>) => ({ _meta: value });
  const items = buildItems([
    update({
      sessionUpdate: 'tool_call',
      toolCallId: 'cmd',
      title: 'ls',
      kind: 'execute',
      status: 'in_progress',
      content: [{ type: 'terminal', terminalId: 'cmd' }],
      ...meta({ terminal_info: { terminal_id: 'cmd', cwd: '/workspace' } })
    }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'cmd', ...meta({ terminal_output_delta: { terminal_id: 'cmd', data: 'a\n' } }) }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'cmd', ...meta({ terminal_output: { terminal_id: 'cmd', data: 'b\n' } }) }),
    update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'cmd',
      status: 'failed',
      ...meta({ terminal_exit: { terminal_id: 'cmd', exit_code: 2, signal: null } })
    })
  ]);
  const tool = items[0] as Extract<ChatItem, { kind: 'tool' }>;
  assert.equal(tool.output, 'a\nb\n');
  assert.equal(tool.exitCode, 2);
  // The terminal content is the output, not a detail of its own.
  assert.deepEqual(tool.details, []);
});

test('lists the files shown to the user once each, the latest first', () => {
  const show = (files: string[], message?: string): TranscriptEntry => ({ t: '', kind: 'show', files, ...(message ? { message } : {}) });
  assert.deepEqual(
    shownFiles([
      show(['a.png', 'b.csv'], 'First look'),
      { t: '', kind: 'prompt', prompt: [{ type: 'text', text: 'again' }] },
      show(['c.md']),
      show(['a.png'], 'Redrawn')
    ]),
    [
      { path: 'a.png', message: 'Redrawn' },
      { path: 'c.md', message: null },
      { path: 'b.csv', message: 'First look' }
    ]
  );
  assert.deepEqual(shownFiles([]), []);
});

const stamps = (items: ChatItem[]) =>
  items.flatMap((item) => ((item.kind === 'assistant' || item.kind === 'stop') && item.stamp ? [[describe([item])[0], item.stamp]] : []));
const end = (seconds: number, stopReason = 'end_turn'): TranscriptEntry => ({ t: at(seconds), kind: 'turn_end', stopReason: stopReason as 'end_turn' });
const said = (text: string, seconds: number, messageId?: string): TranscriptEntry => ({ ...chunk(text, messageId), t: at(seconds) });

test("stamps the turn's last message with when it ended and how long it ran", () => {
  const items = buildItems([
    prompt('Cluster the data', 10),
    said('Reading it first.', 11, 'm1'),
    tool('a', 'read data.csv'),
    said('Found 3 clusters.', 70, 'm2'),
    end(75)
  ]);
  assert.deepEqual(stamps(items), [['Found 3 clusters.', { at: 75_000, took: 65_000 }]]);
  assert.equal(items.find((item) => item.kind === 'assistant')?.at, 11_000);
});

test('a message sent while the agent worked joins its turn, which both prompts end with', () => {
  const items = buildItems([
    prompt('Refactor the parser', 0),
    tool('a', 'edit parser.ts'),
    prompt('also keep the old API', 180),
    said('Done, the old API stays.', 290),
    end(300),
    prompt('Thanks', 400),
    said('You are welcome.', 401),
    end(402)
  ]);
  assert.deepEqual(
    items.flatMap((item) => (item.kind === 'user' ? [[item.text, item.started, item.ended]] : [])),
    [
      ['Refactor the parser', 0, 300_000],
      ['also keep the old API', 180_000, 300_000],
      ['Thanks', 400_000, 402_000]
    ]
  );
  assert.deepEqual(stamps(items), [
    ['Done, the old API stays.', { at: 300_000, took: 300_000 }],
    ['You are welcome.', { at: 402_000, took: 2_000 }]
  ]);
});

test('a stopped turn stamps its stop, and a turn with no message stamps nothing', () => {
  const stopped = buildItems([prompt('Run it', 0), tool('a', 'sleep 99'), end(9, 'cancelled')]);
  assert.deepEqual(stamps(stopped), [['stop', { at: 9_000, took: 9_000 }]]);
  assert.deepEqual(stamps(buildItems([prompt('Run it', 0), tool('a', 'sleep 1'), end(2)])), []);
});

test("work the agent did on its own, and a page that starts mid-turn, stamp no duration", () => {
  const items = buildItems([
    said('Halfway there.', 5),
    end(6),
    said('The subagents finished.', 50),
    end(51)
  ]);
  assert.deepEqual(stamps(items), [
    ['Halfway there.', { at: 6_000, took: null }],
    ['The subagents finished.', { at: 51_000, took: null }]
  ]);
});

test('the stamp stays on the copy of a message sent twice that shows', () => {
  const items = buildItems([prompt('/context', 0), said('Some long output of the context command here', 1, 'a'), said('Some long output of the context command here', 1, 'b'), end(2)]);
  assert.deepEqual(stamps(items), [['Some long output of the context command here', { at: 2_000, took: 2_000 }]]);
});

test("shows a fork's first message without the earlier chat's history it brought the agent", () => {
  const items = buildItems(
    [
      { t: '', kind: 'prompt', prompt: [{ type: 'text', text: 'make a plot' }] },
      chunk('plot.png'),
      { t: '', kind: 'prompt', prompt: [{ type: 'text', text: '<earlier-chat>…</earlier-chat>', _meta: { [FORK_CONTEXT_META]: true } }, { type: 'text', text: 'now in blue' }] }
    ],
    7
  );
  assert.deepEqual(
    items.map((item) => [item.kind, item.id, item.kind === 'user' ? item.text : '']),
    [['user', '7', 'make a plot'], ['assistant', '8', ''], ['user', '9', 'now in blue']]
  );
});
