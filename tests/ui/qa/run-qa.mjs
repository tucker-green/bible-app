/**
 * Rootword QA matrix (docs/EXPERIENCE.md §7) — Playwright + axe-core, run against a server you start:
 *
 *   npx vite --port 4317 --strictPort &            (or: npm run build && npx vite preview --port 4317)
 *   node tests/ui/qa/run-qa.mjs --url http://127.0.0.1:4317/ [--shots DIR] [--save-key design/screenshots]
 *                                [--only iphone15,desktop] [--no-axe]
 *
 * For every viewport of the matrix, in light and dark (touch emulation on phones / tablets):
 *   - no horizontal overflow (scrollWidth ≤ innerWidth), header / dock never overlap, the dock never
 *     covers the end of the chapter;
 *   - touch: tap a word → the bottom sheet opens and the tapped word stays visible above it;
 *     press-and-slide scrubbing (CDP touch events) engages, shows the loupe and updates the card;
 *     a verse number opens the verse sheet; a horizontal swipe changes chapter (and back);
 *   - mouse: hover opens the card, click pins it, Esc closes; verse number → verse panel;
 *   - keyboard: Tab into the text, ↓ to a verse number, Enter → verse sheet, Esc returns focus;
 *   - chapter change through the header (View Transition) keeps navigation working;
 *   - axe (WCAG 2.x A/AA) on the reader, the word sheet / card and the verse sheet (selected sizes);
 * plus reduced motion, forced colours, high contrast and 200% text at 320 px, and Psalm 119 render /
 * scroll timings. Exit code 1 when any check fails.
 */
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const BASE = String(args.url || 'http://127.0.0.1:4317/').replace(/\/?$/, '/');
const SHOTS = String(args.shots || 'test-results/qa');
const SAVE_KEY = args['save-key'] ? String(args['save-key']) : null;
const ONLY = args.only ? String(args.only).split(',') : null;
const AXE = !args['no-axe'];
mkdirSync(SHOTS, { recursive: true });

/** [name, width, height, touch] — docs/EXPERIENCE.md §7 */
const VIEWPORTS = [
  ['fold', 280, 653, true],
  ['se1', 320, 568, true],
  ['se3', 375, 667, true],
  ['iphone15', 393, 852, true],
  ['promax', 430, 932, true],
  ['pixel7', 412, 915, true],
  ['landscape', 852, 393, true],
  ['ipadmini', 744, 1133, true],
  ['ipadair', 820, 1180, true],
  ['ipadpro-l', 1366, 1024, true],
  ['laptop', 1280, 800, false],
  ['desktop', 1440, 900, false],
  ['fhd', 1920, 1080, false],
  ['qhd', 2560, 1440, false],
].filter(([n]) => !ONLY || ONLY.includes(n));
const AXE_ON = new Set(['iphone15', 'ipadair', 'desktop', 'landscape']);
const KEY_SHOTS = new Set(['fold', 'iphone15', 'landscape', 'ipadair', 'desktop', 'fhd']);

const results = [];
let failures = 0;
function check(ok, what, detail = '') {
  results.push({ ok, what, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what}${detail ? ` — ${detail}` : ''}`);
}

const executablePath = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath }).catch(() =>
  chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }),
);

async function open(vp, theme, extra = {}) {
  const [, w, h, touch] = vp;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    colorScheme: theme,
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 1,
    ...extra.ctx,
  });
  if (extra.init) await ctx.addInitScript(extra.init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${BASE}${extra.hash ?? '#/KJV/JHN/1'}`);
  // one reload if the first load stalls (a busy machine, a cold data fetch)
  await page.waitForSelector('.prose [data-u]', { timeout: 30000 }).catch(async () => {
    await page.reload();
    await page.waitForSelector('.prose [data-u]', { timeout: 45000 });
  });
  await page.waitForTimeout(350);
  return { ctx, page, errors };
}

