// Orchestrator chats as the code flower bridge reports them
// (`_codeflower/orchestrators/*`): a chat of a hosted model that directs one
// other chat, its executor, which alone works with the project's data. Must
// match sandbox/dsh-plugins/acp-ws/src/orchestrators.js (`list`).

export type AccessLevel = 'never' | 'ask' | 'always';

/** What an orchestrator may do beside talking to its executor; the user sets it per orchestrator. */
export interface OrchestratorAccess {
  /** Search the web and read pages (applies when its session starts again). */
  web: boolean;
  /** List the folders its executor works in: names and sizes, not contents. */
  files: boolean;
  /** See the executor's figures: never, those the user shares, or every one its chat showed. */
  figures: AccessLevel;
  /** Read the executor's reports, likewise. */
  report: AccessLevel;
  /** The user allows each reply and question before it goes to the orchestrator. */
  approve: boolean;
}

export const DEFAULT_ACCESS: OrchestratorAccess = { web: true, files: true, figures: 'ask', report: 'ask', approve: false };

/** idle; asking: the executor works on its message; waiting: the executor waits for its answer. */
export type OrchestratorState = 'idle' | 'asking' | 'waiting';

export interface Orchestrator {
  key: string;
  agent: string;
  title: string;
  /** The chat it directs, for good. */
  executor: string;
  executorTitle: string;
  access: OrchestratorAccess;
  state: OrchestratorState;
  /** Replies and questions the executor sent it. */
  sent: number;
  /** The user ended the link: its chat is read-only. */
  disconnected?: boolean;
}

/** What the worker's status says of orchestrators: the agents that can be one; missing from older workers. */
export interface OrchestratorsSummary {
  agents: string[];
}

/** The orchestrators directing a chat, connected ones first. */
export function orchestratorsOfChat(orchestrators: Orchestrator[], key: string): Orchestrator[] {
  return orchestrators
    .filter((orchestrator) => orchestrator.executor === key)
    .sort((a, b) => Number(Boolean(a.disconnected)) - Number(Boolean(b.disconnected)));
}

/** What a chat's view knows of orchestration: the orchestrators directing it, or the one it is. */
export function orchestration(orchestrators: Orchestrator[], key: string): { orchestrators: Orchestrator[]; orchestrator?: Orchestrator } {
  return { orchestrators: orchestratorsOfChat(orchestrators, key), orchestrator: orchestrators.find((orchestrator) => orchestrator.key === key) };
}

/** A figure or report the user may share with an orchestrator. */
export function shareable(path: string): 'figure' | 'report' | undefined {
  if (/\.(png|jpe?g|gif|webp|svg|tiff?|bmp)$/i.test(path)) return 'figure';
  if (/\.(html?|md|txt)$/i.test(path)) return 'report';
  return undefined;
}
