// What the code flower bridge adds to ACP: `_codeflower/*` methods and
// notifications for the worker's status, recorded sessions, files, the
// user's shell commands, sign-in terminals and usage. An agent reached without
// the bridge answers none of them, and the chat works without them.
import type { AgentName, AgentPresentation, ChatAction, SandboxFile, TranscriptEntry } from '../protocol/messages.ts';
import type { UsageTotals, WorkerUsage } from '../protocol/usage.ts';
import { RpcError, isMethodNotFound, type RpcConnection } from './rpc.ts';

export const WORKSPACE = '/codeflower-state/workspace';

/** An older bridge closes a connection with this code when another window takes the worker over. */
export const TAKEN_OVER = 4001;

export interface WorkerStatus {
  instanceId: string;
  agent: AgentName;
  agentLabel: string;
  /** The agent's presentation from its descriptor; missing from older workers. */
  agentInfo?: Partial<AgentPresentation>;
  signedIn: boolean;
  /** 'agent': the agent signs in itself (ACP); 'keys': code flower stores keys for it (dsh). */
  credentials: 'agent' | 'keys';
  stateDirectory: string | null;
  engine: string;
  slurmJobId?: string;
  /** When the batch job ends (ISO 8601); chats are asked to wrap up before. Missing without a known end. */
  allocationEnd?: string;
  /** Folders the app mounted, e.g. /data/input/study42; missing from older workers. */
  mounts?: Mount[];
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

/** What the worker's agent is doing, sent by the worker whenever it changes. */
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
}

export interface DshCredentials {
  deepseekApiKey?: string;
  openaiCompatible?: { baseURL: string; models: string[]; reasoningEfforts?: string[]; apiKey: string };
}

export interface CodeflowerHandlers {
  shellOutput(runId: string, data: string): void;
  /** Another window ran a shell command in a chat open here (bridges for several windows). */
  shellStarted(run: { sessionId: string; runId: string; command: string }): void;
  shellEnded(run: { sessionId: string; runId: string; exitCode: number; timedOut: boolean }): void;
  /** The agent ran `codeflower-show`: the user should see these files. */
  show(request: ShowRequest): void;
  activity(activity: WorkerActivity): void;
  /** Token counts, cost, or the login's quota changed. */
  usage(usage: WorkerUsage): void;
  /** For the worker (no key), or for one chat, with the prompt the worker sent it. */
  wrapUp(notice: WrapUpNotice & { key?: string; prompt?: string }): void;
  terminalOutput(terminalId: string, data: string): void;
  terminalExit(terminalId: string, exitCode: number): void;
}

export class CodeflowerExtensions {
  private readonly rpc: RpcConnection;

  constructor(rpc: RpcConnection, handlers: CodeflowerHandlers) {
    this.rpc = rpc;
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
    rpc.on('_codeflower/usage', (params) => handlers.usage(params as WorkerUsage));
    rpc.on('_codeflower/wrapUp', (params) => handlers.wrapUp(params as WrapUpNotice & { key?: string; prompt?: string }));
    rpc.on('_codeflower/terminal/output', (params) => {
      const { terminalId, data } = params as { terminalId: string; data: string };
      handlers.terminalOutput(terminalId, data);
    });
    rpc.on('_codeflower/terminal/exit', (params) => {
      const { terminalId, exitCode } = params as { terminalId: string; exitCode: number };
      handlers.terminalExit(terminalId, exitCode);
    });
  }

  /** Undefined when no bridge answers: the agent was reached directly. */
  async status(): Promise<WorkerStatus | undefined> {
    try {
      return await this.rpc.request<WorkerStatus>('_codeflower/status', {});
    } catch (error) {
      if (isMethodNotFound(error)) return undefined;
      throw error;
    }
  }

  /** Undefined from workers that do not track usage yet. */
  async usage(): Promise<WorkerUsage | undefined> {
    try {
      return await this.rpc.request<WorkerUsage>('_codeflower/usage', {});
    } catch (error) {
      if (isMethodNotFound(error)) return undefined;
      throw error;
    }
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
    return (await this.rpc.request<{ terminalId: string }>('_codeflower/terminal/start', { methodId, columns, rows }))
      .terminalId;
  }

  async terminalInput(terminalId: string, data: string): Promise<void> {
    await this.rpc.request('_codeflower/terminal/input', { terminalId, data });
  }

  async closeTerminal(terminalId: string): Promise<void> {
    await this.rpc.request('_codeflower/terminal/close', { terminalId });
  }

  /** dsh keys; the agent must be restarted to pick them up. */
  async setCredentials(credentials: DshCredentials): Promise<void> {
    await this.rpc.request('_codeflower/credentials/set', credentials);
  }

  /** Ends the worker's agent (refused while chats are working); the next connection starts a fresh one. */
  async restartAgent(): Promise<void> {
    await this.rpc.request('_codeflower/agent/restart', {});
  }
}

/** The file changed in the sandbox since the user opened it, so it was not saved. */
export function isFileConflict(error: unknown): boolean {
  return error instanceof RpcError && (error.data as { conflict?: boolean } | undefined)?.conflict === true;
}
