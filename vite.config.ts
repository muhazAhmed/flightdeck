import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The client is a plain SPA; everything under /api and /ws belongs to Fastify.
// Two dev processes, one origin from the browser's point of view.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./client', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5174', changeOrigin: true },
      // SSE must not be buffered by the proxy.
      '/ws': { target: 'ws://127.0.0.1:5174', ws: true }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true }
});
