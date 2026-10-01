// root and alias are based on import.meta.dirname, so the location where this file sits becomes the app's reference point.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig(({ command, isPreview }) => ({
  root: resolve(import.meta.dirname),
  // GitHub Pages serves project sites from /<repo>/ — dev keeps the root.
  base: command === 'build' || isPreview ? '/datepack/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'DatePack — 외출 계획과 남긴 순간',
        short_name: 'DatePack',
        description:
          '혼자 또는 함께하는 외출과 사진 기록. / Local-first outing plans and photo memories.',
        lang: 'ko',
        display: 'standalone',
        // Relative to the manifest URL, so the app also works from /datepack/.
        start_url: '.',
        background_color: '#FFFBF9',
        theme_color: '#FFFBF9',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon-maskable-512.png',
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
}));
