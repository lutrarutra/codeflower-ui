// What the whole page shares: the computers and their sandboxes (polled), a
// quit in progress, and where the page is (#/chat/…, #/focus/… or #/server/…).
// Through the tunnel the page shows every paired computer (machines.svelte.ts).
import type { WrapUpNotice } from '../../client/workerConnection.ts';
import { pairedComputers } from '../../tunnel/computers.ts';
import { tunnelConnectorId } from '../../tunnel/connect.ts';
import type { QuitPlan, SystemInfo, Worker } from './api.ts';
import { chooseHead, fromLink, gone, splitId } from './machineIds.ts';
import { Machine, type RequestOptions } from './machines.svelte.ts';
import { Previews } from './previews.svelte.ts';
import { SignIn } from './signIn.svelte.ts';
import { Attention } from './attention.svelte.ts';
import { Focus } from './focus.svelte.ts';
import { INTERACTIVE } from './previews.svelte.ts';
import { Workbench, chatKeyOf, chatTab, splitTab, tabOf } from './workbench.svelte.ts';
import { WebWorker, type WorkerEvents } from './worker.svelte.ts';

export type View = 'chat' | 'focus' | 'server';

export interface Route {
  view: View;
  /** The sandbox of the chat the user looks at, or the one chosen in the sidebar. */
  worker?: string;
  /** The chat the user looks at. */
  session?: string;
  /** The computer the Server view shows (its connector); none: the head. */
  machine?: string;
}

const WORKERS_MS = 1500;
/** How often a hidden page asks for the sandboxes. */
const HIDDEN_MS = 10_000;
/** How often the page looks for paired computers, and asks new ones what they are. */
const DISCOVER_MS = 30_000;
/** The page moved to the newest computer's page once in this tab. */
const HEAD_MOVED = 'cf_head_moved';
/** The user keeps the page of the computer in the address. */
export const KEEP_PAGE = 'codeflower.keepPage';

/** The head: the computer in the address, through the tunnel. */
const head = tunnelConnectorId();

function parseHash(hash: string): Route | undefined {
  const [view, worker, session] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (view !== 'chat' && view !== 'focus' && view !== 'server') return undefined;
  if (view === 'server') return { view, ...(worker ? { machine: worker } : {}) };
  return { view, ...(worker ? { worker: fromLink(worker, head) } : {}), ...(session ? { session } : {}) };
}

function stored(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
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
  return `#/${(route.view === 'server' ? [route.view, route.machine] : [route.view, route.worker, route.session])
    .filter(Boolean)
    .map((part) => encodeURIComponent(part!))
    .join('/')}`;
}

class AppState {
  /** The computer whose page this is: the page's origin, or the connector in the address. */
  readonly head = new Machine(head);
  /** The computers whose sandboxes the page shows, the head first. */
  machines = $state<Machine[]>([this.head]);
  /** Every computer's sandboxes, in the order of the computers. */
  readonly workers = $derived(this.machines.flatMap((machine) => machine.workers));
  quit = $state<QuitPlan | null>(null);
  /** The client has stopped: the page has nothing more to show. */
  stopped = $state(false);
  route = $state<Route>(parseHash(location.hash) ?? { view: 'chat' });
  /** The sandbox whose chats the sidebar lists; none: the list of sandboxes. */
  browsing = $state<string | null>(this.route.worker ?? null);
  /** Sandboxes the user chose to open here although another window had them. */
  takeOver = $state<Record<string, boolean>>({});
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
  /** Part of the page's code could not load from the head (it stopped answering). */
  pageCodeLost = $state(false);
  /** The page knows which computers it shows: until then it lets no sandbox go. */
  private discovered = head === undefined;
  /** The user did something on the page: it no longer moves to another computer's page. */
  private interacted = false;
  private lastPoll = 0;

  /** Signing a sandbox's agent in, and the links agents ask the user to open. */
  readonly signIn = new SignIn();

  /** The sandbox whose agent's plugins the Plugins dialog shows. */
  plugins = $state<{ worker: Worker; agent: WebWorker } | null>(null);

  /** Files shown from the sandboxes, in tabs of their workbenches. */
  readonly previews = new Previews({
    agent: (id) => this.agents.get(id),
    visible: (id, tab) => this.shows(tabOf(id, tab)),
    open: (id, tab) => this.workbench.openFile(id, tab),
    remove: (id, tab) => this.workbench.remove(tabOf(id, tab)),
    showChat: (worker, session) => this.go({ view: this.route.view === 'focus' ? 'focus' : 'chat', worker, session }),
    // The app names the allowlist of a sandbox it isolated.
    isolated: (id) => Boolean(this.worker(id)?.allowlist)
  });

