<script lang="ts">
  // What a sandbox's agent does: chats working, chats waiting for the user,
  // and whether a window is connected.
  import type { Worker } from './api.ts';
  import { plural, WAITING_FOR } from './format.ts';

  let { worker, compact = false }: { worker: Worker; compact?: boolean } = $props();
  const activity = $derived(worker.status === 'ready' ? worker.activity : undefined);
  const reasons = $derived([
    ...new Set((activity?.chats ?? []).filter((chat) => chat.state === 'waiting').map((chat) => WAITING_FOR[chat.waitingFor ?? ''] ?? 'you'))
  ]);
  const title = $derived(
    (activity?.chats ?? [])
      .map((chat) => `${chat.title}: ${chat.state === 'waiting' ? `waiting for ${WAITING_FOR[chat.waitingFor ?? ''] ?? 'you'}` : 'working'}`)
      .join('\n')
  );
</script>

{#if activity}
  <span class="flex flex-wrap items-center gap-1.5" {title}>
    {#if activity.working}
      <span class="chip cursor-default border-cyan text-ink">{compact ? `${activity.working} working` : `${plural(activity.working, 'chat')} working`}</span>
    {/if}
    {#if activity.waiting}
      <span class="chip cursor-default border-orange bg-yellow-soft"
        >{compact ? `${activity.waiting} need${activity.waiting === 1 ? 's' : ''} you` : `${plural(activity.waiting, 'chat')} waiting for ${reasons.length === 1 ? reasons[0] : 'you'}`}</span
      >
    {/if}
    {#if !compact && !activity.working && !activity.waiting}
      <span class="chip cursor-default text-muted">No chats running</span>
    {/if}
    {#if !compact && !activity.connected}
      <span class="chip cursor-default text-muted">No window connected</span>
    {:else if !compact && (activity.clients ?? 0) > 1}
      <span class="chip cursor-default text-muted">{plural(activity.clients ?? 0, 'window')} connected</span>
    {/if}
  </span>
{/if}
