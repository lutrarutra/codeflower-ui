import assert from 'node:assert/strict';
import test from 'node:test';
import { arrayIndices, jobActive, jobOfFile, jobOutput, jobsOfChat, jobStatus, taskCounts, taskSummary, type BatchJob } from '../src/protocol/jobs.ts';

const job = (id: string, extra: Partial<BatchJob>): BatchJob => ({
  id,
  name: id,
  scheduler: 'slurm',
  state: 'queued',
  command: ['python'],
  workdir: '/data/output/x',
  logs: `/codeflower-state/jobs/${id}`,
  submitted: '2026-11-20T10:00:00Z',
  ...extra
});

test("a chat shows its own batch jobs, the active ones first", () => {
  const jobs = [
    job('j-000001', { key: 'claude-a', state: 'done', submitted: '2026-11-20T12:00:00Z' }),
    job('j-000002', { key: 'claude-b' }),
    job('j-000003', { key: 'claude-a', state: 'running', submitted: '2026-11-20T09:00:00Z' }),
    job('j-000004', {})
  ];
  assert.deepEqual(jobsOfChat(jobs, 'claude-a').map((each) => each.id), ['j-000003', 'j-000001']);
  assert.equal(jobActive(jobs[2]), true);
  assert.equal(jobActive(jobs[0]), false);
});

test("a job's state and output read as people need them", () => {
  assert.equal(jobStatus(job('j-1', { state: 'failed', exitCode: 2 })), 'failed (exit 2)');
  assert.equal(jobStatus(job('j-1', { state: 'failed', outcome: { done: 8, failed: 1, lost: 1 } })), 'failed: 8 done, 2 failed');
  assert.equal(jobStatus(job('j-1', { state: 'done', outcome: { done: 10, failed: 0 } })), 'done');
  assert.equal(jobOutput(job('j-1', {})), '/codeflower-state/jobs/j-1/output.log');
  assert.equal(jobOutput(job('j-1', { tasks: 10, array: '5-14%2' })), '/codeflower-state/jobs/j-1/output-5.log');
});

test("a tab finds the job whose output it shows, by the job's folder", () => {
  const jobs = [job('j-00aa11', { state: 'running' }), job('j-00bb22', { state: 'done' })];
  assert.equal(jobOfFile(jobs, '/codeflower-state/jobs/j-00aa11/output.log')?.id, 'j-00aa11');
  assert.equal(jobOfFile(jobs, '/codeflower-state/jobs/j-00bb22/output-3.log')?.id, 'j-00bb22');
  // The sandbox gives real paths, which may differ from the app's `logs`.
  assert.equal(jobOfFile(jobs, '/mnt/project/jobs/j-00bb22/scheduler.log')?.id, 'j-00bb22');
  assert.equal(jobOfFile(jobs, '/codeflower-state/jobs/j-00cc33/output.log'), undefined);
  assert.equal(jobOfFile(jobs, '/codeflower-state/workspace/jobs/j-00aa11/sub/output.log'), undefined);
  assert.equal(jobOfFile(undefined, '/codeflower-state/jobs/j-00aa11/output.log'), undefined);
});

test("an array's tasks are read from its spec, each with its own output", () => {
  assert.deepEqual(arrayIndices('0-4'), [0, 1, 2, 3, 4]);
  assert.deepEqual(arrayIndices('1-10:3,20,4%2'), [1, 4, 7, 10, 20]);
  assert.deepEqual(arrayIndices('7'), [7]);
  assert.deepEqual(arrayIndices(undefined), []);
  assert.deepEqual(arrayIndices('x,3'), [3]);
  const array = job('j-1', { tasks: 5, array: '10-14%2' });
  assert.equal(jobOutput(array, 12), '/codeflower-state/jobs/j-1/output-12.log');
  assert.equal(jobOutput(array), '/codeflower-state/jobs/j-1/output-10.log');
});

test("an array's tasks are counted by state, the ones that matter first", () => {
  const array = job('j-1', {
    state: 'running',
    tasks: 6,
    array: '1-6',
    taskStates: { 1: 'done', 2: 'failed', 3: 'running', 4: 'queued', 5: 'queued', 6: 'done' }
  });
  assert.deepEqual(taskCounts(array), { done: 2, failed: 1, running: 1, queued: 2 });
  assert.equal(taskSummary(array), '1 running · 1 failed · 2 done · 2 queued');
  // Apps from before task states tell only how the tasks ended.
  assert.equal(taskCounts(job('j-2', { tasks: 3, array: '1-3' })), undefined);
  assert.equal(taskSummary(job('j-2', { tasks: 3, array: '1-3' })), '');
});
