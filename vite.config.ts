import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'favicon-48.png',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
      ],
      manifest: {
        name: 'Workout Log',
        short_name: 'Workouts',
        description:
          'Personal workout logger — track equipment, weight, and reps. Works offline.',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['health', 'fitness', 'lifestyle'],
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
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
        // HTML is NOT precached: an old Home Screen install must always fetch
        // the current index.html (and therefore the current hashed bundle).
        cacheId: 'workout-log-v20260925b',
        globPatterns: ['**/*.{js,css,ico,png,svg,webp,woff2}'],
        navigateFallback: null,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              // No timeout: only fall back to cached HTML when truly offline.
              cacheName: 'pages-v20260925b',
            },
          },
          {
            urlPattern: ({ request }) =>
              request.destination === 'style' ||
              request.destination === 'script' ||
              request.destination === 'worker',
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets-v20260925b',
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-v20260925b',
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  preview: {
    host: true,
    allowedHosts: true,
  },
  server: {
    host: true,
    allowedHosts: true,
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },
  worker: {
    format: 'es',
  },
})
