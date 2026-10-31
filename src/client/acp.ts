// The client side of the Agent Client Protocol: sessions, prompts, settings,
// permissions, questions and sign-in, for any ACP agent. Nothing here depends
// on which agent answers; what it can do comes from its `initialize` answer
// (capabilities, sign-in methods) and from each session's settings.
//
// The code flower bridge adds a few `_meta` fields, which other agents never
// send: `codeflower/replayed` on requests it sends again to a window that
// reattaches, and `codeflower/busy` / `codeflower/transcriptEntries` on
// resumes. They are read where present and otherwise ignored. A bridge that
// serves several windows at once says so with `codeflower/multiClient` in its
// `initialize` answer: it then tells every window with a chat open of each
// prompt (`_codeflower/prompted`), this window's own too, and of requests
// another window answered (`_codeflower/requestResolved`, matched by the
// request's `codeflower/requestKey`).
//
// Agents that take a message while they work (ACP steering, `_session/steering`:
// Claude Code, Codex) say so with `steering.supported` in their `initialize`
// answer's `_meta`. The bridge echoes such a message like a prompt and marks its
// answer with `codeflower/prompted`.
import type {
  AgentCapabilities,
  AuthMethod,
  ContentBlock,
  Implementation,
  InitializeResponse,
  NewSessionResponse,
  PromptCapabilities,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionNotification,
  SetSessionConfigOptionResponse,
  StopReason
} from '@agentclientprotocol/sdk';
import type {
  FormContent,
  FormSchema,
  PendingPermission,
  PendingQuestion,
  QuestionAction,
  TranscriptEntry
} from '../protocol/messages.ts';
import { isMethodNotFound, RpcError, type RpcConnection } from './rpc.ts';

export const PROTOCOL_VERSION = 1;
export const AUTH_REQUIRED = -32000;

const REPLAYED_META = 'codeflower/replayed';
const REQUEST_KEY_META = 'codeflower/requestKey';
const MULTI_CLIENT_META = 'codeflower/multiClient';
const PROMPTED_META = 'codeflower/prompted';
const STEER_METHOD = '_session/steering';

/** What session/new, session/resume, and session/load may report about settings. */
interface SessionSettings {
  configOptions?: SessionConfigOption[] | null;
  modes?: SessionModeState | null;
  _meta?: {
    /** How many transcript entries the worker had recorded when it attached the session here. */
    'codeflower/transcriptEntries'?: number;
    /** The agent was working on the session (a turn started by an earlier connection). */
    'codeflower/busy'?: boolean;
  } | null;
}

/** A session attached on this connection. */
export interface AttachedSession {
  key: string;
  /** The live updates start after this many transcript entries; unknown from agents without a recorder. */
  transcriptEntries?: number;
}

/** A URL the agent asks the user to open, e.g. a device-code sign-in. */
export interface UrlElicitation {
  url: string;
  message: string;
  elicitationId?: string;
}

export interface AcpHandlers {
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
}

export interface ClientIdentity {
  name: string;
  title?: string;
  version: string;
}

/** Agents with only the older modes API get their modes as a config option. */
function modeOption(modes: SessionModeState): SessionConfigOption {
  return {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: modes.currentModeId,
    options: modes.availableModes.map((mode) => ({ value: mode.id, name: mode.name, description: mode.description }))
  };
}

function now(): string {
  return new Date().toISOString();
}

export function isAuthRequired(error: unknown): boolean {
  return error instanceof RpcError && error.code === AUTH_REQUIRED;
}

export class AcpClient {
  authMethods: AuthMethod[] = [];
  capabilities: AgentCapabilities = {};
  agentInfo: Implementation | null = null;
  /** The bridge shows the chats in several windows at once and echoes each prompt to all of them. */
  multiClient = false;
  /** The agent takes a message into the turn it is working on (ACP steering). */
  canSteer = false;

