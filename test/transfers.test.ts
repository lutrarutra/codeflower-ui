import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Sink, TransferConnection } from '../src/web/lib/transfers.svelte.ts';

Reflect.set(globalThis, '$state', Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T): T => structuredClone(value) }));
const { IN_FLIGHT, Transfers, base64ToBytes, bytesToBase64, filesOfEntries, filesOfInput, memorySink } = await import('../src/web/lib/transfers.svelte.ts');

const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A bridge in memory: the sandbox's files by path, chunks checked as the bridge checks them. */
function fakeSandbox(files: Record<string, Uint8Array>, chunkBytes = 4) {
  const uploads = new Map<string, { path: string; size: number; parts: Uint8Array[]; received: number }>();
  const downloads = new Map<string, { data: Uint8Array; sent: number }>();
  const calls = { chunks: 0, maxInFlight: 0, inFlight: 0, cancelled: [] as string[] };
  let next = 0;
  const later = <T>(value: () => T) =>
    new Promise<T>((resolve, reject) => {
      calls.inFlight++;
      calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
      setTimeout(() => {
        calls.inFlight--;
        try {
          resolve(value());
        } catch (error) {
          reject(error);
        }
      }, 10);
    });
  const connection: TransferConnection = {
    fileTransfers: { upload: { maxBytes: 1e9, chunkBytes, folders: true }, download: { chunkBytes, folders: true } },
    async uploadStart(target, size) {
      const uploadId = `u${next++}`;
      uploads.set(uploadId, { path: `${target.dir}/${target.relativePath}`, size, parts: [], received: 0 });
      return { uploadId, chunkBytes };
    },
    uploadChunk(uploadId, offset, data) {
      calls.chunks++;
      return later(() => {
        const upload = uploads.get(uploadId)!;
        if (offset !== upload.received) throw new Error(`Expected the chunk at byte ${upload.received}, not ${offset}`);
        const bytes = base64ToBytes(data);
        upload.parts.push(bytes);
        upload.received += bytes.length;
        return { received: upload.received };
      });
    },
    async uploadFinish(uploadId, sha256) {
      const upload = uploads.get(uploadId)!;
      const data = Buffer.concat(upload.parts);
      if (hex(data) !== sha256) throw new Error('damaged');
      files[upload.path] = data;
      uploads.delete(uploadId);
      return { path: upload.path, name: upload.path.split('/').pop()!, size: data.length, sha256, replaced: false };
    },
    async uploadCancel(uploadId) {
      calls.cancelled.push(uploadId);
      uploads.delete(uploadId);
    },
    async filesExist(_dir, paths) {
      return paths.filter((path) => files[path]).map((path) => ({ path, type: 'file' as const }));
    },
    async downloadStart(path) {
      const data = files[path];
      if (!data) throw new Error(`No such file: ${path}`);
      const downloadId = `d${next++}`;
      downloads.set(downloadId, { data, sent: 0 });
      return { downloadId, name: path.split('/').pop()!, chunkBytes, kind: 'file', size: data.length };
    },
    downloadChunk(downloadId, offset) {
      calls.chunks++;
      return later(() => {
        const download = downloads.get(downloadId);
        if (!download) throw new Error('Unknown download');
        if (offset !== download.sent) throw new Error(`Expected a request for byte ${download.sent}, not ${offset}`);
        const bytes = download.data.subarray(offset, offset + chunkBytes);
        download.sent += bytes.length;
        const done = download.sent >= download.data.length;
        if (done) downloads.delete(downloadId);
        return { data: bytesToBase64(bytes), done, progress: download.sent, ...(done ? { sha256: hex(download.data) } : {}) };
      });
    },
    async downloadCancel(downloadId) {
      calls.cancelled.push(downloadId);
      downloads.delete(downloadId);
    }
  };
  return { connection, calls };
}

function collect(): Sink & { bytes(): Buffer; state: string } {
  const parts: Uint8Array[] = [];
  return {
    state: 'open',
    async write(data) {
      parts.push(data);
    },
    async close() {
      this.state = 'closed';
    },
    async abort() {
      this.state = 'aborted';
    },
    bytes: () => Buffer.concat(parts)
  };
}

const encoder = new TextEncoder();

