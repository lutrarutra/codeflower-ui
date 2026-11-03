<script lang="ts">
  // What a view shows in its place while its sandbox or computer cannot be
  // reached; `retrying` says the page keeps trying by itself.
  import type { Snippet } from 'svelte';
  import ErrorState from './ErrorState.svelte';

  let {
    title = 'Cannot reach the sandbox',
    detail,
    retrying = false,
    size = 72,
    children
  }: { title?: string; detail?: string; retrying?: boolean; size?: number; children?: Snippet } = $props();
</script>

{#snippet actions()}
  {#if retrying}
    <span class="flex items-center gap-1.5 text-[0.9em] text-muted">
      <span class="codicon codicon-loading codicon-modifier-spin"></span> Trying again…
    </span>
  {/if}
  {@render children?.()}
{/snippet}

<ErrorState {title} {detail} {size} role="status" children={retrying || children ? actions : undefined} />
