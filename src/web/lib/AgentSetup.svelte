<script lang="ts">
  // The sandbox's agents, in its card under Server and in its overview: each one's sign-in, usage
  // and plugins. Logins and keys stay in the sandbox's project; asking about them starts no agent.
  import AgentIcon from '../../chat/lib/AgentIcon.svelte';
  import type { AgentState } from '../../client/workerConnection.ts';
  import { agentPresentation } from '../../protocol/messages.ts';
  import type { Worker } from './api.ts';
  import { app } from './app.svelte.ts';
  import UsageChips from './UsageChips.svelte';
  import type { WebWorker } from './worker.svelte.ts';

  let { worker, agent, boxed = false }: { worker: Worker; agent: WebWorker; boxed?: boolean } = $props();
  const heading = $derived(boxed ? 'm-0 font-display text-lg font-medium' : 'm-0 text-[0.95em] font-semibold');
  const text = $derived(boxed ? 'm-0 text-muted' : 'm-0 text-[0.85em] text-muted');
  let restarting = $state<string | null>(null);
  let error = $state('');

  /** What the sign-in button does for the agent: keys code flower keeps (dsh's) are edited in place, a login switched. */
  function signInText(state: AgentState): string {
    if (!state.signedIn) return 'Sign in…';
    return state.credentials === 'keys' ? 'Edit keys and models…' : 'Switch account…';
  }

  async function restart(state: AgentState): Promise<void> {
    restarting = state.id;
    error = '';
    try {
      await agent.restartAgent(state.id);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      restarting = null;
    }
  }
</script>

<section class={boxed ? 'card flex flex-col gap-3 p-4' : 'flex flex-col gap-2'}>
  <div>
    <h2 class={heading}>Agents</h2>
    <p class={text}>Every agent runs in this sandbox; each chat is one agent's. Their logins and keys stay in the project.</p>
  </div>
  {#if !agent.agents.length}
    <p class={text}>{agent.state === 'connecting' ? 'Connecting…' : 'The agents show once the sandbox is connected.'}</p>
  {/if}
  <ul class="m-0 flex list-none flex-col gap-2 p-0">
    {#each agent.agents as state (state.id)}
      {@const usage = worker.activity?.agents?.find((candidate) => candidate.id === state.id)?.usage}
      <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label={state.name}>
        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <AgentIcon agent={agentPresentation(state.id, state)} size="1.25em" />
          <span class="font-semibold">{state.name}</span>
          {#if state.unavailable}
            <span class="tag bg-soft-line font-sans text-muted" title={state.unavailable}>can't run here</span>
          {:else if state.signedIn}
            <span class="tag bg-green-soft font-sans text-green">signed in</span>
          {:else}
            <span class="tag bg-yellow-soft font-sans text-orange">not signed in</span>
          {/if}
          {#if state.restartPending}
            <span class="tag bg-yellow-soft font-sans text-orange" title="It takes the new keys or settings when it starts again">restart to apply</span>
          {/if}
          <UsageChips {usage} />
        </span>
        {#if state.unavailable}
          <span class="w-full text-[0.85em] text-muted">{state.unavailable}</span>
        {:else}
          <span class="flex flex-wrap gap-1.5">
            {#if state.restartPending}
              <button class="pill pill-small pill-primary" disabled={restarting === state.id} onclick={() => void restart(state)}>
                {restarting === state.id ? 'Restarting…' : 'Restart'}
              </button>
            {/if}
            {#if state.capabilities.plugins}
              <button class="pill pill-small" onclick={() => (app.plugins = { worker, agent, name: state.id })}>Plugins…</button>
            {/if}
            <button class="pill pill-small {state.signedIn ? '' : 'pill-primary'}" onclick={() => void app.signIn.start(agent, state.id)}>
              {signInText(state)}
            </button>
          </span>
        {/if}
      </li>
    {/each}
  </ul>
  {#if error}<p class="m-0 text-[0.85em] text-red">{error}</p>{/if}
</section>
