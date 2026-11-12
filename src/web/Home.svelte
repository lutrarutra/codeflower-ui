<script lang="ts">
  // What the page opens on when sandboxes run but none is chosen and no tab is open, e.g. a
  // browser that never had the page before: the chats that need the user, then each sandbox
  // with its latest chats, so a sandbox that is connected never looks like nothing is there.
  import { tunnelConnectorId } from '../tunnel/connect.ts';
  import AgentIcon from '../chat/lib/AgentIcon.svelte';
  import ChatTitle from '../chat/lib/ChatTitle.svelte';
  import Skeleton from '../chat/lib/Skeleton.svelte';
  import Tulip from '../chat/lib/Tulip.svelte';
  import { agentPresentation } from '../protocol/messages.ts';
  import ActivityChips from './lib/ActivityChips.svelte';
  import type { Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import { chatty } from './lib/focus.svelte.ts';
  import { ago, plural, statusText, WAITING_FOR, workerTitle } from './lib/format.ts';
  import { inRail } from './lib/rail.ts';
  import StatusDot from './lib/StatusDot.svelte';

  /** How many of a sandbox's chats its card lists, the latest first. */
  const LATEST = 4;
  /** How often the sandboxes' lists of chats are read while the page shows this. */
  const SESSIONS_MS = 10_000;

  const workers = $derived(app.workers.filter((worker) => inRail(worker, app.machine(worker.id), app.browsing)));
  const connectOnly = $derived(app.system?.capabilities.connectOnly ?? false);
  const remote = tunnelConnectorId() !== undefined;
  /** Chats that wait for an answer, or finished while the user looked elsewhere. */
  const needs = $derived(app.focus.groups.filter((group) => group.id === 'waiting' || group.id === 'done').flatMap((group) => group.chats));

  // The chats are read without connecting, so another window keeps its sandbox.
  $effect(() => {
    const list = () => {
      for (const worker of app.workers)
        if (chatty(worker) && worker.status === 'ready' && app.reachable(worker.id)) void app.agent(worker.id).listSessions();
    };
    list();
    const timer = setInterval(list, SESSIONS_MS);
    return () => clearInterval(timer);
  });

  function latest(worker: Worker) {
    return [...app.agent(worker.id).sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, LATEST);
  }

  function where(worker: Worker): string {
    const place = workerTitle(worker)[1];
    if (worker.source === 'added') return place;
    return app.several ? [place, `on ${app.machine(worker.id).name}`].filter(Boolean).join(' ') : place;
  }

  const openChat = (workerId: string, session: string) => app.go({ view: 'chat', worker: workerId, session });
</script>

<main class="mx-auto flex h-full w-full max-w-4xl flex-col gap-5 overflow-auto px-4 py-6">
  <header class="flex flex-wrap items-center gap-3">
    <Tulip size={40} />
    <div class="min-w-0 flex-1">
      <h1 class="m-0 font-display text-2xl font-medium">{workers.length === 1 ? 'Your sandbox' : `Your ${workers.length} sandboxes`}</h1>
      <p class="m-0 text-muted">Open a chat to continue it, or a sandbox to see all its chats and start a new one.</p>
    </div>
    {#if !app.single}
      <button class="pill pill-small shrink-0" onclick={() => (app.creating = { tab: connectOnly && !remote ? 'connect' : 'start' })}
        ><span class="codicon codicon-add"></span>New sandbox</button
      >
    {/if}
  </header>

  {#if needs.length}
    <section class="card flex flex-col gap-1 border-orange p-4" aria-labelledby="home-needs">
      <h2 id="home-needs" class="m-0 mb-1 font-display text-lg font-medium">Needs you</h2>
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        {#each needs as chat (chat.workerId + chat.key)}
          <li>
            <button class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-soft-line" onclick={() => openChat(chat.workerId, chat.key)}>
              <span class="size-2 shrink-0 rounded-full {chat.phase === 'waiting' ? 'bg-orange' : 'bg-indigo'}"></span>
              <ChatTitle title={chat.title} />
              <span class="min-w-0 truncate text-[0.8em] text-muted">{chat.sandbox}</span>
              <span class="ml-auto shrink-0 text-[0.8em] {chat.phase === 'waiting' ? 'text-orange' : 'text-muted'}">
                {chat.phase === 'waiting' ? `waiting for ${WAITING_FOR[chat.waitingFor ?? ''] ?? 'you'}` : 'finished'}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <ul class="m-0 grid list-none grid-cols-1 gap-4 p-0 {workers.length > 1 ? 'min-[900px]:grid-cols-2' : ''}">
    {#each workers as worker (worker.id)}
      {@const agent = app.agent(worker.id)}
      {@const [name] = workerTitle(worker)}
      {@const count = app.attention.count(worker.id)}
      <li class="card flex min-w-0 flex-col gap-3 p-4">
        <header class="flex items-start gap-3">
          <span class="pt-2"><StatusDot {worker} /></span>
          <div class="min-w-0 flex-1">
            <h2 class="m-0 truncate font-display text-lg font-medium">{name}</h2>
            <p class="m-0 truncate text-[0.9em] text-muted">{[where(worker), statusText(worker)].filter(Boolean).join(' · ')}</p>
          </div>
          <button class="pill pill-small pill-primary shrink-0" onclick={() => app.browse(worker.id)}>
            Open{#if count}<span class="ml-1 rounded-full bg-on-accent/25 px-1.5 text-[0.85em]">{count}</span>{/if}
          </button>
        </header>
        <ActivityChips {worker} />
        {#if worker.kind === 'task'}
          <p class="m-0 text-muted">Runs a task by itself; its terminal shows its progress.</p>
        {:else if worker.status !== 'ready'}
          <p class="m-0 text-muted">{worker.error || 'Its chats show once it is ready.'}</p>
        {:else if !agent.sessionsKnown}
          <Skeleton lines={['70%', '55%']} class="py-1" />
        {:else if agent.sessions.length}
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            {#each latest(worker) as session (session.key)}
              <li>
                <button class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-soft-line" onclick={() => openChat(worker.id, session.key)}>
                  <AgentIcon agent={agentPresentation(session.harness, agent.agent(session.harness))} size="1em" title={agent.agent(session.harness)?.name ?? session.harness} />
                  <ChatTitle title={session.title} />
                  <span class="ml-auto shrink-0 text-[0.8em] text-muted" title={new Date(session.updatedAt).toLocaleString()}>{ago(Date.parse(session.updatedAt))}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if agent.sessions.length > LATEST}
            <button class="link self-start text-[0.9em]" onclick={() => app.browse(worker.id)}>All {plural(agent.sessions.length, 'chat')}</button>
          {/if}
        {:else}
          <p class="m-0 text-muted">No chats yet. Open the sandbox to start one.</p>
        {/if}
      </li>
    {/each}
  </ul>
</main>
