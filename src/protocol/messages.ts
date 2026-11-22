// Messages between a chat's host (the VS Code extension host, or the app's
// page) and the chat view. The view never sees worker tokens or credentials;
// it renders one session and sends user intents.
import type {
  ContentBlock,
  PermissionOption,
  RequestPermissionOutcome,
  SessionConfigOption,
  SessionUpdate,
  StopReason,
  ToolCallUpdate
} from '@agentclientprotocol/sdk';
import type { SubagentSettings, SubagentSettingsState, SubagentSummary } from './subagents.ts';
import type { AgentCommand } from './commands.ts';
import type { BatchJob } from './jobs.ts';
import type { ChatUsage } from './usage.ts';

/** The agent's id, as its worker reports it (claude, codex, dsh, …). The chat knows no agent by name. */
export type AgentName = string;

/** How the chat presents an agent; the worker reports it from the agent's descriptor. */
export interface AgentPresentation {
  id: AgentName;
  /** Product name, e.g. "Claude Code". */
  name?: string;
  /** The agent's accent: one of the chat's palette names (orange, teal, …), or any CSS color. */
  color?: string;
  /** Its logo: an SVG as a data URL, shown in an <img> (where it runs no script). */
  icon?: string;
  /** The logo is drawn in currentColor, which an <img> does not inherit: it is shown as a mask in the text's color. */
  iconMono?: boolean;
}

/** The palette's accents, which follow the light or dark theme. */
const PALETTE = ['orange', 'teal', 'indigo', 'violet', 'pink', 'cyan', 'green', 'yellow', 'red'];

function accent(color: string): string {
  return PALETTE.includes(color) ? `var(--cf-${color})` : color;
}

/**
 * For workers from before agent descriptors, which report only the id. New
 * agents bring their presentation with them and never need an entry here.
 */
const LEGACY_PRESENTATION: Record<string, AgentPresentation> = {
  claude: { id: 'claude', name: 'Claude Code', color: 'orange' },
  codex: { id: 'codex', name: 'Codex', color: 'teal' },
  dsh: { id: 'dsh', name: 'DeepSeek Harness', color: 'indigo' }
};

/** The agent's presentation, filling what the worker did not report. */
export function agentPresentation(id: AgentName | undefined, reported?: Partial<AgentPresentation>): AgentPresentation | undefined {
  if (!id) return undefined;
  const known = Object.fromEntries(Object.entries(reported ?? {}).filter(([, value]) => value));
  const presentation: AgentPresentation = { ...LEGACY_PRESENTATION[id], ...known, id };
  if (presentation.color) presentation.color = accent(presentation.color);
  return presentation;
}

// One rendered chat item. Recorded transcripts and live traffic share this
// shape, so the webview renders both the same way.
export type TranscriptEntry =
  | { t: string; kind: 'prompt'; prompt: ContentBlock[] }
  | { t: string; kind: 'update'; update: SessionUpdate }
  | { t: string; kind: 'turn_end'; stopReason: StopReason | null }
  | { t: string; kind: 'permission'; toolCall: ToolCallUpdate | null; options: PermissionOption[] }
  | { t: string; kind: 'permission_outcome'; outcome: RequestPermissionOutcome | null }
  | { t: string; kind: 'question'; message: string; requestedSchema: FormSchema; toolCallId?: string }
  // The user's own shell commands (`!command`); output streams live and is recorded at the end.
  | { t: string; kind: 'shell'; runId: string; command: string }
  | { t: string; kind: 'shell_output'; runId: string; data: string }
  | { t: string; kind: 'shell_end'; runId: string; exitCode: number; timedOut: boolean; output?: string }
  | { t: string; kind: 'question_outcome'; action: QuestionAction; content: FormContent | null }
  // Files the agent showed the user with `codeflower-show`; the client records which chat they belong to.
  | { t: string; kind: 'show'; files: string[]; message?: string };

/** Marks the prompt block that tells the agent about the user's shell commands. */
export const SHELL_CONTEXT_META = 'codeflower/shellContext';

