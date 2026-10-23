/**
 * Pure helpers for the search panel (no DOM, no fetching): safe highlight segments, grouping hits
 * by book, facet counts, which translation's corpus to search, query classification for the
 * "Go to" / people & places groups, recent searches and the query-syntax hints.
 */
import { readJson, writeJson } from '../../app/storage';
import { BOOKS, getBookByNum } from '../../lib/books';
import type { BookInfo } from '../../lib/books';
import { hasGreek, hasHebrew } from '../../lib/greek';
import type { SearchHit, SearchSuggestion } from '../../lib/search/client';
import type { VerseRef } from '../../lib/types';

/* ------------------------------------------------------------------------ */
/* Highlighting                                                              */
/* ------------------------------------------------------------------------ */

export interface Segment {
  text: string;
  hit: boolean;
}

/**
 * Split `text` into plain and highlighted runs from [start, end) spans. Spans are sorted, clamped
 * to the text, empty ones dropped and overlaps merged, so bad input can never duplicate or lose
 * text. The result is rendered as text nodes (never HTML), so verse text is always escaped.
 */
export function segments(text: string, spans: readonly (readonly [number, number])[] | undefined): Segment[] {
  const len = text.length;
  const clean = (spans ?? [])
    .map(([s, e]) => [Math.max(0, Math.min(len, Math.floor(s))), Math.max(0, Math.min(len, Math.floor(e)))] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const sp of clean) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  const out: Segment[] = [];
  let at = 0;
  for (const [s, e] of merged) {
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < len || !out.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** Greek (incl. extended/polytonic) or Hebrew runs, with the marks and spaces between their letters. */
const SCRIPT_RUN_RE = /([Ͱ-Ͽἀ-῿](?:[Ͱ-Ͽἀ-῿̀-ͯ' ]*[Ͱ-Ͽἀ-῿̀-ͯ])?)|([֐-׿יִ-ﭏ](?:[֐-׿יִ-ﭏ ]*[֐-׿יִ-ﭏ])?)/gu;

export interface ScriptRun {
  text: string;
  /** HTML lang for Greek / Hebrew runs; undefined for everything else. */
  lang?: 'grc' | 'he';
}

/** Split text into runs so Greek and Hebrew can carry their own `lang` (and font / direction). */
export function scriptRuns(text: string): ScriptRun[] {
  const out: ScriptRun[] = [];
  let at = 0;
  SCRIPT_RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCRIPT_RUN_RE.exec(text))) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], lang: m[1] ? 'grc' : 'he' });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** Stable key of a verse hit ("JHN.3.16"). */
export function hitKey(h: Pick<SearchHit, 'book' | 'chapter' | 'verse'>): string {
  return `${h.book}.${h.chapter}.${h.verse}`;
}

/** DOM id of a verse option. */
export function hitOptionId(h: Pick<SearchHit, 'book' | 'chapter' | 'verse'>): string {
  return `so-v-${h.book}-${h.chapter}-${h.verse}`;
}

/* ------------------------------------------------------------------------ */
/* Grouping and facets                                                       */
/* ------------------------------------------------------------------------ */

export interface BookGroup {
  bookNum: number;
  book: string;
  name: string;
  hits: SearchHit[];
}

/** Consecutive hits of the same book (hits arrive in canonical order). */
export function groupByBook(hits: readonly SearchHit[]): BookGroup[] {
  const groups: BookGroup[] = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && last.bookNum === h.bookNum) last.hits.push(h);
    else groups.push({ bookNum: h.bookNum, book: h.book, name: getBookByNum(h.bookNum)?.name ?? h.book, hits: [h] });
  }
  return groups;
}

export interface TestamentCounts {
  all: number;
  OT: number;
  NT: number;
}

/** Verse counts per testament from SearchResponse.byBook (which ignores the filters). */
export function testamentCounts(byBook: Record<number, number> | undefined): TestamentCounts {
  const c: TestamentCounts = { all: 0, OT: 0, NT: 0 };
  for (const [k, n] of Object.entries(byBook ?? {})) {
    const num = Number(k);
    if (!Number.isFinite(n) || n <= 0) continue;
    c.all += n;
    if (num >= 1 && num <= 39) c.OT += n;
    else if (num >= 40 && num <= 66) c.NT += n;
  }
  return c;
}

export interface BookCount {
  book: BookInfo;
  count: number;
}

