import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'node:path';

// Relative base so the same build works on GitHub Pages (/cardano-cert-stamp/),
// any static host, and inside the Capacitor Android app.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [wasm()],
  // The Mesh SDK imports a few Node built-ins; map them to browser versions
  // (not in tests, which run on Node).
  define: mode === 'test' ? {} : { global: 'globalThis' },
  resolve: mode === 'test' ? {} : {
    alias: {
      stream: 'stream-browserify',
      crypto: 'crypto-browserify',
      events: 'events',
      util: 'util',
      buffer: 'buffer',
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        issue: resolve(__dirname, 'issue.html'),
        verify: resolve(__dirname, 'verify.html'),
      },
    },
  },
  test: { include: ['test/**/*.test.js'] },
}));
