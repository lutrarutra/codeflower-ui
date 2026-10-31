// A sandbox's workbench: its chats, its folders and the files shown from it,
// as tabs in a grid of groups (see layout.svelte.ts). It decides where a tab
// opens when the user did not drop it somewhere: chats where the chats are,
// files beside them. The grid is remembered per sandbox, without the file
// previews, which need the sandbox to load.
import { Layout, type Placement } from './layout.svelte.ts';
import { FILES, INTERACTIVE } from './previews.svelte.ts';

/** The sandbox's overview: its chats, sign-in and connection. */
export const OVERVIEW = '#overview';
const CHAT = 'chat:';

export const chatTab = (key: string) => `${CHAT}${key}`;
export const chatKeyOf = (tab: string) => (tab.startsWith(CHAT) ? tab.slice(CHAT.length) : undefined);
/** Chats and the overview are the page's own; other tabs show files. */
const isPage = (tab: string) => tab.startsWith(CHAT) || tab === OVERVIEW;
/** Tabs that open again from a saved grid. */
const restorable = (tab: string) => isPage(tab) || tab === FILES;

/** A tab being dragged, from a group or from a list of chats. */
export const dragging = $state<{ workerId: string | null; tab: string | null }>({ workerId: null, tab: null });

/** Starts dragging a tab onto a grid, e.g. a chat from a list. */
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

export class Workbench {
  readonly workerId: string;
  readonly layout: Layout;
  /** Tabs the user closed: what they show is let go, e.g. a preview. */
  onClose: (tab: string) => void = () => {};
  /** The chat in front of the focused group changed, e.g. for the page's address. */
  onChatFocus: (key: string | undefined) => void = () => {};

  constructor(workerId: string) {
    this.workerId = workerId;
    this.layout = new Layout(load(workerId));
  }

  /** Opens a chat, where the chats are: the latest group that shows one, else the focused group. */
  openChat(key: string): void {
    const tab = chatTab(key);
    if (this.layout.has(tab)) this.layout.activate(tab);
    else {
      const group = this.layout.byRecency().find((candidate) => candidate.active && isPage(candidate.active)) ?? this.layout.byRecency()[0]!;
      this.layout.place(tab, { group: group.id });
    }
    this.onChatFocus(key);
  }

  openOverview(): void {
    if (this.layout.has(OVERVIEW)) this.layout.activate(OVERVIEW);
    else this.layout.place(OVERVIEW, { group: this.layout.byRecency()[0]!.id });
  }

  /**
   * Opens a file's tab without taking the focus from the chat: next to the
   * files already open, else beside the chat in front.
   */
  openFile(tab: string): void {
    if (this.layout.has(tab)) {
      this.layout.activate(tab, false);
      return;
    }
    // An interactive report opens next to its preview.
    const preview = tab.endsWith(INTERACTIVE) ? this.layout.groupOf(tab.slice(0, -INTERACTIVE.length)) : undefined;
    if (preview) {
      this.layout.place(tab, { group: preview.id, index: preview.tabs.indexOf(tab.slice(0, -INTERACTIVE.length)) + 1 }, false);
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

  save(): void {
    try {
      localStorage.setItem(storageKey(this.workerId), JSON.stringify(this.layout.save(restorable)));
    } catch {
      // Not remembered, e.g. in a private window.
    }
  }

  /** The chat the user looks at: in front of the focused group, else of the latest group showing one. */
  focusedChat(): string | undefined {
    for (const group of this.layout.byRecency()) {
      const key = group.active ? chatKeyOf(group.active) : undefined;
      if (key) return key;
    }
    return undefined;
  }

  private focusChanged(): void {
    this.onChatFocus(this.focusedChat());
  }
}

const storageKey = (workerId: string) => `codeflower.layout.${workerId}`;

function load(workerId: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(storageKey(workerId)) ?? 'null');
  } catch {
    return undefined;
  }
}
