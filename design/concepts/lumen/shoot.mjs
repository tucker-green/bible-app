// Screenshot every demo state of the Lumen concept.
//   python3 -m http.server 8731 --directory /home/user/bible-app &   (serve the repo root)
//   node design/concepts/lumen/shoot.mjs [baseUrl] [filter]
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'shots');
mkdirSync(out, { recursive: true });
const base = process.argv[2] || 'http://127.0.0.1:8731/design/concepts/lumen/';
const filter = process.argv[3] || '';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const shots = [
  ['desktop-default', DESKTOP, ''],
  ['desktop-dark-default', DESKTOP, 'theme=dark'],
  ['desktop-hover', DESKTOP, 'demo=hover'],
  ['desktop-dark-hover', DESKTOP, 'theme=dark&demo=hover'],
  ['desktop-hover-ot', DESKTOP, 'demo=hover-ot'],
  ['desktop-dark-hover-ot', DESKTOP, 'theme=dark&demo=hover-ot'],
  ['desktop-phrase', DESKTOP, 'demo=phrase'],
  ['desktop-dark-phrase-ot', DESKTOP, 'theme=dark&demo=phrase-ot'],
  ['desktop-interlinear', DESKTOP, 'demo=interlinear'],
  ['desktop-dark-interlinear', DESKTOP, 'theme=dark&demo=interlinear'],
  ['desktop-interlinear-ot', DESKTOP, 'demo=interlinear-ot', { full: true }],
  ['desktop-search', DESKTOP, 'demo=search'],
  ['desktop-dark-search', DESKTOP, 'theme=dark&demo=search'],
  ['desktop-books', DESKTOP, 'demo=books'],
  ['desktop-dark-translations', DESKTOP, 'theme=dark&demo=translations'],
  ['desktop-supplied', DESKTOP, 'passage=ot&demo=supplied'],
  ['desktop-ot-full', DESKTOP, 'passage=ot', { full: true }],
  ['desktop-dark-ot-full', DESKTOP, 'theme=dark&passage=ot', { full: true }],
  ['mobile-default', MOBILE, ''],
  ['mobile-dark-default', MOBILE, 'theme=dark'],
  ['mobile-hover', MOBILE, 'demo=hover'],
  ['mobile-dark-hover', MOBILE, 'theme=dark&demo=hover'],
  ['mobile-hover-ot', MOBILE, 'demo=hover-ot'],
  ['mobile-interlinear', MOBILE, 'demo=interlinear'],
  ['mobile-dark-interlinear-ot', MOBILE, 'theme=dark&demo=interlinear-ot'],
  ['mobile-search', MOBILE, 'demo=search'],
  ['mobile-dark-search', MOBILE, 'theme=dark&demo=search'],
  ['tablet-hover', { width: 834, height: 1112 }, 'demo=hover'],
];

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
let problems = 0;
for (const [name, viewport, query, opts = {}] of shots) {
  if (filter && !name.includes(filter)) continue;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(base + (query ? `?${query}` : ''), { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 10000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: !!opts.full });
  console.log(`${errors.length ? '!!' : 'ok'} ${name}${errors.length ? `\n   ${errors.join('\n   ')}` : ''}`);
  problems += errors.length;
  await ctx.close();
}
await browser.close();
console.log(problems ? `${problems} console problem(s)` : 'no console errors');

// Interaction checks (not demo params): real hover with intent delay, keyboard open, theme toggle.
if (!filter || filter === 'interact') {
  const b2 = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
  const ctx = await b2.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(base + '?theme=dark');
  await page.waitForSelector('html[data-ready="1"]');
  // hover "light" in v4 with the real mouse
  const light = page.locator('#passage [data-u]', { hasText: /^light$/ }).first();
  await light.hover();
  await page.waitForTimeout(150);
  const midOpen = await page.locator('#card').isVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, 'interact-dark-hover-light.png') });
  const heroText = await page.locator('#card .hero-word').textContent();
  // move away: card closes after the grace period
  await page.mouse.move(40, 500);
  await page.waitForTimeout(500);
  const closed = !(await page.locator('#card').isVisible());
  // keyboard: focus first word, arrow right x5, Enter
  await page.locator('#passage [data-u]').first().focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const kbWord = await page.evaluate(() => document.activeElement?.textContent);
  const described = await page.evaluate(() => document.activeElement?.getAttribute('aria-describedby'));
  const live = await page.locator('#live').textContent();
  await page.screenshot({ path: join(out, 'interact-dark-keyboard.png') });
  await page.keyboard.press('Tab');
  const inCard = await page.evaluate(() => !!document.activeElement?.closest('#card'));
  await page.keyboard.press('Escape');
  const backOnWord = await page.evaluate(() => document.activeElement?.textContent);
  const cardGone = !(await page.locator('#card').isVisible());
  // theme toggle + interlinear toggle
  await page.click('#themeBtn');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#modeSeg [data-mode="interlinear"]');
  const iuCount = await page.locator('#passage .iu').count();
  console.log(JSON.stringify({ midOpen, heroText, closedAfterLeave: closed, kbWord, described, live, inCard, backOnWord, cardGone, theme, iuCount, errs }, null, 1));
  // reduced motion run
  const ctx2 = await b2.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto(base + '?theme=dark');
  await p2.waitForSelector('html[data-ready="1"]');
  await p2.locator('#passage [data-u]').nth(5).hover();
  await p2.waitForTimeout(300);
  const anim = await p2.evaluate(() => getComputedStyle(document.querySelector('#card .hero-word')).animationName);
  console.log('reduced-motion hero animation:', anim);
  await b2.close();
}
