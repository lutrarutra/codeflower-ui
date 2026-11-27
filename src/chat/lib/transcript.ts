// Folds recorded or live ACP traffic into chat items for rendering.
import type { ContentBlock, PermissionOption, PlanEntry, ToolCallContent, ToolCallLocation, ToolCallUpdate } from '@agentclientprotocol/sdk';
import { looksLikeFile } from './files.ts';
import {
  ACTION_PROMPT_META,
  FROM_META,
  NOTICE_PROMPT_META,
  hiddenBlock,
  type ActionPromptMeta,
  type FromMeta,
  formFields,
  type FormContent,
  type FormField,
  type SentWhat,
  type TranscriptEntry
} from '../../protocol/messages.ts';

/** When a prompt's turn started and ended, in ms since the epoch; null when unknown or still running. */
interface TurnTimes {
  started: number | null;
  ended: number | null;
}

/**
 * When the agent's turn ended and how long it ran (ms), on the turn's last
 * message: the one time the chat shows for the agent. `took` is null when the
 * turn's prompt is not known, e.g. for work the agent did on its own.
 */
export interface TurnStamp {
  at: number;
  took: number | null;
}

export type ChatItem =
  | ({ kind: 'user'; id: string; text: string } & TurnTimes)
  | ({ kind: 'action'; id: string; title: string; text: string } & TurnTimes)
  /** A prompt of the bridge's own (e.g. a batch job ended): not the user's message, shown apart and folded. */
  | ({ kind: 'notice'; id: string; title: string; summary: string | null; text: string } & TurnTimes)
  /** Another chat's message (orchestrators.js): an orchestrator's to this chat, or its executor's question. */
  | ({ kind: 'peer'; id: string; from: FromMeta; text: string } & TurnTimes)
  /** What this chat sent its orchestrator: the exact text it got, or that the user withheld it. */
  | { kind: 'sent'; id: string; to: string; what: SentWhat; path?: string; text: string; withheld: boolean }
  | { kind: 'assistant'; id: string; text: string; messageId?: string | null; at: number | null; stamp?: TurnStamp }
  | { kind: 'thought'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      title: string;
      /** What the call is for, in words, when the agent says (e.g. Claude Code's Bash description). */
      description: string | null;
      status: string;
      toolKind: string;
      details: string[];
      /** A command's output, as the agent streamed it on the call (the end of it when long); '' when none came. */
      output: string;
      /** A command's exit code, when the agent said. */
      exitCode: number | null;
      files: string[];
      /** When the call started and ended, in ms since the epoch; null when unknown or still running. */
      started: number | null;
      ended: number | null;
    }
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
  | { kind: 'permission'; id: string; title: string; outcome: string | null; options?: PermissionOption[] }
  | { kind: 'stop'; id: string; reason: string; stamp?: TurnStamp }
  | { kind: 'shell'; id: string; runId: string; command: string; output: string; exitCode: number | null; timedOut: boolean }
  | { kind: 'question'; id: string; message: string; fields: FormField[]; answers: QuestionAnswer[] | null; skipped: boolean }
  | { kind: 'show'; id: string; files: string[]; message: string | null }
  /** One of the chat's subagents, where it started; its summary comes from the worker. */
  | {
      kind: 'subagent';
      id: string;
      sessionId: string;
      title: string | null;
      description: string | null;
      prompt: string | null;
      state: string;
      stopReason: string | null;
      /** Its reply to the chat, when it gave one. */
      reply: string | null;
      started: number | null;
      ended: number | null;
    }
  /** In a subagent's chat: the task its parent gave it. */
  | { kind: 'task'; id: string; text: string };

// ACP's subagents RFD, which the stable schema does not have yet: the bridge
// sends every agent's subagents in this form.
interface SubagentUpdate {
  sessionUpdate: 'subagent_update';
  sessionId: string;
  title?: string | null;
  description?: string | null;
  state?: { state?: string; stopReason?: string } | null;
}

interface SessionMessage {
  sessionUpdate: 'session_message';
  senderSessionId?: string;
  recipientSessionId?: string;
  content?: ContentBlock[];
}

