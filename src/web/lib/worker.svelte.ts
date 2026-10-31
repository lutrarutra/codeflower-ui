// One sandbox's agent, reached through the app's relay, and the chats open on
// it. The connection opens only when a chat or the files of the sandbox are
// opened. A current bridge serves several windows at once (e.g. this page and
// VS Code); an older one serves one at a time, and connecting takes the
// sandbox over from another.
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import {
  agentPresentation,
  type ChatAction,
  type ChatState,
  type PendingPermission,
  type PendingQuestion,
  type TranscriptEntry
} from '../../protocol/messages.ts';
import type { ChatUsage, WorkerUsage } from '../../protocol/usage.ts';
import { webSocketTransport } from '../../client/transport.ts';
import {
  isAuthRequired,
  isConnectionClosed,
  RpcError,
  TAKEN_OVER,
  WorkerConnection,
  type SessionRecord,
  type ShowRequest,
  type UrlElicitation,
  type WorkerStatus,
  type WrapUpNotice
} from '../../client/workerConnection.ts';
import { api } from './api.ts';
import { ChatSession, type ChatActions } from './chatSession.svelte.ts';

const RECONNECT_MS = 10_000;
const LEASE_CONFLICT = -32010;
const CLIENT = { name: 'codeflower-app', title: 'code flower', version: '1' };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'taken-over';

/** What the page asks of a sandbox beyond its chats: previews, sign-in, notices. */
export interface WorkerEvents {
  show(worker: WebWorker, request: ShowRequest): void;
  openFile(worker: WebWorker, chat: ChatSession, path: string): void;
  signIn(worker: WebWorker): void;
  elicitUrl(worker: WebWorker, request: UrlElicitation): Promise<'accept' | 'decline'>;
  elicitationComplete(worker: WebWorker, elicitationId: string): void;
  terminalOutput(terminalId: string, data: string): void;
  terminalExit(terminalId: string, exitCode: number): void;
  wrapUp(worker: WebWorker, notice: WrapUpNotice): void;
}

export class WebWorker {
  readonly id: string;
  /** Where it runs, as the chat's header says: its project, or its address. */
  place = '';
  state = $state<ConnectionState>('idle');
  error = $state('');
  status = $state<WorkerStatus | undefined>();
  sessions = $state<SessionRecord[]>([]);
  /** The chats were listed (or cannot be): until then the page shows them loading. */
  sessionsKnown = $state(false);
  usage = $state<WorkerUsage | undefined>();
  private availableActions: ChatAction[] | undefined;
  /** Open chats, by key. */
  chats = $state<Record<string, ChatSession>>({});
  connection: WorkerConnection | undefined;

  private readonly events: WorkerEvents;
  private connecting: Promise<void> | undefined;
  /** Counts connections, so a late close of an old one changes nothing. */
  private generation = 0;
  private retry: ReturnType<typeof setInterval> | undefined;
  /** The user's last mode per agent, for new chats. */
  private static readonly MODES = 'codeflower.modes';

  constructor(id: string, events: WorkerEvents) {
    this.id = id;
    this.events = events;
  }

  get connected(): boolean {
    return this.state === 'connected' && !!this.connection?.connected;
  }

