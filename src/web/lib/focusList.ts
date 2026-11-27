// The chats the Focus view lists, from every sandbox at once, in the order the
// user should get to them: those waiting for an answer, longest waiting first;
// those working; those that finished unseen; then the recent and pinned ones.
import type { SessionStatus } from '../../protocol/messages.ts';
import type { ChatActivity } from './api.ts';

export type ChatPhase = 'working' | 'waiting' | 'idle';

/**
 * A chat's status: an open chat says it at once, the others as the app polls the sandbox.
 * An open chat that is ready still works on a background command or subagent: as it knows
 * (`background`), or the poll says (a subagent of a subagent's, say).
 */
export function chatStatus(status: SessionStatus | undefined, polled: ChatActivity | undefined, background = false): SessionStatus | undefined {
  if (status === 'ready' && background) return 'working';
  if (status === 'ready' && polled?.turn === false) return polled.state;
  return status ?? polled?.state;
}

/** A chat's phase, from its status (chatStatus). */
export function chatPhase(status: SessionStatus | undefined, polled: ChatActivity | undefined, background = false): ChatPhase {
  status = chatStatus(status, polled, background);
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
  /** Its computer does not answer: the list shows it as last seen. */
  unreachable?: boolean;
  /**
   * An orchestrator's row also stands for the chat it directs, which has no row of its own: its
   * key, title and phase. The row's phase is the more urgent of the two.
   */
  partner?: { key: string; title: string; phase: ChatPhase; waitingFor?: ChatActivity['waitingFor'] };
}

/** What a chat record says of orchestrators (`_codeflower/sessions/list`). */
interface PairRecord {
  key: string;
  role?: string;
  executor?: string;
  disconnected?: boolean;
}

/** Each connected orchestrator's executor, by the orchestrator's key; an executor may have several. */
export function pairs(sessions: PairRecord[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const session of sessions) {
    if (session.role === 'orchestrator' && !session.disconnected && session.executor) found.set(session.key, session.executor);
  }
  return found;
}

/** The chat paired with `key`: an orchestrator's executor, or an executor's (first) orchestrator. */
export function partnerOf(sessions: PairRecord[], key: string): string | undefined {
  const own = sessions.find((session) => session.key === key);
  if (own?.role === 'orchestrator') return own.disconnected ? undefined : own.executor;
  return sessions.find((session) => session.role === 'orchestrator' && !session.disconnected && session.executor === key)?.key;
}

const URGENCY: Record<ChatPhase, number> = { idle: 0, working: 1, waiting: 2 };

/** An orchestrator's row with its executor's folded in: the more urgent phase of the two shows. */
export function joinPair(orchestrator: FocusChat, executor: FocusChat): FocusChat {
  const partner = { key: executor.key, title: executor.title, phase: executor.phase, ...(executor.waitingFor ? { waitingFor: executor.waitingFor } : {}) };
  if (URGENCY[executor.phase] <= URGENCY[orchestrator.phase]) return { ...orchestrator, partner };
  const { waitingFor: _, ...rest } = orchestrator;
  return { ...rest, phase: executor.phase, since: executor.since, ...(executor.waitingFor ? { waitingFor: executor.waitingFor } : {}), partner };
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

/** The row is the chat's: its own, or (a pair's) its executor's. */
export const same = (chat: FocusChat, other: { workerId: string; key: string } | null | undefined) =>
  !!other && chat.workerId === other.workerId && (chat.key === other.key || chat.partner?.key === other.key);

/** Whether the chat belongs in the list: active, unseen, pinned, or changed recently. */
export function listed(chat: FocusChat, now: number): boolean {
  if (chat.phase !== 'idle' || chat.unseen || chat.pinned) return true;
  const last = Math.max(chat.updatedAt ?? 0, chat.since);
  return now - last < RECENT_MS;
}

/**
 * The listed chats in their groups, each in the order to get to them; empty groups left out.
 * The chat shown is listed too, e.g. an old one opened from its tab or from the older chats.
 */
export function arrange(chats: FocusChat[], now: number, shown?: { workerId: string; key: string } | null): FocusGroup[] {
  const groups: Record<FocusGroupId, FocusChat[]> = { waiting: [], working: [], done: [], idle: [] };
  for (const chat of chats) if (listed(chat, now) || same(chat, shown)) groups[groupOf(chat)].push(chat);
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

/** The chats the list leaves out, the latest first: what *Older chats* offers. */
export function older(chats: FocusChat[], now: number, shown?: { workerId: string; key: string } | null): FocusChat[] {
  const last = (chat: FocusChat) => Math.max(chat.updatedAt ?? 0, chat.since);
  return chats.filter((chat) => !listed(chat, now) && !same(chat, shown)).sort((a, b) => last(b) - last(a));
}

/**
 * The chat to go to next: the one waiting longest, else the one that finished
 * unseen first; never the current one, nor one whose computer does not answer.
 */
export function nextUp(groups: FocusGroup[], current: { workerId: string; key: string } | null): FocusChat | undefined {
  for (const id of ['waiting', 'done'] as const) {
    const next = groups.find((group) => group.id === id)?.chats.find((chat) => !same(chat, current) && !chat.unreachable);
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
