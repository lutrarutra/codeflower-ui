<script lang="ts">
  // Starting sandboxes on this computer, and the ones that run here.
  import { app } from '../lib/app.svelte.ts';
  import EngineCard from './EngineCard.svelte';
  import ResourcesCard from './ResourcesCard.svelte';
  import SandboxCard from './SandboxCard.svelte';
  import StartForm from './StartForm.svelte';

  const here = $derived(app.workers.filter((worker) => worker.source !== 'added'));
  const connectOnly = $derived(app.system?.capabilities.connectOnly ?? false);

  function recheck(query?: { engine: string; image: string; imageTag: string }): void {
    void app.loadSystem(query);
  }
</script>

<main class="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
  <header>
    <h1 class="m-0 font-display text-2xl font-medium">This computer</h1>
    <p class="m-0 text-muted">
      {connectOnly
        ? 'This app only connects to sandboxes running elsewhere; add them in the sidebar.'
        : 'Start a sandbox where an agent analyses your data. Sandboxes started here run while the app runs; closing this tab does not stop them.'}
    </p>
  </header>

  {#if here.length}
    <section class="flex flex-col gap-3" aria-label="Sandboxes on this computer">
      {#each here as worker (worker.id)}
        <SandboxCard {worker} />
      {/each}
    </section>
  {/if}

  {#if !connectOnly}
    <h2 class="m-0 mt-2 font-display text-xl font-medium">Start a sandbox</h2>
    <EngineCard recheck={() => recheck()} />
    <ResourcesCard />
    {#if app.system}
      <StartForm {recheck} />
    {/if}
  {/if}
</main>
