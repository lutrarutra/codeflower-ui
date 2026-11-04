<script lang="ts">
  // A sandbox's agents as a row of their logos, to choose the agent of a new
  // chat. One that cannot run here is greyed out and says why; one not signed
  // in yet has a mark, and choosing it for a chat signs it in first.
  import AgentIcon from '../chat/lib/AgentIcon.svelte';
  import type { AgentState } from '../client/workerConnection.ts';
  import { agentPresentation, type AgentName } from '../protocol/messages.ts';

  let { agents, selected, onselect }: { agents: AgentState[]; selected: AgentName | undefined; onselect: (agent: AgentName) => void } =
    $props();

  function describe(agent: AgentState): string {
    if (agent.unavailable) return `${agent.name}: ${agent.unavailable}`;
    return agent.signedIn ? agent.name : `${agent.name}: not signed in yet`;
  }
</script>

<div class="flex items-center gap-0.5 rounded-lg bg-soft-line p-0.5" role="radiogroup" aria-label="Agent of a new chat">
  {#each agents as agent (agent.id)}
    {@const chosen = agent.id === selected}
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      aria-label={describe(agent)}
      title={describe(agent)}
      disabled={!!agent.unavailable}
      class="relative grid min-h-7 flex-1 place-items-center rounded-md py-1 pointer-coarse:min-h-9 disabled:cursor-not-allowed disabled:opacity-30 {chosen
        ? 'bg-card shadow-sm'
        : 'opacity-60 hover:opacity-100'}"
      onclick={() => onselect(agent.id)}
    >
      <AgentIcon agent={agentPresentation(agent.id, agent)} size="1.15em" />
      {#if !agent.signedIn && !agent.unavailable}
        <span class="absolute top-1 right-[calc(50%-0.85em)] size-1.5 rounded-full bg-orange" aria-hidden="true"></span>
      {/if}
    </button>
  {/each}
</div>
