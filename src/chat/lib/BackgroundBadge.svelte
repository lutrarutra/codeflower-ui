<script lang="ts">
  import type { BackgroundWork } from '../../protocol/commands.ts';

  // In the footer: how many background tasks other than commands the agent
  // runs (commands have their own badge, CommandsBadge), and a list of them.
  let { work }: { work: BackgroundWork[] } = $props();

  const label = $derived(`${work.length} background task${work.length === 1 ? '' : 's'} running`);

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }}
/>

{#if work.length}
  <div class="flex items-center" bind:this={root}>
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-full border-none bg-transparent px-1 py-0 leading-none text-inherit hover:text-ink"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onclick={() => (open = !open)}
      onkeydown={(event) => event.key === 'Escape' && (open = false)}
    >
      <span class="codicon codicon-sync"></span>
      {work.length}
    </button>
    {#if open}
      <div
        role="dialog"
        aria-label="Running in the background"
        tabindex="-1"
        class="card absolute bottom-full right-0 z-20 mb-2 flex max-h-96 w-80 max-w-[calc(100vw-2rem)] flex-col gap-0.5 overflow-y-auto p-1.5 text-[1.25em] text-ink"
        onkeydown={(event) => event.key === 'Escape' && (open = false)}
      >
        <div class="eyebrow px-2 pt-1 pb-1 text-violet">Running in the background</div>
        {#each work as item (item.id)}
          <div class="flex items-center gap-2 px-2 py-1.5" title={item.detail ?? item.name}>
            <span class="codicon codicon-loading codicon-modifier-spin shrink-0 text-[12px]! text-cyan"></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[0.9em]">{item.name}</span>
              <span class="block truncate text-[0.75em] text-muted">{item.kind}</span>
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
