/**
 * Cross references — pure view-model helpers shared by the verse-sheet section
 * (src/components/verse/XrefSection.tsx) and the desktop rail block (./XrefRail.tsx).
 *
 * Data: OpenBible.info votes via src/lib/xrefs.ts. Targets arrive strongest first; nothing here
 * re-sorts them except to split them into Old / New Testament groups.
 */
import { tokensToText } from '../../lib/data';
import type { TextChapter, XrefTarget } from '../../lib/types';
import { xrefKey, xrefTestament } from '../../lib/xrefs';

/* ------------------------------------------------------------------------ */
/* Vote strength                                                             */
/* ------------------------------------------------------------------------ */

export type StrengthLevel = 1 | 2 | 3;

export interface Strength {
  level: StrengthLevel;
  /** Plain word for screen readers and tooltips. */
  word: 'strong' | 'moderate' | 'weak';
}

/**
 * Absolute bands over every OpenBible.info vote in the data (338 k targets): the median target has
 * 3 votes, the 75th percentile 5, the 90th 10. So ≥ 10 votes = strong (top ~11 %), 4–9 = moderate,
 * 1–3 = weak. Absolute (not relative to the verse) so a lightly-voted verse is not dressed up as
 * having "strong" links.
 */
export const STRONG_VOTES = 10;
// (No marker on verse numbers with "strong" references: votes track how popular a chapter is more
// than how strong a link is — ≥ 50 votes marks every verse of Psalm 23 and a third of Romans 8 but
// nothing in most chapters, and 94 % of verses have some references — so a marker would mean
// "famous verse" and clutter the text. The verse number itself is the entry point everywhere.)
export const MODERATE_VOTES = 4;

export function xrefStrength(votes: number): Strength {
  if (votes >= STRONG_VOTES) return { level: 3, word: 'strong' };
  if (votes >= MODERATE_VOTES) return { level: 2, word: 'moderate' };
  return { level: 1, word: 'weak' };
}

/** "1 vote" / "70 votes". */
export function votesLabel(votes: number): string {
  return `${votes} ${votes === 1 ? 'vote' : 'votes'}`;
}

/* ------------------------------------------------------------------------ */
/* Grouping                                                                  */
/* ------------------------------------------------------------------------ */

export type Testament = 'OT' | 'NT';

export interface XrefGroup {
  testament: Testament;
  title: string;
  items: XrefTarget[];
}

export interface XrefDisplay {
  groups: XrefGroup[];
  /** Targets in total. */
  total: number;
  /** Targets not shown (collapsed). */
  hidden: number;
}

export const TESTAMENT_TITLE: Record<Testament, string> = { OT: 'Old Testament', NT: 'New Testament' };

/**
 * The strongest `limit` targets (all of them when `limit` is undefined), split into Old / New
 * Testament groups. Each group keeps the vote order; the group holding the single strongest target
 * comes first, judged on the whole list so the order never flips when the list is expanded.
 */
export function groupXrefs(targets: readonly XrefTarget[], limit?: number): XrefDisplay {
  const shown = limit === undefined ? targets : targets.slice(0, Math.max(0, limit));
  const by: Record<Testament, XrefTarget[]> = { OT: [], NT: [] };
  for (const t of shown) by[xrefTestament(t)].push(t);
  const first: Testament = targets.length ? xrefTestament(targets[0]) : 'OT';
  const order: Testament[] = first === 'NT' ? ['NT', 'OT'] : ['OT', 'NT'];
  return {
    groups: order.filter((k) => by[k].length).map((k) => ({ testament: k, title: TESTAMENT_TITLE[k], items: by[k] })),
    total: targets.length,
    hidden: targets.length - shown.length,
  };
}

/** De-duplicate targets by range (defensive: the data is already unique per verse). */
export function uniqueTargets(targets: readonly XrefTarget[]): XrefTarget[] {
  const seen = new Set<string>();
  const out: XrefTarget[] = [];
  for (const t of targets) {
    const k = xrefKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Preview text                                                              */
/* ------------------------------------------------------------------------ */

/** Longest preview kept (characters); CSS clamps it to one line anyway, this keeps screen readers brief. */
export const PREVIEW_MAX = 160;

/** Shorten at a word boundary with an ellipsis. */
export function truncate(text: string, max = PREVIEW_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/** Plain text of one verse of a chapter (whitespace collapsed), or null when the verse is absent. */
export function verseText(ch: TextChapter, verse: number): string | null {
  const v = ch.verses.find((x) => x.v === verse);
  if (!v) return null;
  const text = tokensToText(v.t).replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * One-line preview of a target: its first verse (shortened), followed by " …" when the target is a
 * range. null when the translation has no such verse.
 */
export function previewText(firstVerse: string | null, isRange: boolean): string | null {
  if (firstVerse === null) return null;
  const t = truncate(firstVerse);
  return isRange && !t.endsWith('…') ? `${t} …` : t;
}

/* ------------------------------------------------------------------------ */
/* Reading position                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Index of the verse at the reading line, given each verse's top edge (in document order, so the
 * tops never decrease): the last verse that starts at or above the line; the first when none does.
 * Binary search, so long chapters (Psalm 119) cost a handful of layout reads per scroll frame.
 * Returns -1 for an empty list.
 */
export function indexAtLine(count: number, top: (i: number) => number, line: number): number {
  if (count <= 0) return -1;
  let lo = 0;
  let hi = count - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (top(mid) <= line) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}
