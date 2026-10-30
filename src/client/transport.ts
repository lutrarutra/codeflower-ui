// How a client reaches an agent: text frames, each one JSON-RPC message, over
// whatever carries them. The layers above never see a socket, so the same
// client runs in the VS Code extension host (a `ws` socket that sends the
// worker's token), in the app's page (a browser WebSocket through the app's
// relay, which adds the token), and in tests (an in-memory pair).

export interface Transport {
  readonly open: boolean;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (text: string) => void): void;
  /** Called once, with the close code (4001: another window took the worker over). */
  onClose(listener: (code: number, reason: string) => void): void;
}

/** The WHATWG WebSocket a browser has, and Node since 22. */
interface StandardWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'error', listener: () => void, options?: { once?: boolean }): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void;
}

const OPEN = 1;

/**
 * Opens a standard WebSocket. It cannot send headers, so the token goes
 * another way: the app's relay adds it.
 */
export function webSocketTransport(
  url: string,
  timeoutMs = 15_000,
  create: (url: string) => StandardWebSocket = (url) => new WebSocket(url) as unknown as StandardWebSocket
): Promise<Transport> {
  const socket = create(url);
  const closeListeners: Array<(code: number, reason: string) => void> = [];
  const transport: Transport = {
    get open() {
      return socket.readyState === OPEN;
    },
    send: (text) => socket.send(text),
    close: (code = 1000, reason = 'Client closed the connection') => socket.close(code, reason),
    onMessage: (listener) =>
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') listener(event.data);
      }),
    onClose: (listener) => closeListeners.push(listener)
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The worker did not answer in time'));
      socket.close();
    }, timeoutMs);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve(transport);
      },
      { once: true }
    );
    socket.addEventListener('close', (event) => {
      clearTimeout(timer);
      reject(new Error(event.reason || `Could not connect (${event.code})`));
      for (const listener of closeListeners) listener(event.code, event.reason);
    });
  });
}