/** Marks the block before a message the user sent while the agent worked (ACP steering). */
export const STEER_NOTE_META = 'codeflower/steerNote';

/**
 * What the agent reads before such a message: most add to the task rather than
 * stop it, but an agent that is interrupted mid-step tends to take the message
 * as all there is left to do.
 */
export const STEER_NOTE =
  'The user sent this message while you were working. It adds to your task; it does not stop it. ' +
  'Take it into account and carry on with what you were doing, including waiting for background tasks ' +
  'and subagents, unless the message asks you to stop, wait, or change course.';

/** A block the client adds to a prompt for the agent, which the user did not write and the chat does not show. */
export function hiddenBlock(block: { _meta?: Record<string, unknown> | null }): boolean {
  return Boolean(block._meta?.[SHELL_CONTEXT_META] || block._meta?.[STEER_NOTE_META]);
}

/** Work of the agent's that goes on after its turn ends, e.g. Claude Code's background commands. */
export interface BackgroundTask {
  id: string;
  name: string;
  /** e.g. `shell`, `monitor`, `workflow`. */
  taskType: string;
  description?: string;
}

/** An agent's question as an ACP form elicitation, e.g. Claude Code's AskUserQuestion. */
export interface PendingQuestion {
  requestId: number;
  message: string;
  requestedSchema: FormSchema;
  /** Asked by one of the chat's subagents, shown in the chat the user works in. */
  subagent?: RequestingSubagent;
}

/** The subagent behind a request shown in its parent's chat. */
export interface RequestingSubagent {
  key: string;
  title?: string;
}

export type QuestionAction = 'accept' | 'decline' | 'cancel';
export type FormContent = Record<string, string | number | boolean | string[]>;

/** The JSON Schema subset ACP forms use: an object of primitive fields. */
export interface FormSchema {
  type?: 'object';
  properties?: Record<string, FormProperty>;
  required?: string[];
}

export interface FormProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  title?: string;
  description?: string;
  enum?: string[];
  oneOf?: FormChoice[];
  items?: { enum?: string[]; anyOf?: FormChoice[] };
}

export interface FormChoice {
  const: string;
  title?: string;
  description?: string;
}

export interface FormField {
  key: string;
  title: string | null;
  description: string | null;
  kind: 'single' | 'multi' | 'text' | 'number' | 'boolean';
  choices: { value: string; title: string; description: string | null }[];
  required: boolean;
  /** The free-text "Other" field that belongs to this question, if any. */
  other: FormField | null;
}

/** Reads a form schema; `<key>_custom` text fields attach to `<key>` as its "Other" box. */
export function formFields(schema: FormSchema): FormField[] {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const field = (key: string, property: FormProperty): FormField => {
    const options = property.oneOf ?? property.items?.anyOf;
    const values = property.enum ?? property.items?.enum;
    const choices = options
      ? options.map((choice) => ({ value: choice.const, title: choice.title ?? choice.const, description: choice.description ?? null }))
      : (values ?? []).map((value) => ({ value, title: value, description: null }));
    const kind: FormField['kind'] =
      property.type === 'array'
        ? 'multi'
        : choices.length
          ? 'single'
          : property.type === 'boolean'
            ? 'boolean'
            : property.type === 'number' || property.type === 'integer'
              ? 'number'
              : 'text';
    return {
      key,
      title: property.title ?? null,
      description: property.description ?? null,
      kind,
      choices,
      required: required.has(key),
      other: null
    };
  };
  const fields: FormField[] = [];
  const byKey = new Map<string, FormField>();
  for (const [key, property] of Object.entries(properties)) {
    const owner = key.endsWith('_custom') ? byKey.get(key.slice(0, -'_custom'.length)) : undefined;
    if (owner && property.type === 'string' && !owner.other) {
      owner.other = field(key, property);
      continue;
    }
    const created = field(key, property);
    byKey.set(key, created);
    fields.push(created);
  }
  return fields;
}

export interface PendingPermission {
  requestId: number;
  toolCall: ToolCallUpdate | null;
  options: PermissionOption[];
  /** Asked by one of the chat's subagents, shown in the chat the user works in. */
  subagent?: RequestingSubagent;
}

