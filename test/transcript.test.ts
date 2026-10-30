import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { TranscriptEntry } from '../src/protocol/messages.ts';
import { buildItems } from '../src/chat/lib/transcript.ts';

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
  assert.deepEqual(action, [{ kind: 'action', id: '0', title: 'Checkpoint', text: 'Make a checkpoint.' }]);
  assert.deepEqual(plain, [{ kind: 'user', id: '0', text: 'Make a checkpoint.' }]);
});
