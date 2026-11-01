<script lang="ts">
  // A sandbox running elsewhere (a batch job, another computer), added by the line it printed.
  import type { Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  let address = $state('');
  let error = $state('');
  let busy = $state(false);
  /** The line came from a link a sandbox printed, not from the user's paste. */
  let linked = $state(false);

  $effect(() => {
    if (open && dialog && !dialog.open) {
      error = '';
      dialog.showModal();
    }
  });

  // A link a sandbox printed fills in its line; the user still confirms.
  $effect(() => {
    if (app.offered === null) return;
    address = app.offered;
    linked = true;
    app.offered = null;
    open = true;
  });

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

<dialog bind:this={dialog} onclose={() => ((open = false), (linked = false))} aria-labelledby="add-title">
  <form class="card flex flex-col gap-3 p-5" onsubmit={add} autocomplete="off">
    <h2 id="add-title" class="m-0 font-display text-lg font-medium">Add a sandbox running elsewhere</h2>
    {#if linked}
      <p class="m-0 text-muted">
        A link a sandbox printed asks to add it. Add it only if you started it: whoever runs it sees what you send its agent.
      </p>
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
</dialog>
