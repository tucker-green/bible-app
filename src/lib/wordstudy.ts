/**
 * Word study: loading public/data/study/{G|H}/{NNN}.json (WordStudyChunk, chunked like the lexicon)
 * and small pure helpers for the word-study page — distribution by section of the canon, top forms,
 * top books, the Septuagint bridge.
 *
 * Keys follow the concordance: the base Strong's id ("H1121a" is studied as "H1121"), except Hebrew
 * prefix/suffix/article morphemes, which keep their full id ("H2050b" = "and"; its base number H2050 is
 * an unrelated verb). loadWordStudy accepts any id as found in the data and resolves it that way.
 *
 * No DOM access at import time (safe for workers / Node).
 */
import { BOOKS, getBookByNum } from './books';
import { baseStrongs, DataError, dataUrl, Lru, normalizeStrongs, strongsChunk } from './data';
import type { FetchLike } from './data';
import type { BookId, WordStudy, WordStudyChunk } from './types';

/* ------------------------------------------------------------------------ */
/* Loading                                                                   */
/* ------------------------------------------------------------------------ */

/** null = the global fetch, looked up at call time (so test stubs of globalThis.fetch work). */
let fetchImpl: FetchLike | null = null;
let cache = new Lru<string, Promise<WordStudyChunk>>(24);

/**
 * Override how word-study chunks are fetched (tests) and/or how many chunks are kept in memory.
 * The base URL and data version come from src/lib/data.ts (configureData / loadMeta). Clears the cache.
 */
export function configureWordStudy(opts: { fetch?: FetchLike | null; cacheSize?: number }): void {
  if ('fetch' in opts) fetchImpl = opts.fetch ?? null;
  cache = new Lru(opts.cacheSize ?? cache.capacity);
}

/** Forget every cached chunk. */
export function resetWordStudyCache(): void {
  cache.clear();
}

/** Path of the chunk holding a Strong's id, under the data directory: "G26" -> "study/G/000.json". null if not a Strong's id. */
export function studyChunkPath(id: string): string | null {
  const norm = normalizeStrongs(id);
  return norm ? `study/${norm[0]}/${strongsChunk(norm)}.json` : null;
}

/**
 * The chunk holding a Strong's id, cached (LRU) and de-duplicated. A missing chunk (HTTP 404) resolves
 * to {}; other failures reject with DataError and are not cached. Rejects for a non-Strong's id.
 */
export function loadWordStudyChunk(id: string): Promise<WordStudyChunk> {
  const path = studyChunkPath(id);
  if (!path) return Promise.reject(new Error(`Not a Strong's number: ${id}`));
  const url = dataUrl(path);
  const hit = cache.get(url);
  if (hit) return hit;
  const p = fetchChunk(url);
  cache.set(url, p);
  p.catch(() => {
    if (cache.get(url) === p) cache.delete(url);
  });
  return p;
}

async function fetchChunk(url: string): Promise<WordStudyChunk> {
  let res: Response;
  try {
    res = await (fetchImpl ? fetchImpl(url) : fetch(url));
  } catch (err) {
    throw Object.assign(new DataError(url, 0), { cause: err });
  }
  if (res.status === 404) return {};
  if (!res.ok) throw new DataError(url, res.status);
  return (await res.json()) as WordStudyChunk;
}

/**
 * The study for an id within its chunk: the exact id when it is a key (a Hebrew prefix/suffix morpheme
 * such as "H2050b"), otherwise its base id ("H1121a" -> "H1121", "G26" -> "G0026").
 */
export function findStudy(chunk: WordStudyChunk, id: string): WordStudy | undefined {
  const norm = normalizeStrongs(id);
  if (!norm) return undefined;
  return chunk[norm] ?? chunk[baseStrongs(norm)];
}

/** Word study for a Strong's id ("G3056", "g26", "H0871a"…); undefined when there is none. */
export async function loadWordStudy(id: string): Promise<WordStudy | undefined> {
  if (!normalizeStrongs(id)) return undefined;
  return findStudy(await loadWordStudyChunk(id), id);
}

/* ------------------------------------------------------------------------ */
/* Sections of the canon                                                     */
/* ------------------------------------------------------------------------ */

export type SectionId = 'law' | 'history' | 'wisdom' | 'prophets' | 'gospels' | 'acts' | 'paul' | 'general' | 'revelation';

export interface CanonSection {
  id: SectionId;
  name: string;
  testament: 'OT' | 'NT';
  /** First and last book numbers (1-66), inclusive. */
  first: number;
  last: number;
}

/**
 * The traditional English groupings. Hebrews is counted with the general letters (its author is
 * unnamed); the prophets include Lamentations and Daniel, as in English Bibles.
 */
export const CANON_SECTIONS: readonly CanonSection[] = [
  { id: 'law', name: 'Law', testament: 'OT', first: 1, last: 5 },
  { id: 'history', name: 'History', testament: 'OT', first: 6, last: 17 },
  { id: 'wisdom', name: 'Wisdom', testament: 'OT', first: 18, last: 22 },
  { id: 'prophets', name: 'Prophets', testament: 'OT', first: 23, last: 39 },
  { id: 'gospels', name: 'Gospels', testament: 'NT', first: 40, last: 43 },
  { id: 'acts', name: 'Acts', testament: 'NT', first: 44, last: 44 },
  { id: 'paul', name: 'Paul', testament: 'NT', first: 45, last: 57 },
  { id: 'general', name: 'General letters', testament: 'NT', first: 58, last: 65 },
  { id: 'revelation', name: 'Revelation', testament: 'NT', first: 66, last: 66 },
];

