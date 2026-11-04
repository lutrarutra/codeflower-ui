// The connections to a worker: its own, and one per agent in use, each over ACP
// (several sessions at once), plus what the code flower bridge adds (recorded
// sessions, files, the user's shell commands, sign-in terminals, usage). It
// composes the layers below and runs wherever a Transport does: the extension
// host, the app's page, tests.
import type {
  AgentCapabilities,
  AuthMethod,
  PromptCapabilities,
  SessionConfigOption,
  StopReason
} from '@agentclientprotocol/sdk';
import {
  ACTION_PROMPT_META,
  agentPresentation,
  SHELL_CONTEXT_META,
  type ActionPromptMeta,
  type AgentName,
  type ChatAction,
  type AgentPresentation,
  type FormContent,
  type PendingPermission,
  type PendingQuestion,
  type QuestionAction,
  type SandboxFile,
  type TranscriptEntry
} from '../protocol/messages.ts';
import type { OpenedSubagent, SubagentFeatures, SubagentSettings, SubagentSettingsState, SubagentSummary } from '../protocol/subagents.ts';
import type { WorkerUsage } from '../protocol/usage.ts';
import { AcpClient, mcpNotice, type AttachedSession, type ClientIdentity, type UrlElicitation } from './acp.ts';
import {
  CodeflowerExtensions,
  WORKSPACE,
  type AgentState,
  type ChatTerminal,
  type ShellTerminal,
  type DirectoryListing,
  type DownloadChunk,
  type DownloadStarted,
  type DshCredentials,
  type EndpointCheck,
  type EndpointModel,
  type SavedCredentials,
  type FileTransfers,
  type SessionRecord,
  type ShowRequest,
  type TranscriptPage,
  type UploadTarget,
  type UploadedFile,
  type WorkerStatus,
  type WrapUpNotice,
  type CatalogPlugin,
  type PluginsOverview
} from './codeflower.ts';
import { ConnectionClosed, RpcConnection, RpcError } from './rpc.ts';
import { sessionKey } from './sessionKey.ts';
import type { Transport } from './transport.ts';

export {
  AUTH_REQUIRED,
  isAuthRequired,
  mcpNotice,
  type AttachedSession,
  type ClientIdentity,
  type McpLeftOut,
  type UrlElicitation
} from './acp.ts';
export {
  TAKEN_OVER,
  WORKSPACE,
  EMPTY_TRANSCRIPT,
  pageUpTo,
  type AgentState,
  type DirectoryEntry,
  type DirectoryListing,
  type DownloadChunk,
  type DownloadStarted,
  type DshCredentials,
  type EndpointCheck,
  type EndpointModel,
  type SavedCredentials,
  type FileTransfers,
  type Mount,
  type SessionRecord,
  type ShowRequest,
  type TranscriptPage,
  type UploadTarget,
  type UploadedFile,
  type WorkerActivity,
  type WorkerStatus,
  type WrapUpNotice,
  type CatalogPlugin,
  type ChatTerminal,
  type ShellTerminal,
  type NativePlugin,
  type PluginCatalog,
  type PluginContents,
  type PluginEntry,
  type PluginsOverview
} from './codeflower.ts';
export { ConnectionClosed, METHOD_NOT_FOUND, RpcError } from './rpc.ts';

const MAX_SHELL_CONTEXT = 16 * 1024;

interface ShellRun {
  sessionKey: string;
  command: string;
  output: string;
  /** Started from another window; it ends with `shellEnded`. */
  remote?: boolean;
}

