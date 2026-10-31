// fetch() through an encrypted stream: one request per stream.

import { Kind, MAX_CHUNK, frame, json, jsonFrame, type CloseFrame, type Head } from './envelope.ts';
import type { SecureStream } from './stream.ts';

/** Headers that are the browser's or the connection's business, not the app's. */
const dropped = new Set(['cookie', 'host', 'connection', 'content-length', 'origin', 'referer']);

/**
 * Sends `request` (its path relative to the app) and resolves with the
 * response as soon as its head arrives; the body streams in after.
 */
export async function tunnelFetch(stream: SecureStream, path: string, request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (!dropped.has(name)) headers[name] = value;
  });
  const body = request.method === 'GET' || request.method === 'HEAD' ? new Uint8Array(0) : new Uint8Array(await request.arrayBuffer());

  return new Promise((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let headed = false;
    const bodyStream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
      },
      cancel: () => stream.close()
    });
    stream.onFrame((kind, data) => {
      if (!headed) {
        if (kind === Kind.head) {
          headed = true;
          const head = json<Head>(data);
          // Responses that carry no body cannot be constructed with one.
          const empty = head.status === 204 || head.status === 304 || request.method === 'HEAD';
          resolve(new Response(empty ? null : bodyStream, { status: head.status, headers: head.headers }));
          return;
        }
        if (kind === Kind.close) {
          const close = json<CloseFrame>(data);
          reject(new Error(close.reason || `The computer refused the request (${close.code})`));
        } else {
          reject(new Error('Unexpected answer from the computer'));
        }
        stream.close();
        return;
      }
      if (kind === Kind.data) controller?.enqueue(data.slice());
      else if (kind === Kind.end) {
        controller?.close();
        stream.close();
      } else {
        controller?.error(new Error('Unexpected frame in the response'));
        stream.close();
      }
    });
    stream.onClose((code) => {
      if (!headed) reject(new Error(`The connection closed (${code})`));
      else {
        try {
          controller?.error(new Error('The connection closed before the response ended'));
        } catch {
          // Already closed normally.
        }
      }
    });

    stream.send(jsonFrame(Kind.open, { kind: 'http', method: request.method, path, headers }));
    for (let offset = 0; offset < body.length; offset += MAX_CHUNK) stream.send(frame(Kind.data, body.subarray(offset, offset + MAX_CHUNK)));
    stream.send(frame(Kind.end));
  });
}
