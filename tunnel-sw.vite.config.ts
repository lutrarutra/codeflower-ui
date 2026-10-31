import { defineConfig } from 'vite';

// The tunnel's service worker as one classic script: not every browser runs
// module service workers yet.
export default defineConfig({
  build: {
    outDir: 'dist-tunnel',
    emptyOutDir: false,
    lib: { entry: 'src/tunnel-web/sw.ts', formats: ['iife'], name: 'codeflowerTunnel', fileName: () => 'sw.js' }
  }
});