/** One answered field: what was asked and what the user picked or wrote. */
export interface QuestionAnswer {
  question: string;
  answer: string;
}

function answers(fields: FormField[], content: FormContent | null, message: string): QuestionAnswer[] {
  if (!content) return [];
  return fields
    .map((field) => {
      const value = content[field.key];
      const picked = Array.isArray(value) ? value.join(', ') : value === undefined || value === '' ? '' : String(value);
      const other = field.other ? String(content[field.other.key] ?? '').trim() : '';
      return {
        question: field.description ?? field.title ?? message,
        answer: [picked, other].filter(Boolean).join(' · ')
      };
    })
    .filter((answer) => answer.answer);
}

function blockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'resource_link':
      return `[${block.name}](${block.uri})`;
    case 'resource':
      return 'text' in block.resource ? block.resource.text : `[${block.resource.uri}]`;
    case 'image':
      return '[image]';
    case 'audio':
      return '[audio]';
    default:
      return '';
  }
}

/** The bridge's notice a prompt is, from its text block's `codeflower/notice`. */
function promptNotice(prompt: ContentBlock[]): { title: string; summary: string | null } | undefined {
  for (const block of prompt) {
    const meta = block._meta?.[NOTICE_PROMPT_META];
    if (typeof meta === 'object' && meta !== null && 'title' in meta && typeof meta.title === 'string') {
      const summary = 'summary' in meta && typeof meta.summary === 'string' && meta.summary.trim() ? meta.summary : null;
      return { title: meta.title, summary };
    }
  }
}

/** The other chat a prompt comes from, from its text block's `codeflower/from`. */
export function promptFrom(prompt: ContentBlock[]): FromMeta | undefined {
  for (const block of prompt) {
    const meta = block._meta?.[FROM_META];
    if (
      typeof meta === 'object' &&
      meta !== null &&
      'kind' in meta &&
      (meta.kind === 'orchestrator' || meta.kind === 'executor') &&
      'key' in meta &&
      typeof meta.key === 'string'
    ) {
      return meta as FromMeta;
    }
  }
}

function promptAction(prompt: ContentBlock[]): ActionPromptMeta | undefined {
  for (const block of prompt) {
    const meta = block._meta?.[ACTION_PROMPT_META];
    if (
      typeof meta === 'object' &&
      meta !== null &&
      'id' in meta &&
      typeof meta.id === 'string' &&
      'title' in meta &&
      typeof meta.title === 'string'
    ) {
      return { id: meta.id, title: meta.title };
    }
  }
}

