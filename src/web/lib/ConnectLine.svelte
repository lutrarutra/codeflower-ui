<script lang="ts">
  // The sandbox's line, for VS Code: shown with its token hidden; Copy and Open use all of it.
  import { copyText, vscodeLink } from './api.ts';

  let { url }: { url: string } = $props();
  let copied = $state(false);

  async function copy(): Promise<void> {
    await copyText(url);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="flex flex-wrap items-center gap-2">
  <code class="min-w-0 flex-1 truncate rounded-lg bg-code px-2 py-1 font-mono text-[0.85em]">{url.replace(/token=[^&\s]+/, 'token=••••••••')}</code>
  <button type="button" class="pill pill-small" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
  <a class="pill pill-small pill-teal no-underline" href={vscodeLink(url)}>Open in VS Code</a>
</div>
<p class="m-0 mt-1 text-[0.85em] text-muted">Anyone with this line can control the agent; keep it to yourself.</p>
