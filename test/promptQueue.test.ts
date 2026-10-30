import assert from 'node:assert/strict';
import test from 'node:test';
import { PromptQueue } from '../src/client/promptQueue.ts';

test('preserves queued prompts separately and publishes their labels', () => {
  const queue = new PromptQueue();
  const first = queue.enqueue('First prompt', 'Generate report', { id: 'generate-report', title: 'Generate report' });
  queue.enqueue('Feedback text', 'Preview feedback');
  assert.deepEqual(queue.summaries(), [
    { id: first.id, title: 'Generate report' },
    { id: 'queued-2', title: 'Preview feedback' }
  ]);
  assert.deepEqual(queue.take(), {
    id: first.id,
    title: 'Generate report',
    text: 'First prompt',
    action: { id: 'generate-report', title: 'Generate report' }
  });
  assert.equal(queue.length, 1);
});

test('interrupt replacement clears pending work and a queued prompt can be removed', () => {
  const queue = new PromptQueue();
  queue.enqueue('Do this later', 'Checkpoint');
  const wrapUp = queue.replace('Wrap up now', 'Wrap up', { id: 'wrap-up', title: 'Wrap up' });
  assert.deepEqual(queue.summaries(), [{ id: wrapUp.id, title: 'Wrap up' }]);
  assert.equal(queue.remove(wrapUp.id), true);
  assert.equal(queue.remove(wrapUp.id), false);
  assert.deepEqual(queue.summaries(), []);
});
