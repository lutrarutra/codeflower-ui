<script lang="ts">
  import { agentPresentation } from '../../protocol/messages.ts';
  import type { Orchestrator } from '../../protocol/orchestrators.ts';
  import { chatHost } from './host.ts';
  import OrchestratorAccess from './OrchestratorAccess.svelte';

  // In the footer of a chat that orchestrators direct: how many, pulsing while
  // one waits on this chat or it on one; a list of them, each opening its
  // chat, with what it may do and a way to end its link.
  let { orchestrators }: { orchestrators: Orchestrator[] } = $props();
  const host = chatHost();

  const connected = $derived(orchestrators.filter((orchestrator) => !orchestrator.disconnected));
  const active = $derived(connected.some((orchestrator) => orchestrator.state !== 'idle'));
  const label = $derived(`${connected.length} orchestrator${connected.length === 1 ? '' : 's'} direct${connected.length === 1 ? 's' : ''} this chat`);
  const stateText: Record<Orchestrator['state'], string> = {
    idle: 'idle',
    asking: 'this chat works on its message',
    waiting: 'this chat waits for its answer'
  };

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let confirming = $state<string | null>(null);

  function escape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (confirming) {
      event.stopPropagation();
      confirming = null;
    } else open = false;
  }
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !event.composedPath().includes(root)) open = false;
  }}
/>

{#if orchestrators.length}
  <div class="flex items-center" bind:this={root}>
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-full border-none bg-transparent px-1 py-0 leading-none text-inherit hover:text-ink {connected.length
        ? 'font-semibold text-violet'
        : ''}"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      title="{label}: it may not see the data, only what this chat sends it"
      onclick={() => {
        open = !open;
        confirming = null;
      }}
      onkeydown={escape}
    >
      <span class="codicon codicon-compass {active ? 'animate-pulse' : ''}"></span>
      {connected.length}
    </button>
    {#if open}
      <div
        role="dialog"
        aria-label="Orchestrators"
        tabindex="-1"
        class="card absolute right-0 bottom-full z-20 mb-2 flex max-h-[28rem] w-96 max-w-[calc(100vw-2rem)] flex-col gap-1 overflow-y-auto p-1.5 text-[1.25em] text-ink"
        onkeydown={escape}
      >
        <div class="eyebrow px-2 pt-1 text-violet">Orchestrators</div>
        <p class="px-2 pb-1 text-[0.8em] text-muted">
          A hosted model that directs this chat. It sees only what this chat sends it, which is marked here.
        </p>
        {#each orchestrators as orchestrator (orchestrator.key)}
          {@const agent = agentPresentation(orchestrator.agent)}
          <div class="flex flex-col gap-1.5 rounded-lg px-2 py-1.5 hover:bg-code">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="size-2 shrink-0 rounded-full {orchestrator.disconnected ? 'bg-muted' : orchestrator.state === 'idle' ? 'bg-[#3fbf57]' : 'animate-pulse bg-[#1ec8f0]'}"
              ></span>
              <button
                type="button"
                class="link min-w-0 flex-1 truncate text-left text-[0.9em]"
                title="Open the orchestrator's chat"
                onclick={() => {
                  open = false;
                  host.send({ type: 'openChat', key: orchestrator.key });
                }}>{orchestrator.title}</button
              >
              <span class="shrink-0 text-[0.75em]" style:color={agent?.color}>{agent?.name ?? orchestrator.agent}</span>
            </div>
            <span class="pl-4 text-[0.75em] text-muted">
              {orchestrator.disconnected ? 'disconnected' : stateText[orchestrator.state]} · {orchestrator.sent} sent to it
            </span>
            {#if !orchestrator.disconnected}
              <div class="pl-4"><OrchestratorAccess {orchestrator} /></div>
              {#if confirming === orchestrator.key}
                <div role="alertdialog" class="flex flex-col gap-2 rounded-lg border-[1.5px] border-red/40 bg-pink-soft px-2.5 py-2 text-[0.85em]">
                  <span>Disconnect it? It can no longer reach this chat; its own chat stays, read-only.</span>
                  <span class="flex justify-end gap-1.5">
                    <button type="button" class="chip" onclick={() => (confirming = null)}>Keep it</button>
                    <button
                      type="button"
                      class="chip border-red! bg-red! font-semibold text-white!"
                      onclick={() => {
                        confirming = null;
                        host.send({ type: 'disconnectOrchestrator', key: orchestrator.key });
                      }}>Disconnect</button
                    >
                  </span>
                </div>
              {:else}
                <button type="button" class="link self-end text-[0.75em] text-muted hover:text-red" onclick={() => (confirming = orchestrator.key)}
                  >Disconnect…</button
                >
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
