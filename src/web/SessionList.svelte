<script lang="ts">
  // The chosen sandbox's chats, under it in the sidebar.
  import { untrack } from 'svelte';
  import type { Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import Skeleton from '../chat/lib/Skeleton.svelte';
  import ChatTitle from './lib/ChatTitle.svelte';
  import { ago } from './lib/format.ts';
  import { FILES } from './lib/previews.svelte.ts';
  import { chatTab, endDrag, startDrag } from './lib/workbench.svelte.ts';

  let { worker, onNavigate }: { worker: Worker; onNavigate: () => void } = $props();
  const agent = $derived(app.agent(worker.id));
  let creating = $state(false);
  let error = $state('');

  // The list comes from the app without connecting; once connected, from the agent. An older
  // sandbox lists its chats only to a connection: connect, unless another window has it (connecting
  // would take it over).
  $effect(() => {
    const current = agent;
    void worker.activity?.chats.length;
    const ready = worker.status === 'ready';
    const elsewhere = !!worker.activity?.connected && !worker.activity.multiClient && worker.relays === 0;
    untrack(async () => {
      if (await current.listSessions()) return;
      if (ready && !elsewhere && current.state === 'idle') await current.connect().catch(() => undefined);
      // Not listed and not connecting: show what is known rather than loading forever.
      if (!current.connected) current.sessionsKnown = true;
    });
  });

  const DOT: Record<string, string> = { working: 'bg-cyan', waiting: 'bg-orange', ready: 'bg-green', offline: 'bg-muted' };

  /** The chat whose menu is open (right click), and where. */
  let menu = $state<{ key: string; title: string; x: number; y: number } | null>(null);

  async function rename(key: string, title: string): Promise<void> {
    const next = prompt('Rename the chat', title)?.trim();
    if (!next || next === title) return;
    error = '';
    try {
      await agent.rename(key, next);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
  }

  async function remove(key: string, title: string): Promise<void> {
    if (!confirm(`Delete the chat "${title || 'Untitled chat'}"? The agent's own session files stay in the project.`)) return;
    error = '';
    try {
      await agent.delete(key);
      app.workbench(worker.id).remove(chatTab(key));
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
  }

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
      title="Browse the folders in the sandbox beside the chat; or drag it into the grid"
      draggable="true"
      ondragstart={(event) => startDrag(event, worker.id, FILES, 'Files')}
      ondragend={endDrag}
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
  {#if !agent.sessionsKnown}
    <li class="px-2 py-1.5"><Skeleton lines={['80%', '65%']} height="0.7rem" /></li>
  {/if}
  {#each agent.sessions as session (session.key)}
    {@const chat = agent.chats[session.key]}
    {@const busy = worker.activity?.chats.find((candidate) => candidate.key === session.key)}
    {@const status = chat?.status ?? (busy ? busy.state : undefined)}
    {@const current = app.route.session === session.key}
    <li>
      <button
        class="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[0.9em] {current ? 'bg-card font-semibold' : 'hover:bg-card'}"
        aria-current={current ? 'page' : undefined}
        title="{session.title}: drag it into the grid to open it there"
        draggable="true"
        ondragstart={(event) => startDrag(event, worker.id, chatTab(session.key), session.title || 'Untitled chat')}
        ondragend={endDrag}
        onclick={() => {
          app.go({ view: 'chat', worker: worker.id, session: session.key });
          onNavigate();
        }}
        oncontextmenu={(event) => {
          event.preventDefault();
          menu = { key: session.key, title: session.title, x: event.clientX, y: event.clientY };
        }}
      >
        <span class="size-2 shrink-0 rounded-full {status ? DOT[status] : 'bg-transparent'}" class:animate-pulse={status === 'working'}></span>
        <ChatTitle title={session.title} />
        {#if session.updatedAt}
          <span class="shrink-0 text-[0.8em] font-normal text-muted" title={new Date(session.updatedAt).toLocaleString()}>{ago(Date.parse(session.updatedAt))}</span>
        {/if}
      </button>
    </li>
  {/each}
</ul>

<svelte:window
  onkeydown={(event) => event.key === 'Escape' && (menu = null)}
  onblur={() => (menu = null)}
  onresize={() => (menu = null)}
/>

{#if menu}
  <!-- Closes the menu on a click anywhere else. -->
  <button
    class="fixed inset-0 z-40 cursor-default"
    aria-label="Close the menu"
    onclick={() => (menu = null)}
    oncontextmenu={(event) => (event.preventDefault(), (menu = null))}
  ></button>
  <div
    role="menu"
    aria-label="Chat"
    class="card fixed z-50 flex w-44 flex-col p-1 text-[0.9em]"
    style="left: {Math.min(menu.x, innerWidth - 184)}px; top: {Math.min(menu.y, innerHeight - 96)}px"
  >
    <button
      role="menuitem"
      class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-soft-line"
      onclick={() => {
        const { key, title } = menu!;
        menu = null;
        void rename(key, title);
      }}
    >
      <span class="codicon codicon-edit"></span>Rename…
    </button>
    <button
      role="menuitem"
      class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-red hover:bg-soft-line"
      onclick={() => {
        const { key, title } = menu!;
        menu = null;
        void remove(key, title);
      }}
    >
      <span class="codicon codicon-trash"></span>Delete
    </button>
  </div>
{/if}
