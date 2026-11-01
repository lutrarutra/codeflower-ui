<script lang="ts">
  // The Plugins view for one sandbox, in a dialog. The page is its own host:
  // calls go to the sandbox's connection, and for a sandbox the app started
  // without the network, to the app's fetch run.
  import { untrack } from 'svelte';
  import Plugins from '../chat/Plugins.svelte';
  import { servePlugins } from '../client/pluginsService.ts';
  import type { PluginsHostMessage, PluginsWebviewMessage } from '../protocol/plugins.ts';
  import type { Host } from '../chat/lib/host.ts';
  import { api } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';

  let dialog: HTMLDialogElement | undefined = $state();
  const target = $derived(app.plugins);

  $effect(() => {
    const open = !!target;
    untrack(() => {
      if (open && dialog && !dialog.open) dialog.showModal();
      else if (!open && dialog?.open) dialog.close();
    });
  });

  type DialogHost = Host<PluginsWebviewMessage, PluginsHostMessage> & { dispose(): void };
  let host = $state<DialogHost | undefined>();

  // A host per opened sandbox, made before the view mounts.
  function makeHost({ worker, agent }: NonNullable<typeof app.plugins>): DialogHost {
    const listeners = new Set<(message: PluginsHostMessage) => void>();
    let connecting: Promise<void> | undefined = agent.connect();
    const service = servePlugins({
      connection: () => agent.connection,
      send: (message) => {
        for (const listener of listeners) listener(message);
      },
      agentLabel: agent.status?.agentLabel ?? worker.label,
      restart: async () => {
        await agent.connection?.restartAgent();
        await agent.reconnect();
      },
      // Only the sandboxes this app started; its own page (one sandbox) has no app.
      appFetch:
        worker.source === 'started' && !app.single
          ? async () => {
              await api(`/api/workers/${encodeURIComponent(worker.id)}/plugins/fetch`, { method: 'POST' });
            }
          : undefined,
      fetchHint: `Run \`codeflower plugins fetch --agent ${worker.agent} --project ${worker.project}\` where the sandbox was started and there is internet access, then restart the agent.`
    });
    return {
      send: (message) => {
        // Calls wait until the sandbox is connected.
        const ready = connecting ?? Promise.resolve();
        void ready
          .catch(() => {})
          .then(() => {
            connecting = undefined;
            service.receive(message);
          });
      },
      listen: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => service.dispose()
    };
  }

  $effect(() => {
    const opened = target;
    if (!opened) {
      host = undefined;
      return;
    }
    const made = untrack(() => makeHost(opened));
    host = made;
    return () => made.dispose();
  });
</script>

<dialog bind:this={dialog} class="h-[min(48rem,calc(100vh-2rem))] w-[min(52rem,calc(100vw-2rem))]" onclose={() => (app.plugins = null)} aria-label="Plugins">
  <div class="card relative flex h-full flex-col p-0">
    <button class="pill pill-small absolute top-3 right-3 z-10" onclick={() => (app.plugins = null)} aria-label="Close">Close</button>
    {#if host && target}
      {#key target.worker.id}
        <Plugins {host} />
      {/key}
    {/if}
  </div>
</dialog>
