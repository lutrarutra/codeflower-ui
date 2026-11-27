// What the code flower bridge adds to ACP: `_codeflower/*` methods and
// notifications for the worker's status, recorded sessions, files, the
// user's shell commands, sign-in terminals, usage and subagents. An agent reached without
// the bridge answers none of them, and the chat works without them.
import type { ContentBlock } from '@agentclientprotocol/sdk';
import type {
  ActionPromptMeta,
  AgentName,
  AgentPresentation,
  ChatAction,
  QueuedPromptSummary,
  QueuePaused,
  SandboxFile,
  TranscriptEntry
} from '../protocol/messages.ts';
import type { AgentCommand } from '../protocol/commands.ts';
import type { BatchJob, JobsSummary } from '../protocol/jobs.ts';
import type { Watch, WatchesSummary } from '../protocol/watches.ts';
import type { Orchestrator, OrchestratorAccess, OrchestratorsSummary } from '../protocol/orchestrators.ts';
import type { SentEntry } from '../protocol/messages.ts';
import type { Idea, IdeaPatch, RootsMap } from '../protocol/roots.ts';
import type { BrowserFrame, BrowserInputEvent, BrowserNavigation, BrowserState } from '../protocol/browser.ts';
import type { UsageTotals, WorkerUsage } from '../protocol/usage.ts';
import type { OpenedSubagent, SubagentFeatures, SubagentSettings, SubagentSettingsState, SubagentSummary } from '../protocol/subagents.ts';
import { RpcError, isMethodNotFound, type RpcConnection } from './rpc.ts';

export const WORKSPACE = '/codeflower-state/workspace';

/** An older bridge closes a connection with this code when another window takes the worker over. */
export const TAKEN_OVER = 4001;

/**
 * Part of a chat's transcript: `entries` from index `start` on, and `context`,
 * entries from before it the view needs (the agent's slash commands).
 */
export interface TranscriptPage {
  entries: TranscriptEntry[];
  start: number;
  context: TranscriptEntry[];
}

export const EMPTY_TRANSCRIPT: TranscriptPage = { entries: [], start: 0, context: [] };

// The worker's limit for files/read, and the images browsers show.
const MAX_READ_BYTES = 10 * 1024 * 1024;
const BROWSER_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const PREVIEW_HEIGHT = 4096;

// About 1 MiB per page; the worker caps it well under a message's 16 MiB.
const TRANSCRIPT_PAGE_BYTES = 1 << 20;

/** The page without the entries after the first `count`, e.g. those that came live after an attach. */
export function pageUpTo(page: TranscriptPage, count: number | undefined): TranscriptPage {
  return count === undefined ? page : { ...page, entries: page.entries.slice(0, Math.max(0, count - page.start)) };
}

/**
 * One agent of the sandbox (`_codeflower/agents`): how windows show it, whether it can run here and is
 * signed in, and what it offers.
 */
export interface AgentState extends AgentPresentation {
  name: string;
  /** Why the agent cannot run in this sandbox, e.g. Claude Code was not downloaded. */
  unavailable?: string;
  signedIn: boolean;
  /** 'agent': the agent signs in itself (ACP); 'keys': code flower stores keys for it (dsh). */
  credentials: 'agent' | 'keys';
  running: boolean;
  /** The running agent takes changed keys or settings only when it starts again. */
  restartPending: boolean;
  capabilities: {
    plugins?: boolean;
    /** Chats open in the agent's own terminal UI (`codeflower attach`). */
    chatTerminals?: boolean;
    /** What the agent tells of its subagents; missing for agents without them in code flower. */
    subagents?: SubagentFeatures;
    /** The commands its chats run (`_codeflower/commands/*`), to watch read-only. */
    commands?: boolean;
    /** The chats' prompt queues are on the worker (`_codeflower/queue/*`). */
    promptQueue?: boolean;
  };
}

/** A chat's prompts waiting on the worker, as every window with it open shows them. */
export interface WorkerQueue {
  items: QueuedPromptSummary[];
  paused?: QueuePaused;
  /** All of them go in the next turn, as one prompt. */
  together?: boolean;
}

/** A queued prompt taken back from the worker: what the user wrote, and what the agent would get. */
export interface TakenPrompt extends QueuedPromptSummary {
  text: string;
  prompt: ContentBlock[];
  action?: ActionPromptMeta;
}

/**
 * The sandbox, as `_codeflower/status` says: on an agent's connection also that agent (`agent` …
 * `credentials`), on the sandbox's own only the sandbox.
 */
export interface WorkerStatus {
  instanceId: string;
  agent?: AgentName;
  agentLabel?: string;
  /** The agent's presentation from its descriptor. */
  agentInfo?: Partial<AgentPresentation>;
  signedIn?: boolean;
  /** 'agent': the agent signs in itself (ACP); 'keys': code flower stores keys for it (dsh). */
  credentials?: 'agent' | 'keys';
  /** Every agent of the sandbox. */
  agents: AgentState[];
  /** Sending files both ways, as an agent's `initialize` says it. */
  files?: FileTransfers;
  stateDirectory: string | null;
  /** The workspace's own folder on the host, when the app mounts it from outside the project (workspace_dir). */
  workspaceDirectory?: string | null;
  engine: string;
  slurmJobId?: string;
  /** When the batch job ends (ISO 8601); chats are asked to wrap up before. Missing without a known end. */
  allocationEnd?: string;
  /** Batch jobs the agents may ask for (codeflower-job); missing when the worker has none. */
  jobs?: JobsSummary;
  /** The agents' watches (codeflower-watch); missing from older workers. */
  watches?: WatchesSummary;
  /** Orchestrator chats (`_codeflower/orchestrators/*`), of these agents; missing from older workers. */
  orchestrators?: OrchestratorsSummary;
  /** The worker keeps the project's map of ideas (`_codeflower/roots/*`); missing from older workers. */
  roots?: boolean;
  /** The worker forks chats (`_codeflower/sessions/fork`), and tells of new ones (`sessions/changed`); missing from older workers. */
  forkChats?: boolean;
  /** Folders the app mounted, e.g. /data/input/study42; missing from older workers. */
  mounts?: Mount[];
  /** What the worker offers beyond chats; on an agent's connection also that agent's. */
  capabilities?: AgentState['capabilities'] & {
    /** The user's shells in the sandbox (the page's Terminal). */
    shellTerminals?: boolean;
    /** The page's search (`_codeflower/search/*`): files by name and contents, and what chats say. */
    search?: boolean;
  };
}

