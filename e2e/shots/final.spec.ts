/**
 * Final screenshots of every major screen: design/screenshots/final-{screen}-{desktop|phone}-{light|dark}.png
 * Only runs when asked:  SHOTS=1 npx playwright test --project=shots
 */
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, freshStorage, openReader, unitIn, rect, Touch } from '../support/fixtures';
import { STUDY_SEED, openSettingsSheet } from '../support/qa';

test.skip(!process.env.SHOTS, 'set SHOTS=1 to recapture design/screenshots/final-*.png');
// No service worker: its one-time "Rootword now works offline" toast is not part of any screen.
test.use({ serviceWorkers: 'block' });

const OUT = 'design/screenshots';
mkdirSync(OUT, { recursive: true });

const FORMS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
} as const;

type Form = keyof typeof FORMS;

async function press(page: Page, form: Form, sel: string) {
  if (form === 'phone') await page.tap(sel);
  else await page.click(sel);
}

/** [name, how to get there] — each is shot on desktop and phone, light and dark. */
const SCREENS: [string, (page: Page, form: Form) => Promise<void>][] = [
  ['reader', async (page) => {
    await openReader(page, '#/KJV/JHN/1');
  }],
  ['word', async (page, form) => {
    await openReader(page, '#/KJV/JHN/1');
    const w = await unitIn(page, 1, 'Word');
    if (form === 'desktop') await page.hover(w);
    await press(page, form, w);
    await expect(page.locator('#word-card .card__def-txt')).toBeVisible();
  }],
  ['word-ot', async (page, form) => {
    await openReader(page, '#/KJV/GEN/1');
    const w = await unitIn(page, 1, 'created');
    if (form === 'desktop') await page.hover(w);
    await press(page, form, w);
    await expect(page.locator('#word-card .lxx-word')).toBeVisible();
  }],
  ['verse', async (page, form) => {
    await openReader(page, '#/KJV/JHN/1');
    await press(page, form, '[data-vn="1"]');
    await expect(page.locator('.verse-sheet .xr-sec')).toContainText('Genesis 1:1');
  }],
  ['interlinear', async (page) => {
    await page.context().addInitScript(() => localStorage.setItem('rootword:mode', 'interlinear'));
    await openReader(page, '#/KJV/JHN/1');
  }],
  ['redletter', async (page) => {
    await openReader(page, '#/KJV/MAT/5');
    await page.evaluate(() => document.getElementById('v3')?.scrollIntoView({ block: 'center' }));
  }],
  ['person-card', async (page, form) => {
    await openReader(page, '#/KJV/GEN/17');
    const w = await unitIn(page, 5, 'Abraham');
    await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), w);
    await page.waitForTimeout(300);
    await press(page, form, w);
    await expect(page.locator('#word-card .ent-card.is-person')).toBeVisible();
    if (form === 'phone') {
      // full height, scrolled to the person block
      await page.locator('#word-card .ent-card').scrollIntoViewIfNeeded();
    }
  }],
  ['search', async (page) => {
    await page.goto('#/search?q=love');
    await page.locator('#search-panel .sp-group').first().waitFor();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }],
  ['search-strongs', async (page) => {
    await page.goto('#/search?q=G26');
    await page.locator('#search-panel .sp-group').first().waitFor();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }],
  ['settings', async (page) => {
    await openReader(page, '#/KJV/JHN/1');
    await openSettingsSheet(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }],
  ['aa-panel', async (page) => {
    await openReader(page, '#/KJV/JHN/1');
    await page.locator('.aa-btn:visible, .toolbar .tb-btn[aria-label^="Aa"]:visible').first().click();
    await page.locator('.dp').waitFor();
  }],
  ['wordstudy', async (page) => {
    await page.goto('#/word/G3056');
    await page.locator('#ws-lxx').waitFor();
  }],
  ['wordstudy-lxx', async (page) => {
    await page.goto('#/word/G3056');
    await page.locator('#ws-lxx').waitFor();
    await page.evaluate(() => {
      const el = document.getElementById('ws-lxx')!;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
    });
  }],
  ['person', async (page) => {
    await page.goto('#/person/p0057');
    await page.locator('main h1', { hasText: 'Abraham' }).waitFor();
  }],
  ['lineage', async (page) => {
    await page.goto('#/lineage/p0057');
    await page.locator('.lt-page').waitFor();
    await page.evaluate(() => {
      const el = document.getElementById('lt-tree-h')!;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
    });
  }],
  ['compare', async (page, form) => {
    await page.goto('#/compare/KJV,BSB/JHN/1');
    await page.locator('.cmp-grid [data-u]').first().waitFor();
    await page.evaluate(() => {
      const el = document.querySelector('.cmp-bar')!;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
    });
    await page.waitForTimeout(400);
    const made = page.locator('[data-row="3"] [data-col="0"] [data-u]', { hasText: /^made$/ }).first();
    // pinned, so the twins stay lit while the shot waits
    if (form === 'desktop') {
      await made.hover();
      await made.click();
    } else await made.tap();
  }],
  ['study', async (page) => {
    await page.goto('#/study');
    await page.locator('.ms-item').first().waitFor();
  }],
  ['about', async (page) => {
    await page.goto('#/about');
    await page.locator('.credits li').first().waitFor();
  }],
  ['credits', async (page) => {
    await page.goto('#/about');
    await page.locator('.credits li').first().waitFor();
    await page.evaluate(() => {
      const el = document.querySelector('.credits')!;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 140);
    });
  }],
];

for (const form of Object.keys(FORMS) as Form[]) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${form} ${theme}`, () => {
      test.use({ ...FORMS[form], colorScheme: theme });
      test.beforeEach(async ({ context }) => {
        await freshStorage(context, { 'rootword:study': STUDY_SEED });
      });
      for (const [name, go] of SCREENS) {
        test(name, async ({ page }) => {
          await go(page, form);
          await page.waitForTimeout(900);
          // the one-time "Rootword now works offline" toast of a first visit is not part of the screen
          await page.locator('.toast').waitFor({ state: 'detached', timeout: 6000 }).catch(() => undefined);
          await page.mouse.move(0, 0).catch(() => undefined);
          await page.screenshot({ path: `${OUT}/final-${name}-${form}-${theme}.png` });
        });
      }
      if (form === 'phone') {
        test('scrub', async ({ page, context }) => {
          await openReader(page, '#/KJV/JHN/1');
          await page.locator('.toast').waitFor({ state: 'detached', timeout: 6000 }).catch(() => undefined);
          const t = await Touch.attach(context, page);
          const a = (await rect(page, await unitIn(page, 1, 'beginning')))!;
          const b = (await rect(page, await unitIn(page, 1, 'God', 1)))!;
          await t.down({ x: a.x, y: a.y });
          await page.waitForTimeout(450);
          for (let i = 1; i <= 8; i++) {
            await t.move({ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 });
            await page.waitForTimeout(40);
          }
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${OUT}/final-scrub-phone-${theme}.png` });
          await t.up();
        });
      }
    });
  }
}
