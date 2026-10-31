// A chat's Transport through an encrypted stream: the same text frames of
// JSON-RPC as the app's relay carries, only end-to-end encrypted.

import type { Transport } from '../client/transport.ts';
import { Kind, MAX_MESSAGE, json, jsonFrame, parts, type CloseFrame } from './envelope.ts';
import type { SecureStream } from './stream.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Opens the WebSocket at `path` (e.g. /api/workers/{id}/acp) on the app, through `stream`. */
export function tunnelTransport(stream: SecureStream, path: string): Promise<Transport> {
  const messageListeners: Array<(text: string) => void> = [];
  const closeListeners: Array<(code: number, reason: string) => void> = [];
  let open = false;
  let closed = false;
  let pending: Uint8Array[] = [];
  let pendingSize = 0;

  const finish = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    open = false;
    for (const listener of closeListeners) listener(code, reason);
    stream.close();
  };

  const transport: Transport = {
    get open() {
      return open;
    },
    send: (text) => {
      for (const part of parts(false, encoder.encode(text))) stream.send(part);
    },
    close: (code = 1000, reason = 'Client closed the connection') => {
      if (!closed) {
        try {
          stream.send(jsonFrame(Kind.close, { code, reason }));
        } catch {
          // The stream is gone already.
        }
      }
      finish(code, reason);
    },
    onMessage: (listener) => messageListeners.push(listener),
    onClose: (listener) => closeListeners.push(listener)
  };

  return new Promise((resolve, reject) => {
    stream.onFrame((kind, data) => {
      if (!open && !closed) {
        if (kind === Kind.accepted) {
          open = true;
          resolve(transport);
        } else if (kind === Kind.close) {
          const close = json<CloseFrame>(data);
          closed = true;
          stream.close();
          reject(new Error(close.reason || `The chat could not open (${close.code})`));
        }
        return;
      }
      switch (kind) {
        case Kind.textPart:
        case Kind.binaryPart:
          pendingSize += data.length;
          if (pendingSize > MAX_MESSAGE) return transport.close(1009, 'Message too large');
          pending.push(data.slice());
          return;
        case Kind.text: {
          const whole = new Uint8Array(pendingSize + data.length);
          let offset = 0;
          for (const part of pending) {
            whole.set(part, offset);
            offset += part.length;
          }
          whole.set(data, offset);
          pending = [];
          pendingSize = 0;
          const text = decoder.decode(whole);
          for (const listener of messageListeners) listener(text);
          return;
        }
        case Kind.binary:
          // The chat speaks text only.
          pending = [];
          pendingSize = 0;
          return;
        case Kind.close: {
          const close = json<CloseFrame>(data);
          return finish(close.code, close.reason ?? '');
        }
        default:
          return transport.close(1002, 'Unexpected frame');
      }
    });
    stream.onClose((code, reason) => {
      if (!open && !closed) {
        closed = true;
        reject(new Error(reason || `The connection closed (${code})`));
      } else finish(code === 1005 || code === 1006 ? 1006 : code, reason);
    });
    stream.send(jsonFrame(Kind.open, { kind: 'ws', path }));
  });
}
