// root and alias are based on import.meta.dirname, so the location where this file sits becomes the app's reference point.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'DatePack — 지금, 더 좋은 하루를 함께',
        short_name: 'DatePack',
        description:
          '데이트 전체가 파일 하나로. 로컬 퍼스트 데이트 플래너. / The whole date lives in one file.',
        lang: 'ko',
        display: 'standalone',
        start_url: '/',
        background_color: '#FFFBF9',
        theme_color: '#FFFBF9',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell only — Pretendard ships ~360 per-range subsets, so fonts are
        // filled into a runtime cache as the browser actually requests them.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: /\.(?:woff2?)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
});
