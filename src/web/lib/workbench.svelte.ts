// The page's workbench: chats and files from any of the sandboxes,
// as tabs in one grid of groups (see layout.svelte.ts). A tab names its
// sandbox and what it shows there (`<sandbox>/chat:<key>`). The workbench
// decides where a tab opens when the user did not drop it somewhere: chats
// where the chats are, files beside them, terminals in a panel at the foot. The grid is
// remembered without the file previews, which need their sandbox to load.
import { Layout, type Placement } from './layout.svelte.ts';

/** A sandbox's overview: its chats, sign-in and connection. */
export const OVERVIEW = '#overview';
const CHAT = 'chat:';
const TERMINAL = 'terminal:';
const COMMAND = 'command:';
const BROWSER = 'browser:';

/** The grid's tab for what a sandbox shows (a chat, its folders, a file). */
export const tabOf = (workerId: string, local: string) => `${encodeURIComponent(workerId)}/${local}`;
/** The sandbox a tab is from, and what it shows there. */
export function splitTab(tab: string): { workerId: string; local: string } {
  const slash = tab.indexOf('/');
  return { workerId: decodeURIComponent(tab.slice(0, slash)), local: tab.slice(slash + 1) };
}
export const chatTab = (key: string) => `${CHAT}${key}`;
/** The chat a tab shows, by what it shows in its sandbox. */
export const chatKeyOf = (local: string) => (local.startsWith(CHAT) ? local.slice(CHAT.length) : undefined);
export const terminalTab = (terminalId: string) => `${TERMINAL}${terminalId}`;
/** The shell a tab shows, by what it shows in its sandbox. */
export const terminalIdOf = (local: string) => (local.startsWith(TERMINAL) ? local.slice(TERMINAL.length) : undefined);
export const commandTab = (commandId: string) => `${COMMAND}${commandId}`;
/** The agent's command a tab watches, by what it shows in its sandbox. */
export const commandIdOf = (local: string) => (local.startsWith(COMMAND) ? local.slice(COMMAND.length) : undefined);
export const browserTab = (key: string) => `${BROWSER}${key}`;
/** The chat whose browser a tab shows, by what it shows in its sandbox. */
export const browserKeyOf = (local: string) => (local.startsWith(BROWSER) ? local.slice(BROWSER.length) : undefined);
/** Chats and the overview are the page's own; other tabs show files, or terminals. */
const isPage = (tab: string) => {
  const { local } = splitTab(tab);
  return local.startsWith(CHAT) || local === OVERVIEW;
};
/** A shell's tab or a watched command's: they open in the panel. */
const isTerminal = (tab: string) => {
  const { local } = splitTab(tab);
  return local.startsWith(TERMINAL) || local.startsWith(COMMAND);
};
/** What opens again from a saved grid: the page's own tabs, and terminals, which run on in their sandboxes. */
const isKept = (tab: string) => isPage(tab) || splitTab(tab).local.startsWith(TERMINAL);

/** A tab being dragged, from a group or from a list of chats. */
export const dragging = $state<{ workerId: string | null; tab: string | null }>({ workerId: null, tab: null });

/** Starts dragging a sandbox's tab onto the grid, e.g. a chat from a list. */
export function startDrag(event: DragEvent, workerId: string, tab: string, label: string): void {
  dragging.workerId = workerId;
  dragging.tab = tab;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', label);
}

export function endDrag(): void {
  dragging.workerId = null;
  dragging.tab = null;
}

/** The grid's tab being dragged. */
export const draggedTab = () => (dragging.workerId !== null && dragging.tab !== null ? tabOf(dragging.workerId, dragging.tab) : null);

export class Workbench {
  readonly layout: Layout;
  /** The grid shows only the focused group (a narrow window), set by its view. */
  narrow = false;
  /** Asked before the user closes a tab, e.g. one with edits that are not saved. */
  mayClose: (tab: string) => boolean = () => true;
  /** Tabs the user closed: what they show is let go, e.g. a preview. */
  onClose: (tab: string) => void = () => {};
  /** The chat in front of the focused group changed, e.g. for the page's address. */
  onChatFocus: (chat: { workerId: string; key: string } | undefined) => void = () => {};

  constructor() {
    this.layout = new Layout(load());
  }

  /** Opens a chat, where the chats are: the latest group that shows one, else the focused group. */
  openChat(workerId: string, key: string): void {
    const tab = tabOf(workerId, chatTab(key));
    if (this.layout.has(tab)) this.layout.activate(tab);
    else {
      const group = this.layout.byRecency().find((candidate) => candidate.active && isPage(candidate.active)) ?? this.layout.byRecency()[0]!;
      this.layout.place(tab, { group: group.id });
    }
    this.onChatFocus({ workerId, key });
  }

  openOverview(workerId: string): void {
    const tab = tabOf(workerId, OVERVIEW);
    if (this.layout.has(tab)) this.layout.activate(tab);
    else this.layout.place(tab, { group: this.layout.byRecency()[0]!.id });
    this.focusChanged();
  }

