// Many fetch()es over one encrypted stream: each message carries its
// request's ID, so the responses arrive interleaved, each as soon as it is
// ready. The service worker keeps one per computer, so polling the app costs
// no new stream (or handshake) per request. See "Multiplexed streams" in the
// tunnel's docs/PROTOCOL.md; codeflower-app's serveMux is the other end.

import { Kind, json, muxFrame, muxJsonFrame, unmux, type Head } from './envelope.ts';
import { bodyChunks, openRequest, refusal, toResponse, type Outgoing } from './http.ts';

/** What a multiplexed session needs of its stream (a SecureStream). */
export interface MuxStream {
  readonly closed: boolean;
  send(frame: Uint8Array): void;
  onFrame(listener: (kind: number, data: Uint8Array) => void): void;
  onClose(listener: (code: number, reason: string) => void): void;
  close(code?: number, reason?: string): void;
}

/**
 * The stream closed with the request in flight. `answered`: the computer had
 * started its response, so the request may have done something there.
 */
export class StreamClosedError extends Error {
  readonly answered: boolean;
  constructor(answered: boolean, code?: number) {
    super(`The connection closed before the response ended${code === undefined ? '' : ` (${code})`}`);
    this.answered = answered;
  }
}

/** The most requests in flight at once, as the connector allows; more wait their turn. */
export const MAX_IN_FLIGHT = 32;
/** A session with nothing in flight for this long closes its stream. */
export const IDLE_MS = 60_000;

interface Exchange {
  method: string;
  head?: Head;
  chunks: Uint8Array<ArrayBuffer>[];
  resolve(response: Response): void;
  reject(error: Error): void;
  done(): void;
}

export class MuxSession {
  private readonly stream: MuxStream;
  private readonly idleMs: number;
  private next = 1;
  private readonly exchanges = new Map<number, Exchange>();
  private readonly waiting: Array<() => void> = [];
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private closeCode: number | undefined;

  constructor(stream: MuxStream, idleMs = IDLE_MS) {
    this.stream = stream;
    this.idleMs = idleMs;
    stream.onFrame((kind, data) => this.receive(kind, data));
    stream.onClose((code) => this.ended(code));
    this.idle();
  }

  get closed(): boolean {
    return this.closeCode !== undefined || this.stream.closed;
  }

  /** Sends the request and resolves with the whole response (not streamed, as tunnelFetch). */
  async fetch(request: Outgoing, signal?: AbortSignal): Promise<Response> {
    while (this.exchanges.size >= MAX_IN_FLIGHT && !this.closed) await new Promise<void>((resolve) => this.waiting.push(resolve));
    if (this.closed) throw new StreamClosedError(false, this.closeCode);
    signal?.throwIfAborted();
    clearTimeout(this.idleTimer);
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!this.exchanges.has(id)) return;
        this.finish(id);
        try {
          this.stream.send(muxJsonFrame(Kind.close, id, { code: 1000, reason: 'Aborted' }));
        } catch {
          // The stream is gone already.
        }
        reject(signal?.reason instanceof Error ? signal.reason : new DOMException('The request was aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.exchanges.set(id, { method: request.method, chunks: [], resolve, reject, done: () => signal?.removeEventListener('abort', abort) });
      try {
        this.stream.send(muxJsonFrame(Kind.open, id, openRequest(request)));
        for (const chunk of bodyChunks(request.body)) this.stream.send(muxFrame(Kind.data, id, chunk));
        this.stream.send(muxFrame(Kind.end, id));
      } catch {
        this.finish(id);
        reject(new StreamClosedError(false));
      }
    });
  }

  close(): void {
    this.stream.close(1000, 'Closed');
  }

  private receive(kind: number, message: Uint8Array): void {
    let id: number;
    let data: Uint8Array;
    try {
      ({ id, data } = unmux(message));
    } catch {
      return this.stream.close(1002, 'Malformed message');
    }
    const exchange = this.exchanges.get(id);
    // A request aborted meanwhile: what was on its way is dropped.
    if (!exchange) return;
    if (!exchange.head) {
      if (kind === Kind.head) exchange.head = json<Head>(data);
      else if (kind === Kind.close) {
        this.finish(id);
        exchange.reject(refusal(data));
      } else this.stream.close(1002, 'Unexpected answer from the computer');
      return;
    }
    if (kind === Kind.data) exchange.chunks.push(data.slice());
    else if (kind === Kind.end) {
      this.finish(id);
      exchange.resolve(toResponse(exchange.head, exchange.chunks, exchange.method));
    } else if (kind === Kind.close) {
      this.finish(id);
      exchange.reject(new StreamClosedError(true));
    } else this.stream.close(1002, 'Unexpected frame in the response');
  }

  /** The request is over: let the next one in, or start counting idle time. */
  private finish(id: number): void {
    this.exchanges.get(id)?.done();
    this.exchanges.delete(id);
    this.waiting.shift()?.();
    this.idle();
  }

  private ended(code: number): void {
    if (this.closeCode !== undefined) return;
    this.closeCode = code;
    clearTimeout(this.idleTimer);
    const exchanges = [...this.exchanges.values()];
    this.exchanges.clear();
    for (const exchange of exchanges) {
      exchange.done();
      exchange.reject(new StreamClosedError(exchange.head !== undefined, code));
    }
    for (const wake of this.waiting.splice(0)) wake();
  }

  private idle(): void {
    clearTimeout(this.idleTimer);
    if (this.exchanges.size === 0 && !this.closed) this.idleTimer = setTimeout(() => this.stream.close(1000, 'Idle'), this.idleMs);
  }
}
