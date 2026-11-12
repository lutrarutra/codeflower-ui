<script lang="ts">
  // The user's shell in a sandbox, in a tab. The shell runs in the sandbox
  // and outlives the tab's window: the tab attaches to it (again after a lost
  // connection or a reload), gets what it printed so far, and detaches when
  // it goes. Closing the tab ends the shell (see app.svelte.ts).
  // With `command`, a command the agent runs, watched read-only: nothing is
  // typed into it, and closing the tab only stops watching it.
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { Terminal } from '@xterm/xterm';
  import '@xterm/xterm/css/xterm.css';
  import { onMount, untrack } from 'svelte';
  import type { WorkerConnection } from '../client/workerConnection.ts';
  import { app } from './lib/app.svelte.ts';
  import { isWebLink } from './lib/authMethods.ts';

  let {
    workerId,
    terminalId,
    command = false,
    title
  }: { workerId: string; terminalId: string; command?: boolean; title?: string } = $props();
  const what = $derived(command ? 'command' : 'shell');
  const agent = $derived(app.agent(workerId));
  const worker = $derived(app.worker(workerId));
  let element: HTMLDivElement;
  let terminal: Terminal | undefined = $state();
  let fit: FitAddon | undefined;
  /** The connection the shell is shown over; another one attaches again. */
  let attachedTo: WorkerConnection | undefined;
  let ended = $state(false);

  // Its sandbox connects for it, e.g. after a reload, unless another window has it.
  $effect(() => {
    if (agent.state === 'idle' && worker?.status === 'ready' && !app.elsewhere(worker)) untrack(() => void agent.connect().catch(() => undefined));
  });

  // Attached on each connection: the shell prints what came before (replayed), which replaces what the tab shows.
  $effect(() => {
    if (!terminal || !agent.connected || ended) return;
    const connection = agent.connection!;
    if (connection === attachedTo) return;
    attachedTo = connection;
    const { cols, rows } = terminal;
    connection.attachTerminal(terminalId, cols, rows).catch((error: unknown) => {
      if (attachedTo !== connection) return;
      attachedTo = undefined;
      terminal?.write(`\r\n\x1b[2mThe terminal cannot be shown: ${error instanceof Error ? error.message : error}\x1b[0m\r\n`);
    });
  });

  onMount(() => {
    const shell = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: !command,
      // A command's output has bare line feeds; it reads nothing typed.
      convertEol: command,
      disableStdin: command,
      scrollback: command ? 10000 : 5000,
      // A command's tab has no cursor: nothing is typed there.
      theme: { background: '#1e1e1e', foreground: '#e4e4e4', ...(command ? { cursor: '#1e1e1e', cursorAccent: '#1e1e1e' } : {}) }
    });
    fit = new FitAddon();
    shell.loadAddon(fit);
    // A link the shell prints opens in a new tab when clicked.
    shell.loadAddon(new WebLinksAddon((_event, uri) => isWebLink(uri) && window.open(uri, '_blank', 'noopener')));
    shell.open(element);
    fit.fit();

    const unregister = app.terminals.attach(terminalId, {
      output: (data, replayed) => {
        if (replayed) shell.reset();
        shell.write(data);
      },
      exit: (exitCode) => {
        ended = true;
        shell.write(`\r\n\x1b[2mThe ${what} ended${exitCode ? ` with code ${exitCode}` : ''}.\x1b[0m\r\n`);
      }
    });
    shell.onData((data) => {
      if (!command && !ended && attachedTo?.connected) void attachedTo.terminalInput(terminalId, data).catch(() => undefined);
    });
    shell.onResize(({ cols, rows }) => {
      if (!command && !ended && attachedTo?.connected) void attachedTo.resizeTerminal(terminalId, cols, rows).catch(() => undefined);
    });
    // The tab's group changes size, or the tab is shown: it has no size while its group has none.
    const observer = new ResizeObserver(() => {
      if (element.clientWidth && element.clientHeight) fit?.fit();
    });
    observer.observe(element);
    terminal = shell;
    if (!command) shell.focus();

    return () => {
      observer.disconnect();
      unregister();
      // Its window goes; the shell runs on (closing the tab itself ends it).
      if (!ended && attachedTo?.connected) void attachedTo.detachTerminal(terminalId).catch(() => undefined);
      attachedTo = undefined;
      shell.dispose();
    };
  });
</script>

<div class="flex h-full flex-col bg-[#1e1e1e]">
  {#if command}
    <p class="m-0 flex min-w-0 items-center gap-1.5 px-3 py-1.5 text-[0.85em] text-[#b0b0b0]" role="status">
      <span class="codicon codicon-eye shrink-0 text-[12px]!"></span>
      <span class="shrink-0">{ended ? 'Ended' : 'Watching'} (read-only):</span>
      <span class="min-w-0 truncate font-mono text-[#e4e4e4]" title={title}>{title ?? 'a command'}</span>
    </p>
  {/if}
  {#if !agent.connected && !ended}
    <p class="m-0 px-3 py-1.5 text-[0.85em] text-[#b0b0b0]" role="status">
      {agent.state === 'connecting' ? 'Connecting to the sandbox…' : `Not connected to the sandbox: the ${what} runs on there.`}
    </p>
  {/if}
  <div bind:this={element} class="min-h-0 flex-1 overflow-hidden p-2"></div>
</div>
