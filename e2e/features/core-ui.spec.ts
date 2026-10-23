/**
 * Core UI regressions: a malformed URL never blanks the app, the reading place survives Back and a
 * translation switch, links followed from a sheet leave no dead history entry, the keyboard focus card
 * has no Tab stops, keyboard focus lands on the passage after the pickers and search, the chapter
 * can be read aloud from its header, and the About page fits 280 px.
 */
import type { Page } from '@playwright/test';
import { test, expect, openReader, openPage, freshStorage, overflowX } from '../support/fixtures';

// No service worker here: its one-off "works offline" toast would replace the toasts checked below.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ context }) => {
  await freshStorage(context);
});

/** The first verse showing below the header, and its top relative to the header (px). */
async function firstVerse(page: Page): Promise<{ v: number; top: number }> {
  return page.evaluate(() => {
    const top = Math.max(0, document.getElementById('masthead')!.getBoundingClientRect().bottom);
    for (const v of Array.from(document.querySelectorAll<HTMLElement>('.prose .verse[data-v]'))) {
      const r = v.getBoundingClientRect();
      if (r.bottom > top + 1) return { v: Number(v.dataset.v), top: Math.round(r.top - top) };
    }
    return { v: 0, top: 0 };
  });
}

test('a malformed escape in the URL shows "not found" and every later navigation still works', async ({ page }) => {
  await openReader(page, '#/KJV/JHN/3');
  await page.evaluate(() => (location.hash = '#/word/%E2%82'));
  await expect(page.locator('main h1')).toHaveText('No such page');
  await page.goBack();
  await expect(page.locator('#chapter-title')).toContainText('3');
  await page.evaluate(() => (location.hash = '#/about'));
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.goto('#/100%');
  await expect(page.locator('main')).toContainText('doesn’t know “/100%”');
});

test('Back from a word study returns to the same place in the chapter', async ({ page }) => {
  await openReader(page, '#/KJV/PSA/119');
  await page.evaluate(() => document.getElementById('v99')!.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(500);
  const before = await firstVerse(page);
  expect(before.v).toBeGreaterThan(90);
  await page.evaluate(() => (location.hash = '#/word/H0995'));
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.goBack();
  await expect
    .poll(async () => {
      const now = await firstVerse(page);
      return now.v === before.v && Math.abs(now.top - before.top) < 4;
    }, { timeout: 5000 })
    .toBe(true);
  // and it stays there (nothing restores a stale position afterwards)
  await page.waitForTimeout(800);
  const after = await firstVerse(page);
  expect(after.v).toBe(before.v);
  expect(Math.abs(after.top - before.top)).toBeLessThan(4);
});

test('switching translation keeps the verse being read on screen', async ({ page }) => {
  await openReader(page, '#/KJV/PSA/119');
  await page.evaluate(() => document.getElementById('v120')!.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(500);
  const before = await firstVerse(page);
  await page.evaluate(() => (document.querySelector('.tr-btn') as HTMLElement).click());
  await page.evaluate(() => ([...document.querySelectorAll('.tr-item')].find((b) => b.textContent?.includes('BSB')) as HTMLElement).click());
  await expect(page).toHaveURL(/#\/BSB\/PSA\/119$/);
  // the same verse starts just below the header in the BSB
  const offset = () =>
    page.evaluate((v) => {
      if (!document.querySelector('.prose .verse')) return null;
      const r = document.getElementById(`v${v}`)?.getBoundingClientRect();
      const top = document.getElementById('masthead')!.getBoundingClientRect().bottom;
      return r ? Math.round(r.top - top) : null;
    }, before.v);
  await expect.poll(async () => { const o = await offset(); return o !== null && o >= 0 && o < 60; }, { timeout: 5000 }).toBe(true);
  await page.waitForTimeout(800);
  const o = await offset();
  expect(o !== null && o >= 0 && o < 60, `verse ${before.v} stays at the top (offset ${o})`).toBe(true);
});

test('the keyboard focus card holds no Tab stops; Enter pins it and its links are reachable', async ({ page }) => {
  await openReader(page, '#/KJV/JHN/3');
  await page.evaluate(() => (document.querySelector('.prose [tabindex="0"]') as HTMLElement).focus());
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#word-card')).toHaveAttribute('role', 'tooltip');
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('aria-describedby'))).toBe(false);
  await page.keyboard.press('Tab');
  const where = await page.evaluate(() => ({
    inProse: Boolean(document.activeElement?.closest('.prose')),
    inCard: Boolean(document.activeElement?.closest('#word-card')),
  }));
  expect(where).toEqual({ inProse: false, inCard: false });
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#word-card')).toHaveAttribute('role', 'dialog');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#word-card')))).toBe(true);
});

test('keyboard focus lands on the passage after the passage picker and a search result', async ({ page }) => {
  await openReader(page, '#/KJV/JHN/3');
  await page.focus('.locator__ref');
  await page.keyboard.press('Enter');
  await expect(page.locator('#goto-input')).toBeFocused();
  await page.keyboard.type('rom 8:28');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/ROM\/8\/28$/);
  await expect(page.locator('#text [data-vn="28"]')).toBeFocused();

  await page.keyboard.press('/');
  await expect(page.locator('#search-input')).toBeFocused();
  await page.keyboard.type('"so loved the world"');
  await expect(page.locator('#search-panel [role="option"]').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/JHN\/3\/16$/);
  await expect(page.locator('#text [data-vn="16"]')).toBeFocused();
});

