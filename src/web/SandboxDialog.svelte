<script lang="ts">
  // A sandbox's name in the list; an added one's address and token, as when it
  // restarted elsewhere or with a new token; and removing it from the list.
  import { tick } from 'svelte';
  import { api, type Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import { canForget, workerTitle } from './lib/format.ts';

  let { worker = $bindable(null) }: { worker?: Worker | null } = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  let name = $state('');
  let host = $state('');
  let port = $state('');
  let token = $state('');
  let line = $state('');
  let error = $state('');
  let busy = $state(false);
  let removing = $state(false);
  // The sandbox the dialog opened for; the list keeps refreshing meanwhile.
  let shown = $state<Worker | null>(null);

  const added = $derived(shown?.source === 'added');

  /** host and port of `host:port`, `[::1]:port` included. */
  function split(address = ''): [string, string] {
    const at = address.lastIndexOf(':');
    if (at < 0) return [address, ''];
    return [address.slice(0, at).replace(/^\[(.*)\]$/, '$1'), address.slice(at + 1)];
  }

  $effect(() => {
    if (!worker || !dialog || dialog.open) return;
    shown = worker;
    name = worker.name ?? '';
    [host, port] = split(worker.address);
    token = line = error = '';
    removing = false;
    // Once the form is there, so that its first field takes the focus.
    void tick().then(() => dialog?.showModal());
  });

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!shown) return;
    const [oldHost, oldPort] = split(shown.address);
    const body: Record<string, unknown> = { name };
    if (added) {
      if (line.trim()) body.address = line.trim();
      else {
        if (host.trim() && host.trim() !== oldHost) body.host = host.trim();
        if (port.trim() && port.trim() !== oldPort) body.port = Number(port.trim());
        if (token.trim()) body.token = token.trim();
      }
    }
    busy = true;
    error = '';
    try {
      await api<Worker>(`/api/workers/${shown.id}`, { method: 'PATCH', body });
      await app.refreshWorkers();
      dialog?.close();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!shown) return;
    busy = true;
    error = '';
    try {
      await api(`/api/workers/${shown.id}`, { method: 'DELETE', body: {} });
      if (app.route.worker === shown.id) app.go({ view: 'chat' });
      await app.refreshWorkers();
      dialog?.close();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} onclose={() => ((worker = null), (shown = null))} aria-labelledby="sandbox-title">
  {#if shown}
    <form class="card flex w-[min(30rem,calc(100vw-2rem))] flex-col gap-3 p-5" onsubmit={save} autocomplete="off">
      <h2 id="sandbox-title" class="m-0 font-display text-lg font-medium">{workerTitle(shown)[0]}</h2>
      <label class="flex flex-col gap-1">
        <span class="text-[0.9em] text-muted">Name in the list</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="field" bind:value={name} placeholder={shown.label || 'Sandbox'} maxlength="80" spellcheck="false" autofocus />
      </label>
      {#if added}
        <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
          <legend class="mb-1 p-0 text-[0.9em] text-muted">
            Where it runs. Change it when the sandbox restarted on another node, port or token.
          </legend>
          <div class="grid grid-cols-[1fr_6rem] gap-2">
            <input class="field font-mono" bind:value={host} placeholder="Host" aria-label="Host" spellcheck="false" disabled={!!line.trim()} />
            <input
              class="field font-mono"
              bind:value={port}
              placeholder="Port"
              aria-label="Port"
              inputmode="numeric"
              spellcheck="false"
              disabled={!!line.trim()}
            />
          </div>
          <input
            class="field font-mono"
            type="password"
            bind:value={token}
            placeholder="Token (leave blank to keep it)"
            aria-label="Token"
            spellcheck="false"
            disabled={!!line.trim()}
          />
          <input class="field font-mono" bind:value={line} placeholder="Or paste its new codeflower://… line" aria-label="New line" spellcheck="false" />
        </fieldset>
      {/if}
      {#if error}<p class="m-0 text-red" role="alert">{error}</p>{/if}
      <footer class="flex flex-wrap items-center justify-end gap-2">
        {#if canForget(shown)}
          {#if removing}
            <span class="mr-auto flex items-center gap-2 text-[0.9em]">
              {added ? 'It keeps running; add it again with its line.' : 'Remove it?'}
              <button type="button" class="pill pill-small text-red" disabled={busy} onclick={remove}>Remove</button>
            </span>
          {:else}
            <button type="button" class="link mr-auto text-[0.9em] text-red" onclick={() => (removing = true)}>Remove from the list</button>
          {/if}
        {/if}
        <button type="button" class="pill" onclick={() => dialog?.close()}>Cancel</button>
        <button type="submit" class="pill pill-primary" disabled={busy}>Save</button>
      </footer>
    </form>
  {/if}
</dialog>
