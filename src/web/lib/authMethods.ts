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

// Escape sequences: colors and cursor moves (CSI), titles and hyperlinks (OSC), and the rest.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

/**
 * The page a sign-in command asks the user to open: the last web link it
 * printed. Printed on one line, a link is whole in the output even where the
 * terminal wraps it.
 */
export function signInPage(output: string): string | null {
  const links = output.replace(ESCAPES, '').match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const pages = links.map((link) => link.replace(/[.,;:)\]]+$/, '')).filter(isWebLink);
  return pages.at(-1) ?? null;
}