  /** The tabs from every sandbox, in one grid. */
  readonly workbench = new Workbench();
  /** Chats that finished or wait for the user while they looked elsewhere. */
  readonly attention = new Attention({
    workers: () => this.workers,
    agent: (id) => this.agents.get(id),
    shows: (tab) => this.shows(tab),
    open: (worker, session) => this.go({ view: this.route.view === 'focus' ? 'focus' : 'chat', worker, session })
  });
  /** Every sandbox's chats in one list, for keeping agents in parallel moving. */
  readonly focus = new Focus({
    workers: () => this.workers,
    agent: (id) => this.agent(id),
    reachable: (id) => this.reachable(id),
    elsewhere: (worker) => this.elsewhere(worker),
    machineName: (id) => (this.several ? this.machine(id).name : undefined),
    need: (worker, key) => this.attention.need(worker, key),
    active: () => this.route.view === 'focus',
    selected: (chat) => {
      this.wake(chat.workerId);
      if (this.route.view !== 'focus') return;
      this.route = { view: 'focus', worker: chat.workerId, session: chat.key };
      history.replaceState(null, '', routeHash(this.route));
    }
  });
  private quitting = false;
  private firstListed = false;
  /** Computers whose list of sandboxes the page is waiting for. */
  private readonly polling = new Set<Machine>();

  constructor() {
    this.workbench.mayClose = (tab) => {
      const { workerId, local } = splitTab(tab);
      return !!chatKeyOf(local) || this.previews.mayClose(workerId, local);
    };
    this.workbench.onClose = (tab) => {
      const { workerId, local } = splitTab(tab);
      if (!chatKeyOf(local)) this.previews.closed(workerId, local);
    };
    this.workbench.onChatFocus = (chat) => {
      this.follow(chat);
      if (!chat) return;
      this.wake(chat.workerId);
      this.agents.get(chat.workerId)?.refreshUsage();
    };
    // Back to the page: the chat in front shows the quota as it is now.
    window.addEventListener('focus', () => {
      const chat = this.workbench.focusedChat();
      if (chat) this.agents.get(chat.workerId)?.refreshUsage();
    });
    if (this.route.view === 'focus' && this.route.worker && this.route.session) this.focus.selected = { workerId: this.route.worker, key: this.route.session };
    else if (this.route.worker && this.route.session) this.workbench.openChat(this.route.worker, this.route.session);
    this.offer();
    window.addEventListener('hashchange', () => {
      if (this.offer()) return;
      const route = parseHash(location.hash);
      if (route) this.go(route);
    });
    // Code the page loads later (e.g. the sign-in terminal) comes from the head too.
    if (head !== undefined)
      window.addEventListener('vite:preloadError', (event) => {
        event.preventDefault();
        this.pageCodeLost = true;
      });
    const interacted = () => (this.interacted = true);
    window.addEventListener('pointerdown', interacted, { once: true, capture: true });
    window.addEventListener('keydown', interacted, { once: true, capture: true });
  }

  /** The head's system info: what the page itself is (a sandbox's own page, connect only). */
  get system(): SystemInfo | null {
    return this.head.system;
  }

  /** The first list of sandboxes arrived, from any computer. */
  get listed(): boolean {
    return this.machines.some((machine) => machine.listed);
  }

  /** The page shows several computers' sandboxes. */
  get several(): boolean {
    return this.machines.length > 1;
  }

  /** The key of the computer a sandbox (by the page's id) runs on. */
  private machineKey(id: string): string {
    return head === undefined ? '' : (splitId(id).connectorId ?? '');
  }

  /** The computer a sandbox (by the page's id) runs on; the head for ids that name none. */
  machine(id: string): Machine {
    const key = this.machineKey(id);
    return this.machines.find((machine) => machine.key === key) ?? this.head;
  }

  /**
   * A chat came to the front: if its connection went (the tunnel closes chats
   * after idle minutes), it connects again at once, not at the next retry.
   */
  private wake(workerId: string): void {
    const agent = this.agents.get(workerId);
    if (agent?.state === 'disconnected' && Object.keys(agent.chats).length) void agent.connect().catch(() => undefined);
  }

  /** A request about one sandbox to its computer's app: `rest` follows /api/workers/{its id}. */
  workerApi<T>(id: string, rest: string, options?: RequestOptions): Promise<T> {
    const machine = this.machine(id);
    return machine.api<T>(`/api/workers/${encodeURIComponent(machine.remoteId(id))}${rest}`, options);
  }

  /** The address of this page, with the same route, as another computer serves it. */
  pageFrom(machine: Machine): string {
    return `/m/${machine.connectorId}/${routeHash(this.route)}`;
  }

