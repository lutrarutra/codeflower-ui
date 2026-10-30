// One open chat on the page: what its view shows (kept while another chat is
// in front, and replayed when the view mounts again), and the host the shared
// chat view talks to.
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import type { ChatHost } from '../../chat/lib/host.ts';
import {
  type ActionPromptMeta,
  sessionStatus,
  type ChatState,
  type FormContent,
  type HostMessage,
  type PendingPermission,
  type PendingQuestion,
  type QuestionAction,
  type SessionStatus,
  type TranscriptEntry,
  type WebviewMessage
} from '../../protocol/messages.ts';
import type { ChatUsage } from '../../protocol/usage.ts';
import { PromptQueue } from '../../client/promptQueue.ts';

/** What a chat asks of the sandbox it runs on. */
export interface ChatActions {
  prompt(chat: ChatSession, text: string, action?: ActionPromptMeta): Promise<void>;
  shell(chat: ChatSession, command: string): Promise<void>;
  cancelShell(chat: ChatSession, runId: string): void;
  cancel(chat: ChatSession): void;
  setConfig(chat: ChatSession, configId: string, value: string | boolean): Promise<void>;
  setAutoApprove(chat: ChatSession, enabled: boolean): void;
  answerPermission(chat: ChatSession, requestId: number, optionId: string | null): void;
  answerQuestion(chat: ChatSession, requestId: number, action: QuestionAction, content: FormContent | null): void;
  fileData(chat: ChatSession, path: string): Promise<string | null>;
  openFile(chat: ChatSession, path: string): void;
  signIn(chat: ChatSession): void;
}

export class ChatSession {
  readonly workerId: string;
  key: string;
  state = $state<ChatState>({ title: '', subtitle: '', live: false, busy: false });
  permission = $state<PendingPermission | null>(null);
  question = $state<PendingQuestion | null>(null);
  /** When the user last wrote here; feedback from previews goes to the latest. */
  lastUsed = Date.now();
  /** The user's `!commands` running now; files they show belong to this chat. */
  shellsRunning = 0;

  private entries: TranscriptEntry[] = [];
  private config: SessionConfigOption[] = [];
  private usage: ChatUsage = { session: null, account: null };
  private notice: Extract<HostMessage, { type: 'notice' }> | null = null;
  private readonly listeners = new Set<(message: HostMessage) => void>();
  /** Messages sent from elsewhere (e.g. a preview's feedback) while the agent was busy. */
  private readonly waiting = new PromptQueue();
  private sending = false;
  /** Live entries that arrive while the transcript loads; they follow it. */
  private held: TranscriptEntry[] | undefined;
  private readonly actions: ChatActions;

  constructor(workerId: string, key: string, state: Partial<ChatState>, actions: ChatActions) {
    this.workerId = workerId;
    this.key = key;
    this.state = { ...this.state, ...state };
    this.actions = actions;
    if (this.state.agent?.id === 'dsh') this.state.autoApprove ??= true;
    if (this.state.agent?.id === 'dsh' && this.state.autoApprove !== undefined) {
      this.actions.setAutoApprove(this, this.state.autoApprove);
    }
  }

  get status(): SessionStatus {
    return sessionStatus(this.state, this.permission !== null || this.question !== null);
  }

  /** The host the chat view talks to. */
  readonly host: ChatHost = {
    send: (message) => void this.handle(message),
    listen: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  };

  /** Sends text to the agent as if typed here; it waits while the agent works. */
  send(text: string): 'sent' | 'queued' {
    if (this.state.busy || this.sending) {
      this.waiting.enqueue(text, 'Preview feedback');
      this.publishQueue();
      return 'queued';
    }
    void this.sendPrompt(text);
    return 'sent';
  }

  private async sendPrompt(text: string, action?: ActionPromptMeta): Promise<void> {
    this.sending = true;
    try {
      await this.actions.prompt(this, text, action);
    } finally {
      this.sending = false;
      this.flushWaiting();
    }
  }

  private publishQueue(): void {
    this.post({ type: 'queue', items: this.waiting.summaries() });
  }

  private flushWaiting(): void {
    if (this.state.busy || !this.state.live || this.sending) return;
    const next = this.waiting.take();
    this.publishQueue();
    if (next) void this.sendPrompt(next.text, next.action);
  }

