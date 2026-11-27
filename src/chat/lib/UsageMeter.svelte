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
  import type { BatchJob } from '../../protocol/jobs.ts';
  import type { Watch } from '../../protocol/watches.ts';
  import type { SubagentSummary } from '../../protocol/subagents.ts';
  import BackgroundBadge from './BackgroundBadge.svelte';
  import CommandsBadge from './CommandsBadge.svelte';
  import JobsBadge from './JobsBadge.svelte';
  import SubagentBadge from './SubagentBadge.svelte';
  import WatchesBadge from './WatchesBadge.svelte';
  import OrchestratorBadge from './OrchestratorBadge.svelte';
  import OrchestratorFilesBadge from './OrchestratorFilesBadge.svelte';
  import type { Orchestrator } from '../../protocol/orchestrators.ts';

  // Under the composer, mostly icons with the details on hover: how full the
  // context is, what this chat used, how much of the worker's subscription
  // quota is left and, at the right, what runs in the background (the agent's
  // commands, its other tasks, its batch jobs, its watches) and the chat's subagents.
  let {
    usage,
    subagents = [],
    commands = [],
    background = [],
    jobs = [],
    watches = [],
    orchestrators = [],
    orchestrator
  }: {
    usage: ChatUsage;
    subagents?: SubagentSummary[];
    commands?: AgentCommand[];
    background?: BackgroundWork[];
    jobs?: BatchJob[];
    watches?: Watch[];
    /** The orchestrators directing this chat. */
    orchestrators?: Orchestrator[];
    /** This chat, if it is an orchestrator: what has been shared with it. */
    orchestrator?: Orchestrator;
  } = $props();

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

<!-- Always there and always one line, whatever it shows and however narrow,
     so that the composer above does not move as badges come and go: what does
     not fit is cut off, after the narrow layout (below) has dropped details. -->
<div class="usage relative mx-4 -mt-2.5 mb-2 flex h-4 items-center gap-x-3 px-1 text-[0.78em] text-muted">
  <span class="readings flex min-w-0 items-center gap-x-3 overflow-hidden">
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
      <span class="inline-flex items-center gap-1 {session?.cost ? '' : 'detail'}" title={totalsLines(session!, estimate).join('\n')}>
        <span class="detail mr-1 inline-flex items-center gap-1">
          <span class="codicon codicon-arrow-up text-[10px]!" aria-label="in"></span>{formatTokens(tokens.inputTokens + tokens.cachedReadTokens + tokens.cachedWriteTokens)}
          <span class="codicon codicon-arrow-down ml-1 text-[10px]!" aria-label="out"></span>{formatTokens(tokens.outputTokens)}
        </span>
        {#if session?.cost}<span>{formatCost(session.cost, estimate)}</span>{/if}
      </span>
    {/if}
    {#each limits as limit (limit.id)}
      {@const low = limitIsLow(limit)}
      <span
        class="inline-flex items-center gap-1.5 {low ? 'font-semibold text-orange' : ''}"
        title="{account?.auth.label ?? 'Subscription'}: {limitLine(limit, now)}"
      >
        {shortLimitLabel(limit)}
        <span class="meter detail"><span class="fill {low ? 'bg-orange' : 'bg-teal'}" style:width="{Math.min(limit.usedPercent ?? 0, 100)}%"></span></span>
        {formatPercent(limit.usedPercent ?? 0)}
        {#if low && limit.resetsAt}<span class="detail font-normal text-muted">resets {formatReset(limit.resetsAt, now)}</span>{/if}
      </span>
    {/each}
  </span>
  <!-- What runs comes and goes, so it goes last, at the right: the readings
       stay where they are, and the subagents, which stay once there, too.
       Their lists open from the line's right end, not from the badge, so that
       they fit on a phone. -->
  <span class="ml-auto flex shrink-0 items-center gap-x-3">
    <CommandsBadge {commands} />
    <BackgroundBadge work={background} />
    <JobsBadge {jobs} />
    <WatchesBadge {watches} />
    <SubagentBadge {subagents} />
    <OrchestratorBadge {orchestrators} />
    {#if orchestrator && !orchestrator.disconnected}<OrchestratorFilesBadge files={orchestrator.files ?? []} />{/if}
  </span>
</div>

<style>
  /* Centered boxes do not line up their contents: a line of text carries room
     for descenders, so its digits ride above the codicons beside them. Trimmed
     to cap height, each item's text centers like its icons and meters. */
  .usage :global(.inline-flex) {
    text-box: trim-both cap alphabetic;
  }

  /* Codicons are 16px, half again the line's text: at that size they tower
     over the numbers and, drawn low in their box as several are, sink below
     them. The arrows set their own, smaller size. */
  .usage :global(.codicon) {
    font-size: 12px;
  }

  /* Each reading whole or not at all: they do not squeeze. */
  .readings > :global(*) {
    flex-shrink: 0;
  }

  /* On a phone, or a narrow side panel, the line keeps the numbers that
     matter: the context, the cost and how much quota is left, as percentages. */
  .usage {
    container-type: inline-size;
  }

  @container (max-width: 440px) {
    .detail {
      display: none !important;
    }
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
