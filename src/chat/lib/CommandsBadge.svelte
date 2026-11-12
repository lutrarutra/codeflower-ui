<script lang="ts">
  import { commandTitle, runningCommands, type AgentCommand } from '../../protocol/commands.ts';
  import Elapsed from './Elapsed.svelte';
  import { chatHost } from './host.ts';
  import { epoch } from './time.ts';

  // In the footer: how many commands the chat's agent runs, and a list of
  // them and the last few that ended, each connecting to its output in a
  // read-only terminal (`openCommand`). A command the agent does not stream
  // shows its output in the chat when it ends.
  let { commands }: { commands: AgentCommand[] } = $props();
  const host = chatHost();

  const running = $derived(runningCommands(commands));
  // Running and waiting first, then those that ended, newest first.
  const current = $derived(commands.filter((command) => !command.endedAt));
  const ended = $derived(commands.filter((command) => command.endedAt).reverse());
  const label = $derived(`${running.length} command${running.length === 1 ? '' : 's'} running`);

  let open = $state(false);
  let root: HTMLElement | undefined = $state();

  function connect(command: AgentCommand): void {
    open = false;
    host.send({ type: 'openCommand', commandId: command.commandId });
  }

  function stateOf(command: AgentCommand): string {
    if (!command.endedAt) return command.waiting ? 'waiting for you' : command.background ? 'running in the background' : 'running';
    return command.exitCode === undefined ? 'ended' : command.exitCode === 0 ? 'done' : `exited ${command.exitCode}`;
  }

  // As the subagents' list shows theirs.
  const dot: Record<string, string> = {
    running: 'bg-[#1ec8f0] animate-pulse',
    'running in the background': 'bg-[#1ec8f0] animate-pulse',
    'waiting for you': 'bg-[#ff9f1c]',
    done: 'bg-[#3fbf57]',
    ended: 'bg-muted'
  };
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }}
/>

<!-- Only while one runs; centered on the footer's line as its other items are. -->
{#if running.length}
  <div class="relative flex items-center" bind:this={root}>
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-full border-none bg-transparent px-1 py-0 leading-none text-inherit hover:text-ink"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      title="{label}: watch their output"
      onclick={() => (open = !open)}
      onkeydown={(event) => event.key === 'Escape' && (open = false)}
    >
      <span class="codicon codicon-run-all"></span>
      {running.length}
    </button>
    {#if open}
      <div
        role="dialog"
        aria-label="Commands"
        tabindex="-1"
        class="card absolute bottom-full left-0 z-20 mb-2 flex max-h-96 w-80 flex-col gap-0.5 overflow-y-auto p-1.5 text-[1.25em] text-ink"
        onkeydown={(event) => event.key === 'Escape' && (open = false)}
      >
        <div class="eyebrow px-2 pt-1 pb-1 text-violet">Commands</div>
        {#each [...current, ...ended] as command (command.commandId)}
          {@const live = !command.endedAt}
          {@const status = stateOf(command)}
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg border-none bg-transparent px-2 py-1.5 text-left hover:bg-code disabled:cursor-default disabled:hover:bg-transparent"
            disabled={!command.streams}
            title={command.streams
              ? `Watch its output, read-only: ${command.command}`
              : `${command.command}\nThe agent shows its output in the chat when it ends.`}
            aria-label="{command.streams ? 'Connect to' : 'No live output of'} {commandTitle(command, 60)}"
            onclick={() => connect(command)}
          >
            <span class="size-2 shrink-0 rounded-full {status.startsWith('exited') ? 'bg-red' : (dot[status] ?? dot.ended)}" title={status}></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[0.9em]">{commandTitle(command, 120)}</span>
              <span class="block truncate text-[0.75em] text-muted">
                {[status, command.streams ? (live ? 'watch its output' : 'see its output') : 'output in the chat when it ends'].join(' · ')}
              </span>
            </span>
            <Elapsed started={epoch(command.startedAt)} ended={epoch(command.endedAt)} running={live && !command.waiting} />
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
