// An in-memory transport and a scripted agent on its far end, for testing the
// client without a worker.
import type { Transport } from '../src/client/transport.ts';

type Message = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: any; result?: unknown; error?: unknown };

export class FakeAgent {
  readonly transport: Transport;
  readonly received: Message[] = [];
  private messageListener: (text: string) => void = () => {};
  private closeListeners: Array<(code: number, reason: string) => void> = [];
  private open = true;
  private nextId = 1000;
  private readonly answers = new Map<number | string, (message: Message) => void>();
  private readonly handlers: Record<string, (params: any) => unknown>;

  constructor(handlers: Record<string, (params: any) => unknown>) {
    this.handlers = handlers;
    const agent = this;
    this.transport = {
      get open() {
        return agent.open;
      },
      send: (text) => queueMicrotask(() => this.receive(JSON.parse(text))),
      close: (code = 1000, reason = '') => this.close(code, reason),
      onMessage: (listener) => (this.messageListener = listener),
      onClose: (listener) => this.closeListeners.push(listener)
    };
  }

  /** Sends a notification to the client. */
  notify(method: string, params: unknown): void {
    this.messageListener(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  /** Sends a request to the client and resolves with its answer. */
  request(method: string, params: unknown): Promise<Message> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.answers.set(id, resolve);
      this.messageListener(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  close(code: number, reason: string): void {
    if (!this.open) return;
    this.open = false;
    for (const listener of this.closeListeners) listener(code, reason);
  }

  private async receive(message: Message): Promise<void> {
    this.received.push(message);
    if (message.method === undefined) {
      this.answers.get(message.id!)?.(message);
      return;
    }
    if (message.id === undefined) {
      this.handlers[message.method]?.(message.params);
      return;
    }
    const handler = this.handlers[message.method];
    const reply = handler
      ? await Promise.resolve()
          .then(() => handler(message.params))
          .then(
            (result) => ({ result: result ?? null }),
            (error: { code?: number; message?: string }) => ({ error: { code: error.code ?? -32603, message: error.message } })
          )
      : { error: { code: -32601, message: `Method not found: ${message.method}` } };
    if (this.open) this.messageListener(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...reply }));
  }
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
