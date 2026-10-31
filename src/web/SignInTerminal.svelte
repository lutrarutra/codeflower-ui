<script lang="ts">
  // The agent's sign-in command, running in a terminal inside the sandbox.
  // Most print a page to open and then ask for the code that page shows: the
  // link becomes a button and the code a field, and the terminal stays one
  // click away for anything else (a menu, a question). The user's keystrokes go
  // to the terminal, its output comes here.
  import type { AuthMethod } from '@agentclientprotocol/sdk';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { Terminal } from '@xterm/xterm';
  import '@xterm/xterm/css/xterm.css';
  import { onMount } from 'svelte';
  import { app } from './lib/app.svelte.ts';
  import { isWebLink, signInPage } from './lib/authMethods.ts';
  import type { WebWorker } from './lib/worker.svelte.ts';

  let { worker, method, onExit }: { worker: WebWorker; method: AuthMethod; onExit: (exitCode: number) => void } = $props();
  let element: HTMLDivElement;
  /** The page the command asks the user to open, once it printed one. */
  let link = $state<string | null>(null);
  /** The terminal is shown: before a link, or when the user asks for it. */
  let showTerminal = $state(true);
  let code = $state('');
  let sent = $state(false);
  let copied = $state(false);
  let running = $state(true);
  let send: (data: string) => void = () => {};
  let fit: FitAddon | undefined;

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!code.trim()) return;
    send(`${code.trim()}\r`);
    code = '';
    sent = true;
  }

  async function copy(): Promise<void> {
    if (!link) return;
    await navigator.clipboard.writeText(link).catch(() => undefined);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  // The terminal is fitted when shown: hidden, it has no size.
  $effect(() => {
    if (showTerminal) queueMicrotask(() => fit?.fit());
  });

  onMount(() => {
    const connection = worker.connection;
    const terminal = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#1e1e1e', foreground: '#e4e4e4' }
    });
    fit = new FitAddon();
    terminal.loadAddon(fit);
    // A link the terminal shows opens in a new tab when clicked.
    terminal.loadAddon(new WebLinksAddon((_event, uri) => isWebLink(uri) && window.open(uri, '_blank', 'noopener')));
    terminal.open(element);
    fit.fit();
    terminal.focus();
    terminal.write('Starting the sign-in inside the sandbox…\r\n');

    let terminalId: string | undefined;
    let finished = false;
    let detach = () => {};
    let unmounted = false;
    /** Everything the command printed, to find the page it asks the user to open. */
    let printed = '';
    send = (data) => {
      if (terminalId && !finished) void connection?.terminalInput(terminalId, data).catch(() => undefined);
    };
    terminal.onData(send);

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
            output: (data) => {
              terminal.write(data);
              printed = (printed + data).slice(-65536);
              const page = signInPage(printed);
              if (page && page !== link) {
                // The first link puts the terminal away; a later one (a new attempt) keeps the user's choice.
                if (!link) showTerminal = false;
                link = page;
                sent = false;
              }
            },
            exit: (exitCode) => {
              finished = true;
              running = false;
              terminal.write(`\r\n\r\n${exitCode === 0 ? 'Signed in.' : `The sign-in ended with code ${exitCode}.`}\r\n`);
              if (exitCode !== 0) showTerminal = true;
              onExit(exitCode);
            }
          });
        },
        (error: unknown) => {
          finished = true;
          running = false;
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

{#if link && running}
  <ol class="m-0 flex list-none flex-col gap-3 p-0">
    <li class="flex flex-col gap-2">
      <span><span class="font-semibold">1.</span> Sign in on the {method.name} page, in a new tab.</span>
      <span class="flex flex-wrap items-center gap-2">
        <a class="pill pill-primary no-underline" href={link} target="_blank" rel="noopener noreferrer">
          <span class="codicon codicon-link-external"></span> Open the sign-in page
        </a>
        <button type="button" class="chip" onclick={copy}>
          <span class="codicon codicon-{copied ? 'check' : 'copy'}"></span>{copied ? 'Copied' : 'Copy the link'}
        </button>
      </span>
    </li>
    <li>
      <form class="flex flex-col gap-2" onsubmit={submit} autocomplete="off">
        <label for="sign-in-code"><span class="font-semibold">2.</span> If the page shows a code, paste it here.</label>
        <span class="flex gap-2">
          <input
            id="sign-in-code"
            class="field font-mono"
            bind:value={code}
            placeholder="Code from the sign-in page"
            spellcheck="false"
          />
          <button type="submit" class="pill pill-primary shrink-0" disabled={!code.trim()}>Continue</button>
        </span>
        {#if sent}
          <span class="text-[0.9em] text-muted" role="status"><span class="spinner"></span> Checking the code… if nothing happens, look at the terminal.</span>
        {/if}
      </form>
    </li>
  </ol>
  <button type="button" class="link self-start text-[0.85em]" aria-expanded={showTerminal} onclick={() => (showTerminal = !showTerminal)}>
    <span class="codicon codicon-chevron-{showTerminal ? 'down' : 'right'} text-[11px]!"></span>
    {showTerminal ? 'Hide' : 'Show'} the terminal
  </button>
{/if}

<div bind:this={element} class="h-[22rem] w-full overflow-hidden rounded-lg bg-[#1e1e1e] p-2" class:hidden={!showTerminal}></div>
