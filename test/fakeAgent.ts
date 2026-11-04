// In-memory transports and a scripted sandbox on their far end, for testing
// the client without a worker. Every connection, the sandbox's own and the
// agents', reaches the same handlers.
import type { AgentState } from '../src/client/codeflower.ts';
import type { Transport } from '../src/client/transport.ts';

type Message = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: any; result?: unknown; error?: unknown };

interface Connection {
  /** An agent's connection; the sandbox's own takes no ACP. */
  agent: boolean;
  open: boolean;
  messageListener: (text: string) => void;
  closeListeners: Array<(code: number, reason: string) => void>;
}

/** An agent as the sandbox lists it, signed in, with what it offers. */
export function agentState(id: string, more: Partial<AgentState> = {}): AgentState {
  return { id, name: id, signedIn: true, credentials: 'agent', running: false, restartPending: false, capabilities: {}, ...more };
}

export class FakeAgent {
  readonly received: Message[] = [];
  private readonly connections: Connection[] = [];
  private nextId = 1000;
  private readonly answers = new Map<number | string, (message: Message) => void>();
  private readonly handlers: Record<string, (params: any) => unknown>;
  /** The sandbox's agents, as `_codeflower/status` lists them unless a test answers it. */
  agents: AgentState[];

  constructor(handlers: Record<string, (params: any) => unknown>, agents: AgentState[] = [agentState('pi')]) {
    this.handlers = handlers;
    this.agents = agents;
  }

  /** Opens a transport: to an agent, or without one to the sandbox (WorkerConnection's OpenTransport). */
  readonly open = async (agent?: string): Promise<Transport> => this.connect(agent !== undefined);

  /** A new connection; `agent`: one of an agent's, which the agent's requests go to. */
  connect(agent: boolean): Transport {
    const connection: Connection = { agent, open: true, messageListener: () => {}, closeListeners: [] };
    this.connections.push(connection);
    return {
      get open() {
        return connection.open;
      },
      send: (text) => queueMicrotask(() => this.receive(connection, JSON.parse(text))),
      close: (code = 1000, reason = '') => this.closeConnection(connection, code, reason),
      onMessage: (listener) => (connection.messageListener = listener),
      onClose: (listener) => connection.closeListeners.push(listener)
    };
  }

  /** Sends a notification to every connection. */
  notify(method: string, params: unknown): void {
    for (const connection of this.connections) {
      if (connection.open) connection.messageListener(JSON.stringify({ jsonrpc: '2.0', method, params }));
    }
  }

  /** Sends a request to the client on the newest agent connection and resolves with its answer. */
  request(method: string, params: unknown): Promise<Message> {
    const id = this.nextId++;
    const connection = [...this.connections].reverse().find((candidate) => candidate.agent && candidate.open);
    return new Promise((resolve) => {
      this.answers.set(id, resolve);
      connection?.messageListener(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  /** Closes every connection, as a sandbox that went away. */
  close(code: number, reason: string): void {
    for (const connection of this.connections) this.closeConnection(connection, code, reason);
  }

  /** Closes the agents' connections only, as an agent that restarted. */
  closeAgents(code: number, reason: string): void {
    for (const connection of this.connections) if (connection.agent) this.closeConnection(connection, code, reason);
  }

  private closeConnection(connection: Connection, code: number, reason: string): void {
    if (!connection.open) return;
    connection.open = false;
    for (const listener of connection.closeListeners) listener(code, reason);
  }

  /** The default status: the sandbox and its agents; a test's own gets the agents added. */
  private status(params: unknown): unknown {
    const answered = this.handlers['_codeflower/status']?.(params) as Record<string, unknown> | undefined;
    if (answered && Array.isArray(answered.agents)) return answered;
    const agents =
      typeof answered?.agent === 'string'
        ? [agentState(answered.agent, { name: (answered.agentLabel as string) ?? answered.agent, ...(answered.capabilities as object ? { capabilities: answered.capabilities as AgentState['capabilities'] } : {}) })]
        : this.agents;
    return { instanceId: 'test', stateDirectory: null, engine: 'docker', ...answered, agents };
  }

  private async receive(connection: Connection, message: Message): Promise<void> {
    this.received.push(message);
    if (message.method === undefined) {
      this.answers.get(message.id!)?.(message);
      return;
    }
    if (message.id === undefined) {
      this.handlers[message.method]?.(message.params);
      return;
    }
    const handler = message.method === '_codeflower/status' ? (params: unknown) => this.status(params) : this.handlers[message.method];
    const reply = handler
      ? await Promise.resolve()
          .then(() => handler(message.params))
          .then(
            (result) => ({ result: result ?? null }),
            (error: { code?: number; message?: string }) => ({ error: { code: error.code ?? -32603, message: error.message } })
          )
      : { error: { code: -32601, message: `Method not found: ${message.method}` } };
    if (connection.open) connection.messageListener(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...reply }));
  }
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
