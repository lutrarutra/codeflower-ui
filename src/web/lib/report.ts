// Files from a sandbox as the page shows them: paths, and HTML reports with
// their scripts running. A report runs in the app's /frame, a sandboxed iframe
// with no network and no access to the page; all it can do is tell the page
// five things, through the bridge below:
// - "send": settings from a report control, or the user's comments for the agent,
//   which go to the preview's feedback box for the user to read and send;
// - "comments": the comments the user left on the report (JSON), to save into it;
// - "reload": the page could not apply an update in place and wants a fresh load;
// - "print": the user pressed Print, which the frame may not do (no allow-modals);
// - "download": the user pressed a button for a file beside the report (a deck's
//   .pptx), named relative to it: the page saves it through the browser.
import { WORKSPACE } from '../../client/codeflower.ts';

/** Paths in the workspace read best relative to it, as the agent writes them. */
export function displayPath(path: string): string {
  return path.startsWith(`${WORKSPACE}/`) ? path.slice(WORKSPACE.length + 1) : path;
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/** A path a file refers to (e.g. an image in a report), resolved against the file's folder. */
export function resolvePath(file: string, target: string): string {
  const parts = target.startsWith('/') ? [] : file.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `/${parts.filter(Boolean).join('/')}`;
}

const STORYTELLER = /<meta name="generator" content="storyteller /;

/** Pages made by storyteller, whose runtime takes comments and in-place updates. */
export function isStorytellerReport(html: string): boolean {
  return STORYTELLER.test(html);
}

/** Content-Security-Policy for an untrusted, self-contained page; /frame sends it too. */
export const REPORT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  'worker-src blob:'
].join('; ');

export type ReportMessage =
  | { type: 'send'; text: string }
  | { type: 'comments'; json: string }
  | { type: 'reload' }
  | { type: 'print' }
  | { type: 'download'; path: string };

// Defined before the report's own scripts run, so its runtime finds the host.
const BRIDGE = `<script>(() => {
  const post = (message) => parent.postMessage(message, '*');
  const text = (value) => String(value).slice(0, 20000);
  window.cfHost = Object.freeze({
    send: (value) => post({ type: 'send', text: text(value) }),
    reload: () => post({ type: 'reload' }),
    print: () => post({ type: 'print' }),
    download: (path) => typeof path === 'string' && post({ type: 'download', path }),
    saveComments: (json) => typeof json === 'string' && json.length <= 2000000 && post({ type: 'comments', json })
  });
})();</script>`;

/** The report with the policy and the host bridge at the start of its head. */
export function interactiveHtml(html: string): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">${BRIDGE}`;
  const match = /<head[^>]*>/i.exec(html);
  if (match) return html.slice(0, match.index + match[0].length) + head + html.slice(match.index + match[0].length);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

// Opens the print dialog once the copy has loaded and its fonts are ready.
const PRINT = `<script>addEventListener('load', () => {
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(() => print(), 200));
});</script>`;

/** The report as a copy that prints itself, for a frame that may open the print dialog. */
export function printableHtml(html: string): string {
  const page = interactiveHtml(html);
  const end = page.toLowerCase().lastIndexOf('</body>');
  return end < 0 ? page + PRINT : page.slice(0, end) + PRINT + page.slice(end);
}

/** A file in the report's own folder: a plain name, not a path that leads elsewhere. */
const BESIDE = /^(?!\.)[^/\\]{1,200}$/;

/** A message from a report's bridge, checked: it comes from an untrusted page. */
export function reportMessage(data: unknown): ReportMessage | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const message = data as Record<string, unknown>;
  if (message.type === 'send' && typeof message.text === 'string') return { type: 'send', text: message.text.slice(0, 20000) };
  if (message.type === 'comments' && typeof message.json === 'string' && message.json.length <= 2_000_000)
    return { type: 'comments', json: message.json };
  if (message.type === 'reload') return { type: 'reload' };
  if (message.type === 'print') return { type: 'print' };
  if (message.type === 'download' && typeof message.path === 'string' && BESIDE.test(message.path))
    return { type: 'download', path: message.path };
  return undefined;
}