  /** The computer the Server view shows. */
  get serverMachine(): Machine {
    return this.machines.find((machine) => machine.connectorId === this.route.machine) ?? this.head;
  }

  /** The page can reach the sandbox's computer now. */
  reachable(id: string): boolean {
    return this.machine(id).reach === 'reachable';
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

  /**
   * Goes where the user asked: a chat opens in the workbench, and the sidebar
   * lists the chats of its sandbox.
   */
  go(route: Route): void {
    // A sandbox's own page has no Server view.
    if (this.single && route.view === 'server') route = { view: 'chat', ...(this.workers[0] ? { worker: this.workers[0].id } : {}) };
    if (route.view === 'server' && route.machine === this.head.connectorId) route = { view: 'server' };
    const again = route.view === 'chat' && route.worker !== undefined && route.worker === this.browsing && this.route.view === 'chat';
    // Back to the chats: the address names the chat in front, and the sidebar stays as it was.
    const focused = route.view === 'chat' && !route.worker ? this.workbench.focusedChat() : undefined;
    if (focused) {
      route = { view: 'chat', worker: focused.workerId, session: focused.key };
      this.route = route;
      const hash = routeHash(route);
      if (location.hash !== hash) history.pushState(null, '', hash);
      return;
    }
    // Focus without a chat: the one it showed last.
    if (route.view === 'focus' && !route.session && this.focus.selected) route = { view: 'focus', worker: this.focus.selected.workerId, session: this.focus.selected.key };
    this.route = route;
    const hash = routeHash(route);
    if (location.hash !== hash) history.pushState(null, '', hash);
    if (route.view === 'focus' && route.worker && route.session) this.focus.select({ workerId: route.worker, key: route.session });
    if (route.view !== 'chat' || !route.worker) return;
    this.browsing = route.worker;
    if (route.session) this.workbench.openChat(route.worker, route.session);
    // Choosing the sandbox it lists already: its overview.
    else if (again) this.workbench.openOverview(route.worker);
  }

  /** The sidebar lists the sandbox's chats (null: the sandboxes again). */
  browse(id: string | null): void {
    if (id === null) {
      this.browsing = null;
      return;
    }
    this.go({ view: 'chat', worker: id });
  }

  /** The tab is in front of its group, on the page in front. */
  shows(tab: string): boolean {
    if (this.route.view === 'focus') {
      const chat = this.focus.selected;
      const file = this.focus.shownTab();
      return (!!chat && tab === tabOf(chat.workerId, chatTab(chat.key))) || (!!file && (tab === file || tab === file + INTERACTIVE));
    }
    return this.route.view === 'chat' && this.workbench.layout.visible(tab);
  }

  /** The address follows the chat the user looks at, in whichever sandbox, without a step in the history. */
  private follow(chat: { workerId: string; key: string } | undefined): void {
    if (this.route.view !== 'chat' || !chat) return;
    if (this.route.worker === chat.workerId && this.route.session === chat.key) return;
    this.route = { view: 'chat', worker: chat.workerId, session: chat.key };
    history.replaceState(null, '', routeHash(this.route));
  }

  /**
   * An older sandbox that another window has (VS Code, another tab): connecting takes it over, so the
   * page asks first. Newer ones show the chats in every window at once.
   */
  elsewhere(worker: Worker): boolean {
    const agent = this.agents.get(worker.id);
    return (
      agent?.state !== 'connected' &&
      !!worker.activity?.connected &&
      !worker.activity.multiClient &&
      worker.relays === 0 &&
      !this.takeOver[worker.id]
    );
  }

  async openHere(worker: Worker): Promise<void> {
    const agent = this.agent(worker.id);
    this.takeOver[worker.id] = true;
    if (agent.state === 'taken-over') await agent.takeBack().catch(() => undefined);
  }

  worker(id: string | undefined): Worker | undefined {
    return id ? this.workers.find((worker) => worker.id === id) : undefined;
  }

  /** The sandbox's agent as the page reaches it; made on first use. */
  agent(id: string): WebWorker {
    let agent = this.agents.get(id);
    if (!agent) {
      agent = new WebWorker(id, this.events, this.machine(id));
      const worker = this.worker(id);
      if (worker) agent.place = worker.source === 'added' ? (worker.address ?? '') : worker.project;
      this.agents.set(id, agent);
    }
    return agent;
  }

  /**
   * Asks every computer the page reaches for its sandboxes, each on its own, so
   * one that is slow to answer holds up none of the others. A computer that
   * does not answer keeps its last list, and its tabs; a sandbox goes when its
   * own computer answers without it.
   */
  async refreshWorkers(): Promise<void> {
    this.lastPoll = Date.now();
    await Promise.all(this.machines.map((machine) => this.refreshMachine(machine)));
  }

  private async refreshMachine(machine: Machine): Promise<void> {
    if (!machine.polled || this.polling.has(machine)) return;
    this.polling.add(machine);
    let answered: boolean;
    try {
      answered = await machine.refreshWorkers();
    } finally {
      this.polling.delete(machine);
    }
    if (machine === this.head) {
      if (!answered) {
        // The client stopped while it was quitting.
        if (this.quitting) this.stopped = true;
        return;
      }
      // A sandbox's own page opens on it.
      const only = this.workers[0];
      if (!this.firstListed && this.single && only && this.route.view !== 'focus' && (this.route.view !== 'chat' || this.route.worker !== only.id)) {
        this.go({ view: 'chat', worker: only.id, ...(this.route.worker === only.id && this.route.session ? { session: this.route.session } : {}) });
      }
      this.firstListed = true;
    }
    if (!answered) return;
    for (const worker of machine.workers) {
      const agent = this.agents.get(worker.id);
      if (agent) agent.place = worker.source === 'added' ? (worker.address ?? '') : worker.project;
    }
    if (this.discovered) this.letGo();
    // A quit may have begun elsewhere: Ctrl+C in the terminal, or the tray.
    if (machine === this.head && (this.quitting || machine.workers.some((worker) => worker.quitting))) {
      this.setQuit(await machine.api<QuitPlan>('/api/quit').catch(() => ({ stopping: true }) as QuitPlan));
    }
  }

  /** Sandboxes gone from their computer's list (stopped, forgotten) close their connection, and their tabs. */
  private letGo(): void {
    const listings = new Map(this.machines.map((machine) => [machine.key, machine.listed ? new Set(machine.workers.map((worker) => worker.id)) : undefined]));
    const ids = new Set([...this.agents.keys(), ...this.workbench.layout.tabs().map((tab) => splitTab(tab).workerId)]);
    if (this.browsing) ids.add(this.browsing);
    for (const id of gone(ids, listings, (id) => this.machineKey(id))) {
      const agent = this.agents.get(id);
      if (agent) {
        agent.close();
        this.agents.delete(id);
        this.previews.closeWorker(id);
        this.signIn.closeWorker(id);
      }
      this.workbench.removeWorker(id);
      if (this.browsing === id) this.browsing = null;
    }
  }

  /**
   * Through the tunnel: the computers this browser is paired with. New ones say
   * what they are (their system info) before the page asks for their sandboxes.
   */
  private async discover(): Promise<void> {
    if (head === undefined) return;
    const found = await pairedComputers(head);
    const machines = found.map((item) => {
      const machine = this.machines.find((known) => known.connectorId === item.id) ?? new Machine(item.id);
      if (item.name) machine.name = item.name;
      if (item.online !== undefined) machine.online = item.online || machine === this.head;
      if (item.onAccount !== undefined) machine.elsewhere = !item.onAccount;
      return machine;
    });
    // The head first, then by name.
    this.machines = [this.head, ...machines.filter((machine) => machine !== this.head).sort((a, b) => a.name.localeCompare(b.name))];
    await Promise.all(this.machines.map((machine) => (!machine.system && machine.online && !machine.elsewhere ? machine.loadSystem() : undefined)));
    this.discovered = true;
  }

  /**
   * Once per tab, as the page loads: the newest computer's page runs, as a newer
   * page can use older apps and not the other way round. The address keeps the
   * route, whose ids name their computers.
   */
  private moveToNewestPage(): void {
    if (head === undefined || this.interacted || stored(() => localStorage, KEEP_PAGE) === 'true' || stored(() => sessionStorage, HEAD_MOVED)) return;
    const candidates = this.machines
      .filter((machine) => machine.system && machine.online && !machine.elsewhere)
      .map((machine) => ({ connectorId: machine.connectorId!, pageApi: machine.system!.pageApi, version: machine.system!.version }));
    const target = chooseHead(head, candidates);
    if (target === head) return;
    try {
      sessionStorage.setItem(HEAD_MOVED, target);
    } catch {
      return;
    }
    location.replace(`/m/${target}/${routeHash(this.route)}`);
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
    void this.head.loadSystem().then(async () => {
      await this.discover().catch(() => undefined);
      this.moveToNewestPage();
      await this.refreshWorkers();
    });
    setInterval(() => {
      if (document.hidden && Date.now() - this.lastPoll < HIDDEN_MS) return;
      void this.refreshWorkers();
    }, WORKERS_MS);
    if (head !== undefined) setInterval(() => void this.discover().catch(() => undefined), DISCOVER_MS);
  }
}

export const app = new AppState();
