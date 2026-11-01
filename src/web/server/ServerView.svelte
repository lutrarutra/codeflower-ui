<script lang="ts">
  // Starting sandboxes on a computer, and the ones that run there. Through the
  // tunnel the page may show several computers: one at a time, chosen on top.
  import Skeleton from '../../chat/lib/Skeleton.svelte';
  import { app } from '../lib/app.svelte.ts';
  import { REACH_TEXT } from '../lib/format.ts';
  import EngineCard from './EngineCard.svelte';
  import ResourcesCard from './ResourcesCard.svelte';
  import SandboxCard from './SandboxCard.svelte';
  import StartForm from './StartForm.svelte';
  import StartLocked from './StartLocked.svelte';
  import Status from './Status.svelte';
  import TunnelCard from './TunnelCard.svelte';

  const machine = $derived(app.serverMachine);
  const here = $derived(machine.workers.filter((worker) => worker.source !== 'added'));
  // Added by their line: they run elsewhere, and only here can they be removed from the list.
  const added = $derived(machine.workers.filter((worker) => worker.source === 'added'));
  const connectOnly = $derived(machine.system?.capabilities.connectOnly ?? false);
  // Through the tunnel (no connecting), the computer's app may not let remote browsers start sandboxes:
  // starting shows locked, with the setting that allows it.
  const locked = $derived(machine.system?.capabilities.connect === false && !machine.system.capabilities.start && connectOnly);
  const reach = $derived(machine.reach);

  function recheck(query?: { engine: string; image: string; imageTag: string }): void {
    void machine.loadSystem(query);
  }
</script>

<main class="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
  {#if app.several}
    <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="Computer">
      {#each app.machines as one (one.key)}
        <button
          role="tab"
          aria-selected={one === machine}
          class="pill pill-small {one === machine ? 'pill-primary' : ''} {one.reach === 'reachable' || one.reach === 'loading' ? '' : 'opacity-60'}"
          title={one === app.head ? 'This page comes from this computer' : REACH_TEXT[one.reach]}
          onclick={() => app.go({ view: 'server', ...(one === app.head ? {} : { machine: one.connectorId }) })}
        >
          <span class="codicon codicon-{one === app.head ? 'home' : 'vm'}"></span>{one.name}
        </button>
      {/each}
    </div>
  {/if}

  <header>
    <h1 class="m-0 font-display text-2xl font-medium">{app.several ? machine.name : 'This computer'}</h1>
    <p class="m-0 text-muted">
      {locked
        ? 'Use and stop the sandboxes running on this computer. Starting new ones through the tunnel is locked; see below.'
        : connectOnly
        ? 'This app only connects to sandboxes running elsewhere; add them with + in the rail.'
        : 'Start a sandbox where an agent analyses your data. Sandboxes started here run while the app runs; closing this tab does not stop them.'}
    </p>
  </header>

  {#if reach !== 'reachable' && reach !== 'loading'}
    <Status kind={reach === 'unreachable' ? 'warn' : 'bad'} title={REACH_TEXT[reach]} detail={machine.error || undefined} />
  {/if}

  {#key machine}
    {#if !machine.listed}
      {#if reach === 'loading' || reach === 'reachable'}
        <div class="card p-4" role="status" aria-label="Loading the sandboxes"><Skeleton lines={['35%', '55%']} /></div>
      {/if}
    {:else if here.length}
      <section class="flex flex-col gap-3" aria-label="Sandboxes on {app.several ? machine.name : 'this computer'}">
        {#each here as worker (worker.id)}
          <SandboxCard {worker} />
        {/each}
      </section>
    {/if}
    {#if machine.listed && added.length}
      <section class="flex flex-col gap-3" aria-label="Sandboxes running elsewhere">
        <h2 class="m-0 mt-2 font-display text-xl font-medium">Running elsewhere</h2>
        {#each added as worker (worker.id)}
          <SandboxCard {worker} />
        {/each}
      </section>
    {/if}

    {#if machine === app.head}
      <TunnelCard />
    {/if}

    {#if locked && reach === 'reachable'}
      <h2 class="m-0 mt-2 font-display text-xl font-medium">Start a sandbox</h2>
      <StartLocked {machine} />
    {:else if !connectOnly && reach !== 'newer' && reach !== 'elsewhere'}
      <h2 class="m-0 mt-2 font-display text-xl font-medium">Start a sandbox</h2>
      <EngineCard {machine} recheck={() => recheck()} />
      <ResourcesCard {machine} />
      {#if machine.system}
        <StartForm {machine} {recheck} />
      {/if}
    {/if}
  {/key}
</main>
