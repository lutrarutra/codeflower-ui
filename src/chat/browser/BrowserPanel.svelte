<script lang="ts">
  // A chat's browser in a webview of its own (VS Code's panel): the browser
  // view, with its host's calls and the frames sent as messages to and from
  // the extension, which holds the connection to the sandbox.
  import { onMount } from 'svelte';
  import type { BrowserCall, BrowserFrame, BrowserHost, BrowserPanelHostMessage, BrowserPanelMessage, BrowserState } from '../../protocol/browser.ts';
  import type { Host } from '../lib/host.ts';
  import BrowserView from './BrowserView.svelte';

  let { host }: { host: Host<BrowserPanelMessage, BrowserPanelHostMessage> } = $props();

  let browser = $state<BrowserState | undefined>();
  let connected = $state(false);
  let visible = $state(true);
  const views = new Set<(frame: BrowserFrame) => void>();
  const calls = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let nextCall = 1;

  const call = (method: BrowserCall, ...args: unknown[]) =>
    new Promise<void>((resolve, reject) => {
      const id = nextCall++;
      calls.set(id, { resolve, reject });
      host.send({ type: 'call', id, method, args });
    });

  const browserHost: BrowserHost = {
    watch: (options) => call('watch', options),
    unwatch: () => call('unwatch'),
    ack: (frameId) => call('ack', frameId),
    control: (take) => call('control', take),
    input: (events) => call('input', events),
    navigate: (action, url) => call('navigate', action, url),
    dialog: (accept, promptText) => call('dialog', accept, promptText),
    selectTab: (targetId) => call('selectTab', targetId),
    handBack: (note) => call('handBack', note),
    frames(listener) {
      views.add(listener);
      return () => views.delete(listener);
    }
  };

  onMount(() => {
    const stop = host.listen((message) => {
      switch (message.type) {
        case 'browser':
          browser = message.browser;
          connected = message.connected;
          break;
        case 'frame':
          if (views.size) for (const view of views) view(message.frame);
          else void browserHost.ack(message.frame.frameId).catch(() => undefined);
          break;
        case 'visible':
          visible = message.visible;
          break;
        case 'reply': {
          const pending = calls.get(message.id);
          calls.delete(message.id);
          if (message.error === undefined) pending?.resolve();
          else pending?.reject(new Error(message.error));
          break;
        }
      }
    });
    host.send({ type: 'ready' });
    return stop;
  });
</script>

{#if browser}
  <BrowserView {browser} host={browserHost} {visible} {connected} />
{:else}
  <p class="m-0 grid h-screen place-items-center p-6 text-center text-muted">Loading the browser…</p>
{/if}
