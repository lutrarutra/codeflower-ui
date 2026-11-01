// The computers (connectors) this browser can reach through the tunnel, for
// the app's page and the service worker's error page.
import { pairedConnectors } from './keys.ts';

/** A computer on the tunnel account, as the tunnel's GET /api/connectors lists it. */
interface AccountConnector {
  id: string;
  name: string;
  online: boolean;
  sandboxes?: number;
}

export interface Computer {
  id: string;
  name?: string;
  /** Unknown (undefined) when the tunnel did not answer. */
  online?: boolean;
  onAccount?: boolean;
}

/**
 * The computers this browser is paired with, joined with the tunnel's list of
 * the account's computers for their names and whether they are connected. The
 * head is always among them. The tunnel's answer only labels them: a computer
 * still needs this browser's pairing to be reached.
 */
export async function pairedComputers(head: string): Promise<Computer[]> {
  const [paired, account] = await Promise.all([
    pairedConnectors().catch(() => []),
    fetch('/api/connectors', { credentials: 'same-origin' })
      .then((response) => (response.ok ? (response.json() as Promise<AccountConnector[]>) : undefined))
      .catch(() => undefined)
  ]);
  const ids = new Set([head, ...paired.map((connector) => connector.id)]);
  const byId = new Map((Array.isArray(account) ? account : []).map((connector) => [connector.id, connector]));
  return [...ids].map((id) => {
    const listed = byId.get(id);
    if (!account) return { id };
    return listed ? { id, name: listed.name, online: listed.online, onAccount: true } : { id, onAccount: false };
  });
}
