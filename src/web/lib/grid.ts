// What the grid's groups and dividers share with the workbench that holds them.
import type { Snippet } from 'svelte';
import type { Placement } from './layout.svelte.ts';
import type { Workbench } from './workbench.svelte.ts';

/** How a tab shows in its strip. */
export interface TabLabel {
  icon: string;
  label: string;
  title: string;
  /** A chat's title, shown with its command. */
  chat?: boolean;
  /** A chat's state: working, waiting for the user, or done while the user looked elsewhere. */
  status?: 'working' | 'waiting' | 'done';
}

export interface Grid {
  workbench: Workbench;
  label(tab: string): TabLabel;
  /** Where the group's body is; null when it goes. */
  measure(groupId: string, body: HTMLElement | null): void;
  /** A tab dragged over a group would land here (null: nowhere). */
  dragOver(placement: Placement | null): void;
  drop(): void;
  /** Where a dragged tab would land now. */
  target(): Placement | null;
  /** A dragged tab may land on this grid. */
  accepts(): boolean;
  /** A divider is being dragged: the tabs' content lets the pointer through. */
  setResizing(resizing: boolean): void;
  /** The narrow layout: one group, with every tab in its strip. */
  narrow: boolean;
  /** What an empty grid shows. */
  empty: Snippet;
}