export interface WorkerHandlers {
  entry(sessionKey: string, entry: TranscriptEntry): void;
  permission(sessionKey: string, request: PendingPermission | null): void;
  /** A question for the user (an ACP form), e.g. Claude Code's AskUserQuestion; null when answered. */
  question(sessionKey: string, request: PendingQuestion | null): void;
  busy(sessionKey: string, busy: boolean): void;
  /** The session's settings the agent offers (mode, model, effort, …) changed. */
  config(sessionKey: string, options: SessionConfigOption[]): void;
  /** Resolves when the user accepted or declined. */
  elicitUrl(request: UrlElicitation): Promise<'accept' | 'decline'>;
  elicitationComplete(elicitationId: string): void;
  /** The agent ran `codeflower-show`, or asks to approve a plan: the user should see these files. */
  show(request: ShowRequest): void;
  /** `replayed`: what the terminal printed before this window attached to it. */
  terminalOutput(terminalId: string, data: string, replayed?: boolean): void;
  terminalExit(terminalId: string, exitCode: number): void;
  /** An agent's token counts, cost, or the login's quota changed. */
  usage(agent: AgentName, usage: WorkerUsage): void;
  /** The agents: on connect, and when one starts or stops, or signs in. */
  agents?(agents: AgentState[]): void;
  wrapUp(notice: WrapUpNotice): void;
  /** The chats open in the agent's own terminal UI (`codeflower attach`): on connect, and when that changes. */
  terminals?(terminals: ChatTerminal[]): void;
  /** The user's shells running in the sandbox: on connect, and when that changes. */
  shells?(shells: ShellTerminal[]): void;
  /** One of a chat's subagents changed: started, ended, or its summary. */
  subagent?(parentKey: string, subagent: SubagentSummary): void;
  /** An agent's subagent defaults changed, from any window. */
  subagentSettings?(agent: AgentName, state: SubagentSettingsState): void;
  /** An agent's connection ended, e.g. it restarted (1011): its chats are detached. */
  agentClosed?(agent: AgentName, reason: string, code: number): void;
  /** The connection to the sandbox ended. */
  closed(reason: string, code: number): void;
}

/** Opens a transport to the sandbox: to one agent, or without one to the sandbox itself. */
export type OpenTransport = (agent?: AgentName) => Promise<Transport>;

/** One agent's connection: its ACP client and its window's bridge methods. */
interface AgentLink {
  agent: AgentName;
  rpc: RpcConnection;
  acp: AcpClient;
  bridge: CodeflowerExtensions;
}

function now(): string {
  return new Date().toISOString();
}

/** The agent a chat's key is of: `claude-…` is Claude Code's. */
export function agentOfKey(key: string): AgentName {
  const dash = key.indexOf('-');
  return dash > 0 ? key.slice(0, dash) : key;
}

/**
 * A sandbox: its own connection, for its files, shells, chats' records and agents, and one
 * connection per agent in use, opened when a chat of the agent opens or the agent signs in. A chat's
 * calls go to its agent's connection; an agent's own calls (keys, plugins, restart) name the agent.
 */
export class WorkerConnection {
  /** The sandbox, as it said on connect (`refresh` reads it again). */
  workerStatus: WorkerStatus;

  private readonly control: RpcConnection;
  private readonly bridge: CodeflowerExtensions;
  private readonly open: OpenTransport;
  private readonly client: ClientIdentity;
  private readonly handlers: WorkerHandlers;
  /** The agents' connections, by agent: opening, and open. */
  private readonly opening = new Map<AgentName, Promise<AgentLink>>();
  private readonly links = new Map<AgentName, AgentLink>();
  private readonly shells = new Map<string, ShellRun>();
  /** Shell commands the agent has not been told about yet, by session. */
  private readonly shellContext = new Map<string, string[]>();
  private readonly pluginListeners = new Set<(agent: AgentName) => void>();
  private agentList: AgentState[];

