// The app's page served through the tunnel lives under /m/{connector}/: its
// requests go there (through the service worker), and its chats open
// encrypted streams to that connector.

import { browserKey, clearPageCode, fromBase64url, pairedConnector } from './keys.ts';
import { KeyMismatchError, RefusedError, openStream, type Hello, type SecureStream } from './stream.ts';

const tunnelPath = /^\/m\/([a-z0-9_]{1,64})(\/.*)?$/;

/** The connector this page reaches through the tunnel, if it is the tunnelled page. */
export function tunnelConnectorId(path: string = globalThis.location?.pathname ?? ''): string | undefined {
  return tunnelPath.exec(path)?.[1];
}

/** The app's path for a URL under /m/{connector}/, e.g. /m/eu_x/api/workers → /api/workers. */
export function appPath(url: URL): string {
  const match = tunnelPath.exec(url.pathname);
  return (match?.[2] || '/') + url.search;
}

export async function connectorStream(connectorId: string, hello?: Hello): Promise<SecureStream> {
  const paired = await pairedConnector(connectorId);
  if (!paired) throw new RefusedError('not_paired');
  try {
    return await openStream({ connectorId, connectorKey: fromBase64url(paired.key), keys: await browserKey(), hello });
  } catch (error) {
    // The computers this browser trusts changed: their kept page code goes.
    if (error instanceof KeyMismatchError || (error instanceof RefusedError && error.code === 'not_paired')) await clearPageCode();
    throw error;
  }
}
