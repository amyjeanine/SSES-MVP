import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'SSES · Seguimiento de Estrategias Estudiantiles',
        short_name: 'SSES',
        description: 'Piloto del Sistema de Seguimiento de Estrategias Estudiantiles (MinEducación)',
        theme_color: '#14425f',
        background_color: '#f4f7fa',
        display: 'standalone',
        lang: 'es',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { chunkSizeWarningLimit: 900 },
});
