import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the Vite server proxies API and WebSocket traffic to the backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
