import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// The app's page (codeflower client): a static bundle the app embeds and
// serves. Stable file names keep the app's committed copy's diffs small.
export default defineConfig({
  root: 'src/web',
  base: './',
  plugins: [tailwindcss(), svelte()],
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
