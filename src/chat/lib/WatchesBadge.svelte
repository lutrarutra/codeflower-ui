<script lang="ts">
  import { watchActive, watchStatus, type Watch } from '../../protocol/watches.ts';
  import Elapsed from './Elapsed.svelte';
  import { chatHost } from './host.ts';
  import { epoch } from './time.ts';

  // In the footer: how many watches this chat's agent left running
  // (codeflower-watch: a command the worker runs every so often until a
  // condition holds), and a list of them and those that ended in the last
  // day, each opening its output; running ones can be stopped.
  let { watches }: { watches: Watch[] } = $props();
  const host = chatHost();

  const active = $derived(watches.filter(watchActive));
  const label = $derived(
    active.length
      ? `${active.length} watch${active.length === 1 ? '' : 'es'} running`
      : `${watches.length} watch${watches.length === 1 ? '' : 'es'} of this chat`
  );

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  // Asked to stop: the list shows it until the bridge says it is.
  let stopping = $state<Record<string, boolean>>({});
  // The watch whose stop the user is asked to confirm: the agent then waits for nothing.
  let confirming = $state<string | null>(null);

  function openOutput(watch: Watch): void {
    open = false;
    host.send({ type: 'openFile', path: watch.log });
  }

  // Asked to run now: the button spins until the bridge says the run ended.
  let checking = $state<Record<string, number>>({});

  function check(watch: Watch): void {
    checking[watch.id] = watch.runs;
    host.send({ type: 'checkWatch', id: watch.id });
  }

  // A check is done once the watch has run again, or is no longer running.
  $effect(() => {
    for (const watch of watches) {
      const asked = checking[watch.id];
      if (asked !== undefined && !watch.running && (watch.runs > asked || !watchActive(watch))) delete checking[watch.id];
    }
  });

  function stop(watch: Watch): void {
    confirming = null;
    stopping[watch.id] = true;
    host.send({ type: 'stopWatch', id: watch.id });
  }

  function focusOnShow(node: HTMLElement): void {
    node.focus();
  }

  function escape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (confirming) {
      event.stopPropagation();
      confirming = null;
    } else open = false;
  }

  const dot: Record<string, string> = {
    watching: 'bg-[#1ec8f0]',
    met: 'bg-[#3fbf57]',
    stopped: 'bg-pink',
    timeout: 'bg-[#ff9f1c]',
    failing: 'bg-red',
    lost: 'bg-red'
  };
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !event.composedPath().includes(root)) open = false;
  }}
/>

{#if watches.length}
  <div class="flex items-center" bind:this={root}>
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-full border-none bg-transparent px-1 py-0 leading-none text-inherit hover:text-ink {active.length
        ? 'font-semibold text-cyan'
        : ''}"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      title="{label}: see their output"
      onclick={() => {
        open = !open;
        confirming = null;
      }}
      onkeydown={escape}
    >
      <span class="codicon codicon-eye-watch"></span>
      <!-- Only the running ones count: those that ended are in the list. -->
      {active.length}
    </button>
    {#if open}
      <div
        role="dialog"
        aria-label="Watches"
        tabindex="-1"
        class="card absolute bottom-full right-0 z-20 mb-2 flex max-h-96 w-80 max-w-[calc(100vw-2rem)] flex-col gap-0.5 overflow-y-auto p-1.5 text-[1.25em] text-ink"
        onkeydown={escape}
      >
        <div class="eyebrow px-2 pt-1 pb-1 text-violet">Watches</div>
        {#each watches as watch (watch.id)}
          {@const live = watchActive(watch)}
          <div class="relative rounded-lg hover:bg-code">
            <button
              type="button"
              class="flex w-full min-w-0 flex-col rounded-lg border-none bg-transparent px-2 py-1.5 text-left"
              title="{watch.command}\nOpen its output"
              aria-label="Open the output of {watch.name}"
              onclick={() => openOutput(watch)}
            >
              <span class="flex w-full min-w-0 items-center gap-2" style:padding-right={live ? '3.25rem' : undefined}>
                <span
                  class="size-2 shrink-0 rounded-full {dot[watch.state] ?? 'bg-muted'} {watch.running ? 'animate-pulse' : ''}"
                  title={watch.running ? 'running now' : watch.state}
                ></span>
                <span class="min-w-0 flex-1 truncate text-[0.9em]">{watch.name} <span class="text-muted">{watch.id}</span></span>
                <Elapsed started={epoch(watch.started)} ended={live ? null : epoch(watch.ended)} running={live} />
              </span>
              <span class="block w-full truncate pl-4 font-mono text-[0.75em] text-muted" title={watch.command}>{watch.command}</span>
              <span class="block w-full truncate pl-4 text-[0.75em] text-muted" title={watchStatus(watch)}>{watchStatus(watch)}</span>
            </button>
            {#if live}
              <span class="absolute top-1 right-1 flex items-center gap-0.5">
                <button
                  type="button"
                  class="inline-flex size-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-ink disabled:opacity-50"
                  title="Check now: run its command now rather than at the next run"
                  aria-label="Check {watch.name} now"
                  disabled={checking[watch.id] !== undefined || watch.running}
                  onclick={() => check(watch)}
                >
                  <span class="codicon codicon-{checking[watch.id] !== undefined || watch.running ? 'loading codicon-modifier-spin' : 'debug-rerun'}"></span>
                </button>
                <button
                  type="button"
                  class="inline-flex size-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-red disabled:opacity-50"
                  title="Stop this watch…"
                  aria-label="Stop {watch.name}…"
                  aria-expanded={confirming === watch.id}
                  disabled={stopping[watch.id]}
                  onclick={() => (confirming = confirming === watch.id ? null : watch.id)}
                >
                  <span class="codicon codicon-{stopping[watch.id] ? 'loading codicon-modifier-spin' : 'debug-stop'}"></span>
                </button>
              </span>
            {/if}
          </div>
          {#if confirming === watch.id && live && !stopping[watch.id]}
            <div
              role="alertdialog"
              aria-label="Stop {watch.name}?"
              class="mx-1 mb-1 flex flex-col gap-2 rounded-lg border-[1.5px] border-red/40 bg-pink-soft px-2.5 py-2 text-[0.85em]"
            >
              <span class="flex items-start gap-1.5">
                <span class="codicon codicon-warning mt-[2px] shrink-0 text-red"></span>
                <span>Stop {watch.name}? The agent is told that you stopped it.</span>
              </span>
              <span class="flex justify-end gap-1.5">
                <button type="button" class="chip" use:focusOnShow onclick={() => (confirming = null)}>Keep it</button>
                <button type="button" class="chip border-red! bg-red! font-semibold text-white!" onclick={() => stop(watch)}>
                  <span class="codicon codicon-debug-stop"></span> Stop the watch
                </button>
              </span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}
