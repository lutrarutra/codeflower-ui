// Files sent between the user's computer and a sandbox, from the file tree:
// files and folders dropped or picked go to a folder in the sandbox, and a
// file, or a folder as a zip, is saved where the user chooses. Both go over
// the sandbox's connection in chunks (`_codeflower/files/upload|download`),
// so they work through the tunnel as chats do, with a few chunks on the way
// at once. Each side checks the other's SHA-256: a file that arrives damaged
// is not kept, here or in the sandbox.
//
// Nothing saved from the sandbox is ever opened in this page: it is written
// to a file the user chose (Chromium's save dialog) or handed to the browser's
// downloads as `application/octet-stream`. The page's origin holds the
// device's tunnel key, so a sandbox's HTML must never run here.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { DownloadChunk, DownloadStarted, FileTransfers, UploadTarget, UploadedFile } from '../../client/codeflower.ts';

/** Chunks on the way at once: enough to hide the tunnel's round trips, few enough to keep the chat's messages moving. */
export const IN_FLIGHT = 4;
/** At most this many files in one drop or pick. */
export const MAX_FILES = 1000;
/** Without a save dialog, a download is gathered in memory first: at most this much. */
export const MEMORY_DOWNLOAD_MAX = 512 * 1024 * 1024;

/** What a transfer needs of a sandbox's connection (`WorkerConnection`). */
export interface TransferConnection {
  readonly fileTransfers: FileTransfers | undefined;
  uploadStart(target: UploadTarget, size: number): Promise<{ uploadId: string; chunkBytes: number }>;
  uploadChunk(uploadId: string, offset: number, data: string): Promise<{ received: number }>;
  uploadFinish(uploadId: string, sha256: string): Promise<UploadedFile>;
  uploadCancel(uploadId: string): Promise<void>;
  filesExist(dir: string, paths: string[]): Promise<{ path: string; type: 'file' | 'directory' | 'other' }[]>;
  downloadStart(path: string): Promise<DownloadStarted>;
  downloadChunk(downloadId: string, offset: number): Promise<DownloadChunk>;
  downloadCancel(downloadId: string): Promise<void>;
}

/** A file from the user's computer, with its path in what they dropped or picked (`run1/a.csv`). */
export interface PickedFile {
  file: Blob;
  relativePath: string;
}

