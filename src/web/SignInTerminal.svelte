<script lang="ts">
  // The agent's sign-in command, running in a terminal inside the sandbox;
  // the user's keystrokes go there, its output comes here.
  import type { AuthMethod } from '@agentclientprotocol/sdk';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { Terminal } from '@xterm/xterm';
  import '@xterm/xterm/css/xterm.css';
  import { onMount } from 'svelte';
  import { app } from './lib/app.svelte.ts';
  import { isWebLink } from './lib/authMethods.ts';
  import type { WebWorker } from './lib/worker.svelte.ts';

  let { worker, method, onExit }: { worker: WebWorker; method: AuthMethod; onExit: (exitCode: number) => void } = $props();
  let element: HTMLDivElement;

  onMount(() => {
    const connection = worker.connection;
    const terminal = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#1e1e1e', foreground: '#e4e4e4' }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    // Sign-in commands print a page to open; a click opens it in a new tab.
    terminal.loadAddon(new WebLinksAddon((_event, uri) => isWebLink(uri) && window.open(uri, '_blank', 'noopener')));
    terminal.open(element);
    fit.fit();
    terminal.focus();
    terminal.write('Starting the sign-in inside the sandbox…\r\n');

    let terminalId: string | undefined;
    let finished = false;
    let detach = () => {};
    let unmounted = false;
    terminal.onData((data) => {
      if (terminalId && !finished) void connection?.terminalInput(terminalId, data).catch(() => undefined);
    });

    if (!connection) {
      terminal.write('\r\nThe sandbox is not connected.\r\n');
    } else {
      connection.startTerminal(method.id, terminal.cols, terminal.rows).then(
        (id) => {
          terminalId = id;
          if (unmounted) {
            void connection.closeTerminal(id).catch(() => undefined);
            return;
          }
          detach = app.signIn.attachTerminal(id, {
            output: (data) => terminal.write(data),
            exit: (exitCode) => {
              finished = true;
              terminal.write(`\r\n\r\n${exitCode === 0 ? 'Signed in.' : `The sign-in ended with code ${exitCode}.`}\r\n`);
              onExit(exitCode);
            }
          });
        },
        (error: unknown) => {
          finished = true;
          terminal.write(`\r\nCould not start the sign-in: ${error instanceof Error ? error.message : error}\r\n`);
        }
      );
    }

    return () => {
      unmounted = true;
      detach();
      if (terminalId && !finished) void connection?.closeTerminal(terminalId).catch(() => undefined);
      terminal.dispose();
    };
  });
</script>

<div bind:this={element} class="h-[22rem] w-full overflow-hidden rounded-lg bg-[#1e1e1e] p-2"></div>
