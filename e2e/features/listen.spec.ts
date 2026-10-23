/**
 * Listen mode (docs/EXPERIENCE.md §3): read the chapter aloud verse by verse, highlighting the
 * current verse; pause / stop; stops on navigation. Speech is replaced by a fake engine (each
 * utterance "speaks" for 900 ms) so the flow is deterministic and silent.
 */
import { test, expect, openReader, freshStorage } from '../support/fixtures';

test.beforeEach(async ({ context }) => {
  await freshStorage(context);
  await context.addInitScript(() => {
    type U = { text: string; lang: string; rate: number; voice: unknown; onstart?: () => void; onend?: () => void; onerror?: (e: { error: string }) => void };
    class FakeUtterance {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: unknown = null;
      constructor(text = '') {
        this.text = text;
      }
    }
    const voices = [{ name: 'Test English', lang: 'en-US', voiceURI: 'test-en', localService: true, default: true }];
    const queue: U[] = [];
    let current: U | null = null;
    let timer = 0;
    const next = () => {
      current = queue.shift() ?? null;
      if (!current) return;
      const u = current;
      u.onstart?.();
      timer = window.setTimeout(() => {
        if (current !== u) return;
        current = null;
        u.onend?.();
        next();
      }, 900);
    };
    const synth = Object.assign(new EventTarget(), {
      get speaking() {
        return Boolean(current);
      },
      get pending() {
        return queue.length > 0;
      },
      paused: false,
      getVoices: () => voices,
      speak(u: U) {
        queue.push(u);
        if (!current) next();
      },
      cancel() {
        window.clearTimeout(timer);
        const cur = current;
        current = null;
        queue.length = 0;
        cur?.onerror?.({ error: 'interrupted' });
      },
      pause() {},
      resume() {},
    });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true, writable: true });
  });
});

test('"Listen from here" reads verse by verse, highlighting each; pause and stop work', async ({ page }) => {
  await openReader(page, '#/KJV/JHN/1');
  await page.click('[data-vn="3"]');
  await page.locator('.verse-sheet').getByRole('button', { name: /listen from here/i }).click();
  const bar = page.getByRole('region', { name: 'Listen mode' }).or(page.locator('[aria-label="Listen mode"]')).first();
  await expect(bar).toBeVisible();
  await expect(page.locator('#v3')).toHaveClass(/is-listening/);
  // it moves on verse by verse (one highlighted verse at a time) and the bar follows
  const current = async () => {
    const ids = await page.locator('.verse.is-listening').evaluateAll((els) => els.map((e) => Number(e.id.slice(1))));
    return ids.length === 1 ? ids[0] : -1;
  };
  await expect.poll(current, { timeout: 5000 }).toBeGreaterThan(3);
  await expect(bar).toContainText('John');
  await expect(bar).toContainText(/Verse \d+ of 51/);

  // pause keeps the place; play carries on from it
  await bar.locator('.listen__play').click();
  await page.waitForTimeout(300);
  const pausedAt = await current();
  await page.waitForTimeout(900);
  expect(await current(), 'paused: the place is kept').toBe(pausedAt);
  await bar.locator('.listen__play').click();
  await expect.poll(current, { timeout: 5000 }).toBeGreaterThan(pausedAt);

  // stop
  await bar.getByRole('button', { name: 'Stop reading aloud' }).click();
  await expect(page.locator('.verse.is-listening')).toHaveCount(0);
});

test('listening stops when you go to another chapter', async ({ page }) => {
  await openReader(page, '#/KJV/JHN/1');
  await page.click('[data-vn="1"]');
  await page.locator('.verse-sheet').getByRole('button', { name: /listen from here/i }).click();
  await expect(page.locator('#v1')).toHaveClass(/is-listening/);
  await page.evaluate(() => (location.hash = '#/KJV/JHN/2'));
  await expect(page.locator('#chapter-title')).toContainText('2');
  await page.waitForTimeout(800);
  await expect(page.locator('.verse.is-listening')).toHaveCount(0);
});
