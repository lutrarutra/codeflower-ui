<script lang="ts">
  // A chat's title in lists; one that starts with a slash command (/goal …) shows the command as such.
  import { commandTitle } from './format.ts';

  let { title }: { title: string } = $props();
  const parts = $derived(commandTitle(title));
</script>

<span class="min-w-0 flex-1 truncate">
  {#if parts}
    <span class="rounded bg-indigo-soft px-1 font-mono text-[0.92em] text-indigo">{parts[0]}</span>
    {parts[1]}
  {:else}
    {title || 'Untitled chat'}
  {/if}
</span>
