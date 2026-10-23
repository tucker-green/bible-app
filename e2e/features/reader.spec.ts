/** The reader with a mouse and a keyboard: default route, word card, keyboard model, interlinear, red letter. */
import { test, expect, openReader, unitIn, freshStorage } from '../support/fixtures';

test.beforeEach(async ({ context }) => {
  await freshStorage(context);
});

test('opens the KJV at John 1 by default', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveURL(/#\/KJV\/JHN\/1$/);
  await expect(page.locator('#chapter-title')).toContainText('John');
  await expect(page.locator('.tr-btn__abbr')).toHaveText('KJV');
  await expect(page.locator('#v1')).toContainText('In the beginning was the Word');
  await expect(page).toHaveTitle(/Rootword/);
});

test('hovering "Word" shows λόγος, G3056 and a Speak button; click pins, Esc closes', async ({ page }) => {
  await openReader(page);
  const word = await unitIn(page, 1, 'Word');
  await page.hover(word);
  const card = page.locator('#word-card');
  await expect(card).toHaveAttribute('role', 'tooltip');
  await expect(card.locator('#word-card-head')).toHaveText('λόγος');
  await expect(card.locator('.card__strongs')).toContainText('G3056');
  await expect(card.locator('.card__translit').first()).toHaveText('logos');
  await expect(card).toContainText('Noun');
  await expect(card.locator('.card__def')).toContainText(/word/i);
  // Speak button (hidden only when the browser has no speech synthesis; headless Chromium has it)
  await expect(card.getByRole('button', { name: /pronounce/i })).toBeVisible();
  // related words with the same Strong's are marked
  await expect(page.locator('.prose .is-kin, .prose .is-linked').first()).toBeAttached();

  await page.click(word);
  await expect(card).toHaveAttribute('role', 'dialog');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('keyboard: Tab enters the text, → moves word by word, Enter pins, Esc closes and returns focus', async ({ page }) => {
  await openReader(page);
  // First Tab: the skip link; Enter jumps to the text; the next Tab lands on its first word
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const inText = await page.evaluate(() => Boolean(document.activeElement?.closest('.prose [data-u]')));
  expect(inText, 'Tab after the skip link reaches the first word of the text').toBe(true);
  const first = await page.evaluate(() => (document.activeElement as HTMLElement).textContent);
  expect(first).toBe('In');
  // focusing a word shows its card (tooltip)
  await expect(page.locator('#word-card')).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const focused = await page.evaluate(() => (document.activeElement as HTMLElement).textContent);
  expect(focused).toBe('the Word');
  await expect(page.locator('#word-card #word-card-head')).toHaveText('λόγος');

  await page.keyboard.press('Enter');
  const card = page.locator('#word-card');
  await expect(card).toHaveAttribute('role', 'dialog');
  await expect(card).toHaveAttribute('aria-label', /Word study: λόγος/);
  // the pinned (non-modal) card is the next stop in the tab order: Speak, Strong's, links…
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#word-card')))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('#word-card[role="dialog"]')).toHaveCount(0);
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).textContent)).toBe('the Word');

  // ↓ moves to the next verse number; Enter opens the verse sheet; Esc returns focus to it
  await page.keyboard.press('ArrowDown');
  const vn = await page.evaluate(() => document.activeElement?.getAttribute('data-vn'));
  expect(vn).toBeTruthy();
  await page.keyboard.press('Enter');
  await expect(page.locator('.verse-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.verse-sheet')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-vn'))).toBe(vn);
});

test('interlinear shows the Greek under each English word', async ({ page }) => {
  await openReader(page);
  await page.locator('.mode-hdr').getByRole('button', { name: /interlinear/i }).click();
  await expect(page.locator('html')).toBeVisible();
  const v1 = page.locator('#v1');
  await expect(v1).toContainText('λόγος');
  await expect(v1).toContainText('ἀρχῇ');
  await expect(v1).toContainText('logos');
  // the mode is remembered
  await page.reload();
  await expect(page.locator('#v1')).toContainText('λόγος');
});

test('interlinear: a verse link scrolls to the verse and the contents rail follows', async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem('rootword:mode', 'interlinear'));
  await openReader(page, '#/KJV/JHN/1/40');
  // interlinear verses are display: contents: measure their first cell
  await expect.poll(() => page.evaluate(() => {
    const cell = document.querySelector('#v40 [data-u]')!.getBoundingClientRect();
    return cell.top > 0 && cell.bottom < window.innerHeight;
  })).toBe(true);
  await expect(page.locator('.rail--left .toc a[aria-current="true"]')).toContainText('The First Disciples');
});

test('red letter: words of Jesus are red in Matthew 5 and the setting turns it off', async ({ page }) => {
  await openReader(page, '#/KJV/MAT/5');
  const wj = page.locator('#v3 .wj').first();
  await expect(wj).toBeVisible();
  const plain = await page.locator('#v1 [data-u]').first().evaluate((el) => getComputedStyle(el).color);
  const red = await wj.evaluate((el) => getComputedStyle(el).color);
  expect(red).not.toBe(plain);
  const [r, g, b] = red.match(/\d+/g)!.map(Number);
  expect(r, `red-letter colour ${red} is reddish`).toBeGreaterThan(g + 40);
  expect(r).toBeGreaterThan(b + 30);
  // verse 1–2 are narration, not red
  await expect(page.locator('#v1 .wj')).toHaveCount(0);

  // toggle off in Settings → Reading
  await page.locator('.aa-btn').click();
  await page.getByRole('button', { name: /all settings/i }).click();
  const sheet = page.locator('.st-sheet');
  await expect(sheet).toBeVisible();
  const sw = sheet.getByRole('switch', { name: 'Words of Jesus in red' });
  await expect(sw).toBeChecked();
  await sheet.getByText('Words of Jesus in red', { exact: true }).click();
  await expect(sw).not.toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-red-letter', 'off');
  // (colour transitions for a moment)
  await expect.poll(() => wj.evaluate((el) => getComputedStyle(el).color)).toBe(plain);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-red-letter', 'off');
});

test('the OT word card shows the Hebrew and its Septuagint Greek', async ({ page }) => {
  await openReader(page, '#/KJV/GEN/1');
  const god = await unitIn(page, 1, 'God');
  await page.hover(god);
  const card = page.locator('#word-card');
  await expect(card.locator('#word-card-head')).toHaveText(/אֱלֹהִים/);
  await expect(card.locator('.card__strongs').first()).toContainText('H430');
  await expect(card.locator('.lxx-word')).toContainText(/θε[όὸ]ς/);
});