test('a verse the translation does not have says so and shows the next verse', async ({ page }) => {
  await openReader(page, '#/BSB/ROM/8');
  await page.evaluate(() => scrollTo(0, 2200));
  await page.evaluate(() => (location.hash = '#/BSB/MAT/17/21'));
  await expect(page.locator('.toast')).toContainText('Matthew 17:21 isn’t in the BSB');
  await expect
    .poll(() => page.evaluate(() => {
      const r = document.getElementById('v22')!.getBoundingClientRect();
      return r.top > 0 && r.bottom < innerHeight;
    }))
    .toBe(true);
});

test('links followed from the verse sheet leave no dead history entry (phone)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await freshStorage(ctx);
  const page = await ctx.newPage();
  await openReader(page, '#/KJV/JHN/2');
  await page.evaluate(() => (location.hash = '#/KJV/JHN/3'));
  await expect(page.locator('#chapter-title')).toContainText('3');
  await page.locator('[data-vn="16"]').tap();
  await expect(page.locator('.verse-sheet')).toBeVisible();
  await page.locator('.verse-sheet .vs-act', { hasText: 'Compare' }).click();
  await expect(page).toHaveURL(/compare/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/KJV\/JHN\/3$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/KJV\/JHN\/2$/);
  await ctx.close();
});

test('the chapter can be read aloud from its header', async ({ page, context }) => {
  await context.addInitScript(() => {
    class FakeUtterance {
      text: string;
      lang = '';
      rate = 1;
      voice: unknown = null;
      onstart?: () => void;
      onend?: () => void;
      constructor(text = '') {
        this.text = text;
      }
    }
    let timer = 0;
    const synth = Object.assign(new EventTarget(), {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [{ name: 'Test English', lang: 'en-US', voiceURI: 'test-en', localService: true, default: true }],
      speak(u: FakeUtterance) {
        u.onstart?.();
        timer = window.setTimeout(() => u.onend?.(), 900);
      },
      cancel() {
        window.clearTimeout(timer);
      },
      pause() {},
      resume() {},
    });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true, writable: true });
  });
  await openReader(page, '#/KJV/JHN/3');
  const listen = page.locator('.ch-head .listen-btn');
  await expect(listen).toBeVisible();
  await listen.click();
  await expect(page.locator('[aria-label="Listen mode"]').first()).toBeVisible();
  await expect(listen).toHaveAttribute('aria-pressed', 'true');
});

for (const width of [280, 320]) {
  test(`the About page has no horizontal overflow at ${width} px`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 640 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    await freshStorage(ctx);
    const page = await ctx.newPage();
    await openPage(page, '#/about');
    await expect(page.locator('.credits li').first()).toBeVisible();
    expect(await overflowX(page)).toBe(0);
    await ctx.close();
  });
}
