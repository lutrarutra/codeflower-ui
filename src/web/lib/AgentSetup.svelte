<script lang="ts">
  // The agent's sign-in and plugins in one sandbox: in its card under Server and in its overview.
  import type { Worker } from './api.ts';
  import { app } from './app.svelte.ts';
  import type { WebWorker } from './worker.svelte.ts';

  let { worker, agent, boxed = false }: { worker: Worker; agent: WebWorker; boxed?: boolean } = $props();
  const signedIn = $derived(agent.status?.signedIn);
  // A bridge older than plugins sends no capabilities; one whose agent has none sends `plugins: false`.
  const plugins = $derived(agent.status?.capabilities?.plugins);
  const olderBridge = $derived(!!agent.status && agent.status.capabilities === undefined);
  const row = $derived(boxed ? 'card flex flex-wrap items-center gap-3 p-4' : 'flex flex-wrap items-center gap-3');
  const heading = $derived(boxed ? 'm-0 flex items-center gap-2 font-display text-lg font-medium' : 'm-0 flex items-center gap-2 text-[0.95em] font-semibold');
  const text = $derived(boxed ? 'm-0 text-muted' : 'm-0 text-[0.85em] text-muted');
</script>

<section class={row}>
  <div class="min-w-0 flex-1">
    <h2 class={heading}>
      Agent sign-in
      {#if signedIn === true}
        <span class="tag bg-green-soft font-sans text-green">signed in</span>
      {:else if signedIn === false}
        <span class="tag bg-yellow-soft font-sans text-orange">not signed in</span>
      {/if}
    </h2>
    <p class={text}>The agent's login or keys stay in this sandbox's project. Sign in again to switch accounts.</p>
  </div>
  <button class="pill pill-small {signedIn === false ? 'pill-primary' : ''}" onclick={() => void app.signIn.start(agent)}>
    {signedIn ? 'Switch account…' : 'Sign in…'}
  </button>
</section>
{#if plugins}
  <section class={row}>
    <div class="min-w-0 flex-1">
      <h2 class={heading}>Plugins</h2>
      <p class={text}>The agent's own plugins in this project: browse its catalog, or add one from its source.</p>
    </div>
    <button class="pill pill-small" onclick={() => (app.plugins = { worker, agent })}>Plugins…</button>
  </section>
{:else if olderBridge}
  <p class={text}>This sandbox's image is too old for plugins. Stop it and start it again from an up-to-date app.</p>
{/if}
