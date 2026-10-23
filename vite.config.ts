import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// `base: './'` + hash routing lets the built site run from any static host
// path (GitHub Pages project sites, Netlify, a local folder).
export default defineConfig({
  base: './',
  plugins: [preact()],
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