/** A chat open in the agent's own terminal UI (`codeflower attach`), running in the sandbox. */
export interface ChatTerminal {
  terminalId: string;
  /** Missing from workers older than shells. */
  kind?: 'chat';
  sessionKey: string;
  sessionId: string;
  /** shared: the chat goes on here too (OpenCode, Codex); handoff: the terminal has it (Claude Code). */
  mode: 'shared' | 'handoff';
  /** Terminals that watch it now. */
  viewers: number;
  startedAt: string;
}

/** The user's shell, running in the sandbox until it ends or is closed. */
export interface ShellTerminal {
  terminalId: string;
  kind: 'shell';
  /** Windows that show it now. */
  viewers: number;
  startedAt: string;
}

/** The terminals a worker lists: chats' terminal UIs and the user's shells. */
export function splitTerminals(terminals: (ChatTerminal | ShellTerminal)[]): { chats: ChatTerminal[]; shells: ShellTerminal[] } {
  return {
    chats: terminals.filter((terminal): terminal is ChatTerminal => terminal.kind !== 'shell'),
    shells: terminals.filter((terminal): terminal is ShellTerminal => terminal.kind === 'shell')
  };
}

/** What a plugin adds, when known before it is fetched. */
export interface PluginContents {
  commands: number;
  skills: number;
  agents: number;
  hooks: boolean;
  mcpServers: boolean;
  lspServers: boolean;
}

/** One of the agent's plugins in the project (docs/plugins.md). */
export interface PluginEntry {
  /** `agent:source`. */
  id: string;
  /** marketplace:NAME@CATALOG, github:OWNER/REPO[#REF], git:URL[#REF], npm:PACKAGE@VERSION, url:…, path:/… */
  source: string;
  kind: string;
  /** config: from the app's config.yaml (switched off, not removed, per project); project: added here. */
  origin: 'config' | 'project';
  enabled: boolean;
  /**
   * pending: not fetched yet; fetching; error: the fetch failed; fetched: the
   * agent gets it at its next start; active: the agent runs with it; disabled.
   */
  state: 'pending' | 'fetching' | 'error' | 'fetched' | 'active' | 'disabled';
  version?: string;
  error?: string;
  fetchedAt?: string;
}

/** A plugin the agent has of its own, installed outside code flower; shown, not changed. */
export interface NativePlugin {
  name: string;
  version?: string;
  enabled: boolean;
  origin: 'native';
}

export interface PluginCatalog {
  /** Known once fetched, or from the agent's descriptor. */
  name?: string;
  source: string;
  /** agent: comes with the agent; project: added here. */
  origin: 'agent' | 'project';
  fetched: boolean;
  error?: string;
}

export interface PluginsOverview {
  /** False: this agent has no plugins in code flower. */
  available: boolean;
  /** The source kinds the agent takes. */
  kinds?: string[];
  /** The sandbox reaches the network: adding fetches at once. Otherwise the app fetches (codeflower plugins fetch). */
  canFetch?: boolean;
  fetching?: boolean;
  /** Something changed since the agent started: restart it to apply. */
  restartPending?: boolean;
  /** Catalogs can be browsed. */
  browsable?: boolean;
  entries?: PluginEntry[];
  native?: NativePlugin[];
  catalogs?: PluginCatalog[];
}

export interface CatalogPlugin {
  name: string;
  displayName?: string;
  description: string;
  category?: string;
  version?: string;
  homepage?: string;
  author?: string;
  /** The source to add it with. */
  source: string;
  /** Unknown for plugins outside the catalog's own repository until fetched. */
  contents?: PluginContents;
}

export interface Mount {
  target: string;
  /** The folder on the machine that runs the sandbox. */
  source: string;
  readOnly: boolean;
}

export interface SessionRecord {
  key: string;
  harness: AgentName;
  nativeSessionId: string;
  cwd: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  openOn?: string;
  /** The session's tokens and cost so far; missing from older workers. */
  usage?: UsageTotals | null;
  /** Where the chat came from: a fork of another, or a chat another chat started (codeflower-chat). */
  origin?: SessionOrigin;
  /** An orchestrator's chat: the chat it directs, and what it may do. */
  role?: 'orchestrator';
  executor?: string;
  access?: OrchestratorAccess;
  disconnected?: boolean;
}

/**
 * Where a chat came from (`_codeflower/sessions/list`): `fork`, of the chat `from` (before the
 * user's message `before`, from 1, else all of it; `by` the chat that forked it, none for the
 * user); `agent`, started by the chat `from`.
 */
export type SessionOrigin =
  | { kind: 'fork'; from: string; before?: number; by?: string; native?: boolean }
  | { kind: 'agent'; from: string };

/** What `_codeflower/sessions/fork` made: the new chat, and the message it went before, to offer again. */
export interface ForkedSession {
  key: string;
  agent: AgentName;
  title: string;
  /** Whether the agent forked it itself; else the chat brings the history with its first message. */
  native: boolean;
  draft?: string;
}

/** What the worker's agents are doing, sent by the worker whenever it changes. */
export interface WorkerActivity {
  /** `turn`: whether a turn runs (a chat can wait for the user without one); older workers leave it out. */
  chats: { key: string; state: 'working' | 'waiting'; waitingFor?: 'plan' | 'permission' | 'question' | 'browser'; turn?: boolean }[];
  working: number;
  waiting: number;
}

/** The worker asked its chats to wrap up: the batch job ends soon, or the client that started it quits. */
export interface WrapUpNotice {
  /** time: the batch job ends (older bridges send no reason); quit: the client that started the sandbox quits. */
  reason?: 'time' | 'quit';
  /** When the job ends; only for time. */
  end?: string;
  /** Until the job ends, or at most how long the quitting client waits. */
  minutes: number;
  /** How many chats were asked to wrap up. */
  chats: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtimeMs: number;
  mimeType?: string;
  /** Folders: whether files may be sent to it. Absent from older bridges. */
  writable?: boolean;
}

export interface DirectoryListing {
  path: string;
  /** Whether files may be sent to this folder. Absent from older bridges. */
  writable?: boolean;
  entries: DirectoryEntry[];
  truncated: boolean;
}

