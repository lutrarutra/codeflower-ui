import assert from 'node:assert/strict';
import test from 'node:test';
import type { HostMessage } from '../src/protocol/messages.ts';
import type { ChatActions } from '../src/web/lib/chatSession.svelte.ts';
import type { ChatWorkerQueue } from '../src/client/workerConnection.ts';

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
  setAutoApprove: ChatActions['setAutoApprove'] = () => {},
  steer: ChatActions['steer'] = async () => false
): ChatActions {
  return {
    prompt,
    steer,
    shell: async () => {},
    cancelShell: () => {},
    cancel,
    setConfig: async () => {},
    setAutoApprove,
    answerPermission: () => {},
    answerQuestion: () => {},
    fileData: async () => null,
    transcriptPage: async () => ({ entries: [], start: 0, context: [] }),
    openFile: () => {},
    signIn: () => {},
    takeOver: () => {},
    openSubagent: () => {},
    openParent: () => {},
    stopSubagent: async () => {},
    openCommand: () => {},
    cancelJob: async () => {},
    stopWatch: async () => {},
    checkWatch: async () => {},
    openShell: async () => {},
    openBrowser: () => {},
    openRoots: () => {},
    setSubagentSettings: async () => {},
    restartAgent: async () => {},
    listChats: async () => {},
    openChat: () => {},
    newChat: async () => {},
    forkChat: async () => {},
    createOrchestrator: async () => {},
    setOrchestratorAccess: async () => {},
    disconnectOrchestrator: async () => {},
    shareWithOrchestrator: async () => {}
  };
}

test('loads earlier entries when the view asks, and replays them with the rest', async () => {
  const t = '2026-11-02T10:00:00.000Z';
  const prompt = (text: string) => ({ t, kind: 'prompt' as const, prompt: [{ type: 'text' as const, text }] });
  const asked: number[] = [];
  const chat = new ChatSession('worker', 'session', {}, {
    ...actions(async () => {}),
    transcriptPage: async (_chat, before) => {
      asked.push(before);
      return { entries: [prompt('first'), prompt('second')], start: 0, context: [] };
    }
  });
  const posted: HostMessage[] = [];
  chat.host.listen((message) => posted.push(message));
  chat.loaded({ entries: [prompt('third')], start: 2, context: [] });
  chat.host.send({ type: 'loadEarlier' });
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual(asked, [2]);
  assert.deepEqual(posted.at(-1), { type: 'earlier', entries: [prompt('first'), prompt('second')], start: 0 });
  // Nothing is left before the first entry.
  chat.host.send({ type: 'loadEarlier' });
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual(asked, [2]);
  posted.length = 0;
  chat.host.send({ type: 'ready' });
  const transcript = posted.find((message) => message.type === 'transcript');
  assert.deepEqual(transcript, { type: 'transcript', entries: [prompt('first'), prompt('second'), prompt('third')], start: 0, context: [] });
});

test("lists the files shown before the loaded page, from the page's context", async () => {
  const t = '2026-11-02T10:00:00.000Z';
  const prompt = (text: string) => ({ t, kind: 'prompt' as const, prompt: [{ type: 'text' as const, text }] });
  const early = { t, kind: 'show' as const, files: ['/workspace/early.png', '/workspace/report.html'] };
  const again = { t, kind: 'show' as const, files: ['/workspace/early.png'] };
  const chat = new ChatSession('worker', 'session', {}, {
    ...actions(async () => {}),
    transcriptPage: async () => ({ entries: [early, prompt('first')], start: 0, context: [] })
  });
  chat.loaded({ entries: [prompt('second'), again], start: 2, context: [early] });
  assert.deepEqual(chat.shown, ['/workspace/report.html', '/workspace/early.png']);
  // The earlier page brings the same entry again: each file once, the latest last.
  chat.host.send({ type: 'loadEarlier' });
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual(chat.shown, ['/workspace/report.html', '/workspace/early.png']);
});

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

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const lastOf = <T extends HostMessage['type']>(messages: HostMessage[], type: T) =>
  messages.filter((message): message is Extract<HostMessage, { type: T }> => message.type === type).at(-1);

test('stacks follow-ups while the agent works and sends them one per turn', async () => {
  const sent: string[] = [];
  const turns: (() => void)[] = [];
  const prompt: ChatActions['prompt'] = (_chat, text) => {
    sent.push(text);
    return new Promise<void>((resolve) => turns.push(resolve));
  };
  const chat = new ChatSession('worker', 'session', { live: true, busy: true }, actions(prompt));
  const messages: HostMessage[] = [];
  chat.host.listen((message) => messages.push(message));
  chat.host.send({ type: 'prompt', text: 'first' });
  chat.host.send({ type: 'prompt', text: 'second' });
  assert.deepEqual(lastOf(messages, 'queue')?.items, [
    { id: 'queued-1', title: 'first', editable: true },
    { id: 'queued-2', title: 'second', editable: true }
  ]);
  assert.deepEqual(sent, []);

  chat.setState({ busy: false });
  assert.deepEqual(sent, ['first']);
  turns.shift()!();
  await settle();
  assert.deepEqual(sent, ['first', 'second']);
  assert.deepEqual(lastOf(messages, 'queue')?.items, []);
});

