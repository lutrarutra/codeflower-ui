import { defineConfig } from 'vite';

// The browser code the tunnel serves (codeflower-tunnel copies dist-tunnel into
// its public/): the pairing page (/p), the bootstrap (/m/…) and, built by
// tunnel-sw.vite.config.ts, the service worker (/sw.js). Stable names, so the
// hashes in hashes.json (checked by `codeflower tunnel verify`) name the
// served paths.
export default defineConfig({
  root: 'src/tunnel-web',
  base: '/',
  build: {
    outDir: '../../dist-tunnel',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: { p: 'src/tunnel-web/p.html', m: 'src/tunnel-web/m.html' },
      output: {
        entryFileNames: 'tunnel/[name].js',
        chunkFileNames: 'tunnel/[name].js',
        assetFileNames: 'tunnel/[name][extname]'
      }
    }
  }
});
