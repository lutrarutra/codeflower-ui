// The search (Ctrl+K): chats by title, fuzzily, from the lists the page has of
// every sandbox; and, from each sandbox the page is connected to, files by
// name (fuzzily, ranked again here so sandboxes compare) and what files and
// chats say (src/search.js in the bridge). Each answer is for the query it was
// asked with: a slower one for an older query is dropped.
import type { FoundInChat, FoundInFile, FoundText } from '../../client/workerConnection.ts';
import type { Worker } from './api.ts';
import { fuzzyMatch, pathMatch } from './fuzzy.ts';
import type { WebWorker } from './worker.svelte.ts';

/** File names are asked for after this long without typing; contents after the longer. */
const NAMES_MS = 80;
const TEXT_MS = 250;
/** Text needs this many letters. */
export const TEXT_FROM = 3;
const CHATS_SHOWN = 8;
const RECENT_SHOWN = 10;
const FILES_SHOWN = 12;
const IN_CHATS_SHOWN = 12;
const IN_FILES_SHOWN = 30;

interface Where {
  workerId: string;
  /** The sandbox's name, shown when there are several. */
  sandbox: string;
}

export type SearchItem =
  | (Where & { kind: 'chat'; id: string; key: string; title: string; harness: string; updatedAt: string; positions: number[] })
  | (Where & { kind: 'file'; id: string; path: string; relative: string; folder: string; positions: number[] })
  | (Where & { kind: 'chatText'; id: string; key: string; title: string; harness: string; count: number; place: FoundInChat['places'][number] })
  | (Where & { kind: 'fileText'; id: string; path: string; relative: string; folder: string; line: FoundText & { line: number } });

export interface SearchSection {
  id: 'chats' | 'files' | 'chatText' | 'fileText';
  title: string;
  items: SearchItem[];
  /** More than shown: the user should narrow the search. */
  more?: boolean;
}

/** What the search needs from the page. */
export interface SearchOwner {
  workers(): Worker[];
  agent(id: string): WebWorker;
  /** The sandbox's name. */
  name(worker: Worker): string;
}

