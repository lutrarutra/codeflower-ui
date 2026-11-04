// The agent a new chat starts with: the one the user chose last for the
// project, kept in this browser, else the first that can run and is signed in.
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

/** The agent of the next chat in the project: `wanted` (or the remembered one) if it can run. */
export function newChatAgent(agents: AgentState[], project: string, wanted?: AgentName): AgentName | undefined {
  const runnable = agents.filter((agent) => !agent.unavailable);
  const choice = wanted ?? remembered()[project];
  if (runnable.some((agent) => agent.id === choice)) return choice;
  return (runnable.find((agent) => agent.signedIn) ?? runnable[0])?.id;
}
