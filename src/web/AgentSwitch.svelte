<script lang="ts">
  // A sandbox's agents as a row of their logos and names, to choose the agent of
  // a new chat. One that cannot run here, or is not signed in yet, is greyed
  // out and says why.
  import AgentIcon from '../chat/lib/AgentIcon.svelte';
  import type { AgentState } from '../client/workerConnection.ts';
  import { agentPresentation, type AgentName } from '../protocol/messages.ts';
  import { canChat } from './lib/newChatAgent.ts';

  let { agents, selected, onselect }: { agents: AgentState[]; selected: AgentName | undefined; onselect: (agent: AgentName) => void } =
    $props();

  function describe(agent: AgentState): string {
    if (agent.unavailable) return `${agent.name}: ${agent.unavailable}`;
    return agent.signedIn ? agent.name : `${agent.name}: not signed in yet; sign in to it in Manage`;
  }
</script>

<div class="flex gap-0.5 rounded-lg bg-soft-line p-0.5" role="radiogroup" aria-label="Agent of the new chat">
  {#each agents as agent (agent.id)}
    {@const chosen = agent.id === selected}
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      aria-label={describe(agent)}
      title={describe(agent)}
      disabled={!canChat(agent)}
      class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[0.8em] leading-tight disabled:cursor-not-allowed disabled:opacity-30 {chosen
        ? 'bg-card font-semibold shadow-sm'
        : 'text-muted hover:text-current'}"
      onclick={() => onselect(agent.id)}
    >
      <span class="flex"><AgentIcon agent={agentPresentation(agent.id, agent)} size="1.5rem" /></span>
      <span class="max-w-full text-center">{agent.name}</span>
    </button>
  {/each}
</div>
