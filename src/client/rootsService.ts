// The host side of the Roots view (chat/Roots.svelte) for one sandbox: answers
// its calls from the worker's connection, sends it the map when it changes and
// the chats the host knows, and opens chats and files for it. The page and the
// VS Code extension host both use it, with their own chats, tabs and previews.
import { continuePrompt, ideaFilePath, type IdeaPatch, type RootsChat, type RootsHostMessage, type RootsMap, type RootsWebviewMessage } from '../protocol/roots.ts';
import type { WorkerConnection } from './workerConnection.ts';

export interface RootsServiceOptions {
  /** The worker's connection now; it changes when the sandbox reconnects. */
  connection(): WorkerConnection | undefined;
  send(message: RootsHostMessage): void;
  /** The sandbox's name, for the view's header; asked again when the chats change, as it may come later. */
  label(): string;
  /** The chats the host knows, with their state. */
  chats(): RootsChat[];
  openChat(key: string): void;
  /** A new chat with `prompt` ready to send: the user picks the agent and may change it first. */
  newChat(prompt: string): void;
  /** A file by its path in the sandbox. */
  openFile(path: string): void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function serveRoots(options: RootsServiceOptions): {
  receive(message: RootsWebviewMessage): void;
  /** The host's chats or their states changed. */
  chatsChanged(): void;
  /** Shows an idea, e.g. from a chat's badge. */
  focus(idea: number): void;
  dispose(): void;
} {
  let unsubscribe: (() => void) | undefined;
  let subscribed: WorkerConnection | undefined;
  let workspace: string | undefined;
  let ready = false;
  let focusing: number | undefined;

  const sendMap = (map: RootsMap) => {
    if (map.workspace) workspace = map.workspace;
    options.send({ type: 'map', map: { ...map, ...(workspace ? { workspace } : {}) } });
  };
  // Follows the connection, which a reconnect replaces, and lists the map again.
  const subscribe = () => {
    const connection = options.connection();
    if (connection === subscribed) return;
    unsubscribe?.();
    subscribed = connection;
    unsubscribe = connection?.onRootsChanged(sendMap);
    if (connection?.connected && ready) void list().catch(() => undefined);
  };
  const require = (): WorkerConnection => {
    subscribe();
    const connection = options.connection();
    if (!connection?.connected) throw new Error('The sandbox is not connected');
    if (!connection.hasRoots) throw new Error('This sandbox is older than Roots: start it again with a newer image');
    return connection;
  };
  const list = async (): Promise<RootsMap> => {
    const map = await require().roots();
    sendMap(map);
    return map;
  };
  const id = (params: Record<string, unknown> | undefined): number => {
    const value = params?.id;
    if (typeof value !== 'number') throw new Error('id is required');
    return value;
  };

  const call = async (method: string, params: Record<string, unknown> | undefined): Promise<unknown> => {
    switch (method) {
      case 'list':
        return list();
      case 'update':
        return require().updateIdea(id(params), (params?.patch ?? {}) as IdeaPatch);
      case 'comment': {
        const text = params?.text;
        if (typeof text !== 'string') throw new Error('text is required');
        return require().commentIdea(id(params), text);
      }
    }
    throw new Error(`Unknown method ${method}`);
  };

  return {
    receive(message) {
      switch (message.type) {
        case 'ready':
          // The view lists the map itself; later connections list it for the view.
          subscribe();
          ready = true;
          options.send({ type: 'context', label: options.label() });
          options.send({ type: 'chats', chats: options.chats() });
          if (focusing !== undefined) options.send({ type: 'focus', idea: focusing });
          focusing = undefined;
          return;
        case 'call':
          call(message.method, message.params).then(
            (result) => options.send({ type: 'result', id: message.id, result: result ?? {} }),
            (error) => options.send({ type: 'result', id: message.id, error: describe(error) })
          );
          return;
        case 'openChat':
          options.openChat(message.key);
          return;
        case 'newChat':
          options.newChat(continuePrompt(message.idea, message.title));
          return;
        case 'openFile':
          options.openFile(ideaFilePath(message.path, workspace));
          return;
      }
    },
    chatsChanged() {
      if (ready) {
        options.send({ type: 'context', label: options.label() });
        options.send({ type: 'chats', chats: options.chats() });
      }
      subscribe();
    },
    focus(idea) {
      if (ready) options.send({ type: 'focus', idea });
      else focusing = idea;
    },
    dispose() {
      unsubscribe?.();
    }
  };
}