  private runAction(id: string): void {
    if (!this.state.live) {
      this.notify('info', 'This session is read-only here.');
      return;
    }
    const action = this.state.actions?.find((candidate) => candidate.id === id);
    if (!action) {
      this.notify('error', 'This action is unavailable on this worker. Reconnect to an updated sandbox.');
      return;
    }
    const meta = { id: action.id, title: action.title };
    if (this.state.busy || this.sending) {
      if (action.mode === 'interrupt') {
        this.waiting.replace(action.prompt, action.title, meta);
        this.publishQueue();
        this.actions.cancel(this);
      } else {
        this.waiting.enqueue(action.prompt, action.title, meta);
        this.publishQueue();
      }
      return;
    }
    void this.sendPrompt(action.prompt, meta);
  }

  /** Holds live entries until `loaded` shows the transcript they follow. */
  hold(): void {
    this.held ??= [];
  }

  loaded(entries: TranscriptEntry[]): void {
    const held = this.held ?? [];
    this.held = undefined;
    this.post({ type: 'transcript', entries: [...entries, ...held] });
  }

  post(message: HostMessage): void {
    if (message.type === 'entry' && this.held) {
      this.held.push(message.entry);
      return;
    }
    switch (message.type) {
      case 'transcript':
        this.entries = [...message.entries];
        break;
      case 'entry':
        this.entries.push(message.entry);
        break;
      case 'permission':
        this.permission = message.request;
        break;
      case 'question':
        this.question = message.request;
        break;
      case 'config':
        this.config = message.options;
        break;
      case 'usage':
        this.usage = message.usage;
        break;
      case 'notice':
        this.notice = message;
        break;
    }
    for (const listener of this.listeners) listener(message);
  }

  setState(update: Partial<ChatState>): void {
    this.state = { ...this.state, ...update };
    if (this.state.agent?.id === 'dsh') this.state.autoApprove ??= true;
    else this.state.autoApprove = undefined;
    if (this.state.agent?.id === 'dsh' && this.state.autoApprove !== undefined) {
      this.actions.setAutoApprove(this, this.state.autoApprove);
    }
    this.post({ type: 'state', state: this.state });
    this.flushWaiting();
  }

  notify(level: 'info' | 'error', message: string, signIn = false): void {
    this.post({ type: 'notice', level, message, ...(signIn ? { action: { id: 'signIn' as const, label: 'Sign in' } } : {}) });
  }

  private replay(listener: (message: HostMessage) => void): void {
    listener({ type: 'state', state: this.state });
    listener({ type: 'transcript', entries: [...this.entries] });
    listener({ type: 'permission', request: this.permission });
    listener({ type: 'question', request: this.question });
    listener({ type: 'config', options: this.config });
    listener({ type: 'usage', usage: this.usage });
    listener({ type: 'queue', items: this.waiting.summaries() });
    if (this.notice) listener(this.notice);
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        for (const listener of this.listeners) this.replay(listener);
        break;
      case 'prompt':
        this.lastUsed = Date.now();
        this.notice = null;
        await this.sendPrompt(message.text);
        break;
      case 'shell':
        this.lastUsed = Date.now();
        this.shellsRunning++;
        try {
          await this.actions.shell(this, message.command);
        } finally {
          this.shellsRunning--;
        }
        break;
      case 'cancelShell':
        this.actions.cancelShell(this, message.runId);
        break;
      case 'cancel':
        this.actions.cancel(this);
        break;
      case 'setConfig':
        await this.actions.setConfig(this, message.configId, message.value);
        break;
      case 'setAutoApprove':
        if (this.state.agent?.id === 'dsh') this.setState({ autoApprove: message.enabled });
        break;
      case 'permissionResponse':
        this.actions.answerPermission(this, message.requestId, message.optionId);
        break;
      case 'questionResponse':
        this.actions.answerQuestion(this, message.requestId, message.action, message.content);
        break;
      case 'fileData':
        this.post({ type: 'fileData', key: message.key, dataUrl: await this.actions.fileData(this, message.path) });
        break;
      case 'openFile':
        this.actions.openFile(this, message.path);
        break;
      case 'action':
        if (message.id === 'signIn') this.actions.signIn(this);
        else this.runAction(message.id);
        break;
      case 'removeQueued':
        if (this.waiting.remove(message.id)) this.publishQueue();
        break;
    }
  }
}
