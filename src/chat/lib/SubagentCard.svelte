<script lang="ts">
  import {
    choiceLabel,
    subagentActive,
    subagentStatus,
    subagentTitle,
    type SubagentFeatures,
    type SubagentSummary
  } from '../../protocol/subagents.ts';
  import { formatCost, formatPercent, formatTokens } from '../../protocol/usage.ts';
  import Elapsed from './Elapsed.svelte';
  import Markdown from './Markdown.svelte';
  import { chatHost } from './host.ts';
  import { epoch } from './time.ts';
  import type { ChatItem } from './transcript.ts';

  // One of the chat's subagents, where it started: what it was asked, how long
  // it runs or ran, and what the agent reports of it (its model, effort and
  // usage, as `features` says). Its own work shows in its chat (Open).
  let {
    item,
    summary,
    features
  }: {
    item: Extract<ChatItem, { kind: 'subagent' }>;
    summary?: SubagentSummary;
    features?: SubagentFeatures;
  } = $props();

  const host = chatHost();

  const state = $derived(summary?.state ?? (item.state as SubagentSummary['state']));
  const stopReason = $derived(summary?.stopReason ?? item.stopReason ?? undefined);
  const active = $derived(subagentActive({ state }));
  const status = $derived(subagentStatus({ state, stopReason, error: summary?.error }));
  const title = $derived(
    subagentTitle({
      title: summary?.title ?? item.title ?? undefined,
      description: summary?.description ?? item.description ?? undefined,
      prompt: summary?.prompt ?? item.prompt ?? undefined
    })
  );
  const description = $derived(summary?.description ?? item.description);
  const prompt = $derived(summary?.prompt ?? item.prompt);
  const result = $derived(item.reply ?? summary?.lastMessage ?? null);
  const started = $derived(epoch(summary?.startedAt) ?? item.started);
  const ended = $derived(active ? null : (epoch(summary?.endedAt) ?? item.ended));

  const reports = $derived(features?.reports);
  const model = $derived(reports?.model !== false ? summary?.model : undefined);
  const effort = $derived(reports?.effort !== false ? summary?.effort : undefined);
  const usage = $derived(summary?.usage);
  const context = $derived(usage?.context && usage.context.size > 0 ? usage.context : undefined);
  const tokens = $derived(usage?.tokens?.totalTokens);
  const hasDetails = $derived(Boolean(model || effort || context || tokens || usage?.cost));
  const canStop = $derived(active && Boolean(summary?.capabilities?.cancel) && Boolean(summary?.key));

  const statusLook: Record<string, string> = {
    running: 'codicon-loading codicon-modifier-spin text-cyan',
    'waiting for you': 'codicon-bell-dot text-orange',
    done: 'codicon-pass-filled text-green',
    stopped: 'codicon-debug-stop text-pink',
    failed: 'codicon-error text-red',
    ended: 'codicon-circle-large-outline text-muted'
  };
</script>

<!-- One row: what it is, what runs it, how long, and its buttons; the task and its latest words below.
     A narrow chat drops the row's details first, then the buttons' labels; the details then show below. -->
{#snippet details()}
  {#if model}
    <span class="inline-flex min-w-0 items-center gap-1" title="Model"><span class="codicon codicon-hubot"></span><span class="truncate">{choiceLabel(model)}</span></span>
  {/if}
  {#if effort}
    <span class="inline-flex items-center gap-1" title="Effort"><span class="codicon codicon-dashboard"></span>{choiceLabel(effort)}</span>
  {/if}
  {#if context}
    <span class="inline-flex items-center gap-1" title="Context: {formatTokens(context.used)} of {formatTokens(context.size)} tokens">
      <span class="codicon codicon-layers"></span>{formatPercent((context.used / context.size) * 100)}
    </span>
  {/if}
  {#if tokens}
    <span class="inline-flex items-center gap-1" title="Tokens"><span class="codicon codicon-symbol-numeric"></span>{formatTokens(tokens)}</span>
  {/if}
  {#if usage?.cost}
    <span title="Cost">{formatCost(usage.cost, false)}</span>
  {/if}
{/snippet}

<details class="group @container rounded-xl border-[1.5px] border-soft-line bg-card" open={active}>
  <summary class="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 select-none">
    <span class="grid size-6 shrink-0 place-items-center rounded-lg border-[1.5px] border-line bg-violet-soft">
      <span class="codicon codicon-organization text-[13px]!"></span>
    </span>
    <span class="flex min-w-0 flex-1 items-baseline gap-2">
      <span class="eyebrow hidden shrink-0 text-violet @sm:inline">Subagent</span>
      <span class="min-w-0 truncate text-[0.92em]" title={title}>{title}</span>
    </span>
    {#if hasDetails}
      <span class="hidden max-w-[45%] shrink items-center gap-x-2.5 text-[0.78em] text-muted @xl:inline-flex">{@render details()}</span>
    {/if}
    <Elapsed {started} {ended} running={active} />
    <span class="inline-flex shrink-0 items-center gap-1 text-[0.78em] text-muted" title={status}>
      <span class="codicon {statusLook[status] ?? statusLook.ended}"></span>
      <span class="hidden @md:inline">{status}</span>
    </span>
    {#if summary?.key}
      <button
        type="button"
        class="chip shrink-0 px-1.5! py-0! text-[0.8em]"
        title="Open its chat"
        aria-label="Open the subagent's chat"
        onclick={(event) => {
          event.preventDefault();
          host.send({ type: 'openSubagent', key: summary!.key });
        }}
      >
        <span class="codicon codicon-link-external text-[12px]!"></span><span class="hidden @lg:inline">Open</span>
      </button>
    {/if}
    {#if canStop}
      <button
        type="button"
        class="chip shrink-0 border-pink! px-1.5! py-0! text-[0.8em] text-pink"
        title="Stop the subagent"
        aria-label="Stop the subagent"
        onclick={(event) => {
          event.preventDefault();
          host.send({ type: 'stopSubagent', key: summary!.key });
        }}
      >
        <span class="codicon codicon-debug-stop text-[12px]!"></span><span class="hidden @lg:inline">Stop</span>
      </button>
    {/if}
    <span class="codicon codicon-chevron-right text-muted transition-transform group-open:rotate-90"></span>
  </summary>
  <div class="flex flex-col gap-1.5 px-2.5 pb-2 pl-[2.6rem] text-[0.9em]">
    {#if hasDetails}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8em] text-muted @xl:hidden">{@render details()}</div>
    {/if}
    {#if prompt && prompt !== description}
      <details class="group/prompt">
        <summary class="flex cursor-pointer list-none items-center gap-1 text-[0.85em] text-muted select-none hover:text-ink">
          <span class="codicon codicon-chevron-right text-[11px]! transition-transform group-open/prompt:rotate-90"></span>
          <span class="truncate">{description ? `Task: ${description}` : 'Task'}</span>
        </summary>
        <div class="mt-1 max-h-48 overflow-auto rounded-lg bg-code px-2.5 py-2 whitespace-pre-wrap">{prompt}</div>
      </details>
    {:else if description}
      <div class="truncate text-[0.85em] text-muted">{description}</div>
    {/if}
    {#if result}
      <div class="border-l-2 border-soft-line pl-2.5">
        <span class="eyebrow text-muted">{active ? 'Latest' : 'Result'}</span>
        <div class="max-h-24 overflow-hidden"><Markdown text={result} openFile={(path) => host.send({ type: 'openFile', path })} /></div>
      </div>
    {/if}
    {#if summary?.error}
      <div class="text-pink">{summary.error}</div>
    {/if}
  </div>
</details>