/** A file whose path matches a search, from `_codeflower/search/paths`. */
export interface FoundPath {
  path: string;
  /** Its path in its folder (`root`), e.g. figures/umap.svg. */
  relative: string;
  /** The folder's name: Workspace, Inputs/study42, … */
  folder: string;
  root: string;
}

/** A piece of text with a match in it: `text.slice(start, start + length)`. */
export interface FoundText {
  text: string;
  start: number;
  length: number;
}

/** A file with lines that have the search, from `_codeflower/search/contents`. */
export interface FoundInFile extends FoundPath {
  lines: (FoundText & { line: number })[];
}

/** A chat whose prompts or replies have the search, from `_codeflower/search/chats`. */
export interface FoundInChat {
  key: string;
  title: string;
  harness: string;
  updatedAt: string;
  /** How many times the chat has it. */
  count: number;
  /** The first few, with who said it and the transcript entry it starts on. */
  places: (FoundText & { role: 'user' | 'agent' | 'peer'; entry: number })[];
}

/** What a bridge says in `initialize` (`_meta['codeflower/files']`) about sending files both ways. */
export interface FileTransfers {
  upload: { maxBytes: number; chunkBytes: number; folders: boolean };
  download: { chunkBytes: number; folders: boolean };
}

/** Where a file sent to the sandbox goes: a folder, and its path below it (a dropped folder's structure). */
export interface UploadTarget {
  dir: string;
  relativePath: string;
  /** On a clash: a numbered name, or over the existing file. */
  conflict: 'number' | 'replace';
}

export interface UploadedFile {
  path: string;
  name: string;
  size: number;
  sha256: string;
  replaced: boolean;
}

export interface DownloadStarted {
  downloadId: string;
  name: string;
  chunkBytes: number;
  /** A file as it is, or a folder as a zip made while it is read. */
  kind: 'file' | 'zip';
  /** file: its size. */
  size?: number;
  /** zip: how much the folder's files hold, and how many there are. */
  sourceBytes?: number;
  files?: number;
}

export interface DownloadChunk {
  data: string;
  done: boolean;
  /** Bytes of the file, or of the folder's files, read so far. */
  progress: number;
  /** With the last chunk. */
  sha256?: string;
}

export interface ShowRequest {
  files: SandboxFile[];
  title?: string;
  message?: string;
  /** The chat the files belong to, e.g. the one asking to approve a plan; else the window picks one. */
  sessionId?: string;
  /** The chat's key, also when it is another agent's than the connection's (newer bridges). */
  key?: string;
  /** The worker noted the files in the chat itself (newer bridges): the window does not record them. */
  noted?: boolean;
  /** Its key, which `WorkerConnection` adds. */
  sessionKey?: string;
}

/** What a chat open here sent its orchestrator (`_codeflower/sent`). */
export interface SentNotice {
  key: string;
  sessionId: string;
  entry: SentEntry;
}

/** Files the agent showed in a chat open here, which another window opened (`_codeflower/shown`). */
export interface ShownNotice {
  key: string;
  sessionId: string;
  files: string[];
  message?: string;
}

/**
 * A model an OpenAI-compatible endpoint serves, as `_codeflower/credentials/models` lists it: what the endpoint
 * says of it. `reasoning` is missing when the endpoint does not say; `false` turns the agent's effort picker off.
 */
export interface EndpointModel {
  id: string;
  name?: string;
  contextWindow?: number;
  input?: ('text' | 'image')[];
  reasoning?: boolean;
}

/**
 * Whether an OpenAI-compatible endpoint answers (`modelsStatus`: its `GET /models`) and takes the key
 * (`keyAccepted`, missing when it cannot tell or no key was given), as `_codeflower/credentials/check` finds.
 */
export interface EndpointCheck {
  reachable: boolean;
  error?: string;
  modelsStatus?: number;
  keyStatus?: number;
  keyAccepted?: boolean;
}

/** The keys an agent has saved, and its OpenAI-compatible route to edit, without the key, from `_codeflower/credentials/get`. */
export interface SavedCredentials {
  deepseekKey: boolean;
  openaiCompatible?: { baseURL: string; models: EndpointModel[]; reasoningEfforts: string[]; hasKey: boolean };
}

export interface DshCredentials {
  deepseekApiKey?: string;
  /**
   * `models` takes ids, or entries as listed (older bridges take ids only). A blank `apiKey` keeps the one saved for
   * the same `baseURL`.
   */
  openaiCompatible?: { baseURL: string; models: (string | EndpointModel)[]; reasoningEfforts?: string[]; apiKey: string };
}

