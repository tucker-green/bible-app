/**
 * docs/EXPERIENCE.md §7 special modes: reduced motion, forced colours (Windows High Contrast), high
 * contrast (setting and prefers-contrast), 200% text at 320 px, and keyboard reachability.
 */
import type { Page } from '@playwright/test';
import { test, expect, axe, overflowX, rect, freshStorage, openReader, unitIn } from '../support/fixtures';
import { STUDY_SEED, fixedOverlaps, openSettingsSheet, tabWalk } from '../support/qa';

const PHONE = { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true };
const SE1 = { viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true };
const DESKTOP = { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false };

test.describe('reduced motion', () => {
  test.use({ ...PHONE, contextOptions: { reducedMotion: 'reduce' } });
  test('the sheet jumps to its detent; no springs; axe clean', async ({ page, context }) => {
    await freshStorage(context);
    await openReader(page);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
    await page.tap(await unitIn(page, 4, 'life'));
    await page.waitForTimeout(140);
    const t1 = await page.locator('#word-card').evaluate((el) => (el as HTMLElement).style.transform || getComputedStyle(el).transform);
    await page.waitForTimeout(400);
    const t2 = await page.locator('#word-card').evaluate((el) => (el as HTMLElement).style.transform || getComputedStyle(el).transform);
    expect(t1, 'already at rest after ~150 ms').toBe(t2);
    // no running animations longer than 150 ms
    const long = await page.evaluate(() =>
      document.getAnimations().filter((a) => {
        const d = Number((a.effect?.getComputedTiming().duration as number) ?? 0);
        return a.playState === 'running' && d > 160;
      }).length,
    );
    expect(long).toBe(0);
    expect(await axe(page)).toEqual([]);
  });

  test('the in-app "Reduce motion" setting overrides the system', async ({ page, context }) => {
    await freshStorage(context, { 'rootword:settings': JSON.stringify({ motion: 'reduce' }) });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openReader(page);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  });
});

for (const [label, use] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(`forced colours (${label})`, () => {
    test.use({ ...use, contextOptions: { forcedColors: 'active' } });
    test('reader, word card, verse sheet stay usable and axe-clean', async ({ page, context }) => {
      await freshStorage(context, { 'rootword:study': STUDY_SEED });
      await openReader(page, '#/KJV/JHN/3');
      expect(await axe(page), 'axe: reader').toEqual([]);
      const word = await unitIn(page, 16, 'loved');
      if (label === 'phone') await page.tap(word);
      else await page.click(word);
      await page.waitForTimeout(700);
      // the selected word is marked without relying on a background tint alone
      const mark = await page.locator(word).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { outline: cs.outlineStyle, deco: cs.textDecorationLine, border: cs.borderBottomStyle, bg: cs.backgroundColor };
      });
      expect(mark.outline !== 'none' || mark.deco.includes('underline') || mark.border !== 'none', JSON.stringify(mark)).toBe(true);
      expect(await axe(page), 'axe: word card').toEqual([]);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      // highlighted verse 16 shows its highlight by more than a tint
      const hl = await page.locator('#v16').evaluate((el) => {
        const cs = getComputedStyle(el);
        return { deco: cs.textDecorationLine, style: cs.textDecorationStyle, color: cs.textDecorationColor, outline: cs.outlineStyle };
      });
      expect(hl.deco.includes('underline') || hl.outline !== 'none', JSON.stringify(hl)).toBe(true);
      if (label === 'phone') await page.tap('[data-vn="16"]');
      else await page.click('[data-vn="16"]');
      await page.waitForTimeout(800);
      expect(await axe(page), 'axe: verse sheet').toEqual([]);
    });

    test('every page stays axe-clean', async ({ page, context }) => {
      await freshStorage(context, { 'rootword:study': STUDY_SEED });
      for (const [hash, ready] of [
        ['#/search?q=love', '#search-panel .sp-group'],
        ['#/word/G3056', '#ws-lxx'],
        ['#/person/p0057', '.ent-page, main h1'],
        ['#/lineage/p0057', '.lt-page'],
        ['#/compare/KJV,BSB/JHN/1', '.cmp-grid [data-u]'],
        ['#/study', '.ms-item'],
        ['#/about', '.credits li'],
      ] as const) {
        await page.goto(hash);
        await page.locator(ready).first().waitFor();
        await page.waitForTimeout(600);
        expect.soft(await axe(page), `axe: ${hash}`).toEqual([]);
      }
      await page.goto('#/KJV/JHN/1');
      await page.locator('.prose [data-u]').first().waitFor();
      await openSettingsSheet(page);
      expect.soft(await axe(page), 'axe: settings').toEqual([]);
    });
  });
}

