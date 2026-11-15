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
import { subagentActive, type SubagentSettings, type SubagentSettingsState, type SubagentSummary } from '../../protocol/subagents.ts';
import type { ChatUsage } from '../../protocol/usage.ts';
import { ChatQueue } from '../../client/chatQueue.ts';
import type { TranscriptPage, WorkerQueue } from '../../client/codeflower.ts';
import type { ChatWorkerQueue } from '../../client/workerConnection.ts';

/** What a chat asks of the sandbox it runs on. */
export interface ChatActions {
  prompt(chat: ChatSession, text: string, action?: ActionPromptMeta): Promise<void>;
  /** Into the turn the agent is working on; false when it did not take it. */
  steer(chat: ChatSession, text: string): Promise<boolean>;
  /** The chat's prompt queue on the worker, when it has one and is connected. */
  workerQueue?(chat: ChatSession): ChatWorkerQueue | undefined;
  shell(chat: ChatSession, command: string): Promise<void>;
  cancelShell(chat: ChatSession, runId: string): void;
  cancel(chat: ChatSession): void;
  setConfig(chat: ChatSession, configId: string, value: string | boolean): Promise<void>;
  setAutoApprove(chat: ChatSession, enabled: boolean): void;
  answerPermission(chat: ChatSession, requestId: number, optionId: string | null): void;
  answerQuestion(chat: ChatSession, requestId: number, action: QuestionAction, content: FormContent | null): void;
  /** The file as a data URL; with `thumbnail`, a small version at most that many pixels high. */
  fileData(chat: ChatSession, path: string, thumbnail?: number): Promise<string | null>;
  /** A page of the chat's entries, those just before `before`. */
  transcriptPage(chat: ChatSession, before: number): Promise<TranscriptPage>;
  openFile(chat: ChatSession, path: string): void;
  signIn(chat: ChatSession): void;
  /** A subagent's chat, or a subagent chat's parent, in a tab of its own. */
  openSubagent(chat: ChatSession, key: string): void;
  openParent(chat: ChatSession): void;
  stopSubagent(chat: ChatSession, key: string): Promise<void>;
  /** A command the chat's agent runs, watched read-only in a tab of its own. */
  openCommand(chat: ChatSession, commandId: string): void;
  /** A shell in the chat's sandbox, in the terminals' panel. */
  /** Shows the chat's browser beside it. */
  openBrowser(chat: ChatSession): void;
  openShell(chat: ChatSession): Promise<void>;
  setSubagentSettings(chat: ChatSession, settings: Partial<SubagentSettings>): Promise<void>;
  restartAgent(chat: ChatSession): Promise<void>;
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
  /** The files the agent showed in this chat (`codeflower-show`), the latest last, each once. */
  shown = $state<string[]>([]);
  /** What the user is writing here, kept while the page shows another chat or view. */
  private draft = '';

  private entries: TranscriptEntry[] = [];
  /** The index of `entries[0]` in the transcript; earlier ones load when the view asks. */
  private start = 0;
  private context: TranscriptEntry[] = [];
  private loadingEarlier = false;
  /** The transcript arrived: until then the view shows it loading, not an empty chat. */
  private transcriptKnown = false;
  private config: SessionConfigOption[] = [];
  private usage: ChatUsage = { session: null, account: null };
  /** The chat's subagents, as the worker reports them. */
  subagents = $state<SubagentSummary[]>([]);
  private subagentSettings: SubagentSettingsState | null = null;
  private notice: Extract<HostMessage, { type: 'notice' }> | null = null;
  private readonly listeners = new Set<(message: HostMessage) => void>();
  /** The prompts that wait for the turn to end: on the worker, or here (chatQueue.ts). */
  private readonly queue = new ChatQueue({
    state: () => this.state,
    prompt: (text, action) => this.actions.prompt(this, text, action),
    steer: (text) => this.actions.steer(this, text),
    cancel: () => this.actions.cancel(this),
    worker: () => this.actions.workerQueue?.(this),
    post: (message) => this.post(message),
    error: (message) => this.notify('error', message)
  });
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

  /** Its agent works on after the turn: a background command or subagent of it runs. */
  get backgroundWork(): boolean {
    return (this.state.background?.length ?? 0) > 0 || this.subagents.some(subagentActive);
  }

  /** The host the chat view talks to. */
  readonly host: ChatHost = {
    send: (message) => void this.handle(message),
    listen: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    draft: { read: () => this.draft, write: (text) => (this.draft = text) }
  };

  /** Sends text to the agent as if typed here; it waits while the agent works. */
  send(text: string): 'sent' | 'queued' {
    return this.queue.send(text);
  }

  /** The chat's prompts queued on the worker changed, or the chat opened here. */
  queueChanged(queue: WorkerQueue): void {
    this.queue.workerChanged(queue);
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
    this.queue.action(action);
  }

  /** Holds live entries until `loaded` shows the transcript they follow. */
  hold(): void {
    this.held ??= [];
  }

  loaded(page: TranscriptPage): void {
    const held = this.held ?? [];
    this.held = undefined;
    this.post({ type: 'transcript', entries: [...page.entries, ...held], start: page.start, context: page.context });
  }

