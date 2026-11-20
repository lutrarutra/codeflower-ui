<script lang="ts">
  import { jobActive, jobOutput, jobStatus, type BatchJob } from '../../protocol/jobs.ts';
  import Elapsed from './Elapsed.svelte';
  import { chatHost } from './host.ts';
  import { epoch } from './time.ts';

  // In the footer: how many of the batch jobs this chat asked for are queued
  // or running (codeflower-job), and a list of them and those that ended in
  // the last day, each opening its output; active ones can be cancelled.
  let { jobs }: { jobs: BatchJob[] } = $props();
  const host = chatHost();

  const active = $derived(jobs.filter(jobActive));
  const running = $derived(active.filter((job) => job.state === 'running').length);
  const label = $derived(
    active.length
      ? `${active.length} batch job${active.length === 1 ? '' : 's'} ${running ? `(${running} running)` : 'queued'}`
      : `${jobs.length} batch job${jobs.length === 1 ? '' : 's'} of this chat`
  );

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  // Asked to cancel: the list shows it until the bridge says it is.
  let cancelling = $state<Record<string, boolean>>({});

  function openOutput(job: BatchJob): void {
    open = false;
    host.send({ type: 'openFile', path: jobOutput(job) });
  }

  function cancel(job: BatchJob): void {
    cancelling[job.id] = true;
    host.send({ type: 'cancelJob', id: job.id });
  }

  const dot: Record<string, string> = {
    running: 'bg-[#1ec8f0] animate-pulse',
    queued: 'bg-[#ff9f1c]',
    submitting: 'bg-[#ff9f1c]',
    done: 'bg-[#3fbf57]',
    cancelled: 'bg-pink',
    failed: 'bg-red',
    lost: 'bg-red'
  };

  function detail(job: BatchJob): string {
    return [
      jobStatus(job),
      job.schedulerId ? `${job.scheduler} ${job.schedulerId}` : job.scheduler,
      job.tasks ? `${job.tasks} tasks` : '',
      job.resources?.queue ?? ''
    ]
      .filter(Boolean)
      .join(' · ');
  }
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }}
/>

{#if jobs.length}
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
      onclick={() => (open = !open)}
      onkeydown={(event) => event.key === 'Escape' && (open = false)}
    >
      <span class="codicon codicon-server-process"></span>
      <!-- Only the active ones count: those that ended are in the list. -->
      {active.length}
    </button>
    {#if open}
      <div
        role="dialog"
        aria-label="Batch jobs"
        tabindex="-1"
        class="card absolute bottom-full right-0 z-20 mb-2 flex max-h-96 w-80 max-w-[calc(100vw-2rem)] flex-col gap-0.5 overflow-y-auto p-1.5 text-[1.25em] text-ink"
        onkeydown={(event) => event.key === 'Escape' && (open = false)}
      >
        <div class="eyebrow px-2 pt-1 pb-1 text-violet">Batch jobs</div>
        {#each jobs as job (job.id)}
          {@const live = jobActive(job)}
          <div class="flex items-center gap-1 rounded-lg hover:bg-code">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border-none bg-transparent px-2 py-1.5 text-left"
              title="{job.command.join(' ')}\nOpen its output"
              aria-label="Open the output of {job.name}"
              onclick={() => openOutput(job)}
            >
              <span class="size-2 shrink-0 rounded-full {dot[job.state] ?? 'bg-muted'}" title={job.state}></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[0.9em]">{job.name} <span class="text-muted">{job.id}</span></span>
                <span class="block truncate text-[0.75em] text-muted">{detail(job)}</span>
              </span>
              <Elapsed started={epoch(job.started)} ended={live ? null : epoch(job.ended)} running={job.state === 'running'} />
            </button>
            {#if live}
              <button
                type="button"
                class="mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-red disabled:opacity-50"
                title="Cancel this job"
                aria-label="Cancel {job.name}"
                disabled={cancelling[job.id]}
                onclick={() => cancel(job)}
              >
                <span class="codicon codicon-close"></span>
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
