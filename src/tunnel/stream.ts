// One end-to-end encrypted stream to a connector through the tunnel: a
// WebSocket to /c/{connector}/stream, the tunnel's `ready`, then the Noise IK
// handshake. Everything after is sealed; the tunnel only passes frames on.

import { Initiator, MAX_PLAINTEXT, PROTOCOL, type Channel, type Keypair } from './noise.ts';
import { unframe } from './envelope.ts';

export interface Hello {
  pair?: string;
  device?: string;
}

/** Why the connector refused this browser, from its (authenticated) answer. */
export class RefusedError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(
      code === 'not_paired'
        ? 'This browser is not paired with that computer. Run "codeflower tunnel pair" there.'
        : code === 'pairing_expired'
          ? 'The pairing link was used or expired. Run "codeflower tunnel pair" again.'
          : code === 'off'
            ? 'Remote access is turned off on that computer ("codeflower tunnel on").'
            : `The computer refused the connection (${code}).`
    );
    this.code = code;
  }
}

export interface StreamOptions {
  /** The tunnel's origin; this page's by default. */
  origin?: string;
  connectorId: string;
  connectorKey: Uint8Array;
  keys: Keypair;
  hello?: Hello;
  timeoutMs?: number;
  /** Opens the WebSocket; tests pass one that sends the session cookie. */
  createSocket?: (url: string) => WebSocket;
}

type Listener = (kind: number, data: Uint8Array) => void;

export class SecureStream {
  private readonly socket: WebSocket;
  private readonly channel: Channel;
  private listeners: Listener[] = [];
  private closeListeners: Array<(code: number, reason: string) => void> = [];
  private queued: Array<{ kind: number; data: Uint8Array }> = [];
  closed = false;

  constructor(socket: WebSocket, channel: Channel) {
    this.socket = socket;
    this.channel = channel;
    socket.addEventListener('message', (event) => {
      if (!(event.data instanceof ArrayBuffer)) return this.close(1003, 'Unexpected text frame');
      let message;
      try {
        message = unframe(this.channel.receive.decrypt(new Uint8Array(event.data)));
      } catch {
        return this.close(1002, 'A frame failed to decrypt');
      }
      if (this.listeners.length === 0) this.queued.push(message);
      for (const listener of this.listeners) listener(message.kind, message.data);
    });
    socket.addEventListener('close', (event) => {
      this.closed = true;
      for (const listener of this.closeListeners) listener(event.code, event.reason);
    });
  }

  send(frame: Uint8Array): void {
    if (frame.length > MAX_PLAINTEXT) throw new Error('Frame too long');
    this.socket.send(this.channel.send.encrypt(frame) as Uint8Array<ArrayBuffer>);
  }

  /** Frames that arrived before the first listener are delivered to it. */
  onFrame(listener: Listener): void {
    this.listeners.push(listener);
    const queued = this.queued;
    this.queued = [];
    for (const message of queued) listener(message.kind, message.data);
  }

  onClose(listener: (code: number, reason: string) => void): void {
    if (this.closed) listener(1006, '');
    else this.closeListeners.push(listener);
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    try {
      this.socket.close(code, reason);
    } catch {
      this.socket.close();
    }
  }
}

/** Opens a stream and completes the handshake; throws RefusedError when the connector says no. */
export function openStream(options: StreamOptions): Promise<SecureStream> {
  const origin = options.origin ?? location.origin;
  const url = `${origin.replace(/^http/, 'ws')}/c/${encodeURIComponent(options.connectorId)}/stream`;
  const socket = options.createSocket ? options.createSocket(url) : new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  return new Promise((resolve, reject) => {
    let initiator: Initiator | undefined;
    const timer = setTimeout(() => fail(new Error('The computer did not answer in time')), options.timeoutMs ?? 20_000);
    const fail = (error: Error) => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      reject(error);
    };
    const onMessage = (event: MessageEvent) => {
      if (!initiator) {
        // The tunnel's `ready`: the connector dialled back. Start the handshake.
        if (typeof event.data !== 'string' || JSON.parse(event.data).type !== 'ready') return fail(new Error('Unexpected answer from the tunnel'));
        initiator = new Initiator(options.keys, options.connectorId, options.connectorKey);
        socket.send(initiator.start(new TextEncoder().encode(JSON.stringify({ v: PROTOCOL, ...options.hello }))) as Uint8Array<ArrayBuffer>);
        return;
      }
      if (!(event.data instanceof ArrayBuffer)) return fail(new Error('Unexpected answer from the computer'));
      let welcome: { v: number; error?: string };
      let channel: Channel;
      try {
        const finished = initiator.finish(new Uint8Array(event.data));
        welcome = JSON.parse(new TextDecoder().decode(finished.payload));
        channel = finished.channel;
      } catch {
        // A wrong key: this is not the paired computer, or the tunnel interfered.
        return fail(new Error('The computer\'s key does not match the paired one. Pair this browser again.'));
      }
      if (welcome.error) return fail(new RefusedError(welcome.error));
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(new SecureStream(socket, channel));
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', (event) => {
      if (event.code === 4404) fail(new Error('The computer is offline: is "codeflower client" running there?'));
      else if (event.code === 4401) fail(new Error('Sign in to the tunnel first.'));
      else fail(new Error(event.reason || `The connection closed (${event.code})`));
    });
    socket.addEventListener('error', () => {
      // The close event follows with the code.
    });
  });
}
