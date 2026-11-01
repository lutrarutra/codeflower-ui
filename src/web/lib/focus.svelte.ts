// The Focus view: the chats of every sandbox in one list, in the order the user
// should get to them (see focusList.ts), the one it shows, and the file shown
// beside it. It reads what the page already knows: the activity the app polls,
// the chats open on the page, and the sandboxes' lists of chats.
import { untrack } from 'svelte';
import type { Worker } from './api.ts';
import type { Need } from './attention.svelte.ts';
import { workerTitle } from './format.ts';
import { arrange, chatPhase, nextUp, step, type ChatPhase, type FocusChat, type FocusGroup } from './focusList.ts';
import { chatTab, tabOf } from './workbench.svelte.ts';
import type { WebWorker } from './worker.svelte.ts';

export interface ChatRef {
  workerId: string;
  key: string;
}

/** What the Focus view reads from the page. */
export interface FocusOwner {
  workers(): Worker[];
  /** The sandbox's agent; made on first use, without connecting. */
  agent(id: string): WebWorker;
  /** The page can reach the sandbox's computer now. */
  reachable(id: string): boolean;
  /** Connecting would take an older sandbox over from another window. */
  elsewhere(worker: Worker): boolean;
  /** The name of the computer the sandbox runs on, when the page shows several; else none. */
  machineName?(id: string): string | undefined;
  need(workerId: string, key: string): Need | undefined;
  /** The page shows the Focus view. */
  active(): boolean;
  /** The chat it shows changed, e.g. for the page's address. */
  selected(chat: ChatRef): void;
}

const PINS = 'codeflower.focusPins';
/** How often the sandboxes' lists of chats are read while the view shows, for the titles of idle chats. */
const SESSIONS_MS = 10_000;

function loadPins(): string[] {
  try {
    const pins: unknown = JSON.parse(localStorage.getItem(PINS) ?? '[]');
    return Array.isArray(pins) ? pins.filter((pin) => typeof pin === 'string') : [];
  } catch {
    return [];
  }
}

/** A sandbox with chats: running, and not one that runs a task by itself. */
export const chatty = (worker: Worker) => !!worker.url && worker.kind !== 'task';

export class Focus {
  groups = $state<FocusGroup[]>([]);
  selected = $state<ChatRef | null>(null);
  /** The file the pane beside the chat shows, by the chat's tab. */
  showing = $state<Record<string, string>>({});
  private pins = $state<string[]>(loadPins());
  private readonly owner: FocusOwner;
  /** Each chat's phase as last seen and since when, by tab. */
  private readonly phases = new Map<string, { phase: ChatPhase; since: number }>();

  constructor(owner: FocusOwner) {
    this.owner = owner;
    $effect.root(() => {
      $effect(() => this.track());
      // The next chat's sandbox connects ahead, so going there does not wait for its connection
      // (through the tunnel: a stream to its computer, the handshake and the agent's setup).
      $effect(() => {
        if (!owner.active()) return;
        const next = this.next;
        if (!next || next.unreachable) return;
        untrack(() => {
          const worker = owner.workers().find((one) => one.id === next.workerId);
          const agent = owner.agent(next.workerId);
          if (!worker || worker.status !== 'ready' || owner.elsewhere(worker)) return;
          if (agent.state !== 'connected' && agent.state !== 'connecting' && agent.state !== 'taken-over')
            void agent.connect().catch(() => undefined);
        });
      });
      $effect(() => {
        if (!owner.active()) return;
        const list = () => {
          for (const worker of untrack(() => owner.workers()))
            if (chatty(worker) && worker.status === 'ready' && owner.reachable(worker.id)) void owner.agent(worker.id).listSessions();
        };
        list();
        const timer = setInterval(list, SESSIONS_MS);
        return () => clearInterval(timer);
      });
    });
  }

  /** The chat to go to next, never the one shown. */
  get next(): FocusChat | undefined {
    return nextUp(this.groups, this.selected);
  }

