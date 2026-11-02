<script lang="ts">
  import { choiceLabel, sortSubagents, subagentActive, subagentStatus, subagentTitle, type SubagentSummary } from '../../protocol/subagents.ts';
  import Elapsed from './Elapsed.svelte';
  import { chatHost } from './host.ts';
  import { epoch } from './time.ts';

  // Beside the usage: how many of the chat's subagents run, and a list of
  // those and the latest ended ones, each opening its own chat.
  const RECENT = 10;

  let { subagents }: { subagents: SubagentSummary[] } = $props();
  const host = chatHost();

  const running = $derived(subagents.filter(subagentActive));
  const waiting = $derived(running.some((subagent) => subagent.state === 'requires_action'));
  const shown = $derived.by(() => {
    const sorted = sortSubagents(subagents);
    return [...sorted.filter(subagentActive), ...sorted.filter((subagent) => !subagentActive(subagent)).slice(0, RECENT)];
  });
  const hidden = $derived(subagents.length - shown.length);

  let open = $state(false);
  let root: HTMLElement | undefined = $state();

  const dot: Record<string, string> = {
    running: 'bg-[#1ec8f0] animate-pulse',
    'waiting for you': 'bg-[#ff9f1c]',
    done: 'bg-[#3fbf57]',
    stopped: 'bg-pink',
    failed: 'bg-red',
    ended: 'bg-muted'
  };
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }}
/>

{#if subagents.length}
  <div class="relative" bind:this={root}>
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-full border-none bg-transparent px-1 py-0 text-inherit hover:text-ink {running.length
        ? waiting
          ? 'font-semibold text-orange'
          : 'font-semibold text-cyan'
        : ''}"
      aria-haspopup="dialog"
      aria-expanded={open}
      title={running.length ? `${running.length} subagent${running.length === 1 ? '' : 's'} running` : 'Subagents of this chat'}
      onclick={() => (open = !open)}
      onkeydown={(event) => event.key === 'Escape' && (open = false)}
    >
      <span class="codicon codicon-organization"></span>
      {#if running.length}
        {running.length} running
      {:else}
        {subagents.length} subagent{subagents.length === 1 ? '' : 's'}
      {/if}
    </button>
    {#if open}
      <div
        role="dialog"
        aria-label="Subagents"
        tabindex="-1"
        class="card absolute bottom-full left-0 z-20 mb-2 flex max-h-96 w-80 flex-col gap-0.5 overflow-y-auto p-1.5 text-[1.25em] text-ink"
        onkeydown={(event) => event.key === 'Escape' && (open = false)}
      >
        <div class="eyebrow px-2 pt-1 pb-1 text-violet">Subagents</div>
        {#each shown as subagent (subagent.key)}
          {@const status = subagentStatus(subagent)}
          {@const active = subagentActive(subagent)}
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg border-none bg-transparent px-2 py-1.5 text-left hover:bg-code"
            title="Open its chat"
            onclick={() => {
              open = false;
              host.send({ type: 'openSubagent', key: subagent.key });
            }}
          >
            <span class="size-2 shrink-0 rounded-full {dot[status] ?? dot.ended}" title={status}></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[0.9em]">{subagentTitle(subagent)}</span>
              <span class="block truncate text-[0.75em] text-muted">
                {[status, subagent.model && choiceLabel(subagent.model)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <Elapsed started={epoch(subagent.startedAt)} ended={active ? null : epoch(subagent.endedAt)} running={active} />
          </button>
        {/each}
        {#if hidden > 0}
          <div class="px-2 py-1 text-[0.75em] text-muted">and {hidden} earlier, in the chat above</div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
