<script lang="ts">
  import { app } from '../lib/app.svelte.ts';
  import Status from './Status.svelte';
  import Steps from './Steps.svelte';

  let { recheck }: { recheck: () => void } = $props();
  let tab = $state(0);
  const system = $derived(app.system);
  const engine = $derived(system?.engines.find((item) => item.name === system.engine));
</script>

<section class="card p-5">
  <h2 class="m-0 mb-3 flex items-center gap-2 font-display text-lg font-medium">
    <span class="grid size-6 place-items-center rounded-full bg-indigo text-[0.8em] text-on-accent">1</span> Container engine
  </h2>
  {#if app.systemError}
    <Status kind="bad" title="Could not check this computer" detail={app.systemError} />
    <button class="pill mt-3" onclick={recheck}>Check again</button>
  {:else if !system}
    <p class="m-0 text-muted"><span class="spinner"></span> Looking for Docker, Podman or Apptainer…</p>
  {:else}
    {#snippet engines()}
      <p class="m-0 mt-2 flex flex-wrap gap-x-3 text-[0.85em] text-muted">
        {#each system!.engines as item (item.name)}
          <span class:text-green={item.ready}
            >{item.label}: {item.ready ? `ready${item.version ? ` ${item.version}` : ''}` : item.installed ? 'not running' : 'not installed'}</span
          >
        {/each}
      </p>
    {/snippet}
    {#if engine}
      <Status kind="ok" title="{engine.label} is ready" detail="Sandboxes run in containers with {engine.label}, isolated from the rest of this computer." />
      {@render engines()}
      {#if system.image?.download}
        <div class="mt-4">
          <Status kind="ok" title="The sandbox image is downloaded when you start" detail="The first start downloads {system.image.name} (a few GB), once." />
        </div>
      {:else if system.image && !system.image.ready}
        <div class="mt-4">
          <Status kind="warn" title={`The sandbox image "${system.image.name}" is not on this computer yet`} detail={system.image.error} />
          <Steps steps={system.image.help ?? []} />
          <button class="pill" onclick={recheck}>Check again</button>
        </div>
      {/if}
    {:else if system.fix?.length}
      <Status kind="warn" title={system.problem ?? 'The container engine needs a fix'} />
      {@render engines()}
      <Steps steps={system.fix} />
      <button class="pill" onclick={recheck}>Check again</button>
    {:else}
      <Status
        kind="bad"
        title="No container engine found"
        detail="code flower runs each agent in a sandbox, which needs Docker, Podman or Apptainer. Install one for {system.guide.system}:"
      />
      {@render engines()}
      {@const options = system.guide.options}
      {@const option = options[Math.min(tab, options.length - 1)]}
      <div class="mt-3 flex flex-wrap gap-1.5" role="tablist">
        {#each options as choice, index (choice.title)}
          <button role="tab" aria-selected={option === choice} class="pill pill-small {option === choice ? 'pill-primary' : ''}" onclick={() => (tab = index)}
            >{choice.title}</button
          >
        {/each}
      </div>
      {#if option}
        {#if option.note}<p class="mb-0 text-muted">{option.note}</p>{/if}
        <Steps steps={option.steps} />
      {/if}
      <button class="pill" onclick={recheck}>Check again</button>
    {/if}
  {/if}
</section>
