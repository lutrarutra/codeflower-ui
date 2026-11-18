// What a sandbox's home lists of versions: the page's own and who serves it,
// then the sandbox's parts as its bridge reports them. As lines, so the card
// and its Copy (for a bug report) say the same.
import type { SandboxVersions } from './api.ts';

/** Who serves the page: the sandbox itself (`--server`), or a code flower client. */
export type PageServer =
  | { kind: 'sandbox' }
  | {
      kind: 'client';
      /** The client's release; empty while the page does not know it yet. */
      version: string;
      /** The client's computer: its name, as the tunnel or the computer says it. */
      computer: string;
      /** host:port in the address bar; none through the tunnel. */
      address?: string;
    };

export interface VersionLine {
  label: string;
  value: string;
  detail?: string;
}

/** v0.39.0 and 0.39.0 read the same. */
export function plainVersion(version: string): string {
  return version.replace(/^v(?=\d)/, '');
}

export function versionLines({
  ui,
  server,
  lister,
  versions,
  agentName = (id) => id
}: {
  ui: string;
  server: PageServer;
  /** The client that lists the sandbox, when it is not the one serving the page (another computer, through the tunnel). */
  lister?: { computer: string; version: string };
  versions?: SandboxVersions;
  agentName?: (id: string) => string;
}): VersionLine[] {
  const lines: VersionLine[] = [];
  const client = (version: string) => (version ? `code flower ${plainVersion(version)}` : 'code flower');
  if (server.kind === 'sandbox') {
    lines.push({ label: 'This page', value: `ui ${plainVersion(ui)}`, detail: 'served by this sandbox (--server), from its image' });
  } else {
    const where = [server.computer && `on ${server.computer}`, server.address ? `at ${server.address}` : 'through the tunnel'].filter(Boolean);
    lines.push({ label: 'This page', value: `ui ${plainVersion(ui)}`, detail: `served by ${client(server.version)} ${where.join(' ')}` });
  }
  if (lister) lines.push({ label: 'Listed by', value: client(lister.version), detail: `on ${lister.computer}` });
  if (versions?.app) lines.push({ label: 'Started by', value: client(versions.app) });
  if (versions?.image || versions?.imageRef) {
    lines.push({
      label: 'Sandbox image',
      value: versions.image ? plainVersion(versions.image) : 'unknown release',
      ...(versions.imageRef ? { detail: versions.imageRef } : {})
    });
  }
  if (versions?.page) lines.push({ label: 'Its page', value: `ui ${plainVersion(versions.page)}`, detail: 'what the image serves with --server' });
  if (versions?.storyteller) lines.push({ label: 'storyteller', value: plainVersion(versions.storyteller) });
  for (const [id, version] of Object.entries(versions?.agents ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push({ label: agentName(id), value: plainVersion(version) });
  }
  return lines;
}

/** The lines as text to paste, e.g. into a bug report. */
export function versionText(lines: VersionLine[]): string {
  return lines.map((line) => `${line.label}: ${line.value}${line.detail ? ` (${line.detail})` : ''}`).join('\n');
}
