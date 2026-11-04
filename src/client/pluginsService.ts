// The host side of the Plugins view (chat/Plugins.svelte) for one agent:
// answers its calls from the worker's connection and tells it when the
// agent's plugins changed. The
// page and the VS Code extension host both use it, with their own way to
// reconnect after a restart and, on the page, the app's fetch run.
import type { AgentName } from '../protocol/messages.ts';
import type { PluginsHostMessage, PluginsWebviewMessage } from '../protocol/plugins.ts';
import type { WorkerConnection } from './workerConnection.ts';

export interface PluginsServiceOptions {
  /** The worker's connection now; it changes when the sandbox reconnects. */
  connection(): WorkerConnection | undefined;
  /** The agent whose plugins these are. */
  agent: AgentName;
  send(message: PluginsHostMessage): void;
  agentLabel: string;
  /** Restarts the agent; resolves once it is asked to. */
  restart(): Promise<void>;
  /** The app's fetch run, where the host can start one (the page, for sandboxes the app started). */
  appFetch?: () => Promise<void>;
  /** Without appFetch: what to tell the user to run instead. */
  fetchHint?: string;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function servePlugins(options: PluginsServiceOptions): {
  receive(message: PluginsWebviewMessage): void;
  dispose(): void;
} {
  let unsubscribe: (() => void) | undefined;
  let subscribed: WorkerConnection | undefined;
  const changed = () => options.send({ type: 'changed' });
  const agent = options.agent;
  // Follows the connection, which a restart replaces.
  const subscribe = () => {
    const connection = options.connection();
    if (connection === subscribed) return;
    unsubscribe?.();
    subscribed = connection;
    unsubscribe = connection?.onPluginsChanged((changedAgent) => {
      if (changedAgent === agent) changed();
    });
  };
  const require = (): WorkerConnection => {
    subscribe();
    const connection = options.connection();
    if (!connection?.connected) throw new Error('The sandbox is not connected');
    return connection;
  };
  const string = (params: Record<string, unknown> | undefined, name: string): string => {
    const value = params?.[name];
    if (typeof value !== 'string') throw new Error(`${name} is required`);
    return value;
  };

  const call = async (method: string, params: Record<string, unknown> | undefined): Promise<unknown> => {
    switch (method) {
      case 'list':
        return require().plugins(agent);
      case 'catalog':
        return require().pluginCatalog(agent, string(params, 'catalog'));
      case 'add':
        return require().addPlugin(agent, string(params, 'source'));
      case 'remove':
        return require().removePlugin(agent, string(params, 'id'));
      case 'setEnabled':
        return require().setPluginEnabled(agent, string(params, 'id'), params?.enabled === true);
      case 'addCatalog':
        return require().addPluginCatalog(agent, string(params, 'source'));
      case 'removeCatalog':
        return require().removePluginCatalog(agent, string(params, 'source'));
      case 'fetch':
        return require().fetchPlugins(agent);
      case 'appFetch':
        if (!options.appFetch) throw new Error(options.fetchHint ?? 'This window cannot fetch plugins for the sandbox');
        await options.appFetch();
        changed();
        return {};
      case 'restart':
        await options.restart();
        subscribe();
        changed();
        return {};
    }
    throw new Error(`Unknown method ${method}`);
  };

  return {
    receive(message) {
      if (message.type === 'ready') {
        subscribe();
        options.send({ type: 'context', agentLabel: options.agentLabel, appFetch: !!options.appFetch, fetchHint: options.fetchHint });
        return;
      }
      if (message.type !== 'call') return;
      call(message.method, message.params).then(
        (result) => options.send({ type: 'result', id: message.id, result: result ?? {} }),
        (error) => options.send({ type: 'result', id: message.id, error: describe(error) })
      );
    },
    dispose() {
      unsubscribe?.();
    }
  };
}
