<script lang="ts">
  import { arrayIndices, jobActive, jobOutput, jobStatus, taskCounts, taskSummary, type BatchJob, type BatchJobState } from '../../protocol/jobs.ts';
  import Elapsed from './Elapsed.svelte';
  import { chatHost } from './host.ts';
  import { epoch } from './time.ts';

  // In the footer: how many of the batch jobs this chat asked for are queued
  // or running (codeflower-job), and a list of them and those that ended in
  // the last day, each opening its output (an array's tasks each their own,
  // from the list of its tasks); active ones can be cancelled.
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
  // Arrays whose tasks the list shows.
  let expanded = $state<Record<string, boolean>>({});

  function openOutput(job: BatchJob, index?: number): void {
    open = false;
    host.send({ type: 'openFile', path: jobOutput(job, index) });
  }

  // The job whose cancel the user is asked to confirm: a cancel cannot be undone, and a long job
  // starts over at the back of the queue.
  let confirming = $state<string | null>(null);

  function cancel(job: BatchJob): void {
    confirming = null;
    cancelling[job.id] = true;
    host.send({ type: 'cancelJob', id: job.id });
  }

  /** What cancelling stops, for the question. */
  function cancelWarning(job: BatchJob): string {
    const where = job.schedulerId ? ` (${job.scheduler} ${job.schedulerId})` : '';
    const counts = taskCounts(job);
    if (job.tasks && counts) {
      const unfinished = (counts.running ?? 0) + (counts.queued ?? 0) + (counts.submitting ?? 0);
      const ended = job.tasks - unfinished;
      return `Cancel ${job.name}${where}? Its ${unfinished} unfinished task${unfinished === 1 ? '' : 's'} stop${unfinished === 1 ? 's' : ''}${ended ? `; the ${ended} that ended keep their results` : ''}. This cannot be undone.`;
    }
    if (job.tasks) return `Cancel ${job.name}${where}? Its tasks that have not ended stop. This cannot be undone.`;
    return job.state === 'running'
      ? `Cancel ${job.name}${where}? It stops now; its output so far stays. This cannot be undone.`
      : `Cancel ${job.name}${where}? It leaves the queue. This cannot be undone.`;
  }

  /** Focuses the safe answer when the question shows, so Enter keeps the job. */
  function focusOnShow(node: HTMLElement): void {
    node.focus();
  }

  /** Escape takes back the question first, then closes the list. */
  function escape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (confirming) {
      event.stopPropagation();
      confirming = null;
    } else open = false;
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

  // An array's tasks by state, in the colors of the dots: the bar under its line and its tasks' buttons.
  const TASK_ORDER: BatchJobState[] = ['done', 'failed', 'lost', 'cancelled', 'running', 'queued', 'submitting'];
  const bar: Record<string, string> = {
    running: 'bg-[#1ec8f0]',
    queued: 'bg-[#ff9f1c]',
    submitting: 'bg-[#ff9f1c]',
    done: 'bg-[#3fbf57]',
    cancelled: 'bg-pink',
    failed: 'bg-red',
    lost: 'bg-red'
  };
  const taskTone: Record<string, string> = {
    running: 'border-[#1ec8f0] bg-[#1ec8f0]/25 text-ink',
    queued: 'border-[#ff9f1c]/70 bg-transparent text-muted',
    submitting: 'border-[#ff9f1c]/70 bg-transparent text-muted',
    done: 'border-[#3fbf57] bg-[#3fbf57]/25 text-ink',
    cancelled: 'border-pink bg-pink/20 text-ink',
    failed: 'border-red bg-red/30 text-ink font-semibold',
    lost: 'border-red bg-red/30 text-ink font-semibold'
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
    // By the click's path, not its target: a button the click removed (the question's) is no longer in the list.
    if (open && root && !event.composedPath().includes(root)) open = false;
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
      onclick={() => {
        open = !open;
        confirming = null;
      }}
      onkeydown={escape}
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
        onkeydown={escape}
      >
        <div class="eyebrow px-2 pt-1 pb-1 text-violet">Batch jobs</div>
        {#each jobs as job (job.id)}
          {@const live = jobActive(job)}
          {@const tasks = job.tasks ? arrayIndices(job.array) : []}
          {@const counts = taskCounts(job)}
          <div class="flex items-center gap-1 rounded-lg hover:bg-code">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border-none bg-transparent px-2 py-1.5 text-left"
              title="{job.command.join(' ')}\nOpen {tasks.length ? `the output of task ${tasks[0]}` : 'its output'}"
              aria-label="Open the output of {job.name}{tasks.length ? `, task ${tasks[0]}` : ''}"
              onclick={() => openOutput(job)}
            >
              <span class="size-2 shrink-0 rounded-full {dot[job.state] ?? 'bg-muted'}" title={job.state}></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[0.9em]">{job.name} <span class="text-muted">{job.id}</span></span>
                <span class="block truncate text-[0.75em] text-muted">{detail(job)}</span>
                {#if counts && tasks.length}
                  <!-- How far the array is, at a glance: its tasks by state. -->
                  <span class="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-code" title={taskSummary(job)}>
                    {#each TASK_ORDER as state (state)}
                      {#if counts[state]}
                        <span class={bar[state]} style:width="{(counts[state]! / tasks.length) * 100}%"></span>
                      {/if}
                    {/each}
                  </span>
                {/if}
              </span>
              <Elapsed started={epoch(job.started)} ended={live ? null : epoch(job.ended)} running={job.state === 'running'} />
            </button>
            {#if tasks.length > 1}
              <button
                type="button"
                class="inline-flex size-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-ink"
                title="{expanded[job.id] ? 'Hide' : 'Show'} its {tasks.length} tasks, to open each one's output"
                aria-label="{expanded[job.id] ? 'Hide' : 'Show'} the tasks of {job.name}"
                aria-expanded={!!expanded[job.id]}
                onclick={() => (expanded[job.id] = !expanded[job.id])}
              >
                <span class="codicon codicon-chevron-{expanded[job.id] ? 'up' : 'down'}"></span>
              </button>
            {/if}
            {#if live}
              <button
                type="button"
                class="mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-red disabled:opacity-50"
                title="Cancel this job…"
                aria-label="Cancel {job.name}…"
                aria-expanded={confirming === job.id}
                disabled={cancelling[job.id]}
                onclick={() => (confirming = confirming === job.id ? null : job.id)}
              >
                <span class="codicon codicon-{cancelling[job.id] ? 'loading codicon-modifier-spin' : 'close'}"></span>
              </button>
            {/if}
          </div>
          {#if confirming === job.id && live && !cancelling[job.id]}
            <!-- Cancelling cannot be undone: asked in the list itself, as webviews have no confirm(). -->
            <div
              role="alertdialog"
              aria-label="Cancel {job.name}?"
              class="mx-1 mb-1 flex flex-col gap-2 rounded-lg border-[1.5px] border-red/40 bg-pink-soft px-2.5 py-2 text-[0.85em]"
            >
              <span class="flex items-start gap-1.5">
                <span class="codicon codicon-warning mt-[2px] shrink-0 text-red"></span>
                <span>{cancelWarning(job)}</span>
              </span>
              <span class="flex justify-end gap-1.5">
                <button type="button" class="chip" use:focusOnShow onclick={() => (confirming = null)}>Keep it</button>
                <button
                  type="button"
                  class="chip border-red! bg-red! font-semibold text-white!"
                  onclick={() => cancel(job)}
                >
                  <span class="codicon codicon-close"></span> Cancel {job.tasks ? 'the array' : 'the job'}
                </button>
              </span>
            </div>
          {/if}
          {#if expanded[job.id] && tasks.length > 1}
            <!-- An array's tasks in the colors of their states, each opening its own output (output-INDEX.log). -->
            {#if counts}
              <div class="mb-1 ml-6 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.75em] text-muted">
                {#each TASK_ORDER as state (state)}
                  {#if counts[state]}
                    <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full {bar[state]}"></span>{counts[state]} {state}</span>
                  {/if}
                {/each}
              </div>
            {/if}
            <div class="mb-1 ml-6 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1" role="group" aria-label="Tasks of {job.name}">
              {#each tasks as index (index)}
                {@const state = job.taskStates?.[index]}
                <button
                  type="button"
                  class="min-w-[2.6em] rounded-md border-[1.5px] px-1.5 py-0.5 text-center font-mono text-[0.75em] hover:brightness-110 {state
                    ? taskTone[state]
                    : 'border-soft-line bg-transparent text-muted hover:border-line hover:bg-code hover:text-ink'}"
                  title="Task {index}{state ? `: ${state}` : ''}. Open its output"
                  aria-label="Open the output of task {index} of {job.name}{state ? `, ${state}` : ''}"
                  onclick={() => openOutput(job, index)}
                >
                  {index}
                </button>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}
