<script lang="ts">
  // An HTML report with its scripts running, in the app's /frame: a sandboxed
  // iframe without the page's origin (no cookie, no API), whose policy keeps it
  // off the network. The frame asks for the report once it has loaded.
  import { untrack } from 'svelte';
  import { interactiveHtml, isStorytellerReport, printableHtml, reportMessage, type ReportMessage } from './lib/report.ts';

  let { html, title, onMessage }: { html: string; title: string; onMessage: (message: ReportMessage) => void } = $props();

  let frame: HTMLIFrameElement | undefined = $state();
  /** Bumped to load the frame afresh. */
  let loads = $state(0);
  /** What the frame shows, once loaded. */
  let shown = '';
  /**
   * The frame's load events since it was last loaded: /frame, then the report
   * written into it (both browsers fire one for each). One more means the
   * report loaded another page into its frame, which the policy cannot stop:
   * it may have sent its content along, and must get nothing more.
   */
  let frameLoads = 0;
  let left = $state(false);
  const OWN_LOADS = 2;

  function loaded(): void {
    frameLoads++;
    if (frameLoads > OWN_LOADS) left = true;
  }

  function reload(): void {
    frameLoads = 0;
    left = false;
    loads++;
  }

  $effect(() => {
    const receive = (event: MessageEvent) => {
      if (!frame || left || event.source !== frame.contentWindow) return;
      if ((event.data as { type?: unknown })?.type === 'cf-frame-ready') {
        shown = html;
        frame.contentWindow?.postMessage({ type: 'cf-load', html: interactiveHtml(html) }, '*');
        return;
      }
      const message = reportMessage(event.data);
      if (message?.type === 'reload') reload();
      else if (message?.type === 'print') printCopy();
      else if (message) onMessage(message);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  });

  /**
   * Print, for the report: the frame may not open dialogs, so a hidden copy that may
   * (allow-modals, still without the page's origin) prints itself and is dropped at the
   * next print or when the report closes. Only a click in the report starts one.
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
    <p class="m-0 text-red">This report opened another page in its place, which can send the report's content to another site. It was stopped.</p>
    <button type="button" class="pill" onclick={reload}>Load the report again</button>
  </div>
{:else}
  <iframe
    bind:this={frame}
    src="./frame?load={loads}"
    sandbox="allow-scripts"
    {title}
    onload={loaded}
    class="block h-full w-full border-0 bg-white"
  ></iframe>
{/if}
