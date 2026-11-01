<script lang="ts">
  // Quitting: chats working in the sandboxes started here are asked to save
  // their work first; sandboxes running elsewhere keep running.
  import type { QuitPlan } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import { plural } from './lib/format.ts';

  let dialog: HTMLDialogElement | undefined = $state();
  let plan = $state<QuitPlan | null>(null);

  async function ask(): Promise<void> {
    let current: QuitPlan;
    try {
      current = await app.head.api<QuitPlan>('/api/quit');
    } catch {
      return;
    }
    if (current.stopping || current.quitting) return app.setQuit(current);
    if (!current.working) {
      const question = app.single
        ? 'Stop this sandbox? Its agent stops, and so does the job that runs it.'
        : `Stop ${plural(current.sandboxes, 'running sandbox', 'running sandboxes')} and quit the app?`;
      if (current.sandboxes && !confirm(question)) return;
      return quit(true);
    }
    plan = current;
    dialog?.showModal();
  }

  async function quit(wrapUp: boolean): Promise<void> {
    dialog?.close();
    app.setQuit(await app.head.api<QuitPlan>('/api/quit', { body: { wrapUp } }).catch(() => ({ stopping: true }) as QuitPlan));
  }

  app.askToQuit = () => void ask();

  // The tray opens the page with ?quit=1 to ask before quitting.
  if (new URLSearchParams(location.search).has('quit')) {
    history.replaceState(null, '', location.pathname + location.hash);
    void ask();
  }

  const them = $derived(plan?.working === 1 ? 'it' : 'them');
</script>

<dialog bind:this={dialog} aria-labelledby="quit-title">
  <div class="card flex flex-col gap-3 p-5">
    <h2 id="quit-title" class="m-0 font-display text-lg font-medium">{app.single ? 'Stop the sandbox?' : 'Quit code flower?'}</h2>
    {#if plan}
      <p class="m-0">
        {plural(plan.working, 'chat')} in {plural(plan.busy, 'sandbox', 'sandboxes')} started here {plan.working === 1 ? 'is' : 'are'} working.
        <strong>Wrap up and quit</strong> stops {them} and asks {them} to save results, update the report and write down how to continue; each
        sandbox stops when its chats are done, at most after {plan.minutes} minutes. <strong>Quit now</strong> stops the sandboxes at once, and unsaved
        work is lost.
      </p>
      {#if plan.elsewhere}
        <p class="m-0 text-[0.9em] text-muted">
          {plural(plan.elsewhere, 'sandbox', 'sandboxes')} running elsewhere {plan.elsewhere === 1 ? 'keeps' : 'keep'} running.
        </p>
      {/if}
    {/if}
    <footer class="flex flex-wrap justify-end gap-2">
      <button class="pill" onclick={() => dialog?.close()}>Keep running</button>
      <button class="pill pill-pink" onclick={() => quit(false)}>Quit now</button>
      <!-- svelte-ignore a11y_autofocus -->
      <button class="pill pill-primary" autofocus onclick={() => quit(true)}>Wrap up and quit</button>
    </footer>
  </div>
</dialog>
