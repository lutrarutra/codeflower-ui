<script lang="ts">
  // What a view shows in its place when it failed: the wilted flower, what
  // went wrong and what to do; the actions come as children.
  import type { Snippet } from 'svelte';
  import SadFlower from './SadFlower.svelte';

  let {
    title,
    detail,
    size = 72,
    role = 'alert',
    children
  }: { title: string; detail?: string; size?: number; role?: 'alert' | 'status'; children?: Snippet } = $props();
</script>

<div class="m-auto flex max-w-sm flex-col items-center gap-3 py-8 text-center" {role}>
  <SadFlower {size} />
  <h2 class="m-0 font-display text-xl font-medium text-balance">{title}</h2>
  {#if detail}<p class="m-0 text-muted [overflow-wrap:anywhere]">{detail}</p>{/if}
  {#if children}
    <div class="flex flex-wrap justify-center gap-2 pt-1">{@render children()}</div>
  {/if}
</div>
