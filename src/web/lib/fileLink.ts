// Links to a sandbox's files, which `codeflower attach` prints for the files the
// agent shows in its terminal UI.

/** A link to a sandbox's file, which opens it in a tab. */
export interface FileLink {
  worker: string;
  path: string;
  /** The chat that showed it, which opens beside it. */
  chat?: string;
}

/**
 * A file link (`#/file/<sandbox>/<path>?chat=<key>`): what `codeflower attach`
 * prints for the files the agent shows in its terminal UI (the bridge's
 * `fileLinks`). The path is the file's in the sandbox, encoded as one part.
 */
export function fileLink(hash: string): FileLink | undefined {
  const match = /^#\/file\/([^/?]+)\/([^?]+)(?:\?(.*))?$/.exec(hash);
  if (!match) return undefined;
  try {
    const path = decodeURIComponent(match[2]!);
    if (!path.startsWith('/')) return undefined;
    const chat = new URLSearchParams(match[3] ?? '').get('chat');
    return { worker: decodeURIComponent(match[1]!), path, ...(chat ? { chat } : {}) };
  } catch {
    return undefined;
  }
}
