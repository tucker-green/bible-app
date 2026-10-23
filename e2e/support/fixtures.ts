/**
 * Shared e2e fixtures and helpers.
 *
 * Every test using `test` from here fails if the page logged a console error or threw an uncaught
 * exception (the "no console errors anywhere" gate). Tests that provoke errors on purpose (offline)
 * call `allowErrors(re)` first.
 */
import { test as base, expect } from '@playwright/test';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export { expect };

interface Fixtures {
  /** Console errors / page errors collected so far (asserted empty after the test). */
  consoleErrors: string[];
  /** Ignore console errors matching `re` for the rest of this test. */
  allowErrors: (re: RegExp) => void;
}

export const test = base.extend<Fixtures>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const allowed: RegExp[] = [];
      (page as Page & { __allowed?: RegExp[] }).__allowed = allowed;
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (allowed.some((re) => re.test(text))) return;
        errors.push(`console.error: ${text}`);
      });
      await use(errors);
      expect(errors, 'no console errors or uncaught exceptions').toEqual([]);
    },
    { auto: true },
  ],
  allowErrors: async ({ page }, use) => {
    await use((re: RegExp) => {
      (page as Page & { __allowed?: RegExp[] }).__allowed?.push(re);
    });
  },
});

/** Open a chapter (hash like "#/KJV/JHN/1") and wait until its words are rendered. */
export async function openReader(page: Page, hash = '#/KJV/JHN/1'): Promise<void> {
  await page.goto(hash);
  await page.locator('.prose [data-u]').first().waitFor({ timeout: 30_000 });
}

/** Open a full page route (word study, person, lineage, compare, study, about) and wait for its h1. */
export async function openPage(page: Page, hash: string): Promise<void> {
  await page.goto(hash);
  await page.locator('main h1').first().waitFor({ timeout: 30_000 });
}

/**
 * The reader word unit (`[data-u]`) in verse `verse` whose text is `text` or ends with it
 * ("Word" finds the KJV unit "the Word"). `nth` picks among several matches in the verse.
 */
export async function unitIn(page: Page, verse: number, text: string, nth = 0, root = '.prose'): Promise<string> {
  const u = await page.evaluate(
    ({ verse, text, nth, root }) => {
      const scope = document.querySelector(root);
      const hits: string[] = [];
      for (const el of Array.from(scope?.querySelectorAll<HTMLElement>(`#v${verse} [data-u], [data-v="${verse}"] [data-u]`) ?? [])) {
        const t = (el.textContent ?? '').trim();
        if (t === text || t.split(/\s+/).pop() === text) hits.push(el.dataset.u!);
      }
      return [...new Set(hits)][nth] ?? null;
    },
    { verse, text, nth, root },
  );
  if (u === null) throw new Error(`no word "${text}" in verse ${verse}`);
  return `${root} [data-u="${u}"]`;
}

/** axe-core (WCAG 2.x A/AA + 2.2 AA); returns a readable list of violations (empty = pass). */
export async function axe(page: Page, opts: { include?: string; exclude?: string[] } = {}): Promise<string[]> {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  if (opts.include) b = b.include(opts.include);
  for (const x of opts.exclude ?? []) b = b.exclude(x);
  const r = await b.analyze();
  return r.violations.map(
    (v) => `${v.id} ×${v.nodes.length}: ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(' '))
      .join(' | ')} — ${v.nodes[0]?.failureSummary?.split('\n').slice(1, 2).join(' ').trim() ?? ''}`,
  );
}

/** Horizontal overflow of the page (0 = none). */
export async function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounding box of the first match in viewport coordinates, or null when absent / not rendered. */
export async function rect(page: Page, sel: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) return null;
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, x: b.left + b.width / 2, y: b.top + b.height / 2, width: b.width, height: b.height };
  }, sel);
}

/** Raw touch input through the DevTools protocol (Playwright has tap() but no touch move). */
export class Touch {
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async attach(ctx: BrowserContext, page: Page): Promise<Touch> {
    return new Touch(page, await ctx.newCDPSession(page));
  }

  private send(type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 3, radiusY: 3, force: 1 }] : [],
    });
  }

  async down(p: { x: number; y: number }) {
    await this.send('touchStart', p);
  }
  async move(p: { x: number; y: number }) {
    await this.send('touchMove', p);
  }
  async up() {
    await this.send('touchEnd');
  }

  /**
   * Long-press at `a` (scrub engage), slide to `b` in `steps`, lift. Returns the card's English
   * headwords seen along the way and whether scrubbing engaged (loupe shown).
   */
  async pressAndSlide(a: { x: number; y: number }, b: { x: number; y: number }, steps = 10): Promise<{ engaged: boolean; seen: string[] }> {
    await this.down(a);
    await this.page.waitForTimeout(450);
    const engaged = await this.page.evaluate(() => document.documentElement.classList.contains('is-scrubbing') && !!document.querySelector('.loupe'));
    const seen: string[] = [];
    for (let i = 1; i <= steps; i++) {
      await this.move({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
      await this.page.waitForTimeout(50);
      const en = await this.page.evaluate(() => document.querySelector('#word-card .card__en')?.textContent ?? '');
      if (en && seen[seen.length - 1] !== en) seen.push(en);
    }
    await this.up();
    await this.page.waitForTimeout(400);
    return { engaged, seen };
  }

  async swipe(x0: number, x1: number, y: number) {
    await this.down({ x: x0, y });
    for (let i = 1; i <= 8; i++) {
      await this.move({ x: x0 + ((x1 - x0) * i) / 8, y: y + i });
      await this.page.waitForTimeout(16);
    }
    await this.up();
  }
}

/** Clear all Rootword state (localStorage) before the page's own scripts run. */
export async function freshStorage(ctx: BrowserContext, extra: Record<string, string> = {}): Promise<void> {
  await ctx.addInitScript((extra) => {
    if (sessionStorage.getItem('__e2e_init')) return;
    sessionStorage.setItem('__e2e_init', '1');
    try {
      localStorage.clear();
      // the one-time scrub coach mark would sit over the sheet in every touch test
      localStorage.setItem('rootword:coach-scrub', '1');
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  }, extra);
}
