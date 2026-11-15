<script lang="ts">
  // A chat's browser in a tab of the grid: the shared view, over the
  // sandbox's own connection. Closing the tab only stops showing it.
  import { untrack } from 'svelte';
  import BrowserView from '../chat/browser/BrowserView.svelte';
  import { app } from './lib/app.svelte.ts';

  let { workerId, chatKey, visible }: { workerId: string; chatKey: string; visible: boolean } = $props();
  const agent = $derived(app.agent(workerId));
  const worker = $derived(app.worker(workerId));
  // A new host on each connection: the view watches again over it.
  const host = $derived(agent.connected ? agent.browserHost(chatKey) : undefined);
  const browser = $derived(agent.browsers[chatKey] ?? { key: chatKey, running: false, tabs: [], url: '', title: '', controlled: false });

  // Its sandbox connects for it, e.g. after a reload, unless another window has it.
  $effect(() => {
    if (agent.state === 'idle' && worker?.status === 'ready' && !app.elsewhere(worker)) untrack(() => void agent.connect().catch(() => undefined));
  });
</script>

{#if host}
  {#key host}
    <BrowserView {browser} {host} {visible} connected={agent.connected} />
  {/key}
{:else}
  <p class="m-0 grid h-full place-items-center p-6 text-center text-muted">
    {agent.state === 'connecting' ? 'Connecting to the sandbox…' : 'Not connected to the sandbox: the browser runs on there.'}
  </p>
{/if}