export interface CodeflowerHandlers {
  shellOutput(runId: string, data: string): void;
  /** Another window ran a shell command in a chat open here (bridges for several windows). */
  shellStarted(run: { sessionId: string; runId: string; command: string }): void;
  shellEnded(run: { sessionId: string; runId: string; exitCode: number; timedOut: boolean }): void;
  /** The agent ran `codeflower-show`: the user should see these files. */
  show(request: ShowRequest): void;
  /** Another window opened files the agent showed in a chat open here; the worker noted them in it. */
  shown?(notice: ShownNotice): void;
  /** A chat open here sent its orchestrator a reply or question. */
  sent?(notice: SentNotice): void;
  /** The project's orchestrators changed: one started, its access, its exchange. */
  orchestratorsChanged?(orchestrators: Orchestrator[]): void;
  activity(activity: WorkerActivity): void;
  /** Token counts, cost, or the login's quota of `agent` changed. */
  usage(agent: AgentName, usage: WorkerUsage): void;
  /** An agent started or stopped, or signed in. */
  agents?(agents: AgentState[]): void;
  /** For the worker (no key), or for one chat, with the prompt the worker sent it. */
  wrapUp(notice: WrapUpNotice & { key?: string; prompt?: string }): void;
  /** `replayed`: what the terminal printed before the window attached to it. */
  terminalOutput(terminalId: string, data: string, replayed?: boolean): void;
  terminalExit(terminalId: string, exitCode: number): void;
  /** The agent's plugins changed (added, fetched, switched, or the agent restarted): list them again. */
  pluginsChanged?(agent: AgentName): void;
  /** A chat's terminal UI started, ended, or a terminal attached to it or left. */
  terminals?(terminals: ChatTerminal[]): void;
  /** A shell started, ended, or a window attached to it or left. */
  shells?(shells: ShellTerminal[]): void;
  /** One of a chat's subagents changed (`parentKey`: the chat). */
  subagentChanged?(parentKey: string, subagent: SubagentSummary): void;
  /** The commands a chat's agent runs changed: one started or ended, or a window watches it. */
  commandsChanged?(key: string, commands: AgentCommand[]): void;
  /** An agent's subagent defaults changed, from any window. */
  subagentSettingsChanged?(agent: AgentName, state: SubagentSettingsState): void;
  /** A chat's queue on the worker changed, from any window or a turn's end. */
  queue?(key: string, queue: WorkerQueue): void;
  /** A chat's browser changed: started or stopped, a page, a tab, a dialog, who controls it, a handoff. */
  browserChanged?(browser: BrowserState): void;
  /** A frame of a browser this window watches; `browserAck` it for the next. */
  browserFrame?(frame: BrowserFrame): void;
  /** The project's batch jobs changed: one was submitted, or changed state. */
  jobsChanged?(jobs: BatchJob[]): void;
  /** The project's watches changed: one started, ran, or ended. */
  watchesChanged?(watches: Watch[]): void;
  /** The project's map of ideas changed: an agent or a window changed an idea. */
  rootsChanged?(map: RootsMap): void;
  /** An agent asks to show the map (codeflower-roots open), on an idea; `key`: the chat that asks. */
  rootsOpen?(request: { idea?: number; key?: string }): void;
  /**
   * The worker let go of a chat open here, which the window no longer has: another worker asked for it
   * (`takeover`), or no window had it open (`idle`).
   */
  sessionReleased?(key: string, reason: SessionRelease): void;
  /** Another worker asked for a chat open here (`takeOver`): the worker lets go of it once its turn ended. */
  sessionRequested?(key: string): void;
  /** A chat was forked or started (codeflower-chat): list the chats again. */
  sessionsChanged?(): void;
}

/** Why a worker let go of a chat (`_codeflower/sessions/released`). */
export type SessionRelease = 'takeover' | 'idle';

/** What `_codeflower/sessions/takeOver` did: asked the worker that has the chat, or none has it. */
export type TakeOverResult = { state: 'requested'; holder: string } | { state: 'free' };

/** A notification about one agent carries its name. */
type ForAgent<T> = T & { agent: AgentName };

/**
 * The bridge's methods on one connection. With `agent`, those that are an agent's (its usage, keys,
 * plugins, subagent defaults, restart) name it, as the sandbox's own window must; on an agent's window
 * they are that agent's. With `handlers`, it also takes the bridge's notifications.
 */
export class CodeflowerExtensions {
  private readonly rpc: RpcConnection;
  private readonly agent: AgentName | undefined;

  constructor(rpc: RpcConnection, handlers?: CodeflowerHandlers, agent?: AgentName) {
    this.rpc = rpc;
    this.agent = agent;
    if (handlers) this.listen(handlers);
  }

  /** The same connection, for another agent's methods; it takes no notifications. */
  forAgent(agent: AgentName): CodeflowerExtensions {
    return new CodeflowerExtensions(this.rpc, undefined, agent);
  }

  private named<T extends object>(params: T): T & { agent?: AgentName } {
    return this.agent ? { ...params, agent: this.agent } : params;
  }

  private listen(handlers: CodeflowerHandlers): void {
    const rpc = this.rpc;
    rpc.on('_codeflower/shell/output', (params) => {
      const { runId, data } = params as { runId: string; data: string };
      handlers.shellOutput(runId, data);
    });
    rpc.on('_codeflower/shell/started', (params) =>
      handlers.shellStarted(params as { sessionId: string; runId: string; command: string })
    );
    rpc.on('_codeflower/shell/ended', (params) =>
      handlers.shellEnded(params as { sessionId: string; runId: string; exitCode: number; timedOut: boolean })
    );
    rpc.on('_codeflower/show', (params) => handlers.show(params as ShowRequest));
    rpc.on('_codeflower/shown', (params) => handlers.shown?.(params as ShownNotice));
    rpc.on('_codeflower/sent', (params) => handlers.sent?.(params as SentNotice));
    rpc.on('_codeflower/orchestrators/changed', (params) => {
      const { orchestrators } = params as { orchestrators?: Orchestrator[] };
      if (Array.isArray(orchestrators)) handlers.orchestratorsChanged?.(orchestrators);
    });
    rpc.on('_codeflower/activity', (params) => handlers.activity(params as WorkerActivity));
    rpc.on('_codeflower/usage', (params) => {
      const { agent, ...usage } = params as ForAgent<WorkerUsage>;
      handlers.usage(agent, usage);
    });
    rpc.on('_codeflower/agents', (params) => handlers.agents?.((params as { agents: AgentState[] }).agents));
    rpc.on('_codeflower/wrapUp', (params) => handlers.wrapUp(params as WrapUpNotice & { key?: string; prompt?: string }));
    rpc.on('_codeflower/terminal/output', (params) => {
      const { terminalId, data, replayed } = params as { terminalId: string; data: string; replayed?: boolean };
      handlers.terminalOutput(terminalId, data, replayed === true);
    });
    rpc.on('_codeflower/terminal/exit', (params) => {
      const { terminalId, exitCode } = params as { terminalId: string; exitCode: number };
      handlers.terminalExit(terminalId, exitCode);
    });
    rpc.on('_codeflower/plugins/changed', (params) => handlers.pluginsChanged?.((params as { agent: AgentName }).agent));
    rpc.on('_codeflower/subagents/changed', (params) => {
      const { parentKey, subagent } = params as { parentKey: string; subagent: SubagentSummary };
      handlers.subagentChanged?.(parentKey, subagent);
    });
    rpc.on('_codeflower/commands/changed', (params) => {
      const { key, commands } = params as { key?: string; commands?: AgentCommand[] };
      if (typeof key === 'string' && Array.isArray(commands)) handlers.commandsChanged?.(key, commands);
    });
    rpc.on('_codeflower/subagents/settingsChanged', (params) => {
      const { agent, ...state } = params as ForAgent<SubagentSettingsState>;
      handlers.subagentSettingsChanged?.(agent, state);
    });
    rpc.on('_codeflower/queue', (params) => {
      const { key, items, paused, together } = params as { key?: string } & Partial<WorkerQueue>;
      if (typeof key === 'string' && Array.isArray(items)) {
        handlers.queue?.(key, { items, ...(paused ? { paused } : {}), ...(together === true ? { together: true } : {}) });
      }
    });
    rpc.on('_codeflower/browser/changed', (params) => {
      const { browser } = params as { browser?: BrowserState };
      if (browser && typeof browser.key === 'string') handlers.browserChanged?.(browser);
    });
    rpc.on('_codeflower/browser/frame', (params) => handlers.browserFrame?.(params as BrowserFrame));
    rpc.on('_codeflower/sessions/released', (params) => {
      const { key, reason } = params as { key?: string; reason?: SessionRelease };
      if (typeof key === 'string') handlers.sessionReleased?.(key, reason === 'idle' ? 'idle' : 'takeover');
    });
    rpc.on('_codeflower/sessions/requested', (params) => {
      const { key } = params as { key?: string };
      if (typeof key === 'string') handlers.sessionRequested?.(key);
    });
    rpc.on('_codeflower/sessions/changed', () => handlers.sessionsChanged?.());
    rpc.on('_codeflower/roots/open', (params) => {
      const { idea, key } = (params ?? {}) as { idea?: unknown; key?: unknown };
      handlers.rootsOpen?.({ ...(typeof idea === 'number' ? { idea } : {}), ...(typeof key === 'string' ? { key } : {}) });
    });
    rpc.on('_codeflower/roots/changed', (params) => {
      const map = params as RootsMap;
      if (Array.isArray(map?.ideas)) handlers.rootsChanged?.({ ideas: map.ideas, errors: Array.isArray(map.errors) ? map.errors : [] });
    });
    rpc.on('_codeflower/jobs/changed', (params) => {
      const { jobs } = params as { jobs?: BatchJob[] };
      if (Array.isArray(jobs)) handlers.jobsChanged?.(jobs);
    });
    rpc.on('_codeflower/watches/changed', (params) => {
      const { watches } = params as { watches?: Watch[] };
      if (Array.isArray(watches)) handlers.watchesChanged?.(watches);
    });
    rpc.on('_codeflower/terminal/changed', (params) => {
      const { terminals } = params as { terminals?: (ChatTerminal | ShellTerminal)[] };
      if (!Array.isArray(terminals)) return;
      const { chats, shells } = splitTerminals(terminals);
      handlers.terminals?.(chats);
      handlers.shells?.(shells);
    });
  }

