<script lang="ts">
  // An HTML report with its scripts running, in the app's /frame: a sandboxed
  // iframe without the page's origin (no cookie, no API), whose policy keeps it
  // off the network. The frame asks for the report once it has loaded.
  import { untrack } from 'svelte';
  import { interactiveHtml, isStorytellerReport, reportMessage, type ReportMessage } from './lib/report.ts';

  let { html, title, onMessage }: { html: string; title: string; onMessage: (message: ReportMessage) => void } = $props();

  let frame: HTMLIFrameElement | undefined = $state();
  /** Bumped to load the frame afresh. */
  let loads = $state(0);
  /** What the frame shows, once loaded. */
  let shown = '';

  $effect(() => {
    const receive = (event: MessageEvent) => {
      if (!frame || event.source !== frame.contentWindow) return;
      if ((event.data as { type?: unknown })?.type === 'cf-frame-ready') {
        shown = html;
        frame.contentWindow?.postMessage({ type: 'cf-load', html: interactiveHtml(html) }, '*');
        return;
      }
      const message = reportMessage(event.data);
      if (message?.type === 'reload') loads++;
      else if (message) onMessage(message);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  });

  // A new version: a storyteller report's runtime replaces only the changed
  // sections (keeping scroll position and explorer settings) and asks for a
  // reload when it cannot. Other pages load afresh.
  $effect(() => {
    if (!html || html === shown || !shown) return;
    if (isStorytellerReport(html)) {
      shown = html;
      frame?.contentWindow?.postMessage({ type: 'cf-update', html }, '*');
    } else {
      untrack(() => loads++);
    }
  });
</script>

<iframe
  bind:this={frame}
  src="/frame?load={loads}"
  sandbox="allow-scripts"
  {title}
  class="block h-full w-full border-0 bg-white"
></iframe>
