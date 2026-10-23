/**
 * Playwright end-to-end tests (e2e/) and the docs/EXPERIENCE.md §7 QA matrix.
 *
 *   npm run e2e                                   builds the site and serves it with `vite preview`
 *   npx playwright test e2e/features              one folder
 *   npx playwright test --project=qa              the QA matrix only (every viewport × light/dark)
 *   E2E_BASE_URL=http://127.0.0.1:5173/ npx playwright test   against a server you started yourself
 *   SHOTS=1 npx playwright test --project=shots   recapture design/screenshots/final-*.png
 *
 * The data under public/data/ must exist first (`npm run data`).
 */
import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4319);
const external = process.env.E2E_BASE_URL;
const baseURL = (external ?? `http://127.0.0.1:${PORT}/`).replace(/\/?$/, '/');

/**
 * Chromium: the one bundled with @playwright/test, else the preinstalled build in /opt/pw-browsers
 * (sandboxed CI images ship it there), else whatever PW_CHROME points at.
 */
function chromePath(): string | undefined {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    /* not installed: fall through */
  }
  const fallback = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return existsSync(fallback) ? fallback : undefined;
}

/** A separate output folder, so `npm run e2e` never races a `npm run build` writing dist/. */
const OUT = 'node_modules/.cache/rootword-e2e';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : process.env.CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: chromePath() },
  },
  projects: [
    {
      name: 'features',
      testMatch: /features\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'qa',
      testMatch: /qa\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Only when asked (SHOTS=1): rewrites design/screenshots/final-*.png.
      name: 'shots',
      testMatch: /shots\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: `npx vite build --outDir ${OUT} --emptyOutDir --logLevel warn && npx vite preview --outDir ${OUT} --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