  /**
   * The chats, from the agent once connected, else as the app lists them without connecting.
   * False when the app cannot list them (an older sandbox lists its chats only once connected).
   */
  async listSessions(): Promise<boolean> {
    if (this.connected) {
      this.sessions = await this.connection!.listSessions();
      this.sessionsKnown = true;
      return true;
    }
    try {
      this.sessions = (await api<{ sessions: SessionRecord[] }>(`/api/workers/${encodeURIComponent(this.id)}/sessions`)).sessions;
      this.sessionsKnown = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Connects, unless connected or connecting already. */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    this.connecting ??= this.establish().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async establish(): Promise<void> {
    this.state = 'connecting';
    this.error = '';
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/workers/${encodeURIComponent(this.id)}/acp`;
    let connection: WorkerConnection | undefined;
    try {
      connection = await WorkerConnection.connect(await webSocketTransport(url), this.handlers(++this.generation), CLIENT);
      const actions = await connection.actions();
      this.connection = connection;
      this.availableActions = actions;
      this.state = 'connected';
      this.stopRetrying();
      await this.refresh();
      // Chats opened while connecting learn which agent they talk to; a notice about the lost connection goes.
      for (const chat of Object.values(this.chats)) {
        chat.setState({ ...this.presentation(), actions });
        chat.post({ type: 'clearNotice' });
      }
      const usage = await connection.usage().catch(() => undefined);
      if (usage && this.connection === connection) this.setUsage(usage);
      // Open chats attach again and show what happened meanwhile.
      await Promise.all(Object.values(this.chats).map((chat) => this.attach(chat).catch((error) => this.report(chat, error))));
    } catch (error) {
      connection?.close();
      if (this.connection === connection) this.connection = undefined;
      this.state = 'disconnected';
      this.error = describe(error);
      this.retryLater();
      throw error;
    }
  }

  /** Takes the sandbox back from another window. */
  async takeBack(): Promise<void> {
    this.state = 'disconnected';
    await this.connect();
  }

  /** Connects to a fresh agent, e.g. after the sandbox restarted it. */
  async reconnect(): Promise<void> {
    this.close();
    await this.connect();
  }

  /** The agent signed in: chats that could not attach try again, and say so. */
  async afterSignIn(message: string): Promise<void> {
    await this.refresh();
    await Promise.all(
      Object.values(this.chats).map(async (chat) => {
        if (!chat.state.live && this.connected) await this.attach(chat).catch((error) => this.report(chat, error));
        // A chat that still cannot attach keeps its notice saying why.
        if (chat.state.live) chat.notify('info', message);
      })
    );
  }

  close(): void {
    this.generation++;
    this.stopRetrying();
    const connection = this.connection;
    this.connection = undefined;
    connection?.close();
    this.state = 'idle';
  }

  async refresh(): Promise<void> {
    if (!this.connected) return;
    try {
      const [status, sessions] = await Promise.all([this.connection!.status(), this.connection!.listSessions()]);
      this.status = status;
      this.sessions = sessions;
      this.sessionsKnown = true;
      // A chat opened before the list came (e.g. on a reload) learns its title.
      for (const session of sessions) {
        const chat = this.chats[session.key];
        if (chat && chat.state.title === 'Chat' && session.title) chat.setState({ title: session.title });
      }
    } catch (error) {
      this.error = describe(error);
    }
  }

  // ---- chats ----

  async newChat(): Promise<string | undefined> {
    await this.connect();
    const connection = this.connection!;
    let key: string;
    try {
      key = await connection.newSession();
    } catch (error) {
      if (isAuthRequired(error)) {
        this.events.signIn(this);
        return undefined;
      }
      throw error;
    }
    await this.applyRememberedMode(key);
    const chat = this.create(key, 'New chat');
    chat.post({ type: 'transcript', entries: [] });
    chat.post({ type: 'config', options: connection.config(key) });
    chat.setState({ live: true, steer: connection.canSteer });
    void this.refresh();
    return key;
  }

  /** The chat for a session, attached once connected. */
  async open(key: string): Promise<ChatSession> {
    const existing = this.chats[key];
    if (existing) return existing;
    const session = this.sessions.find((candidate) => candidate.key === key);
    const chat = this.create(key, session?.title ?? 'Chat');
    try {
      await this.connect();
      await this.attach(chat);
    } catch (error) {
      chat.loaded([]);
      this.report(chat, error);
    }
    return chat;
  }

  forget(key: string): void {
    delete this.chats[key];
  }

  async rename(key: string, title: string): Promise<void> {
    await this.connect();
    await this.connection!.renameSession(key, title);
    this.chats[key]?.setState({ title });
    await this.refresh();
  }

  async delete(key: string): Promise<void> {
    await this.connect();
    await this.connection!.deleteSession(key);
    delete this.chats[key];
    await this.refresh();
  }

  /** The chat a shown file belongs to: one running the user's `!command`, else a working one, else the latest. */
  chatFor(): ChatSession | undefined {
    const chats = Object.values(this.chats);
    const shells = chats.filter((chat) => chat.shellsRunning > 0);
    const busy = chats.filter((chat) => chat.state.busy);
    const candidates = shells.length ? shells : busy.length ? busy : chats;
    return candidates.sort((a, b) => b.lastUsed - a.lastUsed)[0];
  }

  /** The agent as a chat's header shows it; known once connected. */
  private presentation(): Pick<ChatState, 'subtitle' | 'agent'> {
    const agent = agentPresentation(this.status?.agent, { name: this.status?.agentLabel, ...this.status?.agentInfo });
    return { subtitle: `${agent?.name ?? 'Agent'} · ${this.place || this.id}`, agent };
  }

  private create(key: string, title: string): ChatSession {
    const chat = new ChatSession(
      this.id,
      key,
      { title, ...this.presentation(), actions: this.availableActions },
      this.actions
    );
    this.chats[key] = chat;
    this.showUsage(chat);
    return chat;
  }

  /**
   * Shows the chat's history and attaches it on the connection. The agent may
   * be mid-turn (a turn this or another window started).
   */
  private async attach(chat: ChatSession): Promise<void> {
    const connection = this.connection!;
    const session = this.sessions.find((candidate) => candidate.key === chat.key);
    if (!session) {
      chat.loaded(await connection.transcript(chat.key).catch(() => []));
      return;
    }
    chat.hold();
    try {
      const attached = await connection.resumeSession(session.nativeSessionId, session.cwd);
      const entries = await connection.transcript(chat.key);
      // Updates after the attach came live; the transcript has them too.
      chat.loaded(attached.transcriptEntries === undefined ? entries : entries.slice(0, attached.transcriptEntries));
      chat.post({ type: 'config', options: connection.config(chat.key) });
      const activity = connection.activity(chat.key);
      chat.post({ type: 'permission', request: activity.permission });
      chat.post({ type: 'question', request: activity.question });
      chat.setState({ live: true, busy: activity.busy, steer: connection.canSteer });
    } catch (error) {
      chat.loaded(await connection.transcript(chat.key).catch(() => []));
      this.report(chat, error);
    }
  }

  private report(chat: ChatSession, error: unknown): void {
    if (isAuthRequired(error)) chat.notify('error', 'The agent is not signed in for this project.', true);
    else if (error instanceof RpcError && error.code === LEASE_CONFLICT)
      chat.notify('info', 'This chat is open on another sandbox; it is read-only here.');
    else chat.notify('error', describe(error));
  }

  private require(): WorkerConnection {
    if (!this.connected) throw new Error('The sandbox is not connected');
    return this.connection!;
  }

  private readonly actions: ChatActions = {
    prompt: async (chat, text, action) => {
      try {
        await this.require().prompt(chat.key, text, action);
      } catch (error) {
        // The disconnect has its own notice; the turn goes on in the sandbox.
        if (!isConnectionClosed(error)) this.report(chat, error);
      } finally {
        void this.refresh();
      }
    },
    // A message the turn could not take is sent another way; no notice for it.
    steer: async (chat, text) => {
      try {
        return await this.require().steer(chat.key, text);
      } catch {
        return false;
      }
    },
    shell: async (chat, command) => {
      try {
        await this.require().runShell(chat.key, command);
      } catch (error) {
        this.report(chat, error);
      }
    },
    cancelShell: (_chat, runId) => this.connection?.cancelShell(runId),
    cancel: (chat) => this.connection?.cancel(chat.key),
    setConfig: async (chat, configId, value) => {
      try {
        await this.require().setConfigOption(chat.key, configId, value);
        this.rememberConfig(chat.key, configId, value);
      } catch (error) {
        this.report(chat, error);
        // Show the agent's actual settings again.
        chat.post({ type: 'config', options: this.connection?.config(chat.key) ?? [] });
      }
    },
    setAutoApprove: (chat, enabled) => this.connection?.setAutoApprove(chat.key, enabled),
    answerPermission: (_chat, requestId, optionId) => this.connection?.answerPermission(requestId, optionId),
    answerQuestion: (_chat, requestId, action, content) => this.connection?.answerQuestion(requestId, action, content),
    fileData: async (_chat, path) => {
      try {
        const file = await this.require().readFile(path);
        return `data:${file.mimeType};base64,${file.data}`;
      } catch {
        return null;
      }
    },
    openFile: (chat, path) => this.events.openFile(this, chat, path),
    signIn: () => this.events.signIn(this)
  };

  // ---- remembered settings ----

  private modes(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(WebWorker.MODES) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }

  private rememberConfig(key: string, configId: string, value: string | boolean): void {
    const option = this.connection?.config(key).find((candidate) => candidate.id === configId);
    const agent = this.status?.agent;
    if (option?.category !== 'mode' || !agent || typeof value !== 'string') return;
    try {
      localStorage.setItem(WebWorker.MODES, JSON.stringify({ ...this.modes(), [agent]: value }));
    } catch {
      // Not remembered; new chats start in the agent's default mode.
    }
  }

  /** New chats start in the mode the user chose last for this agent, e.g. one that asks less. */
  private async applyRememberedMode(key: string): Promise<void> {
    const agent = this.status?.agent;
    const remembered = agent ? this.modes()[agent] : undefined;
    const connection = this.connection;
    const mode = connection?.config(key).find((option) => option.category === 'mode');
    if (!connection || !remembered || mode?.type !== 'select' || mode.currentValue === remembered) return;
    const values = mode.options.flatMap((entry) => ('options' in entry ? entry.options : [entry])).map((choice) => choice.value);
    if (!values.includes(remembered)) return;
    await connection.setConfigOption(key, mode.id, remembered).catch(() => undefined);
  }

  // ---- what the agent sends ----

  private setUsage(usage: WorkerUsage): void {
    this.usage = usage;
    for (const chat of Object.values(this.chats)) this.showUsage(chat);
  }

  private showUsage(chat: ChatSession): void {
    const usage = this.usage;
    const live = usage?.sessions.find((candidate) => candidate.key === chat.key);
    let session: ChatUsage['session'] = null;
    if (live) {
      const { key: _, ...counts } = live;
      session = counts;
    } else {
      // Not loaded by the agent: what its turns recorded.
      session = this.sessions.find((candidate) => candidate.key === chat.key)?.usage ?? null;
    }
    let account: ChatUsage['account'] = null;
    if (usage) {
      const { sessions: _, totals: __, ...rest } = usage;
      account = rest;
    }
    chat.post({ type: 'usage', usage: { session, account } });
  }

  private entry(key: string, entry: TranscriptEntry): void {
    const chat = this.chats[key];
    chat?.post({ type: 'entry', entry });
    // The sandbox names a chat after its first prompt, and again when the agent
    // names it (often early in a long turn); the list says which title wins.
    const named = entry.kind === 'update' && entry.update.sessionUpdate === 'session_info_update' && !!entry.update.title;
    if (chat && (entry.kind === 'turn_end' || named)) {
      const update = () =>
        void this.refresh().then(() => {
          const title = this.sessions.find((session) => session.key === key)?.title;
          if (title) chat.setState({ title });
        });
      // The sandbox records the new title just after relaying it.
      if (named) setTimeout(update, 1000);
      else update();
    }
  }

  private closed(code: number, generation: number): void {
    if (generation !== this.generation || !this.connection) return;
    this.connection = undefined;
    this.usage = undefined;
    // 1011: the agent itself ended, so its turns did too.
    const agentEnded = code === 1011;
    this.state = code === TAKEN_OVER ? 'taken-over' : 'disconnected';
    for (const chat of Object.values(this.chats)) {
      chat.setState(agentEnded ? { live: false, busy: false } : { live: false });
      chat.post({ type: 'config', options: [] });
      chat.notify(
        'info',
        code === TAKEN_OVER
          ? 'Another window (VS Code, or another tab) took over this sandbox. Choose Open here to take it back.'
          : agentEnded
            ? "The sandbox's agent stopped. The chat reconnects when the sandbox is reachable again."
            : 'Disconnected from the sandbox; the agent keeps working. Reconnecting…'
      );
    }
    if (code !== TAKEN_OVER) this.retryLater();
  }

  /** While chats are open, an unreachable sandbox is tried again every 10 s. */
  private retryLater(): void {
    if (this.retry || !Object.keys(this.chats).length) return;
    this.retry = setInterval(() => {
      if (this.state === 'disconnected') void this.connect().catch(() => undefined);
    }, RECONNECT_MS);
  }

  private stopRetrying(): void {
    clearInterval(this.retry);
    this.retry = undefined;
  }

  private handlers(generation: number) {
    return {
      entry: (key: string, entry: TranscriptEntry) => this.entry(key, entry),
      permission: (key: string, request: PendingPermission | null) => this.chats[key]?.post({ type: 'permission', request }),
      question: (key: string, request: PendingQuestion | null) => this.chats[key]?.post({ type: 'question', request }),
      busy: (key: string, busy: boolean) => this.chats[key]?.setState({ busy }),
      config: (key: string, options: SessionConfigOption[]) => this.chats[key]?.post({ type: 'config', options }),
      elicitUrl: (request: UrlElicitation) => this.events.elicitUrl(this, request),
      elicitationComplete: (elicitationId: string) => this.events.elicitationComplete(this, elicitationId),
      show: (request: ShowRequest) => this.events.show(this, request),
      terminalOutput: (terminalId: string, data: string) => this.events.terminalOutput(terminalId, data),
      terminalExit: (terminalId: string, exitCode: number) => this.events.terminalExit(terminalId, exitCode),
      usage: (usage: WorkerUsage) => this.setUsage(usage),
      wrapUp: (notice: WrapUpNotice) => this.events.wrapUp(this, notice),
      closed: (_reason: string, code: number) => this.closed(code, generation)
    };
  }
}
