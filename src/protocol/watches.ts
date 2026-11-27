// Watches as the code flower bridge reports them (`_codeflower/watches/*`):
// an agent starts one with codeflower-watch, and the bridge runs its command
// every so often until a condition holds, then tells the chat. The bridge
// lists the project's watches, running and of the last day; a chat shows its
// own. Must match sandbox/dsh-plugins/acp-ws/src/watches.js (`publicOf`).

/**
 * failed: its output matched `--fail` (what it watched failed); exited: the processes it followed
 * (`--pid`) ended; failing: its own command kept failing.
 */
export type WatchState = 'watching' | 'met' | 'failed' | 'exited' | 'timeout' | 'stopped' | 'failing' | 'lost';
export type WatchVerdict = 'met' | 'failed' | 'waiting' | 'error';

export interface WatchRun {
  run: number;
  at: string;
  exitCode: number;
  verdict: WatchVerdict;
  ms: number;
  timedOut?: boolean;
}

export interface Watch {
  /** w-… */
  id: string;
  name: string;
  command: string;
  cwd: string;
  /** How often it runs, and how long it may run, in milliseconds. */
  every: number;
  timeout: number;
  /** `exit`, `match:REGEX`, `change` or `exited` (only the end of its `pids`). */
  until: string;
  /** `match:REGEX`: the output that means what it watched failed. */
  fail?: string;
  /** The processes it follows (`--pid`): it ends when none runs. */
  pids?: number[];
  state: WatchState;
  /** A run is going on now. */
  running: boolean;
  runs: number;
  /** Errors in a row. */
  failures: number;
  lastRun?: WatchRun;
  nextRun?: string;
  started: string;
  deadline: string;
  ended?: string;
  reason?: string;
  /** All its runs' output, in the sandbox. */
  log: string;
  /** The chat it tells, and its key. */
  agent: string;
  sessionId: string;
  key?: string;
}

/** What the worker's status says of its watches (`watches`); missing from older workers. */
export interface WatchesSummary {
  active: number;
}

export function watchActive(watch: Watch): boolean {
  return watch.state === 'watching';
}

/** A chat's watches, the running ones first, then the newest. */
export function watchesOfChat(watches: Watch[], key: string): Watch[] {
  return watches
    .filter((watch) => watch.key === key)
    .sort((a, b) => Number(watchActive(b)) - Number(watchActive(a)) || Date.parse(b.started) - Date.parse(a.started));
}

/** 90000 → "1m30s". */
export function formatInterval(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms || 0))}ms`;
  let rest = Math.round(ms / 1000);
  const parts: string[] = [];
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]] as const) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }
  return parts.slice(0, 2).join('');
}

const VERDICT: Record<WatchVerdict, string> = { met: 'met', failed: 'failed', waiting: 'not yet', error: 'error' };

/** Its state for people: what it waits for while it runs, how it ended after. */
export function watchStatus(watch: Watch): string {
  if (watchActive(watch)) {
    const last = watch.lastRun ? `last ${watch.lastRun.timedOut ? 'timed out' : `exit ${watch.lastRun.exitCode}`}, ${VERDICT[watch.lastRun.verdict]}` : '';
    return [`every ${formatInterval(watch.every)} until ${watch.until}${watch.fail ? `, fail ${watch.fail}` : ''}${watch.pids?.length ? `, while process ${watch.pids.join(', ')} runs` : ''}`, `run ${watch.runs}`, last].filter(Boolean).join(' · ');
  }
  return `${watch.state}${watch.reason ? `: ${watch.reason}` : ''} · ${watch.runs} run${watch.runs === 1 ? '' : 's'}`;
}

/** The watch whose output a file is (watches/ID/output.log), for a tab that shows it. */
export function watchOfFile(watches: Watch[] | undefined, path: string): Watch | undefined {
  const id = /\/watches\/(w-[0-9a-f]{8})\/output\.log$/.exec(path)?.[1];
  return id ? watches?.find((watch) => watch.id === id) : undefined;
}
