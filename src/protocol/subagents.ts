// A chat's subagents as the code flower bridge reports them, whichever agent
// runs them: the bridge turns each agent's form into ACP's subagents RFD and
// keeps a summary of each child (sandbox: dsh-plugins/acp-ws/src/subagents).
// What an agent reports, and which settings it takes, come with the worker's
// status (`capabilities.subagents`); the chat never knows an agent by name.

/** RFD states: `requires_action` waits for the user (a permission, a question). */
export type SubagentState = 'running' | 'requires_action' | 'idle' | 'unknown';

/** A session setting's chosen value, with its name where the agent gave one. */
export interface SubagentChoice {
  value: string;
  name?: string;
  description?: string;
}

/** A choice as the chat names it: an agent's "default" by what it is, e.g. its model. */
export function choiceLabel(choice: SubagentChoice): string {
  return choice.value === 'default' && choice.description ? choice.description : (choice.name ?? choice.value);
}

export interface SubagentUsage {
  context?: { used: number; size: number };
  cost?: { amount: number; currency: string };
  tokens?: Record<string, number>;
}

export interface SubagentSummary {
  /** Its chat's key, and its parent's. */
  key: string;
  parentKey: string;
  sessionId: string;
  title?: string;
  description?: string;
  /** Its task, the parent's first message to it. */
  prompt?: string;
  state: SubagentState;
  stopReason?: string;
  error?: string;
  /** What the agent lets the client do with it, e.g. `cancel`. */
  capabilities?: { cancel?: unknown } & Record<string, unknown>;
  startedAt?: string;
  endedAt?: string;
  model?: SubagentChoice;
  effort?: SubagentChoice;
  usage?: SubagentUsage;
  /** The end of its latest message, or its reply to the parent. */
  lastMessage?: string;
}

/** What an agent reports of its subagents, and which of their defaults it takes. */
export interface SubagentFeatures {
  reports: { model: boolean; effort: boolean; usage: 'none' | 'context' | 'tokens' | 'cost'; result: boolean };
  /** `session`: new and reopened chats take a change; `restart`: the agent's next start. */
  settings: { model?: { applies: 'session' | 'restart' }; effort?: { applies: 'session' | 'restart' } };
}

/** The main chat's model or effort, the default. */
export const SAME = 'same';

export interface SubagentSettings {
  model: string;
  effort: string;
}

export interface SubagentSettingsState {
  settings: SubagentSettings;
  features: SubagentFeatures;
  /** A setting waits for the agent's restart. */
  restartPending: boolean;
}

/** What opening a subagent's chat returns: where its live updates start. */
export interface OpenedSubagent {
  key: string;
  parentKey: string;
  /** Running in this worker's agent: its updates follow live. */
  live: boolean;
  sessionId?: string;
  transcriptEntries?: number;
  subagent?: SubagentSummary;
}

export function subagentActive(subagent: Pick<SubagentSummary, 'state'>): boolean {
  return subagent.state === 'running' || subagent.state === 'requires_action';
}

/** Its name in lists and tabs. */
export function subagentTitle(subagent: Pick<SubagentSummary, 'title' | 'description' | 'prompt'>): string {
  const text = subagent.title || subagent.description || subagent.prompt?.split('\n')[0] || 'Subagent';
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** How it ended, or that it runs. */
export function subagentStatus(subagent: Pick<SubagentSummary, 'state' | 'stopReason' | 'error'>): string {
  switch (subagent.state) {
    case 'running':
      return 'running';
    case 'requires_action':
      return 'waiting for you';
    case 'unknown':
      return 'ended';
    case 'idle':
      if (subagent.error) return 'failed';
      if (subagent.stopReason === 'cancelled') return 'stopped';
      if (subagent.stopReason === 'error' || subagent.stopReason === 'refusal') return 'failed';
      return 'done';
  }
}

/** The newest first among the ended ones; running ones first. */
export function sortSubagents(subagents: SubagentSummary[]): SubagentSummary[] {
  const time = (subagent: SubagentSummary) => subagent.endedAt ?? subagent.startedAt ?? '';
  return [...subagents].sort((a, b) => {
    const active = Number(subagentActive(b)) - Number(subagentActive(a));
    return active || time(b).localeCompare(time(a));
  });
}

/** Keeps a chat's list current with one changed subagent. */
export function withSubagent(subagents: SubagentSummary[], changed: SubagentSummary): SubagentSummary[] {
  const index = subagents.findIndex((subagent) => subagent.key === changed.key);
  if (index === -1) return [...subagents, changed];
  return subagents.map((subagent, at) => (at === index ? changed : subagent));
}
