// One connection to a worker: its agent over ACP (several sessions at once),
// plus what the code flower bridge adds (recorded sessions, files, the user's
// shell commands, sign-in terminals, usage). It composes the layers below and
// runs wherever a Transport does: the extension host, the app's page, tests.
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
import type { WorkerUsage } from '../protocol/usage.ts';
import { AcpClient, type AttachedSession, type ClientIdentity, type UrlElicitation } from './acp.ts';
import {
  CodeflowerExtensions,
  WORKSPACE,
  type DirectoryListing,
  type DshCredentials,
  type SessionRecord,
  type ShowRequest,
  type WorkerStatus,
  type WrapUpNotice
} from './codeflower.ts';
import { ConnectionClosed, RpcConnection } from './rpc.ts';
import { sessionKey } from './sessionKey.ts';
import type { Transport } from './transport.ts';

export { AUTH_REQUIRED, isAuthRequired, type AttachedSession, type ClientIdentity, type UrlElicitation } from './acp.ts';
export {
  TAKEN_OVER,
  WORKSPACE,
  type DirectoryEntry,
  type DirectoryListing,
  type DshCredentials,
  type Mount,
  type SessionRecord,
  type ShowRequest,
  type WorkerActivity,
  type WorkerStatus,
  type WrapUpNotice
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
  /** The agent ran `codeflower-show`: the user should see these files. */
  show(request: ShowRequest): void;
  terminalOutput(terminalId: string, data: string): void;
  terminalExit(terminalId: string, exitCode: number): void;
  /** Token counts, cost, or the login's quota changed. */
  usage(usage: WorkerUsage): void;
  wrapUp(notice: WrapUpNotice): void;
  closed(reason: string, code: number): void;
}

function now(): string {
  return new Date().toISOString();
}

export class WorkerConnection {
  /** The agent's id: from the worker, or from the agent's own `initialize` answer without a bridge. */
  agent: AgentName | undefined;
  /** Undefined when the agent was reached without the code flower bridge. */
  workerStatus: WorkerStatus | undefined;

  private readonly rpc: RpcConnection;
  private readonly acp: AcpClient;
  private readonly bridge: CodeflowerExtensions;
  private readonly handlers: WorkerHandlers;
  private readonly shells = new Map<string, ShellRun>();
  /** Shell commands the agent has not been told about yet, by session. */
  private readonly shellContext = new Map<string, string[]>();

  private constructor(transport: Transport, handlers: WorkerHandlers) {
    this.handlers = handlers;
    this.rpc = new RpcConnection(transport);
    this.acp = new AcpClient(this.rpc, handlers, (sessionId) => sessionKey(this.requireAgent(), sessionId));
    this.bridge = new CodeflowerExtensions(this.rpc, {
      shellOutput: (runId, data) => {
        const run = this.shells.get(runId);
        if (!run) return;
        if (run.output.length < MAX_SHELL_CONTEXT * 4) run.output += data;
        handlers.entry(run.sessionKey, { t: now(), kind: 'shell_output', runId, data });
      },
      // Another window's command; this one's own end with their request.
      shellStarted: ({ sessionId, runId, command }) => {
        const key = sessionKey(this.requireAgent(), sessionId);
        if (!this.acp.isAttached(key) || this.shells.has(runId) || typeof command !== 'string') return;
        this.shells.set(runId, { sessionKey: key, command, output: '', remote: true });
        handlers.entry(key, { t: now(), kind: 'shell', runId, command });
      },
      shellEnded: ({ runId, exitCode, timedOut }) => {
        const run = this.shells.get(runId);
        if (!run?.remote) return;
        this.shells.delete(runId);
        handlers.entry(run.sessionKey, { t: now(), kind: 'shell_end', runId, exitCode, timedOut: timedOut === true });
      },
      show: (request) => handlers.show(request),
      activity: (activity) => {
        const working = new Set(activity.chats.map((chat) => chat.key));
        for (const key of this.acp.keys()) this.acp.setRemoteBusy(key, working.has(key));
      },
      usage: (usage) => handlers.usage(usage),
      wrapUp: ({ key, prompt, ...notice }) => {
        if (key === undefined) {
          handlers.wrapUp(notice);
          return;
        }
        // The worker answered the chat's requests itself and prompts it; the chat shows the prompt,
        // which a bridge for several windows echoes with the others.
        this.acp.dropPending(key);
        if (prompt && !this.acp.multiClient) handlers.entry(key, { t: now(), kind: 'prompt', prompt: [{ type: 'text', text: prompt }] });
      },
      terminalOutput: (terminalId, data) => handlers.terminalOutput(terminalId, data),
      terminalExit: (terminalId, exitCode) => handlers.terminalExit(terminalId, exitCode)
    });
    // After the ACP layer's own close handling, which hides open requests.
    this.rpc.onClose((reason, code) => handlers.closed(reason, code));
  }

  /** Connects over an open transport; closes it again if the agent does not initialize. */
  static async connect(transport: Transport, handlers: WorkerHandlers, client: ClientIdentity): Promise<WorkerConnection> {
    const connection = new WorkerConnection(transport, handlers);
    try {
      connection.workerStatus = await connection.bridge.status();
      connection.agent = connection.workerStatus?.agent;
      const initialized = await connection.acp.initialize(client);
      connection.agent ??= initialized.agentInfo?.name;
      return connection;
    } catch (error) {
      connection.rpc.close();
      throw error;
    }
  }

  get connected(): boolean {
    return this.rpc.connected;
  }

  get authMethods(): AuthMethod[] {
    return this.acp.authMethods;
  }

