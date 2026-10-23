import { describe, expect, it } from 'vitest';
import type { Box } from '../../src/components/word/placement';
import { computePlacement, shouldUseSheet } from '../../src/components/word/placement';

const box = (left: number, top: number, width: number, height = 24): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
const viewport = { width: 1440, height: 900 };
const card = { width: 432, height: 400 };

describe('card placement', () => {
  it('sits below the word with the notch over it', () => {
    const p = computePlacement({ rects: [box(600, 300, 60)], card, viewport, topInset: 60 });
    expect(p.side).toBe('below');
    expect(p.top).toBe(300 + 24 + 10);
    expect(p.left + p.notchX).toBe(630); // notch at the word's centre
    expect(p.maxHeight).toBe(Infinity);
    expect(p.scrollBy).toBe(0);
  });

  it('flips above when there is no room below but room above', () => {
    const p = computePlacement({ rects: [box(600, 700, 60)], card, viewport, topInset: 60 });
    expect(p.side).toBe('above');
    expect(p.top + card.height).toBe(700 - 10); // bottom edge 10px above the word
    expect(p.top).toBeGreaterThanOrEqual(60);
  });

  it('never covers the line it belongs to', () => {
    for (const top of [80, 200, 420, 600, 760]) {
      const r = box(500, top, 80);
      const p = computePlacement({ rects: [r], card, viewport, topInset: 60 });
      const h = Math.min(card.height, p.maxHeight);
      const overlaps = p.top < r.bottom && p.top + h > r.top;
      expect(overlaps).toBe(false);
    }
  });

  it('clamps horizontally to the viewport (16px margins)', () => {
    const right = computePlacement({ rects: [box(1400, 300, 30)], card, viewport, topInset: 60 });
    expect(right.left + card.width).toBeLessThanOrEqual(1440 - 16);
    const left = computePlacement({ rects: [box(2, 300, 30)], card, viewport, topInset: 60 });
    expect(left.left).toBe(16);
    // the notch stays inside the card, 18px from its edges
    expect(left.notchX).toBeGreaterThanOrEqual(18);
    expect(right.notchX).toBeLessThanOrEqual(card.width - 18);
  });

  it('uses the last line of a wrapped phrase below, the first line above', () => {
    const rects = [box(900, 300, 120), box(80, 334, 90)];
    const below = computePlacement({ rects, card, viewport, topInset: 60 });
    expect(below.top).toBe(334 + 24 + 10);
    expect(below.left + below.notchX).toBe(125);
    const high = [box(900, 640, 120), box(80, 674, 90)];
    const above = computePlacement({ rects: high, card, viewport, topInset: 60 });
    expect(above.side).toBe('above');
    expect(above.top + card.height).toBe(640 - 10);
  });

  it('hover card that fits nowhere takes the roomier side and scrolls inside', () => {
    const small = { width: 1024, height: 500 };
    const p = computePlacement({ rects: [box(400, 200, 60)], card: { width: 432, height: 480 }, viewport: small, topInset: 60 });
    expect(p.side).toBe('below');
    expect(p.maxHeight).toBeLessThan(480);
    expect(p.scrollBy).toBe(0);
  });

  it('pinned card that fits nowhere stays below and asks the page to scroll', () => {
    const small = { width: 1024, height: 500 };
    const p = computePlacement({ rects: [box(400, 200, 60)], card: { width: 432, height: 400 }, viewport: small, topInset: 60, pinned: true });
    expect(p.side).toBe('below');
    expect(p.scrollBy).toBeGreaterThan(0);
    // never scrolls the word under the header
    expect(200 - p.scrollBy).toBeGreaterThanOrEqual(60);
  });

  it('shrinks the card to the viewport on narrow screens', () => {
    const p = computePlacement({ rects: [box(100, 200, 40)], card, viewport: { width: 400, height: 800 }, topInset: 56 });
    expect(p.left).toBe(16);
    expect(p.notchX).toBeLessThanOrEqual(400 - 32 - 18);
  });

  it('uses a bottom sheet below 720px or on touch', () => {
    expect(shouldUseSheet(390, false)).toBe(true);
    expect(shouldUseSheet(719, false)).toBe(true);
    expect(shouldUseSheet(1024, false)).toBe(false);
    expect(shouldUseSheet(1024, true)).toBe(true);
  });
});
