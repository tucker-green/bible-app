/**
 * Word-card placement math (pure, unit-tested). Coordinates are viewport (client) pixels.
 *
 * Rules: the card sits directly BELOW the word with a small pointer (notch) aimed at it; it flips
 * ABOVE only when it does not fit below but does fit above (between the sticky header and the
 * word); it is clamped horizontally to the viewport; it never covers the line it belongs to.
 * When it fits on neither side: a hover card takes the roomier side and scrolls internally
 * (maxHeight); a pinned card stays below and asks the page to scroll just enough (scrollBy).
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PlacementInput {
  /** The word's client rects (one per line when it wraps). */
  rects: readonly Box[];
  card: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Bottom edge of the sticky header (nothing may go above it). */
  topInset: number;
  /** Minimum distance from the viewport edges. Default 16. */
  margin?: number;
  /** Space between the word and the card. Default 10. */
  gap?: number;
  /** Pinned cards may scroll the page instead of shrinking. */
  pinned?: boolean;
  /** Where the notch should sit from the card's left edge, ideally. Default 44. */
  notchOffset?: number;
}

export interface Placement {
  left: number;
  top: number;
  side: 'below' | 'above';
  /** Notch x relative to the card's left edge. */
  notchX: number;
  /** Max card height to apply (Infinity when the card fits as is). */
  maxHeight: number;
  /** Pixels the page should scroll (pinned cards only; 0 = none). */
  scrollBy: number;
}

const NOTCH_EDGE = 18;

export function computePlacement(i: PlacementInput): Placement {
  const margin = i.margin ?? 16;
  const gap = i.gap ?? 10;
  const vw = i.viewport.width;
  const vh = i.viewport.height;
  const cw = Math.min(i.card.width, vw - margin * 2);
  const ch = i.card.height;
  const rects = i.rects.length ? i.rects : [{ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }];
  const first = rects[0];
  const last = rects[rects.length - 1];

  const spaceBelow = vh - margin - (last.bottom + gap);
  const spaceAbove = first.top - gap - Math.max(i.topInset, 0) - margin / 2;

  let side: 'below' | 'above';
  let maxHeight = Infinity;
  let scrollBy = 0;
  if (ch <= spaceBelow) side = 'below';
  else if (ch <= spaceAbove) side = 'above';
  else if (i.pinned) {
    side = 'below';
    // Scroll so the card fits, but never push the word under the header.
    const wanted = ch - spaceBelow;
    const allowed = Math.max(0, first.top - i.topInset - gap - margin);
    scrollBy = Math.max(0, Math.min(wanted, allowed));
    const remaining = spaceBelow + scrollBy;
    if (remaining < ch) maxHeight = Math.max(160, remaining);
  } else {
    side = spaceBelow >= spaceAbove ? 'below' : 'above';
    maxHeight = Math.max(120, side === 'below' ? spaceBelow : spaceAbove);
  }

  const anchor = side === 'below' ? last : first;
  const cx = anchor.left + anchor.width / 2;
  const notchOffset = i.notchOffset ?? 44;
  const left = clamp(cx - notchOffset, margin, Math.max(margin, vw - cw - margin));
  const notchX = clamp(cx - left, NOTCH_EDGE, cw - NOTCH_EDGE);
  const height = Math.min(ch, maxHeight);
  // Coordinates are for the page as it is now (before any scrollBy is applied).
  const top = side === 'below' ? last.bottom + gap : first.top - gap - height;
  return { left, top, side, notchX, maxHeight, scrollBy };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/** Should the card be a bottom sheet? Narrow screens, or touch input. */
export function shouldUseSheet(viewportWidth: number, touch: boolean): boolean {
  return viewportWidth < 720 || touch;
}
