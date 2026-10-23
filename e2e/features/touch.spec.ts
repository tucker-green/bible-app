/** The word interaction on a touch screen (docs/EXPERIENCE.md §2): tap → bottom sheet, press-and-slide scrubbing, swipe. */
import { test, expect, openReader, unitIn, rect, Touch, freshStorage } from '../support/fixtures';

test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

test.beforeEach(async ({ context }) => {
  await freshStorage(context);
});

test('tap a word → bottom sheet at peek height that never hides the tapped word', async ({ page }) => {
  await openReader(page, '#/KJV/JHN/1');
  // a word low on the screen, where a 45% sheet would cover it
  const word = await unitIn(page, 5, 'darkness');
  await page.locator(word).scrollIntoViewIfNeeded();
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight * 0.75);
  }, word);
  await page.tap(word);
  const card = page.locator('#word-card');
  await expect(card).toHaveClass(/is-sheet/);
  await expect(card).toHaveAttribute('role', 'dialog');
  await expect(card.locator('#word-card-head')).toHaveText('σκοτίᾳ');
  await page.waitForTimeout(700); // sheet spring + scroll settle
  const w = (await rect(page, word))!;
  const c = (await rect(page, '#word-card'))!;
  expect(w.bottom, 'the tapped word sits above the sheet').toBeLessThanOrEqual(c.top + 1);
  expect(w.top, 'and below the top bar').toBeGreaterThanOrEqual(0);
  const peek = (852 - c.top) / 852;
  expect(peek, `peek height ${Math.round(peek * 100)}%`).toBeGreaterThan(0.3);
  expect(peek).toBeLessThan(0.75);

  // tapping another word swaps the content in place
  const other = await unitIn(page, 5, 'light');
  await page.tap(other);
  await expect(card.locator('#word-card-head')).toHaveText('φῶς');
  await expect(page.locator('#word-card')).toHaveCount(1);

  // the close button dismisses it
  await card.getByRole('button', { name: /close word study/i }).tap();
  await expect(page.locator('#word-card')).toHaveCount(0);
});

test('press-and-slide scrubbing updates the sheet word by word and shows the loupe', async ({ page, context }) => {
  await openReader(page, '#/KJV/JHN/1');
  const t = await Touch.attach(context, page);
  const a = (await rect(page, await unitIn(page, 1, 'In')))!;
  const b = (await rect(page, await unitIn(page, 1, 'God', 1)))!;
  const { engaged, seen } = await t.pressAndSlide({ x: a.x, y: a.y }, { x: b.x, y: b.y }, 14);
  expect(engaged, 'long-press engages scrub mode with the loupe').toBe(true);
  expect(seen.length, `the sheet followed the finger: ${seen.join(' → ')}`).toBeGreaterThanOrEqual(3);
  expect(seen[0]).toContain('In');
  // lifting the finger keeps the last word selected
  await expect(page.locator('html')).not.toHaveClass(/is-scrubbing/);
  await expect(page.locator('#word-card')).toHaveClass(/is-sheet/);
  await expect(page.locator('.loupe')).toHaveCount(0);
});

test('swipe left / right changes chapter; a short swipe does nothing', async ({ page, context }) => {
  await openReader(page, '#/KJV/JHN/1');
  const t = await Touch.attach(context, page);
  await t.swipe(330, 50, 500);
  await expect(page).toHaveURL(/JHN\/2$/);
  await page.locator('.prose [data-u]').first().waitFor();
  await page.waitForTimeout(500);
  await t.swipe(60, 340, 500);
  await expect(page).toHaveURL(/JHN\/1$/);
  await page.waitForTimeout(500);
  await t.swipe(200, 170, 500);
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/JHN\/1$/);
});

test('phone layout: bottom toolbar with labelled 44px targets, compact header', async ({ page }) => {
  await openReader(page);
  const bar = page.locator('.toolbar');
  await expect(bar).toBeVisible();
  for (const label of ['John 1', 'KJV', 'Search', 'Interlinear', 'Aa']) await expect(bar).toContainText(label);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.toolbar .tb-btn, .masthead button, .masthead a')]
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && (r.width < 44 || r.height < 44)).length,
  );
  expect(small).toBe(0);
  await expect(page.locator('.hdr-title')).toContainText('John 1');
});