  private async loadEarlier(): Promise<void> {
    const before = this.start;
    if (before === 0 || this.loadingEarlier) return;
    this.loadingEarlier = true;
    try {
      const page = await this.actions.transcriptPage(this, before);
      // A transcript that arrived meanwhile (a reconnect) replaced the one this page goes before.
      if (this.start === before) this.post({ type: 'earlier', entries: page.entries, start: page.start });
    } catch (error) {
      this.notify('error', `Could not load earlier messages: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.loadingEarlier = false;
    }
  }

  post(message: HostMessage): void {
    if (message.type === 'entry' && this.held) {
      this.held.push(message.entry);
      return;
    }
    switch (message.type) {
      case 'transcript':
        this.entries = [...message.entries];
        this.start = message.start ?? 0;
        this.context = message.context ?? [];
        this.transcriptKnown = true;
        // The context has the files shown before the page (from workers that send them), so all list at once.
        this.shown = shownFiles([...this.context, ...this.entries], []);
        break;
      case 'earlier':
        this.entries = [...message.entries, ...this.entries];
        this.start = message.start;
        this.shown = shownFiles([...this.context, ...this.entries], []);
        break;
      case 'entry':
        this.entries.push(message.entry);
        if (message.entry.kind === 'show') this.shown = shownFiles([message.entry], this.shown);
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
      case 'clearNotice':
        this.notice = null;
        break;
      case 'subagents':
        this.subagents = message.subagents;
        break;
      case 'subagentSettings':
        this.subagentSettings = message.state;
        break;
      case 'draft':
        // A shown view adds it to what it has; else it waits here for the next one.
        if (!this.listeners.size) this.draft = this.draft.trim() ? `${this.draft.trimEnd()}\n\n${message.text}` : message.text;
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
    this.queue.flush();
  }

  notify(level: 'info' | 'error', message: string, signIn = false): void {
    this.post({ type: 'notice', level, message, ...(signIn ? { action: { id: 'signIn' as const, label: 'Sign in' } } : {}) });
  }

  private replay(listener: (message: HostMessage) => void): void {
    listener({ type: 'state', state: this.state });
    if (this.transcriptKnown) {
      listener({ type: 'transcript', entries: [...this.entries], start: this.start, context: this.context });
    }
    listener({ type: 'permission', request: this.permission });
    listener({ type: 'question', request: this.question });
    listener({ type: 'config', options: this.config });
    listener({ type: 'usage', usage: this.usage });
    listener(this.queue.message());
    listener({ type: 'subagents', subagents: this.subagents });
    listener({ type: 'subagentSettings', state: this.subagentSettings });
    if (this.notice) listener(this.notice);
  }

  private async handle(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        for (const listener of this.listeners) this.replay(listener);
        break;
      case 'loadEarlier':
        await this.loadEarlier();
        break;
      case 'prompt':
        this.lastUsed = Date.now();
        this.notice = null;
        this.queue.compose(message.text, message.now ?? false);
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
        // The user's queued messages go back to the composer instead of after the stop.
        await this.queue.stop();
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
        this.post({
          type: 'fileData',
          key: message.key,
          dataUrl: await this.actions.fileData(this, message.path, message.thumbnail)
        });
        break;
      case 'openFile':
        this.actions.openFile(this, message.path);
        break;
      case 'action':
        if (message.id === 'signIn') this.actions.signIn(this);
        else this.runAction(message.id);
        break;
      case 'removeQueued':
        this.queue.remove(message.id);
        break;
      case 'sendQueued':
        void this.queue.sendNow(message.id);
        break;
      case 'editQueued':
        await this.queue.edit(message.id);
        break;
      case 'resumeQueue':
        this.queue.resume();
        break;
      case 'openSubagent':
        this.actions.openSubagent(this, message.key);
        break;
      case 'openParent':
        this.actions.openParent(this);
        break;
      case 'stopSubagent':
        await this.failing('Could not stop the subagent', this.actions.stopSubagent(this, message.key));
        break;
      case 'openCommand':
        this.actions.openCommand(this, message.commandId);
        break;
      case 'openShell':
        await this.failing('Could not open a terminal', this.actions.openShell(this));
        break;
      case 'openBrowser':
        this.actions.openBrowser(this);
        break;
      case 'subagentSettings':
        await this.failing('Could not change the subagent settings', this.actions.setSubagentSettings(this, message.settings));
        break;
      case 'restartAgent':
        await this.failing('Could not restart the agent', this.actions.restartAgent(this));
        break;
    }
  }

  private async failing(what: string, work: Promise<void>): Promise<void> {
    try {
      await work;
    } catch (error) {
      this.notify('error', `${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** The files shown in the entries, after those shown before: the latest last, each once. */
export function shownFiles(entries: TranscriptEntry[], before: string[]): string[] {
  const files = [...before];
  for (const entry of entries) {
    if (entry.kind !== 'show') continue;
    for (const file of entry.files) {
      const at = files.indexOf(file);
      if (at >= 0) files.splice(at, 1);
      files.push(file);
    }
  }
  return files;
}
