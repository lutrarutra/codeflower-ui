<script lang="ts">
  import {
    formatCost,
    formatPercent,
    formatReset,
    formatTokens,
    limitIsCurrent,
    limitIsLow,
    limitLine,
    shortLimitLabel,
    totalsLines,
    type ChatUsage
  } from '../../protocol/usage.ts';
  import type { AgentCommand, BackgroundWork } from '../../protocol/commands.ts';
  import type { SubagentSummary } from '../../protocol/subagents.ts';
  import BackgroundBadge from './BackgroundBadge.svelte';
  import CommandsBadge from './CommandsBadge.svelte';
  import SubagentBadge from './SubagentBadge.svelte';

  // Under the composer, mostly icons with the details on hover: what runs in
  // the background (the agent's commands, its other tasks), the chat's subagents, how full the context is, what this
  // chat used, and how much of the worker's subscription quota is left.
  let {
    usage,
    subagents = [],
    commands = [],
    background = []
  }: { usage: ChatUsage; subagents?: SubagentSummary[]; commands?: AgentCommand[]; background?: BackgroundWork[] } = $props();

  // Resets count down; a minute is fine enough.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const session = $derived(usage.session);
  const account = $derived(usage.account);
  const estimate = $derived(account?.costEstimate ?? false);
  const context = $derived(session?.context && session.context.size > 0 ? session.context : undefined);
  const contextPercent = $derived(context ? (context.used / context.size) * 100 : 0);
  const limits = $derived(
    account?.auth.kind === 'api_key' ? [] : (account?.limits ?? []).filter((limit) => limitIsCurrent(limit, now))
  );
  const tokens = $derived(session?.tokens);
</script>

{#if commands.length || background.length || subagents.length || context || tokens?.totalTokens || limits.length}
  <div class="usage mx-4 -mt-2.5 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[0.78em] text-muted">
    <CommandsBadge {commands} />
    <BackgroundBadge work={background} />
    <SubagentBadge {subagents} />
    {#if context}
      <span
        class="inline-flex items-center gap-1 {contextPercent >= 80 ? 'font-semibold text-orange' : ''}"
        title="Context: {formatTokens(context.used)} of {formatTokens(context.size)} tokens"
      >
        <span class="codicon codicon-layers"></span>
        {formatPercent(contextPercent)}
      </span>
    {/if}
    {#if tokens?.totalTokens}
      <span class="inline-flex items-center gap-1" title={totalsLines(session!, estimate).join('\n')}>
        <span class="codicon codicon-arrow-up text-[10px]!" aria-label="in"></span>{formatTokens(tokens.inputTokens + tokens.cachedReadTokens + tokens.cachedWriteTokens)}
        <span class="codicon codicon-arrow-down ml-1 text-[10px]!" aria-label="out"></span>{formatTokens(tokens.outputTokens)}
        {#if session?.cost}<span class="ml-1">{formatCost(session.cost, estimate)}</span>{/if}
      </span>
    {/if}
    {#each limits as limit (limit.id)}
      {@const low = limitIsLow(limit)}
      <span
        class="inline-flex items-center gap-1.5 {low ? 'font-semibold text-orange' : ''}"
        title="{account?.auth.label ?? 'Subscription'}: {limitLine(limit, now)}"
      >
        {shortLimitLabel(limit)}
        <span class="meter"><span class="fill {low ? 'bg-orange' : 'bg-teal'}" style:width="{Math.min(limit.usedPercent ?? 0, 100)}%"></span></span>
        {formatPercent(limit.usedPercent ?? 0)}
        {#if low && limit.resetsAt}<span class="font-normal text-muted">resets {formatReset(limit.resetsAt, now)}</span>{/if}
      </span>
    {/each}
  </div>
{/if}

<style>
  /* Centered boxes do not line up their contents: a line of text carries room
     for descenders, so its digits ride above the codicons beside them. Trimmed
     to cap height, each item's text centers like its icons and meters. */
  .usage :global(.inline-flex) {
    text-box: trim-both cap alphabetic;
  }

  .meter {
    display: inline-block;
    width: 2.6rem;
    height: 0.4rem;
    border-radius: 999px;
    background: var(--cf-soft-line);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 999px;
  }
</style>
