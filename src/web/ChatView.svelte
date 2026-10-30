<script lang="ts">
  // The chosen sandbox: one of its chats, or an overview with its chats.
  import { untrack } from 'svelte';
  import App from '../chat/App.svelte';
  import Tulip from '../chat/lib/Tulip.svelte';
  import ActivityChips from './lib/ActivityChips.svelte';
  import ConnectLine from './lib/ConnectLine.svelte';
  import StatusDot from './lib/StatusDot.svelte';
  import UsageChips from './lib/UsageChips.svelte';
  import PreviewPane from './PreviewPane.svelte';
  import { app } from './lib/app.svelte.ts';
  import { plural, SOURCE_TITLE, statusText, workerTitle } from './lib/format.ts';

  let { onAdd }: { onAdd: () => void } = $props();
  const worker = $derived(app.worker(app.route.worker));
  const agent = $derived(worker ? app.agent(worker.id) : undefined);
  const chat = $derived(agent && app.route.session ? agent.chats[app.route.session] : undefined);
  /** Sandboxes the user chose to open here although another window had them. */
  let takeOver = $state<Record<string, boolean>>({});
  // Connecting takes the sandbox over from a window that has it (VS Code, another tab): ask first.
  const elsewhere = $derived(
    !!worker && !!agent && agent.state !== 'connected' && !!worker.activity?.connected && worker.relays === 0 && !takeOver[worker.id]
  );
  const wrapUp = $derived(worker ? app.wrapUps[worker.id] : undefined);
  const files = $derived(worker ? app.previews.tabs(worker.id).length : 0);
  const filesShown = $derived(!!worker && files > 0 && !app.previews.hidden[worker.id]);

  $effect(() => {
    const session = app.route.session;
    if (!agent || !session || elsewhere || worker?.status !== 'ready') return;
    untrack(() => void agent.open(session));
  });

  async function openHere(): Promise<void> {
    if (!worker || !agent) return;
    takeOver[worker.id] = true;
    if (agent.state === 'taken-over') await agent.takeBack().catch(() => undefined);
  }
</script>