/** Books with at least one match, in canonical order (optionally one testament only). */
export function bookCounts(byBook: Record<number, number> | undefined, testament?: 'OT' | 'NT'): BookCount[] {
  const out: BookCount[] = [];
  for (const b of BOOKS) {
    const n = byBook?.[b.num] ?? 0;
    if (n > 0 && (!testament || b.testament === testament)) out.push({ book: b, count: n });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Translation to search                                                     */
/* ------------------------------------------------------------------------ */

/** The KJV is the default translation and the corpus used when the reading one has none. */
export const FALLBACK_SEARCH_TR = 'KJV';

/**
 * Which corpus to search for a reading translation: bundled translations have one
 * (public/data/search/{TR}.json); runtime ones (NIV via API.Bible) don't, so the KJV is searched.
 * `bundled` = ids from meta.json (empty while it loads: then only `remote` decides).
 */
export function searchTranslation(requested: string, bundled: readonly string[], remote: readonly string[] = []): { tr: string; fallback: boolean } {
  const isRemote = remote.includes(requested);
  const known = bundled.length ? bundled.includes(requested) : !isRemote;
  if (known && !isRemote) return { tr: requested, fallback: false };
  return { tr: FALLBACK_SEARCH_TR, fallback: true };
}

/* ------------------------------------------------------------------------ */
/* Query classification                                                      */
/* ------------------------------------------------------------------------ */

/**
 * A reference typed with an explicit chapter / verse ("Rom 8:28", "ps 23") is a request to go
 * there: no full-text search is run for it. A bare book name ("Genesis") still searches the text.
 */
export function isPassageQuery(query: string, ref: VerseRef | null): boolean {
  return Boolean(ref) && /\d/.test(query);
}

const OPERATOR_RE = /(^|\s)(OR|AND|NOT)(\s|$)|["“”„«»()|*~:]|(^|\s)[-!+]/;

/**
 * The query, cleaned, when it could name a person or place ("Abraham", "Mary Magdalene",
 * "Bethlehem"): letters, spaces, apostrophes, dots and hyphens only, no search operators, no
 * Greek / Hebrew, at least 2 letters. Otherwise null.
 */
export function nameQuery(query: string): string | null {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 40) return null;
  if (OPERATOR_RE.test(q) || hasGreek(q) || hasHebrew(q)) return null;
  if (!/^\p{L}[\p{L}\p{M}'’. -]*$/u.test(q)) return null;
  return q;
}

/** Fold for name comparisons: lower case, no accents, single spaces. */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Keep only names that start with the query or have a word starting with it (not mid-word matches). */
export function isNameMatch(name: string, query: string): boolean {
  const n = foldName(name);
  const q = foldName(query);
  return Boolean(q) && (n.startsWith(q) || n.includes(` ${q}`));
}

/**
 * Two or more plain words without operators ("in the beginning") are searched as all of the words;
 * offer the exact phrase as well.
 */
export function phraseSuggestion(query: string): SearchSuggestion | null {
  const q = query.trim().replace(/\s+/g, ' ');
  if (OPERATOR_RE.test(q) || hasGreek(q) || hasHebrew(q)) return null;
  const words = q.split(' ');
  if (words.length < 2 || words.length > 8 || !words.every((w) => /^[\p{L}'’]+$/u.test(w))) return null;
  return { query: `"${q}"`, label: `Only the exact phrase “${q}”` };
}

/* ------------------------------------------------------------------------ */
/* Recent searches (per browser)                                             */
/* ------------------------------------------------------------------------ */

const RECENT_KEY = 'recentSearches';
const RECENT_MAX = 6;

export function readRecent(): string[] {
  const v = readJson<unknown>(RECENT_KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, RECENT_MAX) : [];
}

/** Remember a query that led somewhere (most recent first, de-duplicated case-insensitively). */
export function addRecent(query: string): string[] {
  const q = query.trim();
  if (!q || q.length > 80) return readRecent();
  const list = [q, ...readRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
  writeJson(RECENT_KEY, list);
  return list;
}

export function clearRecent(): void {
  writeJson(RECENT_KEY, []);
}

/* ------------------------------------------------------------------------ */
/* Query-syntax hints                                                        */
/* ------------------------------------------------------------------------ */

export interface QueryHint {
  /** Example query (inserted when chosen). */
  q: string;
  /** What it does, in plain words. */
  label: string;
  /** Secondary example / note. */
  note?: string;
  lang?: 'grc' | 'he';
}

export const QUERY_HINTS: readonly QueryHint[] = [
  { q: 'love', label: 'A word', note: 'love~ adds every form: loved, loveth…' },
  { q: '"in the beginning"', label: 'An exact phrase, in quotes' },
  { q: 'faith OR hope', label: 'Either word' },
  { q: 'faith -works', label: 'Leave a word out with a minus' },
  { q: 'bless*', label: 'Words that start with…' },
  { q: 'G3056', label: 'A Strong’s number', note: 'H430 for Hebrew' },
  { q: 'λόγος', label: 'A Greek or Hebrew word', note: 'or greek:logos, hebrew:shalom', lang: 'grc' },
  { q: 'light in:John', label: 'One book or testament', note: 'in:NT · in:Psalms · in:Gospels' },
  { q: 'Jn 3:16', label: 'Go straight to a verse' },
];

/** Short examples for the panel footer. */
export const TRY_QUERIES: readonly { q: string; lang?: 'grc' | 'he' }[] = [
  { q: 'λόγος', lang: 'grc' },
  { q: 'H430' },
  { q: 'Jn 3:16' },
  { q: '"living water"' },
];
