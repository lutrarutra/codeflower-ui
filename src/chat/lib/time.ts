// How long something ran, as the chat shows it: 42s, 3m 07s, 1h 05m.
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${`${seconds % 60}`.padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${`${minutes % 60}`.padStart(2, '0')}m`;
}

/** An ISO time as ms since the epoch, or null. */
export function epoch(time: string | null | undefined): number | null {
  if (!time) return null;
  const ms = Date.parse(time);
  return Number.isNaN(ms) ? null : ms;
}
