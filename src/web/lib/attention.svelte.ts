// Chats that need the user while they look elsewhere: an agent finished its
// turn, or waits for an answer (a permission, a question, a plan). Each such
// chat is marked unseen until its tab shows, which the sidebar badges; a toast
// at the top of the page names it, and opens it on a click.
import type { ChatActivity, Worker } from './api.ts';
import { workerTitle } from './format.ts';
import { chatTab, tabOf } from './workbench.svelte.ts';
import type { WebWorker } from './worker.svelte.ts';

/** What the chat needs: it finished its turn, or waits for the user. */
export type Need = 'done' | 'waiting';

export interface Toast {
  id: number;
  workerId: string;
  key: string;
  need: Need;
  /** The chat's title, and its sandbox's name. */
  title: string;
  sandbox: string;
  waitingFor?: ChatActivity['waitingFor'];
}

/** What the tracker reads from the page. */
export interface AttentionOwner {
  workers(): Worker[];
  agent(id: string): WebWorker | undefined;
  /** The tab is in front of its group, on the page in front. */
  shows(tab: string): boolean;
  open(workerId: string, key: string): void;
}

type ChatPhase = 'working' | 'waiting' | 'idle';

const TOAST_MS = 8000;
const MAX_TOASTS = 3;

export class Attention {
  /** Chats that need the user and were not looked at since, by tab. */
  unseen = $state<Record<string, Need>>({});
  toasts = $state<Toast[]>([]);
  private readonly owner: AttentionOwner;
  /** Each chat's phase as last seen, by tab; a chat seen for the first time only sets it. */
  private readonly phases = new Map<string, ChatPhase>();
  private pageShown = $state(typeof document === 'undefined' || document.visibilityState === 'visible');
  private next = 1;

  constructor(owner: AttentionOwner) {
    this.owner = owner;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => (this.pageShown = document.visibilityState === 'visible'));
    }
    $effect.root(() => {
      $effect(() => this.track());
    });
  }

  /** How many of the sandbox's chats need the user. */
  count(workerId: string): number {
    const prefix = tabOf(workerId, '');
    return Object.keys(this.unseen).filter((tab) => tab.startsWith(prefix)).length;
  }

  /** What the chat needs, if the user has not looked at it since. */
  need(workerId: string, key: string): Need | undefined {
    return this.unseen[tabOf(workerId, chatTab(key))];
  }

  /** Sandboxes other than this one with chats that need the user. */
  othersNeed(workerId: string | null): number {
    return this.owner.workers().filter((worker) => worker.id !== workerId && this.count(worker.id) > 0).length;
  }

  open(toast: Toast): void {
    this.dismiss(toast.id);
    this.owner.open(toast.workerId, toast.key);
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
  }

  private track(): void {
    const looking = (tab: string) => this.pageShown && this.owner.shows(tab);
    const present = new Set<string>();
    for (const worker of this.owner.workers()) {
      const agent = this.owner.agent(worker.id);
      const active = new Map((worker.activity?.chats ?? []).map((chat) => [chat.key, chat]));
      // Open chats say their state at once; the others as the app polls the sandbox.
      const keys = new Set([...active.keys(), ...Object.keys(agent?.chats ?? {})]);
      for (const key of keys) {
        const chat = agent?.chats[key];
        const status = chat?.status;
        // A chat whose connection dropped says nothing about its agent.
        if (status === 'offline') continue;
        const polled = active.get(key);
        const phase: ChatPhase = status ? (status === 'ready' ? 'idle' : status) : (polled?.state ?? 'idle');
        const tab = tabOf(worker.id, chatTab(key));
        present.add(tab);
        const before = this.phases.get(tab);
        this.phases.set(tab, phase);
        if (phase === 'working') {
          if (this.unseen[tab]) delete this.unseen[tab];
          continue;
        }
        if (looking(tab)) {
          if (this.unseen[tab]) delete this.unseen[tab];
          continue;
        }
        const need: Need | undefined =
          phase === 'waiting' && before !== undefined && before !== 'waiting' ? 'waiting' : phase === 'idle' && before === 'working' ? 'done' : undefined;
        if (!need) continue;
        this.unseen[tab] = need;
        const session = agent?.sessions.find((candidate) => candidate.key === key);
        const title = chat?.state.title || polled?.title || session?.title || 'Untitled chat';
        this.toast({ workerId: worker.id, key, need, title, sandbox: workerTitle(worker)[0], waitingFor: polled?.waitingFor });
      }
      // A chat the poll no longer lists, and the page has not open, went idle.
      for (const [tab, phase] of this.phases) {
        if (!tab.startsWith(tabOf(worker.id, '')) || present.has(tab) || phase === 'idle') continue;
        this.phases.set(tab, 'idle');
        if (phase !== 'working' || looking(tab)) continue;
        this.unseen[tab] = 'done';
        const key = tab.slice(tabOf(worker.id, chatTab('')).length);
        const title = agent?.sessions.find((candidate) => candidate.key === key)?.title || 'Untitled chat';
        this.toast({ workerId: worker.id, key, need: 'done', title, sandbox: workerTitle(worker)[0] });
      }
    }
    // Looked at since: no longer unseen.
    for (const tab of Object.keys(this.unseen)) if (looking(tab)) delete this.unseen[tab];
  }

  private toast(toast: Omit<Toast, 'id'>): void {
    const id = this.next++;
    const others = this.toasts.filter((other) => other.workerId !== toast.workerId || other.key !== toast.key);
    this.toasts = [...others, { id, ...toast }].slice(-MAX_TOASTS);
    setTimeout(() => this.dismiss(id), TOAST_MS);
  }
}
