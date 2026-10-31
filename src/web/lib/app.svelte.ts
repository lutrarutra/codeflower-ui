// What the whole page shares: the computer's system info, the sandboxes (polled),
// a quit in progress, and where the page is (#/chat/… or #/server).
import type { WrapUpNotice } from '../../client/workerConnection.ts';
import { api, type QuitPlan, type SystemInfo, type Worker } from './api.ts';
import { Previews } from './previews.svelte.ts';
import { SignIn } from './signIn.svelte.ts';
import { Workbench, chatKeyOf } from './workbench.svelte.ts';
import { WebWorker, type WorkerEvents } from './worker.svelte.ts';

export type View = 'chat' | 'server';

export interface Route {
  view: View;
  /** The sandbox chosen in the sidebar. */
  worker?: string;
  /** The chat the user looks at in it. */
  session?: string;
}

const WORKERS_MS = 1500;

function parseHash(hash: string): Route | undefined {
  const [view, worker, session] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (view !== 'chat' && view !== 'server') return undefined;
  return { view, ...(worker ? { worker } : {}), ...(session ? { session } : {}) };
}

/** The worker line in a link a sandbox printed (`#add=codeflower://…`), to offer to add. */
export function addLine(hash: string): string | undefined {
  const match = /^#add=(.+)$/.exec(hash);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return undefined;
  }
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
  /** A sandbox's line from a link it printed, waiting for the user to add it. */
  offered = $state<string | null>(null);
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

  /** Files shown from the sandboxes, in tabs of their workbenches. */
  readonly previews = new Previews({
    agent: (id) => this.agents.get(id),
    visible: (id, tab) => this.route.view === 'chat' && this.route.worker === id && !!this.workbenches.get(id)?.layout.visible(tab),
    open: (id, tab) => this.workbench(id).openFile(tab),
    remove: (id, tab) => this.workbenches.get(id)?.remove(tab),
    showChat: (worker, session) => this.go({ view: 'chat', worker, session })
  });

  /** Each sandbox's tabs in their grid; made on first use. */
  private readonly workbenches = new Map<string, Workbench>();
  private quitting = false;

  constructor() {
    this.offer();
    window.addEventListener('hashchange', () => {
      if (this.offer()) return;
      const route = parseHash(location.hash);
      if (route) this.go(route);
    });
  }

  /**
   * A link a sandbox printed: the page offers to add it, and the address bar
   * goes back to where the user was, without the token.
   */
  private offer(): boolean {
    const line = addLine(location.hash);
    // A sandbox's own page adds no others.
    if (line !== undefined && this.single) {
      history.replaceState(null, '', routeHash(this.route));
      return true;
    }
    if (line === undefined) return false;
    this.offered = line;
    history.replaceState(null, '', routeHash(this.route));
    return true;
  }

  /** Goes where the user asked: a chat opens in its sandbox's workbench, a sandbox shows its own. */
  go(route: Route): void {
    // A sandbox's own page has no Server view.
    if (this.single && route.view === 'server') route = { view: 'chat', ...(this.workers[0] ? { worker: this.workers[0].id } : {}) };
    const again = route.view === 'chat' && route.worker !== undefined && route.worker === this.route.worker && this.route.view === 'chat';
    this.route = route;
    const hash = routeHash(route);
    if (location.hash !== hash) history.pushState(null, '', hash);
    if (route.view !== 'chat' || !route.worker) return;
    const workbench = this.workbench(route.worker);
    if (route.session) workbench.openChat(route.session);
    // Choosing the sandbox it shows already: its overview.
    else if (again) workbench.openOverview();
    else this.follow(route.worker, workbench.focusedChat());
  }

  /** The sandbox's tabs; a new one opens the chat the address names. */
  workbench(id: string): Workbench {
    let workbench = this.workbenches.get(id);
    if (!workbench) {
      workbench = new Workbench(id);
      workbench.onClose = (tab) => {
        if (!chatKeyOf(tab)) this.previews.closed(id, tab);
      };
      workbench.onChatFocus = (key) => this.follow(id, key);
      this.workbenches.set(id, workbench);
      if (this.route.worker === id && this.route.session) workbench.openChat(this.route.session);
    }
    return workbench;
  }

  /** The address follows the chat the user looks at, without a step in the history. */
  private follow(worker: string, session: string | undefined): void {
    if (this.route.view !== 'chat' || this.route.worker !== worker || this.route.session === session) return;
    this.route = { view: 'chat', worker, ...(session ? { session } : {}) };
    history.replaceState(null, '', routeHash(this.route));
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
      const first = !this.listed;
      this.listed = true;
      // A sandbox's own page opens on it.
      const only = this.workers[0];
      if (first && this.single && only && (this.route.view !== 'chat' || this.route.worker !== only.id)) {
        this.go({ view: 'chat', worker: only.id, ...(this.route.worker === only.id && this.route.session ? { session: this.route.session } : {}) });
      }
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
          this.workbenches.delete(id);
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

  /** The page is served by one sandbox itself, and shows only it. */
  get single(): boolean {
    return this.system?.capabilities.single ?? false;
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
    // The system first: it says whether this is a sandbox's own page.
    void this.loadSystem().then(() => this.refreshWorkers());
    setInterval(() => void this.refreshWorkers(), WORKERS_MS);
  }
}

export const app = new AppState();
