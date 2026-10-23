/**
 * docs/EXPERIENCE.md §7 QA matrix: every viewport, light and dark, touch emulation on phones and
 * tablets. For each: no horizontal overflow, no overlapping fixed layers, the dock never hides the
 * end of the text, word card / sheet (tap → sheet keeps the word visible, press-and-slide scrubbing
 * updates it), verse sheet, and axe-core with zero violations on the reader, word sheet, verse
 * sheet, search, settings, word study, person, lineage, compare, my study and about.
 *
 * Special modes (reduced motion, forced colours, high contrast, 200% text) and keyboard reachability
 * are in modes.spec.ts. Failures are soft: one run reports every problem of a viewport.
 */
import type { Page } from '@playwright/test';
import { test, expect, axe, overflowX, rect, Touch, freshStorage, openReader } from '../support/fixtures';
import { VIEWPORTS, STUDY_SEED, fixedOverlaps, openSettingsSheet, smallTargets } from '../support/qa';

/** A word unit near `frac` of the viewport height, fully visible and clear of the chrome. */
async function unitNear(page: Page, frac: number): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const u = await page.evaluate((frac) => {
      const head = document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0;
      const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 0;
      const target = innerHeight * frac;
      let best: string | null = null;
      let dist = Infinity;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.prose [data-u]'))) {
        const b = el.getBoundingClientRect();
        if (b.top < head + 8 || b.bottom > innerHeight - dock - 8 || b.width < 14 || b.width > 150) continue;
        const d = Math.abs(b.top - target);
        if (d < dist) {
          dist = d;
          best = el.dataset.u!;
        }
      }
      return best;
    }, frac);
    if (u !== null) return `.prose [data-u="${u}"]`;
    await page.evaluate(() => window.scrollBy(0, innerHeight * 0.4));
    await page.waitForTimeout(250);
  }
  throw new Error('no word unit on screen');
}

async function settle(page: Page, ms = 450) {
  await page.waitForTimeout(ms);
}

