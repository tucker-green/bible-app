import { describe, expect, it } from 'vitest';
import { chromeStep } from '../../src/components/shell/chrome';
import { pickDetent, springStep } from '../../src/components/shell/sheet';
import { classifySwipe, distanceToRects } from '../../src/components/word/scrub';

describe('bottom-sheet detents', () => {
  const d = { full: 0, peek: 300, closed: 724 };
  it('settles on the nearest detent of the projected position', () => {
    expect(pickDetent(280, 0, d)).toBe('peek');
    expect(pickDetent(60, 0, d)).toBe('full');
    expect(pickDetent(600, 0, d)).toBe('closed');
    expect(pickDetent(250, -0.3, d)).toBe('peek'); // projected 196: nearer peek
    expect(pickDetent(150, -0.3, d)).toBe('full'); // projected 96: nearer full
  });
  it('a fling moves one detent in its direction', () => {
    expect(pickDetent(300, 0.8, d)).toBe('closed');
    expect(pickDetent(300, -0.8, d)).toBe('full');
    expect(pickDetent(0, 0.9, d)).toBe('peek');
    expect(pickDetent(150, 0.9, d)).toBe('peek');
    expect(pickDetent(150, -0.9, d)).toBe('full');
  });
  it('short content has no separate peek detent', () => {
    const s = { full: 0, peek: 0, closed: 300 };
    expect(pickDetent(40, 0, s)).toBe('full');
    expect(pickDetent(40, 0.9, s)).toBe('closed');
  });
  it('the spring converges on its target', () => {
    let x = 700;
    let v = 0;
    for (let i = 0; i < 120; i++) ({ x, v } = springStep(x, v, 300, 1 / 60));
    expect(Math.abs(x - 300)).toBeLessThan(1);
    expect(Math.abs(v)).toBeLessThan(20);
  });
});

describe('compact chrome auto-hide', () => {
  const opts = { top: 56, nearEnd: false };
  it('hides after a deliberate scroll down and shows on scroll up', () => {
    let s = { hidden: false, acc: 0 };
    s = chromeStep(s, 300, 10, opts);
    expect(s.hidden).toBe(false);
    s = chromeStep(s, 320, 20, opts);
    expect(s.hidden).toBe(true);
    s = chromeStep(s, 310, -10, opts);
    expect(s.hidden).toBe(true);
    s = chromeStep(s, 280, -30, opts);
    expect(s.hidden).toBe(false);
  });
  it('always shows near the top and at the end', () => {
    expect(chromeStep({ hidden: true, acc: 50 }, 20, 10, opts).hidden).toBe(false);
    expect(chromeStep({ hidden: true, acc: 50 }, 900, 30, { top: 56, nearEnd: true }).hidden).toBe(false);
  });
});

describe('swipe intent and nearest-word hit-testing', () => {
  it('needs ≥ 64 px within 25° of horizontal', () => {
    expect(classifySwipe(-80, 10)).toBe('next');
    expect(classifySwipe(90, -20)).toBe('prev');
    expect(classifySwipe(-50, 0)).toBeNull();
    expect(classifySwipe(-80, 50)).toBeNull(); // 32°
    expect(classifySwipe(0, 200)).toBeNull();
  });
  it('measures the distance to the nearest rect', () => {
    const rects = [
      { left: 10, top: 10, right: 50, bottom: 30 },
      { left: 10, top: 40, right: 30, bottom: 60 },
    ];
    expect(distanceToRects(20, 20, rects)).toBe(0);
    expect(distanceToRects(55, 20, rects)).toBe(5);
    expect(distanceToRects(35, 35, rects)).toBeCloseTo(5, 5);
    expect(distanceToRects(0, 0, [])).toBe(Infinity);
  });
});
