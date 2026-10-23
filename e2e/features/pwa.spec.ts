/**
 * Installable & offline (docs/EXPERIENCE.md §6). Needs the production build (the dev server does not
 * register the service worker), which is what `npm run e2e` serves.
 *
 * Chromium's offline emulation (context.setOffline) does not reach requests made by a service worker,
 * so "offline" here is real: the page is loaded through a small proxy that this test can switch off.
 */
import { createServer, request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, freshStorage } from '../support/fixtures';

let proxy: Server;
let origin = '';
let down = false;

test.beforeAll(async ({}, info) => {
  const upstream = new URL(String(info.project.use.baseURL));
  proxy = createServer((req, res) => {
    if (down) {
      req.socket.destroy();
      return;
    }
    const fwd = httpRequest(
      { hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: { ...req.headers, host: upstream.host } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    fwd.on('error', () => res.destroy());
    req.pipe(fwd);
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/`;
});

test.afterAll(async () => {
  await new Promise((r) => proxy.close(r));
});

test.beforeEach(async ({ context }) => {
  down = false;
  await freshStorage(context);
});

test('the web app manifest describes Rootword', async ({ page, request }) => {
  await page.goto(`${origin}#/KJV/JHN/1`);
  await page.locator('.prose [data-u]').first().waitFor();
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  test.skip(!href, 'no manifest link: not a production build (run against `vite preview`)');
  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toBe('Rootword');
  expect(m.display).toBe('standalone');
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
});

test('the service worker registers, and a chapter already read opens offline', async ({ page, allowErrors }) => {
  await page.goto(`${origin}#/KJV/JHN/3`);
  await page.locator('.prose [data-u]').first().waitFor();
  const hasSw = await page.evaluate(() => 'serviceWorker' in navigator && !!document.querySelector('link[rel="manifest"]'));
  test.skip(!hasSw, 'not a production build (run against `vite preview`)');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // the first visit installs the worker; reading again (now controlled) fills the runtime cache
  await page.reload();
  await page.locator('.prose [data-u]').first().waitFor();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.hover('#v16 [data-u]');
  await expect(page.locator('#word-card .card__def')).toBeVisible();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(800);

  allowErrors(/Failed to load resource|ERR_|Failed to fetch|FetchEvent|no-response/);
  down = true;
  await page.reload();
  await page.locator('.prose [data-u]').first().waitFor({ timeout: 15_000 });
  await expect(page.locator('#v16')).toContainText('For God so loved the world');
  // the word card still works for that chapter
  await expect(async () => {
    await page.mouse.move(5, 5);
    await page.hover('#v16 [data-u]');
    await expect(page.locator('#word-card #word-card-head')).toHaveText('γὰρ', { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator('#word-card .card__def')).toContainText(/particle/);

  // a chapter never opened cannot load: a clear message, not a blank page
  await page.evaluate(() => (location.hash = '#/KJV/OBA/1'));
  await expect(page.locator('main')).toContainText(/offline|couldn.t load|isn.t saved|try again/i, { timeout: 20_000 });
  await expect(page.locator('main')).not.toContainText('The vision of Obadiah');
  down = false;
});
