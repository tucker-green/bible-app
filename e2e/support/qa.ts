/** QA-matrix helpers (docs/EXPERIENCE.md §7): viewports, overlap and keyboard checks. */
import type { Page } from '@playwright/test';

export interface Viewport {
  name: string;
  width: number;
  height: number;
  touch: boolean;
}

/** docs/EXPERIENCE.md §7 — touch emulation on phones and tablets. */
export const VIEWPORTS: Viewport[] = [
  { name: 'fold', width: 280, height: 653, touch: true },
  { name: 'se1', width: 320, height: 568, touch: true },
  { name: 'se3', width: 375, height: 667, touch: true },
  { name: 'iphone15', width: 393, height: 852, touch: true },
  { name: 'promax', width: 430, height: 932, touch: true },
  { name: 'pixel7', width: 412, height: 915, touch: true },
  { name: 'landscape', width: 852, height: 393, touch: true },
  { name: 'ipadmini', width: 744, height: 1133, touch: true },
  { name: 'ipadair', width: 820, height: 1180, touch: true },
  { name: 'ipadpro-l', width: 1366, height: 1024, touch: true },
  { name: 'laptop', width: 1280, height: 800, touch: false },
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'fhd', width: 1920, height: 1080, touch: false },
  { name: 'qhd', width: 2560, height: 1440, touch: false },
];

/** Layers that are meant to sit over the page chrome (dialogs, sheets, the search panel, popovers, toasts). */
export const OVERLAY = '[role="dialog"], [role="tooltip"], #search-panel, .pop, .toast-region, .toast, .loupe';

/**
 * Visible fixed / sticky layers that overlap wrongly (outermost layers only; scrims, the off-screen
 * skip link and layers nested in another are ignored):
 *  - two pieces of page chrome (header, dock, rails, banners) must never overlap;
 *  - an overlay (dialog, sheet, search panel, popover, toast) may cover the chrome, but the chrome
 *    must never paint over it (checked with elementFromPoint in the shared area).
 * Returns "a × b" descriptions.
 */
export async function fixedOverlaps(page: Page, ignore: string[] = []): Promise<string[]> {
  return page.evaluate(
    ({ ignore, OVERLAY }) => {
      const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.getAttribute('class') ?? '').split(' ')[0]}`;
      const layers: { el: Element; r: DOMRect; overlay: boolean }[] = [];
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
        if (el.matches('[class*="scrim"], .skip-link, .sr-only') || ignore.some((s) => el.matches(s))) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
        // a sticky element is a layer only while stuck; in its normal place it is just content
        // scrolling under the chrome like any other
        if (cs.position === 'sticky') {
          const stuckTop = cs.top.endsWith('px') && Math.abs(r.top - parseFloat(cs.top)) < 1.5;
          const stuckBottom = cs.bottom.endsWith('px') && Math.abs(innerHeight - r.bottom - parseFloat(cs.bottom)) < 1.5;
          if (!stuckTop && !stuckBottom) continue;
        }
        // an empty live region / container with nothing painted
        if (!el.children.length && !(el.textContent ?? '').trim() && cs.backgroundColor === 'rgba(0, 0, 0, 0)') continue;
        layers.push({ el, r, overlay: el.matches(OVERLAY) || el.closest(OVERLAY) !== null });
      }
      const outer = layers.filter((a) => !layers.some((b) => b !== a && b.el.contains(a.el)));
      const out: string[] = [];
      for (let i = 0; i < outer.length; i++) {
        for (let j = i + 1; j < outer.length; j++) {
          const A = outer[i];
          const B = outer[j];
          const left = Math.max(A.r.left, B.r.left);
          const right = Math.min(A.r.right, B.r.right);
          const top = Math.max(A.r.top, B.r.top);
          const bottom = Math.min(A.r.bottom, B.r.bottom);
          if (right - left <= 1 || bottom - top <= 1) continue;
          const tag = `${name(A.el)} × ${name(B.el)} (${Math.round(right - left)}×${Math.round(bottom - top)})`;
          if (!A.overlay && !B.overlay) {
            out.push(tag);
            continue;
          }
          if (A.overlay && B.overlay) continue;
          // overlay vs chrome: the overlay must be the one painted on top (sample a few points)
          const overlay = A.overlay ? A.el : B.el;
          const chrome = A.overlay ? B.el : A.el;
          const pts = [
            [(left + right) / 2, (top + bottom) / 2],
            [left + 2, top + 2],
            [right - 2, bottom - 2],
          ];
          for (const [x, y] of pts) {
            if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
            const hit = document.elementFromPoint(x, y);
            if (hit && chrome.contains(hit) && !overlay.contains(hit)) {
              out.push(`${tag}: ${name(chrome)} paints over ${name(overlay)}`);
              break;
            }
          }
        }
      }
      return out;
    },
    { ignore, OVERLAY },
  );
}

/** Interactive elements in `root` smaller than `min`×`min` px (inline text links excluded). */
export async function smallTargets(page: Page, root: string, min = 44): Promise<string[]> {
  return page.evaluate(
    ({ root, min }) => {
      const out: string[] = [];
      for (const scope of Array.from(document.querySelectorAll(root))) {
        for (const el of Array.from(scope.querySelectorAll<HTMLElement>('a[href], button, [role="button"], input, summary, select, [role="tab"], [role="switch"]'))) {
          if (el.closest('.prose, p, li > p, dd, .card__def, .card__src, .sr-only')) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          // a visually hidden native input counts by its label
          const box = el.matches('input') && el.closest('label') ? el.closest('label')!.getBoundingClientRect() : r;
          // a hit area extended by an absolutely positioned ::before / ::after (inset: -Npx)
          let w = box.width;
          let h = box.height;
          for (const pseudo of ['::before', '::after']) {
            const ps = getComputedStyle(el, pseudo);
            if (ps.content === 'none' || ps.position !== 'absolute') continue;
            const n = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
            w = Math.max(w, box.width - n(ps.left) - n(ps.right));
            h = Math.max(h, box.height - n(ps.top) - n(ps.bottom));
          }
          if (w < min - 0.5 || h < min - 0.5)
            out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(w)}×${Math.round(h)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28)}"`);
        }
      }
      return out;
    },
    { root, min },
  );
}

