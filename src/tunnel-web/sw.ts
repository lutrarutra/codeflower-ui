// The tunnel's service worker (scope /m/): serves the app's page under
// /m/{connector}/ by fetching each request from the connector through an
// encrypted stream. The page and its code come from the user's computer, not
// from the tunnel. Its code is kept per computer and build, so a page loads
// again with a single stream, for its index.html.

/// <reference lib="webworker" />

import { pairedComputers } from '../tunnel/computers.ts';
import { appPath, connectorStream, tunnelConnectorId } from '../tunnel/connect.ts';
import { tunnelFetch } from '../tunnel/http.ts';
import { RefusedError } from '../tunnel/stream.ts';

const worker = self as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('install', () => void worker.skipWaiting());
worker.addEventListener('activate', (event) => event.waitUntil(worker.clients.claim()));

const escape = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

/** A page that could not load, with links to the page from the other computers this browser can reach. */
async function errorPage(connectorId: string, title: string, message: string, status: number): Promise<Response> {
  const others = (await pairedComputers(connectorId).catch(() => [])).filter((computer) => computer.id !== connectorId && computer.online && computer.onAccount);
  const links = others
    .map((computer) => `<a class="button" href="/m/${encodeURIComponent(computer.id)}/">Open from ${escape(computer.name || computer.id)}</a>`)
    .join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><link rel="stylesheet" href="/style.css"><link rel="icon" href="/icon.svg"></head>
<body><main><header><img src="/icon.svg" alt=""><h1>${escape(title)}</h1></header>
<section><p>${escape(message)}</p>${others.length ? '<p>Your other computers show the same sandboxes:</p>' : ''}<div class="row">${links}<a class="button" href="">Try again</a><a class="button" href="/">Your tunnel account</a></div></section></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ---- the page's code, kept per computer and build ----

const CACHE = 'cf-page:';
/** The build each computer's page last came from, by connector: the name of its cache. */
const builds = new Map<string, string>();
const buildMeta = /<meta name="codeflower-build" content="([0-9a-f]{8,64})"/;

/** The page's code and styles: kept. Its index.html, the API, reports' frames and anything else: always asked for. */
const kept = (path: string) => path.startsWith('/assets/') || (/^\/[^/]+\.(js|css)$/.test(path) && !path.startsWith('/api/'));

async function buildCache(connectorId: string): Promise<string | undefined> {
  const known = builds.get(connectorId);
  if (known) return known;
  // The worker was stopped since the page loaded: the cache it made says the build.
  const name = (await caches.keys()).find((key) => key.startsWith(`${CACHE}${connectorId}:`));
  if (name) builds.set(connectorId, name);
  return name;
}

/**
 * The page's index.html names its build: the code of another build of that
 * computer goes, before the page asks for any of it.
 */
async function noteBuild(connectorId: string, response: Response): Promise<Response> {
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return response;
  const html = await response.text();
  const build = buildMeta.exec(html)?.[1];
  const name = build ? `${CACHE}${connectorId}:${build}` : undefined;
  for (const key of await caches.keys()) if (key.startsWith(`${CACHE}${connectorId}:`) && key !== name) await caches.delete(key);
  if (name) builds.set(connectorId, name);
  else builds.delete(connectorId);
  return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * `finished` is called when the stream behind the response closes: until then
 * the worker must stay alive, or the browser may stop it mid-body (Firefox
 * does, once the response object is handed back).
 */
async function serve(request: Request, finished: () => void): Promise<Response> {
  const url = new URL(request.url);
  const connectorId = tunnelConnectorId(url.pathname);
  if (!connectorId) {
    finished();
    return fetch(request);
  }
  // The path must end in a slash for the page's relative URLs to resolve under it.
  if (url.pathname === `/m/${connectorId}`) {
    finished();
    return Response.redirect(`${url.origin}/m/${connectorId}/${url.search}`, 302);
  }
  const path = appPath(url);
  const keep = request.method === 'GET' && request.mode !== 'navigate' && kept(url.pathname.slice(`/m/${connectorId}`.length)) && !url.search;
  const cacheName = keep ? await buildCache(connectorId) : undefined;
  if (cacheName) {
    const hit = await (await caches.open(cacheName)).match(request.url);
    if (hit) {
      finished();
      return hit;
    }
  }
  try {
    const stream = await connectorStream(connectorId);
    stream.onClose(finished);
    const response = await tunnelFetch(stream, path, request);
    if (request.mode === 'navigate') return await noteBuild(connectorId, response);
    if (cacheName && response.ok) {
      const copy = response.clone();
      void caches.open(cacheName).then((cache) => cache.put(request.url, copy)).catch(() => undefined);
    }
    return response;
  } catch (error) {
    finished();
    const message = error instanceof Error ? error.message : String(error);
    if (request.mode !== 'navigate') return new Response(JSON.stringify({ error: message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    return errorPage(connectorId, error instanceof RefusedError ? 'Not paired' : 'Cannot reach your computer', message, 502);
  }
}

worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== worker.location.origin || !tunnelConnectorId(url.pathname)) return;
  let finished = () => {};
  event.waitUntil(new Promise<void>((resolve) => (finished = resolve)));
  event.respondWith(serve(event.request, () => finished()));
});
