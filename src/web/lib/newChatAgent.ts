// The agent a new chat starts with: the one the user chose last for the
// project, kept in this browser, else the first that can run. Only an agent
// that can run here and is signed in can start a chat.
import type { AgentState } from '../../client/workerConnection.ts';
import type { AgentName } from '../../protocol/messages.ts';

const KEY = 'codeflower.newChatAgent';

function remembered(): Record<string, AgentName> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, AgentName>;
  } catch {
    return {};
  }
}

export function rememberAgent(project: string, agent: AgentName): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...remembered(), [project]: agent }));
  } catch {
    // Not remembered; the next chat starts with the default.
  }
}

/** Whether the agent can start a chat. */
export function canChat(agent: AgentState): boolean {
  return !agent.unavailable && agent.signedIn;
}

/** The agent of the next chat in the project: `wanted` (or the remembered one) if it can chat. */
export function newChatAgent(agents: AgentState[], project: string, wanted?: AgentName): AgentName | undefined {
  const ready = agents.filter(canChat);
  const choice = wanted ?? remembered()[project];
  if (ready.some((agent) => agent.id === choice)) return choice;
  return ready[0]?.id;
}
