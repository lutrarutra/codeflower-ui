// One sandbox, reached through the app's relay, with its agents and the chats
// open on it. The connection opens only when a chat or the files of the
// sandbox are opened; an agent's, when a chat of it opens or it signs in. The
// bridge serves several windows at once (e.g. this page and VS Code).
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import {
  type AgentName,
  type ChatAction,
  type ChatState,
  type PendingPermission,
  type PendingQuestion,
  type TranscriptEntry
} from '../../protocol/messages.ts';
import { subagentTitle, withSubagent, type SubagentSettingsState, type SubagentSummary } from '../../protocol/subagents.ts';
import type { ChatUsage, WorkerUsage } from '../../protocol/usage.ts';
import {
  agentOfKey,
  isAuthRequired,
  isConnectionClosed,
  EMPTY_TRANSCRIPT,
  pageUpTo,
  RpcError,
  TAKEN_OVER,
  WorkerConnection,
  type AgentState,
  type AttachedSession,
  type ChatTerminal,
  type ShellTerminal,
  type SessionRecord,
  type ShowRequest,
  type UrlElicitation,
  type WorkerStatus,
  type WrapUpNotice
} from '../../client/workerConnection.ts';
import type { Machine } from './machines.svelte.ts';
import { ChatSession, type ChatActions } from './chatSession.svelte.ts';