  private constructor(control: RpcConnection, status: WorkerStatus, open: OpenTransport, handlers: WorkerHandlers, client: ClientIdentity) {
    this.control = control;
    this.workerStatus = status;
    this.agentList = status.agents ?? [];
    this.open = open;
    this.handlers = handlers;
    this.client = client;
    // A chat's `!command` output goes to its agent's windows only.
    const { shellOutput: _, shellStarted: __, shellEnded: ___, ...shared } = this.sharedHandlers();
    this.bridge = new CodeflowerExtensions(control, {
      ...shared,
      shellOutput: () => undefined,
      shellStarted: () => undefined,
      shellEnded: () => undefined,
      activity: () => undefined,
      usage: (agent, usage) => handlers.usage(agent, usage),
      agents: (agents) => {
        this.agentList = agents;
        handlers.agents?.(agents);
      },
      wrapUp: ({ key, prompt: _, ...notice }) => {
        if (key === undefined) handlers.wrapUp(notice);
      },
      pluginsChanged: (agent) => {
        for (const listener of this.pluginListeners) listener(agent);
      },
      terminals: (terminals) => handlers.terminals?.(terminals),
      shells: (shells) => handlers.shells?.(shells),
      subagentSettingsChanged: (agent, state) => handlers.subagentSettings?.(agent, state)
    });
    // The agents' connections go with it; one that is closing for the same reason says so first.
    control.onClose((reason, code) => {
      handlers.closed(reason, code);
      setTimeout(() => {
        for (const link of this.links.values()) link.rpc.close();
      }, 0);
    });
  }

  /** Connects to the sandbox; its agents' connections open later, when needed. */
  static async connect(open: OpenTransport, handlers: WorkerHandlers, client: ClientIdentity): Promise<WorkerConnection> {
    const control = new RpcConnection(await open());
    try {
      const probe = new CodeflowerExtensions(control);
      const status = await probe.status();
      const connection = new WorkerConnection(control, status, open, handlers, client);
      handlers.agents?.(connection.agentList);
      if (status.capabilities?.shellTerminals || connection.agentList.some((agent) => agent.capabilities.chatTerminals)) {
        const { chats, shells } = await connection.bridge.terminals();
        handlers.terminals?.(chats);
        handlers.shells?.(shells);
      }
      return connection;
    } catch (error) {
      control.close();
      throw error;
    }
  }

  /** What every connection hands on the same way: files shown, terminals, shell output. */
  private sharedHandlers(link?: () => AgentLink | undefined) {
    const handlers = this.handlers;
    return {
      shellOutput: (runId: string, data: string) => {
        const run = this.shells.get(runId);
        if (!run) return;
        if (run.output.length < MAX_SHELL_CONTEXT * 4) run.output += data;
        handlers.entry(run.sessionKey, { t: now(), kind: 'shell_output', runId, data });
      },
      // Another window's command; this one's own end with their request.
      shellStarted: ({ sessionId, runId, command }: { sessionId: string; runId: string; command: string }) => {
        const current = link?.();
        if (!current) return;
        const key = sessionKey(current.agent, sessionId);
        if (!current.acp.isAttached(key) || this.shells.has(runId) || typeof command !== 'string') return;
        this.shells.set(runId, { sessionKey: key, command, output: '', remote: true });
        handlers.entry(key, { t: now(), kind: 'shell', runId, command });
      },
      shellEnded: ({ runId, exitCode, timedOut }: { runId: string; exitCode: number; timedOut: boolean }) => {
        const run = this.shells.get(runId);
        if (!run?.remote) return;
        this.shells.delete(runId);
        handlers.entry(run.sessionKey, { t: now(), kind: 'shell_end', runId, exitCode, timedOut: timedOut === true });
      },
      show: (request: ShowRequest) => {
        const current = link?.();
        handlers.show(current && request.sessionId ? { ...request, sessionKey: sessionKey(current.agent, request.sessionId) } : request);
      },
      terminalOutput: (terminalId: string, data: string, replayed?: boolean) => handlers.terminalOutput(terminalId, data, replayed),
      terminalExit: (terminalId: string, exitCode: number) => handlers.terminalExit(terminalId, exitCode)
    };
  }

