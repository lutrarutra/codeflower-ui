<script lang="ts">
  import { sandboxFiles } from './sandboxFiles.svelte.ts';

  // An image from the sandbox in the chat: a small version, fetched once it
  // nears the screen. Its height is fixed, so loading never moves the text.
  let { path, key, height, alt }: { path: string; key: string; height: number; alt: string } = $props();
  const files = sandboxFiles();
  let element: HTMLElement | undefined = $state();
  let near = $state(false);
  $effect(() => {
    if (!element || near) return;
    const seen = new IntersectionObserver(([sighting]) => {
      if (sighting?.isIntersecting) near = true;
    }, { rootMargin: '600px 0px' });
    seen.observe(element);
    return () => seen.disconnect();
  });
  // Twice the height it is shown at, for sharp high-density screens.
  const url = $derived(near ? files.url(path, key, height * 2) : undefined);
</script>

<span bind:this={element} class="grid min-w-24 place-items-center" style:height="{height}px">
  {#if url}
    <img class="block max-h-full max-w-full" src={url} {alt} />
  {:else if url === null}
    <!-- Too large, a format the worker cannot read, or gone: the full image may still open. -->
    <span class="flex flex-col items-center gap-1 px-3 text-center text-[0.8em] text-muted">
      <span class="codicon codicon-file-media"></span>
      No thumbnail · open full size
    </span>
  {:else}
    <span class="skeleton h-full w-32 rounded-none!" role="status" aria-label="Loading {alt}"></span>
  {/if}
</span>
