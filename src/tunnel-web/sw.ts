// The tunnel's service worker (scope /m/): serves the app's page under
// /m/{connector}/ by fetching each request from the connector through an
// encrypted stream. The page and its code come from the user's computer, not
// from the tunnel.

/// <reference lib="webworker" />

import { appPath, connectorStream, tunnelConnectorId } from '../tunnel/connect.ts';
import { tunnelFetch } from '../tunnel/http.ts';
import { RefusedError } from '../tunnel/stream.ts';

const worker = self as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('install', () => void worker.skipWaiting());
worker.addEventListener('activate', (event) => event.waitUntil(worker.clients.claim()));

function errorPage(title: string, message: string, status: number): Response {
  const escape = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><link rel="stylesheet" href="/style.css"><link rel="icon" href="/icon.svg"></head>
<body><main><header><img src="/icon.svg" alt=""><h1>${escape(title)}</h1></header>
<section><p>${escape(message)}</p><div class="row"><a class="button" href="">Try again</a><a class="button" href="/">Your tunnel account</a></div></section></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const connectorId = tunnelConnectorId(url.pathname);
  if (!connectorId) return fetch(request);
  // The path must end in a slash for the page's relative URLs to resolve under it.
  if (url.pathname === `/m/${connectorId}`) return Response.redirect(`${url.origin}/m/${connectorId}/${url.search}`, 302);
  try {
    const stream = await connectorStream(connectorId);
    return await tunnelFetch(stream, appPath(url), request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.mode !== 'navigate') return new Response(JSON.stringify({ error: message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    return errorPage(error instanceof RefusedError ? 'Not paired' : 'Cannot reach your computer', message, 502);
  }
}

worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== worker.location.origin || !tunnelConnectorId(url.pathname)) return;
  event.respondWith(serve(event.request));
});
