/**
 * Cross references (OpenBible.info, CC BY): loading public/data/xref/{BOOK}/{CHAPTER}.json and small
 * pure helpers to filter, merge, format, group and expand XrefTargets.
 *
 * An XrefTarget is [start packRef, end packRef (0 = single verse), votes]. Ranges may cross chapters
 * ("Gen 1:1–2:3") and, rarely, books ("2 Chr 36:22–Ezra 1:3"). Targets in a chapter file are already
 * sorted (most votes first, ties in canonical order) and capped at 40 per verse.
 *
 * Shared: compareXrefTargets is also used by the pipeline (scripts/data/xrefs.ts). No DOM access at
 * import time (safe for workers / Node).
 */
import { getBook, getBookByNum } from './books';
import { DataError, dataUrl, Lru } from './data';
import type { FetchLike } from './data';
import { formatReference, refToHash } from './reference';
import type { RefStyle } from './reference';
import { packRef, unpackRef } from './types';
import type { BookId, DataMeta, VerseRef, XrefChapter, XrefTarget } from './types';

/* ------------------------------------------------------------------------ */
/* Loading                                                                   */
/* ------------------------------------------------------------------------ */

/** null = the global fetch, looked up at call time (so test stubs of globalThis.fetch work). */
let fetchImpl: FetchLike | null = null;
let cache = new Lru<string, Promise<XrefChapter>>(40);

/**
 * Override how cross references are fetched (tests) and/or the number of chapters kept in memory.
 * The base URL and data version come from src/lib/data.ts (configureData / loadMeta). Clears the cache.
 */
export function configureXrefs(opts: { fetch?: FetchLike | null; cacheSize?: number }): void {
  if ('fetch' in opts) fetchImpl = opts.fetch ?? null;
  cache = new Lru(opts.cacheSize ?? cache.capacity);
}

/** Forget every cached chapter. */
export function resetXrefCache(): void {
  cache.clear();
}

/** Path of a chapter's file under the data directory: "xref/GEN/1.json". */
export function xrefPath(book: BookId, chapter: number): string {
  return `xref/${book}/${chapter}.json`;
}

/** A chapter with no cross references. */
export function emptyXrefChapter(book: BookId, chapter: number): XrefChapter {
  return { book, chapter, verses: {} };
}

/**
 * public/data/xref/{BOOK}/{CHAPTER}.json, cached (LRU) and de-duplicated like the other loaders in
 * data.ts. A missing file (HTTP 404) resolves to an empty chapter, so the reader just shows no cross
 * references; other failures reject with DataError and are not cached. Unknown books / chapters reject.
 */
export function loadXrefs(book: BookId, chapter: number): Promise<XrefChapter> {
  const info = getBook(book);
  if (!info || !Number.isInteger(chapter) || chapter < 1 || chapter > info.chapters) {
    return Promise.reject(new Error(`No such chapter: ${book} ${chapter}`));
  }
  const url = dataUrl(xrefPath(info.id, chapter));
  const hit = cache.get(url);
  if (hit) return hit;
  const p = fetchXrefs(url, info.id, chapter);
  cache.set(url, p);
  p.catch(() => {
    if (cache.get(url) === p) cache.delete(url);
  });
  return p;
}

async function fetchXrefs(url: string, book: BookId, chapter: number): Promise<XrefChapter> {
  let res: Response;
  try {
    res = await (fetchImpl ? fetchImpl(url) : fetch(url));
  } catch (err) {
    throw Object.assign(new DataError(url, 0), { cause: err });
  }
  if (res.status === 404) return emptyXrefChapter(book, chapter);
  if (!res.ok) throw new DataError(url, res.status);
  return (await res.json()) as XrefChapter;
}

/* ------------------------------------------------------------------------ */
/* Selecting targets                                                         */
/* ------------------------------------------------------------------------ */

export interface XrefFilter {
  /** Keep at most this many targets (after filtering). */
  limit?: number;
  /** Keep only targets with at least this many votes (the data has only votes >= 1). */
  minVotes?: number;
}

/** Display order: most votes first, ties in canonical order (start, then end; a single verse before a range). */
export function compareXrefTargets(a: XrefTarget, b: XrefTarget): number {
  return b[2] - a[2] || compareXrefCanonical(a, b);
}