  /** The agent's connection, opened (and its agent started) if it is not yet. */
  private link(agent: AgentName): Promise<AgentLink> {
    const open = this.links.get(agent);
    if (open) return Promise.resolve(open);
    let opening = this.opening.get(agent);
    if (!opening) {
      opening = this.openLink(agent).finally(() => this.opening.delete(agent));
      this.opening.set(agent, opening);
    }
    return opening;
  }

  private async openLink(agent: AgentName): Promise<AgentLink> {
    if (!this.connected) throw new ConnectionClosed('The sandbox is not connected', 1006);
    const rpc = new RpcConnection(await this.open(agent));
    const handlers = this.handlers;
    let link: AgentLink | undefined;
    const acp = new AcpClient(rpc, handlers, (sessionId) => sessionKey(agent, sessionId));
    const bridge = new CodeflowerExtensions(rpc, {
      ...this.sharedHandlers(() => link),
      activity: (activity) => {
        const working = new Set(activity.chats.map((chat) => chat.key));
        for (const key of acp.keys()) acp.setRemoteBusy(key, working.has(key));
      },
      // The sandbox's own connection hands on what is the agent's.
      usage: () => undefined,
      // The worker answered the chat's requests itself and prompts it; the chat shows the prompt,
      // which the bridge echoes to every window.
      wrapUp: ({ key }) => {
        if (key !== undefined && acp.isAttached(key)) acp.dropPending(key);
      },
      subagentChanged: (parentKey, subagent) => handlers.subagent?.(parentKey, subagent)
    });
    link = { agent, rpc, acp, bridge };
    try {
      await acp.initialize(this.client);
    } catch (error) {
      rpc.close();
      throw error;
    }
    rpc.onClose((reason, code) => {
      if (this.links.get(agent) !== link) return;
      this.links.delete(agent);
      for (const run of this.shells.values()) if (agentOfKey(run.sessionKey) === agent) run.remote = true;
      handlers.agentClosed?.(agent, reason, code);
    });
    this.links.set(agent, link);
    return link;
  }

  /** The open connection of a chat's agent; throws when the chat is not attached. */
  private linkOf(key: string): AgentLink {
    const link = this.links.get(agentOfKey(key));
    if (!link) throw new Error('This chat is not open on the sandbox');
    return link;
  }

  get connected(): boolean {
    return this.control.connected;
  }

  /** The sandbox's agents, as it last said. */
  get agents(): AgentState[] {
    return this.agentList;
  }

  agent(agent: AgentName): AgentState | undefined {
    return this.agentList.find((candidate) => candidate.id === agent);
  }

  /** Whether the agent's connection is open. */
  agentConnected(agent: AgentName): boolean {
    return this.links.has(agent);
  }

  /** The agent's sign-in methods, from its `initialize`; opens its connection. */
  async authMethods(agent: AgentName): Promise<AuthMethod[]> {
    return (await this.link(agent)).acp.authMethods;
  }

  /** What the agent of a chat takes in a prompt; empty until its connection opens. */
  promptCapabilities(agent: AgentName): PromptCapabilities {
    return this.links.get(agent)?.acp.promptCapabilities ?? {};
  }

  capabilities(agent: AgentName): AgentCapabilities {
    return this.links.get(agent)?.acp.capabilities ?? {};
  }

  /** The agent's name, color and logo, as the sandbox reports them. */
  presentation(agent: AgentName): AgentPresentation | undefined {
    const state = this.agent(agent);
    return agentPresentation(agent, state ? { name: state.name, color: state.color, icon: state.icon, iconMono: state.iconMono } : undefined);
  }

  close(): void {
    for (const link of this.links.values()) {
      link.acp.dropAll();
      link.rpc.close();
    }
    this.control.close();
  }

  /** Closes an agent's connection, e.g. to open it again after its restart. */
  closeAgent(agent: AgentName): void {
    const link = this.links.get(agent);
    if (!link) return;
    this.links.delete(agent);
    link.acp.dropAll();
    link.rpc.close();
  }

  // ---- worker ----

