import assert from 'node:assert/strict';
import test from 'node:test';
import { jobActive, jobOutput, jobsOfChat, jobStatus, type BatchJob } from '../src/protocol/jobs.ts';

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