export interface ChatState {
  title: string;
  subtitle: string;
  /** The agent's name and color in the header; unknown while the worker connects. */
  agent?: AgentPresentation;
  /** Actions this worker image offers; absent when its bridge predates actions. */
  actions?: ChatAction[];
  /** DSH permission requests are approved automatically unless the user turns this off. */
  autoApprove?: boolean;
  /** The session runs on the connected worker and accepts prompts. */
  live: boolean;
  busy: boolean;
  /** The agent takes a message while it works (ACP steering); without, sending one now stops the turn first. */
  steer?: boolean;
  /** The agent's work that runs on after its turn, e.g. background commands (not subagents, which `subagents` lists). */
  background?: BackgroundTask[];
  /** The commands the agent runs, and the last few that ended (bridges that tell of them). */
  commands?: AgentCommand[];
  /** The batch jobs this chat asked for (codeflower-job): active, and those that ended in the last day. */
  jobs?: BatchJob[];
  /** A subagent's chat, which only shows what it does: its summary, and its parent's title. */
  subagent?: SubagentSummary & { parentTitle?: string };
  /** The chat's sandbox opens shells for the user: the header's terminal button (`openShell`). */
  shells?: boolean;
  /**
   * The chat's browser (codeflower-browser), while it runs: the header's browser button
   * (`openBrowser`). `needsYou`: the agent handed it to the user; `yours`: this window controls it.
   */
  browser?: { running: boolean; needsYou?: boolean; yours?: boolean };
  /** The chat shows only each turn's prompt and final message, its steps folded (VS Code keeps the choice). */
  foldSteps?: boolean;
  /** The models the user pinned for this chat's agent, listed first in the model picker (VS Code keeps them). */
  favoriteModels?: string[];
}

export interface ChatAction {
  id: string;
  title: string;
  description: string;
  icon: string;
  mode: 'queue' | 'interrupt';
  prompt: string;
}

export interface ActionPromptMeta {
  id: string;
  title: string;
}

export interface QueuedPromptSummary {
  id: string;
  title: string;
  /** The user wrote it in the composer, and can take it back to edit. */
  editable?: boolean;
}

/** Why a chat's queue on the worker waits: a turn ended otherwise than with end_turn. */
export interface QueuePaused {
  stopReason: string | null;
}

export const ACTION_PROMPT_META = 'codeflower/action';

/** A notice's button: sign the agent in, or take a chat open on another sandbox over. */
export type NoticeAction = 'signIn' | 'takeOver';
export const NOTICE_ACTION_LABELS: Record<NoticeAction, string> = { signIn: 'Sign in', takeOver: 'Take over' };

/** What the session is doing, shown on its tab and in its header. */
export type SessionStatus = 'ready' | 'waiting' | 'working' | 'offline';

export function sessionStatus(state: ChatState, waitingForUser: boolean): SessionStatus {
  if (!state.live) return 'offline';
  if (waitingForUser) return 'waiting';
  return state.busy ? 'working' : 'ready';
}

/** A chat of the same sandbox, as the header's list of them shows it. */
export interface SandboxChat {
  key: string;
  title: string;
  agent?: AgentPresentation;
  /** Its last prompt or reply (ISO); the list shows the latest first. */
  updatedAt?: string;
  /** Known for chats open in this window, and those the sandbox says are working or waiting. */
  status?: SessionStatus;
  /** The chat that shows the list. */
  current?: boolean;
}

