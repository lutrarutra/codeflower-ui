// Between the Plugins view and its host (the VS Code extension host, or the
// app's page in the same window): the view calls the host's methods, which
// the host answers from the worker (`servePlugins` in client/pluginsService.ts).

export type PluginsMethod =
  | 'list'
  | 'catalog'
  | 'add'
  | 'remove'
  | 'setEnabled'
  | 'addCatalog'
  | 'removeCatalog'
  /** Fetches in the sandbox, which needs its network. */
  | 'fetch'
  /** The app's fetch run, for a sandbox without the network (the page, for sandboxes it started). */
  | 'appFetch'
  /** Restarts the agent to apply the changes; refused while chats work. */
  | 'restart';

export type PluginsWebviewMessage =
  | { type: 'ready' }
  | { type: 'call'; id: number; method: PluginsMethod; params?: Record<string, unknown> };

export type PluginsHostMessage =
  /** Who the plugins are for, and whether the host can run the app's fetch. */
  | { type: 'context'; agentLabel: string; appFetch: boolean; fetchHint?: string }
  /** The worker's plugins changed: list them again. */
  | { type: 'changed' }
  | { type: 'result'; id: number; result?: unknown; error?: string };
