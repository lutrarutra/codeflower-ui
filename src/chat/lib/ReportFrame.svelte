<script lang="ts" module>
  /**
   * Where a report runs: in the app's /frame (`app`), a sandboxed iframe without the
   * page's origin (no cookie, no API) that asks for the report once it has loaded; or
   * written into a sandboxed iframe of a VS Code webview (`webview`), under the
   * webview's policy as well as its own.
   */
  export type ReportFrameKind = 'app' | 'webview';
</script>

<script lang="ts">
  // An HTML report with its scripts running: no network, no access to the view.
  import { untrack } from 'svelte';
  import { interactiveHtml, isStorytellerReport, printableHtml, reportMessage, withNonce, type ReportMessage } from './report.ts';

  let {
    html,
    title,
    kind = 'app',
    onMessage
  }: {
    html: string;
    title: string;
    kind?: ReportFrameKind;
    /** What the report asks of its host; reloads, and prints in the app, are done here. */
    onMessage: (message: ReportMessage) => void;
  } = $props();

  let frame: HTMLIFrameElement | undefined = $state();
  /** Bumped to load the frame afresh. */
  let loads = $state(0);
  /** What the frame shows, once loaded. */
  let shown = '';
  /**
   * The page a webview's frame is written with, at each load. The webview's scripts
   * carry its nonce; the report's must too to run.
   */
  const srcdoc = $derived.by(() => {
    void loads;
    if (kind !== 'webview') return '';
    return untrack(() => {
      shown = html;
      const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
      return withNonce(interactiveHtml(html), nonce);
    });
  });
  /**
   * The frame's load events since it was last loaded: /frame, then the report
   * written into it (both browsers fire one for each), or the srcdoc. One more
   * means the report loaded another page into its frame, which the app's policy
   * cannot stop: it may have sent its content along, and must get nothing more.
   */
  let frameLoads = 0;
  let left = $state(false);
  const ownLoads = $derived(kind === 'app' ? 2 : 1);

  function loaded(): void {
    frameLoads++;
    if (frameLoads > ownLoads) left = true;
  }

  function reload(): void {
    frameLoads = 0;
    left = false;
    loads++;
  }

  $effect(() => {
    const receive = (event: MessageEvent) => {
      if (!frame || left || event.source !== frame.contentWindow) return;
      if (kind === 'app' && (event.data as { type?: unknown })?.type === 'cf-frame-ready') {
        shown = html;
        frame.contentWindow?.postMessage({ type: 'cf-load', html: interactiveHtml(html) }, '*');
        return;
      }
      const message = reportMessage(event.data);
      if (message?.type === 'reload') reload();
      else if (message?.type === 'print' && kind === 'app') printCopy();
      else if (message) onMessage(message);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  });

  /**
   * Print, for the report in the app: the frame may not open dialogs, so a hidden copy that
   * may (allow-modals, still without the page's origin) prints itself and is dropped at the
   * next print or when the report closes. Only a click in the report starts one. A webview
   * cannot print at all: its host prints elsewhere.
   */
  let printFrame: HTMLIFrameElement | null = null;
  function printCopy(): void {
    printFrame?.remove();
    const copy = document.createElement('iframe');
    copy.setAttribute('sandbox', 'allow-scripts allow-modals');
    copy.title = `${title} (print)`;
    copy.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0';
    const ready = (event: MessageEvent) => {
      if (event.source !== copy.contentWindow || (event.data as { type?: unknown })?.type !== 'cf-frame-ready') return;
      window.removeEventListener('message', ready);
      copy.contentWindow?.postMessage({ type: 'cf-load', html: printableHtml(shown || html) }, '*');
    };
    window.addEventListener('message', ready);
    copy.src = './frame?print';
    document.body.append(copy);
    printFrame = copy;
  }
  $effect(() => () => printFrame?.remove());

  // A new version: a storyteller report's runtime replaces only the changed
  // sections (keeping scroll position and explorer settings) and asks for a
  // reload when it cannot. Other pages load afresh.
  $effect(() => {
    if (!html || html === shown || !shown || left) return;
    if (isStorytellerReport(html)) {
      shown = html;
      frame?.contentWindow?.postMessage({ type: 'cf-update', html }, '*');
    } else {
      untrack(reload);
    }
  });
</script>

{#if left}
  <div class="flex h-full flex-col items-start gap-3 p-6">
    <p class="m-0 text-red">This report tried to open another page in its place, which can send the report's content to another site. It was stopped.</p>
    <button type="button" class="pill" onclick={reload}>Load the report again</button>
  </div>
{:else if kind === 'app'}
  <iframe
    bind:this={frame}
    src="./frame?load={loads}"
    sandbox="allow-scripts"
    {title}
    onload={loaded}
    class="block h-full w-full border-0 bg-white"
  ></iframe>
{:else if srcdoc}
  {#key loads}
    <iframe bind:this={frame} {srcdoc} sandbox="allow-scripts" {title} onload={loaded} class="block h-full w-full border-0 bg-white"></iframe>
  {/key}
{/if}
