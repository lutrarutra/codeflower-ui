// The page's workbench: chats and files from any of the sandboxes,
// as tabs in one grid of groups (see layout.svelte.ts). A tab names its
// sandbox and what it shows there (`<sandbox>/chat:<key>`). The workbench
// decides where a tab opens when the user did not drop it somewhere: chats
// where the chats are, files beside them. The grid is remembered without the
// file previews, which need their sandbox to load.
import { Layout, type Placement } from './layout.svelte.ts';
import { INTERACTIVE } from './previews.svelte.ts';

/** A sandbox's overview: its chats, sign-in and connection. */
export const OVERVIEW = '#overview';
const CHAT = 'chat:';

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
/** Chats and the overview are the page's own and open again from a saved grid; other tabs show files. */
const isPage = (tab: string) => {
  const { local } = splitTab(tab);
  return local.startsWith(CHAT) || local === OVERVIEW;
};

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
   * the files already open, else beside the chat in front.
   */
  openFile(workerId: string, local: string): void {
    const tab = tabOf(workerId, local);
    if (this.layout.has(tab)) {
      this.layout.activate(tab, false);
      return;
    }
    // An interactive report opens next to its preview.
    const previewTab = tab.endsWith(INTERACTIVE) ? tab.slice(0, -INTERACTIVE.length) : undefined;
    const preview = previewTab ? this.layout.groupOf(previewTab) : undefined;
    if (preview) {
      this.layout.place(tab, { group: preview.id, index: preview.tabs.indexOf(previewTab!) + 1 }, false);
      return;
    }
    const groups = this.layout.byRecency();
    const files = groups.find((group) => group.tabs.some((other) => !isPage(other)));
    const focused = groups[0]!;
    const placement: Placement = files
      ? { group: files.id }
      : focused.active && isPage(focused.active)
        ? { group: focused.id, side: 'right' }
        : { group: focused.id };
    this.layout.place(tab, placement, false);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layout.save(isPage)));
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