export class Search {
  query = $state('');
  /** File names from the sandboxes, for `query` (asked as `namesFor`). */
  private names = $state<SearchItem[]>([]);
  private namesFor = $state('');
  private inChats = $state<SearchItem[]>([]);
  private inFiles = $state<SearchItem[]>([]);
  private textFor = $state('');
  private textMore = $state({ chats: false, files: false });
  /** Sandboxes still answering. */
  pending = $state(0);
  /** Problems to tell, e.g. a sandbox without ripgrep. */
  problems = $state<string[]>([]);
  private namesTimer: ReturnType<typeof setTimeout> | undefined;
  private textTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly owner: SearchOwner) {}

  /** The sandboxes that may have chats. */
  private chatty(): Worker[] {
    return this.owner.workers().filter((worker) => !!worker.url && worker.kind !== 'task');
  }

  /** The sandboxes the page is connected to that answer searches. */
  private searchable(): { worker: Worker; agent: WebWorker }[] {
    return this.chatty()
      .map((worker) => ({ worker, agent: this.owner.agent(worker.id) }))
      .filter(({ agent }) => agent.connected && agent.connection?.canSearch);
  }

  /** Sandboxes whose files and chats' text are not searched, to say so. */
  readonly unsearched = $derived.by(() => this.chatty().filter((worker) => !this.owner.agent(worker.id).connected || !this.owner.agent(worker.id).connection?.canSearch).length);

  private where(worker: Worker): Where {
    return { workerId: worker.id, sandbox: this.owner.workers().length > 1 ? this.owner.name(worker) : '' };
  }

  /** Chats by title: fuzzily, or the latest when nothing is typed. */
  readonly chats = $derived.by((): { items: SearchItem[]; more: boolean } => {
    const query = this.query.trim();
    const all = this.chatty().flatMap((worker) =>
      this.owner.agent(worker.id).sessions.map((session) => ({ worker, session }))
    );
    if (!query) {
      const recent = all.sort((a, b) => Date.parse(b.session.updatedAt) - Date.parse(a.session.updatedAt));
      return { items: recent.slice(0, RECENT_SHOWN).map(({ worker, session }) => this.chatItem(worker, session, [])), more: false };
    }
    const scored = all
      .map(({ worker, session }) => ({ worker, session, match: fuzzyMatch(query, session.title) }))
      .filter((entry) => entry.match !== null)
      .sort((a, b) => b.match!.score - a.match!.score || Date.parse(b.session.updatedAt) - Date.parse(a.session.updatedAt));
    return { items: scored.slice(0, CHATS_SHOWN).map(({ worker, session, match }) => this.chatItem(worker, session, match!.positions)), more: scored.length > CHATS_SHOWN };
  });

  private chatItem(worker: Worker, session: { key: string; title: string; harness: string; updatedAt: string }, positions: number[]): SearchItem {
    return {
      kind: 'chat',
      id: `chat:${worker.id}:${session.key}`,
      key: session.key,
      title: session.title,
      harness: session.harness,
      updatedAt: session.updatedAt,
      positions,
      ...this.where(worker)
    };
  }

  /** What the search shows, in order; the keys go through them all. */
  readonly sections = $derived.by((): SearchSection[] => {
    const query = this.query.trim();
    const sections: SearchSection[] = [{ id: 'chats', title: query ? 'Chats' : 'Recent chats', items: this.chats.items, more: this.chats.more }];
    if (!query) return sections;
    // Answers for an older query stay until the new ones come, so the list does not jump.
    sections.push({ id: 'files', title: 'Files', items: this.names });
    if (query.length >= TEXT_FROM) {
      sections.push({ id: 'chatText', title: 'In chats', items: this.inChats, more: this.textMore.chats });
      sections.push({ id: 'fileText', title: 'In files', items: this.inFiles, more: this.textMore.files });
    }
    return sections.filter((section) => section.items.length);
  });

  readonly items = $derived(this.sections.flatMap((section) => section.items));

  /** Whether the answers shown are for what is typed. */
  get settled(): boolean {
    const query = this.query.trim();
    return this.pending === 0 && this.namesFor === query && (query.length < TEXT_FROM || this.textFor === query);
  }

  /** Lists the chats again, as the page does elsewhere, so the titles are current. */
  refreshChats(): void {
    for (const worker of this.chatty()) if (worker.status === 'ready') void this.owner.agent(worker.id).listSessions();
  }

  /** The user typed: ask the sandboxes, once typing pauses. */
  update(query: string): void {
    this.query = query;
    clearTimeout(this.namesTimer);
    clearTimeout(this.textTimer);
    const trimmed = query.trim();
    if (!trimmed) {
      this.names = [];
      this.inChats = [];
      this.inFiles = [];
      this.namesFor = this.textFor = '';
      this.problems = [];
      return;
    }
    this.namesTimer = setTimeout(() => void this.askNames(trimmed), NAMES_MS);
    if (trimmed.length >= TEXT_FROM) this.textTimer = setTimeout(() => void this.askText(trimmed), TEXT_MS);
    else {
      this.inChats = [];
      this.inFiles = [];
    }
  }

  close(): void {
    clearTimeout(this.namesTimer);
    clearTimeout(this.textTimer);
    this.pending = 0;
  }

  private current(query: string): boolean {
    return this.query.trim() === query;
  }

  private async askNames(query: string): Promise<void> {
    const targets = this.searchable();
    this.pending++;
    const problems: string[] = [];
    try {
      const answers = await Promise.all(
        targets.map(async ({ worker, agent }) => {
          try {
            return { worker, files: (await agent.connection!.searchPaths(query)).files };
          } catch (error) {
            problems.push(`${this.owner.name(worker)}: ${error instanceof Error ? error.message : String(error)}`);
            return { worker, files: [] };
          }
        })
      );
      if (!this.current(query)) return;
      const ranked = answers
        .flatMap(({ worker, files }) =>
          files.map((file) => {
            const match = pathMatch(query, file.relative);
            return { worker, file, match };
          })
        )
        .filter((entry) => entry.match !== null)
        .sort((a, b) => b.match!.score - a.match!.score);
      this.names = ranked.slice(0, FILES_SHOWN).map(({ worker, file, match }) => ({
        kind: 'file' as const,
        id: `file:${worker.id}:${file.path}`,
        path: file.path,
        relative: file.relative,
        folder: file.folder,
        positions: match!.positions,
        ...this.where(worker)
      }));
      this.namesFor = query;
      this.problems = problems;
    } finally {
      this.pending--;
    }
  }

  private async askText(query: string): Promise<void> {
    const targets = this.searchable();
    this.pending++;
    try {
      const answers = await Promise.all(
        targets.map(async ({ worker, agent }) => {
          const [chats, files] = await Promise.all([
            agent.connection!.searchChats(query).catch(() => ({ chats: [] as FoundInChat[], truncated: false })),
            agent.connection!.searchContents(query).catch(() => ({ files: [] as FoundInFile[], truncated: false, superseded: false }))
          ]);
          return { worker, chats, files };
        })
      );
      if (!this.current(query)) return;
      const inChats = answers
        .flatMap(({ worker, chats }) => chats.chats.map((chat) => ({ worker, chat })))
        .sort((a, b) => Date.parse(b.chat.updatedAt) - Date.parse(a.chat.updatedAt));
      this.inChats = inChats.slice(0, IN_CHATS_SHOWN).map(({ worker, chat }) => ({
        kind: 'chatText' as const,
        id: `chatText:${worker.id}:${chat.key}`,
        key: chat.key,
        title: chat.title,
        harness: chat.harness,
        count: chat.count,
        place: chat.places[0]!,
        ...this.where(worker)
      }));
      const lines = answers.flatMap(({ worker, files }) => files.files.flatMap((file) => file.lines.map((line) => ({ worker, file, line }))));
      this.inFiles = lines.slice(0, IN_FILES_SHOWN).map(({ worker, file, line }) => ({
        kind: 'fileText' as const,
        id: `fileText:${worker.id}:${file.path}:${line.line}`,
        path: file.path,
        relative: file.relative,
        folder: file.folder,
        line,
        ...this.where(worker)
      }));
      this.textMore = {
        chats: inChats.length > IN_CHATS_SHOWN || answers.some(({ chats }) => chats.truncated),
        files: lines.length > IN_FILES_SHOWN || answers.some(({ files }) => files.truncated)
      };
      this.textFor = query;
    } finally {
      this.pending--;
    }
  }
}