/** Where a download's bytes go. */
export interface Sink {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export class TransferCancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Lets the page paint between chunks, so a long transfer does not freeze it on a phone. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Sends one file, keeping `IN_FLIGHT` chunks on the way; `progress` gets the
 * bytes the sandbox has taken. A cancelled or failed upload is dropped there.
 */
export async function uploadFile(
  connection: TransferConnection,
  picked: PickedFile,
  target: UploadTarget,
  progress: (received: number) => void,
  signal: AbortSignal
): Promise<UploadedFile> {
  const size = picked.file.size;
  const { uploadId, chunkBytes } = await connection.uploadStart(target, size);
  const hash = sha256.create();
  const pending: Promise<void>[] = [];
  let failure: unknown;
  try {
    for (let offset = 0; offset < size; offset += chunkBytes) {
      if (signal.aborted) throw new TransferCancelled();
      if (failure) throw failure;
      const bytes = new Uint8Array(await picked.file.slice(offset, Math.min(offset + chunkBytes, size)).arrayBuffer());
      hash.update(bytes);
      pending.push(
        connection.uploadChunk(uploadId, offset, bytesToBase64(bytes)).then(
          ({ received }) => progress(received),
          (error: unknown) => void (failure ??= error)
        )
      );
      if (pending.length >= IN_FLIGHT) await pending.shift();
      await breathe();
    }
    await Promise.all(pending);
    if (failure) throw failure;
    if (signal.aborted) throw new TransferCancelled();
    return await connection.uploadFinish(uploadId, bytesToHex(hash.digest()));
  } catch (error) {
    await Promise.allSettled(pending);
    void connection.uploadCancel(uploadId).catch(() => undefined);
    throw error;
  }
}

/**
 * Saves a file, or a folder as a zip, into `sink`, asking for `IN_FLIGHT`
 * chunks at once (each but the last is `chunkBytes` long, so their offsets
 * are known). `progress` gets the bytes of the file or the folder's files read.
 */
export async function downloadInto(
  connection: TransferConnection,
  started: DownloadStarted,
  sink: Sink,
  progress: (done: number) => void,
  signal: AbortSignal
): Promise<void> {
  const { downloadId, chunkBytes } = started;
  const hash = sha256.create();
  const asked: Promise<DownloadChunk>[] = [];
  let next = 0;
  const ask = () => {
    const answer = connection.downloadChunk(downloadId, next);
    // Answers past the end are refused; they are never read.
    answer.catch(() => undefined);
    asked.push(answer);
    next += chunkBytes;
  };
  let finished = false;
  try {
    for (let index = 0; index < IN_FLIGHT; index++) ask();
    for (;;) {
      if (signal.aborted) throw new TransferCancelled();
      const chunk = await asked.shift()!;
      const bytes = base64ToBytes(chunk.data);
      if (!chunk.done && bytes.length !== chunkBytes) throw new Error('The sandbox sent a short chunk');
      hash.update(bytes);
      await sink.write(bytes);
      progress(chunk.progress);
      if (chunk.done) {
        if (chunk.sha256 !== bytesToHex(hash.digest())) throw new Error(`${started.name} arrived damaged (its SHA-256 differs); it was not saved`);
        finished = true;
        break;
      }
      ask();
      await breathe();
    }
    await sink.close();
  } catch (error) {
    if (!finished) void connection.downloadCancel(downloadId).catch(() => undefined);
    await sink.abort().catch(() => undefined);
    throw error;
  }
}

/** A sink that gathers the bytes and hands them to the browser's downloads, for browsers without a save dialog. */
export function memorySink(name: string, limit = MEMORY_DOWNLOAD_MAX): Sink {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  return {
    async write(data) {
      length += data.length;
      if (length > limit) {
        throw new Error(`This browser can save at most ${Math.round(limit / 1024 / 1024)} MB at once; use Chrome or Edge for larger files`);
      }
      parts.push(data as Uint8Array<ArrayBuffer>);
    },
    async close() {
      // Never the file's own type: the browser must save it, not show it.
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.rel = 'noopener';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async abort() {
      parts.length = 0;
    }
  };
}

interface SaveFilePicker {
  showSaveFilePicker?(options: { suggestedName: string }): Promise<{ createWritable(): Promise<WritableFileStream> }>;
}
interface WritableFileStream {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/**
 * Where to save a download. Must be called in the click that asked for it:
 * the save dialog needs that click. Resolves to undefined when the user
 * closes the dialog. Without the dialog (Firefox, Safari), the browser's
 * downloads take the file.
 */
export function chooseSink(name: string): Promise<Sink | undefined> {
  const picker = (globalThis as SaveFilePicker).showSaveFilePicker;
  if (!picker || !globalThis.isSecureContext) return Promise.resolve(memorySink(name));
  return picker({ suggestedName: name }).then(
    async (handle) => {
      const stream = await handle.createWritable();
      return { write: (data) => stream.write(data), close: () => stream.close(), abort: () => stream.abort() };
    },
    (error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return undefined;
      throw error;
    }
  );
}

// ---- reading what the user dropped or picked ----

interface Entry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}
interface FileEntry extends Entry {
  file(success: (file: File) => void, failure: (error: unknown) => void): void;
}
interface DirectoryEntry extends Entry {
  createReader(): { readEntries(success: (entries: Entry[]) => void, failure: (error: unknown) => void): void };
}

/**
 * The entries of a drop. Must be called in the drop event: the browser
 * empties its data once the event is over.
 */
export function droppedEntries(data: DataTransfer): Entry[] {
  const entries: Entry[] = [];
  for (const item of data.items) {
    const entry = item.kind === 'file' ? (item as DataTransferItem & { webkitGetAsEntry?(): Entry | null }).webkitGetAsEntry?.() : null;
    if (entry) entries.push(entry);
  }
  return entries;
}

/** The files of dropped entries, walking dropped folders; hidden files are left out, as the sandbox would refuse them. */
export async function filesOfEntries(entries: Entry[], max = MAX_FILES): Promise<PickedFile[]> {
  const files: PickedFile[] = [];
  const visit = async (entry: Entry, prefix: string): Promise<void> => {
    if (entry.name.startsWith('.')) return;
    const path = `${prefix}${entry.name}`;
    if (entry.isFile) {
      if (files.length >= max) throw new Error(`At most ${max} files can be sent at once`);
      const file = await new Promise<File>((resolve, reject) => (entry as FileEntry).file(resolve, reject));
      files.push({ file, relativePath: path });
    } else if (entry.isDirectory) {
      const reader = (entry as DirectoryEntry).createReader();
      // Folders are read in batches until one comes back empty.
      for (;;) {
        const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, `${path}/`);
      }
    }
  };
  for (const entry of entries) await visit(entry, '');
  return files;
}

/** The files of a file input; a picked folder's files keep their path in it. */
export function filesOfInput(list: FileList | File[], max = MAX_FILES): PickedFile[] {
  const files = [...list]
    .map((file) => ({ file, relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }))
    .filter(({ relativePath }) => !relativePath.split('/').some((segment) => segment.startsWith('.')));
  if (files.length > max) throw new Error(`At most ${max} files can be sent at once`);
  return files;
}

// ---- the transfers the file tree shows ----

export interface Transfer {
  id: number;
  workerId: string;
  direction: 'up' | 'down';
  /** What is sent: a file's name, a folder's, or "12 files". */
  label: string;
  /** Where: the sandbox's folder, or the file or folder saved. */
  where: string;
  /** The file being sent now, in a batch. */
  current: string;
  total: number;
  done: number;
  startedAt: number;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  error?: string;
}

let nextId = 1;

/** The transfers of every sandbox; uploads to one sandbox go one file at a time. */
export class Transfers {
  items = $state<Transfer[]>([]);
  private readonly controllers = new Map<number, AbortController>();
  private readonly queues = new Map<string, Promise<unknown>>();