const RECONNECT_MS = 10_000;
// After an agent's restart, how long its chats wait before they attach to the fresh one.
const AGENT_RESTART_MS = 500;
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
  /** A chat of the sandbox in front, e.g. a subagent's from its parent. */
  openChat(worker: WebWorker, key: string): void;
  /** The agent should sign in, e.g. a chat of it cannot start without. */
  signIn(worker: WebWorker, agent: AgentName): void;
  elicitUrl(worker: WebWorker, request: UrlElicitation, agent?: AgentName): Promise<'accept' | 'decline'>;
  elicitationComplete(worker: WebWorker, elicitationId: string): void;
  terminalOutput(terminalId: string, data: string, replayed: boolean): void;
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
  /** The sandbox's agents: whether each can run, is signed in, runs. */
  agents = $state<AgentState[]>([]);
  sessions = $state<SessionRecord[]>([]);
  /** The chats were listed (or cannot be): until then the page shows them loading. */
  sessionsKnown = $state(false);
  /** Each agent's usage, by agent. */
  usage = $state<Record<AgentName, WorkerUsage>>({});
  private availableActions: ChatAction[] | undefined;
  /** Open chats, by key. */
  chats = $state<Record<string, ChatSession>>({});
  /** Chats open in the agent's own terminal UI (`codeflower attach`), by key. */
  terminals = $state<Record<string, ChatTerminal>>({});
  /** The user's shells running in the sandbox (the page's Terminal). */
  shells = $state<ShellTerminal[]>([]);
  /** The shells were listed on this connection: a terminal tab whose shell is not among them ended. */
  shellsKnown = $state(false);
  /** The subagents of the chats open here, by their chats' keys: what their tabs show. */
  subagents = $state<Record<string, SubagentSummary>>({});
  /** The defaults of each agent's subagents, by agent; missing for agents without them in code flower. */
  private subagentSettings: Record<AgentName, SubagentSettingsState> = {};
  /** The terminal notice each chat shows, so it is posted once and cleared when the terminal goes. */
  private readonly terminalNotices = new Map<string, string>();
  connection: WorkerConnection | undefined;

  private readonly events: WorkerEvents;
  private connecting: Promise<void> | undefined;
  /** Chats being attached, by key. */
  private readonly attaching = new Map<string, Promise<void>>();
  /** Counts connections, so a late close of an old one changes nothing. */
  private generation = 0;
  private retry: ReturnType<typeof setInterval> | undefined;
  /** The user's last mode per agent, for new chats. */
  private static readonly MODES = 'codeflower.modes';

  /** The computer it runs on. */
  readonly machine: Machine;

  constructor(id: string, events: WorkerEvents, machine: Machine) {
    this.id = id;
    this.events = events;
    this.machine = machine;
  }

  /** Its path on its computer's app, e.g. /api/workers/{id}/acp. */
  private path(rest: string): string {
    return `/api/workers/${encodeURIComponent(this.machine.remoteId(this.id))}${rest}`;
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
      this.sessions = (await this.machine.api<{ sessions: SessionRecord[] }>(this.path('/sessions'))).sessions;
      this.sessionsKnown = true;
      return true;
    } catch {
      return false;
    }
  }

  /** An agent of the sandbox. */
  agent(agent: AgentName): AgentState | undefined {
    return this.agents.find((candidate) => candidate.id === agent);
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
    this.shellsKnown = false;
    let connection: WorkerConnection | undefined;
    try {
      const open = async (agent?: AgentName) =>
        this.machine.openTransport(this.path(agent ? `/acp?agent=${encodeURIComponent(agent)}` : '/acp'));
      connection = await WorkerConnection.connect(open, this.handlers(++this.generation), CLIENT);
      const actions = await connection.actions();
      this.connection = connection;
      this.availableActions = actions;
      this.agents = connection.agents;
      this.state = 'connected';
      this.stopRetrying();
      await this.refresh();
      // Chats opened while connecting learn which agent they talk to; a notice about the lost connection goes.
      this.terminalNotices.clear();
      for (const chat of Object.values(this.chats)) {
        chat.setState({ ...this.presentation(chat.key), actions });
        chat.post({ type: 'clearNotice' });
      }
      // Every agent's usage and subagent defaults; asking starts no agent.
      for (const agent of connection.agents) {
        void connection.usage(agent.id).then((usage) => {
          if (usage && this.connection === connection) this.setUsage(agent.id, usage);
        });
        if (agent.capabilities.subagents) {
          void connection.subagentSettings(agent.id).then(
            (settings) => {
              if (this.connection === connection) this.setSubagentSettings(agent.id, settings);
            },
            () => undefined
          );
        }
      }
      // Open chats attach again and show what happened meanwhile. Not awaited: after the agent
      // restarted each is a full resume, and a new chat or a prompt should not wait for them all.
      void Promise.all(Object.values(this.chats).map((chat) => this.attach(chat).catch((error) => this.report(chat, error))));
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

  /** An agent signed in: its chats that could not attach try again, and say so. */
  async afterSignIn(agent: AgentName, message: string): Promise<void> {
    await this.refresh();
    await Promise.all(
      this.chatsOf(agent).map(async (chat) => {
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
      this.agents = status.agents;
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

  /** A new chat with the agent; undefined when the agent has to sign in first. */
  async newChat(agent: AgentName): Promise<string | undefined> {
    await this.connect();
    const connection = this.connection!;
    let started: AttachedSession;
    try {
      started = await connection.startSession(agent);
    } catch (error) {
      if (isAuthRequired(error)) {
        this.events.signIn(this, agent);
        return undefined;
      }
      throw error;
    }
    const { key, transcriptEntries } = started;
    // Created before anything else is awaited, so no live update finds it missing.
    const chat = this.create(key, 'New chat');
    if (transcriptEntries) {
      chat.hold();
      chat.loaded(pageUpTo(await connection.transcriptPage(key).catch(() => EMPTY_TRANSCRIPT), transcriptEntries));
    } else {
      chat.post({ type: 'transcript', entries: [] });
    }
    await this.applyRememberedMode(key);
    chat.post({ type: 'config', options: connection.config(key) });
    chat.setState({ live: true, steer: connection.canSteer(key) });
    this.noticeMcp(chat, connection.mcpNotice(key));
    void this.refresh();
    return key;
  }

  /** Whether a key is one of the subagents of the chats open here, whose chats open lazily. */
  isSubagent(key: string): boolean {
    return key in this.subagents;
  }

  /** The chat for a session (or a subagent), attached once connected. */
  async open(key: string): Promise<ChatSession> {
    const existing = this.chats[key];
    if (existing) {
      // Chosen again after its connection went (e.g. closed after idle minutes): at once, not at the next retry.
      if (this.state === 'disconnected') void this.connect().catch(() => undefined);
      return existing;
    }
    const session = this.sessions.find((candidate) => candidate.key === key);
    const subagent = session ? undefined : this.subagents[key];
    const chat = this.create(key, session?.title ?? (subagent ? subagentTitle(subagent) : 'Chat'));
    if (subagent) chat.setState({ subagent: this.subagentState(subagent) });
    try {
      await this.connect();
      await this.attach(chat);
    } catch (error) {
      chat.loaded(EMPTY_TRANSCRIPT);
      this.report(chat, error);
    }
    return chat;
  }

  forget(key: string): void {
    // A subagent's updates stop coming once no chat of it is open.
    if (this.chats[key]?.state.subagent) void this.connection?.closeSubagent(key).catch(() => undefined);
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

  /** The open chats of an agent. */
  private chatsOf(agent: AgentName): ChatSession[] {
    return Object.values(this.chats).filter((chat) => agentOfKey(chat.key) === agent);
  }

  /** A chat's agent as its header shows it; its name, color and logo known once connected. */
  private presentation(key: string): Pick<ChatState, 'subtitle' | 'agent'> {
    const id = agentOfKey(key);
    const agent = this.connection?.presentation(id) ?? { id };
    return { subtitle: `${agent.name ?? 'Agent'} · ${this.place || this.id}`, agent };
  }

  private create(key: string, title: string): ChatSession {
    const chat = new ChatSession(
      this.id,
      key,
      { title, ...this.presentation(key), actions: this.availableActions },
      this.actions
    );
    this.chats[key] = chat;
    this.showUsage(chat);
    this.refreshUsage(agentOfKey(key));
    chat.post({ type: 'subagentSettings', state: this.subagentSettings[agentOfKey(key)] ?? null });
    return chat;
  }

  /**
   * Shows the chat's history and attaches it on the connection. The agent may
   * be mid-turn (a turn this or another window started).
   */
  /** Attaches a chat, once at a time: a reconnect and opening the chat may both ask. */
  private attach(chat: ChatSession): Promise<void> {
    let pending = this.attaching.get(chat.key);
    if (!pending) {
      pending = this.attachNow(chat).finally(() => this.attaching.delete(chat.key));
      this.attaching.set(chat.key, pending);
    }
    return pending;
  }

  private async attachNow(chat: ChatSession): Promise<void> {
    const connection = this.connection!;
    if (chat.state.subagent) return this.attachSubagent(chat);
    const session = this.sessions.find((candidate) => candidate.key === chat.key);
    if (!session) {
      chat.loaded(await connection.transcriptPage(chat.key).catch(() => EMPTY_TRANSCRIPT));
      return;
    }
    chat.hold();
    try {
      const attached = await connection.resumeSession(session.harness, session.nativeSessionId, session.cwd);
      // Updates after the attach came live; the transcript has them too.
      chat.loaded(pageUpTo(await connection.transcriptPage(chat.key), attached.transcriptEntries));
      chat.post({ type: 'config', options: connection.config(chat.key) });
      const activity = connection.activity(chat.key);
      chat.post({ type: 'permission', request: activity.permission });
      chat.post({ type: 'question', request: activity.question });
      chat.setState({ ...this.presentation(chat.key), live: true, busy: activity.busy, steer: connection.canSteer(chat.key) });
      this.noticeMcp(chat, connection.mcpNotice(chat.key));
      this.noticeTerminal(chat);
      void this.loadSubagents(chat);
    } catch (error) {
      chat.loaded(await connection.transcriptPage(chat.key).catch(() => EMPTY_TRANSCRIPT));
      this.report(chat, error);
    }
  }

  // ---- subagents ----

  /** A subagent's chat: what it recorded so far, then its updates live while it runs. */
  private async attachSubagent(chat: ChatSession): Promise<void> {
    const connection = this.connection!;
    chat.hold();
    try {
      const opened = await connection.openSubagent(chat.key);
      chat.loaded(pageUpTo(await connection.transcriptPage(chat.key), opened.transcriptEntries));
      if (opened.subagent) this.subagentChanged(opened.subagent);
      void this.loadSubagents(chat);
    } catch (error) {
      chat.loaded(await connection.transcriptPage(chat.key).catch(() => EMPTY_TRANSCRIPT));
      this.report(chat, error);
    }
  }

  /** A chat's subagents, for its cards and its badge. */
  private async loadSubagents(chat: ChatSession): Promise<void> {
    const connection = this.connection;
    if (!connection?.subagentFeatures(agentOfKey(chat.key))) return;
    const subagents = await connection.subagents(chat.key).catch(() => undefined);
    if (!subagents || this.connection !== connection) return;
    for (const subagent of subagents) this.subagents[subagent.key] = subagent;
    chat.post({ type: 'subagents', subagents });
  }

  private subagentState(subagent: SubagentSummary): ChatState['subagent'] {
    const parent = this.chats[subagent.parentKey]?.state.title ?? this.sessions.find((session) => session.key === subagent.parentKey)?.title;
    return { ...subagent, ...(parent ? { parentTitle: parent } : {}) };
  }

  private subagentChanged(subagent: SubagentSummary): void {
    this.subagents[subagent.key] = subagent;
    const parent = this.chats[subagent.parentKey];
    parent?.post({ type: 'subagents', subagents: withSubagent(parent.subagents, subagent) });
    this.chats[subagent.key]?.setState({ subagent: this.subagentState(subagent) });
  }

  private setSubagentSettings(agent: AgentName, state: SubagentSettingsState): void {
    this.subagentSettings[agent] = state;
    for (const chat of this.chatsOf(agent)) chat.post({ type: 'subagentSettings', state });
  }

  /**
   * A chat open in the agent's terminal UI says so, and how to get there:
   * Claude Code's has the chat (what is sent here is typed there), the others
   * share it.
   */
  private noticeTerminal(chat: ChatSession): void {
    const terminal = this.terminals[chat.key];
    const shown = this.terminalNotices.get(chat.key);
    if (!terminal) {
      if (shown !== undefined) chat.post({ type: 'clearNotice' });
      this.terminalNotices.delete(chat.key);
      return;
    }
    const id = `${terminal.terminalId}:${terminal.mode}`;
    if (shown === id) return;
    this.terminalNotices.set(chat.key, id);
    const agent = this.agent(agentOfKey(chat.key))?.name ?? 'the agent';
    // Through the tunnel the page's id for the sandbox is not one the computer's `codeflower attach` knows.
    const command = this.id.includes('@') ? '' : ` In a terminal on its computer: codeflower attach ${this.id} ${chat.key}`;
    chat.notify(
      'info',
      terminal.mode === 'handoff'
        ? `This chat is open in ${agent}'s own terminal UI. What you send here is typed there (text only), and permissions are answered there; quit it there (~q) to go on here.${command}`
        : `This chat is also open in ${agent}'s own terminal UI; both follow it as it goes.${command}`
    );
  }

  private setTerminals(terminals: ChatTerminal[]): void {
    this.terminals = Object.fromEntries(terminals.map((terminal) => [terminal.sessionKey, terminal]));
    for (const chat of Object.values(this.chats)) this.noticeTerminal(chat);
  }

  /** MCP servers from the app's config the chat is without, e.g. one that did not start. */
  private noticeMcp(chat: ChatSession, notice: string | undefined): void {
    if (notice) chat.notify('info', notice);
  }

  private report(chat: ChatSession, error: unknown): void {
    if (isAuthRequired(error)) chat.notify('error', `${this.agent(agentOfKey(chat.key))?.name ?? 'The agent'} is not signed in for this project.`, true);
    else if (error instanceof RpcError && error.code === LEASE_CONFLICT)
      chat.notify('info', 'This chat is open on another sandbox; it is read-only here.');
    else chat.notify('error', describe(error));
  }

  private require(): WorkerConnection {
    if (!this.connected) throw new Error('The sandbox is not connected');
    return this.connection!;
  }

  private readonly actions: ChatActions = {
    transcriptPage: (chat, before) => this.require().transcriptPage(chat.key, before),
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
    answerPermission: (chat, requestId, optionId) => this.connection?.answerPermission(chat.key, requestId, optionId),
    answerQuestion: (chat, requestId, action, content) => this.connection?.answerQuestion(chat.key, requestId, action, content),
    fileData: async (_chat, path, thumbnail) => {
      try {
        const connection = this.require();
        const file = thumbnail ? await connection.thumbnail(path, thumbnail) : await connection.readFile(path);
        return `data:${file.mimeType};base64,${file.data}`;
      } catch {
        return null;
      }
    },
    openFile: (chat, path) => this.events.openFile(this, chat, path),
    signIn: (chat) => this.events.signIn(this, agentOfKey(chat.key)),
    openSubagent: (_chat, key) => this.events.openChat(this, key),
    openParent: (chat) => {
      if (chat.state.subagent) this.events.openChat(this, chat.state.subagent.parentKey);
    },
    stopSubagent: (_chat, key) => this.require().cancelSubagent(key),
    setSubagentSettings: async (chat, settings) => {
      const agent = agentOfKey(chat.key);
      this.setSubagentSettings(agent, await this.require().subagentSettings(agent, settings));
    },
    restartAgent: (chat) => this.restartAgent(agentOfKey(chat.key))
  };

  /**
   * Restarts an agent, e.g. so new keys or plugins apply (refused while its chats work). Its
   * connection closes; its open chats attach again to the fresh agent.
   */
  async restartAgent(agent: AgentName): Promise<void> {
    await this.require().restartAgent(agent);
  }

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
    const agent = agentOfKey(key);
    if (option?.category !== 'mode' || typeof value !== 'string') return;
    try {
      localStorage.setItem(WebWorker.MODES, JSON.stringify({ ...this.modes(), [agent]: value }));
    } catch {
      // Not remembered; new chats start in the agent's default mode.
    }
  }

  /** New chats start in the mode the user chose last for this agent, e.g. one that asks less. */
  private async applyRememberedMode(key: string): Promise<void> {
    const remembered = this.modes()[agentOfKey(key)];
    const connection = this.connection;
    const mode = connection?.config(key).find((option) => option.category === 'mode');
    if (!connection || !remembered || mode?.type !== 'select' || mode.currentValue === remembered) return;
    const values = mode.options.flatMap((entry) => ('options' in entry ? entry.options : [entry])).map((choice) => choice.value);
    if (!values.includes(remembered)) return;
    await connection.setConfigOption(key, mode.id, remembered).catch(() => undefined);
  }

  // ---- what the agent sends ----

  /**
   * Asks for an agent's usage again, e.g. when a chat of it opens or comes to
   * the front: the worker then reads the login's quota if its last read is
   * old, and sends it when it has it.
   */
  refreshUsage(agent: AgentName): void {
    const connection = this.connection;
    void connection?.usage(agent).then((usage) => {
      if (usage && this.connection === connection) this.setUsage(agent, usage);
    });
  }

  private setUsage(agent: AgentName, usage: WorkerUsage): void {
    this.usage[agent] = usage;
    for (const chat of this.chatsOf(agent)) this.showUsage(chat);
  }

  private showUsage(chat: ChatSession): void {
    const usage = this.usage[agentOfKey(chat.key)];
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
    this.usage = {};
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

  /**
   * An agent's connection ended. After its restart (1011, the agent itself ended) its open chats
   * attach again, which starts it; otherwise they say so, and attach when opened again.
   */
  private agentClosed(agent: AgentName, code: number, generation: number): void {
    if (generation !== this.generation) return;
    const chats = this.chatsOf(agent);
    const restarted = code === 1011;
    for (const chat of chats) {
      chat.setState(restarted ? { live: false, busy: false } : { live: false });
      chat.post({ type: 'config', options: [] });
    }
    delete this.usage[agent];
    if (!restarted || !this.connected) {
      for (const chat of chats) chat.notify('info', 'Disconnected from the agent; it keeps working. Choose the chat again to reconnect.');
      return;
    }
    // The bridge starts the agent again once the old one is gone.
    setTimeout(() => {
      for (const chat of this.chatsOf(agent)) void this.attach(chat).catch((error) => this.report(chat, error));
      this.refreshUsage(agent);
    }, AGENT_RESTART_MS);
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
      elicitUrl: (request: UrlElicitation, agent?: AgentName) => this.events.elicitUrl(this, request, agent),
      elicitationComplete: (elicitationId: string) => this.events.elicitationComplete(this, elicitationId),
      show: (request: ShowRequest) => this.events.show(this, request),
      terminalOutput: (terminalId: string, data: string, replayed?: boolean) => this.events.terminalOutput(terminalId, data, replayed === true),
      terminalExit: (terminalId: string, exitCode: number) => this.events.terminalExit(terminalId, exitCode),
      usage: (agent: AgentName, usage: WorkerUsage) => this.setUsage(agent, usage),
      agents: (agents: AgentState[]) => {
        this.agents = agents;
      },
      wrapUp: (notice: WrapUpNotice) => this.events.wrapUp(this, notice),
      terminals: (terminals: ChatTerminal[]) => this.setTerminals(terminals),
      shells: (shells: ShellTerminal[]) => {
        this.shells = shells;
        this.shellsKnown = true;
      },
      subagent: (_parentKey: string, subagent: SubagentSummary) => this.subagentChanged(subagent),
      subagentSettings: (agent: AgentName, state: SubagentSettingsState) => this.setSubagentSettings(agent, state),
      agentClosed: (agent: AgentName, _reason: string, code: number) => this.agentClosed(agent, code, generation),
      closed: (_reason: string, code: number) => this.closed(code, generation)
    };
  }
}
