// Fuzzy matching: chat titles and file paths for the search (Ctrl+K), whose
// files the sandbox ranks with the same rules (the bridge's src/search.js), and Roots' find
// (rootsSearch.ts). The sandbox sends its best, ranked again so every sandbox's count alike.

const MATCH = 16;
const BOUNDARY = 8;
const SLASH = 10;
const CONSECUTIVE = 6;
const FIRST = 2;
const GAP = 1;
const MAX_TEXT = 1024;
// Below this much a letter, the letters are strewn about the text: not a match worth showing.
const WEAK = 20;
const NONE = -1e9;

const isUpper = (c: number) => c >= 65 && c <= 90;
const isLower = (c: number) => c >= 97 && c <= 122;
const isDigit = (c: number) => c >= 48 && c <= 57;

function bonusAt(text: string, index: number): number {
  if (index === 0) return SLASH;
  const before = text.charCodeAt(index - 1);
  const here = text.charCodeAt(index);
  if (before === 47) return SLASH; // after '/'
  if (before === 95 || before === 45 || before === 46 || before === 32) return BOUNDARY; // _ - . space
  if (isLower(before) && isUpper(here)) return BOUNDARY; // camelCase
  if (!isDigit(before) && isDigit(here)) return BOUNDARY / 2;
  return 0;
}

export interface FuzzyMatch {
  score: number;
  /** Where the query's letters are in the text, to mark them. */
  positions: number[];
}

/**
 * How well `query` matches `text` as a subsequence, or null: matches at word
 * starts and in runs score higher, gaps cost. Case does not matter unless the
 * query has a capital; spaces in the query are left out.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = query.replace(/\s+/g, '');
  if (!needle) return { score: 0, positions: [] };
  const sensitive = needle !== needle.toLowerCase();
  const haystack = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const q = sensitive ? needle : needle.toLowerCase();
  const t = sensitive ? haystack : haystack.toLowerCase();
  const m = q.length;
  const n = t.length;
  if (m > n) return null;
  // Quick check: a subsequence at all, and where it can start.
  let first = -1;
  let i = 0;
  for (let j = 0; j < n && i < m; j++) {
    if (t[j] !== q[i]) continue;
    if (i === 0) first = j;
    i++;
  }
  if (i < m) return null;

  // score[i][j]: the best with q[i] at t[j]; from[i][j]: where q[i-1] is then.
  const score = Array.from({ length: m }, () => new Float64Array(n).fill(NONE));
  const from = Array.from({ length: m }, () => new Int32Array(n).fill(-1));
  for (let i = 0; i < m; i++) {
    let best = NONE;
    let bestAt = -1;
    for (let j = first + i; j < n; j++) {
      if (i > 0) {
        // The best place for q[i-1] before j, less a point for each letter between.
        if (best !== NONE) best -= GAP;
        if (score[i - 1]![j - 1]! > best) {
          best = score[i - 1]![j - 1]!;
          bestAt = j - 1;
        }
      }
      if (t[j] !== q[i]) continue;
      const bonus = bonusAt(haystack, j);
      if (i === 0) {
        score[0]![j] = MATCH + bonus * FIRST - Math.min(j, 8) * 0.5;
        continue;
      }
      const after = score[i - 1]![j - 1]!;
      const consecutive = after === NONE ? NONE : after + MATCH + Math.max(bonus, CONSECUTIVE);
      const gapped = best === NONE ? NONE : best + MATCH + bonus;
      if (consecutive === NONE && gapped === NONE) continue;
      if (consecutive >= gapped) {
        score[i]![j] = consecutive;
        from[i]![j] = j - 1;
      } else {
        score[i]![j] = gapped;
        from[i]![j] = bestAt;
      }
    }
  }
  let end = -1;
  let total = NONE;
  const last = score[m - 1]!;
  for (let j = 0; j < n; j++)
    if (last[j]! > total) {
      total = last[j]!;
      end = j;
    }
  if (end < 0 || total < m * WEAK) return null;
  const positions = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; i--) {
    positions[i] = j;
    j = from[i]![j]!;
  }
  return { score: total, positions };
}

/** A path's match: as a whole, or its name alone, which counts for more; shorter paths first among equals. */
export function pathMatch(query: string, path: string): FuzzyMatch | null {
  const whole = fuzzyMatch(query, path);
  if (!whole) return null;
  // A file at the top of its folder is all name.
  const slash = path.lastIndexOf('/');
  const name = fuzzyMatch(query, path.slice(slash + 1));
  const penalty = path.length / 100;
  if (name && name.score + MATCH * 2 > whole.score) {
    return { score: name.score + MATCH * 2 - penalty, positions: name.positions.map((at) => at + slash + 1) };
  }
  return { score: whole.score - penalty, positions: whole.positions };
}

/** A text cut into runs, marked where `positions` are, to show a match. */
export function markRuns(text: string, positions: readonly number[]): { text: string; marked: boolean }[] {
  const marked = new Set(positions);
  const runs: { text: string; marked: boolean }[] = [];
  for (let index = 0; index < text.length; index++) {
    const on = marked.has(index);
    const last = runs.at(-1);
    if (last && last.marked === on) last.text += text[index];
    else runs.push({ text: text[index]!, marked: on });
  }
  return runs;
}