/** Canonical (Bible) order: start, then end. */
export function compareXrefCanonical(a: XrefTarget, b: XrefTarget): number {
  return a[0] - b[0] || (a[1] || a[0]) - (b[1] || b[0]);
}

function applyFilter(targets: XrefTarget[], opts: XrefFilter): XrefTarget[] {
  const min = opts.minVotes;
  const out = min !== undefined ? targets.filter((t) => t[2] >= min) : targets.slice();
  return opts.limit !== undefined && opts.limit >= 0 ? out.slice(0, opts.limit) : out;
}

/** Targets of one verse, most votes first. Accepts a not-yet-loaded chapter (null/undefined -> []). */
export function xrefsForVerse(ch: XrefChapter | null | undefined, verse: number, opts: XrefFilter = {}): XrefTarget[] {
  return applyFilter(ch?.verses[String(verse)] ?? [], opts);
}

/**
 * Targets of several verses of the chapter (a selected passage such as John 3:16–18), merged:
 * duplicates keep their highest vote, targets lying wholly inside the selected verses are dropped,
 * and the result is re-sorted (most votes first).
 */
export function xrefsForVerses(ch: XrefChapter | null | undefined, verses: Iterable<number>, opts: XrefFilter = {}): XrefTarget[] {
  if (!ch) return [];
  const bookNum = getBook(ch.book)?.num ?? 0;
  const selected = new Set<number>();
  for (const v of verses) selected.add(packRef(bookNum, ch.chapter, v));
  const best = new Map<string, XrefTarget>();
  for (const from of selected) {
    for (const t of ch.verses[String(unpackRef(from).verse)] ?? []) {
      if (isInside(t, selected)) continue;
      const key = xrefKey(t);
      const prev = best.get(key);
      if (!prev || t[2] > prev[2]) best.set(key, t);
    }
  }
  return applyFilter([...best.values()].sort(compareXrefTargets), opts);
}

function isInside(t: XrefTarget, selected: Set<number>): boolean {
  const end = t[1] || t[0];
  // A range crossing into another chapter is never inside one chapter's selection.
  if (Math.floor(end / 1000) !== Math.floor(t[0] / 1000)) return false;
  for (let p = t[0]; p <= end; p++) if (!selected.has(p)) return false;
  return true;
}

/** Number of targets of a verse (optionally only those with at least `minVotes`). */
export function xrefCount(ch: XrefChapter | null | undefined, verse: number, minVotes?: number): number {
  return xrefsForVerse(ch, verse, { minVotes }).length;
}

/** Verse numbers of the chapter that have cross references (ascending), e.g. to mark them in the text. */
export function versesWithXrefs(ch: XrefChapter | null | undefined, minVotes?: number): number[] {
  if (!ch) return [];
  return Object.keys(ch.verses)
    .map(Number)
    .filter((v) => xrefCount(ch, v, minVotes) > 0)
    .sort((a, b) => a - b);
}

/* ------------------------------------------------------------------------ */
/* Reading a target                                                          */
/* ------------------------------------------------------------------------ */

/** One end of a target, unpacked. */
export interface XrefPoint {
  book: BookId;
  bookNum: number;
  chapter: number;
  verse: number;
}

function point(packed: number): XrefPoint {
  const { bookNum, chapter, verse } = unpackRef(packed);
  return { book: getBookByNum(bookNum)?.id ?? String(bookNum), bookNum, chapter, verse };
}

/** First verse of a target. */
export function xrefStart(t: XrefTarget): XrefPoint {
  return point(t[0]);
}

/** Last verse of a target (= the start for a single verse). */
export function xrefEnd(t: XrefTarget): XrefPoint {
  return point(t[1] || t[0]);
}

/** True when the target spans more than one verse. */
export function isXrefRange(t: XrefTarget): boolean {
  return t[1] !== 0 && t[1] !== t[0];
}

/** Stable string key for a target (list keys, de-duplication): "20008022-20008030". */
export function xrefKey(t: XrefTarget): string {
  return `${t[0]}-${t[1] || t[0]}`;
}

/**
 * A VerseRef to navigate to (refToHash, formatReference). Ranges within one chapter keep their end
 * verse; a range that crosses into another chapter or book becomes its first verse.
 */
