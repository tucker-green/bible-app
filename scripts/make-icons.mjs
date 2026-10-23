/**
 * Renders the PWA / home-screen icons from public/favicon.svg with Playwright's Chromium:
 *
 *   public/icons/icon-{192,512}.png       purpose "any": the favicon as drawn (rounded tile)
 *   public/icons/maskable-{192,512}.png   purpose "maskable": full-bleed ink-blue square, the mark
 *                                         scaled into the 80% safe circle (Android crops to any shape)
 *   public/apple-touch-icon.png           180×180, full bleed (iOS rounds the corners itself)
 *
 *   node scripts/make-icons.mjs     (re-run after changing favicon.svg; the PNGs are committed)
 *
 * Uses the light-scheme colours of the favicon (the PNGs cannot follow the system theme).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = process.cwd();
const svg = readFileSync(join(ROOT, 'public', 'favicon.svg'), 'utf8');

// The mark (everything but the background tile), and the tile colour, from the favicon itself.
const mark = svg
  .replace(/<\?xml[^>]*>/, '')
  .replace(/^[\s\S]*?<\/style>/, '')
  .replace(/<rect class="bg"[^>]*\/>/, '')
  .replace(/<\/svg>\s*$/, '');
const style = /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1].replace(/@media[\s\S]*$/, '') ?? '';
const bg = /\.bg\s*\{\s*fill:\s*([^;]+);/.exec(style)?.[1] ?? '#1d3b72';

/** Bounding box of the mark in the 32×32 viewBox (the R and the underline bar). */
const BOX = { x: 8.6, y: 6.4, w: 24.7 - 8.6, h: 27.5 - 6.4 };

/** A full-bleed square with the mark centred, its bounding box scaled to `share` of the size. */
function fullBleed(share) {
  const k = (32 * share) / Math.max(BOX.w, BOX.h);
  const cx = BOX.x + BOX.w / 2;
  const cy = BOX.y + BOX.h / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>${style}</style>
    <rect width="32" height="32" fill="${bg}"/>
    <g transform="translate(16 16) scale(${k.toFixed(4)}) translate(${-cx} ${-cy})">${mark}</g></svg>`;
}

const OUT = [
  { file: 'icons/icon-192.png', size: 192, svg, transparent: true },
  { file: 'icons/icon-512.png', size: 512, svg, transparent: true },
  // maskable: the mark's diagonal stays inside the 80% safe circle (box height 58% -> diagonal ≈ 73%)
  { file: 'icons/maskable-192.png', size: 192, svg: fullBleed(0.58) },
  { file: 'icons/maskable-512.png', size: 512, svg: fullBleed(0.58) },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed(0.66) },
];

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
try {
  const page = await browser.newPage({ colorScheme: 'light', deviceScaleFactor: 1 });
  for (const o of OUT) {
    await page.setViewportSize({ width: o.size, height: o.size });
    const html = `<!doctype html><html><body style="margin:0;background:transparent">
      <div style="width:${o.size}px;height:${o.size}px">${o.svg.replace('<svg ', `<svg width="${o.size}" height="${o.size}" `)}</div></body></html>`;
    await page.setContent(html);
    const path = join(ROOT, 'public', o.file);
    mkdirSync(join(path, '..'), { recursive: true });
    await page.locator('svg').screenshot({ path, omitBackground: Boolean(o.transparent) });
    console.log(`wrote public/${o.file} (${o.size}×${o.size})`);
  }
} finally {
  await browser.close();
}
