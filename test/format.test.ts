import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duration, pullText } from '../src/web/lib/format.ts';

test('durations read like a clock', () => {
  assert.equal(duration(-3), '0 s');
  assert.equal(duration(45.9), '45 s');
  assert.equal(duration(125), '2 min 05 s');
  assert.equal(duration(3780), '1 h 03 min');
});

test('an image download says its size and layers', () => {
  assert.equal(pullText({ current: 812 * 1024 ** 2, total: 3.3 * 1024 ** 3, layers: 19, done: 4 }), '812 MB of 3.3 GB, 4 of 19 layers');
  assert.equal(pullText({ current: 0, total: 0, layers: 1, done: 0 }), '0 of 1 layer');
  assert.equal(pullText({ current: 0, total: 0, layers: 0, done: 0 }), '');
});
