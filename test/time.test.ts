import assert from 'node:assert/strict';
import test from 'node:test';
import { day, sameDay } from '../src/chat/lib/time.ts';

test('names the days of the day separators', () => {
  const now = new Date(2026, 10, 17, 9, 0).getTime();
  assert.equal(day(new Date(2026, 10, 17, 0, 5).getTime(), now), 'Today');
  assert.equal(day(new Date(2026, 10, 16, 23, 59).getTime(), now), 'Yesterday');
  assert.match(day(new Date(2026, 10, 13, 12).getTime(), now), /13/);
  assert.match(day(new Date(2025, 10, 13, 12).getTime(), now), /2025/);
  assert.ok(sameDay(new Date(2026, 10, 17, 0, 1).getTime(), new Date(2026, 10, 17, 23, 59).getTime()));
  assert.ok(!sameDay(new Date(2026, 10, 16, 23, 59).getTime(), new Date(2026, 10, 17, 0, 1).getTime()));
});