  async status(): Promise<WorkerStatus> {
    const status = await this.bridge.status();
    this.workerStatus = status;
    this.agentList = status.agents ?? [];
    return status;
  }

  actions(): Promise<ChatAction[] | undefined> {
    return this.bridge.actions();
  }

  /** The agent's usage; undefined when it has none to tell. */
  usage(agent: AgentName): Promise<WorkerUsage | undefined> {
    return this.bridge.forAgent(agent).usage().catch(() => undefined);
  }

  listSessions(): Promise<SessionRecord[]> {
    return this.bridge.listSessions();
  }

  transcript(key: string): Promise<TranscriptEntry[]> {
    return this.bridge.transcript(key);
  }

  transcriptPage(key: string, before?: number): Promise<TranscriptPage> {
    return this.bridge.transcriptPage(key, before);
  }

  renameSession(key: string, title: string): Promise<void> {
    return this.bridge.renameSession(key, title);
  }

  deleteSession(key: string): Promise<void> {
    return this.bridge.deleteSession(key);
  }

  // ---- files in the sandbox ----

  readFile(path: string): Promise<SandboxFile & { data: string }> {
    return this.bridge.readFile(path);
  }

  readPreview(path: string): Promise<SandboxFile & { data: string }> {
    return this.bridge.readPreview(path);
  }

  thumbnail(path: string, height: number): Promise<{ mimeType: string; data: string }> {
    return this.bridge.thumbnail(path, height);
  }

  statFile(path: string): Promise<SandboxFile> {
    return this.bridge.statFile(path);
  }

  writeFile(path: string, text: string, expectedMtimeMs: number): Promise<SandboxFile> {
    return this.bridge.writeFile(path, text, expectedMtimeMs);
  }

  saveReportComments(path: string, comments: string): Promise<void> {
    return this.bridge.saveReportComments(path, comments);
  }

  /** Notes in the session's history which files the agent showed the user. */
  async recordShow(key: string, files: string[], message?: string): Promise<void> {
    const link = this.links.get(agentOfKey(key));
    const sessionId = link?.acp.sessionId(key);
    if (!link || !sessionId) return;
    const entry = { kind: 'show' as const, files, ...(message ? { message } : {}) };
    this.handlers.entry(key, { t: now(), ...entry });
    await link.bridge.record(sessionId, entry);
  }

  listDirectory(path: string): Promise<DirectoryListing> {
    return this.bridge.listDirectory(path);
  }

  /** Whether files can be sent to the sandbox's folders and saved from it; see `web/lib/transfers.svelte.ts`. */
  get fileTransfers(): FileTransfers | undefined {
    const files = this.workerStatus.files;
    return files?.upload?.folders && files.download ? files : undefined;
  }

  uploadStart(target: UploadTarget, size: number): Promise<{ uploadId: string; chunkBytes: number }> {
    return this.bridge.uploadStart(target, size);
  }

  uploadChunk(uploadId: string, offset: number, data: string): Promise<{ received: number }> {
    return this.bridge.uploadChunk(uploadId, offset, data);
  }

  uploadFinish(uploadId: string, sha256: string): Promise<UploadedFile> {
    return this.bridge.uploadFinish(uploadId, sha256);
  }

  uploadCancel(uploadId: string): Promise<void> {
    return this.bridge.uploadCancel(uploadId);
  }

  filesExist(dir: string, paths: string[]): Promise<{ path: string; type: 'file' | 'directory' | 'other' }[]> {
    return this.bridge.filesExist(dir, paths);
  }

  downloadStart(path: string): Promise<DownloadStarted> {
    return this.bridge.downloadStart(path);
  }

  downloadChunk(downloadId: string, offset: number): Promise<DownloadChunk> {
    return this.bridge.downloadChunk(downloadId, offset);
  }

  downloadCancel(downloadId: string): Promise<void> {
    return this.bridge.downloadCancel(downloadId);
  }

  // ---- sessions ----

  isAttached(key: string): boolean {
    return this.links.get(agentOfKey(key))?.acp.isAttached(key) ?? false;
  }

