<script lang="ts">
  // Which versions are at work for a sandbox: this page's and who serves it
  // (the app's client, or the sandbox itself), the app that started the
  // sandbox, its image and what the image has. Copy gives them as text.
  import { tunnelConnectorId } from '../../tunnel/connect.ts';
  import { copyText, type Worker } from './api.ts';
  import { app } from './app.svelte.ts';
  import { UI_VERSION } from './version.ts';
  import { versionLines, versionText, type PageServer } from './versions.ts';
  import type { WebWorker } from './worker.svelte.ts';

  let { worker, agent }: { worker: Worker; agent: WebWorker } = $props();

  const versions = $derived(worker.activity?.versions);
  const server: PageServer = $derived.by(() => {
    if (app.single) return { kind: 'sandbox' };
    const tunnel = tunnelConnectorId() !== undefined;
    return {
      kind: 'client',
      version: app.head.system?.version ?? '',
      computer: tunnel ? app.head.name : (app.head.system?.hostname ?? ''),
      ...(tunnel ? {} : { address: location.host })
    };
  });
  // Through the tunnel, a sandbox of another computer is listed by that computer's client.
  const lister = $derived.by(() => {
    const machine = app.machine(worker.id);
    return machine === app.head || app.single ? undefined : { computer: machine.name, version: machine.system?.version ?? '' };
  });
  const lines = $derived(
    versionLines({ ui: UI_VERSION, server, lister, versions, agentName: (id) => agent.agent(id)?.name ?? id })
  );

  let copied = $state(false);
  async function copy(): Promise<void> {
    await copyText(versionText(lines));
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<section class="card flex flex-col gap-2 p-4">
  <div class="flex items-center gap-2">
    <h2 class="m-0 font-display text-lg font-medium">Versions</h2>
    <button type="button" class="pill pill-small ml-auto" title="Copy the versions as text, e.g. for a bug report" onclick={copy}
      >{copied ? 'Copied' : 'Copy'}</button
    >
  </div>
  <dl class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
    {#each lines as line (line.label)}
      <dt class="text-muted">{line.label}</dt>
      <dd class="m-0 min-w-0">
        <span class="font-semibold">{line.value}</span>
        {#if line.detail}<span class="text-[0.9em] break-words text-muted"> · {line.detail}</span>{/if}
      </dd>
    {/each}
  </dl>
  {#if !versions}
    <p class="m-0 text-[0.85em] text-muted">
      {worker.status === 'ready'
        ? "This sandbox does not say which versions it runs: its image is older than that."
        : 'The sandbox says which versions it runs once it answers.'}
    </p>
  {/if}
</section>