async function axe(page, label) {
  if (!AXE) return;
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const v = r.violations;
  check(v.length === 0, `axe ${label}`, v.map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target?.join(' ')}`).join('; '));
}

async function geometry(page) {
  return page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || b.height === 0) return null;
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    };
    return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, header: r('.masthead'), dock: r('.toolbar') };
  });
}

/** A word unit near `frac` of the viewport height, fully visible (scrolls down a little if none is). */
async function pickUnit(page, frac) {
  for (let i = 0; i < 4; i++) {
    const u = await pickUnitHere(page, frac);
    if (u !== null) return u;
    await page.evaluate(() => window.scrollBy(0, innerHeight * 0.4));
    await page.waitForTimeout(250);
  }
  throw new Error('no word unit on screen');
}
async function pickUnitHere(page, frac) {
  return page.evaluate((frac) => {
    const target = innerHeight * frac;
    let best = null;
    let dist = Infinity;
    for (const el of document.querySelectorAll('.prose [data-u]')) {
      const b = el.getBoundingClientRect();
      if (b.top < 80 || b.bottom > innerHeight - 90 || b.width < 12 || b.width > 160) continue;
      const d = Math.abs(b.top - target);
      if (d < dist) {
        dist = d;
        best = el.dataset.u;
      }
    }
    return best;
  }, frac);
}

async function rectOf(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, sel);
}

async function touchApi(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const send = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 3, radiusY: 3, force: 1 }] : [] });
  return {
    async longPressSlide(a, b, steps = 10) {
      await send('touchStart', a);
      await page.waitForTimeout(420);
      const engaged = await page.evaluate(() => document.documentElement.classList.contains('is-scrubbing') && !!document.querySelector('.loupe'));
      const seen = new Set();
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
        await page.waitForTimeout(45);
        seen.add(await page.evaluate(() => document.querySelector('.card__en')?.textContent ?? ''));
      }
      await send('touchEnd');
      await page.waitForTimeout(450);
      return { engaged, seen: [...seen].filter(Boolean) };
    },
    async swipe(x0, x1, y) {
      await send('touchStart', { x: x0, y });
      for (let i = 1; i <= 8; i++) {
        await send('touchMove', { x: x0 + ((x1 - x0) * i) / 8, y: y + i });
        await page.waitForTimeout(16);
      }
      await send('touchEnd');
      await page.waitForTimeout(900);
    },
  };
}

/** Interactive elements under `root` smaller than 44×44 (inline text links and words excluded). */
async function smallTargets(page, root) {
  return page.evaluate((root) => {
    const out = [];
    const scope = document.querySelector(root);
    if (!scope) return out;
    for (const el of scope.querySelectorAll('a[href], button, [role="button"], input, summary, select')) {
      if (el.closest('.prose') || el.closest('.card__def, .colophon p, .about p, .doc p')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // native inputs inside a larger label count by their label
      const box = el.matches('input') && el.closest('label') ? el.closest('label').getBoundingClientRect() : r;
      if (box.width < 43.5 || box.height < 43.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(box.width)}×${Math.round(box.height)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}"`);
    }
    return out;
  }, root);
}

async function shot(page, name) {
  const file = join(SHOTS, `m-${name}.png`);
  await page.screenshot({ path: file });
  if (SAVE_KEY) copyFileSync(file, join(SAVE_KEY, `m-${name}.png`));
}

