import { resolve } from 'node:path'

import { defineConfig } from 'vite'

// The browser development shell. It builds the same modules the Tauri shell
// will load; only the entrypoint differs (ADR-0001).
export default defineConfig({
  server: { port: 5273, strictPort: true },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        // The spike is built alongside the app so it always exercises the same
        // modules; it is never linked from the product entrypoint.
        main: resolve(__dirname, 'index.html'),
        fidelity: resolve(__dirname, 'spike/fidelity/index.html'),
      },
    },
  },
})
