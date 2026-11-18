import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * The release the page is built from: package.json's version, or what git
 * says when the checkout is not that release's tag (0.32.0-3-gabc1234-dirty),
 * so a development build says so. The image builds from a tag's files without
 * git: the version alone.
 */
function uiVersion(): string {
  const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  try {
    const described = execFileSync('git', ['describe', '--tags', '--dirty', '--match', 'v*'], {
      cwd: new URL('.', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return described && described !== `v${version}` ? described.replace(/^v/, '') : version;
  } catch {
    return version;
  }
}

const UI_VERSION = uiVersion();

/** Writes version.json next to the page, which the sandbox's bridge reports. */
function versionFile(): Plugin {
  return {
    name: 'codeflower-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ ui: UI_VERSION })}\n` });
    }
  };
}

/**
 * Names the build in index.html (`<meta name="codeflower-build">`), from the
 * contents of its files: the file names stay the same between builds, so the
 * tunnel's service worker keeps a computer's page code by this name.
 */
function buildId(): Plugin {
  return {
    name: 'codeflower-build-id',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (html?.type !== 'asset') return;
      const hash = createHash('sha256');
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name]!;
        if (name === 'index.html') continue;
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source);
      }
      const id = hash.digest('hex').slice(0, 16);
      html.source = String(html.source).replace('<head>', `<head>\n    <meta name="codeflower-build" content="${id}" />`);
    }
  };
}

// The app's page (codeflower client): a static bundle the app embeds and
// serves. Stable file names keep the app's committed copy's diffs small.
export default defineConfig({
  root: 'src/web',
  base: './',
  plugins: [tailwindcss(), svelte(), buildId(), versionFile()],
  define: { __UI_VERSION__: JSON.stringify(UI_VERSION) },
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'main.js',
        chunkFileNames: '[name].js',
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css')) ? 'main[extname]' : 'assets/[name]-[hash][extname]'
      }
    }
  }
});