export type HostMessage =
  | { type: 'state'; state: ChatState }
  /**
   * The chat's newest entries; `start` is the index of the first in the whole
   * transcript, and earlier ones load on `loadEarlier`. `context` holds what the
   * view needs from before them (the agent's slash commands), not shown.
   */
  | { type: 'transcript'; entries: TranscriptEntry[]; start?: number; context?: TranscriptEntry[] }
  /** Entries before those shown, from `start`, in answer to `loadEarlier`. */
  | { type: 'earlier'; entries: TranscriptEntry[]; start: number }
  | { type: 'entry'; entry: TranscriptEntry }
  | { type: 'permission'; request: PendingPermission | null }
  | { type: 'question'; request: PendingQuestion | null }
  /** The session's settings the agent offers: mode, model, effort, … */
  | { type: 'config'; options: SessionConfigOption[] }
  /** The chat's tokens and cost, and its worker's quota. */
  | { type: 'usage'; usage: ChatUsage }
  | { type: 'notice'; level: 'info' | 'error'; message: string; action?: { id: NoticeAction; label: string } }
  /** The notice no longer holds, e.g. the chat reconnected. */
  | { type: 'clearNotice' }
  /** `together`: all of them go in the next turn, as one prompt, instead of one per turn. */
  | { type: 'queue'; items: QueuedPromptSummary[]; paused?: QueuePaused; together?: boolean }
  /** Text for the composer: a queued message to edit, or those a stop took off the queue. */
  | { type: 'draft'; text: string }
  /** A file from the sandbox the chat asked for, e.g. a figure the agent looked at; null if unavailable. */
  | { type: 'fileData'; key: string; dataUrl: string | null }
  /** The chat's subagents, running and ended. */
  | { type: 'subagents'; subagents: SubagentSummary[] }
  /** The defaults of the worker's subagents; null when its agent has none in code flower. */
  | { type: 'subagentSettings'; state: SubagentSettingsState | null }
  /** The sandbox's chats, in answer to `listChats` (again when the host learns more). */
  | { type: 'chats'; chats: SandboxChat[] };

export type WebviewMessage =
  | { type: 'ready' }
  /** The user scrolled to the top of the transcript, and there is more before it. */
  | { type: 'loadEarlier' }
  /** While the agent works it waits for the turn to end, unless sent `now`. */
  | { type: 'prompt'; text: string; now?: boolean }
  | { type: 'cancel' }
  | { type: 'permissionResponse'; requestId: number; optionId: string | null }
  | { type: 'setConfig'; configId: string; value: string | boolean }
  | { type: 'shell'; command: string }
  | { type: 'cancelShell'; runId: string }
  | { type: 'questionResponse'; requestId: number; action: QuestionAction; content: FormContent | null }
  /** A file path in the chat was clicked: show it in a preview tab. */
  | { type: 'openFile'; path: string }
  /** With `thumbnail`, a small version at most that many pixels high, for the chat to show. */
  | { type: 'fileData'; path: string; key: string; thumbnail?: number }
  | { type: 'setAutoApprove'; enabled: boolean }
  /** The eye button in the chat's header: fold the turns' steps, or show them. */
  | { type: 'foldSteps'; fold: boolean }
  /** A model pinned in the model picker, or unpinned, for every chat of this agent. */
  | { type: 'favoriteModel'; value: string; favorite: boolean }
  | { type: 'action'; id: string }
  | { type: 'removeQueued'; id: string }
  /** Send a queued message now, as `prompt` with `now` does. */
  | { type: 'sendQueued'; id: string }
  | { type: 'editQueued'; id: string }
  /** Go on with a queue the worker paused after a turn that did not end normally. */
  | { type: 'resumeQueue' }
  /** All the queued messages in the next turn, as one, or one per turn. */
  | { type: 'queueTogether'; together: boolean }
  /** Show a subagent's chat, or a subagent's parent's. */
  | { type: 'openSubagent'; key: string }
  | { type: 'openParent' }
  | { type: 'stopSubagent'; key: string }
  /** Show a command the agent runs, its output so far and the rest as it comes (read-only). */
  | { type: 'openCommand'; commandId: string }
  /** Cancel one of the chat's batch jobs (`jobs`); its output stays. */
  | { type: 'cancelJob'; id: string }
  /** Open a shell in the chat's sandbox, where the window keeps its terminals (`shells`). */
  | { type: 'openShell' }
  /** Show the chat's browser (`browser`). */
  | { type: 'openBrowser' }
  | { type: 'subagentSettings'; settings: Partial<SubagentSettings> }
  /** Restart the agent so settings it reads at start apply. */
  | { type: 'restartAgent' }
  /** The sandbox's chats, for the header's list (answered with `chats`). */
  | { type: 'listChats' }
  /** Show another chat of the sandbox: bring its tab to the front, or open one. */
  | { type: 'openChat'; key: string };

