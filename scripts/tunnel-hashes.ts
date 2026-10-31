// Writes dist-tunnel/hashes.json: the SHA-256 of each file the tunnel serves,
// by the path it is served at (/p.html at /p, /m.html for /m/…). codeflower-app
// embeds a copy for `codeflower tunnel verify`.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../dist-tunnel/', import.meta.url).pathname;
const served: Record<string, string> = { 'p.html': '/p', 'm.html': '/m/verify/' };

function walk(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const hashes: Record<string, string> = {};
for (const path of walk(root).sort()) {
  const name = relative(root, path);
  if (name === 'hashes.json') continue;
  hashes[served[name] ?? `/${name}`] = createHash('sha256').update(readFileSync(path)).digest('hex');
}
writeFileSync(join(root, 'hashes.json'), `${JSON.stringify(hashes, null, 2)}\n`);
console.log(`dist-tunnel/hashes.json: ${Object.keys(hashes).length} files`);