{#if worker && agent}
  {@const [name, where] = workerTitle(worker)}
  <div class="flex h-full flex-col">
    {#if agent.state === 'taken-over' || (elsewhere && app.route.session)}
      <section class="flex flex-wrap items-center gap-3 border-b-[1.5px] border-orange bg-yellow-soft px-4 py-2.5" role="status">
        <span class="min-w-0 flex-1">
          {agent.state === 'taken-over'
            ? 'Another window took this sandbox over: VS Code, or another tab. It keeps working there.'
            : 'This sandbox is open in another window, e.g. VS Code. Opening the chat here moves the sandbox to this page; the other window can take it back.'}
        </span>
        <button class="pill pill-small pill-primary" onclick={openHere}>Open here</button>
      </section>
    {:else if agent.connected && agent.status?.signedIn === false}
      <section class="flex flex-wrap items-center gap-3 border-b-[1.5px] border-orange bg-yellow-soft px-4 py-2.5" role="status">
        <span class="min-w-0 flex-1">{agent.status.agentLabel} is not signed in for this project, so it cannot answer yet.</span>
        <button class="pill pill-small pill-primary" onclick={() => void app.signIn.start(agent)}>Sign in</button>
      </section>
    {:else if agent.state === 'connecting' && !chat}
      <p class="m-0 px-4 py-2.5 text-muted"><span class="spinner"></span> Connecting to the sandbox…</p>
    {:else if agent.state === 'disconnected' && agent.error}
      <p class="m-0 border-b-[1.5px] border-soft-line px-4 py-2.5 text-red">Could not reach the sandbox: {agent.error}. Trying again…</p>
    {/if}
    {#if wrapUp}
      <p class="m-0 border-b-[1.5px] border-orange bg-yellow-soft px-4 py-2.5">
        {wrapUp.reason === 'quit'
          ? `The app that started this sandbox is quitting; ${plural(wrapUp.chats, 'working chat was', 'working chats were')} asked to save their work.`
          : `The job ends in about ${wrapUp.minutes} minutes; ${plural(wrapUp.chats, 'working chat was', 'working chats were')} asked to save their work.`}
      </p>
    {/if}
    <div class="relative flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        {#if files && !filesShown}
          <button
            class="chip absolute top-[4.25rem] right-4 z-10 bg-card shadow-sm"
            title="Show the files beside the chat"
            onclick={() => app.previews.activate(worker.id, app.previews.active[worker.id] ?? app.previews.tabs(worker.id)[0]!)}
          >
            <span class="codicon codicon-layout-sidebar-right"></span> {plural(files, 'tab')}
          </button>
        {/if}
        {#if chat}
          <div class="min-h-0 flex-1">
            {#key chat}
              <App host={chat.host} />
            {/key}
          </div>
        {:else if !app.route.session}
          <main class="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-auto px-4 py-6">
            <header class="flex items-start gap-3">
              <span class="pt-2"><StatusDot {worker} /></span>
              <div class="min-w-0 flex-1">
                <h1 class="m-0 font-display text-2xl font-medium">{name}</h1>
                <p class="m-0 text-muted" title={SOURCE_TITLE[worker.source]}>{where} · {statusText(worker)}</p>
                <div class="mt-2 flex flex-wrap gap-1.5"><ActivityChips {worker} /><UsageChips {worker} /></div>
              </div>
            </header>
            {#if worker.kind === 'task'}
              <p class="m-0 text-muted">This sandbox runs a task by itself and has no chat; its terminal shows its progress.</p>
            {:else if worker.status === 'ready'}
              <section class="card flex flex-col gap-2 p-4">
                <h2 class="m-0 font-display text-lg font-medium">Chats</h2>
                {#if agent.sessions.length}
                  <ul class="m-0 flex list-none flex-col gap-1 p-0">
                    {#each agent.sessions as session (session.key)}
                      <li>
                        <button
                          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-soft-line"
                          onclick={() => app.go({ view: 'chat', worker: worker.id, session: session.key })}
                        >
                          <span class="codicon codicon-comment text-muted"></span>
                          <span class="min-w-0 flex-1 truncate">{session.title || 'Untitled chat'}</span>
                          <span class="text-[0.8em] text-muted">{new Date(session.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="m-0 text-muted">No chats yet. Start one with <em>New chat</em> in the sidebar.</p>
                {/if}
              </section>
              {#if !elsewhere}
                <section class="card flex flex-wrap items-center gap-3 p-4">
                  <div class="min-w-0 flex-1">
                    <h2 class="m-0 font-display text-lg font-medium">Agent sign-in</h2>
                    <p class="m-0 text-muted">The agent's login or keys stay in this sandbox's project. Sign in again to switch accounts.</p>
                  </div>
                  <button class="pill pill-small" onclick={() => void app.signIn.start(agent)}>Sign in…</button>
                </section>
              {/if}
            {:else if worker.error}
              <p class="m-0 text-red">{worker.error}</p>
            {/if}
            {#if worker.url}
              <details class="card p-4">
                <summary class="cursor-pointer font-semibold">Open in VS Code instead</summary>
                <div class="pt-3"><ConnectLine url={worker.url} /></div>
              </details>
            {/if}
          </main>
        {/if}
      </div>
      {#if filesShown}
        <div class="absolute inset-0 z-20 min-[1100px]:static min-[1100px]:w-1/2 min-[1100px]:shrink-0 min-[1100px]:border-l-[1.5px] min-[1100px]:border-soft-line">
          <PreviewPane workerId={worker.id} />
        </div>
      {/if}
    </div>
  </div>
{:else}
  <main class="grid h-full place-items-center p-8 text-center">
    <div class="flex max-w-md flex-col items-center gap-3">
      <Tulip size={56} />
      <h1 class="m-0 font-display text-2xl font-medium">{app.workers.length ? 'Choose a sandbox' : 'No sandbox yet'}</h1>
      <p class="m-0 text-muted">
        {app.workers.length ? 'Pick one in the sidebar to see its chats.' : 'Start one on this computer, or add one running elsewhere, for example in a batch job.'}
      </p>
      <div class="flex flex-wrap justify-center gap-2">
        {#if !app.system?.capabilities.connectOnly}
          <button class="pill pill-primary" onclick={() => app.go({ view: 'server' })}>Start a sandbox</button>
        {/if}
        <button class="pill" onclick={onAdd}>Add remote sandbox</button>
      </div>
    </div>
  </main>
{/if}
