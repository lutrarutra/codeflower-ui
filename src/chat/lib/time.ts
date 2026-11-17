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

const clockFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

/** The time of day, as the chat's stamps show it: 14:32, or 2:32 PM. */
export const clock = (ms: number): string => clockFormat.format(ms);

/** The date and time, for a stamp's tooltip. */
export const fullTime = (ms: number): string => fullFormat.format(ms);

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** The day of a time, as the chat's day separators show it: Today, Yesterday, Mon 16 Nov, 16 Nov 2025. */
export function day(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    weekday: days > 0 && days < 7 ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric'
  }).format(date);
}

/** Whether two times fall on the same day, in the viewer's time zone. */
export const sameDay = (a: number, b: number): boolean => startOfDay(a) === startOfDay(b);
