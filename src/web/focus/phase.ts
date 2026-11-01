// How the Focus view shows a chat's state: its dot, and how long it has been so.
import type { ChatPhase } from '../lib/focusList.ts';

/** The dot by phase; a chat that finished unseen is `done`. */
export const PHASE_DOT: Record<ChatPhase | 'done', string> = { waiting: 'bg-orange', working: 'bg-cyan', done: 'bg-indigo', idle: 'bg-green' };

/** A short age: 40s, 5m, 2h, 3d. */
export function age(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
