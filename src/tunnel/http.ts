// fetch() through an encrypted stream: one request per stream. mux.ts sends
// many over one; both build requests and responses here.

import { Kind, MAX_CHUNK, frame, json, jsonFrame, type CloseFrame, type Head } from './envelope.ts';
import type { SecureStream } from './stream.ts';

/** Headers that are the browser's or the connection's business, not the app's. */
const dropped = new Set(['cookie', 'host', 'connection', 'content-length', 'origin', 'referer']);

/** A request as it goes to the connector: its path relative to the app, and its whole body. */
export interface Outgoing {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export async function outgoing(path: string, request: Request): Promise<Outgoing> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (!dropped.has(name)) headers[name] = value;
  });
  const body = request.method === 'GET' || request.method === 'HEAD' ? new Uint8Array(0) : new Uint8Array(await request.arrayBuffer());
  return { method: request.method, path, headers, body };
}

/** The `open` message's data. */
export function openRequest(request: Outgoing) {
  return { kind: 'http', method: request.method, path: request.path, headers: request.headers };
}

/** The body's `data` chunks. */
export function* bodyChunks(body: Uint8Array): Generator<Uint8Array> {
  for (let offset = 0; offset < body.length; offset += MAX_CHUNK) yield body.subarray(offset, offset + MAX_CHUNK);
}

export function toResponse(head: Head, chunks: Uint8Array<ArrayBuffer>[], method: string): Response {
  // Responses that carry no body cannot be constructed with one.
  const empty = head.status === 204 || head.status === 304 || method === 'HEAD';
  return new Response(empty ? null : new Blob(chunks), { status: head.status, headers: head.headers });
}

export function refusal(data: Uint8Array): Error {
  const close = json<CloseFrame>(data);
  return new Error(close.reason || `The computer refused the request (${close.code})`);
}

/**
 * Sends `request` on a stream of its own and resolves with the whole response
 * once its body has arrived. Not streamed: a service worker handing back a
 * body it still streams can be stopped before the page has read it (Firefox
 * does, under parallel requests), and the app's responses are small.
 */
export function tunnelFetch(stream: SecureStream, request: Outgoing): Promise<Response> {
  return new Promise((resolve, reject) => {
    let head: Head | undefined;
    let settled = false;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
      stream.close();
    };
    stream.onFrame((kind, data) => {
      if (settled) return;
      if (!head) {
        if (kind === Kind.head) head = json<Head>(data);
        else if (kind === Kind.close) fail(refusal(data));
        else fail(new Error('Unexpected answer from the computer'));
        return;
      }
      if (kind === Kind.data) chunks.push(data.slice());
      else if (kind === Kind.end) {
        settled = true;
        stream.close();
        resolve(toResponse(head, chunks, request.method));
      } else fail(new Error('Unexpected frame in the response'));
    });
    stream.onClose((code) => fail(new Error(`The connection closed before the response ended (${code})`)));

    stream.send(jsonFrame(Kind.open, openRequest(request)));
    for (const chunk of bodyChunks(request.body)) stream.send(frame(Kind.data, chunk));
    stream.send(frame(Kind.end));
  });
}
