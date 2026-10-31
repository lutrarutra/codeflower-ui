<script lang="ts">
  // Brief notes at the top of the page: a chat the user is not looking at finished, or waits for
  // them. A click opens the chat, or brings its tab to the front.
  import { fly } from 'svelte/transition';
  import { app } from './lib/app.svelte.ts';

  const WAITING_FOR = { plan: 'approve a plan', permission: 'allow a tool', question: 'answer a question' } as const;
</script>

{#if app.attention.toasts.length}
  <div class="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-40 flex flex-col items-center gap-1.5 px-3" aria-live="polite">
    {#each app.attention.toasts as toast (toast.id)}
      <div
        class="card pointer-events-auto flex max-w-[min(26rem,100%)] items-center gap-1 py-1 pr-1 pl-3 shadow-(--cf-elevation)"
        transition:fly={{ y: -12, duration: 150 }}
      >
        <button class="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left" title="Open the chat" onclick={() => app.attention.open(toast)}>
          <span class="size-2 shrink-0 rounded-full {toast.need === 'waiting' ? 'bg-orange' : 'bg-indigo'}"></span>
          <span class="min-w-0 truncate text-[0.9em]">
            <span class="font-semibold">{toast.title}</span>
            <span class="text-muted">
              {toast.need === 'waiting' ? `waits for you${toast.waitingFor ? ` to ${WAITING_FOR[toast.waitingFor]}` : ''}` : 'finished'} · {toast.sandbox}
            </span>
          </span>
        </button>
        <button
          class="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-soft-line hover:text-ink pointer-coarse:size-8"
          aria-label="Dismiss"
          onclick={() => app.attention.dismiss(toast.id)}
        >
          <span class="codicon codicon-close text-[12px]!"></span>
        </button>
      </div>
    {/each}
  </div>
{/if}