export function xrefToRef(t: XrefTarget): VerseRef {
  const s = xrefStart(t);
  const e = xrefEnd(t);
  const ref: VerseRef = { book: s.book, chapter: s.chapter, verse: s.verse };
  if (e.bookNum === s.bookNum && e.chapter === s.chapter && e.verse > s.verse) ref.verseEnd = e.verse;
  return ref;
}

/** Reading route for a target in a translation: "#/KJV/PRO/8/22-30". */
export function xrefHash(tr: string, t: XrefTarget): string {
  return refToHash(tr, xrefToRef(t));
}

/**
 * Human-readable target, short style by default: "Prov 8:22–30", "John 1:1", "Gen 1:1–2:3",
 * "2 Chr 36:22–Ezra 1:3", "Jude 3". Long style: "Proverbs 8:22–30".
 */
export function formatXrefTarget(t: XrefTarget, style: RefStyle = 'short'): string {
  const s = xrefStart(t);
  const e = xrefEnd(t);
  if (e.bookNum === s.bookNum && e.chapter === s.chapter) {
    return formatReference({ book: s.book, chapter: s.chapter, verse: s.verse, verseEnd: e.verse }, style);
  }
  const first = formatReference({ book: s.book, chapter: s.chapter, verse: s.verse }, style);
  if (e.bookNum === s.bookNum) return `${first}–${e.chapter}:${e.verse}`;
  return `${first}–${formatReference({ book: e.book, chapter: e.chapter, verse: e.verse }, style)}`;
}

/** Testament of a target (by its first verse). */
export function xrefTestament(t: XrefTarget): 'OT' | 'NT' {
  return unpackRef(t[0]).bookNum >= 40 ? 'NT' : 'OT';
}

/** Split targets into Old and New Testament, keeping their order. */
export function groupXrefsByTestament(targets: readonly XrefTarget[]): { OT: XrefTarget[]; NT: XrefTarget[] } {
  const out: { OT: XrefTarget[]; NT: XrefTarget[] } = { OT: [], NT: [] };
  for (const t of targets) out[xrefTestament(t)].push(t);
  return out;
}

/** Group targets by the book they start in, books in canonical order, targets keeping their order. */
export function groupXrefsByBook(targets: readonly XrefTarget[]): { book: BookId; targets: XrefTarget[] }[] {
  const byNum = new Map<number, XrefTarget[]>();
  for (const t of targets) {
    const n = unpackRef(t[0]).bookNum;
    let list = byNum.get(n);
    if (!list) byNum.set(n, (list = []));
    list.push(t);
  }
  return [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, list]) => ({ book: getBookByNum(n)?.id ?? String(n), targets: list }));
}

/** Verse counts for expandXrefTarget from meta.json: (book, chapter) -> number of verses. */
export function metaVerseCount(meta: DataMeta): (book: BookId, chapter: number) => number | undefined {
  const byId = new Map(meta.books.map((b) => [b.id, b.verses]));
  return (book, chapter) => byId.get(book)?.[chapter - 1];
}

/**
 * Every verse of a target, in order, e.g. to preview its text: Prov 8:22–30 -> 9 single-verse refs.
 * Crossing a chapter boundary needs `verseCount` (see metaVerseCount); when a count is unknown the
 * expansion stops at the last verse it can be sure of. At most `max` verses are returned.
 */
export function expandXrefTarget(
  t: XrefTarget,
  verseCount: (book: BookId, chapter: number) => number | undefined = () => undefined,
  max = 200,
): VerseRef[] {
  const out: VerseRef[] = [];
  const end = t[1] || t[0];
  let { bookNum, chapter, verse } = unpackRef(t[0]);
  while (out.length < max) {
    const book = getBookByNum(bookNum);
    const cur = packRef(bookNum, chapter, verse);
    if (!book || cur > end) break;
    out.push({ book: book.id, chapter, verse });
    if (cur === end) break;
    const count = verseCount(book.id, chapter);
    const endsHere = Math.floor(end / 1000) === Math.floor(cur / 1000);
    if (endsHere || (count !== undefined && verse < count)) {
      verse++;
    } else if (count === undefined) {
      break; // the range continues past this chapter but we do not know where the chapter ends
    } else if (chapter < book.chapters) {
      chapter++;
      verse = 1;
    } else {
      bookNum++;
      chapter = 1;
      verse = 1;
    }
  }
  return out;
}
