// The page's secret: the app (or the sandbox, with --server) prints the page's
// address with it, `?key=…`. The page keeps it in its origin's storage and
// sends it as a bearer token, never as a cookie: browsers send cookies to every
// port of a host, so a server another program (a sandbox's agent, another
// user) runs on 127.0.0.1 would receive it. Storage is the origin's own, port
// included. Through the tunnel the page has no key: the connector
// authenticates the browser end to end.

const STORAGE = 'codeflower-key';

interface Place {
  location: { search: string; pathname: string; hash: string };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

let key: string | null = null;

/**
 * Takes the key out of the address (keeping the rest of the query, e.g.
 * quit=1 from the tray) into storage, and returns the key: the address's, or
 * the one kept from before.
 */
export function takePageKey(place: Place = { location, history, storage: safeStorage() }): string | null {
  const query = new URLSearchParams(place.location.search);
  const given = query.get('key');
  if (given) {
    query.delete('key');
    const rest = query.toString();
    place.history.replaceState(null, '', `${place.location.pathname}${rest ? `?${rest}` : ''}${place.location.hash}`);
    try {
      place.storage?.setItem(STORAGE, given);
    } catch {
      // Without storage the key lasts as long as the page.
    }
    key = given;
    return key;
  }
  try {
    key = place.storage?.getItem(STORAGE) ?? null;
  } catch {
    key = null;
  }
  return key;
}

/** The headers that authorize a request to the page's own app. */
export function keyHeaders(): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function safeStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
