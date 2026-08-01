import { defineConfig } from 'vite'

// The browser development shell. It builds the same modules the Tauri shell
// will load; only the entrypoint differs (ADR-0001).
export default defineConfig({
  server: { port: 5273, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
})