  /**
   * Queues a prompt in a chat on the worker, which sends it once the turn ends, also with no window
   * open. `replace`: instead of the queue, after stopping the turn (an interrupting action).
   */
  async queueAdd(
    key: string,
    prompt: ContentBlock[],
    options: { text: string; title: string; editable?: boolean; action?: ActionPromptMeta; replace?: boolean }
  ): Promise<string> {
    const { replace, ...rest } = options;
    return (await this.rpc.request<{ id: string }>('_codeflower/queue/add', { key, prompt, ...rest, ...(replace ? { mode: 'replace' } : {}) })).id;
  }

  async queueRemove(key: string, id: string): Promise<void> {
    await this.rpc.request('_codeflower/queue/remove', { key, id });
  }

  /** Takes queued prompts back: the one with `id`, or with `editable` the user's own. */
  async queueTake(key: string, which: { id: string } | { editable: true }): Promise<TakenPrompt[]> {
    return (await this.rpc.request<{ items: TakenPrompt[] }>('_codeflower/queue/take', { key, ...which })).items;
  }

  /** Into the running turn where the agent takes messages while it works, else next, after stopping the turn. */
  async queueSendNow(key: string, id: string): Promise<void> {
    await this.rpc.request('_codeflower/queue/sendNow', { key, id });
  }

  async queueResume(key: string): Promise<void> {
    await this.rpc.request('_codeflower/queue/resume', { key });
  }

  /** All the queued prompts in the next turn, as one (`true`), or one per turn. */
  async queueTogether(key: string, together: boolean): Promise<void> {
    await this.rpc.request('_codeflower/queue/together', { key, together });
  }

  /** The chats open in the agent's terminal UI and the user's shells; none from workers without them. */
  async terminals(): Promise<{ chats: ChatTerminal[]; shells: ShellTerminal[] }> {
    try {
      return splitTerminals((await this.rpc.request<{ terminals: (ChatTerminal | ShellTerminal)[] }>('_codeflower/terminal/list', {})).terminals ?? []);
    } catch {
      return { chats: [], shells: [] };
    }
  }

  status(): Promise<WorkerStatus> {
    return this.rpc.request<WorkerStatus>('_codeflower/status', {});
  }

  /** The sandbox's agents. */
  async agents(): Promise<AgentState[]> {
    return (await this.rpc.request<{ agents: AgentState[] }>('_codeflower/agents', {})).agents;
  }

  usage(): Promise<WorkerUsage> {
    return this.rpc.request<WorkerUsage>('_codeflower/usage', this.named({}));
  }

  // ---- the chats' browsers (codeflower-browser) ----

  /** The chats' browsers, and whether the sandbox has one to run; undefined from an older sandbox. */
  async browsers(): Promise<{ available: boolean; browsers: BrowserState[] } | undefined> {
    try {
      return await this.rpc.request<{ available: boolean; browsers: BrowserState[] }>('_codeflower/browser/list', {});
    } catch (error) {
      if (isMethodNotFound(error)) return undefined;
      throw error;
    }
  }

  /** Frames of the chat's browser start coming (`browserFrame`). */
  async browserWatch(key: string, options: { maxWidth?: number; maxHeight?: number; quality?: number } = {}): Promise<void> {
    await this.rpc.request('_codeflower/browser/watch', { key, ...options });
  }

  async browserUnwatch(key: string): Promise<void> {
    await this.rpc.request('_codeflower/browser/unwatch', { key });
  }

  async browserAck(key: string, frameId: number): Promise<void> {
    await this.rpc.request('_codeflower/browser/ack', { key, frameId });
  }

  /** Takes the browser over from the agent (and other windows), or lets it go. */
  async browserControl(key: string, take: boolean): Promise<void> {
    await this.rpc.request('_codeflower/browser/control', { key, take });
  }

