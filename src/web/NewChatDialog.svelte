<script lang="ts">
  // A new chat in a sandbox: which of its agents, and a title if the user wants
  // one; else the chat is named after its first prompt, as always.
  import AgentSwitch from './AgentSwitch.svelte';
  import Skeleton from '../chat/lib/Skeleton.svelte';
  import { app } from './lib/app.svelte.ts';
  import { newChatAgent, rememberAgent } from './lib/newChatAgent.ts';
  import { plural } from './lib/format.ts';
  import type { AgentName } from '../protocol/messages.ts';

  /** `onstarted` shows the new chat; `onNavigate` follows whatever the dialog showed. */
  let { onstarted, onNavigate }: { onstarted: (workerId: string, key: string) => void; onNavigate: () => void } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let workerId = $state<string | undefined>();
  /** The agent the user chose here; else the one remembered for the project. */
  let chosen = $state<AgentName | undefined>();
  let title = $state('');
  let creating = $state(false);
  let error = $state('');

  const sandbox = $derived(workerId ? app.agent(workerId) : undefined);
  const project = $derived((workerId && app.workers.find((worker) => worker.id === workerId)?.project) || workerId || '');
  const choice = $derived(sandbox ? newChatAgent(sandbox.agents, project, chosen) : undefined);
  /** The agents that could chat once signed in. */
  const signedOut = $derived(sandbox?.agents.filter((agent) => !agent.unavailable && !agent.signedIn) ?? []);

  /** Asks for a new chat in the sandbox. */
  export function open(id: string): void {
    workerId = id;
    chosen = undefined;
    title = '';
    error = '';
    // Connecting tells the sandbox's agents; it starts none.
    void app.agent(id).connect().catch((failure) => (error = failure instanceof Error ? failure.message : String(failure)));
    dialog?.showModal();
  }

  async function start(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = choice;
    const current = sandbox;
    const id = workerId;
    if (!name || !current || !id) return;
    rememberAgent(project, name);
    creating = true;
    error = '';
    try {
      const key = await current.newChat(name);
      // Undefined when the agent turned out not to be signed in: its sign-in opens instead.
      if (key) {
        const named = title.trim();
        // The chat started anyway; without its title it is named after its first prompt.
        if (named) await current.rename(key, named).catch(() => undefined);
        onstarted(id, key);
      }
      dialog?.close();
      onNavigate();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      creating = false;
    }
  }

  /** The sandbox's Manage tab, where its agents sign in. */
  function manage(): void {
    if (!workerId) return;
    dialog?.close();
    app.go({ view: 'chat', worker: workerId });
    app.workbench.openOverview(workerId);
    onNavigate();
  }
</script>

<dialog bind:this={dialog} aria-labelledby="new-chat-title">
  <form class="card flex flex-col gap-4 p-5" onsubmit={start} autocomplete="off">
    <h2 id="new-chat-title" class="m-0 font-display text-lg font-medium">New chat</h2>
    <div class="flex flex-col gap-1.5">
      <span class="text-[0.9em] text-muted">Agent</span>
      {#if sandbox?.agents.length}
        <AgentSwitch agents={sandbox.agents} selected={choice} onselect={(name) => (chosen = name)} />
        {#if signedOut.length}
          <p class="m-0 text-[0.85em] text-muted">
            {plural(signedOut.length, 'agent is', 'agents are')} not signed in yet ({signedOut.map((agent) => agent.name).join(', ')}).
            To chat with {signedOut.length === 1 ? 'it' : 'them'}, sign {signedOut.length === 1 ? 'it' : 'them'} in from
            <button type="button" class="cursor-pointer border-0 bg-transparent p-0 font-semibold text-indigo underline" onclick={manage}>Manage</button>.
          </p>
        {/if}
        {#if !choice}<p class="m-0 text-[0.85em] text-red">No agent of this sandbox can start a chat yet.</p>{/if}
      {:else}
        <Skeleton lines={['100%']} height="3.25rem" />
      {/if}
    </div>
    <label class="flex flex-col gap-1.5">
      <span class="text-[0.9em] text-muted">Title (optional)</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="field" bind:value={title} placeholder="Leave empty for auto generated title" maxlength="200" spellcheck="false" autofocus />
    </label>
    {#if error}<p class="m-0 text-[0.9em] text-red">{error}</p>{/if}
    <footer class="flex justify-end gap-2">
      <button type="button" class="pill" onclick={() => dialog?.close()}>Cancel</button>
      <button type="submit" class="pill pill-primary" disabled={creating || !choice}>
        {creating ? 'Starting…' : 'Start chat'}
      </button>
    </footer>
  </form>
</dialog>
