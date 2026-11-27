<script lang="ts">
  import type { AccessLevel, Orchestrator, OrchestratorAccess } from '../../protocol/orchestrators.ts';
  import { chatHost } from './host.ts';

  // What an orchestrator may do beside talking to its executor, which the user
  // changes here (in the orchestrator's chat, and in its executor's badge).
  let { orchestrator, disabled = false }: { orchestrator: Pick<Orchestrator, 'key' | 'access'>; disabled?: boolean } = $props();
  const host = chatHost();

  const set = (access: Partial<OrchestratorAccess>) => host.send({ type: 'setOrchestratorAccess', key: orchestrator.key, access });
  const levels: { value: AccessLevel; label: string }[] = [
    { value: 'never', label: 'Never' },
    { value: 'ask', label: 'Shared' },
    { value: 'always', label: 'All' }
  ];
  const switches: { name: 'web' | 'files' | 'code' | 'roots' | 'approve'; label: string; hint: string }[] = [
    { name: 'web', label: 'Web', hint: 'Search the web and read pages; applies when its chat starts again' },
    { name: 'files', label: 'File names', hint: 'List the folders the executor works in: names and sizes, never contents' },
    { name: 'code', label: 'Code', hint: 'Read the scripts the executor wrote in its steps, to check them' },
    { name: 'roots', label: 'Roots', hint: "Keep the project's map of ideas: the plan, its todos and the decisions made" },
    { name: 'approve', label: 'Ask me first', hint: 'You allow each reply and question before it goes to the orchestrator' }
  ];
</script>

<div class="flex flex-col gap-1.5 text-[0.85em]">
  <div class="flex flex-wrap gap-1.5">
    {#each switches as option (option.name)}
      <button
        type="button"
        class="chip {orchestrator.access[option.name] ? 'border-indigo! text-ink' : 'text-muted'}"
        title={option.hint}
        aria-pressed={orchestrator.access[option.name]}
        {disabled}
        onclick={() => set({ [option.name]: !orchestrator.access[option.name] })}
      >
        <span class="codicon codicon-{orchestrator.access[option.name] ? 'pass-filled' : 'circle-large-outline'}"></span>
        {option.label}
      </button>
    {/each}
  </div>
  {#each [{ name: 'figures', label: 'Figures' }, { name: 'report', label: 'Reports' }] as const as row (row.name)}
    <div class="flex items-center gap-1.5" role="radiogroup" aria-label="{row.label} it may see">
      <span class="w-16 shrink-0 text-muted" title="Never; only those you share; or every one the executor's chat showed">{row.label}</span>
      {#each levels as level (level.value)}
        <button
          type="button"
          role="radio"
          aria-checked={orchestrator.access[row.name] === level.value}
          class="chip {orchestrator.access[row.name] === level.value ? 'border-indigo! font-semibold text-ink' : 'text-muted'}"
          {disabled}
          onclick={() => set({ [row.name]: level.value })}>{level.label}</button
        >
      {/each}
    </div>
  {/each}
</div>