  async browserInput(key: string, events: BrowserInputEvent[]): Promise<void> {
    await this.rpc.request('_codeflower/browser/input', { key, events });
  }

  async browserNavigate(key: string, action: BrowserNavigation, url?: string): Promise<void> {
    await this.rpc.request('_codeflower/browser/navigate', { key, action, ...(url !== undefined ? { url } : {}) });
  }

  async browserDialog(key: string, accept: boolean, promptText?: string): Promise<void> {
    await this.rpc.request('_codeflower/browser/dialog', { key, accept, ...(promptText !== undefined ? { promptText } : {}) });
  }

  async browserSelectTab(key: string, targetId: string): Promise<void> {
    await this.rpc.request('_codeflower/browser/selectTab', { key, targetId });
  }

  /** The user is done: the agent gets the browser back, and a message with `note` if it asked for them. */
  async browserHandBack(key: string, note?: string): Promise<void> {
    await this.rpc.request('_codeflower/browser/handBack', { key, ...(note ? { note } : {}) });
  }

  /** Undefined when no bridge answers or when its image predates chat actions. */
  async actions(): Promise<ChatAction[] | undefined> {
    try {
      return (await this.rpc.request<{ actions: ChatAction[] }>('_codeflower/actions/list', {})).actions;
    } catch (error) {
      if (isMethodNotFound(error)) return undefined;
      throw error;
    }
  }

  async listSessions(): Promise<SessionRecord[]> {
    return (await this.rpc.request<{ sessions: SessionRecord[] }>('_codeflower/sessions/list', {})).sessions;
  }

  async transcript(key: string): Promise<TranscriptEntry[]> {
    return (await this.rpc.request<{ entries: TranscriptEntry[] }>('_codeflower/sessions/transcript', { key })).entries;
  }

  /** The newest entries before `before` (the end by default); older workers send the whole transcript. */
  async transcriptPage(key: string, before?: number): Promise<TranscriptPage> {
    const result = await this.rpc.request<{ entries: TranscriptEntry[]; start?: number; context?: TranscriptEntry[] }>(
      '_codeflower/sessions/transcript',
      { key, maxBytes: TRANSCRIPT_PAGE_BYTES, ...(before === undefined ? {} : { before }) }
    );
    return { entries: result.entries, start: result.start ?? 0, context: result.context ?? [] };
  }

  async renameSession(key: string, title: string): Promise<void> {
    await this.rpc.request('_codeflower/sessions/rename', { key, title });
  }

  /** Forks the chat before the user's message at transcript entry `beforeEntry`, or all of it. */
  forkSession(key: string, options: { beforeEntry?: number; title?: string } = {}): Promise<ForkedSession> {
    return this.rpc.request<ForkedSession>('_codeflower/sessions/fork', { key, ...options });
  }

  async deleteSession(key: string): Promise<void> {
    await this.rpc.request('_codeflower/sessions/delete', { key });
  }

  /** On the agent's connection: this window closed the chat, which the worker lets go of once no window has it open. */
  async closeSession(key: string): Promise<void> {
    await this.rpc.request('_codeflower/sessions/close', { key });
  }

  /** Asks the worker that has the chat open to let go of it, which it does once the chat is idle. */
  takeOver(key: string): Promise<TakeOverResult> {
    return this.rpc.request<TakeOverResult>('_codeflower/sessions/takeOver', { key });
  }

  /** Notes an entry in a session's recorded history, e.g. the files the agent showed. */
  async record(sessionId: string, entry: Record<string, unknown>): Promise<void> {
    await this.rpc.request('_codeflower/sessions/record', { sessionId, entry });
  }

  readFile(path: string): Promise<SandboxFile & { data: string }> {
    return this.rpc.request<SandboxFile & { data: string }>('_codeflower/files/read', { path });
  }

  /**
   * The file for a preview. Images a browser cannot show (TIFF) or too large
   * to send whole come drawn by the worker, at most PREVIEW_HEIGHT pixels high.
   */
  async readPreview(path: string): Promise<SandboxFile & { data: string }> {
    const file = await this.statFile(path);
    if (file.mimeType.startsWith('image/') && (!BROWSER_IMAGES.has(file.mimeType) || file.size > MAX_READ_BYTES)) {
      return { ...file, ...(await this.thumbnail(path, PREVIEW_HEIGHT)) };
    }
    return this.readFile(path);
  }

  /** A small WebP of the image, at most `height` pixels high; older workers send the whole file. */
  async thumbnail(path: string, height: number): Promise<{ mimeType: string; data: string }> {
    try {
      return await this.rpc.request<{ mimeType: string; data: string }>('_codeflower/files/thumbnail', { path, height });
    } catch (error) {
      if (isMethodNotFound(error)) return this.readFile(path);
      throw error;
    }
  }

  statFile(path: string): Promise<SandboxFile> {
    return this.rpc.request<SandboxFile>('_codeflower/files/stat', { path });
  }

  listDirectory(path: string): Promise<DirectoryListing> {
    return this.rpc.request<DirectoryListing>('_codeflower/files/list', { path });
  }

  // The page's search (Ctrl+K).

  searchPaths(query: string): Promise<{ files: FoundPath[]; truncated: boolean }> {
    return this.rpc.request('_codeflower/search/paths', { query });
  }

  /** A newer search from the same window stops this one, which answers `superseded`. */
  searchContents(query: string): Promise<{ files: FoundInFile[]; truncated: boolean; superseded?: boolean }> {
    return this.rpc.request('_codeflower/search/contents', { query });
  }

  searchChats(query: string): Promise<{ chats: FoundInChat[]; truncated: boolean }> {
    return this.rpc.request('_codeflower/search/chats', { query });
  }

  // Files sent both ways in chunks; see `FileTransfers`.

  async uploadStart(target: UploadTarget, size: number): Promise<{ uploadId: string; chunkBytes: number }> {
    return this.rpc.request('_codeflower/files/upload', { ...target, size });
  }

  async uploadChunk(uploadId: string, offset: number, data: string): Promise<{ received: number }> {
    return this.rpc.request('_codeflower/files/upload', { uploadId, offset, data });
  }

  async uploadFinish(uploadId: string, sha256: string): Promise<UploadedFile> {
    return this.rpc.request('_codeflower/files/upload', { uploadId, finish: true, sha256 });
  }

