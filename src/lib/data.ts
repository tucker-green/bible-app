/**
 * Cached, de-duplicated loaders for everything under public/data/ (see src/lib/types.ts), plus
 * small helpers for reading OrigWord tuples and following token links.
 *
 * - Every loader returns a promise; concurrent calls for the same file share one request.
 * - Chapters, lexicon chunks and concordance chunks live in small LRU caches so memory stays
 *   bounded during long reading sessions. Failed requests are not cached.
 * - URLs are relative to Vite's BASE_URL (`./data/...` with base './'); use dataBaseUrl(true)
 *   for an absolute URL to hand to a Web Worker.
 * - configureData({ fetch }) swaps in a mock fetch for tests.
 *
 * No DOM access at import time (safe for workers / Node).
 */
import { getBook, getBookByNum } from './books';
import type {
  BookId,
  ConcChunk,
  DataMeta,
  LexChunk,
  LexEntry,
  LexIndex,
  OrigChapter,
  OrigWord,
  SearchCorpus,
  TextChapter,
  Token,
  WordToken,
} from './types';
import { OW } from './types';

/* ------------------------------------------------------------------------ */
/* Configuration                                                             */
/* ------------------------------------------------------------------------ */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface DataConfig {
  /** Base URL of the data directory, ending in "/". Default: `${import.meta.env.BASE_URL}data/`. */
  base: string;
  fetch: FetchLike;
  /** Max chapters (per kind: text, orig) kept in memory. */
  chapterCacheSize: number;
  /** Max lexicon / concordance chunks kept in memory. */
  chunkCacheSize: number;
}

function defaultBase(): string {
  // import.meta.env is provided by Vite / Vitest; absent under plain Node (tsx).
  const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;
  const base = env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}data/`;
}

const config: DataConfig = {
  base: defaultBase(),
  fetch: (url, init) => fetch(url, init),
  chapterCacheSize: 40,
  chunkCacheSize: 48,
};

/** Data version from meta.json, appended as ?v= to later requests to bust HTTP caches. */
let dataVersion = '';

/** Override configuration (tests, or hosting the data elsewhere). Clears all caches. */
export function configureData(opts: Partial<DataConfig>): void {
  Object.assign(config, opts);
  if (opts.base && !config.base.endsWith('/')) config.base += '/';
  resetDataCache();
}

/** Drop every cached file (e.g. after the data version changes). */
export function resetDataCache(): void {
  metaPromise = null;
  lexIndexPromise = null;
  corpusCache.clear();
  textCache = new Lru(config.chapterCacheSize);
  origCache = new Lru(config.chapterCacheSize);
  lexCache = new Lru(config.chunkCacheSize);
  concCache = new Lru(config.chunkCacheSize);
  dataVersion = '';
}

/**
 * The data directory URL. Relative by default (as configured); `absolute` resolves it against
 * document.baseURI (or self.location in a worker) — Workers resolve relative URLs against their
 * own script, so always pass them an absolute base.
 */
export function dataBaseUrl(absolute = false): string {
  if (!absolute) return config.base;
  const g = globalThis as { document?: { baseURI: string }; location?: { href: string } };
  const from = g.document?.baseURI ?? g.location?.href;
  return from ? new URL(config.base, from).href : config.base;
}

/** Full URL of a file under the data directory. */
export function dataUrl(path: string): string {
  return config.base + path + (dataVersion ? `?v=${encodeURIComponent(dataVersion)}` : '');
}

export class DataError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`Failed to load ${url}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'DataError';
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = dataUrl(path);
  let res: Response;
  try {
    res = await config.fetch(url);
  } catch (err) {
    throw Object.assign(new DataError(url, 0), { cause: err });
  }
  if (!res.ok) throw new DataError(url, res.status);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------------ */
/* LRU                                                                       */
/* ------------------------------------------------------------------------ */

