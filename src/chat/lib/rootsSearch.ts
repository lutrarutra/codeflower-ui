// Roots' find (Ctrl+F): which ideas match a query, in their title or anything
// in them (conclusion, comments, todos, needs, files). The words as typed come
// first, in the map's order like an editor's find; then fuzzy matches, the best
// first. Each hit says where it matched, with a bit of the text around it.
import type { Idea } from '../../protocol/roots.ts';
import { fuzzyMatch } from './fuzzy.ts';

export type RootsField = 'id' | 'title' | 'conclusion' | 'comment' | 'todo' | 'need' | 'file';

export interface RootsHit {
  id: number;
  field: RootsField;
  /** The text around the match, on one line, and where the match is in it. */
  excerpt: string;
  positions: number[];
  /** The excerpt starts after the text's start, or ends before its end. */
  cutStart: boolean;
  cutEnd: boolean;
  exact: boolean;
  score: number;
}

/** Before a field's fuzzy score: the title counts most. */
const WEIGHT: Record<RootsField, number> = { id: 60, title: 40, conclusion: 10, comment: 10, todo: 10, need: 10, file: 0 };
const BEFORE = 24;
const LENGTH = 110;

function fieldsOf(idea: Idea): [RootsField, string][] {
  return [
    ['title', idea.title],
    ['conclusion', idea.conclusion],
    ...idea.comments.map((comment): [RootsField, string] => ['comment', comment.text]),
    ...idea.todos.map((todo): [RootsField, string] => ['todo', todo.text]),
    ...idea.needs.filter((need) => need.text).map((need): [RootsField, string] => ['need', need.text!]),
    ...idea.files.map((file): [RootsField, string] => ['file', file])
  ];
}

function excerpt(text: string, positions: number[]): Pick<RootsHit, 'excerpt' | 'positions' | 'cutStart' | 'cutEnd'> {
  const first = positions[0] ?? 0;
  const start = Math.max(0, first - BEFORE);
  const end = Math.min(text.length, Math.max(start + LENGTH, (positions.at(-1) ?? 0) + 1));
  return {
    // Same length, so the positions hold: line breaks and tabs as spaces.
    excerpt: text.slice(start, end).replace(/\s/g, ' '),
    positions: positions.map((at) => at - start).filter((at) => at < end - start),
    cutStart: start > 0,
    cutEnd: end < text.length
  };
}

function matchIdea(idea: Idea, query: string, lower: string): RootsHit | undefined {
  const id = /^#?(\d+)$/.exec(query);
  if (id && Number(id[1]) === idea.id) {
    return { id: idea.id, field: 'id', ...excerpt(idea.title, []), positions: [], exact: true, score: Infinity };
  }
  let best: RootsHit | undefined;
  for (const [field, text] of fieldsOf(idea)) {
    if (!text) continue;
    const at = text.toLowerCase().indexOf(lower);
    if (at >= 0) {
      // As typed: the first field it is in, which the list goes title first.
      const positions = Array.from({ length: lower.length }, (_, index) => at + index);
      return { id: idea.id, field, ...excerpt(text, positions), exact: true, score: 1e6 + WEIGHT[field] };
    }
    const fuzzy = fuzzyMatch(query, text);
    if (fuzzy && (!best || fuzzy.score + WEIGHT[field] > best.score)) {
      best = { id: idea.id, field, ...excerpt(text, fuzzy.positions), exact: false, score: fuzzy.score + WEIGHT[field] };
    }
  }
  return best;
}

/**
 * The ideas that match `query`: those with it as typed (case aside) in the map's
 * order (`order` gives where each idea is), then fuzzy matches by how well.
 */
export function searchIdeas(ideas: Idea[], query: string, order?: Map<number, { x: number; y: number }>): RootsHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const hits = ideas.map((idea) => matchIdea(idea, trimmed, lower)).filter((hit): hit is RootsHit => hit !== undefined);
  const place = (id: number) => order?.get(id) ?? { x: 0, y: 0 };
  return hits.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (a.score === Infinity || b.score === Infinity) return a.score === Infinity ? -1 : 1;
    if (!a.exact && a.score !== b.score) return b.score - a.score;
    const pa = place(a.id);
    const pb = place(b.id);
    return pa.y - pb.y || pa.x - pb.x || a.id - b.id;
  });
}
