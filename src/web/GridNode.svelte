<script lang="ts">
  // A node of the grid: a group, or a split of nodes side by side or one above
  // the other, with a divider between each two to drag (double-click shares
  // their space half and half).
  import EditorGroup from './EditorGroup.svelte';
  import GridNode from './GridNode.svelte';
  import type { Grid } from './lib/grid.ts';
  import { MIN_SIZE, type LayoutNode } from './lib/layout.svelte.ts';

  let { node, grid }: { node: LayoutNode; grid: Grid } = $props();
  let box: HTMLElement | undefined = $state();
  /** The divider being dragged: the pointer and the two shares where the drag began. */
  let drag: { index: number; from: number; sizes: number[]; length: number } | null = null;

  const row = $derived(node.kind === 'split' && node.direction === 'row');

  /** Moves the divider before child `index` by `delta` percent of the split. */
  function shift(index: number, sizes: number[], delta: number): void {
    if (node.kind !== 'split') return;
    const pair = sizes[index - 1]! + sizes[index]!;
    const before = Math.min(Math.max(sizes[index - 1]! + delta, MIN_SIZE), pair - MIN_SIZE);
    const next = [...sizes];
    next[index - 1] = before;
    next[index] = pair - before;
    grid.workbench.layout.resize(node.id, next);
  }

  function start(event: PointerEvent, index: number): void {
    if (node.kind !== 'split' || !box) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const rect = box.getBoundingClientRect();
    drag = { index, from: row ? event.clientX : event.clientY, sizes: [...node.sizes], length: row ? rect.width : rect.height };
    grid.setResizing(true);
  }

  function move(event: PointerEvent): void {
    if (!drag) return;
    shift(drag.index, drag.sizes, (((row ? event.clientX : event.clientY) - drag.from) / drag.length) * 100);
  }

  function end(): void {
    if (!drag) return;
    drag = null;
    grid.setResizing(false);
  }
</script>

{#if node.kind === 'group'}
  <EditorGroup group={node} {grid} />
{:else}
  {@const split = node}
  <div bind:this={box} class="flex h-full w-full min-h-0 min-w-0 {row ? 'flex-row' : 'flex-col'}">
    {#each split.children as child, index (child.id)}
      {#if index > 0}
        <!-- A focusable separator is a widget: it moves with the arrow keys too. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          role="separator"
          aria-orientation={row ? 'vertical' : 'horizontal'}
          aria-valuenow={Math.round(split.sizes[index - 1]!)}
          tabindex="0"
          title="Drag to resize; double-click to share the space evenly"
          class="group relative shrink-0 {row ? 'w-[5px] cursor-col-resize' : 'h-[5px] cursor-row-resize'}"
          onpointerdown={(event) => start(event, index)}
          onpointermove={move}
          onpointerup={end}
          onpointercancel={end}
          ondblclick={() => shift(index, split.sizes, (split.sizes[index]! - split.sizes[index - 1]!) / 2)}
          onkeydown={(event) => {
            const keys = row ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
            if (keys.includes(event.key)) shift(index, split.sizes, event.key === keys[0] ? -2 : 2);
          }}
        >
          <span
            class="absolute bg-soft-line transition-colors group-hover:bg-indigo group-focus-visible:bg-indigo {row
              ? 'inset-y-0 left-[2px] w-[1.5px]'
              : 'inset-x-0 top-[2px] h-[1.5px]'}"
          ></span>
        </div>
      {/if}
      <div class="relative min-h-0 min-w-0" style="flex: {split.sizes[index]} 1 0px">
        <GridNode node={child} {grid} />
      </div>
    {/each}
  </div>
{/if}