const tokens = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`);

/** Claude Code's `/compact` reports the context it freed as the tool call's output. */
function compactTitle(rawOutput: unknown): string | undefined {
  const output = rawOutput as { preTokens?: unknown; postTokens?: unknown } | null | undefined;
  if (typeof output?.preTokens !== 'number' || typeof output.postTokens !== 'number') return undefined;
  return `Compacted the conversation: ${tokens(output.preTokens)} → ${tokens(output.postTokens)} tokens`;
}

/** Files a tool call touched that a preview can show, e.g. a figure it wrote. */
function toolFiles(locations: ToolCallLocation[] | null | undefined): string[] {
  return [...new Set((locations ?? []).map((location) => location.path).filter(looksLikeFile))];
}

function toolDescription(rawInput: unknown): string | null {
  const description = (rawInput as { description?: unknown } | null | undefined)?.description;
  return typeof description === 'string' && description.trim() ? description.trim() : null;
}

const time = (t: string) => {
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
};
const finished = (status: string | null | undefined) => status === 'completed' || status === 'failed';

// A command's terminal content ({type: 'terminal'}) is its output, which comes
// as chunks (terminalOutput below), so it has no detail of its own.
function toolDetails(content: ToolCallContent[] | null | undefined): string[] {
  if (!content) return [];
  return content.flatMap((item) => {
    if (item.type === 'content') return [blockText(item.content)];
    if (item.type === 'diff') return [`edited ${item.path}`];
    return [];
  });
}

/** What the chat keeps of a command's output: its end. */
export const TOOL_OUTPUT_CHARS = 64 * 1024;

/**
 * A command's output and exit on its tool call, in the `_meta` convention Zed
 * started and agents such as Codex's adapter use: `terminal_output_delta` (or
 * `terminal_output`, sent to clients that ask for it) with `{terminal_id, data}`
 * chunks of text, and `terminal_exit` with `{exit_code}`.
 */
export function terminalOutput(meta: unknown): { data: string; exitCode: number | null | undefined } | null {
  if (!meta || typeof meta !== 'object') return null;
  const record = meta as Record<string, unknown>;
  const chunk = (record.terminal_output_delta ?? record.terminal_output) as { data?: unknown } | undefined;
  const exit = record.terminal_exit as { exit_code?: unknown } | undefined;
  const data = typeof chunk?.data === 'string' ? chunk.data : '';
  const exitCode = exit && typeof exit === 'object' ? (typeof exit.exit_code === 'number' ? exit.exit_code : null) : undefined;
  return data || exitCode !== undefined ? { data, exitCode } : null;
}

function addOutput(tool: Extract<ChatItem, { kind: 'tool' }>, meta: unknown): void {
  const terminal = terminalOutput(meta);
  if (!terminal) return;
  if (terminal.data) {
    const output = tool.output + terminal.data;
    tool.output = output.length > TOOL_OUTPUT_CHARS ? output.slice(-TOOL_OUTPUT_CHARS) : output;
  }
  if (terminal.exitCode !== undefined) tool.exitCode = terminal.exitCode;
}

/** `start` is the index of `entries[0]` in the transcript: ids stay the same as earlier entries load. */
/**
 * What the chat knows of a tool call: its `tool_call` and the updates after it.
 * A permission request may name only the call's id (dsh's do, as ACP allows),
 * so its card takes the title, kind, input and files from here.
 */
export function withKnownToolCall<T extends { toolCall: ToolCallUpdate | null }>(request: T, entries: TranscriptEntry[]): T {
  const id = request.toolCall?.toolCallId;
  if (!id) return request;
  const known: Partial<ToolCallUpdate> = {};
  for (const entry of entries) {
    if (entry.kind !== 'update') continue;
    const update = entry.update;
    if ((update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') || update.toolCallId !== id) continue;
    for (const key of ['title', 'kind', 'rawInput', 'content', 'locations'] as const) {
      if (update[key] !== undefined && update[key] !== null) Object.assign(known, { [key]: update[key] });
    }
  }
  const own = Object.fromEntries(Object.entries(request.toolCall!).filter(([, value]) => value !== undefined && value !== null));
  return { ...request, toolCall: { ...known, ...own, toolCallId: id } };
}

export function buildItems(entries: TranscriptEntry[], start = 0): ChatItem[] {
  const items: ChatItem[] = [];
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>();
  let pendingPermission: Extract<ChatItem, { kind: 'permission' }> | undefined;
  let pendingQuestion: Extract<ChatItem, { kind: 'question' }> | undefined;
  // The prompts of the agent's current turn: the first, and any sent while it worked.
  let prompted: Extract<ChatItem, { kind: PromptKind }>[] = [];
  // Where the current turn's items start.
  let turnStart = 0;
  const shells = new Map<string, Extract<ChatItem, { kind: 'shell' }>>();
  const subagents = new Map<string, Extract<ChatItem, { kind: 'subagent' }>>();

  entries.forEach((entry, index) => {
    const id = `${start + index}`;
    const last = items.at(-1);
    switch (entry.kind) {
      case 'prompt':
        {
          // The agent also got what the client added, e.g. the user's earlier shell
          // commands, which the chat shows as their own cards.
          const prompt = entry.prompt.filter((block) => !hiddenBlock(block));
          const text = prompt.map(blockText).join('\n');
          const from = promptFrom(prompt);
          const action = from ? undefined : promptAction(prompt);
          const notice = from || action ? undefined : promptNotice(prompt);
          const times = { started: time(entry.t), ended: null };
          const item: (typeof prompted)[number] = from
            ? { kind: 'peer', id, from, text, ...times }
            : action
              ? { kind: 'action', id, title: action.title, text, ...times }
              : notice
                ? { kind: 'notice', id, title: notice.title, summary: notice.summary, text, ...times }
                : { kind: 'user', id, text, ...times };
          prompted.push(item);
          items.push(item);
        }
        break;
      case 'turn_end': {
        const ended = time(entry.t);
        // A call the agent never finished, e.g. one the user stopped, ran until the turn ended.
        for (const tool of tools.values()) tool.ended ??= ended;
        // A message sent while the agent worked joined its turn, which ends for both.
        for (const prompt of prompted) prompt.ended ??= ended;
        if (entry.stopReason && entry.stopReason !== 'end_turn') {
          items.push({ kind: 'stop', id, reason: entry.stopReason.replace(/_/g, ' ') });
        }
        const first = prompted[0]?.started ?? null;
        const stamped = items.slice(turnStart).findLast((item) => item.kind === 'assistant' || item.kind === 'stop');
        if (stamped && ended !== null) stamped.stamp = { at: ended, took: first === null ? null : ended - first };
        prompted = [];
        turnStart = items.length;
        break;
      }
      case 'permission': {
        pendingPermission = {
          kind: 'permission',
          id,
          title: entry.toolCall?.title ?? 'a tool call',
          outcome: null,
          options: entry.options
        };
        items.push(pendingPermission);
        break;
      }
      case 'permission_outcome':
        if (pendingPermission) {
          pendingPermission.outcome =
            entry.outcome?.outcome === 'selected' ? entry.outcome.optionId : 'cancelled';
          pendingPermission = undefined;
        }
        break;
      case 'shell': {
        const shell = { kind: 'shell' as const, id, runId: entry.runId, command: entry.command, output: '', exitCode: null, timedOut: false };
        shells.set(entry.runId, shell);
        items.push(shell);
        break;
      }
      case 'shell_output': {
        const shell = shells.get(entry.runId);
        if (shell) shell.output += entry.data;
        break;
      }
      case 'shell_end': {
        const shell = shells.get(entry.runId);
        if (!shell) break;
        shell.exitCode = entry.exitCode;
        shell.timedOut = entry.timedOut;
        // Recorded history carries the output only here.
        if (entry.output !== undefined) shell.output = entry.output;
        break;
      }
      case 'show':
        items.push({ kind: 'show', id, files: entry.files, message: entry.message ?? null });
        break;
      case 'sent':
        items.push({ kind: 'sent', id, to: entry.to, what: entry.what, ...(entry.path ? { path: entry.path } : {}), text: entry.text ?? '', withheld: entry.withheld === true });
        break;
      case 'question':
        // The question card replaces the row of the tool call that asked it (e.g. AskUserQuestion).
        if (entry.toolCallId && tools.has(entry.toolCallId)) {
          const tool = tools.get(entry.toolCallId)!;
          items.splice(items.indexOf(tool), 1);
          tools.delete(entry.toolCallId);
        }
        pendingQuestion = {
          kind: 'question',
          id,
          message: entry.message,
          fields: formFields(entry.requestedSchema),
          answers: null,
          skipped: false
        };
        items.push(pendingQuestion);
        break;
      case 'question_outcome':
        if (pendingQuestion) {
          pendingQuestion.answers = answers(pendingQuestion.fields, entry.content, pendingQuestion.message);
          pendingQuestion.skipped = entry.action !== 'accept' || pendingQuestion.answers.length === 0;
          pendingQuestion = undefined;
        }
        break;
      case 'update': {
        const update = entry.update;
        const kind: string = update.sessionUpdate;
        if (kind === 'subagent_update') {
          const changed = update as unknown as SubagentUpdate;
          let subagent = subagents.get(changed.sessionId);
          if (!subagent) {
            subagent = {
              kind: 'subagent',
              id,
              sessionId: changed.sessionId,
              title: null,
              description: null,
              prompt: null,
              state: 'running',
              stopReason: null,
              reply: null,
              started: time(entry.t),
              ended: null
            };
            subagents.set(changed.sessionId, subagent);
            items.push(subagent);
          }
          if (changed.title) subagent.title = changed.title;
          if (changed.description) subagent.description = changed.description;
          const state = changed.state?.state;
          if (state) {
            subagent.state = state;
            const ended = state === 'idle' || state === 'unknown';
            subagent.ended = ended ? (subagent.ended ?? time(entry.t)) : null;
            subagent.stopReason = ended ? (changed.state?.stopReason ?? null) : null;
          }
          break;
        }
        if (kind === 'session_message') {
          const message = update as unknown as SessionMessage;
          const text = (message.content ?? []).map(blockText).join('\n');
          const to = message.recipientSessionId ? subagents.get(message.recipientSessionId) : undefined;
          const from = message.senderSessionId ? subagents.get(message.senderSessionId) : undefined;
          // The chat's task for a subagent, or its reply: both belong to its card.
          if (to) to.prompt ??= text;
          else if (from) from.reply = text;
          // In the subagent's own chat, its parent's message is its task.
          else if (text) items.push({ kind: 'task', id, text });
          break;
        }
        switch (update.sessionUpdate) {
          case 'agent_message_chunk': {
            const text = blockText(update.content);
            const messageId = update.messageId;
            // Chunks of one message join; a new message id, or a new turn, starts a new one.
            if (last?.kind === 'assistant' && items.length > turnStart && (!messageId || !last.messageId || last.messageId === messageId)) {
              // Claude Code sends the output of some local commands (e.g. `/context`) twice.
              if (text.length > 40 && text.trim() === last.text.trim()) break;
              last.text += text;
              last.messageId ??= messageId;
            } else items.push({ kind: 'assistant', id, text, messageId, at: time(entry.t) });
            break;
          }
          case 'agent_thought_chunk': {
            const text = blockText(update.content);
            if (last?.kind === 'thought') last.text += text;
            else items.push({ kind: 'thought', id, text });
            break;
          }
          case 'tool_call': {
            const tool = {
              kind: 'tool' as const,
              id,
              title: update.title,
              description: toolDescription(update.rawInput),
              status: update.status ?? 'pending',
              toolKind: update.kind ?? 'other',
              details: toolDetails(update.content),
              output: '',
              exitCode: null,
              files: toolFiles(update.locations),
              started: time(entry.t),
              ended: finished(update.status) ? time(entry.t) : null
            };
            addOutput(tool, update._meta);
            tools.set(update.toolCallId, tool);
            items.push(tool);
            break;
          }
          case 'tool_call_update': {
            const tool = tools.get(update.toolCallId);
            if (!tool) break;
            if (update.title) tool.title = update.title;
            tool.description = toolDescription(update.rawInput) ?? tool.description;
            if (update.status) tool.status = update.status;
            if (finished(update.status) && tool.ended === null) tool.ended = time(entry.t);
            if (update.content) tool.details = toolDetails(update.content);
            if (update.locations) tool.files = toolFiles(update.locations);
            addOutput(tool, update._meta);
            const compacted = compactTitle(update.rawOutput);
            if (compacted) tool.title = compacted;
            break;
          }
          case 'plan':
            if (last?.kind === 'plan') last.entries = update.entries;
            else items.push({ kind: 'plan', id, entries: update.entries });
            break;
        }
        break;
      }
    }
  });
  // The same, when the two copies came with different message ids.
  return items.filter((item, index) => {
    const previous = items[index - 1];
    const copy = item.kind === 'assistant' && previous?.kind === 'assistant' && previous.text.trim() === item.text.trim();
    // The turn's stamp stays on the copy that shows.
    if (copy && item.stamp) previous.stamp = item.stamp;
    return !copy;
  });
}

/**
 * A part of a folded turn: an item that always shows, or the steps between two
 * of them, folded into one row (its id is its first step's).
 */
export type TurnPart = { kind: 'item'; item: ChatItem } | { kind: 'steps'; id: string; steps: ChatItem[] };

/** One prompt and what the agent did for it, as the chat shows it with its steps folded. */
export interface Turn {
  /** The prompt's id, or `start` for the first page's entries from before its first prompt. */
  id: string;
  prompt: Extract<ChatItem, { kind: PromptKind }> | null;
  /**
   * Everything after the prompt, in order. The agent's messages, files shown to
   * the user, their own commands, a turn that stopped and a failed call that
   * ended the turn show; what lies between them (thinking, tool calls, plans,
   * subagents, answered requests) folds.
   */
  parts: TurnPart[];
  /** How many steps folded, over all of the turn's parts. */
  steps: number;
  /** Everything after the prompt, in order. */
  work: ChatItem[];
}

const SHOWN = new Set<ChatItem['kind']>(['assistant', 'show', 'shell', 'stop', 'task', 'sent']);

/** What starts a turn: the user's message, an action, a notice of the bridge's, another chat's message. */
export type PromptKind = 'user' | 'action' | 'notice' | 'peer';
export const isPrompt = (item: ChatItem): item is Extract<ChatItem, { kind: PromptKind }> =>
  item.kind === 'user' || item.kind === 'action' || item.kind === 'notice' || item.kind === 'peer';

/**
 * Splits the chat at each prompt, and each turn at what shows, so the agent's
 * messages keep their place between its steps. Output after a turn ended, with
 * no new prompt (e.g. Claude Code's after its background subagents), belongs
 * to that turn.
 */
export function foldTurns(items: ChatItem[]): Turn[] {
  const turns: Turn[] = [];
  let work: ChatItem[] = [];
  let prompt: Turn['prompt'] = null;
  const close = (over: boolean) => {
    if (!prompt && !work.length) return;
    // A step that failed and ended the turn is what the user needs to see, e.g.
    // a command that hit a limit. While the turn runs, the agent may still recover.
    const final = work.at(-1);
    const failed = over && final?.kind === 'tool' && final.status === 'failed' ? final : undefined;
    const parts: TurnPart[] = [];
    for (const item of work) {
      const last = parts.at(-1);
      if (SHOWN.has(item.kind) || item === failed) parts.push({ kind: 'item', item });
      else if (last?.kind === 'steps') last.steps.push(item);
      else parts.push({ kind: 'steps', id: item.id, steps: [item] });
    }
    const steps = work.filter((item) => !SHOWN.has(item.kind) && item !== failed).length;
    turns.push({ id: prompt?.id ?? 'start', prompt, parts, steps, work });
  };
  for (const item of items) {
    // A notice of the bridge's, or another chat's message, starts a turn as the user's prompt does: the agent works on it.
    if (isPrompt(item)) {
      close(true);
      prompt = item;
      work = [];
    } else work.push(item);
  }
  close(prompt?.ended != null);
  return turns;
}

/** A line on what the agent does now, from its latest step; null when there is none yet. */
export function activity(work: ChatItem[]): string | null {
  const step = work.findLast((item) => item.kind === 'assistant' || !SHOWN.has(item.kind));
  switch (step?.kind) {
    case 'tool':
      return step.description ?? step.title;
    case 'thought':
      return 'Thinking…';
    case 'assistant':
      // The message itself shows as it streams.
      return 'Writing…';
    case 'plan': {
      const now = step.entries.find((entry) => entry.status === 'in_progress');
      return now ? now.content : 'Planning';
    }
    case 'subagent':
      return `Subagent: ${step.title ?? step.description ?? 'working'}`;
    case 'permission':
      return step.outcome === null ? 'Waiting for permission' : step.title;
    case 'question':
      return step.answers === null ? 'Waiting for an answer' : step.message;
    default:
      return null;
  }
}

/** A file the agent showed the user, for the header's list. */
export interface ShownFile {
  path: string;
  /** What the agent said when it last showed it. */
  message: string | null;
}

/**
 * The files the agent showed the user in these entries (in transcript order:
 * the page's `context`, then the page), each once, the latest shown first.
 */
export function shownFiles(entries: readonly TranscriptEntry[]): ShownFile[] {
  const files = new Map<string, ShownFile>();
  for (const entry of entries) {
    if (entry.kind !== 'show') continue;
    for (const path of entry.files) {
      files.delete(path);
      files.set(path, { path, message: entry.message ?? null });
    }
  }
  return [...files.values()].reverse();
}