  get capabilities(): AgentCapabilities {
    return this.acp.capabilities;
  }

  get promptCapabilities(): PromptCapabilities {
    return this.acp.promptCapabilities;
  }

  /** The agent's name and color, as the worker or the agent itself reports them. */
  get presentation(): AgentPresentation | undefined {
    const status = this.workerStatus;
    return agentPresentation(this.agent, {
      name: status?.agentLabel ?? this.acp.agentInfo?.title ?? undefined,
      ...status?.agentInfo
    });
  }

  close(): void {
    this.acp.dropAll();
    this.rpc.close();
  }

  // ---- worker ----

  async status(): Promise<WorkerStatus> {
    const status = await this.bridge.status();
    if (!status) throw new Error('This agent runs without a code flower worker');
    this.workerStatus = status;
    return status;
  }

  actions(): Promise<ChatAction[] | undefined> {
    return this.bridge.actions();
  }

  usage(): Promise<WorkerUsage | undefined> {
    return this.bridge.usage();
  }

  listSessions(): Promise<SessionRecord[]> {
    return this.bridge.listSessions();
  }

  transcript(key: string): Promise<TranscriptEntry[]> {
    return this.bridge.transcript(key);
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

  statFile(path: string): Promise<SandboxFile> {
    return this.bridge.statFile(path);
  }

  saveReportComments(path: string, comments: string): Promise<void> {
    return this.bridge.saveReportComments(path, comments);
  }

  /** Notes in the session's history which files the agent showed the user. */
  async recordShow(key: string, files: string[], message?: string): Promise<void> {
    const sessionId = this.acp.sessionId(key);
    if (!sessionId) return;
    const entry = { kind: 'show' as const, files, ...(message ? { message } : {}) };
    this.handlers.entry(key, { t: now(), ...entry });
    await this.bridge.record(sessionId, entry);
  }

  listDirectory(path: string): Promise<DirectoryListing> {
    return this.bridge.listDirectory(path);
  }

  // ---- sessions ----

  isAttached(key: string): boolean {
    return this.acp.isAttached(key);
  }

  newSession(): Promise<string> {
    return this.acp.newSession(WORKSPACE);
  }

  /** Attaches a recorded session on this connection; the agent may still have it loaded, even mid-turn. */
  resumeSession(nativeSessionId: string, cwd: string | null): Promise<AttachedSession> {
    return this.acp.resumeSession(nativeSessionId, cwd ?? WORKSPACE);
  }

  /** What a session is doing now, for a chat that opens mid-turn. */
  activity(key: string): { busy: boolean; permission: PendingPermission | null; question: PendingQuestion | null } {
    return this.acp.activity(key);
  }

  config(key: string): SessionConfigOption[] {
    return this.acp.config(key);
  }

  setConfigOption(key: string, configId: string, value: string | boolean): Promise<void> {
    return this.acp.setConfigOption(key, configId, value);
  }

  setAutoApprove(key: string, enabled: boolean): void {
    if (this.agent === 'dsh') this.acp.setAutoApprove(key, enabled);
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
    return this.acp.prompt(key, blocks, shown);
  }

  /** The agent takes a message while it works; see {@link steer}. */
  get canSteer(): boolean {
    return this.acp.canSteer;
  }

  /**
   * Gives the turn the agent is working on a message. False when no turn took
   * it: send it as a prompt. Commands and shell context wait for a prompt.
   */
  steer(key: string, text: string): Promise<boolean> {
    return this.acp.steer(key, [{ type: 'text', text }]);
  }

  cancel(key: string): void {
    this.acp.cancel(key);
  }

  answerPermission(requestId: number, optionId: string | null): void {
    this.acp.answerPermission(requestId, optionId);
  }

  answerQuestion(requestId: number, action: QuestionAction, content: FormContent | null): void {
    this.acp.answerQuestion(requestId, action, content);
  }

  /** Runs the user's `!command` in the sandbox's workspace; output streams as entries. */
  async runShell(key: string, command: string): Promise<{ exitCode: number; timedOut: boolean }> {
    const sessionId = this.acp.sessionId(key);
    if (!sessionId) throw new Error('This session is not open on the worker');
    const runId = crypto.randomUUID();
    const run: ShellRun = { sessionKey: key, command, output: '' };
    this.shells.set(runId, run);
    this.handlers.entry(key, { t: now(), kind: 'shell', runId, command });
    let result = { exitCode: 1, timedOut: false };
    try {
      result = await this.bridge.runShell(sessionId, runId, command);
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
  authenticate(methodId: string, meta?: Record<string, unknown>): Promise<unknown> {
    return this.acp.authenticate(methodId, meta);
  }

  startTerminal(methodId: string, columns: number, rows: number): Promise<string> {
    return this.bridge.startTerminal(methodId, columns, rows);
  }

  terminalInput(terminalId: string, data: string): Promise<void> {
    return this.bridge.terminalInput(terminalId, data);
  }

  closeTerminal(terminalId: string): Promise<void> {
    return this.bridge.closeTerminal(terminalId);
  }

  setCredentials(credentials: DshCredentials): Promise<void> {
    return this.bridge.setCredentials(credentials);
  }

  restartAgent(): Promise<void> {
    return this.bridge.restartAgent();
  }

  private requireAgent(): AgentName {
    if (!this.agent) throw new Error('The worker did not report its agent');
    return this.agent;
  }
}

/** A request the connection dropped; the worker carries on with it. */
export function isConnectionClosed(error: unknown): boolean {
  return error instanceof ConnectionClosed;
}
