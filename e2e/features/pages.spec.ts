/** Compare, word study, people & lineage, About. */
import { test, expect, openReader, openPage, unitIn, freshStorage } from '../support/fixtures';

test.beforeEach(async ({ context }) => {
  await freshStorage(context);
});

test('compare: KJV and BSB side by side; a word lights up its twins in the other column', async ({ page }) => {
  await openPage(page, '#/compare/KJV,BSB/JHN/1');
  await expect(page.locator('main h1')).toContainText('John');
  const grid = page.locator('.cmp-grid');
  await expect(grid.locator('[data-row="1"] .cmp-cell')).toHaveCount(2);
  await expect(grid.locator('[data-row="3"] [data-col="0"]')).toContainText('All things were made by him');
  await expect(grid.locator('[data-row="3"] [data-col="1"]')).toContainText('Through Him all things were made');

  // hover "made" (ἐγένετο) in the KJV column of verse 3 → the BSB words for the same Greek word light up
  const made = page.locator('[data-row="3"] [data-col="0"] [data-u]', { hasText: /^made$/ }).first();
  await made.hover();
  await expect(page.locator('#word-card #word-card-head')).toHaveText('ἐγένετο');
  const twins = page.locator('[data-row="3"] [data-col="1"] .is-twin');
  await expect(twins.first()).toBeVisible();
  await expect(twins.first()).toContainText(/made/);
});

test('word study G3056: meaning, renderings, forms and the Septuagint bridge to H1697', async ({ page }) => {
  await openPage(page, '#/word/G3056');
  await expect(page.locator('main h1')).toContainText('λόγος');
  await expect(page.locator('#ws-meaning')).toContainText('λόγος');
  await expect(page.locator('#ws-translated')).toContainText('word');
  await expect(page.locator('#ws-forms')).toContainText('N-NSM');
  const lxx = page.locator('#ws-lxx');
  await expect(lxx).toContainText('Septuagint');
  await expect(lxx).toContainText('דָּבָר');
  await expect(lxx).toContainText('H1697');
  await lxx.getByRole('link', { name: /H1697/ }).first().click();
  await expect(page).toHaveURL(/#\/word\/H1697$/);
  await expect(page.locator('main h1')).toContainText('דָּבָר');
  // the bridge back: Hebrew → Greek
  await expect(page.locator('#ws-lxx')).toContainText('λόγος');
});

test('people: "Abraham" in Gen 17:5 shows a person card; the lineage page renders his family', async ({ page }) => {
  await openReader(page, '#/KJV/GEN/17');
  const abraham = await unitIn(page, 5, 'Abraham');
  await page.click(abraham);
  const card = page.locator('#word-card');
  await expect(card.locator('#word-card-head')).toContainText('אַבְרָהָם');
  const person = card.locator('.ent-card.is-person');
  await expect(person).toBeVisible();
  await expect(person.locator('.ent-card__name')).toContainText('Abraham');
  await expect(person).toContainText('Isaac');
  await expect(person.getByRole('link', { name: /about abraham/i })).toHaveAttribute('href', '#/person/p0057');

  // the card re-places itself once the person block has loaded: still clear of the header and
  // the word, and inside the viewport (pinned: the page scrolls to fit it)
  const fits = () =>
    page.evaluate((sel) => {
      const c = document.getElementById('word-card')!.getBoundingClientRect();
      const head = document.getElementById('masthead')!.getBoundingClientRect().bottom;
      const w = document.querySelector(sel)!.getBoundingClientRect();
      const clear = c.top >= w.bottom - 1 || c.bottom <= w.top + 1;
      return c.top >= head - 1 && c.bottom <= window.innerHeight + 1 && clear;
    }, abraham);
  await expect.poll(fits).toBe(true);
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 5);
  // the same as a hover card, with the word in the middle of the screen
  await page.locator(abraham).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.hover(abraham);
  await expect(page.locator('#word-card .ent-card.is-person')).toBeVisible();
  await page.waitForTimeout(400);
  await expect.poll(fits).toBe(true);
  await page.click(abraham);
  await expect(person.getByRole('link', { name: /family tree/i })).toBeVisible();

  await person.getByRole('link', { name: /family tree/i }).click();
  await expect(page).toHaveURL(/#\/lineage\/p0057$/);
  await expect(page.locator('main h1')).toHaveText('Abraham');
  const tree = page.locator('.lt-page');
  await expect(tree).toContainText('Terah');
  await expect(tree).toContainText('Isaac');
  await expect(tree).toContainText('Ishmael');

  await openPage(page, '#/person/p0057');
  await expect(page.locator('main h1')).toHaveText('Abraham');
  await expect(page.locator('main')).toContainText('H85');
  await expect(page.locator('main')).toContainText('G11');
});

test('About credits every source and its licence', async ({ page }) => {
  await openPage(page, '#/about');
  await expect(page.locator('main h1')).toHaveText('Rootword');
  const credits = page.locator('.credits');
  await expect(credits.locator('li').first()).toBeVisible();
  const text = await credits.innerText();
  for (const [source, licence] of [
    ['OpenBible.info', 'CC BY'],
    ['TIPNR', 'CC BY 4.0'],
    ['TBESG', 'CC BY 4.0'],
    ['Clear-Bible Alignments', 'CC BY 4.0'],
    ['SBLGNT', 'CC BY 4.0'],
    ['Macula Hebrew', 'CC BY 4.0'],
    ['Westminster Leningrad Codex', 'PUBLIC DOMAIN'],
    ['King James Version', 'PUBLIC DOMAIN'],
    ['Berean Standard Bible', 'PUBLIC DOMAIN'],
    ['Strong', 'PUBLIC DOMAIN'],
    ['World English Bible', 'PUBLIC DOMAIN'],
    ['Young', 'PUBLIC DOMAIN'],
  ] as const) {
    const item = credits.locator('li', { hasText: source }).first();
    await expect(item, source).toBeVisible();
    await expect(item.locator('.credits__lic'), `${source} licence`).toHaveText(new RegExp(licence, 'i'));
  }
  expect(text).not.toMatch(/\bLogos\b(?! Bible Software)/);
  // NIV is never bundled
  await expect(page.locator('main')).toContainText('never bundles');
});
