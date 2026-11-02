import assert from 'node:assert/strict';
import test from 'node:test';
import { fileLink } from '../src/web/lib/fileLink.ts';

test('reads a file link: the sandbox, the file, and the chat that showed it', () => {
  const path = '/codeflower-state/workspace/figures/pca plot.png';
  assert.deepEqual(fileLink(`#/file/local-1a2b3c4d/${encodeURIComponent(path)}?chat=opencode-ses_1`), {
    worker: 'local-1a2b3c4d',
    path,
    chat: 'opencode-ses_1'
  });
  assert.deepEqual(fileLink(`#/file/w%40c1/${encodeURIComponent('/data/output/r.html')}`), { worker: 'w@c1', path: '/data/output/r.html' });
});

test('takes no other address for a file link', () => {
  assert.equal(fileLink('#/chat/local-1/opencode-ses_1'), undefined);
  assert.equal(fileLink('#/file/local-1/relative.png'), undefined);
  assert.equal(fileLink('#/file/local-1/%E0%A4%A'), undefined);
  assert.equal(fileLink('#/file/local-1'), undefined);
});