export interface TabStop {
  desc: string;
  visible: boolean;
}

/**
 * Press Tab up to `max` times from the top of the page and record each focused element and whether
 * it was visible (rendered, not visibility:hidden, inside the viewport after the browser scrolled it).
 */
export async function tabWalk(page: Page, max = 160): Promise<TabStop[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
  });
  const stops: TabStop[] = [];
  let first: string | null = null;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const measure = () => page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const hidden = cs.visibility === 'hidden' || (!r.width && !r.height) || el.closest('[aria-hidden="true"], [inert]') !== null;
      const inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      const key = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).split(' ')[0]} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}"`;
      return { desc: key, visible: !hidden && inView };
    });
    let s = await measure();
    // a skip link slides in (transition): measure again once it has arrived
    if (s && !s.visible) {
      await page.waitForTimeout(250);
      s = await measure();
    }
    if (!s) continue;
    if (first === null) first = s.desc;
    else if (s.desc === first) break; // wrapped around
    stops.push(s);
  }
  return stops;
}

/** Personal study data to seed (localStorage rootword:study) so My study and the reader have something to show. */
export const STUDY_SEED = JSON.stringify({
  version: 1,
  highlights: { 'JHN.3.16': 'yellow', 'ROM.8.28': 'green', 'PSA.23.1': 'blue' },
  notes: { 'JHN.3.16': { text: 'The heart of the gospel.', created: '2026-10-01T09:00:00.000Z', updated: '2026-10-01T09:00:00.000Z' } },
  bookmarks: { 'GEN.1.1': { tr: 'KJV', created: '2026-10-02T09:00:00.000Z' } },
});

/** Open the settings sheet through the visible Aa control (header on wide screens, toolbar on phones). */
export async function openSettingsSheet(page: Page): Promise<void> {
  await page.locator('.aa-btn:visible, .toolbar .tb-btn[aria-label^="Aa"]:visible').first().click();
  await page.getByRole('button', { name: /all settings/i }).click();
  await page.locator('.st-sheet').waitFor();
  await page.waitForTimeout(500);
}

