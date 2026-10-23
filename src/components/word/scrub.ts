/**
 * Press-and-slide scrubbing state (docs/EXPERIENCE.md §2.3) shared by the reader controller (which
 * drives it), the loupe (which floats above the finger) and the one-time coach mark.
 */
import { signal } from '@preact/signals';
import { readString, writeString } from '../../app/storage';

export interface ScrubState {
  /** Chapter key of the unit ("TR/BOOK/CHAPTER"). */
  key: string;
  /** Unit under the finger (data-u). */
  unit: number;
  /** Finger position (client px). */
  x: number;
  y: number;
}

/** Non-null while the reader is in scrub mode. */
export const scrub = signal<ScrubState | null>(null);

/** Long-press time before scrubbing engages. */
export const SCRUB_HOLD_MS = 300;
/** Movement that cancels the long-press (it is a scroll / swipe instead). */
export const SCRUB_SLOP_PX = 10;
/** Minimum time between haptic ticks while scrubbing. */
export const SCRUB_TICK_MS = 40;
/** Taps resolve to the nearest word within this distance. */
export const HIT_SLOP_PX = 8;

const COACH_KEY = 'coach-scrub';

/** Has the reader already learned (or dismissed) the scrub gesture? */
export function scrubLearned(): boolean {
  return readString(COACH_KEY) === '1';
}

export function markScrubLearned(): void {
  writeString(COACH_KEY, '1');
  coachVisible.value = false;
}

/** The coach mark is showing. */
export const coachVisible = signal(false);

/** Show the coach mark once, after the first word tapped on a touch screen. */
export function maybeShowCoach(): void {
  if (scrubLearned() || coachVisible.value) return;
  coachVisible.value = true;
}

/**
 * Distance (px) from a point to the nearest of a set of rects (0 when inside one). Pure; used for
 * nearest-word hit-testing.
 */
export function distanceToRects(x: number, y: number, rects: ArrayLike<{ left: number; top: number; right: number; bottom: number }>): number {
  let best = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Classify a finished horizontal swipe on the text (pure; docs/EXPERIENCE.md §2.6): at least
 * `minDx` px and within `maxAngle` degrees of horizontal. Swipe left → next chapter.
 */
export function classifySwipe(dx: number, dy: number, minDx = 64, maxAngle = 25): 'next' | 'prev' | null {
  if (Math.abs(dx) < minDx) return null;
  const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  if (angle >= maxAngle) return null;
  return dx < 0 ? 'next' : 'prev';
}
