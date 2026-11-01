// The chats the Focus view lists, from every sandbox at once, in the order the
// user should get to them: those waiting for an answer, longest waiting first;
// those working; those that finished unseen; then the recent and pinned ones.
import type { SessionStatus } from '../../protocol/messages.ts';
import type { ChatActivity } from './api.ts';

export type ChatPhase = 'working' | 'waiting' | 'idle';

/** A chat's phase: an open chat says it at once, the others as the app polls the sandbox. */
export function chatPhase(status: SessionStatus | undefined, polled: ChatActivity | undefined): ChatPhase {
  if (status && status !== 'offline') return status === 'ready' ? 'idle' : status;
  return polled?.state ?? 'idle';
}

/** An idle chat stays in the list this long after its last change. */
export const RECENT_MS = 3 * 60 * 60 * 1000;

export interface FocusChat {
  workerId: string;
  key: string;
  title: string;
  /** The sandbox's name. */
  sandbox: string;
  phase: ChatPhase;
  waitingFor?: ChatActivity['waitingFor'];
  /** When the chat entered its phase, as far as the page knows. */
  since: number;
  /** When the chat last changed, from its session record. */
  updatedAt?: number;
  pinned: boolean;
  /** It finished while the user looked elsewhere. */
  unseen: boolean;
}

export type FocusGroupId = 'waiting' | 'working' | 'done' | 'idle';

export interface FocusGroup {
  id: FocusGroupId;
  label: string;
  chats: FocusChat[];
}

const LABELS: Record<FocusGroupId, string> = { waiting: 'Needs you', working: 'Working', done: 'Done', idle: 'Recent and pinned' };

export function groupOf(chat: FocusChat): FocusGroupId {
  if (chat.phase !== 'idle') return chat.phase;
  return chat.unseen ? 'done' : 'idle';
}

/** Whether the chat belongs in the list: active, unseen, pinned, or changed recently. */
export function listed(chat: FocusChat, now: number): boolean {
  if (chat.phase !== 'idle' || chat.unseen || chat.pinned) return true;
  const last = Math.max(chat.updatedAt ?? 0, chat.since);
  return now - last < RECENT_MS;
}

/** The listed chats in their groups, each in the order to get to them; empty groups left out. */
export function arrange(chats: FocusChat[], now: number): FocusGroup[] {
  const groups: Record<FocusGroupId, FocusChat[]> = { waiting: [], working: [], done: [], idle: [] };
  for (const chat of chats) if (listed(chat, now)) groups[groupOf(chat)].push(chat);
  const oldest = (a: FocusChat, b: FocusChat) => a.since - b.since;
  groups.waiting.sort(oldest);
  groups.working.sort(oldest);
  groups.done.sort(oldest);
  // Pinned first, then the latest.
  groups.idle.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || Math.max(b.updatedAt ?? 0, b.since) - Math.max(a.updatedAt ?? 0, a.since)
  );
  return (Object.keys(groups) as FocusGroupId[]).filter((id) => groups[id].length).map((id) => ({ id, label: LABELS[id], chats: groups[id] }));
}

const same = (chat: FocusChat, other: { workerId: string; key: string } | null | undefined) =>
  !!other && chat.workerId === other.workerId && chat.key === other.key;

/** The chat to go to next: the one waiting longest, else the one that finished unseen first; never the current one. */
export function nextUp(groups: FocusGroup[], current: { workerId: string; key: string } | null): FocusChat | undefined {
  for (const id of ['waiting', 'done'] as const) {
    const next = groups.find((group) => group.id === id)?.chats.find((chat) => !same(chat, current));
    if (next) return next;
  }
  return undefined;
}

/** The chat before or after the current one, in the list's order; the first one if none is current. */
export function step(groups: FocusGroup[], current: { workerId: string; key: string } | null, by: 1 | -1): FocusChat | undefined {
  const flat = groups.flatMap((group) => group.chats);
  if (!flat.length) return undefined;
  const at = flat.findIndex((chat) => same(chat, current));
  if (at < 0) return flat[0];
  return flat[Math.min(Math.max(at + by, 0), flat.length - 1)];
}
