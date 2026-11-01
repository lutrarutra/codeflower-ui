<script lang="ts">
  // A new sandbox: started on a computer the page reaches, or one running elsewhere (a batch job,
  // another computer) added by the line it printed. Opened by the rail's + (app.creating), on the
  // computer of the sandbox in front. Computers that cannot start one show why, greyed out.
  import { untrack } from 'svelte';
  import { tunnelConnectorId } from '../tunnel/connect.ts';
  import type { Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import type { Machine } from './lib/machines.svelte.ts';
  import { machineColor, START_TEXT, startState } from './lib/rail.ts';
  import EngineCard from './server/EngineCard.svelte';
  import StartForm from './server/StartForm.svelte';
  import StartLocked from './server/StartLocked.svelte';

  let dialog: HTMLDialogElement | undefined = $state();
  let tab = $state<'start' | 'connect'>('start');
  /** The computer the sandbox starts on; none can start one. */
  let chosen = $state<Machine | null>(null);
  /** The computer the user came from, when it cannot start one: why not shows. */
  let asked = $state<Machine | null>(null);
  let address = $state('');
  let error = $state('');
  let busy = $state(false);
  /** The line came from a link a sandbox printed, not from the user's paste. */
  let linked = $state(false);

  // Through the tunnel, adding sandboxes stays on the computer itself.
  const canConnect = $derived(!app.single && tunnelConnectorId() === undefined);
  const keys = $derived(app.machines.map((machine) => machine.key));
  const several = $derived(app.machines.length > 1);
  const startable = (machine: Machine) => startState(machine) === 'ok';
  const named = (machine: Machine) => machine.name || 'This computer';

  $effect(() => {
    const request = app.creating;
    if (!request || !dialog || dialog.open) return;
    untrack(() => {
      const wanted = app.machines.find((machine) => machine.key === request.machine) ?? app.head;
      chosen = startable(wanted) ? wanted : (app.machines.find(startable) ?? null);
      asked = startable(wanted) ? null : wanted;
      tab = request.tab === 'connect' && canConnect ? 'connect' : 'start';
      error = '';
      dialog?.showModal();
    });
  });

  // A link a sandbox printed fills in its line; the user still confirms.
  $effect(() => {
    if (app.offered === null) return;
    address = app.offered;
    linked = true;
    app.offered = null;
    app.creating = { tab: 'connect' };
  });

  function started(id: string): void {
    dialog?.close();
    app.go({ view: 'chat', worker: id });
  }

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!address.trim()) return;
    busy = true;
    error = '';
    try {
      const worker = app.head.adopt(await app.head.api<Worker>('/api/workers/connect', { body: { address: address.trim() } }));
      address = '';
      dialog?.close();
      await app.refreshWorkers();
      app.go({ view: 'chat', worker: worker.id });
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} onclose={() => ((app.creating = null), (linked = false))} aria-labelledby="new-sandbox-title">
  <div class="card flex w-full flex-col gap-4 p-5">
    <header class="flex items-center gap-3">
      <h2 id="new-sandbox-title" class="m-0 font-display text-xl font-medium">New sandbox</h2>
      <button class="ml-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink" aria-label="Close" onclick={() => dialog?.close()}>
        <span class="codicon codicon-close"></span>
      </button>
    </header>

    {#if canConnect}
      <div class="flex self-start rounded-full border-[1.5px] border-soft-line bg-paper p-0.5" role="tablist" aria-label="How">
        {#each [{ id: 'start', label: 'Start a new one' }, { id: 'connect', label: 'Connect one running elsewhere' }] as const as option (option.id)}
          <button
            role="tab"
            aria-selected={tab === option.id}
            class="rounded-full px-3 py-1 text-[0.9em] font-semibold {tab === option.id ? 'bg-indigo text-on-accent' : 'text-muted hover:text-ink'}"
            onclick={() => (tab = option.id)}>{option.label}</button
          >
        {/each}
      </div>
    {/if}

    {#if tab === 'start'}
      {#if several}
        <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
          <legend class="mb-2 p-0 font-semibold">Where it runs</legend>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-2" role="radiogroup" aria-label="Computer">
            {#each app.machines as machine (machine.key)}
              {@const state = startState(machine)}
              {@const checked = machine === chosen}
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={state !== 'ok'}
                class="flex min-w-0 flex-col gap-0.5 rounded-xl border-[1.5px] px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-55 {checked
                  ? 'border-indigo bg-indigo-soft'
                  : machine === asked
                    ? 'border-dashed border-orange'
                    : 'border-soft-line bg-card hover:border-line'}"
                onclick={() => ((chosen = machine), (asked = null))}
              >
                <span class="flex w-full min-w-0 items-center gap-2 font-semibold">
                  <span class="size-2.5 shrink-0 rounded-[3px]" style:background={machineColor(machine.key, keys)}></span>
                  <span class="min-w-0 truncate">{named(machine)}</span>
                  {#if state === 'locked'}<span class="codicon codicon-lock ml-auto text-muted" title="Locked"></span>{/if}
                </span>
                <span class="text-[0.85em] text-muted">{state === 'ok' ? (machine.connectorId ? 'Through the tunnel' : 'This computer') : START_TEXT[state]}</span>
              </button>
            {/each}
          </div>
        </fieldset>
      {/if}

      {#if asked}
        {@const state = startState(asked)}
        {#if state === 'locked'}
          <StartLocked machine={asked} />
        {:else}
          <p class="m-0 rounded-xl border-[1.5px] border-orange bg-yellow-soft px-3 py-2 text-[0.9em]">
            {state === 'connectOnly'
              ? `${named(asked)} only connects to sandboxes running elsewhere (connect_only in its settings), so none can start there.`
              : `A sandbox cannot start on ${named(asked)}: ${START_TEXT[state].toLowerCase()}.`}
            {#if chosen}Start it on another computer instead.{/if}
          </p>
        {/if}
      {/if}

      {#if several}
        {#each app.machines.filter((machine) => machine !== asked && startState(machine) === 'locked') as machine (machine.key)}
          <details class="rounded-xl border-[1.5px] border-soft-line px-3 py-2 text-[0.9em]">
            <summary class="cursor-pointer">Starting on <strong>{named(machine)}</strong> through the tunnel is off. How to allow it</summary>
            <div class="pt-2"><StartLocked {machine} /></div>
          </details>
        {/each}
      {/if}

      {#if chosen}
        {@const machine = chosen}
        {#key machine}
          <EngineCard {machine} recheck={() => void machine.loadSystem()} />
          {#if machine.system}
            <StartForm {machine} recheck={(query) => void machine.loadSystem(query)} onStarted={started} />
          {/if}
        {/key}
      {:else if !asked}
        <p class="m-0 text-muted">No computer this page reaches can start a sandbox.</p>
      {/if}
    {:else}
      <form class="flex flex-col gap-3" onsubmit={add} autocomplete="off">
        {#if linked}
          <p class="m-0 text-muted">A link a sandbox printed asks to add it. Add it only if you started it: whoever runs it sees what you send its agent.</p>
        {:else}
          <p class="m-0 text-muted">
            Paste the line a sandbox printed when it started, for example in a batch job's log. It starts with
            <code class="rounded bg-code px-1 font-mono text-[0.85em]">codeflower://</code>.
          </p>
        {/if}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="field font-mono" bind:value={address} placeholder="codeflower://host:port?token=…" spellcheck="false" aria-label="Sandbox line" autofocus />
        {#if error}<p class="m-0 text-red" role="alert">{error}</p>{/if}
        <footer class="flex justify-end gap-2">
          <button type="button" class="pill" onclick={() => dialog?.close()}>Cancel</button>
          <button type="submit" class="pill pill-primary" disabled={busy || !address.trim()}>Add</button>
        </footer>
      </form>
    {/if}
  </div>
</dialog>
