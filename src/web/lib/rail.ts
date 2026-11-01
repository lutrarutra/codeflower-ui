// What the rail and the New sandbox dialog say about sandboxes and computers:
// a sandbox's two letters, a computer's color, and whether a sandbox can start there.
import type { Worker } from './api.ts';
import type { Machine } from './machines.svelte.ts';

/** The words a sandbox goes by: the name the user gave it, its project, else its agent. */
function badgeName(worker: Worker): string {
  if (worker.name) return worker.name;
  if (worker.source !== 'added' && worker.project && worker.project !== 'default') return worker.project;
  return worker.label || 'Sandbox';
}

/** Two letters: the first letters of the first two words, or the first two letters of one word. */
export function letters(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2)).toUpperCase();
}

export function badge(worker: Worker): string {
  return letters(badgeName(worker));
}

const STOPPED = ['unreachable', 'stopped', 'failed'];

/** The sandbox stopped or does not answer: the rail leaves it out, unless the sidebar shows it. */
export function stopped(worker: Worker): boolean {
  return STOPPED.includes(worker.status);
}

/** The rail lists the sandbox: it runs on a computer that answers, or the sidebar shows it. */
export function inRail(worker: Worker, machine: Machine, browsing: string | null): boolean {
  if (worker.id === browsing) return true;
  return !stopped(worker) && (machine.reach === 'reachable' || machine.reach === 'loading');
}

/** Not the accents of the page (indigo) or of status (green, orange as waiting). */
const COLORS = ['var(--cf-teal)', 'var(--cf-violet)', 'var(--cf-cyan)', 'var(--cf-pink)', 'var(--cf-yellow)'];

/**
 * A computer's color, by its place among the computers sorted by key: the
 * same wherever the page comes from, and different for up to five computers.
 */
export function machineColor(key: string, keys: string[]): string {
  const index = [...new Set(keys)].sort().indexOf(key);
  return COLORS[(index < 0 ? 0 : index) % COLORS.length]!;
}

/** The color of sandboxes added by their line, which run on no computer of the page. */
export const ELSEWHERE_COLOR = 'var(--cf-muted)';

/**
 * Whether a sandbox can start on the computer: `ok` (its engine may still need
 * a fix, which the form shows); `locked` (through the tunnel, its app does not
 * allow starting: `tunnel: manage: true` does); `connectOnly` (its app only
 * connects); `offline`; `unsupported` (another tunnel account, or a newer app);
 * `loading`.
 */
export type StartState = 'ok' | 'locked' | 'connectOnly' | 'offline' | 'unsupported' | 'loading';

export function startState(machine: Machine): StartState {
  const reach = machine.reach;
  if (reach === 'offline' || reach === 'unreachable') return 'offline';
  if (reach === 'elsewhere' || reach === 'newer') return 'unsupported';
  const capabilities = machine.system?.capabilities;
  if (!capabilities) return 'loading';
  if (capabilities.connect === false && !capabilities.start && capabilities.connectOnly) return 'locked';
  if (capabilities.connectOnly) return 'connectOnly';
  return 'ok';
}

export const START_TEXT: Record<StartState, string> = {
  ok: '',
  locked: 'Starting through the tunnel is off',
  connectOnly: 'Its app only connects to sandboxes',
  offline: 'Not answering',
  unsupported: 'Cannot be used from this page',
  loading: 'Connecting…'
};
