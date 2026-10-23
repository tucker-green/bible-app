/** Verse sheet: cross references, highlight, note, bookmark → My study. */
import { test, expect, openReader, openPage, freshStorage } from '../support/fixtures';

test.beforeEach(async ({ context }) => {
  await freshStorage(context);
});

test('a verse number opens the verse sheet with cross references (Gen 1:1 → John 1:1)', async ({ page }) => {
  await openReader(page, '#/KJV/GEN/1');
  await page.click('[data-vn="1"]');
  const sheet = page.locator('.verse-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('role', 'dialog');
  await expect(sheet.locator('#vs-title')).toHaveText('Genesis 1:1');
  await expect(sheet.locator('.vs-quote')).toContainText('In the beginning God created the heaven and the earth.');
  const xr = sheet.locator('.xr-sec');
  await expect(xr).toBeVisible();
  await expect(xr).toContainText('John 1:1');
  await expect(xr).toContainText(/In the beginning was the Word/);
  // every action is there
  for (const name of ['Copy', 'Share', 'Listen from here', 'Bookmark', 'Compare']) {
    await expect(sheet.locator('.vs-acts')).toContainText(name);
  }
  // following a cross reference goes there
  await xr.getByRole('link', { name: /John 1:1/ }).first().click();
  await expect(page).toHaveURL(/JHN\/1/);
});

test('highlight a verse: shown in the text, kept after a reload, listed in My study', async ({ page }) => {
  await openReader(page, '#/KJV/JHN/3');
  await page.click('[data-vn="16"]');
  const sheet = page.locator('.verse-sheet');
  await sheet.getByRole('button', { name: 'Yellow' }).click();
  await expect(sheet.getByRole('button', { name: 'Yellow' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#v16')).toHaveAttribute('data-hl', 'yellow');
  await expect(page.locator('#v16 [data-vn]')).toHaveAttribute('aria-label', /highlighted yellow/);

  await page.reload();
  await page.locator('.prose [data-u]').first().waitFor();
  await expect(page.locator('#v16')).toHaveAttribute('data-hl', 'yellow');

  await openPage(page, '#/study');
  await expect(page.getByRole('tab', { name: /Highlights/ })).toContainText('1');
  await expect(page.locator('.ms-panel')).toContainText('John 3:16');
  await expect(page.locator('.ms-panel')).toContainText('For God so loved the world');
});

test('add a note and a bookmark; both appear on #/study', async ({ page }) => {
  await openReader(page, '#/KJV/ROM/8');
  await page.click('[data-vn="28"]');
  const sheet = page.locator('.verse-sheet');
  const note = sheet.getByRole('textbox');
  await note.fill('All things work together — Rootword e2e note');
  await sheet.getByRole('button', { name: 'Bookmark' }).click();
  await expect(sheet.getByRole('button', { name: /Bookmark/ })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(800); // note saves as you type (debounced)
  await page.keyboard.press('Escape');
  await expect(page.locator('#v28 [data-vn]')).toHaveAttribute('aria-label', /bookmarked/);
  await expect(page.locator('#v28 [data-vn]')).toHaveAttribute('aria-label', /note/);

  await openPage(page, '#/study');
  await page.getByRole('tab', { name: /Notes/ }).click();
  await expect(page.locator('.ms-panel')).toContainText('Romans 8:28');
  await expect(page.locator('.ms-panel')).toContainText('Rootword e2e note');
  await page.getByRole('tab', { name: /Bookmarks/ }).click();
  await expect(page.locator('.ms-panel')).toContainText('Romans 8:28');
  // reload keeps them
  await page.reload();
  await page.locator('main h1').waitFor();
  await expect(page.getByRole('tab', { name: /Notes/ })).toContainText('1');
  await expect(page.getByRole('tab', { name: /Bookmarks/ })).toContainText('1');
});

test('"Study this verse" lists every word with its original (screen-reader word study)', async ({ page }) => {
  await openReader(page, '#/KJV/JHN/1');
  await page.click('[data-vn="1"]');
  const study = page.locator('.verse-sheet .vs-study');
  await study.locator('summary').click();
  await expect(study.locator('.vs-words')).toContainText('λόγος');
  await expect(study.getByRole('link', { name: 'Word study G3056' }).first()).toBeVisible();
});
