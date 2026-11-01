// Several computers on one page through the tunnel: the page's ids for their
// sandboxes, which computer's page to run, and which sandboxes are gone.
// A computer is a tunnel connector; its sandboxes' ids are only unique on it,
// so the tunnelled page names each one `<id>@<connector>`. The local page has
// one computer and keeps the ids as the app gives them.

/** The page API this page speaks (the app's `pageApi` in /api/system), and the oldest it can use. */
export const PAGE_API = 1;
export const MIN_PAGE_API = 0;

const connectorPattern = /^[a-z0-9_]{1,64}$/;

/** The page's id for a sandbox of a computer: the computer's id, then its connector, if any. */
export function qualify(id: string, connectorId: string | undefined): string {
  return connectorId ? `${id}@${connectorId}` : id;
}

/** The computer's id for a sandbox, and the connector it runs on (none when the id names none). */
export function splitId(pageId: string): { id: string; connectorId?: string } {
  const at = pageId.lastIndexOf('@');
  const connectorId = at > 0 ? pageId.slice(at + 1) : '';
  return connectorPattern.test(connectorId) ? { id: pageId.slice(0, at), connectorId } : { id: pageId };
}

/**
 * An id from the address, which may name no connector (a link a computer
 * printed, or one from before several computers): on a tunnelled page, it is
 * the head's.
 */
export function fromLink(pageId: string, head: string | undefined): string {
  return head && !splitId(pageId).connectorId ? qualify(pageId, head) : pageId;
}

/** Whether this page can use a computer whose app answers with `pageApi` (missing: an app from before it). */
export function pageApiFits(pageApi: number | undefined): 'yes' | 'older' | 'newer' {
  const version = pageApi ?? 0;
  if (version < MIN_PAGE_API) return 'older';
  return version > PAGE_API ? 'newer' : 'yes';
}

/** Compares app versions like `0.16.0` or `v0.16.0-3-gabc`; 0 when either is not one (e.g. `dev`). */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const parse = (version: string | undefined) => /^v?(\d+)\.(\d+)\.(\d+)/.exec(version ?? '')?.slice(1).map(Number);
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index]! - right[index]!;
  return 0;
}

export interface HeadCandidate {
  connectorId: string;
  pageApi?: number;
  version?: string;
}

/**
 * The computer whose page to run: the one with the newest page API, then
 * the newest app. A newer page can use older apps, an older one cannot know
 * newer ones. On a tie the page stays where it is.
 */
export function chooseHead(current: string, candidates: HeadCandidate[]): string {
  let best = candidates.find((candidate) => candidate.connectorId === current) ?? { connectorId: current };
  for (const candidate of candidates) {
    const api = (candidate.pageApi ?? 0) - (best.pageApi ?? 0);
    if (api > 0 || (api === 0 && compareVersions(candidate.version, best.version) > 0)) best = candidate;
  }
  return best.connectorId;
}

/**
 * The sandboxes the page lets go: those whose computer answered without them,
 * and those of a computer the page does not show. A computer that has not
 * answered yet, or stopped answering, keeps its last list.
 * `listings` is by computer, as `machineOf` names it; undefined: no answer yet.
 */
export function gone(pageIds: Iterable<string>, listings: Map<string, Set<string> | undefined>, machineOf: (pageId: string) => string): string[] {
  const result: string[] = [];
  for (const pageId of pageIds) {
    const key = machineOf(pageId);
    if (!listings.has(key)) result.push(pageId);
    else {
      const ids = listings.get(key);
      if (ids && !ids.has(pageId)) result.push(pageId);
    }
  }
  return result;
}
