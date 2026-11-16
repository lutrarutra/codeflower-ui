// Paths of files from a sandbox, as the page shows them.
import { WORKSPACE } from '../../client/codeflower.ts';

/** Paths in the workspace read best relative to it, as the agent writes them. */
export function displayPath(path: string): string {
  return path.startsWith(`${WORKSPACE}/`) ? path.slice(WORKSPACE.length + 1) : path;
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/** A path a file refers to (e.g. an image in a report), resolved against the file's folder. */
export function resolvePath(file: string, target: string): string {
  const parts = target.startsWith('/') ? [] : file.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `/${parts.filter(Boolean).join('/')}`;
}