test('sends a message now into the turn when the agent takes it', async () => {
  const steered: string[] = [];
  let cancelled = 0;
  const chat = new ChatSession(
    'worker',
    'session',
    { live: true, busy: true, steer: true },
    actions(async () => {}, () => cancelled++, () => {}, async (_chat, text) => (steered.push(text), true))
  );
  const messages: HostMessage[] = [];
  chat.host.listen((message) => messages.push(message));
  chat.host.send({ type: 'prompt', text: 'later' });
  chat.host.send({ type: 'prompt', text: 'look at this too', now: true });
  await settle();
  assert.deepEqual(steered, ['look at this too']);
  assert.equal(cancelled, 0);
  // A queued one can go now too.
  chat.host.send({ type: 'sendQueued', id: 'queued-1' });
  await settle();
  assert.deepEqual(steered, ['look at this too', 'later']);
  assert.deepEqual(lastOf(messages, 'queue')?.items, []);
});

test('without steering, sending now stops the turn and sends the message next', async () => {
  const sent: string[] = [];
  let cancelled = 0;
  const chat = new ChatSession(
    'worker',
    'session',
    { live: true, busy: true, steer: false },
    actions(async (_chat, text) => void sent.push(text), () => cancelled++)
  );
  const messages: HostMessage[] = [];
  chat.host.listen((message) => messages.push(message));
  chat.host.send({ type: 'prompt', text: 'queued' });
  chat.host.send({ type: 'prompt', text: 'urgent', now: true });
  await settle();
  assert.equal(cancelled, 1);
  assert.deepEqual(lastOf(messages, 'queue')?.items.map((item) => item.title), ['urgent', 'queued']);

  chat.setState({ busy: false });
  await settle();
  assert.deepEqual(sent, ['urgent', 'queued']);
});

test('a queued message goes back to the composer to edit, and all of them on stop', () => {
  let cancelled = 0;
  const chat = new ChatSession('worker', 'session', { live: true, busy: true, actions: [checkpoint] }, actions(async () => {}, () => cancelled++));
  const messages: HostMessage[] = [];
  chat.host.listen((message) => messages.push(message));
  chat.host.send({ type: 'prompt', text: 'one' });
  chat.host.send({ type: 'action', id: 'checkpoint' });
  chat.host.send({ type: 'prompt', text: 'two' });
  chat.host.send({ type: 'prompt', text: 'three' });

  chat.host.send({ type: 'editQueued', id: 'queued-1' });
  assert.deepEqual(lastOf(messages, 'draft'), { type: 'draft', text: 'one' });

  chat.host.send({ type: 'cancel' });
  assert.equal(cancelled, 1);
  assert.deepEqual(lastOf(messages, 'draft'), { type: 'draft', text: 'two\n\nthree' });
  // Actions stay queued: the user did not write them.
  assert.deepEqual(lastOf(messages, 'queue')?.items, [{ id: 'queued-2', title: 'Checkpoint' }]);
});

/** A worker queue that records what the chat asks of it. */
function workerQueue(options: { failAdd?: boolean } = {}) {
  const calls: unknown[][] = [];
  let next = 1;
  const queue: ChatWorkerQueue = {
    add: async (text, add = {}) => {
      calls.push(['add', text, add]);
      if (options.failAdd) throw new Error('The sandbox is not connected');
      return `q-${next++}`;
    },
    remove: async (id) => void calls.push(['remove', id]),
    take: async (which) => {
      calls.push(['take', which]);
      return 'id' in which
        ? [{ id: which.id, title: 'edit me', text: 'edit me', prompt: [] }]
        : [{ id: 'q-3', title: 'mine', text: 'mine', prompt: [], editable: true }];
    },
    sendNow: async (id) => void calls.push(['sendNow', id]),
    resume: async () => void calls.push(['resume']),
    together: async (together) => void calls.push(['together', together])
  };
  return { queue, calls };
}

