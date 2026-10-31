// What one transport message carries: a kind byte, then data. A stream
// carries one HTTP exchange or one WebSocket. Mirrors codeflower-app's
// internal/tunnel/envelope.go; see the tunnel's PROTOCOL.md, "Envelope".

export const Kind = {
  open: 1,
  head: 2,
  data: 3,
  end: 4,
  text: 5,
  binary: 6,
  close: 7,
  accepted: 8,
  textPart: 9,
  binaryPart: 10
} as const;

export type KindValue = (typeof Kind)[keyof typeof Kind];

/** The most data one message carries, leaving room for the kind. */
export const MAX_CHUNK = 60000;
/** The longest WebSocket message assembled from parts. */
export const MAX_MESSAGE = 32 << 20;

export interface OpenRequest {
  kind: 'http' | 'ws';
  method?: string;
  path: string;
  headers?: Record<string, string>;
}

export interface Head {
  status: number;
  headers?: Record<string, string>;
}

export interface CloseFrame {
  code: number;
  reason?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function frame(kind: number, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  const message = new Uint8Array(1 + data.length);
  message[0] = kind;
  message.set(data, 1);
  return message;
}

export function jsonFrame(kind: number, value: unknown): Uint8Array {
  return frame(kind, encoder.encode(JSON.stringify(value)));
}

export function unframe(message: Uint8Array): { kind: number; data: Uint8Array } {
  if (message.length === 0) throw new Error('Empty message');
  return { kind: message[0], data: message.subarray(1) };
}

export function json<T>(data: Uint8Array): T {
  return JSON.parse(decoder.decode(data)) as T;
}

/** A WebSocket message as frames of at most MAX_CHUNK bytes. */
export function parts(binary: boolean, data: Uint8Array): Uint8Array[] {
  const [part, last] = binary ? [Kind.binaryPart, Kind.binary] : [Kind.textPart, Kind.text];
  const frames: Uint8Array[] = [];
  let offset = 0;
  while (data.length - offset > MAX_CHUNK) {
    frames.push(frame(part, data.subarray(offset, offset + MAX_CHUNK)));
    offset += MAX_CHUNK;
  }
  frames.push(frame(last, data.subarray(offset)));
  return frames;
}
