import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { builtinModules } from 'node:module';

export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
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
