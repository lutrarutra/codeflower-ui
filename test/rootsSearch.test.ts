import assert from 'node:assert/strict';
import test from 'node:test';
import { searchIdeas } from '../src/chat/lib/rootsSearch.ts';
import type { Idea } from '../src/protocol/roots.ts';

const idea = (id: number, title: string, more: Partial<Idea> = {}): Idea => ({
  id,
  title,
  status: 'idea',
  from: [],
  needs: [],
  todos: [],
  files: [],
  chats: [],
  comments: [],
  created: '',
  updated: '',
  conclusion: '',
  file: `${id}.md`,
  ...more
});

const ideas = [
  idea(1, 'Load the counts'),
  idea(2, 'Cluster cells', { conclusion: 'Found 12 clusters.\nLeiden at resolution 0.8 works best.' }),
  idea(3, 'Batch correction', { comments: [{ by: 'user', text: 'Try Harmony before scVI', at: '' }] }),
  idea(4, 'Differential expression', { todos: [{ text: 'pseudobulk with DESeq2', done: false }], files: ['results/de/volcano.png'] })
];
const at = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 0, y: 200 }],
  [3, { x: 300, y: 200 }],
  [4, { x: 0, y: 400 }]
]);

test('finds the query in anything of an idea, not only its title', () => {
  assert.deepEqual(searchIdeas(ideas, 'harmony', at).map((hit) => [hit.id, hit.field]), [[3, 'comment']]);
  assert.deepEqual(searchIdeas(ideas, 'deseq', at).map((hit) => [hit.id, hit.field]), [[4, 'todo']]);
  assert.deepEqual(searchIdeas(ideas, 'volcano', at).map((hit) => [hit.id, hit.field]), [[4, 'file']]);
  const [leiden] = searchIdeas(ideas, 'leiden', at);
  assert.equal(leiden!.field, 'conclusion');
  // On one line, the match marked where it is.
  assert.ok(!leiden!.excerpt.includes('\n'));
  assert.equal(leiden!.positions.map((index) => leiden!.excerpt[index]).join(''), 'Leiden');
});

test('matches as typed in the map order, before fuzzy ones', () => {
  // "c" is in every title: top to bottom, then left to right.
  assert.deepEqual(searchIdeas(ideas, 'c', at).map((hit) => hit.id), [1, 2, 3, 4]);
  const hits = searchIdeas(ideas, 'clust', at);
  assert.equal(hits[0]!.id, 2);
  assert.ok(hits[0]!.exact);
});

test('fuzzy: letters in order, at word starts', () => {
  const [hit] = searchIdeas(ideas, 'btchcorr', at);
  assert.equal(hit!.id, 3);
  assert.equal(hit!.exact, false);
  assert.equal(hit!.field, 'title');
  assert.deepEqual(searchIdeas(ideas, 'zzz', at), []);
});

test('an idea by its number', () => {
  assert.equal(searchIdeas(ideas, '#4', at)[0]!.id, 4);
  assert.equal(searchIdeas(ideas, '4', at)[0]!.id, 4);
});

test('an empty query finds nothing', () => {
  assert.deepEqual(searchIdeas(ideas, '  ', at), []);
});