  /** Of one sandbox, newest first. */
  of(workerId: string): Transfer[] {
    return this.items.filter((item) => item.workerId === workerId).reverse();
  }

  cancel(id: number): void {
    this.controllers.get(id)?.abort();
  }

  /** Clears the finished ones of a sandbox. */
  clear(workerId: string): void {
    this.items = this.items.filter((item) => item.workerId !== workerId || item.state === 'running');
  }

  private add(fields: Omit<Transfer, 'id' | 'startedAt' | 'state' | 'done'>): { item: Transfer; signal: AbortSignal } {
    this.items.push({ ...fields, id: nextId++, startedAt: Date.now(), state: 'running', done: 0 });
    // The proxy $state made, so changes show.
    const item = this.items.at(-1)!;
    const controller = new AbortController();
    this.controllers.set(item.id, controller);
    return { item, signal: controller.signal };
  }

  private end(item: Transfer, error?: unknown): void {
    this.controllers.delete(item.id);
    if (error === undefined) item.state = 'done';
    else if (error instanceof TransferCancelled) item.state = 'cancelled';
    else {
      item.state = 'failed';
      item.error = error instanceof Error ? error.message : String(error);
    }
  }

  /** Sends picked or dropped files to `dir`, one after another. Resolves with the number sent once all are done. */
  upload(connection: TransferConnection, workerId: string, dir: string, files: PickedFile[], conflict: UploadTarget['conflict'], label: string): Promise<number> {
    const { item, signal } = this.add({
      workerId,
      direction: 'up',
      label,
      where: dir,
      current: '',
      total: files.reduce((sum, picked) => sum + picked.file.size, 0)
    });
    const run = async () => {
      let sent = 0;
      let before = 0;
      try {
        for (const picked of files) {
          item.current = picked.relativePath;
          await uploadFile(connection, picked, { dir, relativePath: picked.relativePath, conflict }, (received) => (item.done = before + received), signal);
          before += picked.file.size;
          item.done = before;
          sent++;
        }
        this.end(item);
      } catch (error) {
        this.end(item, error);
      }
      return sent;
    };
    const queued = (this.queues.get(workerId) ?? Promise.resolve()).then(run);
    this.queues.set(workerId, queued);
    return queued;
  }

  /** Saves a file, or a folder as a zip, into the sink the user chose (see `chooseSink`). */
  async download(connection: TransferConnection, workerId: string, path: string, sink: Sink, name: string): Promise<void> {
    const { item, signal } = this.add({ workerId, direction: 'down', label: name, where: path, current: '', total: 0 });
    try {
      const started = await connection.downloadStart(path);
      item.total = (started.kind === 'zip' ? started.sourceBytes : started.size) ?? 0;
      await downloadInto(connection, started, sink, (done) => (item.done = done), signal);
      this.end(item);
    } catch (error) {
      await sink.abort().catch(() => undefined);
      this.end(item, error);
    }
  }
}

export const transfers = new Transfers();
