// Screenshot + smoke-test harness for the "illuminated" concept.
//   python3 -m http.server 8765 --directory <repo root> &   (serve the repo root)
//   BASE=http://localhost:8765 node design/concepts/illuminated/shoot.mjs
// Writes PNGs to design/concepts/illuminated/shots/ and fails on console errors or broken interactions.
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'shots');
mkdirSync(out, { recursive: true });
const BASE = (process.env.BASE || 'http://localhost:8765') + '/design/concepts/illuminated/';
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const shots = [
  ['desktop-default', '', DESKTOP],
  ['desktop-hover', '?demo=hover', DESKTOP],
  ['desktop-hover-ot', '?demo=hover-ot', DESKTOP],
  ['desktop-interlinear', '?demo=interlinear', DESKTOP],
  ['desktop-interlinear-ot', '?demo=interlinear,hover-ot', DESKTOP],
  ['desktop-search', '?demo=search', DESKTOP],
  ['desktop-books', '?demo=books', DESKTOP],
  ['desktop-niv', '?demo=niv', DESKTOP],
  ['desktop-dark-default', '?theme=dark', DESKTOP],
  ['desktop-dark-hover', '?theme=dark&demo=hover', DESKTOP],
  ['desktop-dark-hover-ot', '?theme=dark&demo=hover-ot', DESKTOP],
  ['desktop-dark-interlinear', '?theme=dark&demo=interlinear', DESKTOP],
  ['desktop-dark-search', '?theme=dark&demo=search', DESKTOP],
  ['tablet-hover', '?demo=hover', { width: 900, height: 1000 }],
  ['mobile-default', '', MOBILE],
  ['mobile-hover', '?demo=hover', MOBILE],
  ['mobile-hover-ot', '?demo=hover-ot', MOBILE],
  ['mobile-interlinear', '?demo=interlinear', MOBILE],
  ['mobile-search', '?demo=search', MOBILE],
  ['mobile-dark-hover', '?theme=dark&demo=hover', MOBILE],
  ['mobile-dark-default', '?theme=dark', MOBILE],
];

const problems = [];
async function open(url, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, ...opts });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${url}: console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${url}: pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`${url}: request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${url}: HTTP ${r.status()} ${r.url()}`); });
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 10000 });
  await page.waitForTimeout(150);
  return { ctx, page };
}

for (const [name, url, viewport] of shots) {
  if (only && !only.test(name)) continue;
  const { ctx, page } = await open(url, viewport);
  await page.screenshot({ path: join(out, `${name}.png`) });
  if (name === 'desktop-default' || name === 'mobile-default') await page.screenshot({ path: join(out, `${name}-full.png`), fullPage: true });
  await ctx.close();
  console.log('shot', name);
}

// ---- interaction smoke tests -------------------------------------------------
if (!only) {
  const { ctx, page } = await open('', DESKTOP);
  const check = (cond, msg) => { if (!cond) problems.push('interaction: ' + msg); };

  // hover a word -> card appears below it, linked words highlighted
  const word = page.locator('.u', { hasText: /^Word$/ }).first();
  await word.hover();
  await page.waitForTimeout(400);
  check(await page.locator('#gloss').isVisible(), 'hovering "Word" did not open the card');
  const wb = await word.boundingBox(), gb = await page.locator('#gloss').boundingBox();
  check(gb && wb && gb.y > wb.y + wb.height - 1, 'card is not below the word');
  check((await page.locator('#glossHead').innerText()).includes('λόγος'), 'card does not show λόγος');
  check((await page.locator('.u.is-kin').count()) >= 2, 'other λόγος words not marked');

  // multi-word link: "the beginning" is one unit
  check((await page.locator('.u', { hasText: /^the beginning$/ }).count()) === 2, '"the beginning" not grouped as one link');

  // moving away closes it
  await page.mouse.move(5, 880);
  await page.waitForTimeout(500);
  check(!(await page.locator('#gloss').isVisible()), 'card did not close after leaving');

  // keyboard: Tab to the text, arrow to a word, Enter opens, Escape closes
  await page.locator('.u').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check(await page.locator('#gloss').isVisible(), 'Enter did not open the card');
  const expanded = await page.evaluate(() => document.activeElement.getAttribute('aria-expanded'));
  check(expanded === 'true', 'focused word is not aria-expanded');
  check((await page.locator('#live').innerText()).length > 10, 'live region not updated');
  await page.keyboard.press('Escape');
  check(!(await page.locator('#gloss').isVisible()), 'Escape did not close the card');

  // flip above near the bottom of the viewport
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const last = page.locator('.u').last();
  await last.scrollIntoViewIfNeeded();
  await page.evaluate(() => { const el = [...document.querySelectorAll('.u')].pop(); window.scrollBy(0, el.getBoundingClientRect().bottom - innerHeight + 30); });
  await last.click();
  await page.waitForTimeout(100);
  check(await page.locator('#gloss.is-above').isVisible(), 'card did not flip above near the viewport bottom');
  await page.keyboard.press('Escape');

  // interlinear toggle + OT switch
  await page.setViewportSize(DESKTOP);
  await page.locator('label[for="interlinear"]').click();
  check((await page.locator('.il__or').count()) > 20, 'interlinear did not render original words');
  await page.locator('.seg__opt[data-passage="ot"]').click();
  check((await page.locator('.il__or[lang="he"]').count()) > 10, 'Hebrew interlinear missing');

  // search
  await page.locator('#q').fill('love');
  check(await page.locator('#searchPanel').isVisible(), 'search panel did not open');
  check((await page.locator('.hit').count()) === 6, 'search hits missing');

  // theme toggle
  await page.locator('#themeBtn').click();
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'theme toggle failed');
  await ctx.close();

  // touch: tap opens a bottom sheet
  const m = await open('', MOBILE, { hasTouch: true, isMobile: true });
  await m.page.locator('.u', { hasText: /^Word$/ }).first().tap();
  await m.page.waitForTimeout(300);
  check(await m.page.locator('#gloss.gloss--sheet').isVisible(), 'tap did not open the bottom sheet');
  const noHScroll = await m.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check(noHScroll, 'horizontal scroll at 390px');
  await m.ctx.close();

  // reduced motion: no animation on the card
  const r = await open('?demo=hover', DESKTOP, { reducedMotion: 'reduce' });
  const anim = await r.page.evaluate(() => getComputedStyle(document.getElementById('gloss')).animationName);
  check(anim === 'none', `reduced motion still animates (${anim})`);
  await r.ctx.close();
  console.log('interaction checks done');
}

await browser.close();
if (problems.length) {
  console.log('\nPROBLEMS:\n' + problems.join('\n'));
  process.exitCode = 1;
} else console.log('\nno console errors, all checks passed');
