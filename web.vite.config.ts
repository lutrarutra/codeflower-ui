import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

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
  plugins: [tailwindcss(), svelte(), buildId()],
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