for (const vp of VIEWPORTS) {
  const [name, w, h, touch] = vp;
  const phone = w < 600 || (touch && h <= 500);
  for (const theme of ['light', 'dark']) {
    console.log(`\n== ${name} ${w}×${h} ${theme}${touch ? ' touch' : ''}`);
    const { ctx, page, errors } = await open(vp, theme);
    const tag = `${name}/${theme}`;
    // layout
    let g = await geometry(page);
    check(g.sw <= g.iw, `${tag} no horizontal overflow`, `${g.sw} > ${g.iw}`);
    if (g.header && g.dock) check(g.header.bottom <= g.dock.top, `${tag} header and toolbar do not overlap`);
    if (w < 600) check(Boolean(g.dock) && g.dock.bottom <= h + 0.5 && g.dock.top >= h - 120, `${tag} bottom toolbar present`);
    else check(!g.dock, `${tag} no bottom toolbar ≥ 600px`);
    if (touch && theme === 'light') {
      const small = [...(await smallTargets(page, '.masthead')), ...(await smallTargets(page, '.toolbar')), ...(await smallTargets(page, '.ch-head'))];
      check(small.length === 0, `${tag} header / toolbar targets ≥ 44px`, small.join('; '));
    }
    if (KEY_SHOTS.has(name)) await shot(page, `${name}-${theme}`);
    else await page.screenshot({ path: join(SHOTS, `m-${name}-${theme}.png`) });
    if (AXE_ON.has(name)) await axe(page, `${tag} reader`);

    // end of chapter is not hidden by the dock
    // content-visibility: the page grows as blocks are laid out, so scroll until it stops growing
    for (let i = 0; i < 12; i++) {
      const moved = await page.evaluate(() => {
        const y = window.scrollY;
        window.scrollTo(0, document.documentElement.scrollHeight);
        return window.scrollY !== y;
      });
      await page.waitForTimeout(120);
      if (!moved && i > 1) break;
    }
    await page.waitForTimeout(250);
    const end = await page.evaluate(() => {
      const c = document.querySelector('.colophon')?.getBoundingClientRect();
      const d = document.querySelector('.dock')?.getBoundingClientRect();
      return c && d ? { c: c.bottom, d: d.top } : null;
    });
    if (end) check(end.c <= end.d + 1, `${tag} dock never covers the end of the chapter`, `${end.c} > ${end.d}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);

    if (touch) {
      // tap → sheet, word stays visible
      const u = await pickUnit(page, 0.7);
      await page.tap(`[data-u="${u}"]`);
      await page.waitForTimeout(1100);
      const word = await rectOf(page, `[data-u="${u}"]`);
      const card = await rectOf(page, '#word-card');
      const head = await rectOf(page, '.masthead');
      const sheet = await page.evaluate(() => document.querySelector('#word-card')?.classList.contains('is-sheet'));
      check(Boolean(card) && sheet, `${tag} tap opens the bottom sheet`);
      if (card && word) {
        const side = card.left > word.right; // side-anchored sheet (landscape) cannot cover a word to its left
        check(side || word.bottom <= card.top + 1, `${tag} sheet does not cover the tapped word`, `word ${word.top.toFixed(0)}–${word.bottom.toFixed(0)}, sheet top ${card.top.toFixed(0)}`);
        check(word.top >= Math.max(0, head?.bottom ?? 0) - 1, `${tag} tapped word is below the header`);
      }
      if (name === 'iphone15' || name === 'landscape' || name === 'ipadair') await shot(page, `${name}-${theme}-word-sheet`);
      if (name === 'iphone15' && theme === 'light') {
        const small = await smallTargets(page, '#word-card');
        check(small.length === 0, `${tag} word sheet targets ≥ 44px`, small.join('; '));
      }
      if (AXE_ON.has(name)) await axe(page, `${tag} word sheet`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      check(!(await page.$('#word-card')), `${tag} Esc closes the sheet`);

      // scrubbing
      const t = await touchApi(ctx, page);
      const ua = await pickUnit(page, 0.35);
      const a = await rectOf(page, `[data-u="${ua}"]`);
      const b = await page.evaluate((ua) => {
        // a word two lines further down
        const start = document.querySelector(`[data-u="${ua}"]`).getBoundingClientRect();
        for (const el of document.querySelectorAll('.prose [data-u]')) {
          const r = el.getBoundingClientRect();
          if (r.top > start.bottom + 30 && r.top < start.bottom + 120) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return { x: start.left + 120, y: start.top + start.height / 2 };
      }, ua);
      const sc = await t.longPressSlide(a, b);
      check(sc.engaged, `${tag} long-press engages scrubbing (loupe)`);
      check(sc.seen.length >= 2, `${tag} scrubbing updates the card live`, sc.seen.join(' | '));
      const after = await page.evaluate(() => ({ scrub: document.documentElement.classList.contains('is-scrubbing'), card: !!document.querySelector('#word-card') }));
      check(!after.scrub && after.card, `${tag} lifting keeps the last word selected`);
      if (name === 'iphone15' && theme === 'light') {
        // a scrub screenshot mid-gesture
        const cdp = await ctx.newCDPSession(page);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 2 }] });
        await page.waitForTimeout(420);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x, y: b.y, id: 2 }] });
        await page.waitForTimeout(120);
        await shot(page, `${name}-${theme}-scrub`);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(300);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);

      // verse sheet
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await page.tap('[data-vn="3"]');
      await page.waitForTimeout(800);
      const vs = await rectOf(page, '.verse-sheet');
      check(Boolean(vs), `${tag} verse number opens the verse sheet`);
      const v3 = await rectOf(page, '#v3 [data-vn]');
      if (vs && v3) check(v3.bottom <= vs.top + 1 || vs.left > v3.right, `${tag} verse sheet keeps the verse visible`);
      if (name === 'iphone15' || name === 'ipadair') await shot(page, `${name}-${theme}-verse-sheet`);
      if (name === 'iphone15' && theme === 'light') {
        await page.click('.vs-study summary');
        await page.waitForTimeout(200);
        const small = await smallTargets(page, '.verse-sheet');
        check(small.length === 0, `${tag} verse sheet targets ≥ 44px`, small.join('; '));
      }
      if (AXE_ON.has(name)) await axe(page, `${tag} verse sheet`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      check(!(await page.$('.verse-sheet')), `${tag} Esc closes the verse sheet`);

      // swipe to change chapter (phones)
      if (phone) {
        const before = await page.evaluate(() => location.hash);
        await t.swipe(w * 0.8, w * 0.15, h * 0.55);
        const next = await page.evaluate(() => location.hash);
        check(/JHN\/2$/.test(next), `${tag} swipe left → next chapter`, `${before} → ${next}`);
        await t.swipe(w * 0.2, w * 0.85, h * 0.55);
        const back = await page.evaluate(() => location.hash);
        check(/JHN\/1$/.test(back), `${tag} swipe right → previous chapter`, back);
        await t.swipe(w * 0.5, w * 0.5 - 40, h * 0.55);
        check((await page.evaluate(() => location.hash)) === back, `${tag} a short swipe does nothing`);
      }
      if (name === 'iphone15') {
        await page.tap('.toolbar .tb-btn:last-child');
        await page.waitForTimeout(500);
        await shot(page, `${name}-${theme}-aa`);
        if (theme === 'light') {
          const small = await smallTargets(page, '.pop');
          check(small.length === 0, `${tag} Aa panel targets ≥ 44px`, small.join('; '));
        }
        if (theme === 'light') await axe(page, `${tag} Aa panel`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } else {
      // mouse: hover → tooltip card, click → dialog, Esc closes
      const u = await pickUnit(page, 0.45);
      await page.hover(`[data-u="${u}"]`);
      await page.waitForTimeout(450);
      check((await page.getAttribute('#word-card', 'role').catch(() => null)) === 'tooltip', `${tag} hover opens the card`);
      await page.click(`[data-u="${u}"]`);
      await page.waitForTimeout(500);
      check((await page.getAttribute('#word-card', 'role').catch(() => null)) === 'dialog', `${tag} click pins the card`);
      if (name === 'desktop') await shot(page, `${name}-${theme}-word-card`);
      if (AXE_ON.has(name)) await axe(page, `${tag} pinned card`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.click('[data-vn="4"]');
      await page.waitForTimeout(600);
      check(Boolean(await page.$('.verse-sheet.is-panel')), `${tag} verse number opens the verse panel`);
      if (name === 'desktop') await shot(page, `${name}-${theme}-verse-panel`);
      if (AXE_ON.has(name)) await axe(page, `${tag} verse panel`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      // keyboard: Tab into the text, ↓ to a verse number, Enter, Esc returns focus
      await page.evaluate(() => {
        document.querySelector('.prose [tabindex="0"]')?.focus();
      });
      await page.keyboard.press('ArrowDown');
      const onVn = await page.evaluate(() => document.activeElement?.getAttribute('data-vn'));
      check(Boolean(onVn), `${tag} ↓ moves focus to a verse number`, String(onVn));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      check(Boolean(await page.$('.verse-sheet')), `${tag} Enter on a verse number opens the verse sheet`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const back = await page.evaluate(() => document.activeElement?.getAttribute('data-vn'));
      check(back === onVn, `${tag} Esc returns focus to the verse number`, String(back));
    }

    // chapter change through the header (View Transitions where supported)
    if (!phone) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const btn = page.locator('.locator__step').last();
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForFunction(() => /JHN\/2$/.test(location.hash) && document.getElementById('chapter-title')?.textContent?.includes('2'), null, { timeout: 5000 }).then(
          () => check(true, `${tag} next chapter via header (View Transition)`),
          () => check(false, `${tag} next chapter via header (View Transition)`),
        );
        await page.waitForTimeout(500);
        check(await page.evaluate(() => !document.documentElement.dataset.vt), `${tag} view transition finished`);
      }
    }
    check(errors.length === 0, `${tag} no console errors`, errors.join(' | '));
    await ctx.close();
  }
}

/* ---- special modes --------------------------------------------------------------------- */
async function mode(label, vp, theme, extra, fn) {
  console.log(`\n== ${label}`);
  const { ctx, page, errors } = await open(vp, theme, extra);
  await fn(page);
  check(errors.length === 0, `${label} no console errors`, errors.join(' | '));
  await ctx.close();
}
const PHONE = ['iphone15', 393, 852, true];
const SE1 = ['se1', 320, 568, true];

if (!ONLY || ONLY.includes('modes')) {
  await mode('reduced motion', PHONE, 'light', { ctx: { reducedMotion: 'reduce' } }, async (page) => {
    check((await page.evaluate(() => document.documentElement.dataset.motion)) === 'reduce', 'reduced motion → html[data-motion=reduce]');
    const u = await pickUnit(page, 0.4);
    await page.tap(`[data-u="${u}"]`);
    await page.waitForTimeout(120);
    const t = await page.evaluate(() => document.querySelector('#word-card')?.style.transform ?? '');
    check(/translate3d\(0(px)?, \d/.test(t), 'reduced motion: the sheet jumps to its detent (no spring)', t);
  });
  await mode('forced colors', ['desktop', 1440, 900, false], 'light', { ctx: { forcedColors: 'active' } }, async (page) => {
    const u = await pickUnit(page, 0.45);
    await page.click(`[data-u="${u}"]`);
    await page.waitForTimeout(500);
    await shot(page, 'desktop-forced-colors');
    await axe(page, 'forced colors card');
  });
  await mode('high contrast (setting)', PHONE, 'dark', { init: () => localStorage.setItem('rootword:settings', JSON.stringify({ highContrast: true })) }, async (page) => {
    check((await page.evaluate(() => document.documentElement.dataset.contrast)) === 'more', 'high contrast → html[data-contrast=more]');
    const u = await pickUnit(page, 0.35);
    await page.tap(`[data-u="${u}"]`);
    await page.waitForTimeout(900);
    await shot(page, 'iphone15-dark-high-contrast');
    await axe(page, 'high contrast sheet');
  });
  await mode('prefers-contrast: more', PHONE, 'light', { ctx: { contrast: 'more' } }, async (page) => {
    check((await page.evaluate(() => document.documentElement.dataset.contrast)) === 'more', 'prefers-contrast: more → html[data-contrast=more]');
  });
  await mode('200% text at 320px', SE1, 'light', { init: () => localStorage.setItem('rootword:fontScale', '2') }, async (page) => {
    const g = await geometry(page);
    check(g.sw <= g.iw, '200% text: no horizontal overflow at 320px', `${g.sw} > ${g.iw}`);
    await shot(page, 'se1-light-text-200');
    await page.tap('.toolbar .tb-btn:nth-child(4)');
    await page.waitForTimeout(700);
    const g2 = await geometry(page);
    check(g2.sw <= g2.iw, '200% text interlinear: no horizontal overflow at 320px', `${g2.sw} > ${g2.iw}`);
  });
  await mode('red letter fixture', ['desktop', 1440, 900, false], 'light', { hash: '#/KJV/JHN/3' }, async (page) => {
    // Red-letter data may not be generated yet: check the CSS hook with a synthetic span.
    const c = await page.evaluate(() => {
      const s = document.createElement('span');
      s.className = 'wj';
      s.textContent = 'test';
      document.querySelector('.prose')?.appendChild(s);
      const col = getComputedStyle(s).color;
      s.remove();
      return col;
    });
    check(c !== 'rgb(23, 28, 38)', 'red letter colours .wj text when settings.redLetter', c);
  });
  /* Psalm 119: render time and scroll smoothness */
  for (const vp of [['desktop', 1440, 900, false], PHONE]) {
    await mode(`Psalm 119 ${vp[0]}`, vp, 'light', { hash: '#/KJV/PSA/119' }, async (page) => {
      const stats = await page.evaluate(() => window.__rootwordRender);
      console.log(`     render: ${JSON.stringify(stats)}`);
      check(stats && stats.totalMs < 120, `Ps 119 renders fast (${stats?.totalMs} ms)`);
      const frames = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const out = [];
            let last = performance.now();
            const end = last + 2500;
            const step = (now) => {
              out.push(now - last);
              last = now;
              window.scrollBy(0, 40);
              if (now < end) requestAnimationFrame(step);
              else resolve(out);
            };
            requestAnimationFrame(step);
          }),
      );
      frames.sort((a, b) => a - b);
      const p = (q) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))].toFixed(1);
      console.log(`     scroll frames: n=${frames.length} median=${p(0.5)}ms p95=${p(0.95)}ms max=${p(1)}ms`);
      check(Number(p(0.95)) < 34, `Ps 119 scroll p95 frame < 34ms (${p(0.95)} ms)`);
      // verse targeting deep in the chapter still works with content-visibility
      await page.evaluate(() => (location.hash = '#/KJV/PSA/119/105'));
      await page.waitForTimeout(900);
      const v = await rectOf(page, '#v105');
      check(v && v.top > 0 && v.top < (await page.evaluate(() => innerHeight)), 'Ps 119:105 is scrolled into view');
    });
  }
}

await browser.close();
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
