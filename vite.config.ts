import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built app also works from file:// inside Electron.
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
