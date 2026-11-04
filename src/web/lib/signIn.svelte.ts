// Signing one of a sandbox's agents in from the page. The agent's own flows
// run inside the sandbox and store their login there; the page shows the
// methods the agent advertises and relays what the user types: a key, a link
// to open, or the keystrokes of a sign-in terminal.
import type { AuthMethod } from '@agentclientprotocol/sdk';
import type { AgentName } from '../../protocol/messages.ts';
import type { DshCredentials, UrlElicitation } from '../../client/workerConnection.ts';
import { isApiKeyMethod, isTerminalMethod, isWebLink } from './authMethods.ts';
import type { WebWorker } from './worker.svelte.ts';

export type SignInStep =
  | { kind: 'pick'; methods: AuthMethod[] }
  /** The agent takes a key in `authenticate`. */
  | { kind: 'key'; method: AuthMethod }
  /** code flower stores the agent's keys in the project. */
  | { kind: 'keys' }
  | { kind: 'working'; text: string }
  | { kind: 'terminal'; method: AuthMethod }
  | { kind: 'done'; text: string };

/** A link the agent asks the user to open, e.g. to sign in in the browser. */
export interface AgentLink {
  workerId: string;
  request: UrlElicitation;
  answer: (action: 'accept' | 'decline') => void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SignIn {
  /** The sandbox signing in; the dialog shows while set. */
  worker = $state<WebWorker | null>(null);
  /** The agent of the sandbox signing in. */
  agent = $state<AgentName>('');
  step = $state<SignInStep>({ kind: 'pick', methods: [] });
  error = $state('');
  links = $state<AgentLink[]>([]);

  get label(): string {
    return this.worker?.agent(this.agent)?.name ?? 'the agent';
  }

  async start(worker: WebWorker, agent: AgentName): Promise<void> {
    this.worker = worker;
    this.agent = agent;
    this.error = '';
    this.step = { kind: 'working', text: 'Connecting to the sandbox…' };
    try {
      await worker.connect();
      if (!worker.status) await worker.refresh();
    } catch (error) {
      this.error = describe(error);
      return;
    }
    if (!this.current(worker, agent)) return;
    const state = worker.agent(agent);
    if (state?.unavailable) {
      this.error = state.unavailable;
      return;
    }
    if (state?.credentials === 'keys') {
      this.step = { kind: 'keys' };
      return;
    }
    this.step = { kind: 'working', text: `Starting ${this.label}…` };
    let methods: AuthMethod[];
    try {
      methods = (await worker.connection?.authMethods(agent)) ?? [];
    } catch (error) {
      if (this.current(worker, agent)) this.error = describe(error);
      return;
    }
    if (!this.current(worker, agent)) return;
    this.step = { kind: 'pick', methods };
    if (!methods.length) this.error = `${this.label} offers no sign-in methods to code flower.`;
  }

  /** Still signing this agent in: the user did not close the dialog or start another. */
  private current(worker: WebWorker, agent: AgentName): boolean {
    return this.worker === worker && this.agent === agent;
  }

  close(): void {
    this.worker = null;
  }

  choose(method: AuthMethod): void {
    this.error = '';
    if (isTerminalMethod(method)) this.step = { kind: 'terminal', method };
    else if (isApiKeyMethod(method)) this.step = { kind: 'key', method };
    else void this.authenticate(method);
  }

  back(): void {
    if (this.worker) void this.start(this.worker, this.agent);
  }

  async authenticate(method: AuthMethod, apiKey?: string): Promise<void> {
    const { worker, agent } = this;
    if (!worker?.connection) return;
    this.error = '';
    this.step = { kind: 'working', text: `Signing in to ${this.label}…` };
    try {
      await worker.connection.authenticate(agent, method.id, apiKey ? { 'api-key': { apiKey } } : undefined);
      await this.signedIn(worker, agent);
    } catch (error) {
      if (!this.current(worker, agent)) return;
      this.error = describe(error);
      this.step = apiKey ? { kind: 'key', method } : { kind: 'pick', methods: (await worker.connection?.authMethods(agent).catch(() => [])) ?? [] };
    }
  }

  /**
   * Saves keys code flower keeps for the agent. It reads them when it starts: one that runs
   * restarts, and its open chats attach to the fresh one.
   */
  async saveKeys(credentials: DshCredentials): Promise<void> {
    const { worker, agent } = this;
    if (!worker?.connection) return;
    this.error = '';
    this.step = { kind: 'working', text: 'Saving the keys…' };
    try {
      await worker.connection.setCredentials(agent, credentials);
      if (worker.agent(agent)?.running) await worker.restartAgent(agent);
      await worker.refresh();
      if (this.current(worker, agent)) this.step = { kind: 'done', text: `${this.label}'s keys are saved in the project.` };
    } catch (error) {
      if (!this.current(worker, agent)) return;
      this.error = describe(error);
      this.step = { kind: 'keys' };
    }
  }

  /** A sign-in terminal ended; 0 means the agent's command signed in. */
  async terminalDone(exitCode: number): Promise<void> {
    if (exitCode === 0 && this.worker) await this.signedIn(this.worker, this.agent);
  }

  private async signedIn(worker: WebWorker, agent: AgentName): Promise<void> {
    await worker.afterSignIn(agent, `Signed in to ${this.label}.`);
    if (this.current(worker, agent)) this.step = { kind: 'done', text: `Signed in to ${this.label}.` };
  }

  // ---- routed from the sandboxes ----

  elicitUrl(worker: WebWorker, request: UrlElicitation): Promise<'accept' | 'decline'> {
    if (!isWebLink(request.url)) return Promise.resolve('decline');
    return new Promise((resolve) => {
      const link: AgentLink = {
        workerId: worker.id,
        request,
        answer: (action) => {
          this.links = this.links.filter((candidate) => candidate.request !== request);
          resolve(action);
        }
      };
      this.links = [...this.links, link];
    });
  }

  /** The agent no longer needs the link, e.g. the user finished in the browser. */
  elicitationComplete(worker: WebWorker, elicitationId: string): void {
    for (const link of this.links) {
      if (link.workerId === worker.id && link.request.elicitationId === elicitationId) link.answer('accept');
    }
  }

  /** A sandbox went away: its links can no longer be answered. */
  closeWorker(workerId: string): void {
    for (const link of this.links) if (link.workerId === workerId) link.answer('decline');
    if (this.worker?.id === workerId) this.close();
  }
}