  async newSession(agent: AgentName): Promise<string> {
    return (await this.startSession(agent)).key;
  }

  /** A new chat with the agent, with how many transcript entries came before its live updates. */
  async startSession(agent: AgentName): Promise<AttachedSession> {
    return (await this.link(agent)).acp.newSession(WORKSPACE);
  }

  /** Attaches a recorded session of the agent here; the agent may still have it loaded, even mid-turn. */
  async resumeSession(agent: AgentName, nativeSessionId: string, cwd: string | null): Promise<AttachedSession> {
    return (await this.link(agent)).acp.resumeSession(nativeSessionId, cwd ?? WORKSPACE);
  }

  /** What a session is doing now, for a chat that opens mid-turn. */
  activity(key: string): { busy: boolean; permission: PendingPermission | null; question: PendingQuestion | null } {
    return this.linkOf(key).acp.activity(key);
  }

  config(key: string): SessionConfigOption[] {
    return this.links.get(agentOfKey(key))?.acp.config(key) ?? [];
  }

  /** What to tell the user about the MCP servers from the app's config this session is without. */
  mcpNotice(key: string): string | undefined {
    const link = this.links.get(agentOfKey(key));
    return link ? mcpNotice(link.acp.mcpLeftOut(key)) : undefined;
  }

  setConfigOption(key: string, configId: string, value: string | boolean): Promise<void> {
    return this.linkOf(key).acp.setConfigOption(key, configId, value);
  }

  setAutoApprove(key: string, enabled: boolean): void {
    if (agentOfKey(key) === 'dsh') this.links.get('dsh')?.acp.setAutoApprove(key, enabled);
  }

  prompt(key: string, text: string, action?: ActionPromptMeta): Promise<StopReason> {
    const shown = [
      {
        type: 'text' as const,
        text,
        ...(action ? { _meta: { [ACTION_PROMPT_META]: action } } : {})
      }
    ];
    // Like Claude Code's `!` commands: the agent sees what the user ran with the next message.
    // A slash command must stay the first block for the agent to run it, so the
    // commands wait for the next message instead.
    const command = text.trimStart().startsWith('/');
    const context = command ? undefined : this.shellContext.get(key);
    if (!command) this.shellContext.delete(key);
    const blocks = context?.length
      ? [{ type: 'text' as const, text: context.join('\n\n'), _meta: { [SHELL_CONTEXT_META]: true } }, ...shown]
      : shown;
    return this.linkOf(key).acp.prompt(key, blocks, shown);
  }

  /** The chat's agent takes a message while it works; see {@link steer}. */
  canSteer(key: string): boolean {
    return this.links.get(agentOfKey(key))?.acp.canSteer ?? false;
  }

  /**
   * Gives the turn the agent is working on a message. False when no turn took
   * it: send it as a prompt. Commands and shell context wait for a prompt.
   */
  steer(key: string, text: string): Promise<boolean> {
    return this.linkOf(key).acp.steer(key, [{ type: 'text', text }]);
  }

  cancel(key: string): void {
    this.links.get(agentOfKey(key))?.acp.cancel(key);
  }

  answerPermission(key: string, requestId: number, optionId: string | null): void {
    this.links.get(agentOfKey(key))?.acp.answerPermission(requestId, optionId);
  }

  answerQuestion(key: string, requestId: number, action: QuestionAction, content: FormContent | null): void {
    this.links.get(agentOfKey(key))?.acp.answerQuestion(requestId, action, content);
  }

