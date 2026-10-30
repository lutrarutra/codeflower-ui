<script lang="ts">
  import { api, type QuitPlan } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import { plural } from './lib/format.ts';

  const quitting = $derived(app.quit?.quitting);
  const states = $derived(Object.values(quitting?.workers ?? {}));
  const waiting = $derived(states.filter((value) => value === 'asked').length);
  const deadline = $derived(quitting ? new Date(quitting.deadline) : new Date());
  const minutes = $derived(Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 60_000)));

  async function keep(): Promise<void> {
    try {
      app.setQuit(await api<QuitPlan>('/api/quit', { method: 'DELETE', body: {} }));
    } catch {
      app.stopped = true;
    }
  }

  async function stop(): Promise<void> {
    app.setQuit(await api<QuitPlan>('/api/quit', { body: { wrapUp: false } }).catch(() => ({ stopping: true }) as QuitPlan));
  }
</script>

<section class="flex flex-wrap items-center gap-3 border-b-[1.5px] border-orange bg-yellow-soft px-4 py-3" role="status">
  <div class="min-w-0 flex-1">
    <strong>Wrapping up before quitting.</strong>
    The working chats were asked to save their work. Waiting for {plural(waiting, 'sandbox', 'sandboxes')} of {states.length}; the app stops every sandbox
    it started and quits when they are done, or at {deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (in {plural(minutes, 'minute')}).
  </div>
  <button class="pill pill-small" onclick={keep} title="Calls the quit off; chats already asked finish their wrap-up">Keep running</button>
  <button class="pill pill-small pill-pink" onclick={stop}>Stop now</button>
</section>