/** Minimal LRU map: get() refreshes recency; set() evicts the least recently used entries. */
export class Lru<K, V> {
  private map = new Map<K, V>();
  constructor(readonly capacity: number) {}
  get size(): number {
    return this.map.size;
  }
  has(key: K): boolean {
    return this.map.has(key);
  }
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }
  delete(key: K): boolean {
    return this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  keys(): K[] {
    return [...this.map.keys()];
  }
}

/** Cache a promise; forget it if it rejects so a later call can retry. */
function cached<T>(cache: Lru<string, Promise<unknown>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = load();
  cache.set(key, p);
  p.catch(() => {
    if (cache.get(key) === p) cache.delete(key);
  });
  return p;
}

let metaPromise: Promise<DataMeta> | null = null;
let lexIndexPromise: Promise<LexIndex> | null = null;
const corpusCache = new Lru<string, Promise<SearchCorpus>>(1);
let textCache = new Lru<string, Promise<unknown>>(config.chapterCacheSize);
let origCache = new Lru<string, Promise<unknown>>(config.chapterCacheSize);
let lexCache = new Lru<string, Promise<unknown>>(config.chunkCacheSize);
let concCache = new Lru<string, Promise<unknown>>(config.chunkCacheSize);

/* ------------------------------------------------------------------------ */
/* Loaders                                                                   */
/* ------------------------------------------------------------------------ */

/** public/data/meta.json (loaded once). */
export function loadMeta(): Promise<DataMeta> {
  if (!metaPromise) {
    const p = fetchJson<DataMeta>('meta.json').then((m) => {
      if (m.version) dataVersion = m.version;
      return m;
    });
    metaPromise = p;
    p.catch(() => {
      if (metaPromise === p) metaPromise = null;
    });
  }
  return metaPromise;
}

/** A runtime source of chapters for a translation that is not bundled (e.g. NIV via API.Bible). */
export type TextSource = (book: BookId, chapter: number) => Promise<TextChapter>;
const textSources = new Map<string, TextSource>();

/** Route loadText(tr, …) for `tr` to a runtime source instead of public/data/text/. */
export function registerTextSource(tr: string, source: TextSource): void {
  textSources.set(tr, source);
  for (const k of textCache.keys()) if (k.startsWith(`${tr}/`)) textCache.delete(k);
}

export function unregisterTextSource(tr: string): void {
  textSources.delete(tr);
  for (const k of textCache.keys()) if (k.startsWith(`${tr}/`)) textCache.delete(k);
}

export function hasTextSource(tr: string): boolean {
  return textSources.has(tr);
}

/** public/data/text/{TR}/{BOOK}/{CHAPTER}.json, or a registered runtime source. */
export function loadText(tr: string, book: BookId, chapter: number): Promise<TextChapter> {
  const key = `${tr}/${book}/${chapter}`;
  return cached(textCache, key, () => {
    const source = textSources.get(tr);
    return source ? source(book, chapter) : fetchJson<TextChapter>(`text/${tr}/${book}/${chapter}.json`);
  });
}

/** public/data/orig/{BOOK}/{CHAPTER}.json */
export function loadOrig(book: BookId, chapter: number): Promise<OrigChapter> {
  return cached(origCache, `${book}/${chapter}`, () => fetchJson<OrigChapter>(`orig/${book}/${chapter}.json`));
}

/** Both files a reading view needs, in parallel. */
export async function loadChapter(
  tr: string,
  book: BookId,
  chapter: number,
): Promise<{ text: TextChapter; orig: OrigChapter | null }> {
  const [text, orig] = await Promise.all([
    loadText(tr, book, chapter),
    loadOrig(book, chapter).catch(() => null), // reading still works without the original-language layer
  ]);
  return { text, orig };
}

/**
 * Warm the caches for a chapter (and, by default, the next one) without waiting. Errors are
 * swallowed — prefetching must never surface failures.
 */
