import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    // Fix HMR WebSocket through Replit's reverse proxy.
    // Without this, Vite tells the browser to connect to ws://localhost:5000
    // which fails inside the proxied iframe. Setting clientPort:443 + wss makes
    // the browser connect to the Replit dev domain on the standard HTTPS port,
    // which Replit's proxy forwards to Vite's internal WebSocket.
    hmr: {
      clientPort: 443,
      protocol: 'wss',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
