// HTML reports with their scripts running, beside the static preview in a file's tab
// (ReportFrame.svelte). A report runs in a sandboxed frame with no network and no
// access to the view; all it can do is tell the view six things, through the bridge below:
// - "send": settings from a report control, or the user's comments for the agent,
//   which go to the preview's feedback box for the user to read and send;
// - "comments": the comments the user left on the report (JSON), to save into it;
// - "reload": the view could not apply an update in place and wants a fresh load;
// - "print": the user pressed Print, which the frame may not do (no allow-modals);
// - "download": the user pressed a button for a file beside the report (a deck's
//   .pptx), named relative to it: the host saves it;
// - "figure": the user clicked a figure, which the view opens over the whole
//   tab, to look at full size and comment on its parts.
import type { FeedbackFigure } from '../../protocol/messages.ts';
import { feedbackFigure } from './feedback.ts';
import { encodeText } from './files.ts';

const STORYTELLER = /<meta name="generator" content="storyteller /;

/** Pages made by storyteller, whose runtime takes comments and in-place updates. */
export function isStorytellerReport(html: string): boolean {
  return STORYTELLER.test(html);
}

/** Content-Security-Policy for an untrusted, self-contained page; the app's /frame sends it too. */
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
  | { type: 'download'; path: string }
  /** The figure's image is base64. */
  | { type: 'figure'; figure: FeedbackFigure; mimeType: string; data: string };

// Defined before the report's own scripts run, so its runtime finds the host.
const BRIDGE = `<script>(() => {
  const post = (message) => parent.postMessage(message, '*');
  const text = (value) => String(value).slice(0, 20000);
  window.cfHost = Object.freeze({
    send: (value) => post({ type: 'send', text: text(value) }),
    reload: () => post({ type: 'reload' }),
    print: () => post({ type: 'print' }),
    download: (path) => typeof path === 'string' && post({ type: 'download', path }),
    figure: (figure) => figure && typeof figure === 'object' && post({ type: 'figure', src: String(figure.src), index: figure.index, caption: figure.caption, part: figure.part, anchor: figure.anchor }),
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

/**
 * The page with `nonce` on each of its scripts. A frame written into a VS Code webview
 * (srcdoc) keeps the webview's policy too, whose scripts need its nonce; scripts they
 * add run by 'strict-dynamic'. Inline event handler attributes do not run.
 */
export function withNonce(html: string, nonce: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const script of document.scripts) script.setAttribute('nonce', nonce);
  return `<!doctype html>${document.documentElement.outerHTML}`;
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

/** Images a figure may be: a raster or SVG, as a data URL. */
const FIGURE_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml))((?:;[^;,]*)*?)(;base64)?,(.*)$/s;
/** The largest figure a report may hand over, as a data URL. */
export const MAX_FIGURE_URL = 30_000_000;

/** A figure's image from its data URL: base64, or null when it is not an image. */
function figureImage(src: string): { mimeType: string; data: string } | null {
  if (src.length > MAX_FIGURE_URL) return null;
  const match = FIGURE_IMAGE.exec(src);
  if (!match) return null;
  try {
    const data = match[3] ? match[4]!.replace(/\s/g, '') : encodeText(decodeURIComponent(match[4]!));
    if (match[3]) atob(data);
    return { mimeType: match[1]!, data };
  } catch {
    return null;
  }
}

const FIGURE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
};

/** The name a report's figure is saved under: "results-figure-2.svg" for figure 2 of results.html. */
export function figureFileName(reportPath: string, index: number, mimeType: string): string {
  const name = reportPath.split(/[/\\]/).pop() ?? '';
  const stem = name.replace(/\.[^.]*$/, '').replace(/[^\w@+-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150) || 'report';
  return `${stem}-figure-${index}.${FIGURE_EXTENSIONS[mimeType] ?? 'img'}`;
}

/** A file beside the report that it may ask the host to save: a plain name. */
export function isBesideReport(path: string): boolean {
  return BESIDE.test(path);
}

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
  if (message.type === 'figure' && typeof message.src === 'string') {
    const image = figureImage(message.src);
    const figure = feedbackFigure(message);
    if (image && figure) return { type: 'figure', ...image, figure };
  }
  return undefined;
}
