// A minimal JSON-RPC 2.0 connection over a Transport. It passes every message
// through as the peer sent it: no schema strips fields it does not know, so
// newer agents and their `_meta` reach the layers above intact.

import type { Transport } from './transport.ts';

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: JsonRpcError) {
    super(error.message);
    this.code = error.code;
    this.data = error.data;
  }
}

/** A request the connection dropped before it was answered. */
export class ConnectionClosed extends Error {
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

export const METHOD_NOT_FOUND = -32601;

type Message = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
};

export type RequestHandler = (params: unknown) => Promise<unknown> | unknown;
export type NotificationListener = (params: unknown) => void;

export class RpcConnection {
  private readonly transport: Transport;
  private nextId = 1;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly listeners = new Map<string, NotificationListener[]>();
  private readonly closeListeners: Array<(reason: string, code: number) => void> = [];

  constructor(transport: Transport) {
    this.transport = transport;
    transport.onMessage((text) => this.receive(text));
    transport.onClose((code, reason) => {
      const text = reason || `connection closed (${code})`;
      for (const { reject } of this.pending.values()) reject(new ConnectionClosed(text, code));
      this.pending.clear();
      for (const listener of this.closeListeners) listener(text, code);
    });
  }

  get connected(): boolean {
    return this.transport.open;
  }

  /** Answers the peer's requests for `method`; one handler per method. Others get "method not found". */
  handle(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  /** Listens to the peer's notifications for `method`; several listeners may listen. */
  on(method: string, listener: NotificationListener): void {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  onClose(listener: (reason: string, code: number) => void): void {
    this.closeListeners.push(listener);
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(JSON.stringify(id), { resolve: resolve as (value: unknown) => void, reject });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        this.pending.delete(JSON.stringify(id));
        reject(error as Error);
      }
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  close(): void {
    this.transport.close(1000, 'Client closed the connection');
  }

  private send(message: Message): void {
    if (!this.transport.open) throw new Error('Not connected to a worker');
    this.transport.send(JSON.stringify(message));
  }

  private receive(frame: string): void {
    let message: Message;
    try {
      message = JSON.parse(frame) as Message;
    } catch {
      return;
    }
    if (message.method !== undefined && message.id !== undefined && message.id !== null) {
      const id = message.id;
      const handler = this.requestHandlers.get(message.method);
      const answer = handler
        ? Promise.resolve().then(() => handler(message.params))
        : Promise.reject(new RpcError({ code: METHOD_NOT_FOUND, message: `Method not found: ${message.method}` }));
      answer.then(
        (result) => this.trySend({ jsonrpc: '2.0', id, result: result ?? null }),
        (error: unknown) => {
          const rpc =
            error instanceof RpcError
              ? { code: error.code, message: error.message }
              : { code: -32603, message: error instanceof Error ? error.message : String(error) };
          this.trySend({ jsonrpc: '2.0', id, error: rpc });
        }
      );
      return;
    }
    if (message.method !== undefined) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
      return;
    }
    const pending = this.pending.get(JSON.stringify(message.id));
    if (!pending) return;
    this.pending.delete(JSON.stringify(message.id));
    if (message.error) pending.reject(new RpcError(message.error));
    else pending.resolve(message.result);
  }

  private trySend(message: Message): void {
    try {
      this.send(message);
    } catch {
      // The connection closed while a handler was running.
    }
  }
}

export function isMethodNotFound(error: unknown): boolean {
  return error instanceof RpcError && error.code === METHOD_NOT_FOUND;
}
