import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 }, // three.js + postprocessing is large by nature; this is a desktop app
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