  select(chat: ChatRef): void {
    if (this.selected?.workerId !== chat.workerId || this.selected.key !== chat.key) this.selected = { workerId: chat.workerId, key: chat.key };
    this.owner.selected(this.selected);
  }

  /** The chat before or after the one shown, in the list's order. */
  move(by: 1 | -1): void {
    const chat = step(this.groups, this.selected, by);
    if (chat) this.select(chat);
  }

  goNext(): void {
    const chat = this.next;
    if (chat) this.select(chat);
  }

  pinned(chat: ChatRef): boolean {
    return this.pins.includes(tabOf(chat.workerId, chatTab(chat.key)));
  }

  togglePin(chat: ChatRef): void {
    const tab = tabOf(chat.workerId, chatTab(chat.key));
    this.pins = this.pins.includes(tab) ? this.pins.filter((pin) => pin !== tab) : [...this.pins, tab];
    try {
      localStorage.setItem(PINS, JSON.stringify(this.pins));
    } catch {
      // Not kept, e.g. in a private window.
    }
  }

  /** The tab of the file shown beside the chat, if any. */
  shownTab(): string | undefined {
    const chat = this.selected;
    const path = chat && this.showing[tabOf(chat.workerId, chatTab(chat.key))];
    return chat && path ? tabOf(chat.workerId, path) : undefined;
  }

  private track(): void {
    const now = Date.now();
    const chats: FocusChat[] = [];
    const present = new Set<string>();
    const workers = this.owner.workers().filter(chatty);
    // Sandboxes of the same name (e.g. two of one agent) say where they run too.
    const names = workers.map((worker) => workerTitle(worker)[0]);
    for (const worker of workers) {
      const agent = untrack(() => this.owner.agent(worker.id));
      const polled = new Map((worker.activity?.chats ?? []).map((chat) => [chat.key, chat]));
      const sessions = new Map(agent.sessions.map((session) => [session.key, session]));
      const keys = new Set([...polled.keys(), ...Object.keys(agent.chats), ...sessions.keys()]);
      const [name, place] = workerTitle(worker);
      // Through the tunnel, the computer says where too.
      const machine = this.owner.machineName?.(worker.id);
      const where = machine ? (place ? `${machine}: ${place}` : machine) : place;
      const sandbox = names.filter((other) => other === name).length > 1 && where ? `${name} · ${where}` : name;
      const unreachable = !this.owner.reachable(worker.id);
      for (const key of keys) {
        const chat = agent.chats[key];
        const activity = polled.get(key);
        const session = sessions.get(key);
        const phase = chatPhase(chat?.status, activity);
        const tab = tabOf(worker.id, chatTab(key));
        present.add(tab);
        const updated = session?.updatedAt ? Date.parse(session.updatedAt) : NaN;
        const updatedAt = Number.isNaN(updated) ? undefined : updated;
        const before = this.phases.get(tab);
        // A chat seen for the first time: an idle one since its last change, an active one from now on.
        const since = before?.phase === phase ? before.since : !before && phase === 'idle' ? (updatedAt ?? now) : now;
        this.phases.set(tab, { phase, since });
        const waitingFor = activity?.waitingFor ?? (chat?.permission ? 'permission' : chat?.question ? 'question' : undefined);
        chats.push({
          workerId: worker.id,
          key,
          title: (chat?.state.title !== 'Chat' && chat?.state.title) || activity?.title || session?.title || 'Untitled chat',
          sandbox,
          phase,
          ...(phase === 'waiting' && waitingFor ? { waitingFor } : {}),
          since,
          ...(updatedAt !== undefined ? { updatedAt } : {}),
          pinned: this.pins.includes(tab),
          unseen: this.owner.need(worker.id, key) === 'done',
          ...(unreachable ? { unreachable } : {})
        });
      }
    }
    for (const tab of this.phases.keys()) if (!present.has(tab)) this.phases.delete(tab);
    this.groups = arrange(chats, now);
  }
}