test('base64 round-trips bytes of any length', () => {
  const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 251);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('sends files one after another, a few chunks on the way at once, and the sandbox checks the hash', async () => {
  const files: Record<string, Uint8Array> = {};
  const { connection, calls } = fakeSandbox(files);
  const transfers = new Transfers();
  const picked = [
    { file: new Blob(['x,y\n1,2\n3,4\n5,6\n7,8\n']), relativePath: 'run1/a.csv' },
    { file: new Blob(['']), relativePath: 'run1/empty.txt' },
    { file: new Blob(['notes']), relativePath: 'notes.md' }
  ];
  const sent = await transfers.upload(connection, 'w', '/ws', picked, 'number', '3 files');
  assert.equal(sent, 3);
  assert.equal(new TextDecoder().decode(files['/ws/run1/a.csv']), 'x,y\n1,2\n3,4\n5,6\n7,8\n');
  assert.equal(files['/ws/run1/empty.txt'].length, 0);
  assert.equal(calls.maxInFlight, IN_FLIGHT);
  const [item] = transfers.of('w');
  assert.deepEqual([item.state, item.done, item.total], ['done', 25, 25]);
});

test('a cancelled upload is dropped in the sandbox', async () => {
  const { connection, calls } = fakeSandbox({});
  const transfers = new Transfers();
  const running = transfers.upload(connection, 'w', '/ws', [{ file: new Blob(['a'.repeat(400)]), relativePath: 'big.bin' }], 'replace', 'big.bin');
  transfers.cancel(transfers.of('w')[0].id);
  assert.equal(await running, 0);
  assert.equal(transfers.of('w')[0].state, 'cancelled');
  assert.deepEqual(calls.cancelled, ['u0']);
});

test('saves a file with a few chunks asked at once, checking its hash', async () => {
  const data = encoder.encode('six thousand cells, and some more of them');
  const { connection, calls } = fakeSandbox({ '/ws/cells.txt': data });
  const transfers = new Transfers();
  const sink = collect();
  await transfers.download(connection, 'w', '/ws/cells.txt', sink, 'cells.txt');
  assert.deepEqual(sink.bytes(), Buffer.from(data));
  assert.equal(sink.state, 'closed');
  assert.equal(calls.maxInFlight, IN_FLIGHT);
  const [item] = transfers.of('w');
  assert.deepEqual([item.state, item.done, item.total], ['done', data.length, data.length]);
});

test('a download that arrives damaged is not kept', async () => {
  const { connection } = fakeSandbox({ '/ws/a.txt': encoder.encode('abcdefgh') });
  const original = connection.downloadChunk;
  connection.downloadChunk = async (id, offset) => {
    const chunk = await original(id, offset);
    return chunk.done ? { ...chunk, sha256: '0'.repeat(64) } : chunk;
  };
  const transfers = new Transfers();
  const sink = collect();
  await transfers.download(connection, 'w', '/ws/a.txt', sink, 'a.txt');
  assert.equal(sink.state, 'aborted');
  assert.match(transfers.of('w')[0].error!, /damaged/);
});

test('without a save dialog, at most so much is gathered in memory', async () => {
  const sink = memorySink('big.bin', 10);
  await sink.write(new Uint8Array(6));
  await assert.rejects(sink.write(new Uint8Array(6)), /at most 0 MB/);
});

test('reads dropped folders in batches, without hidden files, and picked folders with their paths', async () => {
  const file = (name: string) => ({ name, isFile: true, isDirectory: false, file: (ok: (file: File) => void) => ok(new File([name], name)) });
  const folder = (name: string, ...batches: object[][]) => ({
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let index = 0;
      return { readEntries: (ok: (entries: object[]) => void) => ok(batches[index++] ?? []) };
    }
  });
  const dropped = [folder('run', [file('a.csv'), file('.DS_Store')], [folder('figures', [file('umap.png')])]), file('notes.md')];
  const files = await filesOfEntries(dropped as never);
  assert.deepEqual(files.map((picked) => picked.relativePath), ['run/a.csv', 'run/figures/umap.png', 'notes.md']);
  await assert.rejects(filesOfEntries(dropped as never, 2), /At most 2 files/);

  const picked = [new File(['a'], 'a.csv'), new File(['b'], 'b.csv'), new File(['c'], '.env')];
  Object.defineProperty(picked[1], 'webkitRelativePath', { value: 'run/b.csv' });
  assert.deepEqual(filesOfInput(picked).map((one) => one.relativePath), ['a.csv', 'run/b.csv']);
});
