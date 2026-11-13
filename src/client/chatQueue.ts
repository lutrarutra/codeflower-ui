import type { ActionPromptMeta, ChatAction, HostMessage } from '../protocol/messages.ts';
import type { WorkerQueue } from './codeflower.ts';
import { PromptQueue } from './promptQueue.ts';
import type { ChatWorkerQueue } from './workerConnection.ts';

/** What a chat's host (the extension's panel, the app page's session) gives its queue. */
export interface ChatQueueHost {
  /** The chat as it is now. */
  state(): { busy: boolean; live: boolean; steer?: boolean };
  /** Sends a prompt; resolves when its turn ended. The host reports its errors. */
  prompt(text: string, action?: ActionPromptMeta): Promise<void>;
  /** Into the running turn (ACP steering); false when no turn took it. */
  steer(text: string): Promise<boolean>;
  cancel(): void;
  /** The chat's queue on the worker; undefined while disconnected, or from workers without one. */
  worker(): ChatWorkerQueue | undefined;
  /** To the chat's views: the queue, and a draft back into the composer. */
  post(message: HostMessage): void;
  error(message: string): void;
}

type QueueOptions = { title?: string; editable?: boolean; action?: ActionPromptMeta; replace?: boolean };

/**
 * The prompts that wait for a chat's turn to end: the user's own messages (follow-ups), preview
 * feedback and actions. On a worker that queues them itself they wait there, also while no window is
 * open, and every window shows and changes the same queue; the worker sends them one per turn and
 * pauses after a turn that did not end normally. Otherwise, or while the worker is unreachable, they
 * wait here and this window sends them.
 */
export class ChatQueue {
  private readonly host: ChatQueueHost;
  private readonly local = new PromptQueue();
  /** What the worker last said of its queue for the chat. */
  private remote: WorkerQueue = { items: [] };
  private sending = false;

  constructor(host: ChatQueueHost) {
    this.host = host;
  }

  /** The chat works on a turn, or a prompt is on its way to start one. */
  private get busy(): boolean {
    return this.host.state().busy || this.sending;
  }

  /** The queue as the views show it. */
  message(): Extract<HostMessage, { type: 'queue' }> {
    return {
      type: 'queue',
      items: [...this.remote.items, ...this.local.summaries()],
      ...(this.remote.paused ? { paused: this.remote.paused } : {})
    };
  }

  private publish(): void {
    this.host.post(this.message());
  }

  /** The worker's queue for the chat: when the chat opens here, and on every change. */
  workerChanged(queue: WorkerQueue): void {
    this.remote = { items: queue.items.map(({ id, title, editable }) => ({ id, title, ...(editable ? { editable } : {}) })), ...(queue.paused ? { paused: queue.paused } : {}) };
    this.publish();
  }

  private isRemote(id: string): boolean {
    return this.remote.items.some((item) => item.id === id);
  }

  /** Text sent from elsewhere (e.g. a preview's feedback), as if typed here; it waits while the agent works. */
  send(text: string, title = 'Preview feedback'): 'sent' | 'queued' {
    if (!this.busy) {
      void this.sendPrompt(text);
      return 'sent';
    }
    void this.enqueue(text, { title });
    return 'queued';
  }

  /** A message from the composer: while the agent works it waits for the turn to end, unless sent `now`. */
  compose(text: string, now: boolean): void {
    if (!this.busy) void this.sendPrompt(text);
    else void this.enqueue(text, { editable: true }, now);
  }

  /** A chat action: now, or after the turn; an interrupting one instead of the queue, after stopping the turn. */
  action(action: ChatAction): void {
    const meta = { id: action.id, title: action.title };
    if (!this.busy) {
      void this.sendPrompt(action.prompt, meta);
      return;
    }
    const replace = action.mode === 'interrupt';
    void this.enqueue(action.prompt, { title: action.title, action: meta, replace });
  }

