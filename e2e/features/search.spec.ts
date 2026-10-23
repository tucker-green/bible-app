/** Search: words, references, Strong's numbers, names. */
import { test, expect, openReader, freshStorage } from '../support/fixtures';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await freshStorage(context);
  await openReader(page);
});

async function search(page: Page, q: string) {
  const input = page.locator('#search-input');
  await input.click();
  await input.fill(q);
  const panel = page.locator('#search-panel');
  await expect(panel).toBeVisible();
  return panel;
}

test('"love" finds verses in the KJV, grouped by book, with the word marked', async ({ page }) => {
  const panel = await search(page, 'love');
  await expect(panel.locator('h2').first()).toContainText(/\d+ verses for “love”/);
  await expect(panel).toContainText('Genesis 27:4');
  await expect(panel.locator('mark').first()).toHaveText(/love/i);
  // OT / NT filter
  await panel.getByRole('radio', { name: /^NT/ }).or(panel.getByRole('button', { name: /^NT/ })).first().click();
  await expect(panel).not.toContainText('Genesis 27:4');
  await expect(panel).toContainText('Matthew');
});

test('"Rom 8:28" offers the verse first and Enter goes there', async ({ page }) => {
  const panel = await search(page, 'Rom 8:28');
  await expect(panel).toContainText('Go to Romans 8:28');
  await expect(panel).toContainText('all things work together for good');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/KJV\/ROM\/8\/28$/);
  await expect(page.locator('#search-panel')).toBeHidden();
  await expect(page.locator('#v28')).toBeInViewport();
});

test('"G26" searches by Strong\'s number: ἀγάπη with its renderings', async ({ page }) => {
  const panel = await search(page, 'G26');
  await expect(panel.locator('h2').first()).toContainText(/\d+ verses for “G26”/);
  await expect(panel).toContainText('ἀγάπη');
  await expect(panel).toContainText('charity');
  await expect(panel).toContainText('1 Corinthians 13');
  await expect(panel.getByRole('link', { name: /open word study/i })).toHaveAttribute('href', /^#\/word\/G0*26$/);
});

test('"Abraham" finds the verses and the person', async ({ page }) => {
  const panel = await search(page, 'Abraham');
  await expect(panel.locator('h2').first()).toContainText(/\d+ verses for “Abraham”/);
  await expect(panel).toContainText('Genesis 17:5');
  const person = panel.locator('.sp-group--ents [role="option"]', { hasText: 'Abraham' }).first();
  await expect(person).toBeVisible();
  await person.click();
  await expect(page).toHaveURL(/#\/person\/p0057$/);
});

test('"/" focuses search from anywhere; Esc closes it', async ({ page }) => {
  await page.keyboard.press('/');
  await expect(page.locator('#search-input')).toBeFocused();
  await page.keyboard.type('light');
  await expect(page.locator('#search-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-panel')).toBeHidden();
});
