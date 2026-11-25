<script lang="ts">
  // A sandbox's map of ideas in a tab of the grid: the shared Roots view, with
  // the page as its host. Chats open in the grid, files beside them, and a new
  // chat on an idea starts with the agent last chosen for the project.
  import { untrack } from 'svelte';
  import Roots from '../chat/Roots.svelte';
  import type { Host } from '../chat/lib/host.ts';
  import { serveRoots } from '../client/rootsService.ts';
  import type { RootsChat, RootsHostMessage, RootsWebviewMessage } from '../protocol/roots.ts';
  import { app } from './lib/app.svelte.ts';
  import { workerTitle } from './lib/format.ts';
  import { newChatAgent } from './lib/newChatAgent.ts';

  let { workerId }: { workerId: string } = $props();
  const agent = $derived(app.agent(workerId));
  const worker = $derived(app.worker(workerId));

  // Its sandbox connects for it, e.g. after a reload, unless another window has it.
  $effect(() => {
    if (agent.state === 'idle' && worker?.status === 'ready' && !app.elsewhere(worker)) untrack(() => void agent.connect().catch(() => undefined));
  });

  /** The sandbox's chats, with what each is doing as the app last polled it. */
  function chats(): RootsChat[] {
    const activity = app.worker(workerId)?.activity?.chats ?? [];
    return agent.sessions.map((session) => {
      const state = activity.find((chat) => chat.key === session.key)?.state;
      return {
        key: session.key,
        title: agent.chats[session.key]?.state.title || session.title,
        agentLabel: agent.agent(session.harness)?.name ?? session.harness,
        state: state === 'working' ? 'working' : state === 'waiting' ? 'waiting' : 'idle'
      };
    });
  }

  async function newChat(prompt: string): Promise<void> {
    const project = app.worker(workerId)?.project || workerId;
    const name = newChatAgent(agent.agents, project);
    if (!name) {
      app.go({ view: 'chat', worker: workerId });
      return;
    }
    const key = await agent.newChat(name);
    if (!key) return;
    agent.chats[key]?.post({ type: 'draft', text: prompt });
    app.go({ view: 'chat', worker: workerId, session: key });
  }

  type TabHost = Host<RootsWebviewMessage, RootsHostMessage> & { chatsChanged(): void; dispose(): void };

  function makeHost(): TabHost {
    const listeners = new Set<(message: RootsHostMessage) => void>();
    const service = serveRoots({
      connection: () => agent.connection,
      send: (message) => {
        for (const listener of listeners) listener(message);
      },
      label: worker ? workerTitle(worker).filter(Boolean).join(', ') : '',
      chats,
      openChat: (key) => app.go({ view: 'chat', worker: workerId, session: key }),
      newChat: (prompt) =>
        void newChat(prompt).catch((error) => (agent.error = `Could not start a chat: ${error instanceof Error ? error.message : String(error)}`)),
      openFile: (path) => void app.previews.openPath(agent, path, undefined)
    });
    return {
      // Calls wait until the sandbox is connected.
      send: (message) => {
        void agent
          .connect()
          .catch(() => {})
          .then(() => service.receive(message));
      },
      listen: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      chatsChanged: () => service.chatsChanged(),
      dispose: () => service.dispose()
    };
  }

  const host = makeHost();
  $effect(() => () => host.dispose());

  // The chats, their titles and states, and the connection, as they change.
  $effect(() => {
    void agent.sessions;
    void app.worker(workerId)?.activity;
    void agent.connected;
    untrack(() => host.chatsChanged());
  });
</script>

<Roots {host} />
