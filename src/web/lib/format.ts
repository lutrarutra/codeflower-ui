// How the page words and measures things.
import type { Worker } from './api.ts';

export const STATUS_TEXT: Record<string, string> = {
  starting: 'starting',
  ready: 'running',
  stopping: 'stopping',
  stopped: 'stopped',
  failed: 'failed',
  connecting: 'connecting',
  unreachable: 'unreachable',
  unauthorized: 'refused',
  task: 'running a task'
};

/** The status as shown, with a wrap-up in progress. */
export function statusText(worker: Worker): string {
  if (worker.quitting === 'asked' && worker.status === 'ready') return 'wrapping up';
  return STATUS_TEXT[worker.status] ?? worker.status;
}

/** good: running; busy: on its way; bad: needs the user; idle: not running. */
export function statusTone(worker: Worker): 'good' | 'busy' | 'bad' | 'idle' {
  if (worker.quitting === 'asked') return 'busy';
  switch (worker.status) {
    case 'ready':
    case 'task':
      return 'good';
    case 'starting':
    case 'stopping':
    case 'connecting':
      return 'busy';
    case 'failed':
    case 'unauthorized':
    case 'unreachable':
      return 'bad';
    default:
      return 'idle';
  }
}

export const SOURCE_TEXT: Record<Worker['source'], string> = {
  started: 'here',
  local: 'terminal',
  added: 'remote'
};

export const SOURCE_TITLE: Record<Worker['source'], string> = {
  started: 'Started by this app; it stops when the app quits',
  local: 'Started on this computer outside the app, e.g. in a terminal',
  added: 'Running elsewhere, added by its line'
};

/** The sandbox's name in lists: its agent, and its project or address. */
export function workerTitle(worker: Worker): [string, string] {
  return [worker.label || 'Sandbox', worker.source === 'added' ? worker.address ?? '' : worker.project];
}

/** A sandbox that runs and can be stopped from here. */
export function canStop(worker: Worker): boolean {
  return worker.source !== 'added' && ['starting', 'ready', 'unreachable', 'task'].includes(worker.status);
}

export const WAITING_FOR: Record<string, string> = { plan: 'plan approval', permission: 'permission', question: 'an answer' };

export const plural = (count: number, noun: string, nouns = `${noun}s`) => `${count} ${count === 1 ? noun : nouns}`;

export function tokens(count: number): string {
  if (count >= 1e6) return `${(count / 1e6).toFixed(count >= 1e7 ? 0 : 1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(count >= 1e4 ? 0 : 1)}k`;
  return String(count);
}

export function cost(value: { amount: number; currency: string }, estimate: boolean): string {
  const amount = value.currency === 'USD' ? `$${value.amount.toFixed(value.amount < 1 ? 3 : 2)}` : `${value.amount.toFixed(2)} ${value.currency}`;
  return estimate ? `≈${amount}` : amount;
}

export function resets(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (!(minutes > 0)) return '';
  if (minutes < 60) return `in ${minutes}m`;
  if (minutes < 1440) return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Bytes as htop writes them: 512M, 15.8G. */
export function bytes(value: number): string {
  const units = ['B', 'K', 'M', 'G', 'T'];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value >= 100 || index < 2 ? Math.round(value) : value.toFixed(1)}${units[index]}`;
}

/** A path with the home folder written as ~. */
export function short(path: string, home: string | undefined): string {
  if (home && (path === home || path.startsWith(home + '/') || path.startsWith(home + '\\'))) return '~' + path.slice(home.length);
  return path;
}

export type FolderKind = 'inputs' | 'outputs' | 'code' | 'skills';

export const FOLDER_KINDS: Record<FolderKind, { root: string; title: string; noun: string }> = {
  inputs: { root: '/data/input', title: 'Choose a folder with your data', noun: 'input' },
  outputs: { root: '/data/output', title: 'Choose a folder for the results', noun: 'output' },
  code: { root: '/data/code', title: 'Choose a repository or package for the agent to develop', noun: 'code' },
  skills: { root: '/data/skills', title: 'Choose a skill, or a folder of skills', noun: 'skills' }
};

/** Where each folder appears in the sandbox; the same names as the app's folderName. */
export function targets(kind: FolderKind, paths: string[]): string[] {
  const used = new Set<string>();
  return paths.map((path) => {
    const base = path.split(/[\\/]/).filter(Boolean).pop() || '';
    let name = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
    if (!name.replace(/_/g, '')) name = 'folder';
    let target = `${FOLDER_KINDS[kind].root}/${name}`;
    for (let number = 2; used.has(target); number++) target = `${FOLDER_KINDS[kind].root}/${name}-${number}`;
    used.add(target);
    return target;
  });
}

/** The agent's accent: a palette name follows the theme, anything else is used as given. */
export function accent(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return /^[a-z]+$/.test(color) ? `var(--cf-${color})` : color;
}
