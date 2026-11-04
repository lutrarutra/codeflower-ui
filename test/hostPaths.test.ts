import assert from 'node:assert/strict';
import test from 'node:test';
import { hostPath } from '../src/client/hostPaths.ts';

const status = {
  stateDirectory: '/Users/ana/codeflower/projects/p',
  mounts: [
    { target: '/data/input/study42', source: '/gpfs/ana/study42', readOnly: true },
    { target: '/data/input/raw', source: '/gpfs/ana/study42/raw', readOnly: true },
    { target: '/data/output/results', source: '/Users/ana/results/', readOnly: false }
  ]
};

test('maps sandbox paths to the host, the longest mount winning', () => {
  assert.equal(hostPath(status, '/data/input/study42/meta/samples.csv'), '/gpfs/ana/study42/meta/samples.csv');
  assert.equal(hostPath(status, '/data/input/raw/a.fastq.gz'), '/gpfs/ana/study42/raw/a.fastq.gz');
  assert.equal(hostPath(status, '/data/input/study42/'), '/gpfs/ana/study42');
  assert.equal(hostPath(status, '/data/output/results/umap.png'), '/Users/ana/results/umap.png');
  assert.equal(hostPath(status, '/codeflower-state/workspace/reports/r.html'), '/Users/ana/codeflower/projects/p/workspace/reports/r.html');
});

test('a path in no folder from the host has no host path', () => {
  // A sibling with a common prefix is not inside the mount.
  assert.equal(hostPath(status, '/data/input/study420/x'), null);
  assert.equal(hostPath(status, '/data/input'), null);
  assert.equal(hostPath(status, '/opt/codeflower/bin'), null);
  assert.equal(hostPath(status, 'relative/path'), null);
  assert.equal(hostPath(undefined, '/data/input/study42'), null);
  assert.equal(hostPath({ mounts: [{ target: '/inputs', source: '', readOnly: true }], stateDirectory: null }, '/inputs/a'), null);
});

test('the environment and caches may be elsewhere, except the exports', () => {
  assert.equal(hostPath(status, '/codeflower-state/env/bin/python'), null);
  assert.equal(hostPath(status, '/codeflower-state/cache/uv'), null);
  assert.equal(hostPath(status, '/codeflower-state/env/exports/r.yaml'), '/Users/ana/codeflower/projects/p/env/exports/r.yaml');
  assert.equal(hostPath(status, '/codeflower-state/environment'), '/Users/ana/codeflower/projects/p/environment');
});

test('Windows host paths keep their separators', () => {
  const windows = { stateDirectory: 'C:\\Users\\Ana\\codeflower\\projects\\p', mounts: [{ target: '/data/input/study', source: 'C:\\Users\\Ana\\Study\\', readOnly: true }] };
  assert.equal(hostPath(windows, '/data/input/study/sub/b.csv'), 'C:\\Users\\Ana\\Study\\sub\\b.csv');
  assert.equal(hostPath(windows, '/codeflower-state/workspace/a.txt'), 'C:\\Users\\Ana\\codeflower\\projects\\p\\workspace\\a.txt');
});
