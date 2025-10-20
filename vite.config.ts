import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(dirname, 'src/frontend');

export default defineConfig({
  root: frontendRoot,
  publicDir: path.resolve(frontendRoot, 'public'),
  cacheDir: path.resolve(dirname, 'node_modules/.vite'),
  plugins: [react()],
  build: {
    outDir: path.resolve(dirname, 'dist/client'),
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },
  preview: {
    port: 4173,
    strictPort: true
  }
});
