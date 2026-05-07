import { defineConfig, type Plugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// `@aeris/shared` ships with TS sources in src/ and an ESM-style dist/ that
// mismatches the package.json `main` field's CJS contract. Aliasing to
// `shared/src/index.ts` lets Vite/esbuild compile the source directly,
// matching mobile's `react-native: src/index.ts` strategy. The renderer
// bundles shared into its own bundle (it's only ever called via main →
// IPC for runtime, but types still need to resolve at build time).
const SHARED_SRC = resolve(__dirname, '../shared/src/index.ts');

// Build-time CSP swap. Production locks the renderer down with
// connect-src 'none'; dev relaxes it just enough for Vite's HMR
// websocket and react-refresh's inline/eval scripts. Token confinement
// does not depend on CSP — it's enforced by contextIsolation +
// nodeIntegration:false + sandbox:true on the BrowserWindow.
const PROD_CSP =
  "default-src 'self'; connect-src 'none'; script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;";
const DEV_CSP =
  "default-src 'self' http://localhost:* ws://localhost:*; " +
  "connect-src 'self' http://localhost:* ws://localhost:*; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: http://localhost:*; " +
  "font-src 'self' data: http://localhost:*;";

const cspPlugin = (): Plugin => ({
  name: 'aeris-csp',
  transformIndexHtml(html, ctx) {
    const csp = ctx.server ? DEV_CSP : PROD_CSP;
    const meta =
      '<meta http-equiv="Content-Security-Policy" content="' + csp + '" />';
    return html.replace('<!--CSP_PLACEHOLDER-->', meta);
  },
});

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        // Mark @aeris/shared as external so Node `require()` resolves it
        // from node_modules at runtime (CJS dist/). This dodges Vite's
        // static export-* analysis on the dist file.
        external: [
          'electron',
          'electron-store',
          'electron-log',
          'electron-log/main',
          'electron-updater',
          '@aeris/shared',
        ],
        output: { entryFileNames: 'index.js' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        external: ['electron'],
        output: { entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: [
        { find: /^@aeris\/shared$/, replacement: SHARED_SRC },
      ],
    },
    plugins: [react(), cspPlugin()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    server: {
      port: 5173,
    },
  },
});
