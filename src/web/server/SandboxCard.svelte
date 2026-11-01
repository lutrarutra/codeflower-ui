<script lang="ts">
  import { tunnelConnectorId } from '../../tunnel/connect.ts';
  import ActivityChips from '../lib/ActivityChips.svelte';
  import ConnectLine from '../lib/ConnectLine.svelte';
  import StatusDot from '../lib/StatusDot.svelte';
  import UsageChips from '../lib/UsageChips.svelte';
  import type { Worker } from '../lib/api.ts';
  import { app } from '../lib/app.svelte.ts';
  import { canForget, canStop, SOURCE_TEXT, SOURCE_TITLE, statusText, workerTitle } from '../lib/format.ts';

  let { worker }: { worker: Worker } = $props();
  const [name, where] = $derived(workerTitle(worker));
  const count = (paths: string[], noun: string) => (paths.length ? `${paths.length} ${noun} folder${paths.length === 1 ? '' : 's'}` : null);
  const meta = $derived(
    worker.source === 'added'
      ? worker.status === 'unreachable'
        ? 'Not answering. It may have stopped, or this computer cannot reach it.'
        : ''
      : [
          worker.source === 'local' ? null : worker.engine,
          count(worker.inputs, 'input') || 'no input folder',
          count(worker.outputs, 'output'),
          count(worker.code, 'code'),
          count(worker.skills, 'skills'),
          worker.allowlist ? 'network isolated' : null
        ]
          .filter(Boolean)
          .join(' · ')
  );
  const paths = $derived(
    [
      ...worker.inputs.map((path) => `input ${path}`),
      ...worker.outputs.map((path) => `output ${path}`),
      ...worker.code.map((path) => `code ${path}`),
      ...worker.skills.map((path) => `skills ${path}`)
    ].join('\n')
  );
  const forgettable = $derived(canForget(worker));
  let log: HTMLPreElement | undefined = $state();

  $effect(() => {
    void worker.log.length;
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 48) log.scrollTop = log.scrollHeight;
  });

  async function stop(): Promise<void> {
    await app.workerApi(worker.id, '/stop', { body: {} }).catch(() => undefined);
    await app.refreshWorkers();
  }

  async function forget(): Promise<void> {
    await app.workerApi(worker.id, '', { method: 'DELETE', body: {} }).catch(() => undefined);
    await app.refreshWorkers();
  }
</script>

<article id="sandbox-{worker.id}" class="card flex flex-col gap-3 p-4" class:outline-orange={!!worker.activity?.waiting}>
  <header class="flex items-start gap-3">
    <span class="pt-1.5"><StatusDot {worker} /></span>
    <div class="min-w-0 flex-1">
      <h3 class="m-0 flex flex-wrap items-baseline gap-x-2 font-display text-[1.05rem] font-medium">
        {name} <span class="font-sans text-[0.85rem] font-normal text-muted">{where}</span>
        <span class="tag bg-soft-line text-muted" title={SOURCE_TITLE[worker.source]}>{SOURCE_TEXT[worker.source]}</span>
        <span class="text-[0.8rem] font-semibold text-muted">{statusText(worker)}</span>
      </h3>
      {#if meta}<p class="m-0 text-[0.85em] text-muted" title={paths}>{meta}</p>{/if}
      {#if worker.allowlist}
        <p class="m-0 text-[0.85em] text-muted">
          Network isolated. To allow a host, add a line to <code>{worker.allowlist}</code>; it applies at once. Refused hosts appear in the log.
        </p>
      {/if}
      {#if worker.source === 'local'}
        <p class="m-0 text-[0.85em] text-muted">
          {worker.kind === 'task'
            ? 'A task started in a terminal. It works by itself and has no chat; its terminal shows its progress.'
            : 'Started in a terminal on this computer. Stopping it here stops it there too.'}
        </p>
      {/if}
      {#if worker.source === 'added'}<p class="m-0 text-[0.85em] text-muted">Running elsewhere. Removing it from the list does not stop it.</p>{/if}
      <div class="mt-1.5 flex flex-wrap gap-1.5"><ActivityChips {worker} /><UsageChips {worker} /></div>
    </div>
    {#if worker.url && worker.kind !== 'task'}
      <button class="pill pill-small pill-primary" onclick={() => app.go({ view: 'chat', worker: worker.id })}>Chat</button>
    {/if}
    {#if canStop(worker)}
      <button class="pill pill-small" onclick={stop}>Stop</button>
    {:else if worker.status === 'stopping'}
      <button class="pill pill-small" disabled>Stopping…</button>
    {/if}
    {#if forgettable}
      <button class="text-muted hover:text-ink" title="Remove from the list" aria-label="Remove from the list" onclick={forget}
        ><span class="codicon codicon-close"></span></button
      >
    {/if}
  </header>
  {#if worker.url && tunnelConnectorId() === undefined}
    <details>
      <summary class="cursor-pointer text-[0.9em] font-semibold text-muted">Connect from VS Code</summary>
      <div class="pt-2">
        <p class="mt-0 text-[0.9em]">
          Install the code flower extension, then click <em>Open in VS Code</em>, or run <em>code flower: Connect to worker</em> from the command palette and paste
          this line:
        </p>
        <ConnectLine url={worker.url} />
      </div>
    </details>
  {/if}
  {#if worker.error}<p class="m-0 text-red">{worker.error}</p>{/if}
  {#if worker.log.length}
    <details open={worker.status === 'failed'}>
      <summary class="cursor-pointer text-[0.9em] font-semibold text-muted">Log</summary>
      <pre bind:this={log} class="mt-2 max-h-64 overflow-auto rounded-lg bg-code p-2.5 font-mono text-[0.78em] whitespace-pre-wrap">{worker.log.join('\n')}</pre>
    </details>
  {/if}
</article>
