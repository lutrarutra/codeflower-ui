<script lang="ts">
  import { tunnelConnectorId } from '../tunnel/connect.ts';
  // The tabs from the sandboxes (chats, folders, files) in a grid, under what
  // the user should know about the sandbox of the tab in front (another window
  // has it, the agent is not signed in, a wrap-up).
  import Skeleton from '../chat/lib/Skeleton.svelte';
  import Tulip from '../chat/lib/Tulip.svelte';
  import Workbench from './Workbench.svelte';
  import WorkerOverview from './WorkerOverview.svelte';
  import { app } from './lib/app.svelte.ts';
  import { plural } from './lib/format.ts';
  import { inRail } from './lib/rail.ts';

  const empty = $derived(app.workbench.layout.tabs().length === 0);
  // The sandbox of the tab in front, else the one the sidebar lists.
  const worker = $derived(app.worker(app.workbench.focusedWorker() ?? app.browsing ?? app.route.worker));
  const agent = $derived(worker ? app.agent(worker.id) : undefined);
  const elsewhere = $derived(!!worker && app.elsewhere(worker));
  const wrapUp = $derived(worker ? app.wrapUps[worker.id] : undefined);
  const browsed = $derived(app.worker(app.browsing ?? undefined));
  /** Some sandbox is in the rail to choose. */
  const railed = $derived(app.workers.some((worker) => inRail(worker, app.machine(worker.id), app.browsing)));

  async function openHere(): Promise<void> {
    if (worker) await app.openHere(worker);
  }
</script>

{#snippet overview()}
  {#if browsed}
    <WorkerOverview worker={browsed} agent={app.agent(browsed.id)} elsewhere={app.elsewhere(browsed)} />
  {:else}
    {@render choose()}
  {/if}
{/snippet}

{#if app.workers.length && (!empty || browsed)}
  <div class="flex h-full flex-col">
    {#if !worker || !agent}
      <!-- No sandbox to speak of: e.g. the tab in front is from one that went. -->
    {:else if agent.state === 'taken-over' || (elsewhere && app.route.session)}
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
    {:else if agent.state === 'connecting'}
      <p class="m-0 px-4 py-2.5 text-muted"><span class="spinner"></span> Connecting to the sandbox…</p>
    {:else if agent.state === 'disconnected' && agent.error}
      <p class="m-0 border-b-[1.5px] border-soft-line px-4 py-2.5 text-red">Could not reach the sandbox: {agent.error}. Trying again…</p>
    {/if}
    {#if worker && wrapUp}
      <p class="m-0 border-b-[1.5px] border-orange bg-yellow-soft px-4 py-2.5">
        {wrapUp.reason === 'quit'
          ? `The app that started this sandbox is quitting; ${plural(wrapUp.chats, 'working chat was', 'working chats were')} asked to save their work.`
          : `The job ends in about ${wrapUp.minutes} minutes; ${plural(wrapUp.chats, 'working chat was', 'working chats were')} asked to save their work.`}
      </p>
    {/if}
    <div class="min-h-0 flex-1">
      <Workbench empty={overview} />
    </div>
  </div>
{:else if !app.listed}
  <!-- The first list of sandboxes is on its way: its shape, not "No sandbox yet". -->
  <main class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6" role="status" aria-label="Loading">
    <Skeleton lines={['30%', '18%']} height="1.1rem" />
    <div class="card p-4"><Skeleton lines={['20%', '70%', '55%']} /></div>
    <div class="card p-4"><Skeleton lines={['25%', '80%']} /></div>
  </main>
{:else}
  {@render choose()}
{/if}

{#snippet choose()}
  <main class="grid h-full place-items-center p-8 text-center">
    <div class="flex max-w-md flex-col items-center gap-3">
      <Tulip size={56} />
      <h1 class="m-0 font-display text-2xl font-medium">{railed ? 'Choose a sandbox' : app.workers.length ? 'No sandbox running' : 'No sandbox yet'}</h1>
      <p class="m-0 text-muted">
        {railed ? 'Pick one in the rail on the left to see its chats.' : 'Start one on a computer, or connect one running elsewhere, for example in a batch job.'}
      </p>
      <div class="flex flex-wrap justify-center gap-2">
        {#if !app.single && (!app.system?.capabilities.connectOnly || tunnelConnectorId() !== undefined)}
          <button class="pill pill-primary" onclick={() => (app.creating = { tab: 'start' })}>Start a sandbox</button>
        {/if}
        {#if !app.single && tunnelConnectorId() === undefined}
          <button class="pill" onclick={() => (app.creating = { tab: 'connect' })}>Connect one running elsewhere</button>
        {/if}
      </div>
    </div>
  </main>
{/snippet}
