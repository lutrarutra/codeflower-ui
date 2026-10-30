import assert from 'node:assert/strict';
import test from 'node:test';
import type { HostMessage } from '../src/protocol/messages.ts';
import type { ChatActions } from '../src/web/lib/chatSession.svelte.ts';

Reflect.set(globalThis, '$state', <T>(value: T) => value);
const { ChatSession } = await import('../src/web/lib/chatSession.svelte.ts');

const checkpoint = {
  id: 'checkpoint',
  title: 'Checkpoint',
  description: 'Save progress',
  icon: 'save',
  mode: 'queue' as const,
  prompt: 'Save progress.'
};
const wrapUp = {
  id: 'wrap-up',
  title: 'Wrap up',
  description: 'Preserve progress',
  icon: 'debug-stop',
  mode: 'interrupt' as const,
  prompt: 'Wrap up now.'
};

function actions(
  prompt: ChatActions['prompt'],
  cancel: ChatActions['cancel'] = () => {},
  setAutoApprove: ChatActions['setAutoApprove'] = () => {}
): ChatActions {
  return {
    prompt,
    shell: async () => {},
    cancelShell: () => {},
    cancel,
    setConfig: async () => {},
    setAutoApprove,
    answerPermission: () => {},
    answerQuestion: () => {},
    fileData: async () => null,
    openFile: () => {},
    signIn: () => {}
  };
}

test('enables DSH auto-approval by default and lets the user turn it off', () => {
  const choices: boolean[] = [];
  const chat = new ChatSession(
    'worker',
    'session',
    { agent: { id: 'dsh' } },
    actions(async () => {}, () => {}, (_chat, enabled) => choices.push(enabled))
  );

  assert.equal(chat.state.autoApprove, true);
  assert.deepEqual(choices, [true]);
  chat.host.send({ type: 'setAutoApprove', enabled: false });
  assert.equal(chat.state.autoApprove, false);
  assert.deepEqual(choices, [true, false]);
});

test('sends queued actions one at a time with their action metadata', async () => {
  const sent: { text: string; action?: { id: string; title: string } }[] = [];
  let finishFirst: (() => void) | undefined;
  const prompt: ChatActions['prompt'] = async (_chat, text, action) => {
    sent.push({ text, action });
    if (text === checkpoint.prompt) await new Promise<void>((resolve) => (finishFirst = resolve));
  };
  const chat = new ChatSession(
    'worker',
    'session',
    { live: true, busy: true, actions: [checkpoint, wrapUp] },
    actions(prompt)
  );
  const messages: HostMessage[] = [];
  chat.host.listen((message) => messages.push(message));
  chat.host.send({ type: 'action', id: 'checkpoint' });
  chat.host.send({ type: 'action', id: 'checkpoint' });

  const queued = messages.filter((message) => message.type === 'queue').at(-1);
  assert.deepEqual(queued, {
    type: 'queue',
    items: [
      { id: 'queued-1', title: 'Checkpoint' },
      { id: 'queued-2', title: 'Checkpoint' }
    ]
  });

  chat.setState({ busy: false });
  assert.deepEqual(sent, [{ text: checkpoint.prompt, action: { id: 'checkpoint', title: 'Checkpoint' } }]);
  finishFirst!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, [
    { text: checkpoint.prompt, action: { id: 'checkpoint', title: 'Checkpoint' } },
    { text: checkpoint.prompt, action: { id: 'checkpoint', title: 'Checkpoint' } }
  ]);
});

test('wrap up replaces queued work, cancels the turn, and sends after it ends', async () => {
  const sent: string[] = [];
  let cancelled = 0;
  const chat = new ChatSession(
    'worker',
    'session',
    { live: true, busy: true, actions: [checkpoint, wrapUp] },
    actions(async (_chat, text) => void sent.push(text), () => cancelled++)
  );
  const messages: HostMessage[] = [];
  chat.host.listen((message) => messages.push(message));
  chat.host.send({ type: 'action', id: 'checkpoint' });
  chat.host.send({ type: 'action', id: 'wrap-up' });

  assert.equal(cancelled, 1);
  assert.deepEqual(messages.filter((message) => message.type === 'queue').at(-1), {
    type: 'queue',
    items: [{ id: 'queued-2', title: 'Wrap up' }]
  });
  assert.deepEqual(sent, []);

  chat.setState({ busy: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, ['Wrap up now.']);
});