test('on a worker with a queue, prompts wait there and every change goes through it', async () => {
  const worker = workerQueue();
  const order: string[] = [];
  const chat = new ChatSession('worker', 'session', { live: true, busy: true, actions: [checkpoint, wrapUp] }, {
    ...actions(async () => {}, () => order.push('cancel')),
    workerQueue: () => worker.queue
  });
  const messages: HostMessage[] = [];
  chat.host.listen((message) => messages.push(message));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  chat.host.send({ type: 'prompt', text: 'one' });
  chat.host.send({ type: 'prompt', text: 'now', now: true });
  chat.host.send({ type: 'action', id: 'checkpoint' });
  chat.host.send({ type: 'action', id: 'wrap-up' });
  assert.equal(chat.send('looks off'), 'queued');
  await tick();
  assert.deepEqual(worker.calls, [
    ['add', 'one', { editable: true }],
    ['add', 'now', { editable: true }],
    ['add', 'Save progress.', { title: 'Checkpoint', action: { id: 'checkpoint', title: 'Checkpoint' }, replace: false }],
    // An interrupting action: the worker stops the turn, not the window.
    ['add', 'Wrap up now.', { title: 'Wrap up', action: { id: 'wrap-up', title: 'Wrap up' }, replace: true }],
    ['add', 'looks off', { title: 'Preview feedback' }],
    ['sendNow', 'q-2']
  ]);
  assert.equal(order.length, 0);
  // Nothing waits here: the views show what the worker says, paused too.
  assert.equal(lastOf(messages, 'queue'), undefined);
  chat.queueChanged({ items: [{ id: 'q-1', title: 'one', editable: true }, { id: 'q-4', title: 'Wrap up' }], paused: { stopReason: 'refusal' } });
  assert.deepEqual(lastOf(messages, 'queue'), {
    type: 'queue',
    items: [{ id: 'q-1', title: 'one', editable: true }, { id: 'q-4', title: 'Wrap up' }],
    paused: { stopReason: 'refusal' }
  });

  worker.calls.length = 0;
  chat.host.send({ type: 'editQueued', id: 'q-1' });
  await tick();
  assert.deepEqual(lastOf(messages, 'draft'), { type: 'draft', text: 'edit me' });
  chat.host.send({ type: 'sendQueued', id: 'q-4' });
  chat.host.send({ type: 'removeQueued', id: 'q-4' });
  chat.host.send({ type: 'resumeQueue' });
  chat.host.send({ type: 'queueTogether', together: true });
  await tick();
  assert.deepEqual(worker.calls, [['take', { id: 'q-1' }], ['sendNow', 'q-4'], ['remove', 'q-4'], ['resume'], ['together', true]]);
  // The views show the worker's choice.
  chat.queueChanged({ items: [{ id: 'q-1', title: 'one', editable: true }, { id: 'q-4', title: 'Wrap up' }], together: true });
  assert.equal(lastOf(messages, 'queue')?.together, true);

  // Stop: the worker hands the user's own back before the cancel reaches it.
  worker.calls.length = 0;
  chat.queueChanged({ items: [{ id: 'q-3', title: 'mine', editable: true }] });
  const take = worker.queue.take;
  worker.queue.take = (which) => {
    order.push('take');
    return take(which);
  };
  chat.host.send({ type: 'cancel' });
  await tick();
  assert.deepEqual(order, ['take', 'cancel']);
  assert.deepEqual(lastOf(messages, 'draft'), { type: 'draft', text: 'mine' });
});

test('in the window, together sends the queued messages as one, and a second message resets it', () => {
  const sent: string[] = [];
  const chat = new ChatSession('worker', 'session', { live: true, busy: true }, actions(async (_chat, text) => void sent.push(text)));
  const messages: HostMessage[] = [];
  chat.host.listen((message) => messages.push(message));
  chat.host.send({ type: 'prompt', text: 'one' });
  chat.host.send({ type: 'queueTogether', together: true });
  chat.host.send({ type: 'prompt', text: 'two' });
  assert.equal(lastOf(messages, 'queue')?.together, undefined);
  chat.host.send({ type: 'queueTogether', together: true });
  chat.host.send({ type: 'prompt', text: 'three' });
  assert.equal(lastOf(messages, 'queue')?.together, true);
  chat.setState({ busy: false });
  assert.deepEqual(sent, ['one\n\ntwo\n\nthree']);
  assert.deepEqual(lastOf(messages, 'queue'), { type: 'queue', items: [] });
});

test('a prompt the worker could not take waits in the window', async () => {
  const worker = workerQueue({ failAdd: true });
  const sent: string[] = [];
  const chat = new ChatSession('worker', 'session', { live: true, busy: true }, {
    ...actions(async (_chat, text) => void sent.push(text)),
    workerQueue: () => worker.queue
  });
  const messages: HostMessage[] = [];
  chat.host.listen((message) => messages.push(message));
  chat.host.send({ type: 'prompt', text: 'one' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(lastOf(messages, 'queue')?.items, [{ id: 'queued-1', title: 'one', editable: true }]);
  chat.setState({ busy: false });
  assert.deepEqual(sent, ['one']);
});
