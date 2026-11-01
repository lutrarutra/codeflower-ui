// The computers the page shows sandboxes of. The local page shows one: its own
// origin. Through the tunnel it shows every computer this browser is paired
// with, each reached through the service worker under /m/{connector}/ and its
// chats through encrypted streams. The computer in the address is the head:
// its page is the one running (see machineIds.ts).
import { webSocketTransport, type Transport } from '../../client/transport.ts';
import { connectorStream } from '../../tunnel/connect.ts';
import { tunnelTransport } from '../../tunnel/transport.ts';
import type { SystemInfo, Worker } from './api.ts';
import { pageApiFits, qualify, splitId } from './machineIds.ts';

/** How long a computer that stopped answering counts as unreachable before it counts as offline. */
const OFFLINE_MS = 5 * 60_000;

export interface RequestOptions {
  method?: string;
  body?: unknown;
}

/**
 * How the page reaches a computer: `reachable`; `unreachable` (its last
 * answers failed); `offline` (the tunnel says so, or it failed for minutes);
 * `elsewhere` (paired, but not on the tunnel account this browser is signed in
 * with); `newer` (its app's page API is newer than this page's).
 */
export type Reach = 'loading' | 'reachable' | 'unreachable' | 'offline' | 'elsewhere' | 'newer';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Machine {
  /** The connector; none for the page's own origin. */
  readonly connectorId: string | undefined;
  /** The computer's name, as it signed in to the tunnel. */
  name = $state('');
  /** The tunnel says the computer is connected (always, without the tunnel). */
  online = $state(true);
  /** The computer is not on the tunnel account this browser is signed in with. */
  elsewhere = $state(false);
  system = $state<SystemInfo | null>(null);
  systemError = $state('');
  /** Its sandboxes, with the page's ids; the last list it gave. */
  workers = $state<Worker[]>([]);
  /** It listed its sandboxes at least once. */
  listed = $state(false);
  /** Since when its lists fail; null while it answers. */
  failingSince = $state<number | null>(null);
  /** Lists that failed in a row: each one says again how long it has been failing. */
  private failures = $state(0);
  error = $state('');

  constructor(connectorId?: string, name = '') {
    this.connectorId = connectorId;
    this.name = name || connectorId || '';
  }

  /** The key the page files the computer under: its connector, or '' for the page's origin. */
  get key(): string {
    return this.connectorId ?? '';
  }

  get reach(): Reach {
    if (this.elsewhere) return 'elsewhere';
    if (!this.online) return 'offline';
    if (this.system && pageApiFits(this.system.pageApi) === 'newer') return 'newer';
    if (this.failingSince !== null && this.failures > 0) return Date.now() - this.failingSince > OFFLINE_MS ? 'offline' : 'unreachable';
    return this.listed ? 'reachable' : 'loading';
  }

  /** The page asks it for its sandboxes. */
  get polled(): boolean {
    return this.online && !this.elsewhere && (!this.system || pageApiFits(this.system.pageApi) === 'yes');
  }

  /** The page's id for one of its sandboxes. */
  qualify(id: string): string {
    return qualify(id, this.connectorId);
  }

  /** Its own id for a sandbox the page names. */
  remoteId(pageId: string): string {
    return this.connectorId ? splitId(pageId).id : pageId;
  }

  /** A sandbox as it gave it, with the page's id. */
  adopt(worker: Worker): Worker {
    return { ...worker, id: this.qualify(worker.id) };
  }

  /** Its app's API: /api/… relative to the page locally, /m/{connector}/api/… through the tunnel. */
  async api<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(this.connectorId ? `/m/${this.connectorId}${path}` : `.${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `The app answered ${response.status}`);
    return data;
  }

  /**
   * A chat's connection: the app's relay on this page's origin, or through the
   * tunnel an encrypted stream to the connector (the service worker that serves
   * the tunnelled page's requests cannot intercept WebSockets).
   */
  async openTransport(path: string): Promise<Transport> {
    if (this.connectorId) return tunnelTransport(await connectorStream(this.connectorId), path);
    const url = new URL(`.${path}`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return webSocketTransport(url.toString());
  }

  async loadSystem(query?: { engine: string; image: string; imageTag: string }): Promise<void> {
    try {
      this.system = await this.api<SystemInfo>(query ? `/api/system?${new URLSearchParams(query)}` : '/api/system');
      this.systemError = '';
    } catch (error) {
      this.systemError = describe(error);
    }
  }

  /** Lists its sandboxes; false when it did not answer, and its last list stays. */
  async refreshWorkers(): Promise<boolean> {
    try {
      const workers = await this.api<Worker[]>('/api/workers');
      this.workers = workers.map((worker) => this.adopt(worker));
      this.listed = true;
      this.failingSince = null;
      this.failures = 0;
      this.error = '';
      return true;
    } catch (error) {
      this.failingSince ??= Date.now();
      this.failures++;
      this.error = describe(error);
      return false;
    }
  }
}
