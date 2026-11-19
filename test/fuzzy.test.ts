import assert from 'node:assert/strict';
import test from 'node:test';
import { fuzzyMatch, markRuns, pathMatch } from '../src/web/lib/fuzzy.ts';

test('matches a subsequence, preferring word starts and runs', () => {
  assert.equal(fuzzyMatch('xyz', 'Clustering of PBMCs'), null);
  assert.equal(fuzzyMatch('gnirets', 'Clustering'), null);
  assert.deepEqual(fuzzyMatch('pbmc', 'Clustering of PBMCs')!.positions, [14, 15, 16, 17]);
  // "cop": C-of-P at word starts beats letters inside words.
  assert.deepEqual(fuzzyMatch('cop', 'Clustering of PBMCs')!.positions, [0, 11, 14]);
  assert.ok(fuzzyMatch('ump', 'UMAP plots')!.score > fuzzyMatch('ump', 'umbrella maps')!.score);
  // Letters strewn about the text are no match.
  assert.equal(fuzzyMatch('ump', 'dumping'), null);
  assert.equal(fuzzyMatch('leiden', 'Listing dev-inputs datasets and arithmetic'), null);
  // A capital makes case count; nothing typed matches everything.
  assert.equal(fuzzyMatch('Umap', 'umap'), null);
  assert.deepEqual(fuzzyMatch('  ', 'anything'), { score: 0, positions: [] });
});

test('ranks paths by their file name first, and marks it', () => {
  const name = pathMatch('umap', 'figures/umap.svg')!;
  assert.deepEqual(name.positions, [8, 9, 10, 11]);
  assert.ok(name.score > pathMatch('umap', 'unused/maps/a.png')!.score);
  assert.ok(pathMatch('qc', 'results/qc.html')!.score > pathMatch('qc', 'quick/scripts/check.py')!.score);
  // Shorter first among equals.
  assert.ok(pathMatch('qc', 'qc.html')!.score > pathMatch('qc', 'deeper/folder/qc.html')!.score);
});

test('cuts a text into marked and plain runs', () => {
  assert.deepEqual(markRuns('umap.svg', [0, 1, 2, 3]), [
    { text: 'umap', marked: true },
    { text: '.svg', marked: false }
  ]);
  assert.deepEqual(markRuns('ab', []), [{ text: 'ab', marked: false }]);
});

test('ranks paths as the sandbox does', async () => {
  // The bridge's copy (sandbox/dsh-plugins/acp-ws/src/search.js) must agree, when the workspace has it.
  const bridge = new URL('../../sandbox/dsh-plugins/acp-ws/src/search.js', import.meta.url);
  let pathScore: (query: string, path: string) => number | null;
  try {
    ({ pathScore } = await import(bridge.href));
  } catch {
    return;
  }
  for (const [query, path] of [
    ['umap', 'figures/umap.svg'],
    ['qc', 'quick/scripts/check.py'],
    ['anpy', 'analysis/analysis.py'],
    ['RD', 'README.md'],
    ['xyz', 'figures/umap.svg']
  ] as const) {
    const here = pathMatch(query, path);
    assert.equal(here?.score ?? null, pathScore(query, path), `${query} in ${path}`);
  }
});
