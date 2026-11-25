import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutIdeas } from '../src/chat/lib/rootsLayout.ts';

const box = { width: 100, height: 50, gapX: 20, gapY: 30 };
const idea = (id: number, ...from: number[]) => ({ id, from });
const center = (placed: Map<number, { x: number }>, id: number) => placed.get(id)!.x + box.width / 2;

// No two cards of a row overlap.
function assertApart(placed: Map<number, { x: number; y: number }>) {
  const cards = [...placed.values()];
  for (const [index, a] of cards.entries()) {
    for (const b of cards.slice(index + 1)) {
      if (a.y === b.y) assert.ok(Math.abs(a.x - b.x) >= box.width + box.gapX - 1e-9, `overlap at ${a.x} and ${b.x}`);
    }
  }
}

test('centers an idea over its children, which spread to both sides', () => {
  const placed = layoutIdeas([idea(1), idea(2, 1), idea(3, 1), idea(4, 1)], box);
  assert.equal(center(placed, 1), center(placed, 3));
  assert.ok(placed.get(2)!.x < placed.get(1)!.x && placed.get(4)!.x > placed.get(1)!.x);
  assert.deepEqual([1, 2, 3, 4].map((id) => placed.get(id)!.y), [0, 80, 80, 80]);
  assertApart(placed);
});

test('a branch that grows does not push its siblings aside unevenly', () => {
  // 2 and 3 under 1; 3 has three children of its own.
  const placed = layoutIdeas([idea(1), idea(2, 1), idea(3, 1), idea(4, 3), idea(5, 3), idea(6, 3)], box);
  assert.equal(center(placed, 3), center(placed, 5));
  assert.equal(center(placed, 1), (center(placed, 2) + center(placed, 3)) / 2);
  assertApart(placed);
});

test('a chain stays in one column', () => {
  const placed = layoutIdeas([idea(1), idea(2, 1), idea(3, 2), idea(4, 3)], box);
  assert.deepEqual(new Set([1, 2, 3, 4].map((id) => placed.get(id)!.x)), new Set([0]));
});

test('an idea that combines several sits under its first parent, below the deepest', () => {
  const placed = layoutIdeas([idea(1), idea(2, 1), idea(3, 2), idea(4, 1, 3)], box);
  // Row: below 3, the deepest of what it builds on.
  assert.equal(placed.get(4)!.y, 3 * 80);
  assertApart(placed);
});

test('ideas that start from the data are trees side by side, none overlapping', () => {
  const ideas = [idea(1), idea(2), idea(3, 1), idea(4, 1), idea(5, 2), idea(6, 2), idea(7, 2), idea(8, 5), idea(9, 99)];
  const placed = layoutIdeas(ideas, box);
  assert.equal(placed.size, 9);
  // An unknown parent (a broken file) leaves the idea an origin of its own.
  assert.equal(placed.get(9)!.y, 0);
  assert.ok(placed.get(2)!.x > placed.get(4)!.x);
  assertApart(placed);
});
