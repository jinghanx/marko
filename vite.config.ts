import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { builtinModules } from 'node:module';

export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  // Two HTML entries: the main window (index.html) and the global launcher
  // (launcher.html). Electron loads each by file path or dev-server URL.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        launcher: resolve(__dirname, 'launcher.html'),
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // Anything pulling Node built-ins via CJS `require` (e.g.
              // simple-git) must be external so its internal calls resolve
              // at runtime instead of being bundled into ESM.
              external: [
                'node-pty',
                'electron',
                'simple-git',
                'better-sqlite3',
                ...builtinModules,
                ...builtinModules.map((m) => `node:${m}`),
              ],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              output: {
                entryFileNames: '[name].cjs',
                format: 'cjs',
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
});
