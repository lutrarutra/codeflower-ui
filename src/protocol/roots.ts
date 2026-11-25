// Roots: the project's map of analysis ideas, which the agents keep with
// codeflower-roots (sandbox/dsh-plugins/acp-ws/src/roots-store.js) and the user
// watches in the Roots view (chat/Roots.svelte). Between the view and its host
// (the VS Code extension host, or the app's page in the same window): the view
// calls the host's methods, which the host answers from the worker
// (`serveRoots` in client/rootsService.ts).

export type IdeaStatus = 'idea' | 'active' | 'blocked' | 'done' | 'dropped';

export const IDEA_STATUSES: IdeaStatus[] = ['idea', 'active', 'blocked', 'done', 'dropped'];

/** Another idea that must be done first, or a condition. */
export interface IdeaNeed {
  idea?: number;
  text?: string;
  met?: boolean;
}

export interface IdeaTodo {
  text: string;
  done: boolean;
}

/** A chat that worked on the idea, the latest last; `key` when the worker knows the chat. */
export interface IdeaChat {
  agent?: string;
  sessionId?: string;
  at: string;
  key?: string;
}

export interface IdeaComment {
  by: 'user' | 'agent';
  agent?: string;
  text: string;
  at: string;
}

export interface Idea {
  id: number;
  title: string;
  status: IdeaStatus;
  /** The ideas it builds on; none: it starts from the data. */
  from: number[];
  needs: IdeaNeed[];
  todos: IdeaTodo[];
  /** Relative to the workspace, or absolute in the sandbox. */
  files: string[];
  chats: IdeaChat[];
  comments: IdeaComment[];
  created: string;
  updated: string;
  /** Markdown. */
  conclusion: string;
  /** Its file in roots/. */
  file: string;
}

export interface RootsMap {
  ideas: Idea[];
  /** Files in roots/ that could not be read. */
  errors: { file: string; error: string }[];
  /** The workspace in the sandbox, which relative files are in. */
  workspace?: string;
}

/** The user's change to an idea; todos and needs by their index. */
export interface IdeaPatch {
  title?: string;
  status?: IdeaStatus;
  from?: number[];
  todo?: { index: number; done: boolean };
  need?: { index: number; met: boolean };
}

/** What the view shows of a chat the host knows. */
export interface RootsChat {
  key: string;
  title: string;
  agentLabel?: string;
  state: 'working' | 'waiting' | 'idle';
}

export type RootsMethod = 'list' | 'update' | 'comment';

export type RootsWebviewMessage =
  | { type: 'ready' }
  | { type: 'call'; id: number; method: RootsMethod; params?: Record<string, unknown> }
  | { type: 'openChat'; key: string }
  /** A new chat whose message, ready to send, continues the idea. */
  | { type: 'newChat'; idea: number; title: string }
  /** A file of an idea, by its path in the sandbox. */
  | { type: 'openFile'; path: string };

export type RootsHostMessage =
  /** Which sandbox this is, for the view's header. */
  | { type: 'context'; label: string }
  | { type: 'map'; map: RootsMap }
  /** The chats the host knows, with their state: on start and when they change. */
  | { type: 'chats'; chats: RootsChat[] }
  /** Shows an idea, e.g. from a chat's badge. */
  | { type: 'focus'; idea: number }
  | { type: 'result'; id: number; result?: unknown; error?: string };

/** The first message of a new chat on an idea. */
export function continuePrompt(idea: number, title: string): string {
  return `Continue idea ${idea} (${title}) from Roots: read it with \`codeflower-roots show ${idea}\` and keep it current as you work.`;
}

/** An idea's file as a path in the sandbox. */
export function ideaFilePath(path: string, workspace: string | undefined): string {
  if (path.startsWith('/') || !workspace) return path;
  return `${workspace.replace(/\/+$/, '')}/${path}`;
}

/** Whether a need is met: an idea's when that idea is done. */
export function needMet(need: IdeaNeed, ideas: Map<number, Idea>): boolean {
  if (need.idea !== undefined) return ideas.get(need.idea)?.status === 'done';
  return need.met === true;
}

/** The user's comments after the agents' last answer. */
export function unansweredComments(idea: Idea): IdeaComment[] {
  let last = -1;
  idea.comments.forEach((comment, index) => {
    if (comment.by !== 'user') last = index;
  });
  return idea.comments.slice(last + 1).filter((comment) => comment.by === 'user');
}
