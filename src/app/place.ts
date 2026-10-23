/**
 * Keeping the reader's place (docs/EXPERIENCE.md §2: never lose the reader's position).
 *
 * Each reading history entry remembers where the reader was — the first verse on screen and how far
 * its top sat below the header — in `history.state.rwPos`. The reader writes it while scrolling
 * (throttled) and just before an in-app navigation, and restores it when the entry is shown again:
 * Back from a word study or the About page, Back / Forward between chapters, a reload. Switching
 * translation hands the place on to the new entry, so the same verse stays on screen.
 *
 * The DOM side (finding the first visible verse, scrolling back to it) lives in the reader, which
 * registers `readerHooks.capture`; everything here is plain data plus the History API.
 */
import { hashToRef } from '../lib/reference';

/** A reading position in one chapter of one translation. */
export interface ReadingPlace {
  /** Chapter key "TR/BOOK/CHAPTER" (same as the reader model's key). */
  key: string;
  /** First verse on screen. */
  verse: number;
  /** Its top edge, in px below the bottom of the header (negative: it started above). */
  offset: number;
}

/** Hooks the reader registers while it is mounted. */
export const readerHooks: {
  /** The place on screen now (null while nothing is rendered). */
  capture: (() => ReadingPlace | null) | null;
  /** Called just before a change that reflows the text (text size, spacing, font, layout). */
  beforeReflow: (() => void) | null;
} = { capture: null, beforeReflow: null };

export function isPlace(x: unknown): x is ReadingPlace {
  const p = x as ReadingPlace | null;
  return Boolean(
    p &&
      typeof p === 'object' &&
      typeof p.key === 'string' &&
      Number.isInteger(p.verse) &&
      p.verse >= 0 &&
      typeof p.offset === 'number' &&
      Number.isFinite(p.offset),
  );
}

/** The chapter key of a reading hash ("#/KJV/JHN/3/16" → "KJV/JHN/3"), else null. */
export function keyOfHash(hash: string): string | null {
  const r = hashToRef(hash);
  return r ? `${r.tr}/${r.ref.book}/${r.ref.chapter}` : null;
}

function histState(): Record<string, unknown> | null {
  if (typeof history === 'undefined') return null;
  const s = history.state as unknown;
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : null;
}

/** The place remembered by the current history entry, if it belongs to chapter `key`. */
export function savedPlace(key: string): ReadingPlace | null {
  const p = histState()?.rwPos;
  return isPlace(p) && p.key === key ? p : null;
}

/** Remember `place` in the current history entry (only while that entry shows its chapter). */
export function savePlace(place: ReadingPlace): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  if (keyOfHash(location.hash) !== place.key) return;
  const cur = histState();
  const old = cur?.rwPos;
  if (isPlace(old) && old.key === place.key && old.verse === place.verse && Math.abs(old.offset - place.offset) < 1) return;
  try {
    history.replaceState({ ...(cur ?? {}), rwPos: place }, '');
  } catch {
    /* rate-limited or blocked: the place is a convenience */
  }
}

/** Write the place on screen now (before a navigation leaves this entry). */
export function flushPlace(): void {
  const p = readerHooks.capture?.();
  if (p) savePlace(p);
}

/** Tell the reader a reflowing change is coming (it snapshots the place and restores it after). */
export function beforeReflow(): void {
  try {
    readerHooks.beforeReflow?.();
  } catch {
    /* never block a settings change */
  }
}
