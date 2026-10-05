import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    optimizeDeps: {
      exclude: ['@vercel/postgres', '@vercel/node'],
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true,
      hmr: false,
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/api/**', '**/api-backup/**'],
      },
    },
  };
});