  /** Runs the user's `!command` in the sandbox's workspace; output streams as entries. */
  async runShell(key: string, command: string): Promise<{ exitCode: number; timedOut: boolean }> {
    const link = this.linkOf(key);
    const sessionId = link.acp.sessionId(key);
    if (!sessionId) throw new Error('This session is not open on the worker');
    const runId = crypto.randomUUID();
    const run: ShellRun = { sessionKey: key, command, output: '' };
    this.shells.set(runId, run);
    this.handlers.entry(key, { t: now(), kind: 'shell', runId, command });
    let result = { exitCode: 1, timedOut: false };
    try {
      result = await link.bridge.runShell(sessionId, runId, command);
    } catch (error) {
      run.output += `${error instanceof Error ? error.message : String(error)}\n`;
      this.handlers.entry(key, { t: now(), kind: 'shell_output', runId, data: run.output });
    } finally {
      this.shells.delete(runId);
      this.handlers.entry(key, { t: now(), kind: 'shell_end', runId, ...result });
      const output = run.output.length > MAX_SHELL_CONTEXT ? `${run.output.slice(0, MAX_SHELL_CONTEXT)}\n[output truncated]` : run.output;
      const note = [
        'The user ran this shell command in the sandbox themselves (not you):',
        `$ ${command}`,
        `[exit code ${result.exitCode}${result.timedOut ? ', timed out' : ''}]`,
        output.trimEnd() || '[no output]'
      ].join('\n');
      this.shellContext.set(key, [...(this.shellContext.get(key) ?? []), note]);
    }
    return result;
  }

  cancelShell(runId: string): void {
    if (this.shells.has(runId)) void this.bridge.cancelShell(runId).catch(() => undefined);
  }

  // ---- sign-in ----

  /** ACP sign-in handled by the agent, e.g. Codex's API key or device code. */
  async authenticate(agent: AgentName, methodId: string, meta?: Record<string, unknown>): Promise<unknown> {
    return (await this.link(agent)).acp.authenticate(methodId, meta);
  }

  /** A terminal sign-in of the agent's, on its connection, which knows its methods. */
  async startTerminal(agent: AgentName, methodId: string, columns: number, rows: number): Promise<string> {
    return (await this.link(agent)).bridge.startTerminal(methodId, columns, rows);
  }

  /** Types into a terminal: a sign-in's, a chat's or a shell. */
  async terminalInput(terminalId: string, data: string): Promise<void> {
    await this.terminalCall(terminalId, (bridge) => bridge.terminalInput(terminalId, data));
  }

  async closeTerminal(terminalId: string): Promise<void> {
    await this.terminalCall(terminalId, (bridge) => bridge.closeTerminal(terminalId));
  }

  /** A sign-in's terminal is known to the window that started it, an agent's; the others to any. */
  private async terminalCall(terminalId: string, call: (bridge: CodeflowerExtensions) => Promise<void>): Promise<void> {
    for (const link of this.links.values()) {
      try {
        return await call(link.bridge);
      } catch (error) {
        if (!(error instanceof RpcError) || !/Unknown terminal/.test(error.message)) throw error;
      }
    }
    return call(this.bridge);
  }

  // ---- the user's shells ----

  /** Whether the worker opens shells. */
  get shellTerminals(): boolean {
    return !!this.workerStatus.capabilities?.shellTerminals;
  }

  startShell(columns: number, rows: number): Promise<string> {
    return this.bridge.startShell(columns, rows);
  }

  attachTerminal(terminalId: string, columns: number, rows: number): Promise<void> {
    return this.bridge.attachTerminal(terminalId, columns, rows);
  }

  resizeTerminal(terminalId: string, columns: number, rows: number): Promise<void> {
    return this.bridge.resizeTerminal(terminalId, columns, rows);
  }

  detachTerminal(terminalId: string): Promise<void> {
    return this.bridge.detachTerminal(terminalId);
  }

  // ---- an agent's keys (dsh) ----

  setCredentials(agent: AgentName, credentials: DshCredentials): Promise<void> {
    return this.bridge.forAgent(agent).setCredentials(credentials);
  }

  endpointModels(agent: AgentName, baseURL: string, apiKey: string): Promise<EndpointModel[]> {
    return this.bridge.forAgent(agent).endpointModels(baseURL, apiKey);
  }

