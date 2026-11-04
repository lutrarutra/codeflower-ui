<script lang="ts">
  import { tunnelConnectorId } from '../tunnel/connect.ts';
  // A sandbox at a glance: its chats, the agent's sign-in, and how to reach it from VS Code.
  // A tab of its own, and what an empty grid shows.
  import ErrorState from '../chat/lib/ErrorState.svelte';
  import OfflineState from '../chat/lib/OfflineState.svelte';
  import SandboxDialog from './SandboxDialog.svelte';
  import Skeleton from '../chat/lib/Skeleton.svelte';
  import ActivityChips from './lib/ActivityChips.svelte';
  import AgentSetup from './lib/AgentSetup.svelte';
  import AgentIcon from '../chat/lib/AgentIcon.svelte';
  import { agentPresentation } from '../protocol/messages.ts';
  import type { Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import ChatTitle from '../chat/lib/ChatTitle.svelte';
  import ConnectLine from './lib/ConnectLine.svelte';
  import { ago, SOURCE_TITLE, statusText, workerTitle } from './lib/format.ts';
  import StatusDot from './lib/StatusDot.svelte';
  import { chatTab, endDrag, startDrag } from './lib/workbench.svelte.ts';
  import type { WebWorker } from './lib/worker.svelte.ts';

  let { worker, agent, elsewhere }: { worker: Worker; agent: WebWorker; elsewhere: boolean } = $props();
  const [name, where] = $derived(workerTitle(worker));
  // The sandbox while its name, address or place in the list is being changed.
  let managing: Worker | null = $state(null);
</script>

<main class="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-auto px-4 py-6">
  <header class="flex items-start gap-3">
    <span class="pt-2"><StatusDot {worker} /></span>
    <div class="min-w-0 flex-1">
      <h1 class="m-0 font-display text-2xl font-medium">{name}</h1>
      <p class="m-0 text-muted" title={SOURCE_TITLE[worker.source]}>{where} · {statusText(worker)}</p>
      <div class="mt-2 flex flex-wrap gap-1.5"><ActivityChips {worker} /></div>
    </div>
    {#if !app.single}
      <button class="pill pill-small shrink-0" title="Rename, change its address or token, or remove it" onclick={() => (managing = worker)}
        ><span class="codicon codicon-edit"></span>Edit</button
      >
    {/if}
  </header>
  {#if worker.kind === 'task'}
    <p class="m-0 text-muted">This sandbox runs a task by itself and has no chat; its terminal shows its progress.</p>
  {:else if worker.status === 'ready'}
    <section class="card flex flex-col gap-2 p-4">
      <h2 class="m-0 font-display text-lg font-medium">Chats</h2>
      {#if !agent.sessionsKnown}
        <Skeleton lines={['75%', '60%', '68%']} class="py-1" />
      {:else if agent.sessions.length}
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          {#each agent.sessions as session (session.key)}
            <li>
              <button
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-soft-line"
                draggable="true"
                ondragstart={(event) => startDrag(event, worker.id, chatTab(session.key), session.title || 'Untitled chat')}
                ondragend={endDrag}
                onclick={() => app.go({ view: 'chat', worker: worker.id, session: session.key })}
              >
                <AgentIcon agent={agentPresentation(session.harness, agent.agent(session.harness))} size="1em" title={agent.agent(session.harness)?.name ?? session.harness} />
                <ChatTitle title={session.title} />
                <span class="text-[0.8em] text-muted" title={new Date(session.updatedAt).toLocaleString()}>{ago(Date.parse(session.updatedAt))}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="m-0 text-muted">No chats yet. Start one with <em>New chat</em> in the sidebar.</p>
      {/if}
    </section>
    {#if !elsewhere}
      <AgentSetup {worker} {agent} boxed />
    {/if}
  {:else if worker.status === 'unreachable'}
    <OfflineState title="This sandbox is not answering" detail={worker.error} />
  {:else if worker.error}
    <ErrorState title={worker.status === 'failed' ? 'This sandbox failed' : 'Something went wrong'} detail={worker.error} />
  {/if}
  {#if worker.url && tunnelConnectorId() === undefined}
    <details class="card p-4">
      <summary class="cursor-pointer font-semibold">Open in VS Code instead</summary>
      <div class="pt-3"><ConnectLine url={worker.url} /></div>
    </details>
  {/if}
</main>

<SandboxDialog bind:worker={managing} />
