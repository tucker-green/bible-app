import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { ManifestOptions } from 'vite-plugin-pwa';
import { CACHE, ROUTES } from './src/lib/offline';

/** Scholar "day edition" paper (src/styles/theme.css --paper): manifest theme and splash colour. */
const PAPER = '#fafaf7';

/**
 * Web app manifest (docs/EXPERIENCE.md §6). Paths are relative to the manifest, which sits next to
 * index.html, so the same build works at "/" and under a GitHub Pages project path ("/bible-app/").
 * Icons are rendered from public/favicon.svg by scripts/make-icons.mjs.
 */
export const MANIFEST: Partial<ManifestOptions> = {
  id: './',
  name: 'Rootword',
  short_name: 'Rootword',
  description:
    'Read and search the Bible in several translations. Hover or tap any English word to see the Greek or Hebrew word behind it, with its dictionary form, grammar and definition.',
  lang: 'en',
  dir: 'ltr',
  start_url: './',
  scope: './',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  orientation: 'any',
  theme_color: PAPER,
  background_color: PAPER,
  categories: ['books', 'education', 'reference'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  shortcuts: [
    { name: 'Search the Bible', short_name: 'Search', url: './#/search', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'My study', short_name: 'My study', url: './#/study', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
  ],
};

/** iOS reads the home-screen icon and title from <head>, not from the manifest. */
function appleTouchIcon(): Plugin {
  return {
    name: 'rootword:apple-touch-icon',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: './apple-touch-icon.png' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Rootword' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
    ],
  };
}

// `base: './'` + hash routing lets the built site run from any static host
// path (GitHub Pages project sites, Netlify, a local folder).
export default defineConfig({
  base: './',
  plugins: [
    preact(),
    appleTouchIcon(),
    VitePWA({
      // The app shows its own "A new version is ready — Refresh" toast (src/pwa.ts).
      registerType: 'prompt',
      injectRegister: false,
      manifest: MANIFEST,
      // icons, favicon and apple-touch-icon are precached by the glob below
      includeManifestIcons: false,
      workbox: {
        // Precache the app shell only. public/data/** (~200 MB of JSON) is never precached: chapters,
        // lexicon chunks and fonts are cached at runtime as they are used (or downloaded per book in
        // Settings → Offline). Cache names and URL patterns: src/lib/offline.ts.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'], // + manifest.webmanifest (added by the plugin)
        globIgnores: ['data/**', '**/data/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/data\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ROUTES.meta,
            handler: 'NetworkFirst',
            options: { cacheName: CACHE.meta, networkTimeoutSeconds: 4, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ROUTES.chapters,
            handler: 'CacheFirst',
            options: {
              cacheName: CACHE.chapters,
              matchOptions: { ignoreSearch: true },
              // No maxAgeSeconds on purpose (see src/lib/offline.ts): an age limit would make
              // workbox refuse old cached chapters while offline.
              expiration: { maxEntries: 4000, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ROUTES.study,
            handler: 'CacheFirst',
            options: {
              cacheName: CACHE.study,
              matchOptions: { ignoreSearch: true },
              expiration: { maxEntries: 1500, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ROUTES.search,
            handler: 'CacheFirst',
            options: {
              cacheName: CACHE.search,
              matchOptions: { ignoreSearch: true },
              expiration: { maxEntries: 12, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ROUTES.fonts,
            handler: 'CacheFirst',
            options: {
              cacheName: CACHE.fonts,
              expiration: { maxEntries: 80, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