  async uploadCancel(uploadId: string): Promise<void> {
    await this.rpc.request('_codeflower/files/upload', { uploadId, cancel: true });
  }

  /** Which of `paths` (relative to `dir`) exist already. */
  async filesExist(dir: string, paths: string[]): Promise<{ path: string; type: 'file' | 'directory' | 'other' }[]> {
    return (await this.rpc.request<{ existing: { path: string; type: 'file' | 'directory' | 'other' }[] }>('_codeflower/files/exists', { dir, paths })).existing;
  }

  async downloadStart(path: string): Promise<DownloadStarted> {
    return this.rpc.request('_codeflower/files/download', { path });
  }

  async downloadChunk(downloadId: string, offset: number): Promise<DownloadChunk> {
    return this.rpc.request('_codeflower/files/download', { downloadId, offset });
  }

  async downloadCancel(downloadId: string): Promise<void> {
    await this.rpc.request('_codeflower/files/download', { downloadId, cancel: true });
  }

  /**
   * Saves a text file the user edited, over the version they opened (its
   * `mtimeMs`); see `isFileConflict` for when the agent wrote it since.
   */
  async writeFile(path: string, text: string, expectedMtimeMs: number): Promise<SandboxFile> {
    try {
      return await this.rpc.request<SandboxFile>('_codeflower/files/write', { path, text, expectedMtimeMs });
    } catch (error) {
      if (isMethodNotFound(error)) throw new Error('this sandbox is too old to save files; update its image');
      throw error;
    }
  }

  /**
   * Saves the comments the user left on a storyteller report (a JSON array) into the
   * report's store and its page. Workers from before comments do not have this.
   */
  async saveReportComments(path: string, comments: string): Promise<void> {
    try {
      await this.rpc.request('_codeflower/reports/comments', { path, comments });
    } catch (error) {
      if (isMethodNotFound(error)) throw new Error('this sandbox is too old to save comments; update its image');
      throw error;
    }
  }

  runShell(sessionId: string, runId: string, command: string): Promise<{ exitCode: number; timedOut: boolean }> {
    return this.rpc.request<{ exitCode: number; timedOut: boolean }>('_codeflower/shell/run', { sessionId, runId, command });
  }

  cancelShell(runId: string): Promise<unknown> {
    return this.rpc.request('_codeflower/shell/cancel', { runId });
  }

  async startTerminal(methodId: string, columns: number, rows: number): Promise<string> {
    return (await this.rpc.request<{ terminalId: string }>('_codeflower/terminal/start', this.named({ methodId, columns, rows })))
      .terminalId;
  }

  async terminalInput(terminalId: string, data: string): Promise<void> {
    await this.rpc.request('_codeflower/terminal/input', { terminalId, data });
  }

  async closeTerminal(terminalId: string): Promise<void> {
    await this.rpc.request('_codeflower/terminal/close', { terminalId });
  }

  /** A shell in the workspace, which this window shows; it runs until it ends or is closed. */
  async startShell(columns: number, rows: number): Promise<string> {
    return (await this.rpc.request<{ terminalId: string }>('_codeflower/terminal/start', { kind: 'shell', columns, rows })).terminalId;
  }

  /** Shows a running terminal here: what it printed so far comes as `replayed` output. */
  async attachTerminal(terminalId: string, columns: number, rows: number): Promise<void> {
    await this.rpc.request('_codeflower/terminal/attach', { terminalId, columns, rows });
  }

  async resizeTerminal(terminalId: string, columns: number, rows: number): Promise<void> {
    await this.rpc.request('_codeflower/terminal/resize', { terminalId, columns, rows });
  }

  /** Stops showing a terminal here; it keeps running. */
  async detachTerminal(terminalId: string): Promise<void> {
    await this.rpc.request('_codeflower/terminal/detach', { terminalId });
  }

  /** dsh keys; the agent must be restarted to pick them up. */
  async setCredentials(credentials: DshCredentials): Promise<void> {
    await this.rpc.request('_codeflower/credentials/set', this.named(credentials));
  }

  /** The keys the agent has saved and its route; undefined from older bridges. */
  async savedCredentials(): Promise<SavedCredentials | undefined> {
    try {
      return await this.rpc.request<SavedCredentials>('_codeflower/credentials/get', this.named({}));
    } catch (error) {
      if (isMethodNotFound(error)) return undefined;
      throw error;
    }
  }

  /** The models an OpenAI-compatible endpoint serves, read by the bridge from its `GET /models`. */
  async endpointModels(baseURL: string, apiKey: string): Promise<EndpointModel[]> {
    try {
      return (await this.rpc.request<{ models: EndpointModel[] }>('_codeflower/credentials/models', this.named({ baseURL, apiKey }))).models;
    } catch (error) {
      if (isMethodNotFound(error)) throw new Error('this sandbox is too old to list the models; type their ids');
      throw error;
    }
  }

  /** Whether an OpenAI-compatible endpoint answers and takes the key, which the bridge tries without a completion. */
  async checkEndpoint(baseURL: string, apiKey: string): Promise<EndpointCheck> {
    try {
      return await this.rpc.request<EndpointCheck>('_codeflower/credentials/check', this.named({ baseURL, apiKey }));
    } catch (error) {
      if (isMethodNotFound(error)) throw new Error('this sandbox is too old to test the endpoint');
      throw error;
    }
  }

  /** The agent's plugins; `{available: false}` from older bridges and agents without plugins. */
  async plugins(): Promise<PluginsOverview> {
    try {
      return await this.rpc.request<PluginsOverview>('_codeflower/plugins/list', this.named({}));
    } catch (error) {
      if (isMethodNotFound(error)) return { available: false };
      throw error;
    }
  }

  /** A fetched catalog's plugins; `fetched: false` until it is fetched. */
  pluginCatalog(catalog: string): Promise<{ name: string; fetched: boolean; plugins: CatalogPlugin[] }> {
    return this.rpc.request('_codeflower/plugins/catalog', this.named({ catalog }));
  }

  /** Adds a plugin to the project. `pendingFetch`: the sandbox has no network, so the app has to fetch it. */
  addPlugin(source: string): Promise<{ id: string; pendingFetch: boolean }> {
    return this.rpc.request('_codeflower/plugins/add', this.named({ source }));
  }

