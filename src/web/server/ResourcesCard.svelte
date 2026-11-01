<script lang="ts">
  // This computer's processors and memory, refreshed like htop while the page shows.
  import type { Resources } from '../lib/api.ts';
  import { bytes } from '../lib/format.ts';
  import type { Machine } from '../lib/machines.svelte.ts';

  let { machine }: { machine: Machine } = $props();

  let resources = $state<Resources | null>(null);

  $effect(() => {
    let loading = false;
    const refresh = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        resources = await machine.api<Resources>('/api/resources');
      } catch {
        // The app may be busy or gone; the next refresh tries again.
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  });

  const busy = (core: Resources['cores'][number]) => core.user + core.system + core.iowait;
  const share = (value: number, total: number) => (total ? (100 * value) / total : 0);
  const average = $derived(resources?.cores.length ? resources.cores.reduce((sum, core) => sum + busy(core), 0) / resources.cores.length : 0);
  // Docker Desktop's virtual machine has its own share of this computer.
  const desktop = $derived(machine.system?.engine === 'docker' && /macOS|Windows/.test(machine.system.system || ''));
</script>

{#snippet meter(segments: [string, number][])}
  <div class="meter">
    {#each segments.filter(([, percent]) => percent > 0) as [kind, percent] (kind)}
      <span class={kind} style:width="{percent}%"></span>
    {/each}
  </div>
{/snippet}

<section class="card p-5" aria-labelledby="resources-title">
  <h2 id="resources-title" class="m-0 mb-3 flex flex-wrap items-baseline gap-2 font-display text-lg font-medium">
    This computer
    {#if resources}
      <span class="font-sans text-[0.8rem] font-normal text-muted">
        {resources.cores.length} core{resources.cores.length === 1 ? '' : 's'}, {Math.round(average)}% busy{resources.load
          ? ` · load ${resources.load.map((value) => value.toFixed(2)).join(' ')}`
          : ''}
      </span>
    {/if}
  </h2>
  {#if resources}
    {@const memory = resources.memory}
    <div class="grid grid-cols-[3rem_1fr_auto] items-center gap-x-2 gap-y-1 font-mono text-[0.8em]">
      <span>Mem</span>
      {@render meter([
        ['used', share(memory.used, memory.total)],
        ['cache', share(memory.cached, memory.total)]
      ])}
      <span class="text-muted">{bytes(memory.used)} / {bytes(memory.total)}</span>
      {#if memory.swapTotal}
        <span>Swap</span>
        {@render meter([['system', share(memory.swapUsed, memory.swapTotal)]])}
        <span class="text-muted">{bytes(memory.swapUsed)} / {bytes(memory.swapTotal)}</span>
      {/if}
    </div>
    <div class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-1 font-mono text-[0.75em]" aria-label="Processor usage per core">
      {#each resources.cores as core, index (index)}
        <div
          class="flex items-center gap-1.5"
          title="core {index + 1}: {Math.round(core.user)}% user, {Math.round(core.system)}% system, {Math.round(core.iowait)}% waiting for disk"
        >
          <span class="w-5 text-right text-muted">{index + 1}</span>
          {@render meter([
            ['user', core.user],
            ['system', core.system],
            ['iowait', core.iowait]
          ])}
          <span class="w-11 text-right text-muted">{busy(core).toFixed(1)}%</span>
        </div>
      {/each}
    </div>
    <p class="mb-0 text-[0.8em] text-muted">
      <span class="key key-user"></span>user <span class="key key-system"></span>system <span class="key key-iowait"></span>waiting for disk
      {#if memory.cached}<span class="key key-cache"></span>file cache{/if}
    </p>
    {#if desktop}
      <p class="mb-0 text-[0.85em] text-muted">
        Sandboxes run in Docker Desktop's virtual machine, which may use only part of these processors and memory (Docker Desktop → Settings → Resources).
      </p>
    {/if}
  {:else}
    <p class="m-0 text-muted"><span class="spinner"></span> Reading…</p>
  {/if}
</section>