  /**
   * Opens a sandbox's file tab without taking the focus from the chat: next to
   * the files already open, else beside the chat in front. `reveal`: the user
   * asked to see it; a narrow grid shows only the focused group, so there its
   * group takes the focus.
   */
  openFile(workerId: string, local: string, reveal = false): void {
    const tab = tabOf(workerId, local);
    const focus = reveal && this.narrow;
    if (this.layout.has(tab)) {
      this.layout.activate(tab, focus);
      if (focus) this.focusChanged();
      return;
    }
    // Not into the terminals' panel: files go with files, else beside the chat in front.
    const groups = this.layout.byRecency().filter((group) => !group.tabs.length || !group.tabs.every(isTerminal));
    const files = groups.find((group) => group.tabs.some((other) => !isPage(other) && !isTerminal(other)));
    const focused = groups[0] ?? this.layout.byRecency()[0]!;
    const placement: Placement = files
      ? { group: files.id }
      : focused.active && isPage(focused.active)
        ? { group: focused.id, side: 'right' }
        : { group: focused.id };
    this.layout.place(tab, placement, focus);
    if (focus) this.focusChanged();
  }

  /**
   * Opens a chat's browser where files open (beside the chat). `front`: in
   * front and focused, as when the agent asks the user to take it over.
   */
  openBrowser(workerId: string, key: string, front: boolean): void {
    const local = browserTab(key);
    const tab = tabOf(workerId, local);
    if (!this.layout.has(tab)) this.openFile(workerId, local);
    if (front) {
      this.layout.activate(tab);
      this.focusChanged();
    }
  }

  /** Opens a shell's tab, in front, in the panel at the foot of the grid. */
  openTerminal(workerId: string, terminalId: string): void {
    this.openInPanel(tabOf(workerId, terminalTab(terminalId)));
  }

  /** A command an agent runs, watched in a tab in the panel at the foot of the grid. */
  openCommand(workerId: string, commandId: string): void {
    this.openInPanel(tabOf(workerId, commandTab(commandId)));
  }

  /**
   * Terminals open as VS Code opens them: in a panel across the foot of the
   * grid, made on first use. The panel is an ordinary group: its tabs can be
   * dragged anywhere, and others into it. New terminals go to a group of
   * terminals only (the panel, wherever it was moved), the latest one, else
   * to a new panel: one dragged in among chats stays there alone.
   */
  private openInPanel(tab: string): void {
    if (this.layout.has(tab)) this.layout.activate(tab);
    else {
      const panel = this.layout.byRecency().find((group) => group.tabs.length > 0 && group.tabs.every(isTerminal));
      if (panel) this.layout.place(tab, { group: panel.id });
      else this.layout.placeAtBottom(tab);
    }
    this.focusChanged();
  }

  /** The tab in front of the focused group, if any. */
  focusedTab(): string | undefined {
    return this.layout.group(this.layout.focused)?.active ?? undefined;
  }

  /** The latest terminal tab, shells and watched commands alike. */
  latestTerminal(): string | undefined {
    for (const group of this.layout.byRecency()) {
      if (group.active && isTerminal(group.active)) return group.active;
      const tab = group.tabs.findLast(isTerminal);
      if (tab) return tab;
    }
    return undefined;
  }

  /** Puts a tab where the user dropped it. */
  drop(tab: string, placement: Placement): void {
    this.layout.place(tab, placement);
    this.focusChanged();
  }

  activate(tab: string): void {
    this.layout.activate(tab);
    this.focusChanged();
  }

  focus(groupId: string): void {
    if (this.layout.focused === groupId) return;
    this.layout.focus(groupId);
    this.focusChanged();
  }

  /** The user closed a tab. */
  close(tab: string): void {
    if (!this.mayClose(tab)) return;
    this.layout.close(tab);
    this.onClose(tab);
    this.focusChanged();
  }

  /** A tab whose content went away, e.g. a deleted chat. */
  remove(tab: string): void {
    if (!this.layout.has(tab)) return;
    this.layout.close(tab);
    this.focusChanged();
  }

  /** A sandbox went: its tabs leave the grid. */
  removeWorker(workerId: string): void {
    for (const tab of this.layout.tabs()) if (splitTab(tab).workerId === workerId) this.layout.close(tab);
    this.focusChanged();
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layout.save(isKept)));
    } catch {
      // Not remembered, e.g. in a private window.
    }
  }

  /** The chat the user looks at: in front of the focused group, else of the latest group showing one. */
  focusedChat(): { workerId: string; key: string } | undefined {
    for (const group of this.layout.byRecency()) {
      if (!group.active) continue;
      const { workerId, local } = splitTab(group.active);
      const key = chatKeyOf(local);
      if (key) return { workerId, key };
    }
    return undefined;
  }

  /** The sandbox of the tab in front of the focused group. */
  focusedWorker(): string | undefined {
    const active = this.layout.group(this.layout.focused)?.active;
    return active ? splitTab(active).workerId : undefined;
  }

  private focusChanged(): void {
    this.onChatFocus(this.focusedChat());
  }
}

const STORAGE_KEY = 'codeflower.layout';

function load(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return undefined;
  }
}