  async removePlugin(id: string): Promise<void> {
    await this.rpc.request('_codeflower/plugins/remove', this.named({ id }));
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    await this.rpc.request('_codeflower/plugins/setEnabled', this.named({ id, enabled }));
  }

  addPluginCatalog(source: string): Promise<{ source: string; pendingFetch: boolean }> {
    return this.rpc.request('_codeflower/plugins/catalogs/add', this.named({ source }));
  }

  async removePluginCatalog(source: string): Promise<void> {
    await this.rpc.request('_codeflower/plugins/catalogs/remove', this.named({ source }));
  }

  /** Fetches what is missing in the sandbox; refused (`pendingFetch`) without its network. */
  async fetchPlugins(): Promise<void> {
    await this.rpc.request('_codeflower/plugins/fetch', this.named({}));
  }

  /** Ends the agent (refused while its chats are working); its next connection starts a fresh one. */
  async restartAgent(): Promise<void> {
    await this.rpc.request('_codeflower/agent/restart', this.named({}));
  }

  // ---- the agents' commands ----

  /** The commands a chat's agent runs, and the last few that ended. */
  async commands(key: string): Promise<AgentCommand[]> {
    return (await this.rpc.request<{ commands?: AgentCommand[] }>('_codeflower/commands/list', { key })).commands ?? [];
  }

  // ---- roots: the map of ideas ----

  /** The project's map of ideas, and the workspace its files are in. */
  async roots(): Promise<RootsMap> {
    const map = await this.rpc.request<Partial<RootsMap>>('_codeflower/roots/list', {});
    return { ideas: map.ideas ?? [], errors: map.errors ?? [], ...(map.workspace ? { workspace: map.workspace } : {}) };
  }

  /** The user's change to an idea. */
  async updateIdea(id: number, patch: IdeaPatch): Promise<Idea> {
    return (await this.rpc.request<{ idea: Idea }>('_codeflower/roots/update', { id, patch })).idea;
  }

  /** The user's comment on an idea; `told` is the chat the worker tells, if any. */
  async commentIdea(id: number, text: string): Promise<{ idea: Idea; told?: string }> {
    return this.rpc.request<{ idea: Idea; told?: string }>('_codeflower/roots/comment', { id, text });
  }

  // ---- batch jobs ----

  /** The project's batch jobs: active, and those that ended in the last day. */
  async jobs(): Promise<BatchJob[]> {
    return (await this.rpc.request<{ jobs?: BatchJob[] }>('_codeflower/jobs/list', {})).jobs ?? [];
  }

  /** Cancels one of the project's batch jobs. */
  async cancelJob(id: string): Promise<BatchJob | undefined> {
    return (await this.rpc.request<{ job?: BatchJob }>('_codeflower/jobs/cancel', { id })).job;
  }

  // ---- orchestrators ----

  /** The project's orchestrators. */
  async orchestrators(): Promise<Orchestrator[]> {
    return (await this.rpc.request<{ orchestrators?: Orchestrator[] }>('_codeflower/orchestrators/list', {})).orchestrators ?? [];
  }

  /** Starts an orchestrator (of `agent`, Claude Code by default) on the chat `executor`, for good. */
  createOrchestrator(executor: string, options: { agent?: string; title?: string; access?: Partial<OrchestratorAccess> } = {}): Promise<{ key: string; agent: string; title: string; executor: string }> {
    return this.rpc.request('_codeflower/orchestrators/create', { executor, ...options });
  }

  /** Changes what an orchestrator may do; `restartNeeded` when the web changed, which applies at its session's next start. */
  setOrchestratorAccess(key: string, access: Partial<OrchestratorAccess>): Promise<{ access: OrchestratorAccess; restartNeeded?: boolean }> {
    return this.rpc.request('_codeflower/orchestrators/setAccess', { key, access });
  }

  /** Lets the orchestrators of `executor` (or the one `orchestrator`) see a figure or report it showed. */
  async shareWithOrchestrator(executor: string, path: string, orchestrator?: string): Promise<void> {
    await this.rpc.request('_codeflower/orchestrators/share', { executor, path, ...(orchestrator ? { orchestrator } : {}) });
  }

  /** Ends an orchestrator's link to its chat. */
  async disconnectOrchestrator(key: string): Promise<void> {
    await this.rpc.request('_codeflower/orchestrators/disconnect', { key });
  }

  // ---- watches ----

  /** The project's watches: running, and those that ended in the last day. */
  async watches(): Promise<Watch[]> {
    return (await this.rpc.request<{ watches?: Watch[] }>('_codeflower/watches/list', {})).watches ?? [];
  }

  /** Runs a watch's command now; a met watch is told to its chat. */
  async checkWatch(id: string): Promise<{ watch?: Watch; run?: { exitCode: number; verdict: string; timedOut?: boolean } }> {
    return this.rpc.request('_codeflower/watches/check', { id });
  }

  /** Stops one of the project's watches; its chat is told. */
  async stopWatch(id: string): Promise<Watch | undefined> {
    return (await this.rpc.request<{ watch?: Watch }>('_codeflower/watches/stop', { id })).watch;
  }

  // ---- subagents ----

  /** A chat's subagents, running and recorded. */
  async subagents(key: string): Promise<SubagentSummary[]> {
    return (await this.rpc.request<{ subagents: SubagentSummary[] }>('_codeflower/subagents/list', { key })).subagents ?? [];
  }

  /** Opens a subagent's chat here: its updates and requests come from now on. */
  openSubagent(key: string): Promise<OpenedSubagent> {
    return this.rpc.request<OpenedSubagent>('_codeflower/subagents/open', { key });
  }

  async closeSubagent(key: string): Promise<void> {
    await this.rpc.request('_codeflower/subagents/close', { key });
  }

  async cancelSubagent(key: string): Promise<void> {
    await this.rpc.request('_codeflower/subagents/cancel', { key });
  }

  /** The subagents' defaults; `settings` changes them first. */
  subagentSettings(settings?: Partial<SubagentSettings>): Promise<SubagentSettingsState> {
    return this.rpc.request<SubagentSettingsState>('_codeflower/subagents/settings', this.named(settings ? { settings } : {}));
  }
}

/** The file changed in the sandbox since the user opened it, so it was not saved. */
export function isFileConflict(error: unknown): boolean {
  return error instanceof RpcError && (error.data as { conflict?: boolean } | undefined)?.conflict === true;
}