export function prefetchChapter(tr: string, book: BookId, chapter: number, opts: { next?: boolean } = {}): void {
  const targets: [BookId, number][] = [[book, chapter]];
  if (opts.next !== false) {
    const n = nextChapter(book, chapter);
    if (n) targets.push(n);
  }
  for (const [b, c] of targets) {
    loadText(tr, b, c).catch(() => undefined);
    loadOrig(b, c).catch(() => undefined);
  }
}

/** The chapter after (book, chapter) in canonical order, or null after Revelation 22. */
export function nextChapter(book: BookId, chapter: number): [BookId, number] | null {
  const b = getBook(book);
  if (!b) return null;
  if (chapter < b.chapters) return [b.id, chapter + 1];
  const nb = getBookByNum(b.num + 1);
  return nb ? [nb.id, 1] : null;
}

/** The chapter before (book, chapter), or null before Genesis 1. */
export function prevChapter(book: BookId, chapter: number): [BookId, number] | null {
  const b = getBook(book);
  if (!b) return null;
  if (chapter > 1) return [b.id, chapter - 1];
  const pb = getBookByNum(b.num - 1);
  return pb ? [pb.id, pb.chapters] : null;
}

/** One lexicon chunk: lex/{G|H}/{NNN}.json. */
export function loadLexChunk(id: string): Promise<LexChunk> {
  const norm = normalizeStrongs(id);
  if (!norm) return Promise.reject(new Error(`Not a Strong's number: ${id}`));
  const path = `lex/${norm[0]}/${strongsChunk(norm)}.json`;
  return cached(lexCache, path, () => fetchJson<LexChunk>(path));
}

/**
 * Lexicon entry for a Strong's id ("G26", "G0026", "H0871a"...). Extended ids fall back to their
 * base entry. Resolves undefined when there is no entry (or no such chunk).
 */
export async function loadLexEntry(id: string): Promise<LexEntry | undefined> {
  const norm = normalizeStrongs(id);
  if (!norm) return undefined;
  let chunk: LexChunk;
  try {
    chunk = await loadLexChunk(norm);
  } catch (err) {
    if (err instanceof DataError && err.status === 404) return undefined;
    throw err;
  }
  return chunk[norm] ?? chunk[baseStrongs(norm)];
}

/** public/data/lex/index.json (loaded once; ~0.7 MB). */
export function loadLexIndex(): Promise<LexIndex> {
  if (!lexIndexPromise) {
    const p = fetchJson<LexIndex>('lex/index.json');
    lexIndexPromise = p;
    p.catch(() => {
      if (lexIndexPromise === p) lexIndexPromise = null;
    });
  }
  return lexIndexPromise;
}

/** Concordance chunk: conc/{G|H}/{NNN}.json. */
export function loadConcChunk(id: string): Promise<ConcChunk> {
  const norm = normalizeStrongs(id);
  if (!norm) return Promise.reject(new Error(`Not a Strong's number: ${id}`));
  const path = `conc/${norm[0]}/${strongsChunk(norm)}.json`;
  return cached(concCache, path, () => fetchJson<ConcChunk>(path));
}

/**
 * Every verse (packed: bookNum*1e6 + chapter*1e3 + verse, see unpackRef) where a Strong's
 * number occurs, sorted. Extended ids use their base number. [] when unknown.
 */
export async function loadConcordance(id: string): Promise<number[]> {
  const norm = normalizeStrongs(id);
  if (!norm) return [];
  let chunk: ConcChunk;
  try {
    chunk = await loadConcChunk(norm);
  } catch (err) {
    if (err instanceof DataError && err.status === 404) return [];
    throw err;
  }
  return chunk[baseStrongs(norm)] ?? [];
}

/** public/data/search/{TR}.json (only the most recent corpus is kept; the search worker normally loads these itself). */
export function loadSearchCorpus(tr: string): Promise<SearchCorpus> {
  const hit = corpusCache.get(tr);
  if (hit) return hit;
  const p = fetchJson<SearchCorpus>(`search/${tr}.json`);
  corpusCache.set(tr, p);
  p.catch(() => corpusCache.delete(tr));
  return p;
}

