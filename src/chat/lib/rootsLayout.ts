// Where each idea of a Roots map goes: a tidy tree. An idea's row is how deep it
// builds (one below the deepest idea it builds on); across, each idea sits under
// the first idea it builds on, its children side by side below it and it
// centered over them, so a branch never pushes the map to one side. Ideas that
// start from the data are trees of their own, side by side.
import type { Idea } from '../../protocol/roots.ts';

export interface RootsBox {
  /** A card's width and height, and the gaps between cards across and down. */
  width: number;
  height: number;
  gapX: number;
  gapY: number;
}

export function layoutIdeas(ideas: Pick<Idea, 'id' | 'from'>[], box: RootsBox): Map<number, { x: number; y: number }> {
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  const known = (idea: Pick<Idea, 'from'>) => idea.from.filter((id) => byId.has(id));

  // The row: one below the deepest parent. A circle (only in a broken file) stops at 0.
  const depth = new Map<number, number>();
  const visiting = new Set<number>();
  const depthOf = (id: number): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = known(byId.get(id)!);
    const value = parents.length ? 1 + Math.max(...parents.map(depthOf)) : 0;
    depth.set(id, value);
    return value;
  };
  for (const idea of ideas) depthOf(idea.id);

  // The tree: each idea under the first parent it builds on that is above it.
  const children = new Map<number, number[]>();
  const origins: number[] = [];
  for (const idea of [...ideas].sort((a, b) => a.id - b.id)) {
    const parent = known(idea).find((id) => depth.get(id)! < depth.get(idea.id)!);
    if (parent === undefined) origins.push(idea.id);
    else children.set(parent, [...(children.get(parent) ?? []), idea.id]);
  }

  // How wide each subtree is: its children side by side, or the card.
  const widths = new Map<number, number>();
  const widthOf = (id: number): number => {
    const cached = widths.get(id);
    if (cached !== undefined) return cached;
    const kids = children.get(id) ?? [];
    const row = kids.reduce((sum, kid) => sum + widthOf(kid), 0) + box.gapX * Math.max(0, kids.length - 1);
    const value = Math.max(box.width, row);
    widths.set(id, value);
    return value;
  };

  const placed = new Map<number, { x: number; y: number }>();
  const place = (id: number, left: number) => {
    const width = widthOf(id);
    const y = depth.get(id)! * (box.height + box.gapY);
    const kids = children.get(id) ?? [];
    const row = kids.reduce((sum, kid) => sum + widthOf(kid), 0) + box.gapX * Math.max(0, kids.length - 1);
    let cursor = left + (width - row) / 2;
    for (const kid of kids) {
      place(kid, cursor);
      cursor += widthOf(kid) + box.gapX;
    }
    // Centered between its first and last child, which is always inside its own subtree's span.
    const x = kids.length ? (placed.get(kids[0])!.x + placed.get(kids.at(-1)!)!.x) / 2 : left + (width - box.width) / 2;
    placed.set(id, { x, y });
  };
  let left = 0;
  for (const origin of origins) {
    place(origin, left);
    left += widthOf(origin) + box.gapX * 2;
  }
  return placed;
}
