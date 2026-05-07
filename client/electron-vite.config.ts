import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// `@aeris/shared` ships with TS sources in src/ and an ESM-style dist/ that
// mismatches the package.json `main` field's CJS contract. Aliasing to
// `shared/src/index.ts` lets Vite/esbuild compile the source directly,
// matching mobile's `react-native: src/index.ts` strategy. The renderer
// bundles shared into its own bundle (it's only ever called via main →
// IPC for runtime, but types still need to resolve at build time).
const SHARED_SRC = resolve(__dirname, '../shared/src/index.ts');

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron/main',
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
      outDir: 'dist-electron/preload',
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
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'dist-electron/renderer'),
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