  private readonly rpc: RpcConnection;
  private readonly handlers: AcpHandlers;
  /** The key a session is known by; the agent's session id unless the host keys them otherwise. */
  private readonly keyOf: (sessionId: string) => string;
  /** Native session ids of the sessions attached on this connection, by key. */
  private readonly sessions = new Map<string, string>();
  private readonly replaying = new Set<string>();
  /** Each session's settings; `modesOnly` marks agents that predate config options. */
  private readonly configs = new Map<string, { options: SessionConfigOption[]; modesOnly: boolean }>();
  private nextRequestId = 1;
  private readonly permissions = new Map<
    number,
    {
      resolve: (response: RequestPermissionResponse) => void;
      sessionKey: string;
      request: PendingPermission;
      requestKey?: string;
    }
  >();
  private readonly questions = new Map<
    number,
    {
      resolve: (response: { action: QuestionAction; content?: FormContent }) => void;
      sessionKey: string;
      request: PendingQuestion;
      requestKey?: string;
    }
  >();
  private readonly autoApprovedSessions = new Set<string>();
  /** Sessions with a prompt in flight. */
  private readonly busySessions = new Set<string>();
  /** Sessions with a turn an earlier connection started, as the worker reports. */
  private readonly remoteBusy = new Set<string>();

  constructor(rpc: RpcConnection, handlers: AcpHandlers, keyOf: (sessionId: string) => string = (id) => id) {
    this.rpc = rpc;
    this.handlers = handlers;
    this.keyOf = keyOf;
    rpc.on('session/update', (params) => this.update(params as SessionNotification));
    rpc.on('elicitation/complete', (params) =>
      this.handlers.elicitationComplete(String((params as { elicitationId?: unknown }).elicitationId ?? ''))
    );
    rpc.handle('session/request_permission', (params) => this.requestPermission(params as RequestPermissionRequest));
    rpc.handle('elicitation/create', (params) => this.elicit(params as ElicitationRequest));
    rpc.on('_codeflower/prompted', (params) => this.prompted(params as PromptedNotification));
    rpc.on('_codeflower/requestResolved', (params) => this.resolved(params as ResolvedNotification));
    rpc.onClose(() => this.closed());
  }

