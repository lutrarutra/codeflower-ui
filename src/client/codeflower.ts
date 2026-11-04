// What the code flower bridge adds to ACP: `_codeflower/*` methods and
// notifications for the worker's status, recorded sessions, files, the
// user's shell commands, sign-in terminals, usage and subagents. An agent reached without
// the bridge answers none of them, and the chat works without them.
import type { AgentName, AgentPresentation, ChatAction, SandboxFile, TranscriptEntry } from '../protocol/messages.ts';
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
  };
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
  engine: string;
  slurmJobId?: string;
  /** When the batch job ends (ISO 8601); chats are asked to wrap up before. Missing without a known end. */
  allocationEnd?: string;
  /** Folders the app mounted, e.g. /data/input/study42; missing from older workers. */
  mounts?: Mount[];
  /** What the worker offers beyond chats; on an agent's connection also that agent's. */
  capabilities?: AgentState['capabilities'] & {
    /** The user's shells in the sandbox (the page's Terminal). */
    shellTerminals?: boolean;
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
}

/** What the worker's agents are doing, sent by the worker whenever it changes. */
export interface WorkerActivity {
  chats: { key: string; state: 'working' | 'waiting'; waitingFor?: 'plan' | 'permission' | 'question' }[];
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
  /** Its key, which `WorkerConnection` adds. */
  sessionKey?: string;
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
  /** An agent's subagent defaults changed, from any window. */
  subagentSettingsChanged?(agent: AgentName, state: SubagentSettingsState): void;
}

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
    rpc.on('_codeflower/subagents/settingsChanged', (params) => {
      const { agent, ...state } = params as ForAgent<SubagentSettingsState>;
      handlers.subagentSettingsChanged?.(agent, state);
    });
    rpc.on('_codeflower/terminal/changed', (params) => {
      const { terminals } = params as { terminals?: (ChatTerminal | ShellTerminal)[] };
      if (!Array.isArray(terminals)) return;
      const { chats, shells } = splitTerminals(terminals);
      handlers.terminals?.(chats);
      handlers.shells?.(shells);
    });
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

  async deleteSession(key: string): Promise<void> {
    await this.rpc.request('_codeflower/sessions/delete', { key });
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
