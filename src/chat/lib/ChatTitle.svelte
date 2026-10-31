<script lang="ts">
  // A chat's title; one that starts with a slash command (/goal …) shows the command as such.
  let { title, fallback = 'Untitled chat' }: { title: string; fallback?: string } = $props();
  const parts = $derived(commandTitle(title));

  /** A title that starts with a slash command (/goal …): the command and the rest. */
  function commandTitle(text: string): [string, string] | null {
    const match = /^(\/[\w:.-]+)(.*)$/s.exec(text.trim());
    return match ? [match[1]!, match[2]!.trim()] : null;
  }
</script>

<span class="min-w-0 flex-1 truncate">
  {#if parts}
    <span class="rounded bg-indigo-soft px-1 font-mono text-[0.92em] text-indigo">{parts[0]}</span>
    {parts[1]}
  {:else}
    {title || fallback}
  {/if}
</span>