/* ------------------------------------------------------------------------ */
/* Strong's numbers                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Normalise user / data input to the canonical id: "G26" -> "G0026", "g0026" -> "G0026",
 * "strongs:H430" -> "H0430", "H0871a" -> "H0871a", "H7225G" -> "H7225G". null if not a Strong's id.
 */
export function normalizeStrongs(input: string): string | null {
  const m = /^(?:strongs?:)?\s*([GH])0*(\d{1,4})([a-zA-Z]?)$/i.exec(input.trim());
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2].padStart(4, '0')}${m[3]}`;
}

/** "H0871a" -> "H0871". */
export function baseStrongs(id: string): string {
  return id.replace(/^([GH]\d{4}).*$/, '$1');
}

/** Lexicon / concordance chunk name: "G0026" -> "000", "H7225" -> "072". */
export function strongsChunk(id: string): string {
  return String(Math.floor(Number(id.slice(1, 5)) / 100)).padStart(3, '0');
}

/** 'grc' for G numbers, 'hbo' for H numbers. */
export function strongsLang(id: string): 'grc' | 'hbo' {
  return id[0].toUpperCase() === 'G' ? 'grc' : 'hbo';
}

/* ------------------------------------------------------------------------ */
/* Original-language words                                                   */
/* ------------------------------------------------------------------------ */

/** Field accessors for OrigWord tuples: ow.text(w), ow.strongs(w)... */
export const ow = {
  text: (w: OrigWord): string => w[OW.text],
  strongs: (w: OrigWord): string => w[OW.strongs],
  lemma: (w: OrigWord): string => w[OW.lemma],
  morph: (w: OrigWord): string => w[OW.morph],
  gloss: (w: OrigWord): string => w[OW.gloss],
  verse: (w: OrigWord): number => w[OW.verse],
  ref: (w: OrigWord): string => w[OW.ref],
  group: (w: OrigWord): number => w[OW.group],
  translit: (w: OrigWord): string => w[OW.translit],
  lxx: (w: OrigWord): string => w[OW.lxx],
};

/** A friendly view of one OrigWord. */
export interface Word {
  /** Index in OrigChapter.words. */
  index: number;
  text: string;
  /** Normalised Strong's id or "". */
  strongs: string;
  lemma: string;
  morph: string;
  gloss: string;
  /** English verse this word is translated in (0 = Psalm title). */
  verse: number;
  /** Source reference when it differs from the English one, e.g. "3:19". */
  ref: string;
  /** Index of the first morpheme of the same written word. */
  group: number;
  translit: string;
  /** Septuagint-equivalent Greek word for OT words. */
  lxx: { text: string; strongs: string } | null;
  lang: 'grc' | 'hbo' | 'arc';
}

const aramaicSets = new WeakMap<OrigChapter, Set<number>>();

/** True if word `index` of the chapter is Aramaic. */
export function isAramaic(ch: OrigChapter, index: number): boolean {
  if (!ch.aramaic?.length) return false;
  let set = aramaicSets.get(ch);
  if (!set) {
    set = new Set(ch.aramaic);
    aramaicSets.set(ch, set);
  }
  return set.has(index);
}

/** "ἐποίησεν|G4160" -> { text: "ἐποίησεν", strongs: "G4160" }; "" -> null. */
export function parseLxx(lxx: string): { text: string; strongs: string } | null {
  if (!lxx) return null;
  const [text, strongs = ''] = lxx.split('|');
  return text ? { text, strongs } : null;
}

/** Convert word `index` of a chapter to a friendly object (undefined if out of range). */
export function toWord(ch: OrigChapter, index: number): Word | undefined {
  const w = ch.words[index];
  if (!w) return undefined;
  return {
    index,
    text: w[OW.text],
    strongs: w[OW.strongs],
    lemma: w[OW.lemma],
    morph: w[OW.morph],
    gloss: w[OW.gloss],
    verse: w[OW.verse],
    ref: w[OW.ref],
    group: w[OW.group],
    translit: w[OW.translit],
    lxx: parseLxx(w[OW.lxx]),
    lang: ch.lang === 'grc' ? 'grc' : isAramaic(ch, index) ? 'arc' : 'hbo',
  };
}

/** Indices of every morpheme of the written word containing `index` (Greek: just [index]). */
export function wordGroup(ch: OrigChapter, index: number): number[] {
  const w = ch.words[index];
  if (!w) return [];
  const g = w[OW.group];
  const out: number[] = [];
  // Morphemes of a word are contiguous and start at `group`.
  for (let i = g; i < ch.words.length && ch.words[i][OW.group] === g; i++) out.push(i);
  if (!out.includes(index)) out.push(index);
  return out;
}

/** Indices of the original words translated in English verse `verse`. */
export function verseWordIndices(ch: OrigChapter, verse: number): number[] {
  const out: number[] = [];
  ch.words.forEach((w, i) => {
    if (w[OW.verse] === verse) out.push(i);
  });
  return out;
}

/** New Testament book? Accepts a USFM id or a book number. */
export function isNT(book: BookId | number): boolean {
  const b = typeof book === 'number' ? getBookByNum(book) : getBook(book);
  return b?.testament === 'NT';
}

/** Original language of a book: Greek for the NT, Hebrew for the OT. */
export function origLang(book: BookId | number): 'grc' | 'hbo' {
  return isNT(book) ? 'grc' : 'hbo';
}

/* ------------------------------------------------------------------------ */
/* Tokens                                                                    */
/* ------------------------------------------------------------------------ */

export function isWordToken(t: Token): t is WordToken {
  return typeof t !== 'string';
}

/** Text of any token. */
export function tokenText(t: Token): string {
  return typeof t === 'string' ? t : t[0];
}

/** Plain text of a verse / superscription. */
export function tokensToText(tokens: Token[]): string {
  return tokens.map(tokenText).join('');
}

/** Position of a token: verse number (0 = superscription) and index in that verse's `t`. */
export interface TokenPos {
  verse: number;
  token: number;
}

const linkIndexes = new WeakMap<TextChapter, Map<number, TokenPos[]>>();

/** Map from orig-word index to every token linked to it (built once per chapter object). */
export function linkIndex(text: TextChapter): Map<number, TokenPos[]> {
  let idx = linkIndexes.get(text);
  if (idx) return idx;
  idx = new Map();
  const add = (tokens: Token[], verse: number) => {
    tokens.forEach((t, i) => {
      if (typeof t === 'string') return;
      for (const l of t[1]) {
        let list = idx!.get(l);
        if (!list) idx!.set(l, (list = []));
        list.push({ verse, token: i });
      }
    });
  };
  if (text.superscription) add(text.superscription, 0);
  for (const v of text.verses) add(v.t, v.v);
  linkIndexes.set(text, idx);
  return idx;
}

/** Every English token linked to original word `origIndex` (e.g. to highlight all of them on hover). */
export function tokensLinkedTo(text: TextChapter, origIndex: number): TokenPos[] {
  return linkIndex(text).get(origIndex) ?? [];
}

/**
 * Every English token that shares at least one original word with the given token — the "same
 * word" group to highlight together ("In the beginning" all point at בְּרֵאשִׁית).
 */
export function relatedTokens(text: TextChapter, token: WordToken): TokenPos[] {
  const seen = new Set<string>();
  const out: TokenPos[] = [];
  for (const l of token[1]) {
    for (const p of tokensLinkedTo(text, l)) {
      const k = `${p.verse}:${p.token}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    }
  }
  return out;
}

/** The token at a position, or undefined. */
export function tokenAt(text: TextChapter, pos: TokenPos): Token | undefined {
  if (pos.verse === 0) return text.superscription?.[pos.token];
  return text.verses.find((v) => v.v === pos.verse)?.t[pos.token];
}
