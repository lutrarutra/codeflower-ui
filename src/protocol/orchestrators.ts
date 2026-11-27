// Orchestrator chats as the code flower bridge reports them
// (`_codeflower/orchestrators/*`): a chat of a hosted model that directs one
// other chat, its executor, which alone works with the project's data. The two
// are made together, as a pair; the executor is a chat of a role of its own,
// with a short prompt and, where its agent allows, fewer tools. Must match
// sandbox/dsh-plugins/acp-ws/src/orchestrators.js (`list`, `create`).

export type AccessLevel = 'never' | 'ask' | 'always';

/** What an orchestrator may do beside talking to its executor; the user sets it per orchestrator. */
export interface OrchestratorAccess {
  /** Search the web and read pages (applies when its session starts again). */
  web: boolean;
  /** List the folders its executor works in: names and sizes, not contents. */
  files: boolean;
  /** Read the scripts the executor wrote in its steps (read_code). */
  code: boolean;
  /** Keep the project's map of ideas (Roots) for this work. */
  roots: boolean;
  /** See the executor's figures: never, those the user shares, or every one its chat showed. */
  figures: AccessLevel;
  /** Read the executor's reports, likewise. */
  report: AccessLevel;
  /** The user allows each reply and question before it goes to the orchestrator. */
  approve: boolean;
}

export const DEFAULT_ACCESS: OrchestratorAccess = { web: true, files: true, code: true, roots: true, figures: 'ask', report: 'ask', approve: false };

/**
 * idle; asking: the executor works on its step; waiting: the executor waits for its answer;
 * sharing: the step is done, and its reply waits for the user to share or keep the files it showed.
 */
export type OrchestratorState = 'idle' | 'asking' | 'waiting' | 'sharing';

/** A file shared with an orchestrator, or one waiting for the user's answer, or kept from it. */
export interface OrchestratorFile {
  path: string;
  kind: 'figure' | 'report' | 'code';
  status: 'visible' | 'pending' | 'declined';
}

export interface Orchestrator {
  key: string;
  agent: string;
  title: string;
  /** The chat it directs, for good. */
  executor: string;
  executorTitle: string;
  /** The executor's agent; missing from older workers. */
  executorAgent?: string;
  /** The tools the executor got, where its agent limits them (`executorLimited`). */
  executorTools?: string[];
  executorLimited?: boolean;
  /** The executor's working folder, whose AGENTS.md is its prompt. */
  executorFolder?: string;
  access: OrchestratorAccess;
  state: OrchestratorState;
  /** Replies and questions the executor sent it. */
  sent: number;
  /** What has been shared with it (its chat's footer); missing from older workers. */
  files?: OrchestratorFile[];
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

/** An executor chat's line under its header: the orchestrator it works for, and what it got. */
export interface ExecutorInfo {
  orchestrator: string;
  orchestratorTitle: string;
  /** Its tools, where its agent limits them. */
  tools?: string[];
  /** Its agent has an executor hook: fewer tools; else it keeps its usual ones. */
  limited: boolean;
  /** Its prompt: its folder's AGENTS.md. */
  prompt?: string;
  /** The orchestrator's access, shown read-only. */
  access: OrchestratorAccess;
  /** The link ended: an ordinary chat again. */
  disconnected?: boolean;
}

/** What a chat's view knows of orchestration: the orchestrators directing it, the one it is, and, for an executor, its line. */
export function orchestration(
  orchestrators: Orchestrator[],
  key: string
): { orchestrators: Orchestrator[]; orchestrator?: Orchestrator; executor?: ExecutorInfo } {
  const directing = orchestratorsOfChat(orchestrators, key);
  const pair = directing[0];
  return {
    orchestrators: directing,
    orchestrator: orchestrators.find((orchestrator) => orchestrator.key === key),
    executor: pair
      ? {
          orchestrator: pair.key,
          orchestratorTitle: pair.title,
          ...(pair.executorTools ? { tools: pair.executorTools } : {}),
          limited: pair.executorLimited === true,
          ...(pair.executorFolder ? { prompt: `${pair.executorFolder}/AGENTS.md` } : {}),
          access: pair.access,
          ...(pair.disconnected ? { disconnected: true } : {})
        }
      : undefined
  };
}

/** A figure or report the user may share with an orchestrator. */
export function shareable(path: string): 'figure' | 'report' | undefined {
  if (/\.(png|jpe?g|gif|webp|svg|tiff?|bmp)$/i.test(path)) return 'figure';
  if (/\.(html?|md|txt)$/i.test(path)) return 'report';
  return undefined;
}
