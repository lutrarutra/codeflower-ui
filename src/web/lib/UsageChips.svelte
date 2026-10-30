<script lang="ts">
  // The agent's subscription quota, or the tokens and cost of a key, as the sandbox's bridge reports them.
  import type { Worker } from './api.ts';
  import { cost, resets, tokens } from './format.ts';

  let { worker }: { worker: Worker } = $props();
  const SHORT: Record<string, string> = { five_hour: '5h', seven_day: 'week' };
  const usage = $derived(worker.status === 'ready' ? worker.activity?.usage : undefined);
  // A window that already reset says nothing about the current one.
  const limits = $derived(
    usage && usage.auth.kind !== 'api_key'
      ? usage.limits.filter((limit) => limit.usedPercent !== null && (!limit.resetsAt || Date.parse(limit.resetsAt) > Date.now()))
      : []
  );
  const total = $derived(usage?.totals.tokens);
</script>

{#if limits.length || total?.totalTokens}
  <span class="flex flex-wrap items-center gap-1.5">
    {#each limits as limit (limit.id)}
      {@const percent = Math.round(limit.usedPercent ?? 0)}
      {@const low = limit.status === 'rejected' || limit.status === 'allowed_warning' || percent >= 80}
      {@const reset = limit.resetsAt ? resets(limit.resetsAt) : ''}
      <span class="chip cursor-default" title="{limit.label}: {percent}% used{reset ? `, resets ${reset}` : ''}">
        {SHORT[limit.id] ?? limit.label}
        <span class="relative inline-block h-1.5 w-10 overflow-hidden rounded-full bg-soft-line">
          <span class="absolute inset-y-0 left-0 {low ? 'bg-red' : 'bg-teal'}" style:width="{Math.min(percent, 100)}%"></span>
        </span>
        {percent}%
      </span>
    {/each}
    {#if usage && total?.totalTokens}
      <span
        class="chip cursor-default"
        title="Since the sandbox started{usage.costEstimate && usage.totals.cost ? "; the cost is the agent's estimate at API prices" : ''}"
      >
        {[
          `${tokens(total.inputTokens + total.cachedReadTokens + total.cachedWriteTokens)} in`,
          `${tokens(total.outputTokens)} out`,
          usage.totals.cost ? cost(usage.totals.cost, usage.costEstimate) : null
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    {/if}
  </span>
{/if}
