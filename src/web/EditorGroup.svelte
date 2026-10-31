<script lang="ts">
  // One group of the grid: its tab strip, and the body its tabs show over
  // (the workbench places their content there). A tab dragged onto the body's
  // middle moves into the group, onto an edge it splits the group; onto the
  // strip it goes where it was dropped.
  import type { Grid } from './lib/grid.ts';
  import type { Group, Side } from './lib/layout.svelte.ts';
  import ChatTitle from '../chat/lib/ChatTitle.svelte';
  import { endDrag, splitTab, startDrag } from './lib/workbench.svelte.ts';

  let { group, grid }: { group: Group; grid: Grid } = $props();
  const workbench = $derived(grid.workbench);
  const layout = $derived(workbench.layout);
  /** In a narrow window the one group lists every tab. */
  const tabs = $derived(grid.narrow ? layout.tabs() : group.tabs);
  const focused = $derived(layout.focused === group.id);
  const target = $derived(grid.target());
  let body: HTMLElement | undefined = $state();
  let strip: HTMLElement | undefined = $state();

  $effect(() => {
    const id = group.id;
    grid.measure(id, body ?? null);
    return () => grid.measure(id, null);
  });

  // The tab in front scrolls into the strip's view, e.g. a file the agent showed.
  $effect(() => {
    const tab = group.active;
    void tabs.length;
    queueMicrotask(() => strip?.querySelector(`[data-tab="${CSS.escape(tab ?? '')}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  });

  /** The body's middle is the group itself; its outer quarters are its sides. */
  function sideAt(event: DragEvent): Side | undefined {
    const box = body!.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    const edges: [Side, number][] = [
      ['left', x],
      ['right', 1 - x],
      ['top', y],
      ['bottom', 1 - y]
    ];
    const [side, distance] = edges.sort((a, b) => a[1] - b[1])[0]!;
    return distance < 0.25 ? side : undefined;
  }

  function over(event: DragEvent, place: () => { side?: Side; index?: number }): void {
    if (!grid.accepts()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    grid.dragOver({ group: group.id, ...place() });
  }

  function dropped(event: DragEvent): void {
    if (!grid.accepts()) return;
    event.preventDefault();
    event.stopPropagation();
    grid.drop();
  }

  /** Before or after the tab, by which half the pointer is over. */
  function indexAt(event: DragEvent, index: number): number {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientX < box.left + box.width / 2 ? index : index + 1;
  }
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col" aria-label="Tab group">
  <div
    bind:this={strip}
    role="tablist"
    tabindex="-1"
    class="flex min-h-[2.15rem] shrink-0 items-stretch gap-0.5 overflow-x-auto border-b-[1.5px] border-soft-line bg-sunken px-1.5 pt-1.5"
    ondragover={(event) => over(event, () => ({ index: group.tabs.length }))}
    ondrop={dropped}
  >
    {#each tabs as tab, index (tab)}
      {@const label = grid.label(tab)}
      {@const active = tab === group.active}
      {@const insertHere = target?.group === group.id && !target.side && target.index === index}
      <div
        data-tab={tab}
        role="presentation"
        draggable={grid.narrow ? 'false' : 'true'}
        class="group relative flex max-w-56 shrink-0 items-center rounded-t-lg border-[1.5px] border-b-0 {active
          ? 'border-soft-line bg-paper'
          : 'border-transparent text-muted hover:bg-paper/60'}"
        ondragstart={(event) => {
          const { workerId, local } = splitTab(tab);
          startDrag(event, workerId, local, label.label);
        }}
        ondragend={endDrag}
        ondragover={(event) => over(event, () => ({ index: indexAt(event, index) }))}
        onauxclick={(event) => event.button === 1 && workbench.close(tab)}
      >
        {#if insertHere}<span class="absolute inset-y-1 -left-[2px] w-[2px] rounded bg-indigo"></span>{/if}
        {#if active && focused}<span class="absolute inset-x-2 top-0 h-[2px] rounded-b bg-indigo"></span>{/if}
        <button
          role="tab"
          aria-selected={active}
          class="flex min-w-0 items-center gap-1.5 py-1 pr-1 pl-2.5 text-left pointer-coarse:py-1.5"
          title={label.title}
          onclick={() => workbench.activate(tab)}
        >
          {#if label.status}
            <span
              class="size-2 shrink-0 rounded-full {label.status === 'working' ? 'animate-pulse bg-cyan' : label.status === 'done' ? 'bg-green' : 'bg-orange'}"
            ></span>
          {:else}
            <span class="codicon codicon-{label.icon} shrink-0 text-[13px]!"></span>
          {/if}
          {#if label.chat}
            <span class="flex max-w-44 min-w-0"><ChatTitle title={label.label} /></span>
          {:else}
            <span class="truncate">{label.label}</span>
          {/if}
        </button>
        <button
          class="mr-1 grid size-5 shrink-0 place-items-center rounded opacity-60 group-hover:opacity-100 hover:bg-soft-line pointer-coarse:size-7 pointer-coarse:opacity-100"
          aria-label="Close {label.label}"
          title="Close (middle click)"
          onclick={() => workbench.close(tab)}
        >
          <span class="codicon codicon-close text-[12px]!"></span>
        </button>
      </div>
    {/each}
    {#if target?.group === group.id && !target.side && target.index === tabs.length && tabs.length}
      <span class="my-1 w-[2px] shrink-0 rounded bg-indigo"></span>
    {/if}
  </div>
  <!-- The tabs' content lies over this; while a tab is dragged it lets the pointer through to here. -->
  <div
    bind:this={body}
    role="presentation"
    class="relative min-h-0 flex-1 bg-paper"
    ondragover={(event) => over(event, () => ({ side: sideAt(event) }))}
    ondrop={dropped}
  >
    {#if !layout.tabs().length}
      {@render grid.empty()}
    {/if}
  </div>
</section>
