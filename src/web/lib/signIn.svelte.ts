// Signing a sandbox's agent in from the page. The agent's own flows run inside
// the sandbox and store their login there; the page shows the methods the
// agent advertises and relays what the user types: a key, a link to open, or
// the keystrokes of a sign-in terminal.
import type { AuthMethod } from '@agentclientprotocol/sdk';
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

interface TerminalView {
  output(data: string): void;
  exit(exitCode: number): void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SignIn {
  /** The sandbox signing in; the dialog shows while set. */
  worker = $state<WebWorker | null>(null);
  step = $state<SignInStep>({ kind: 'pick', methods: [] });
  error = $state('');
  links = $state<AgentLink[]>([]);

  private readonly terminals = new Map<string, TerminalView>();
  /** Output that arrived before its terminal knew its id. */
  private readonly early = new Map<string, string>();

  get label(): string {
    return this.worker?.status?.agentLabel ?? 'the agent';
  }

  async start(worker: WebWorker): Promise<void> {
    this.worker = worker;
    this.error = '';
    this.step = { kind: 'working', text: 'Connecting to the sandbox…' };
    try {
      await worker.connect();
      if (!worker.status) await worker.refresh();
    } catch (error) {
      this.error = describe(error);
      return;
    }
    if (this.worker !== worker) return;
    if (worker.status?.credentials === 'keys') {
      this.step = { kind: 'keys' };
      return;
    }
    const methods = worker.connection?.authMethods ?? [];
    this.step = { kind: 'pick', methods };
    if (!methods.length) this.error = `${this.label} offers no sign-in methods to code flower.`;
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
    if (this.worker) void this.start(this.worker);
  }

  async authenticate(method: AuthMethod, apiKey?: string): Promise<void> {
    const worker = this.worker;
    if (!worker?.connection) return;
    this.error = '';
    this.step = { kind: 'working', text: `Signing in to ${this.label}…` };
    try {
      await worker.connection.authenticate(method.id, apiKey ? { 'api-key': { apiKey } } : undefined);
      await this.signedIn(worker);
    } catch (error) {
      if (this.worker !== worker) return;
      this.error = describe(error);
      this.step = apiKey ? { kind: 'key', method } : { kind: 'pick', methods: worker.connection?.authMethods ?? [] };
    }
  }

  /** Saves keys code flower keeps for the agent; it reads them when it starts, so it restarts. */
  async saveKeys(credentials: DshCredentials): Promise<void> {
    const worker = this.worker;
    if (!worker?.connection) return;
    this.error = '';
    this.step = { kind: 'working', text: 'Saving the keys and restarting the agent…' };
    try {
      await worker.connection.setCredentials(credentials);
      await worker.connection.restartAgent();
      await worker.reconnect();
      if (this.worker === worker) this.step = { kind: 'done', text: `${this.label}'s keys are saved in the project.` };
    } catch (error) {
      if (this.worker !== worker) return;
      this.error = describe(error);
      this.step = { kind: 'keys' };
    }
  }

  /** A sign-in terminal ended; 0 means the agent's command signed in. */
  async terminalDone(exitCode: number): Promise<void> {
    if (exitCode === 0 && this.worker) await this.signedIn(this.worker);
  }

  private async signedIn(worker: WebWorker): Promise<void> {
    await worker.afterSignIn(`Signed in to ${this.label}.`);
    if (this.worker === worker) this.step = { kind: 'done', text: `Signed in to ${this.label}.` };
  }

  // ---- routed from the sandboxes ----

  /** Shows a terminal's output, including what came before it registered. */
  attachTerminal(terminalId: string, view: TerminalView): () => void {
    this.terminals.set(terminalId, view);
    const early = this.early.get(terminalId);
    this.early.delete(terminalId);
    if (early) view.output(early);
    return () => this.terminals.delete(terminalId);
  }

  terminalOutput(terminalId: string, data: string): void {
    const view = this.terminals.get(terminalId);
    if (view) view.output(data);
    else this.early.set(terminalId, `${this.early.get(terminalId) ?? ''}${data}`.slice(-65536));
  }

  terminalExit(terminalId: string, exitCode: number): void {
    this.terminals.get(terminalId)?.exit(exitCode);
    this.terminals.delete(terminalId);
    this.early.delete(terminalId);
  }

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
