import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default {
  plugins: [react(), tailwindcss()],
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
  build: {
    rolldownOptions: { input: ['index.html', 'components.html'].map(file => fileURLToPath(new URL(file, import.meta.url))) }
  },
  server: {
    host: '127.0.0.1',
    port: 5215,
    strictPort: true,
    proxy: { '/api': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8080', changeOrigin: true } },
    watch: { usePolling: true, interval: 150 }
  }
};