for (const vp of VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${vp.name} ${vp.width}×${vp.height} ${theme}${vp.touch ? ' touch' : ''}`, () => {
      test.use({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme,
        hasTouch: vp.touch,
        isMobile: vp.touch,
        deviceScaleFactor: 1,
      });

      test.beforeEach(async ({ context }) => {
        await freshStorage(context, { 'rootword:study': STUDY_SEED });
      });

      test('reader, word, verse sheet', async ({ page, context }) => {
        const phoneish = vp.width < 600;
        await openReader(page, '#/KJV/JHN/1');
        await settle(page);
        expect.soft(await overflowX(page), 'no horizontal overflow').toBeLessThanOrEqual(0);
        expect.soft(await fixedOverlaps(page), 'no overlapping fixed layers').toEqual([]);
        const toolbar = await rect(page, '.toolbar');
        if (phoneish) expect.soft(toolbar && toolbar.bottom <= vp.height + 0.5 && toolbar.top >= vp.height - 130, 'bottom toolbar within thumb reach').toBe(true);
        else expect.soft(toolbar, 'no bottom toolbar at ≥ 600 px').toBeNull();
        if (vp.touch && theme === 'light') {
          expect.soft(await smallTargets(page, '.masthead, .toolbar'), 'header / toolbar targets ≥ 44 px').toEqual([]);
        }
        expect.soft(await axe(page), 'axe: reader').toEqual([]);

        // The dock never hides the end of the chapter (content-visibility: scroll until it stops growing)
        for (let i = 0; i < 14; i++) {
          const moved = await page.evaluate(() => {
            const y = window.scrollY;
            window.scrollTo(0, document.documentElement.scrollHeight);
            return window.scrollY !== y;
          });
          await page.waitForTimeout(120);
          if (!moved && i > 1) break;
        }
        await settle(page, 300);
        const end = await page.evaluate(() => {
          const c = document.querySelector('.colophon')?.getBoundingClientRect();
          const d = document.querySelector('.dock')?.getBoundingClientRect();
          return c && d && d.height > 0 ? { c: c.bottom, d: d.top } : null;
        });
        if (end) expect.soft(end.c, 'the dock never covers the end of the chapter').toBeLessThanOrEqual(end.d + 1);
        expect.soft(await overflowX(page), 'no horizontal overflow (end of chapter)').toBeLessThanOrEqual(0);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page, 300);

        if (vp.touch) {
          // tap → bottom sheet that keeps the tapped word visible
          const word = await unitNear(page, 0.7);
          await page.tap(word);
          await settle(page, 1000);
          const w = await rect(page, word);
          const card = await rect(page, '#word-card');
          const head = await rect(page, '#masthead');
          expect.soft(card, 'tap opens the word sheet').not.toBeNull();
          if (card && w) {
            const side = card.left >= w.right - 1; // side-anchored sheet (landscape)
            expect.soft(side || w.bottom <= card.top + 1, `sheet does not cover the tapped word (word ${Math.round(w.top)}–${Math.round(w.bottom)}, sheet top ${Math.round(card.top)})`).toBe(true);
            expect.soft(w.top, 'tapped word is below the header').toBeGreaterThanOrEqual((head?.bottom ?? 0) - 1);
            expect.soft(card.right <= vp.width + 1 && card.left >= -1, 'sheet inside the viewport').toBe(true);
          }
          expect.soft(await overflowX(page), 'no horizontal overflow (word sheet)').toBeLessThanOrEqual(0);
          if (theme === 'light') expect.soft(await smallTargets(page, '#word-card'), 'word sheet targets ≥ 44 px').toEqual([]);
          expect.soft(await axe(page), 'axe: word sheet').toEqual([]);
          await page.keyboard.press('Escape');
          await settle(page, 400);
          expect.soft(await page.locator('#word-card').count(), 'Esc closes the sheet').toBe(0);

          // press-and-slide scrubbing
          const t = await Touch.attach(context, page);
          const a = (await rect(page, await unitNear(page, 0.35)))!;
          const b = await page.evaluate((a) => {
            for (const el of Array.from(document.querySelectorAll('.prose [data-u]'))) {
              const r = el.getBoundingClientRect();
              if (r.top > a.bottom + 30 && r.top < a.bottom + 140) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
            return { x: Math.min(innerWidth - 20, a.x + 120), y: a.y };
          }, a);
          const sc = await t.pressAndSlide({ x: a.x, y: a.y }, b, 10);
          expect.soft(sc.engaged, 'long-press engages scrubbing (loupe)').toBe(true);
          expect.soft(sc.seen.length, `scrubbing updates the card live: ${sc.seen.join(' | ')}`).toBeGreaterThanOrEqual(2);
          expect.soft(await page.locator('#word-card').count(), 'lifting keeps the last word selected').toBe(1);
          await page.keyboard.press('Escape');
          await settle(page, 400);

          // verse number → verse sheet, verse stays visible
          await page.evaluate(() => window.scrollTo(0, 0));
          await settle(page, 200);
          await page.tap('[data-vn="3"]');
          await settle(page, 900);
          const vs = await rect(page, '.verse-sheet');
          const v3 = await rect(page, '#v3 [data-vn]');
          expect.soft(vs, 'verse number opens the verse sheet').not.toBeNull();
          if (vs && v3) expect.soft(v3.bottom <= vs.top + 1 || vs.left >= v3.right, 'verse sheet keeps the verse visible').toBe(true);
          expect.soft(await overflowX(page), 'no horizontal overflow (verse sheet)').toBeLessThanOrEqual(0);
          if (theme === 'light') {
            await page.locator('.vs-study summary').evaluate((el: HTMLElement) => el.click());
            await settle(page, 200);
            expect.soft(await smallTargets(page, '.verse-sheet'), 'verse sheet targets ≥ 44 px').toEqual([]);
          }
          expect.soft(await axe(page), 'axe: verse sheet').toEqual([]);
          await page.keyboard.press('Escape');
          await settle(page, 400);
        } else {
          // mouse: hover → tooltip, click → pinned dialog inside the viewport, Esc
          const word = await unitNear(page, 0.45);
          await page.hover(word);
          await settle(page);
          expect.soft(await page.locator('#word-card').getAttribute('role').catch(() => null), 'hover opens the card').toBe('tooltip');
          await page.click(word);
          await settle(page);
          expect.soft(await page.locator('#word-card').getAttribute('role').catch(() => null), 'click pins the card').toBe('dialog');
          const card = await rect(page, '#word-card');
          if (card) expect.soft(card.left >= 0 && card.right <= vp.width && card.top >= 0, 'card inside the viewport').toBe(true);
          expect.soft(await axe(page), 'axe: pinned word card').toEqual([]);
          await page.keyboard.press('Escape');
          await settle(page, 300);
          await page.click('[data-vn="4"]');
          await settle(page, 700);
          expect.soft(await page.locator('.verse-sheet').count(), 'verse number opens the verse panel').toBe(1);
          expect.soft(await overflowX(page), 'no horizontal overflow (verse panel)').toBeLessThanOrEqual(0);
          expect.soft(await axe(page), 'axe: verse panel').toEqual([]);
          await page.keyboard.press('Escape');
          await settle(page, 300);
        }
        expect.soft(await fixedOverlaps(page), 'no overlapping fixed layers (after interactions)').toEqual([]);
      });

      test('pages: search, settings, word study, person, lineage, compare, my study, about', async ({ page }) => {
        // [label, hash to open (null: stay on the current screen), wait until ready]
        const screens: [string, string | null, (p: Page) => Promise<void>][] = [
          ['search', '#/search?q=love', async (p) => {
            await p.locator('#search-panel .sp-group').first().waitFor({ timeout: 20_000 });
          }],
          ['settings', '#/KJV/JHN/1', async (p) => {
            await p.locator('.prose [data-u]').first().waitFor();
            await openSettingsSheet(p);
          }],
          ['settings (full height)', null, async (p) => {
            // still open from the previous step: scroll to its end (the sheet expands to full height)
            await p.locator('.st-sheet').waitFor();
            await p.locator('.st-body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
            await p.mouse.wheel(0, 400);
            await p.waitForTimeout(400);
            await p.locator('.st-body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
          }],
          ['word study', '#/word/G3056', async (p) => {
            await p.locator('#ws-lxx').waitFor({ timeout: 20_000 });
          }],
          ['word study (Hebrew)', '#/word/H1697', async (p) => {
            await p.locator('#ws-lxx').waitFor({ timeout: 20_000 });
          }],
          ['person', '#/person/p0057', async (p) => {
            await p.locator('main h1', { hasText: 'Abraham' }).waitFor();
          }],
          ['lineage', '#/lineage/p0057', async (p) => {
            await p.locator('.lt-page').waitFor();
          }],
          ['compare', '#/compare/KJV,BSB/JHN/1', async (p) => {
            await p.locator('.cmp-grid [data-u]').first().waitFor();
          }],
          ['compare (scrolled: sticky bar under the header)', null, async (p) => {
            await p.evaluate(() => window.scrollBy(0, Math.min(900, document.documentElement.scrollHeight / 3)));
            await p.waitForTimeout(500);
            await p.evaluate(() => window.scrollBy(0, -40)); // scrolling up brings the header back
          }],
          ['my study', '#/study', async (p) => {
            await p.locator('.ms-item').first().waitFor();
          }],
          ['about', '#/about', async (p) => {
            await p.locator('.credits li').first().waitFor();
          }],
        ];
        for (const [label, hash, ready] of screens) {
          await test.step(label, async () => {
            if (!label.startsWith('settings (') && (await page.locator('.st-sheet').count())) {
              await page.keyboard.press('Escape');
              await page.locator('.st-sheet').waitFor({ state: 'detached' });
            }
            if (hash) await page.goto(hash);
            await ready(page);
            await settle(page, 700);
            expect.soft(await overflowX(page), `${label}: no horizontal overflow`).toBeLessThanOrEqual(0);
            expect.soft(await fixedOverlaps(page), `${label}: no overlapping fixed layers`).toEqual([]);
            expect.soft(await axe(page), `axe: ${label}`).toEqual([]);
          });
        }
      });
    });
  }
}