test.describe('high contrast', () => {
  test.use({ ...PHONE, colorScheme: 'dark' });
  test('the setting applies html[data-contrast=more]; sheet axe-clean', async ({ page, context }) => {
    await freshStorage(context, { 'rootword:settings': JSON.stringify({ highContrast: true }) });
    await openReader(page);
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
    await page.tap(await unitIn(page, 4, 'life'));
    await page.waitForTimeout(800);
    expect(await axe(page)).toEqual([]);
  });

  test('prefers-contrast: more is honoured', async ({ page, context }) => {
    await freshStorage(context);
    await page.emulateMedia({ contrast: 'more' } as Parameters<Page['emulateMedia']>[0]);
    await openReader(page);
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
    expect(await axe(page)).toEqual([]);
  });
});

test.describe('200% text at 320 px', () => {
  test.use(SE1);
  test('every screen reflows without sideways scrolling', async ({ page, context }) => {
    test.setTimeout(150_000);
    await freshStorage(context, { 'rootword:fontScale': '2', 'rootword:study': STUDY_SEED });
    const check = async (what: string) => {
      await page.waitForTimeout(500);
      expect.soft(await overflowX(page), `${what}: no horizontal overflow`).toBeLessThanOrEqual(0);
      expect.soft(await fixedOverlaps(page), `${what}: no overlapping fixed layers`).toEqual([]);
    };
    await openReader(page);
    await check('reader');
    await page.tap(await unitIn(page, 1, 'Word'));
    await page.waitForTimeout(800);
    await check('word sheet');
    const card = await rect(page, '#word-card');
    expect.soft(card && card.right <= 320.5, 'word sheet fits').toBe(true);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.tap('[data-vn="2"]');
    await page.waitForTimeout(800);
    await check('verse sheet');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.locator('.toolbar .tb-btn', { hasText: 'Interlinear' }).tap();
    await page.waitForTimeout(800);
    await check('interlinear');
    await page.locator('.toolbar .tb-btn', { hasText: 'Interlinear' }).tap(); // back to reading
    await openSettingsSheet(page);
    await check('settings');
    await page.keyboard.press('Escape');
    for (const hash of ['#/search?q=light', '#/word/G3056', '#/person/p0057', '#/lineage/p0057', '#/compare/KJV,BSB/JHN/1', '#/study', '#/about']) {
      await page.goto(hash);
      await page.locator('main h1, #search-panel .sp-title').first().waitFor();
      await check(hash);
    }
  });
});

/** Every visible control in these regions must be reached by Tab, and focus never lands on something invisible. */
async function keyboardReach(page: Page, regions: string) {
  const stops = await tabWalk(page, 220);
  const hidden = stops.filter((s) => !s.visible).map((s) => s.desc);
  expect.soft(hidden, 'focus never lands on an invisible element').toEqual([]);
  const controls = await page.evaluate((regions) => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`${regions}`))) {
      for (const c of Array.from(el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, [tabindex="0"]'))) {
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        if (!r.width || !r.height || cs.visibility === 'hidden' || c.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
        if (c.tabIndex < 0) continue;
        out.push(`${c.tagName.toLowerCase()}${c.id ? `#${c.id}` : ''}.${String(c.className).split(' ')[0]} "${(c.getAttribute('aria-label') || c.textContent || '').trim().slice(0, 30)}"`);
      }
    }
    return out;
  }, regions);
  const reached = new Set(stops.map((s) => s.desc));
  const missed = controls.filter((c) => !reached.has(c));
  expect.soft(missed, 'every control is reachable with Tab').toEqual([]);
  return stops;
}

test.describe('keyboard reachability', () => {
  test.use(DESKTOP);
  test('reader (desktop): header, rails and text in a sane order', async ({ page, context }) => {
    await freshStorage(context);
    await openReader(page);
    const stops = await keyboardReach(page, '.masthead, .rail--left');
    const iSkip = stops.findIndex((s) => s.desc.includes('skip-link'));
    const iBrand = stops.findIndex((s) => s.desc.includes('brand'));
    const iWord = stops.findIndex((s) => s.desc.startsWith('span.w'));
    expect(iSkip, 'skip link first').toBe(0);
    expect(iBrand).toBeGreaterThan(iSkip);
    expect(iWord, 'the text comes after the header').toBeGreaterThan(iBrand);
  });

  for (const hash of ['#/word/G3056', '#/person/p0057', '#/lineage/p0057', '#/compare/KJV,BSB/JHN/1', '#/study', '#/about']) {
    test(`page ${hash}: every control reachable`, async ({ page, context }) => {
      await freshStorage(context, { 'rootword:study': STUDY_SEED });
      await page.goto(hash);
      await page.locator('main h1').waitFor();
      await page.waitForTimeout(800);
      await keyboardReach(page, '.masthead, .page-aside, main header');
    });
  }
});

test.describe('keyboard reachability (phone)', () => {
  test.use({ viewport: { width: 393, height: 852 } });
  test('reader (phone): header and bottom toolbar reachable', async ({ page, context }) => {
    await freshStorage(context);
    await openReader(page);
    await keyboardReach(page, '.masthead, .toolbar');
  });
});
