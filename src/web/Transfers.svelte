<script lang="ts">
  // A sandbox's transfers, under its file tree: what is being sent or saved,
  // how far it is, and why one failed.
  import { formatSize } from '../chat/lib/files.ts';
  import { transfers, type Transfer } from './lib/transfers.svelte.ts';

  let { workerId }: { workerId: string } = $props();
  const items = $derived(transfers.of(workerId));
  const finished = $derived(items.some((item) => item.state !== 'running'));

  // Redraws the speeds while something runs.
  let now = $state(Date.now());
  $effect(() => {
    if (!items.some((item) => item.state === 'running')) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  function detail(item: Transfer): string {
    if (item.state === 'failed') return item.error ?? 'Failed';
    if (item.state === 'cancelled') return 'Cancelled';
    const size = item.total ? `${formatSize(item.done)} of ${formatSize(item.total)}` : formatSize(item.done);
    if (item.state === 'done') return `${item.direction === 'up' ? 'Sent' : 'Saved'} · ${formatSize(item.total || item.done)}`;
    const seconds = (now - item.startedAt) / 1000;
    return seconds >= 1 && item.done ? `${size} · ${formatSize(item.done / seconds)}/s` : size;
  }
</script>

{#if items.length}
  <section class="flex max-h-[40%] flex-col border-t-[1.5px] border-soft-line font-sans text-[0.85em]" aria-label="Transfers">
    <header class="flex items-center gap-2 pt-1.5 pr-2 pl-4">
      <span class="eyebrow flex-1 text-muted">Transfers</span>
      {#if finished}
        <button class="rounded-md px-1.5 text-muted hover:bg-card hover:text-ink" onclick={() => transfers.clear(workerId)}>Clear</button>
      {/if}
    </header>
    <ul class="m-0 min-h-0 list-none overflow-auto px-3 pb-2">
      {#each items as item (item.id)}
        <li class="flex flex-col gap-1 py-1.5" title="{item.direction === 'up' ? 'To' : 'From'} {item.where}{item.current ? `\n${item.current}` : ''}">
          <div class="flex items-center gap-1.5">
            <span class="codicon codicon-{item.direction === 'up' ? 'cloud-upload' : 'cloud-download'} shrink-0 text-[13px]! text-muted"></span>
            <span class="min-w-0 flex-1 truncate">{item.label}</span>
            {#if item.state === 'running'}
              <button
                class="grid size-5 shrink-0 place-items-center rounded-md text-muted hover:bg-card hover:text-ink pointer-coarse:size-8"
                title="Cancel"
                aria-label="Cancel {item.label}"
                onclick={() => transfers.cancel(item.id)}
              >
                <span class="codicon codicon-close text-[12px]!"></span>
              </button>
            {:else}
              <span
                class="codicon codicon-{item.state === 'done' ? 'check' : item.state === 'failed' ? 'error' : 'circle-slash'} shrink-0 text-[12px]!"
                class:text-red={item.state === 'failed'}
                class:text-muted={item.state !== 'failed'}
              ></span>
            {/if}
          </div>
          {#if item.state === 'running'}
            <progress class="h-1 w-full accent-indigo" max={item.total || 1} value={item.total ? item.done : undefined}></progress>
          {/if}
          <span class="truncate text-[0.9em] {item.state === 'failed' ? 'text-red' : 'text-muted'}">
            {item.state === 'running' && item.direction === 'up' && item.current && item.current !== item.label ? `${item.current} · ` : ''}{detail(item)}
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}
