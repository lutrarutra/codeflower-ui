// fetch() through an encrypted stream: one request per stream.

import { Kind, MAX_CHUNK, frame, json, jsonFrame, type CloseFrame, type Head } from './envelope.ts';
import type { SecureStream } from './stream.ts';

/** Headers that are the browser's or the connection's business, not the app's. */
const dropped = new Set(['cookie', 'host', 'connection', 'content-length', 'origin', 'referer']);

/**
 * Sends `request` (its path relative to the app) and resolves with the whole
 * response once its body has arrived. Not streamed: a service worker handing
 * back a body it still streams can be stopped before the page has read it
 * (Firefox does, under parallel requests), and the app's responses are small.
 */
export async function tunnelFetch(stream: SecureStream, path: string, request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (!dropped.has(name)) headers[name] = value;
  });
  const body = request.method === 'GET' || request.method === 'HEAD' ? new Uint8Array(0) : new Uint8Array(await request.arrayBuffer());

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
        else if (kind === Kind.close) {
          const close = json<CloseFrame>(data);
          fail(new Error(close.reason || `The computer refused the request (${close.code})`));
        } else fail(new Error('Unexpected answer from the computer'));
        return;
      }
      if (kind === Kind.data) chunks.push(data.slice());
      else if (kind === Kind.end) {
        settled = true;
        stream.close();
        // Responses that carry no body cannot be constructed with one.
        const empty = head.status === 204 || head.status === 304 || request.method === 'HEAD';
        resolve(new Response(empty ? null : new Blob(chunks), { status: head.status, headers: head.headers }));
      } else fail(new Error('Unexpected frame in the response'));
    });
    stream.onClose((code) => fail(new Error(`The connection closed before the response ended (${code})`)));

    stream.send(jsonFrame(Kind.open, { kind: 'http', method: request.method, path, headers }));
    for (let offset = 0; offset < body.length; offset += MAX_CHUNK) stream.send(frame(Kind.data, body.subarray(offset, offset + MAX_CHUNK)));
    stream.send(frame(Kind.end));
  });
}
