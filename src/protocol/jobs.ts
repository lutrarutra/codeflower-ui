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
  /** An array's tasks' states by index, kept up to date while it runs; missing from older apps. */
  taskStates?: Record<string, BatchJobState>;
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

/** Where its output is: output.log, or an array task's (the first one's unless `index` says). */
export function jobOutput(job: BatchJob, index?: number): string {
  if (!job.tasks) return `${job.logs}/output.log`;
  return `${job.logs}/output-${index ?? arrayIndices(job.array)[0] ?? 0}.log`;
}

// More than any limit allows; a spec that asks for more is not read past it.
const MAX_INDICES = 100_000;

/**
 * An array's task indices from its spec, as the app keeps it (`1-10:2,20`, with an optional `%LIMIT`):
 * single indices and FIRST-LAST[:STEP] ranges, separated by commas, in order and without repeats.
 */
export function arrayIndices(spec: string | undefined): number[] {
  const indices = new Set<number>();
  for (const part of (spec ?? '').split('%')[0].split(',')) {
    const range = /^\s*(\d+)(?:-(\d+)(?::(\d+))?)?\s*$/.exec(part);
    if (!range) continue;
    const first = Number(range[1]);
    const last = range[2] === undefined ? first : Number(range[2]);
    const step = Math.max(1, Number(range[3] ?? 1));
    for (let index = first; index <= last && indices.size < MAX_INDICES; index += step) indices.add(index);
  }
  return [...indices];
}

/**
 * The job whose folder a file is in (output.log, output-INDEX.log, scheduler.log), for a tab that
 * shows it. By the job's id in the path: the sandbox gives files by their real path, which need not
 * start with `logs` as the app wrote it.
 */
export function jobOfFile(jobs: BatchJob[] | undefined, path: string): BatchJob | undefined {
  const id = /\/jobs\/(j-[0-9a-f]{6,16})\/[^/]+$/.exec(path)?.[1];
  return id ? jobs?.find((job) => job.id === id) : undefined;
}

/** How many of an array's tasks are in each state, from its task states; undefined without them. */
export function taskCounts(job: BatchJob): Partial<Record<BatchJobState, number>> | undefined {
  if (!job.taskStates) return undefined;
  const counts: Partial<Record<BatchJobState, number>> = {};
  for (const state of Object.values(job.taskStates)) counts[state] = (counts[state] ?? 0) + 1;
  return counts;
}

/** The task counts for people, the states that matter first: `3 running · 1 failed · 4 done · 16 queued`. */
export function taskSummary(job: BatchJob): string {
  const counts = taskCounts(job);
  if (!counts) return '';
  const order: BatchJobState[] = ['running', 'failed', 'lost', 'cancelled', 'done', 'queued', 'submitting'];
  return order
    .filter((state) => counts[state])
    .map((state) => `${counts[state]} ${state}`)
    .join(' · ');
}
