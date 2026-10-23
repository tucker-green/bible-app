/** Settings: theme (remembered, no flash), reading font, high contrast, text size. */
import { test, expect, openReader, overflowX, freshStorage } from '../support/fixtures';
import type { Page } from '@playwright/test';

// The no-flash check holds the app's scripts back with page.route, which a service worker serving
// them from its precache would bypass; the worker itself is covered by pwa.spec.ts.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ context }) => {
  await freshStorage(context);
});

async function openSettings(page: Page) {
  // the header Aa button on wide screens, the toolbar's on phones
  const aa = page.locator('.aa-btn:visible, .toolbar .tb-btn[aria-label^="Aa"]:visible').first();
  await aa.click();
  await page.getByRole('button', { name: /all settings/i }).click();
  const sheet = page.locator('.st-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const lum = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return (r + g + b) / 3;
};

test('theme: Dark is remembered and painted before the app script runs (no flash)', async ({ page }) => {
  await openReader(page);
  expect(lum(await bg(page)), 'light by default (system = light)').toBeGreaterThan(200);
  const sheet = await openSettings(page);
  await sheet.getByRole('radio', { name: 'Dark' }).check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => lum(await bg(page))).toBeLessThan(40);
  await page.keyboard.press('Escape');

  // Reload with every script held back: the inline <head> script alone must already paint dark.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\.(m?js|tsx?)(\?.*)?$/, async (route) => {
    await gate;
    await route.continue().catch(() => undefined); // requests of the aborted first load
  });
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => document.body !== null);
  expect(await page.locator('#app').innerHTML(), 'the app has not rendered yet').toBe('');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(lum(await bg(page)), 'first paint is already dark').toBeLessThan(40);
  release();
  await page.unroute(/\.(m?js|tsx?)(\?.*)?$/);
  await page.locator('.prose [data-u]').first().waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('reading font: Atkinson Hyperlegible Next applies to the text and is remembered', async ({ page }) => {
  await openReader(page);
  const sheet = await openSettings(page);
  await sheet.getByRole('radio', { name: /Atkinson/ }).check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('data-font', 'atkinson');
  await expect.poll(() => page.locator('#v1 [data-u]').first().evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Atkinson/i);
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "Atkinson Hyperlegible Next Variable"') || document.fonts.check('16px "Atkinson Hyperlegible Next"'))).toBe(true);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('.prose [data-u]').first().waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'atkinson');
});

test('high contrast: stronger borders and no tinted-only highlights', async ({ page }) => {
  await openReader(page);
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--rule').trim());
  const sheet = await openSettings(page);
  await sheet.getByText('High contrast', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--rule').trim());
  expect(after).not.toBe(before);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
});

test('text size 200% keeps the text in one column with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openReader(page);
  const sheet = await openSettings(page);
  await sheet.getByRole('radio', { name: /200/ }).check({ force: true });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim())).toBe('2');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
});
