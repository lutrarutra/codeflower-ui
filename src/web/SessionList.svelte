<script lang="ts">
  // The chosen sandbox's chats, under it in the sidebar.
  import { untrack } from 'svelte';
  import type { Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';

  let { worker, onNavigate }: { worker: Worker; onNavigate: () => void } = $props();
  const agent = $derived(app.agent(worker.id));
  let creating = $state(false);
  let error = $state('');

  // The list comes from the app without connecting; once connected, from the agent.
  $effect(() => {
    const current = agent;
    void worker.activity?.chats.length;
    untrack(() => void current.listSessions());
  });

  const DOT: Record<string, string> = { working: 'bg-cyan', waiting: 'bg-orange', ready: 'bg-green', offline: 'bg-muted' };

  async function newChat(): Promise<void> {
    creating = true;
    error = '';
    try {
      const key = await agent.newChat();
      if (key) app.go({ view: 'chat', worker: worker.id, session: key });
      onNavigate();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      creating = false;
    }
  }
</script>

<ul class="m-0 mb-2 ml-4 list-none border-l-[1.5px] border-soft-line py-1 pl-2">
  <li>
    <button class="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[0.9em] font-semibold text-indigo hover:bg-card" disabled={creating} onclick={newChat}>
      <span class="codicon codicon-add"></span>{creating ? 'Starting…' : 'New chat'}
    </button>
  </li>
  <li>
    <button
      class="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[0.9em] hover:bg-card"
      title="Browse the folders in the sandbox beside the chat"
      onclick={() => {
        app.go({ view: 'chat', worker: worker.id, ...(app.route.worker === worker.id && app.route.session ? { session: app.route.session } : {}) });
        app.previews.browse(worker.id);
        onNavigate();
      }}
    >
      <span class="codicon codicon-list-tree"></span>Files
    </button>
  </li>
  {#if error}<li class="px-2 py-1 text-[0.85em] text-red">{error}</li>{/if}
  {#each agent.sessions as session (session.key)}
    {@const chat = agent.chats[session.key]}
    {@const busy = worker.activity?.chats.find((candidate) => candidate.key === session.key)}
    {@const status = chat?.status ?? (busy ? busy.state : undefined)}
    {@const current = app.route.session === session.key}
    <li>
      <button
        class="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[0.9em] {current ? 'bg-card font-semibold' : 'hover:bg-card'}"
        aria-current={current ? 'page' : undefined}
        title={session.title}
        onclick={() => {
          app.go({ view: 'chat', worker: worker.id, session: session.key });
          onNavigate();
        }}
      >
        <span class="size-2 shrink-0 rounded-full {status ? DOT[status] : 'bg-transparent'}" class:animate-pulse={status === 'working'}></span>
        <span class="min-w-0 flex-1 truncate">{session.title || 'Untitled chat'}</span>
      </button>
    </li>
  {/each}
</ul>
