// Files from the sandbox that a chat shows, e.g. figures the agent looked at.
// Fetched through the chat's host once per key (a file as one tool call saw it,
// since the agent may rewrite it later); undefined while loading, null if
// unavailable.
import { getContext, setContext } from 'svelte';
import type { ChatHost } from './host.ts';

export class SandboxFiles {
  private readonly urls = $state<Record<string, string | null>>({});
  private readonly requested = new Set<string>();
  private readonly host: ChatHost;

  constructor(host: ChatHost) {
    this.host = host;
  }

  url(path: string, key: string): string | null | undefined {
    if (!this.requested.has(key)) {
      this.requested.add(key);
      this.host.send({ type: 'fileData', path, key });
    }
    return this.urls[key];
  }

  received(key: string, dataUrl: string | null): void {
    this.urls[key] = dataUrl;
  }
}

const FILES = Symbol('codeflower sandbox files');

export function provideSandboxFiles(files: SandboxFiles): void {
  setContext(FILES, files);
}

export function sandboxFiles(): SandboxFiles {
  return getContext<SandboxFiles>(FILES);
}
