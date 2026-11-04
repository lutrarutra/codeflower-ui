import type { WorkerStatus } from './codeflower.ts';

// Where a sandbox path is on the machine that runs the sandbox, from the
// mounts the worker reports and its project state. Must match the to-host
// half of codeflower-path in codeflower-sandbox: bin/codeflower-path.

const STATE = '/codeflower-state';

// With --env-dir these come from another folder, which the status does not
// report; env/exports is the project's own again.
const ELSEWHERE = [`${STATE}/env`, `${STATE}/cache`];
const OWN = `${STATE}/env/exports`;

const within = (path: string, root: string) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
const windows = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');

/** The host path of `path` in the sandbox, or null when it is in no folder from the host. */
export function hostPath(status: Pick<WorkerStatus, 'mounts' | 'stateDirectory'> | undefined, path: string): string | null {
  if (!status || !path.startsWith('/')) return null;
  path = path.replace(/(.)\/+$/, '$1');
  const roots = (status.mounts ?? []).filter((mount) => mount.target && mount.source).map(({ target, source }) => ({ target, source }));
  if (status.stateDirectory && !(ELSEWHERE.some((root) => within(path, root)) && !within(path, OWN))) {
    roots.push({ target: STATE, source: status.stateDirectory });
  }
  // The longest matching folder wins, as mounts can nest.
  let best: { target: string; source: string } | undefined;
  for (const root of roots) {
    const target = root.target.replace(/(.)\/+$/, '$1');
    if (within(path, target) && (!best || target.length > best.target.length)) best = { target, source: root.source };
  }
  if (!best) return null;
  const rest = path.slice(best.target.length).replace(/^\/+/, '');
  if (!rest) return best.source;
  if (windows(best.source)) return `${best.source.replace(/\\+$/, '')}\\${rest.replace(/\//g, '\\')}`;
  return `${best.source.replace(/\/+$/, '')}/${rest}`;
}