  private async enqueue(text: string, options: QueueOptions, now = false): Promise<void> {
    const worker = this.host.worker();
    if (worker) {
      try {
        if (options.replace) this.dropLocal();
        const id = await worker.add(text, options);
        if (now) await worker.sendNow(id);
        return;
      } catch {
        // The worker could not take it (it went, or predates a method): this window keeps it.
      }
    }
    if (options.replace) {
      this.dropLocal();
      this.local.enqueue(text, options.title ?? text, options.action);
      this.publish();
      this.host.cancel();
      return;
    }
    const item = options.editable ? this.local.enqueueMessage(text) : this.local.enqueue(text, options.title ?? text, options.action);
    if (now) await this.sendNow(item.id);
    else this.publish();
  }

  private dropLocal(): void {
    while (this.local.take());
  }

  private async sendPrompt(text: string, action?: ActionPromptMeta): Promise<void> {
    this.sending = true;
    try {
      await this.host.prompt(text, action);
    } finally {
      this.sending = false;
      this.flush();
    }
  }

  /** The chat's state changed: a prompt this window keeps goes once the chat is live and idle. */
  flush(): void {
    if (this.busy || !this.host.state().live || !this.local.length) return;
    const next = this.local.take();
    this.publish();
    if (next) void this.sendPrompt(next.text, next.action);
  }

  /**
   * A queued prompt, now: into the turn where the agent takes messages while it works, otherwise
   * first in the queue, and the turn stops so it goes next.
   */
  async sendNow(id: string): Promise<void> {
    if (this.isRemote(id)) {
      await this.host.worker()?.sendNow(id).catch((error: unknown) => this.host.error(`Could not send the message: ${messageOf(error)}`));
      return;
    }
    const item = this.local.take(id);
    if (!item) return;
    // A command or an action is a prompt of its own.
    if (this.host.state().steer && item.editable && !item.text.trimStart().startsWith('/')) {
      this.publish();
      // A message the turn could not take is sent another way; no notice for it.
      if (await this.host.steer(item.text).catch(() => false)) return;
    }
    this.local.putFirst(item);
    this.publish();
    if (this.busy) this.host.cancel();
    else this.flush();
  }

  remove(id: string): void {
    if (this.isRemote(id)) {
      void this.host.worker()?.remove(id).catch((error: unknown) => this.host.error(`Could not remove the message: ${messageOf(error)}`));
    } else if (this.local.remove(id)) {
      this.publish();
    }
  }

  /** Back into the composer, to edit. */
  async edit(id: string): Promise<void> {
    if (this.isRemote(id)) {
      const worker = this.host.worker();
      if (!worker) return;
      try {
        const [item] = await worker.take({ id });
        if (item) this.host.post({ type: 'draft', text: item.text });
      } catch (error) {
        this.host.error(`Could not take the message back: ${messageOf(error)}`);
      }
      return;
    }
    const item = this.local.take(id);
    if (!item) return;
    this.publish();
    this.host.post({ type: 'draft', text: item.text });
  }

  /**
   * Stop: the user's queued messages go back to the composer instead of after the stop. The others
   * wait: here they go after the stop, on the worker it pauses them.
   */
  async stop(): Promise<void> {
    const worker = this.host.worker();
    // Asked before the cancel goes, on the same connection, so the worker hands them back first.
    const taking = worker && this.remote.items.some((item) => item.editable) ? worker.take({ editable: true }).catch(() => []) : undefined;
    const local = this.local.takeMessages();
    if (local.length) this.publish();
    this.host.cancel();
    const texts = [...(taking ? await taking : []).map((item) => item.text), ...local.map((item) => item.text)];
    if (texts.length) this.host.post({ type: 'draft', text: texts.join('\n\n') });
  }

  /** Go on with a queue the worker paused. */
  resume(): void {
    void this.host.worker()?.resume().catch((error: unknown) => this.host.error(`Could not resume the queue: ${messageOf(error)}`));
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
