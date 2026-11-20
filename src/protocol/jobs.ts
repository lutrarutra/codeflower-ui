// Batch jobs as the code flower bridge reports them (`_codeflower/jobs/*`):
// the agent asks for one with codeflower-job, the app submits it, and it runs
// in a sandbox like the chat's on the cluster (docs/jobs.md in the workspace).
// The bridge lists the project's jobs, active and of the last day; a chat
// shows those it asked for.

export type BatchJobState = 'submitting' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'lost';

export interface BatchJob {
  /** The app's id (j-…); the scheduler's is `schedulerId`. */
  id: string;
  name: string;
  scheduler: string;
  schedulerId?: string;
  state: BatchJobState;
  /** An array's size, and how its tasks ended. */
  tasks?: number;
  array?: string;
  outcome?: { done: number; failed: number; cancelled?: number; lost?: number };
  exitCode?: number;
  command: string[];
  workdir: string;
  /** Its folder in the sandbox: output.log (output-INDEX.log for an array's tasks) and the scheduler's log. */
  logs: string;
  /** The chat that asked for it, and its key. */
  agent?: string;
  sessionId?: string;
  key?: string;
  submitted: string;
  started?: string;
  ended?: string;
  error?: string;
  resources?: { cpus?: number; memory?: number; time?: number; gpus?: number; queue?: string };
}

/** What the worker's status says of its jobs (`jobs`); missing when it has none. */
export interface JobsSummary {
  scheduler: string;
  approve: 'ask' | 'never';
  active: number;
}

export function jobActive(job: BatchJob): boolean {
  return job.state === 'submitting' || job.state === 'queued' || job.state === 'running';
}

/** The jobs a chat asked for, the active ones first, then the newest. */
export function jobsOfChat(jobs: BatchJob[], key: string): BatchJob[] {
  return jobs
    .filter((job) => job.key === key)
    .sort((a, b) => Number(jobActive(b)) - Number(jobActive(a)) || Date.parse(b.submitted) - Date.parse(a.submitted));
}

/** Its state for people: an exit status or an array's outcome where it failed. */
export function jobStatus(job: BatchJob): string {
  if (job.outcome && job.state !== 'done') {
    const failed = job.outcome.failed + (job.outcome.lost ?? 0);
    return `${job.state}: ${job.outcome.done} done, ${failed} failed`;
  }
  if (job.state === 'failed' && job.exitCode !== undefined && job.exitCode !== 0) return `failed (exit ${job.exitCode})`;
  return job.state;
}

/** Where its output is: output.log, or an array's first task's. */
export function jobOutput(job: BatchJob): string {
  if (!job.tasks) return `${job.logs}/output.log`;
  const first = /^\d+/.exec(job.array ?? '')?.[0] ?? '0';
  return `${job.logs}/output-${first}.log`;
}
