// Screenshot every demo state of the "scholar" concept.
//   python3 -m http.server 8765 (from the repo root, in the background), then:
//   node design/concepts/scholar/shoot.mjs [port] [filter]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'shots');
mkdirSync(out, { recursive: true });
const port = process.argv[2] || '8765';
const filter = process.argv[3] || '';
const base = `http://localhost:${port}/design/concepts/scholar/index.html`;

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 900, height: 1100 };
const MOBILE = { width: 390, height: 844 };

const shots = [
  ['desktop-default', '', DESKTOP],
  ['desktop-default-full', '', DESKTOP, { full: true }],
  ['desktop-hover', '?demo=hover', DESKTOP],
  ['desktop-phrase', '?demo=phrase', DESKTOP],
  ['desktop-hover-ot', '?demo=hover-ot', DESKTOP],
  ['desktop-interlinear', '?demo=interlinear', DESKTOP],
  ['desktop-interlinear-ot', '?demo=interlinear&passage=ot', DESKTOP],
  ['desktop-interlinear-hover', '?demo=interlinear,hover', DESKTOP],
  ['desktop-search', '?demo=search', DESKTOP],
  ['desktop-books', '?demo=books', DESKTOP],
  ['desktop-translations', '?demo=niv', DESKTOP],
  ['desktop-focus', '?demo=focus', DESKTOP],
  ['desktop-ot-full', '?passage=ot', DESKTOP, { full: true }],
  ['desktop-dark-default', '?theme=dark', DESKTOP],
  ['desktop-dark-hover', '?theme=dark&demo=hover', DESKTOP],
  ['desktop-dark-hover-ot', '?theme=dark&demo=hover-ot', DESKTOP],
  ['desktop-dark-interlinear', '?theme=dark&demo=interlinear', DESKTOP],
  ['desktop-dark-search', '?theme=dark&demo=search', DESKTOP],
  ['tablet-hover', '?demo=hover', TABLET],
  ['mobile-default', '', MOBILE],
  ['mobile-default-full', '', MOBILE, { full: true }],
  ['mobile-hover', '?demo=hover', MOBILE],
  ['mobile-hover-ot', '?demo=hover-ot', MOBILE],
  ['mobile-interlinear', '?demo=interlinear', MOBILE],
  ['mobile-search', '?demo=search', MOBILE],
  ['mobile-dark-hover', '?theme=dark&demo=hover', MOBILE],
].filter(([name]) => name.includes(filter));

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe }).catch(() => chromium.launch());
let problems = 0;
for (const [name, query, viewport, opts = {}] of shots) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
  await page.goto(base + query, { waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 10000 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: Boolean(opts.full) });
  console.log(`${errors.length ? '✗' : '✓'} ${name}${errors.length ? '\n   ' + errors.join('\n   ') : ''}`);
  problems += errors.length;
  await page.close();
}
await browser.close();
process.exit(problems ? 1 : 0);
