// What the whole page shares: the computer's system info, the sandboxes (polled),
// a quit in progress, and where the page is (#/chat/… or #/server).
import type { WrapUpNotice } from '../../client/workerConnection.ts';
import { api, type QuitPlan, type SystemInfo, type Worker } from './api.ts';
import { Previews } from './previews.svelte.ts';
import { SignIn } from './signIn.svelte.ts';
import { WebWorker, type WorkerEvents } from './worker.svelte.ts';

export type View = 'chat' | 'server';

export interface Route {
  view: View;
  /** The sandbox chosen in the sidebar. */
  worker?: string;
  /** The chat open in it. */
  session?: string;
}

const WORKERS_MS = 1500;

function parseHash(hash: string): Route | undefined {
  const [view, worker, session] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (view !== 'chat' && view !== 'server') return undefined;
  return { view, ...(worker ? { worker } : {}), ...(session ? { session } : {}) };
}

export function routeHash(route: Route): string {
  return `#/${[route.view, route.worker, route.session]
    .filter(Boolean)
    .map((part) => encodeURIComponent(part!))
    .join('/')}`;
}

class AppState {
  system = $state<SystemInfo | null>(null);
  systemError = $state('');
  workers = $state<Worker[]>([]);
  /** Whether the first list of sandboxes arrived. */
  listed = $state(false);
  quit = $state<QuitPlan | null>(null);
  /** The client has stopped: the page has nothing more to show. */
  stopped = $state(false);
  route = $state<Route>(parseHash(location.hash) ?? { view: 'chat' });
  /** Opens the quit dialog; set by the shell. */
  askToQuit: () => void = () => {};
  /** The latest wrap-up a sandbox announced, by sandbox. */
  wrapUps = $state<Record<string, WrapUpNotice>>({});

  /** The agents of the sandboxes, by sandbox; each connects when a chat on it opens. */
  private readonly agents = new Map<string, WebWorker>();
  private readonly events: WorkerEvents = {
    show: (worker, request) => this.previews.show(worker, request),
    openFile: (worker, chat, path) => void this.previews.openPath(worker, path, chat.key),
    signIn: (worker) => void this.signIn.start(worker),
    elicitUrl: (worker, request) => this.signIn.elicitUrl(worker, request),
    elicitationComplete: (worker, elicitationId) => this.signIn.elicitationComplete(worker, elicitationId),
    terminalOutput: (terminalId, data) => this.signIn.terminalOutput(terminalId, data),
    terminalExit: (terminalId, exitCode) => this.signIn.terminalExit(terminalId, exitCode),
    wrapUp: (worker, notice) => {
      this.wrapUps[worker.id] = notice;
    }
  };

  /** Signing a sandbox's agent in, and the links agents ask the user to open. */
  readonly signIn = new SignIn();

  /** Files shown beside the chats, by sandbox. */
  readonly previews = new Previews({
    agent: (id) => this.agents.get(id),
    showing: (id) => this.route.view === 'chat' && this.route.worker === id,
    showChat: (worker, session) => {
      this.go({ view: 'chat', worker, session });
      // In a narrow window the files cover the chat.
      if (!matchMedia('(min-width: 1100px)').matches) this.previews.hidden[worker] = true;
    }
  });

  private quitting = false;

  constructor() {
    window.addEventListener('hashchange', () => {
      const route = parseHash(location.hash);
      if (route) this.route = route;
    });
  }

  go(route: Route): void {
    this.route = route;
    const hash = routeHash(route);
    if (location.hash !== hash) history.pushState(null, '', hash);
  }

  worker(id: string | undefined): Worker | undefined {
    return id ? this.workers.find((worker) => worker.id === id) : undefined;
  }

  /** The sandbox's agent as the page reaches it; made on first use. */
  agent(id: string): WebWorker {
    let agent = this.agents.get(id);
    if (!agent) {
      agent = new WebWorker(id, this.events);
      const worker = this.worker(id);
      if (worker) agent.place = worker.source === 'added' ? (worker.address ?? '') : worker.project;
      this.agents.set(id, agent);
    }
    return agent;
  }

  async loadSystem(query?: { engine: string; image: string; imageTag: string }): Promise<void> {
    try {
      this.system = await api<SystemInfo>(query ? `/api/system?${new URLSearchParams(query)}` : '/api/system');
      this.systemError = '';
    } catch (error) {
      this.systemError = error instanceof Error ? error.message : String(error);
    }
  }

  async refreshWorkers(): Promise<void> {
    try {
      this.workers = await api<Worker[]>('/api/workers');
      this.listed = true;
      for (const worker of this.workers) {
        const agent = this.agents.get(worker.id);
        if (agent) agent.place = worker.source === 'added' ? (worker.address ?? '') : worker.project;
      }
      // A sandbox gone from the list (stopped, forgotten) closes its connection.
      for (const [id, agent] of this.agents) {
        if (!this.workers.some((worker) => worker.id === id)) {
          agent.close();
          this.agents.delete(id);
          this.previews.closeWorker(id);
          this.signIn.closeWorker(id);
        }
      }
    } catch {
      // The client stopped while it was quitting.
      if (this.quitting) this.stopped = true;
      return;
    }
    // A quit may have begun elsewhere: Ctrl+C in the terminal, or the tray.
    if (this.quitting || this.workers.some((worker) => worker.quitting)) {
      this.setQuit(await api<QuitPlan>('/api/quit').catch(() => ({ stopping: true }) as QuitPlan));
    }
  }

  setQuit(plan: QuitPlan): void {
    if (plan.stopping) {
      this.stopped = true;
      return;
    }
    this.quit = plan;
    this.quitting = Boolean(plan.quitting);
  }

  start(): void {
    void this.loadSystem();
    void this.refreshWorkers();
    setInterval(() => void this.refreshWorkers(), WORKERS_MS);
  }
}

export const app = new AppState();
