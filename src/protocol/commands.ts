// A command the agent of a chat runs, as the bridge tells of it
// (`_codeflower/commands/list|changed`, sandbox/dsh-plugins/acp-ws/src/commands.js).
// A window watches one read-only with `_codeflower/terminal/attach` and its `commandId`.

export interface AgentCommand {
  /** What a window attaches with (`terminal/attach`'s `terminalId`). */
  commandId: string;
  /** The tool call that runs it, when it has one. */
  toolCallId?: string;
  command: string;
  cwd?: string;
  /** It runs on after its tool call (e.g. Claude Code's background commands). */
  background: boolean;
  /** Its output can be watched; false when the agent shows it only at the end. */
  streams: boolean;
  /** The agent asked the user for permission to run it: it does not run yet. */
  waiting?: boolean;
  startedAt: string;
  /** Ended commands are kept a while, the last few of a chat. */
  endedAt?: string;
  exitCode?: number;
  /** How many windows watch it. */
  viewers: number;
}

/** The chat's commands that run: not ended, and not waiting for the user's permission. */
export const runningCommands = (commands: AgentCommand[] | undefined): AgentCommand[] =>
  (commands ?? []).filter((command) => !command.endedAt && !command.waiting);

/** A command's title: its first line, short. */
export function commandTitle(command: Pick<AgentCommand, 'command'>, max = 80): string {
  const line = command.command.split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What a chat's agent runs outside its turn, in the chat's footer: a command or a background task. */
export interface BackgroundWork {
  id: string;
  name: string;
  /** E.g. `command`, `background`, or the task's type. */
  kind: string;
  detail?: string;
  /** Set when its output can be watched. */
  commandId?: string;
}