/** A file in the sandbox, as `_codeflower/files/stat` and `codeflower-show` report it. */
export interface SandboxFile {
  path: string;
  size: number;
  mtimeMs: number;
  mimeType: string;
  /** The user may save it (the workspace or an output folder); missing from older sandboxes. */
  writable?: boolean;
}

/** What a preview tab shows: one file the agent (or the user) opened. */
export interface PreviewState {
  file: SandboxFile;
  /** Base64 contents; null while loading or when the file cannot be shown. */
  data: string | null;
  error: string | null;
  title: string;
  /** The agent's note about the file, from `codeflower-show --message`. */
  message: string | null;
  /** Where the user's feedback goes; null when no chat of the worker is open. */
  chat: { title: string; busy: boolean } | null;
  /** The worker is connected and the file is watched for changes. */
  live: boolean;
  /** An HTML file shows with its scripts running (a report's charts, explorers and comments). */
  interactive?: boolean;
  /** The batch job whose output the file is (jobOfFile): the tab says whether more is coming. */
  job?: BatchJob;
}

export type PreviewHostMessage =
  | { type: 'preview'; state: PreviewState }
  /** A file a report refers to (e.g. an image in Markdown), as a data URL. */
  | { type: 'asset'; path: string; dataUrl: string | null }
  | { type: 'feedbackSent'; queued: boolean }
  /** The user's edits were saved; `file` is the new version. */
  | { type: 'written'; file: SandboxFile }
  /** Not saved; `conflict` when the file changed in the sandbox since it was opened. */
  | { type: 'writeFailed'; error: string; conflict: boolean };

/** An element of an SVG figure the user selected to give feedback on. */
export interface FeedbackElement {
  id: string;
  /** Its `data-label`, the name the figure gives it. */
  label?: string;
  tag?: string;
}

/** An area the user marked on a figure, as fractions of its width and height (0 to 1). */
export interface FeedbackRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The same area in the file's own units: image pixels, or SVG user units. */
  units?: { x: number; y: number; width: number; height: number; unit: 'px' | 'svg' };
}

/** Which figure of a report the comments are about. */
export interface FeedbackFigure {
  /** Its number among the report's figures, from 1. */
  index: number;
  caption?: string;
  /** The storyteller part it is in (`data-cf-part`), and the nearest anchor. */
  part?: string;
  anchor?: string;
}

/** One comment the user attached to a part of a figure. */
export interface FeedbackAnnotation {
  comment: string;
  elements?: FeedbackElement[];
  region?: FeedbackRegion;
}

export type PreviewWebviewMessage =
  | { type: 'ready' }
  /** Show the HTML file with its scripts running (`on`), or as a static page. */
  | { type: 'interactive'; on: boolean }
  /** The comments the user left on the interactive report (JSON), to save into it. */
  | { type: 'reportComments'; json: string }
  /** Print the interactive report, which a webview cannot: the host prints a copy elsewhere. */
  | { type: 'print' }
  /** Save a file beside the report (a deck's .pptx), named relative to it. */
  | { type: 'download'; path: string }
  | { type: 'feedback'; text: string; annotations?: FeedbackAnnotation[]; figure?: FeedbackFigure }
  | { type: 'asset'; path: string }
  | { type: 'openFile'; path: string }
  | { type: 'save' }
  /** Save a report's figure as it was clicked (base64), under a plain file name. */
  | { type: 'saveFigure'; name: string; mimeType: string; data: string }
  /** Save the user's edits into the sandbox, over the version with `baseMtimeMs`. */
  | { type: 'write'; text: string; baseMtimeMs: number }
  /** The editor has edits that are not saved: the host asks before closing the tab. */
  | { type: 'dirty'; dirty: boolean }
  | { type: 'showChat' };