  checkEndpoint(agent: AgentName, baseURL: string, apiKey: string): Promise<EndpointCheck> {
    return this.bridge.forAgent(agent).checkEndpoint(baseURL, apiKey);
  }

  savedCredentials(agent: AgentName): Promise<SavedCredentials | undefined> {
    return this.bridge.forAgent(agent).savedCredentials();
  }

  /** Ends the agent (refused while its chats work); its connection closes, and the next one starts it again. */
  restartAgent(agent: AgentName): Promise<void> {
    return this.bridge.forAgent(agent).restartAgent();
  }

  // ---- subagents ----

  /** What the agent reports of its subagents; undefined when it has none in code flower. */
  subagentFeatures(agent: AgentName): SubagentFeatures | undefined {
    return this.agent(agent)?.capabilities.subagents;
  }

  /** A chat's subagents, running and recorded; none for agents without them. */
  async subagents(key: string): Promise<SubagentSummary[]> {
    if (!this.subagentFeatures(agentOfKey(key))) return [];
    return this.bridge.subagents(key);
  }

  /**
   * Opens a subagent's chat here. Its updates reach the chat from now on, after
   * `transcriptEntries` recorded ones; a subagent no longer running has only its record.
   */
  async openSubagent(key: string): Promise<OpenedSubagent> {
    const link = await this.link(agentOfKey(key));
    const opened = await link.bridge.openSubagent(key);
    if (opened.live && opened.sessionId) link.acp.attachChild(opened.sessionId);
    return opened;
  }

  async closeSubagent(key: string): Promise<void> {
    const link = this.links.get(agentOfKey(key));
    if (!link) return;
    link.acp.detachChild(key);
    if (link.rpc.connected) await link.bridge.closeSubagent(key);
  }

  /** Stops a subagent, where the agent lets the client (its `cancel` capability). */
  cancelSubagent(key: string): Promise<void> {
    return this.bridge.cancelSubagent(key);
  }

  subagentSettings(agent: AgentName, settings?: Partial<SubagentSettings>): Promise<SubagentSettingsState> {
    return this.bridge.forAgent(agent).subagentSettings(settings);
  }

  // ---- the agents' plugins ----

  /** Calls `listener` with the agent whenever the worker says its plugins changed; returns the unsubscribe. */
  onPluginsChanged(listener: (agent: AgentName) => void): () => void {
    this.pluginListeners.add(listener);
    return () => this.pluginListeners.delete(listener);
  }

  plugins(agent: AgentName): Promise<PluginsOverview> {
    return this.bridge.forAgent(agent).plugins();
  }

  pluginCatalog(agent: AgentName, catalog: string): Promise<{ name: string; fetched: boolean; plugins: CatalogPlugin[] }> {
    return this.bridge.forAgent(agent).pluginCatalog(catalog);
  }

  addPlugin(agent: AgentName, source: string): Promise<{ id: string; pendingFetch: boolean }> {
    return this.bridge.forAgent(agent).addPlugin(source);
  }

  removePlugin(agent: AgentName, id: string): Promise<void> {
    return this.bridge.forAgent(agent).removePlugin(id);
  }

  setPluginEnabled(agent: AgentName, id: string, enabled: boolean): Promise<void> {
    return this.bridge.forAgent(agent).setPluginEnabled(id, enabled);
  }

  addPluginCatalog(agent: AgentName, source: string): Promise<{ source: string; pendingFetch: boolean }> {
    return this.bridge.forAgent(agent).addPluginCatalog(source);
  }

  removePluginCatalog(agent: AgentName, source: string): Promise<void> {
    return this.bridge.forAgent(agent).removePluginCatalog(source);
  }

  fetchPlugins(agent: AgentName): Promise<void> {
    return this.bridge.forAgent(agent).fetchPlugins();
  }
}

/** A request the connection dropped; the worker carries on with it. */
export function isConnectionClosed(error: unknown): boolean {
  return error instanceof ConnectionClosed;
}