/** The section a book (number 1-66) belongs to. */
export function sectionOfBook(bookNum: number): CanonSection | undefined {
  return CANON_SECTIONS.find((s) => bookNum >= s.first && bookNum <= s.last);
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

/** 'grc' for a Greek study, 'hbo' for a Hebrew one. */
export function studyLang(study: WordStudy): 'grc' | 'hbo' {
  return study.id[0] === 'G' ? 'grc' : 'hbo';
}

/** True for a Greek word known only as the Septuagint equivalent of OT words (no occurrence in the SBLGNT). */
export function isLxxOnly(study: WordStudy): boolean {
  return study.total === 0 && !!study.lxx?.length;
}

const share = (n: number, of: number): number => (of > 0 ? n / of : 0);

export interface BookCount {
  book: BookId;
  /** 1-66. */
  num: number;
  name: string;
  short: string;
  count: number;
  /** count / study.total (0 when total is 0). */
  share: number;
}

export interface SectionCount {
  id: SectionId;
  name: string;
  testament: 'OT' | 'NT';
  /** Occurrences in the section's books. */
  total: number;
  /** total / study.total (0 when the study has no occurrences). */
  share: number;
  /** Every book of the section in canonical order (zero counts included unless hideEmpty). */
  books: BookCount[];
}

export interface DistributionOptions {
  /**
   * Which sections to return. Default: the word's own testament (NT for Greek, OT for Hebrew), plus
   * the other testament if it has any occurrences.
   */
  testament?: 'OT' | 'NT' | 'both';
  /** Drop sections and books with no occurrences. */
  hideEmpty?: boolean;
}

function bookCount(study: WordStudy, num: number): BookCount {
  const b = getBookByNum(num)!;
  const count = study.byBook[num - 1] ?? 0;
  return { book: b.id, num, name: b.name, short: b.short, count, share: share(count, study.total) };
}

/** Occurrences grouped by section of the canon (Law, History, Wisdom, Prophets; Gospels, Acts, Paul, General letters, Revelation). */
export function bookDistribution(study: WordStudy, opts: DistributionOptions = {}): SectionCount[] {
  const own = studyLang(study) === 'grc' ? 'NT' : 'OT';
  const used = { OT: false, NT: false };
  for (const b of BOOKS) if ((study.byBook[b.num - 1] ?? 0) > 0) used[b.testament] = true;
  const t = opts.testament;
  const out: SectionCount[] = [];
  for (const s of CANON_SECTIONS) {
    const wanted = t === 'both' || t === s.testament || (t === undefined && (s.testament === own || used[s.testament]));
    if (!wanted) continue;
    let books: BookCount[] = [];
    for (let n = s.first; n <= s.last; n++) books.push(bookCount(study, n));
    const total = books.reduce((sum, b) => sum + b.count, 0);
    if (opts.hideEmpty) {
      if (total === 0) continue;
      books = books.filter((b) => b.count > 0);
    }
    out.push({ id: s.id, name: s.name, testament: s.testament, total, share: share(total, study.total), books });
  }
  return out;
}

/** The n books where the word occurs most often (ties in canonical order); books with no occurrences are left out. */
export function topBooks(study: WordStudy, n = 5): BookCount[] {
  const out: BookCount[] = [];
  study.byBook.forEach((c, i) => {
    if (c > 0 && i < 66) out.push(bookCount(study, i + 1));
  });
  return out.sort((a, b) => b.count - a.count || a.num - b.num).slice(0, Math.max(0, n));
}

export interface FormCount {
  /** Surface form (Greek: normalised, lower-case unless a proper noun; Hebrew: the whole written word). */
  text: string;
  /** Morphology code(s) of the form (several only with mergeMorph). */
  morphs: string[];
  count: number;
  /** count / study.total (0 when total is 0). */
  share: number;
}

/**
 * The n most frequent inflected forms. `mergeMorph` combines rows with the same surface form and
 * different parsings (e.g. Hebrew חֶסֶד as absolute and construct) into one row listing every code.
 * Note the data keeps only the top 40 [form, morph] rows per word.
 */
export function topForms(study: WordStudy, n = 10, opts: { mergeMorph?: boolean } = {}): FormCount[] {
  const rows: FormCount[] = [];
  const byText = new Map<string, FormCount>();
  for (const [text, morph, count] of study.forms) {
    const hit = opts.mergeMorph ? byText.get(text) : undefined;
    if (hit) {
      hit.count += count;
      if (morph && !hit.morphs.includes(morph)) hit.morphs.push(morph);
      continue;
    }
    const row: FormCount = { text, morphs: morph ? [morph] : [], count, share: 0 };
    rows.push(row);
    byText.set(text, row);
  }
  for (const r of rows) r.share = share(r.count, study.total);
  // Stable sort keeps the data's tie order (form, then morph).
  return rows.sort((a, b) => b.count - a.count).slice(0, Math.max(0, n));
}

export interface LxxCount {
  /** Strong's id in the other language (Greek for a Hebrew study, Hebrew for a Greek one). */
  id: string;
  count: number;
  /** count / the sum of the listed counts (the data keeps the top 12). */
  share: number;
}

/**
 * The Septuagint bridge as rows: for a Hebrew word, the Greek words the LXX uses for it; for a Greek
 * word, the Hebrew words it renders. Most frequent first. `minShare` drops rare (often misaligned) pairs.
 */
export function lxxBridge(study: WordStudy, opts: { minShare?: number; limit?: number } = {}): LxxCount[] {
  const list = study.lxx ?? [];
  const sum = list.reduce((t, [, c]) => t + c, 0);
  return list
    .map(([id, count]) => ({ id, count, share: share(count, sum) }))
    .filter((r) => r.share >= (opts.minShare ?? 0))
    .slice(0, opts.limit ?? list.length);
}
