import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

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
