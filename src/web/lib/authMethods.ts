// How the page signs in with a method an agent advertises, read from the
// method itself: no agent is known by name.
import type { AuthMethod } from '@agentclientprotocol/sdk';

function meta(method: AuthMethod): Record<string, unknown> | undefined {
  return (method as { _meta?: Record<string, unknown> })._meta ?? undefined;
}

export function isTerminalMethod(method: AuthMethod): boolean {
  return Boolean(meta(method)?.['terminal-auth']) || (method as { type?: string }).type === 'terminal';
}

export function isApiKeyMethod(method: AuthMethod): boolean {
  return Boolean(meta(method)?.['api-key']);
}

/** Only web links open from the page; the agent is not trusted with other schemes. */
export function isWebLink(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
