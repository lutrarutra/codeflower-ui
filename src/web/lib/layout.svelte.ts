// A sandbox's tabs in a grid of groups, as VS Code arranges its editors: each
// group has its own tabs and shows one of them, and groups split the space in
// rows and columns, which split again. A tab is in one group at a time; moving
// a tab onto a group's edge splits that group. The last tab leaving a group
// closes it, unless it is the only group.

export interface Group {
  kind: 'group';
  id: string;
  tabs: string[];
  active: string | null;
}

export interface Split {
  kind: 'split';
  id: string;
  /** Children side by side (`row`) or one above the other (`column`). */
  direction: 'row' | 'column';
  children: LayoutNode[];
  /** Each child's share of the space, in percent. */
  sizes: number[];
}

export type LayoutNode = Group | Split;
export type Side = 'left' | 'right' | 'top' | 'bottom';

/** Where a tab goes: into a group (at `index` in its strip, else after the tab in front), or beside it on a `side`. */
export interface Placement {
  group: string;
  side?: Side;
  index?: number;
}

/** A group never gets smaller than this share of its split by resizing. */
export const MIN_SIZE = 8;

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${nextId++}`;

function emptyGroup(tabs: string[] = []): Group {
  return { kind: 'group', id: newId('group'), tabs, active: tabs[0] ?? null };
}

export class Layout {
  root = $state<LayoutNode>(emptyGroup());
  /** The group the user worked in last; new tabs go there unless placed. */
  focused = $state('');
  /** Group ids, the most recently focused first. */
  private recent: string[] = [];

  constructor(saved?: unknown) {
    const root = saved ? restore(saved) : undefined;
    if (root) this.root = root;
    this.prune();
    this.focused = this.groups()[0]!.id;
  }

  groups(node: LayoutNode = this.root): Group[] {
    return node.kind === 'group' ? [node] : node.children.flatMap((child) => this.groups(child));
  }

  group(id: string): Group | undefined {
    return this.groups().find((group) => group.id === id);
  }

  groupOf(tab: string): Group | undefined {
    return this.groups().find((group) => group.tabs.includes(tab));
  }

  tabs(): string[] {
    return this.groups().flatMap((group) => group.tabs);
  }

  has(tab: string): boolean {
    return !!this.groupOf(tab);
  }

  /** The tab is in front of its group. */
  visible(tab: string): boolean {
    return this.groupOf(tab)?.active === tab;
  }

  /** Groups by how recently they were focused, the focused one first. */
  byRecency(): Group[] {
    const groups = this.groups();
    const rank = (group: Group) => {
      const index = this.recent.indexOf(group.id);
      return index < 0 ? Infinity : index;
    };
    return [...groups].sort((a, b) => rank(a) - rank(b));
  }

  focus(id: string): void {
    if (!this.group(id)) return;
    this.focused = id;
    this.recent = [id, ...this.recent.filter((other) => other !== id)];
  }

  /** Brings a tab to the front of its group; `focus` also makes its group the focused one. */
  activate(tab: string, focus = true): void {
    const group = this.groupOf(tab);
    if (!group) return;
    group.active = tab;
    if (focus) this.focus(group.id);
  }

  /** Adds a tab, or moves it if it is in a group already. */
  place(tab: string, placement: Placement, focus = true): void {
    const source = this.groupOf(tab);
    const target = this.group(placement.group);
    if (!target) return;
    if (source) {
      // A group's only tab cannot split its own group, nor move into it.
      if (source === target && source.tabs.length === 1) {
        this.activate(tab, focus);
        return;
      }
      const from = source.tabs.indexOf(tab);
      source.tabs.splice(from, 1);
      if (source === target && !placement.side && placement.index !== undefined && placement.index > from) placement.index--;
      if (source.active === tab) source.active = source.tabs[Math.max(from - 1, 0)] ?? null;
    }
    let group: Group;
    if (placement.side) {
      group = emptyGroup([tab]);
      this.splitBeside(target, placement.side, group);
    } else {
      group = target;
      const after = group.active ? group.tabs.indexOf(group.active) + 1 : group.tabs.length;
      const index = Math.min(Math.max(placement.index ?? after, 0), group.tabs.length);
      group.tabs.splice(index, 0, tab);
    }
    group.active = tab;
    if (source && source !== group && !source.tabs.length) this.removeGroup(source.id);
    if (focus || !this.group(this.focused)) this.focus(group.id);
  }

  /** Takes a tab out; its group shows its neighbour, or closes when it was the last one. */
  close(tab: string): void {
    const group = this.groupOf(tab);
    if (!group) return;
    const index = group.tabs.indexOf(tab);
    group.tabs.splice(index, 1);
    if (group.active === tab) group.active = group.tabs[Math.max(index - 1, 0)] ?? null;
    if (!group.tabs.length) this.removeGroup(group.id);
  }

  /** Keeps only the tabs `keep` accepts, e.g. once a chat was deleted. */
  retain(keep: (tab: string) => boolean): void {
    for (const tab of this.tabs()) if (!keep(tab)) this.close(tab);
  }

  /** Sets the shares of a split's children (in percent), e.g. while its divider is dragged. */
  resize(splitId: string, sizes: number[]): void {
    const split = this.find(splitId);
    if (split?.kind !== 'split' || sizes.length !== split.children.length) return;
    split.sizes = sizes;
  }

  /** What a page can keep to restore the grid: only the tabs `keep` accepts. */
  save(keep: (tab: string) => boolean): LayoutNode {
    const copy = new Layout(JSON.parse(JSON.stringify(this.root)));
    copy.retain(keep);
    return JSON.parse(JSON.stringify(copy.root));
  }

  private find(id: string, node: LayoutNode = this.root): LayoutNode | undefined {
    if (node.id === id) return node;
    if (node.kind === 'group') return undefined;
    for (const child of node.children) {
      const found = this.find(id, child);
      if (found) return found;
    }
    return undefined;
  }

  private parentOf(id: string, node: LayoutNode = this.root): Split | undefined {
    if (node.kind === 'group') return undefined;
    if (node.children.some((child) => child.id === id)) return node;
    for (const child of node.children) {
      const found = this.parentOf(id, child);
      if (found) return found;
    }
    return undefined;
  }

  private replace(id: string, node: LayoutNode): void {
    const parent = this.parentOf(id);
    if (!parent) this.root = node;
    else parent.children[parent.children.findIndex((child) => child.id === id)] = node;
  }

  /** Puts `group` on a side of `target`, sharing the target's space half and half. */
  private splitBeside(target: Group, side: Side, group: Group): void {
    const direction = side === 'left' || side === 'right' ? 'row' : 'column';
    const before = side === 'left' || side === 'top';
    const parent = this.parentOf(target.id);
    if (parent?.direction === direction) {
      const index = parent.children.findIndex((child) => child.id === target.id);
      const half = parent.sizes[index]! / 2;
      parent.sizes[index] = half;
      parent.children.splice(before ? index : index + 1, 0, group);
      parent.sizes.splice(before ? index : index + 1, 0, half);
      return;
    }
    const copy = { ...$state.snapshot(target) } as Group;
    this.replace(target.id, {
      kind: 'split',
      id: newId('split'),
      direction,
      children: before ? [group, copy] : [copy, group],
      sizes: [50, 50]
    });
  }

  private removeGroup(id: string): void {
    const parent = this.parentOf(id);
    if (!parent) return;
    const index = parent.children.findIndex((child) => child.id === id);
    const [size] = parent.sizes.splice(index, 1);
    parent.children.splice(index, 1);
    // The neighbour that was beside it takes its space.
    const neighbour = Math.min(index, parent.children.length - 1);
    parent.sizes[neighbour] = parent.sizes[neighbour]! + size!;
    this.recent = this.recent.filter((other) => other !== id);
    this.prune();
    if (!this.group(this.focused)) this.focus(this.byRecency()[0]!.id);
  }

  /**
   * Keeps the tree tidy: no empty groups but the last, no split of one child,
   * no split inside a split of the same direction, shares that add up to 100.
   */
  private prune(): void {
    const tidy = (node: LayoutNode): LayoutNode | undefined => {
      if (node.kind === 'group') return node.tabs.length ? node : undefined;
      const kept: { node: LayoutNode; size: number }[] = [];
      node.children.forEach((child, index) => {
        const tidied = tidy(child);
        const size = node.sizes[index] ?? 0;
        if (!tidied) return;
        if (tidied.kind === 'split' && tidied.direction === node.direction) {
          const total = tidied.sizes.reduce((sum, share) => sum + share, 0) || 1;
          tidied.children.forEach((grandchild, at) => kept.push({ node: grandchild, size: (size * tidied.sizes[at]!) / total }));
        } else {
          kept.push({ node: tidied, size });
        }
      });
      if (!kept.length) return undefined;
      if (kept.length === 1) return kept[0]!.node;
      const total = kept.reduce((sum, child) => sum + child.size, 0) || kept.length;
      return {
        ...node,
        children: kept.map((child) => child.node),
        sizes: kept.map((child) => (total === kept.length && !child.size ? 100 / kept.length : (child.size * 100) / total))
      };
    };
    const tidied = tidy($state.snapshot(this.root) as LayoutNode);
    // Nothing left: one empty group, the one there was if any.
    const first = this.groups()[0];
    this.root = tidied ?? (first ? { ...($state.snapshot(first) as Group), tabs: [], active: null } : emptyGroup());
  }
}

/** A saved grid, if it is one. */
function restore(value: unknown): LayoutNode | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const node = value as { kind?: unknown; id?: unknown; tabs?: unknown[]; active?: unknown; direction?: unknown; children?: unknown[]; sizes?: unknown[] };
  if (node.kind === 'group' && typeof node.id === 'string' && Array.isArray(node.tabs)) {
    const tabs = node.tabs.filter((tab): tab is string => typeof tab === 'string');
    return { kind: 'group', id: node.id, tabs, active: tabs.includes(node.active as string) ? (node.active as string) : (tabs[0] ?? null) };
  }
  if (node.kind === 'split' && typeof node.id === 'string' && (node.direction === 'row' || node.direction === 'column') && Array.isArray(node.children)) {
    const children = node.children.map(restore).filter((child): child is LayoutNode => !!child);
    if (!children.length) return undefined;
    const sizes = children.map((_, index) => {
      const size = node.sizes?.[index];
      return typeof size === 'number' && size > 0 ? size : 100 / children.length;
    });
    return { kind: 'split', id: node.id, direction: node.direction, children, sizes };
  }
  return undefined;
}
