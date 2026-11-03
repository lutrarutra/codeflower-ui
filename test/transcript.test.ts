import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionUpdate, ToolCallUpdate } from '@agentclientprotocol/sdk';
import type { TranscriptEntry } from '../src/protocol/messages.ts';
import { activity, buildItems, foldTurns, withKnownToolCall, type ChatItem, type Turn, type TurnPart } from '../src/chat/lib/transcript.ts';

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
