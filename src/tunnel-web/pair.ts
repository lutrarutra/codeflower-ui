// /p#{connector}.{key}.{secret}: pairs this browser with a computer. The
// fragment never reaches the tunnel; it is removed from the address at once.

import { browserKey, fingerprint, fromBase64url, rememberConnector } from '../tunnel/keys.ts';
import { openStream } from '../tunnel/stream.ts';

const $ = (id: string) => document.getElementById(id)!;

function show(id: 'sign-in' | 'confirm' | 'done'): void {
  for (const section of ['sign-in', 'confirm', 'done']) $(section).hidden = section !== id;
}

function showError(message: string): void {
  $('error').textContent = message;
  $('error').hidden = !message;
}

/** A name for this browser, e.g. "Firefox on Android". */
export function deviceName(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const system = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';
  return system ? `${browser} on ${system}` : browser;
}

interface Link {
  connectorId: string;
  key: string;
  secret: string;
}

function readLink(): Link | undefined {
  let fragment = location.hash.slice(1);
  if (fragment) {
    history.replaceState(null, '', '/p');
    // Kept for the way back from signing in, in this tab only.
    try {
      sessionStorage.setItem('cft_pair', fragment);
    } catch {
      // Without storage, signing in first means opening the link again.
    }
  } else {
    try {
      fragment = sessionStorage.getItem('cft_pair') ?? '';
    } catch {
      fragment = '';
    }
  }
  const [connectorId, key, secret, extra] = fragment.split('.');
  if (!connectorId || !key || !secret || extra !== undefined) return undefined;
  return { connectorId, key, secret };
}

async function start(): Promise<void> {
  const link = readLink();
  if (!link) return showError('This link is incomplete. Open the whole link "codeflower tunnel pair" printed.');
  if (fromBase64url(link.key).length !== 32) return showError('This link has no valid key. Open the whole link again.');

  const me = await fetch('/api/me').then((response) => response.json());
  if (!me.user) {
    try {
      sessionStorage.setItem('cft_next', '/p');
    } catch {
      // See above.
    }
    return show('sign-in');
  }

  $('fingerprint').textContent = fingerprint(link.key);
  ($('device') as HTMLInputElement).value = deviceName(navigator.userAgent);
  show('confirm');
  $('pair').addEventListener('click', async () => {
    showError('');
    ($('pair') as HTMLButtonElement).disabled = true;
    try {
      const stream = await openStream({
        connectorId: link.connectorId,
        connectorKey: fromBase64url(link.key),
        keys: await browserKey(),
        hello: { pair: link.secret, device: ($('device') as HTMLInputElement).value.trim() || deviceName(navigator.userAgent) }
      });
      stream.close();
      await rememberConnector({ id: link.connectorId, key: link.key, pairedAt: Date.now() });
      try {
        sessionStorage.removeItem('cft_pair');
      } catch {
        // Nothing kept.
      }
      ($('open') as HTMLAnchorElement).href = `/m/${encodeURIComponent(link.connectorId)}/`;
      show('done');
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      ($('pair') as HTMLButtonElement).disabled = false;
    }
  });
}

if (typeof document !== 'undefined') start().catch((error) => showError(error instanceof Error ? error.message : String(error)));
