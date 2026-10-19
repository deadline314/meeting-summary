import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // E2E runs use their own throwaway local state so screenshots are deterministic.
    cloudflare({ persistState: process.env.E2E ? { path: '.wrangler/e2e' } : true }),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // served from public/manifest.webmanifest
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(api|auth|ws|mcp|files)\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: { cacheName: 'api', networkTimeoutSeconds: 4, expiration: { maxEntries: 200, maxAgeSeconds: 7 * 86400 } },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@client': '/src/client', '@shared': '/src/shared' } },
  build: { chunkSizeWarningLimit: 900 },
})