  async initialize(client: ClientIdentity): Promise<InitializeResponse> {
    const initialized = await this.rpc.request<InitializeResponse>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        // Sign-ins run in a terminal inside the sandbox (Claude Code) or as a
        // link the user opens (Codex device code).
        auth: { terminal: true },
        // Forms carry the agent's questions; Claude Code offers AskUserQuestion only with them.
        elicitation: { url: {}, form: {} },
        _meta: { 'terminal-auth': true }
      },
      clientInfo: client
    });
    this.authMethods = initialized.authMethods ?? [];
    this.capabilities = initialized.agentCapabilities ?? {};
    this.agentInfo = initialized.agentInfo ?? null;
    this.multiClient = initialized._meta?.[MULTI_CLIENT_META] === true;
    this.canSteer = (initialized._meta as { steering?: { supported?: unknown } } | null | undefined)?.steering?.supported === true;
    return initialized;
  }

  /** What the agent accepts in a prompt besides text. */
  get promptCapabilities(): PromptCapabilities {
    return this.capabilities.promptCapabilities ?? {};
  }

  // ---- sessions ----

  isAttached(key: string): boolean {
    return this.sessions.has(key);
  }

  sessionId(key: string): string | undefined {
    return this.sessions.get(key);
  }

  keys(): string[] {
    return [...this.sessions.keys()];
  }

  async newSession(cwd: string): Promise<string> {
    const response = await this.rpc.request<NewSessionResponse>('session/new', { cwd, mcpServers: [] });
    const key = this.attach(response.sessionId);
    this.setConfig(key, response);
    return key;
  }

  /**
   * Attaches an existing session on this connection, with `session/resume`
   * where the agent offers it and `session/load` otherwise. An agent that
   * advertises neither is asked anyway, resume first. The agent may still have
   * the session loaded, even mid-turn, from an earlier connection.
   */
  async resumeSession(sessionId: string, cwd: string): Promise<AttachedSession> {
    const existing = this.keyOf(sessionId);
    if (this.sessions.has(existing)) return { key: existing };
    const params = { sessionId, cwd, mcpServers: [] };
    const resume = !!this.capabilities.sessionCapabilities?.resume;
    const load = !!this.capabilities.loadSession;
    const methods = resume || !load ? ['session/resume', 'session/load'] : ['session/load', 'session/resume'];
    // The client shows the history from its own transcript; a load's replay is dropped.
    this.replaying.add(sessionId);
    let response: SessionSettings | null = null;
    try {
      for (const [index, method] of methods.entries()) {
        try {
          response = await this.rpc.request<SessionSettings | null>(method, params);
          break;
        } catch (error) {
          if (!isMethodNotFound(error) || index === methods.length - 1) throw error;
        }
      }
    } finally {
      this.replaying.delete(sessionId);
    }
    const key = this.attach(sessionId);
    this.setConfig(key, response ?? {});
    const meta = response?._meta;
    // A turn an earlier connection started is still running.
    if (meta?.['codeflower/busy']) this.setRemoteBusy(key, true);
    const transcriptEntries = meta?.['codeflower/transcriptEntries'];
    return { key, ...(typeof transcriptEntries === 'number' ? { transcriptEntries } : {}) };
  }

  /** What a session is doing now, for a chat that opens mid-turn. */
  activity(key: string): { busy: boolean; permission: PendingPermission | null; question: PendingQuestion | null } {
    const find = <T>(map: Map<number, { sessionKey: string; request: T }>) =>
      [...map.values()].find((pending) => pending.sessionKey === key)?.request ?? null;
    return { busy: this.isBusy(key), permission: find(this.permissions), question: find(this.questions) };
  }

  config(key: string): SessionConfigOption[] {
    return this.configs.get(key)?.options ?? [];
  }

  async setConfigOption(key: string, configId: string, value: string | boolean): Promise<void> {
    const sessionId = this.sessions.get(key);
    const config = this.configs.get(key);
    if (!sessionId || !config) throw new Error('This session is not open on the worker');
    if (config.modesOnly) {
      await this.rpc.request('session/set_mode', { sessionId, modeId: String(value) });
      this.applyMode(key, String(value));
      return;
    }
    const response = await this.rpc.request<SetSessionConfigOptionResponse>(
      'session/set_config_option',
      typeof value === 'boolean' ? { sessionId, configId, type: 'boolean', value } : { sessionId, configId, value }
    );
    this.configs.set(key, { options: response.configOptions, modesOnly: false });
    this.handlers.config(key, response.configOptions);
  }

  /**
   * Sends a prompt. `shown` is what the chat records as the user's message;
   * `blocks` is what the agent gets, which may carry more (e.g. context).
   */
  async prompt(key: string, blocks: ContentBlock[], shown: ContentBlock[] = blocks): Promise<StopReason> {
    const sessionId = this.sessions.get(key);
    if (!sessionId) throw new Error('This session is not open on the worker');
    // A bridge for several windows echoes it when the turn starts (`prompted`).
    if (!this.multiClient) this.handlers.entry(key, { t: now(), kind: 'prompt', prompt: shown });
    this.busySessions.add(key);
    this.handlers.busy(key, true);
    try {
      const response = await this.rpc.request<PromptResponse>('session/prompt', { sessionId, prompt: blocks });
      this.handlers.entry(key, { t: now(), kind: 'turn_end', stopReason: response.stopReason });
      return response.stopReason;
    } finally {
      this.busySessions.delete(key);
      // A dropped connection leaves the turn running on the worker.
      if (this.rpc.connected) this.handlers.busy(key, this.isBusy(key));
    }
  }

  /**
   * Gives the turn the agent is working on a message (ACP steering). False
   * when no turn took it, e.g. it just ended: the caller sends it as a prompt.
   */
  async steer(key: string, blocks: ContentBlock[]): Promise<boolean> {
    const sessionId = this.sessions.get(key);
    if (!sessionId) throw new Error('This session is not open on the worker');
    const response = await this.rpc.request<SteerResponse>(STEER_METHOD, {
      sessionId,
      prompt: blocks,
      _meta: { steering: { idleBehavior: 'promptRequired' } }
    });
    // Codex may start a turn of its own; the message got there either way.
    if (response?.outcome !== 'injected' && response?.outcome !== 'startedNewTurn') return false;
    if (!response._meta?.[PROMPTED_META]) this.handlers.entry(key, { t: now(), kind: 'prompt', prompt: blocks });
    return true;
  }

  cancel(key: string): void {
    const sessionId = this.sessions.get(key);
    if (!sessionId) return;
    this.dropPending(key);
    this.rpc.notify('session/cancel', { sessionId });
  }

  /** Answers the chat's open permission requests and questions as cancelled. */
  dropPending(key: string): void {
    for (const [requestId, pending] of this.permissions) {
      if (pending.sessionKey === key) this.answerPermission(requestId, null);
    }
    for (const [requestId, pending] of this.questions) {
      if (pending.sessionKey === key) this.answerQuestion(requestId, 'cancel', null);
    }
  }

  answerPermission(requestId: number, optionId: string | null): void {
    const pending = this.permissions.get(requestId);
    if (!pending) return;
    this.permissions.delete(requestId);
    const outcome = optionId ? ({ outcome: 'selected', optionId } as const) : ({ outcome: 'cancelled' } as const);
    this.handlers.entry(pending.sessionKey, { t: now(), kind: 'permission_outcome', outcome });
    this.handlers.permission(pending.sessionKey, null);
    pending.resolve({ outcome });
  }

  setAutoApprove(key: string, enabled: boolean): void {
    if (!enabled) {
      this.autoApprovedSessions.delete(key);
      return;
    }
    this.autoApprovedSessions.add(key);
    for (const [requestId, pending] of this.permissions) {
      if (pending.sessionKey === key) this.autoApprovePermission(requestId, pending.request);
    }
  }

  answerQuestion(requestId: number, action: QuestionAction, content: FormContent | null): void {
    const pending = this.questions.get(requestId);
    if (!pending) return;
    this.questions.delete(requestId);
    this.handlers.entry(pending.sessionKey, { t: now(), kind: 'question_outcome', action, content });
    this.handlers.question(pending.sessionKey, null);
    pending.resolve(action === 'accept' ? { action, content: content ?? {} } : { action });
  }

  /** Marks a session busy with a turn another connection started (or not any more). */
  setRemoteBusy(key: string, busy: boolean): void {
    const before = this.isBusy(key);
    if (busy) this.remoteBusy.add(key);
    else this.remoteBusy.delete(key);
    if (this.isBusy(key) !== before) this.handlers.busy(key, !before);
  }

  /** Answers every open request as cancelled, e.g. before the connection closes. */
  dropAll(): void {
    for (const [requestId] of this.permissions) this.answerPermission(requestId, null);
    for (const [requestId] of this.questions) this.answerQuestion(requestId, 'cancel', null);
  }

  // ---- sign-in ----

  /** Sign-in the agent handles itself, e.g. an API key or a device code (`agent` and `env_var` methods). */
  authenticate(methodId: string, meta?: Record<string, unknown>): Promise<unknown> {
    return this.rpc.request('authenticate', { methodId, ...(meta ? { _meta: meta } : {}) });
  }

  // ---- internals ----

  private isBusy(key: string): boolean {
    return this.busySessions.has(key) || this.remoteBusy.has(key);
  }

  private attach(sessionId: string): string {
    const key = this.keyOf(sessionId);
    this.sessions.set(key, sessionId);
    return key;
  }

  private keyFor(sessionId: string): string | undefined {
    const key = this.keyOf(sessionId);
    return this.sessions.has(key) ? key : undefined;
  }

  private setConfig(key: string, settings: SessionSettings): void {
    const options = settings.configOptions ?? (settings.modes ? [modeOption(settings.modes)] : []);
    this.configs.set(key, { options, modesOnly: !settings.configOptions && !!settings.modes });
    this.handlers.config(key, options);
  }

  /** Mode changes the agent made itself, e.g. leaving plan mode. */
  private applyMode(key: string, modeId: string): void {
    const config = this.configs.get(key);
    if (!config) return;
    config.options = config.options.map((option) =>
      option.category === 'mode' && option.type === 'select' ? { ...option, currentValue: modeId } : option
    );
    this.handlers.config(key, config.options);
  }

  /** A prompt started, from this window or another; the agent gets the shell context too, the chat hides it. */
  private prompted(params: PromptedNotification): void {
    const key = typeof params?.sessionId === 'string' ? this.keyFor(params.sessionId) : undefined;
    if (!key || !Array.isArray(params.prompt)) return;
    this.handlers.entry(key, { t: now(), kind: 'prompt', prompt: params.prompt });
  }

  /** Another window answered a request this one shows too (or the bridge did): it closes here, with that answer. */
  private resolved(params: ResolvedNotification): void {
    const requestKey = params?.requestKey;
    if (typeof requestKey !== 'string') return;
    const result = (params.result ?? {}) as { outcome?: RequestPermissionResponse['outcome']; action?: QuestionAction; content?: FormContent };
    for (const [requestId, pending] of this.permissions) {
      if (pending.requestKey !== requestKey) continue;
      this.permissions.delete(requestId);
      const outcome = result.outcome ?? ({ outcome: 'cancelled' } as const);
      this.handlers.entry(pending.sessionKey, { t: now(), kind: 'permission_outcome', outcome });
      this.handlers.permission(pending.sessionKey, null);
      // The bridge drops this window's answer; it only ends the request here.
      pending.resolve({ outcome });
    }
    for (const [requestId, pending] of this.questions) {
      if (pending.requestKey !== requestKey) continue;
      this.questions.delete(requestId);
      const action = result.action ?? 'cancel';
      this.handlers.entry(pending.sessionKey, { t: now(), kind: 'question_outcome', action, content: result.content ?? null });
      this.handlers.question(pending.sessionKey, null);
      pending.resolve(action === 'accept' ? { action, content: result.content ?? {} } : { action });
    }
  }

  /** Every update reaches the chat, kinds it does not know too; settings updates also change the settings. */
  private update(notification: SessionNotification): void {
    if (this.replaying.has(notification.sessionId)) return;
    const key = this.keyFor(notification.sessionId);
    if (!key) return;
    const update = notification.update;
    if (update.sessionUpdate === 'config_option_update') {
      this.configs.set(key, { options: update.configOptions, modesOnly: false });
      this.handlers.config(key, update.configOptions);
    } else if (update.sessionUpdate === 'current_mode_update') {
      this.applyMode(key, update.currentModeId);
    }
    this.handlers.entry(key, { t: now(), kind: 'update', update });
  }

  private requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const key = this.keyFor(request.sessionId) ?? this.keyOf(request.sessionId);
    const requestId = this.nextRequestId++;
    if (!request._meta?.[REPLAYED_META]) {
      this.handlers.entry(key, { t: now(), kind: 'permission', toolCall: request.toolCall ?? null, options: request.options });
    }
    return new Promise<RequestPermissionResponse>((resolve) => {
      const pending = { requestId, toolCall: request.toolCall ?? null, options: request.options };
      this.permissions.set(requestId, { resolve, sessionKey: key, request: pending, ...requestKeyOf(request._meta) });
      if (this.autoApprovedSessions.has(key) && this.autoApprovePermission(requestId, pending)) return;
      this.handlers.permission(key, pending);
    });
  }

  private autoApprovePermission(requestId: number, request: PendingPermission): boolean {
    const allow = request.options.find((option) => option.kind === 'allow_once');
    if (!allow) return false;
    this.answerPermission(requestId, allow.optionId);
    return true;
  }

  private async elicit(request: ElicitationRequest): Promise<unknown> {
    if (request.mode === 'form' || (request.mode === undefined && request.requestedSchema)) {
      const key = request.sessionId ? this.keyFor(request.sessionId) : undefined;
      // Forms belong in a chat; one for no open session cannot be shown.
      if (!key) return { action: 'decline' };
      const question = { message: request.message ?? '', requestedSchema: request.requestedSchema ?? {} };
      const requestId = this.nextRequestId++;
      if (!request._meta?.[REPLAYED_META]) {
        this.handlers.entry(key, {
          t: now(),
          kind: 'question',
          ...question,
          ...(request.toolCallId ? { toolCallId: request.toolCallId } : {})
        });
      }
      return new Promise((resolve) => {
        const pending = { requestId, ...question };
        this.questions.set(requestId, { resolve, sessionKey: key, request: pending, ...requestKeyOf(request._meta) });
        this.handlers.question(key, pending);
      });
    }
    if (request.mode !== 'url' || typeof request.url !== 'string') return { action: 'decline' };
    const action = await this.handlers.elicitUrl({
      url: request.url,
      message: request.message ?? 'Open this link to continue.',
      ...(request.elicitationId ? { elicitationId: request.elicitationId } : {})
    });
    return { action };
  }

  /**
   * The agent keeps working without this connection: open requests are asked
   * again when the session is reattached, so they are only hidden here.
   */
  private closed(): void {
    this.permissions.clear();
    this.questions.clear();
    for (const key of this.sessions.keys()) {
      this.handlers.permission(key, null);
      this.handlers.question(key, null);
    }
    this.sessions.clear();
    this.remoteBusy.clear();
  }
}

function requestKeyOf(meta: Record<string, unknown> | null | undefined): { requestKey?: string } {
  const requestKey = meta?.[REQUEST_KEY_META];
  return typeof requestKey === 'string' ? { requestKey } : {};
}

interface SteerResponse {
  outcome?: 'injected' | 'promptRequired' | 'startedNewTurn' | 'failed';
  _meta?: Record<string, unknown> | null;
}

interface PromptedNotification {
  sessionId?: string;
  prompt?: ContentBlock[];
}

interface ResolvedNotification {
  requestKey?: string;
  result?: unknown;
}

interface ElicitationRequest {
  mode?: string;
  url?: string;
  message?: string;
  elicitationId?: string;
  sessionId?: string;
  requestedSchema?: FormSchema;
  toolCallId?: string;
  _meta?: Record<string, unknown>;
}
