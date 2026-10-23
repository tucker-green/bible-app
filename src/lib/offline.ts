/**
 * Offline storage shared by the service worker config (vite.config.ts), src/pwa.ts and
 * Settings → Offline. Framework-free; nothing touches `window`, `caches` or `navigator` at import
 * time (vite.config.ts imports the cache names and URL patterns from here).
 *
 * Caches (Cache Storage, filled by the service worker's runtime routes and by "Download a book"):
 *   rw-chapters  text / orig / xref / names/chapters files     CacheFirst, ≤ 4000 entries (LRU)
 *   rw-study     lex / conc / study / names / align chunks     CacheFirst, ≤ 1500 entries (LRU)
 *   rw-search    search corpora (≈ 4 MB each)                  CacheFirst, ≤ 12 entries
 *   rw-meta      meta.json                                     NetworkFirst (fresh online, cached offline)
 *   rw-fonts     web fonts                                     CacheFirst, ≤ 80 entries
 * Data URLs carry ?v=<data version> (a content hash); the data routes match with ignoreSearch so a
 * file cached under any version string is found offline. When meta.json says the data set changed,
 * src/pwa.ts empties the data caches — before the app's first data request (src/lib/data.ts
 * gateData) — and downloads the saved books again (syncDataStamp).
 * No route has a max age: workbox's ExpirationPlugin would refuse a cached file older than that
 * (by its Date header) even while offline, and the data never goes stale under a fixed stamp.
 */
import { strongsChunk } from './data';
import type { BookId, LexIndex } from './types';

export const CACHE = {
  chapters: 'rw-chapters',
  study: 'rw-study',
  search: 'rw-search',
  meta: 'rw-meta',
  fonts: 'rw-fonts',
} as const;

/** Caches holding generated data (emptied when the data set changes, and by "Clear offline data"). */
export const DATA_CACHES: readonly string[] = [CACHE.chapters, CACHE.study, CACHE.search];

/** Every runtime cache (fonts and meta included). */
export const RUNTIME_CACHES: readonly string[] = Object.values(CACHE);

/**
 * URL patterns of the service worker's runtime routes, matched against the full request URL (works
 * under any base path: "/data/…", "/bible-app/data/…"). Order matters: chapters before study.
 */
export const ROUTES = {
  meta: /\/data\/meta\.json(?:[?#].*)?$/,
  chapters: /\/data\/(?:text|orig|xref|names\/chapters)\/[^?#]+\.json(?:[?#].*)?$/,
  study: /\/data\/(?:lex|conc|study|names|align)\/[^?#]+\.json(?:[?#].*)?$/,
  search: /\/data\/search\/[^?#]+\.json(?:[?#].*)?$/,
  fonts: /\.(?:woff2?|ttf|otf)(?:[?#].*)?$/,
} as const;

/** The cache a data path (relative to the data directory, e.g. "text/KJV/JHN/1.json") lives in. */
export function cacheFor(path: string): string | null {
  const url = `/data/${path}`;
  if (ROUTES.meta.test(url)) return CACHE.meta;
  if (ROUTES.chapters.test(url)) return CACHE.chapters;
  if (ROUTES.study.test(url)) return CACHE.study;
  if (ROUTES.search.test(url)) return CACHE.search;
  return null;
}

/* ------------------------------------------------------------------------ */
/* Books for offline reading                                                 */
/* ------------------------------------------------------------------------ */

/** Data files a chapter needs on screen: each translation's text, the original words, cross references, names. */
export function chapterFiles(book: BookId, chapter: number, trs: readonly string[]): string[] {
  return [
    ...trs.map((tr) => `text/${tr}/${book}/${chapter}.json`),
    `orig/${book}/${chapter}.json`,
    `xref/${book}/${chapter}.json`,
    `names/chapters/${book}/${chapter}.json`,
  ];
}

/** Every chapter file of a book (chapter by chapter, so a cancelled download keeps whole chapters). */
export function bookFiles(book: BookId, chapters: number, trs: readonly string[]): string[] {
  const out: string[] = [];
  for (let c = 1; c <= chapters; c++) out.push(...chapterFiles(book, c, trs));
  return out;
}

/** The lexicon chunk files ("lex/G/000.json" …) covering every id in lex/index.json. */
export function lexiconFiles(index: LexIndex): string[] {
  const set = new Set<string>();
  for (const [id] of index) if (/^[GH]\d/.test(id)) set.add(`lex/${id[0]}/${strongsChunk(id)}.json`);
  return ['lex/index.json', ...[...set].sort()];
}

/** Approximate size of every lexicon chunk + lex/index.json (the word dictionary). */
export const LEXICON_BYTES = 11_700_000;

/** Rough download size of a book in bytes (averages over the bundled data), for the button hint. */
export function estimateBookBytes(chapters: number, translations: number, withLexicon = false): number {
  const perChapter = translations * 15_500 + 42_000 + 7_000 + 4_000;
  return chapters * perChapter + (withLexicon ? LEXICON_BYTES : 0);
}

/** "840 KB", "1.2 MB", "2.1 GB" (decimal units, like the browser's storage settings). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = -1;
  do {
    v /= 1000;
    u++;
  } while (v >= 1000 && u < units.length - 1);
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/* ------------------------------------------------------------------------ */
/* Saved books (localStorage "rootword:offline")                              */
/* ------------------------------------------------------------------------ */

export interface SavedBook {
  book: BookId;
  /** Translation ids whose text was saved. */
  trs: string[];
  chapters: number;
  /** Bytes downloaded (0 when every file was already cached). */
  bytes: number;
  /** ISO time of the download. */
  at: string;
}

/** Add or replace a saved book (one record per book; translations merge). */
export function upsertSaved(list: readonly SavedBook[], rec: SavedBook): SavedBook[] {
  const old = list.find((s) => s.book === rec.book);
  const merged: SavedBook = old ? { ...rec, trs: [...new Set([...old.trs, ...rec.trs])], bytes: Math.max(old.bytes, rec.bytes) } : rec;
  return [...list.filter((s) => s.book !== rec.book), merged];
}

/** The files that only `rec` needs (safe to delete when it is removed). */
export function filesToRemove(rec: SavedBook, others: readonly SavedBook[]): string[] {
  const keep = new Set<string>();
  for (const o of others) if (o.book === rec.book) for (const f of bookFiles(o.book, o.chapters, o.trs)) keep.add(f);
  return bookFiles(rec.book, rec.chapters, rec.trs).filter((f) => !keep.has(f));
}

/**
 * Data set identity from meta.json: its `version`, a content hash that changes exactly when the data
 * does (scripts/data/meta.ts), so a rebuild with new content refreshes the caches even on the same
 * day, and an identical rebuild on a later day does not. Older data sets (a short version number) fall
 * back to version + build date.
 */
export const dataStamp = (meta: { version: string; generated: string }): string =>
  /^[0-9a-f]{8,}$/.test(meta.version) ? meta.version : `${meta.version}|${meta.generated}`;

/* ------------------------------------------------------------------------ */
/* Cache Storage operations                                                  */
/* ------------------------------------------------------------------------ */

export interface DownloadProgress {
  done: number;
  total: number;
  failed: number;
  /** Bytes fetched over the network (cached files count 0). */
  bytes: number;
  /** Of `bytes`, those of the book itself (a book download that also saved the dictionary). */
  bookBytes?: number;
}

export interface DownloadOptions {
  /** URL of a data path (default: the path itself). Use src/lib/data.ts dataUrl so the app finds it. */
  url?: (path: string) => string;
  signal?: AbortSignal;
  /** Parallel requests (default 6). */
  concurrency?: number;
  onProgress?: (p: DownloadProgress) => void;
  /** Injected for tests. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  caches?: CacheStorage;
}

export class DownloadAborted extends Error {
  constructor() {
    super('Download cancelled');
    this.name = 'AbortError';
  }
}

/**
 * Put every data path into its runtime cache (skipping files already cached under any ?v=).
 * Resolves with the final progress; failed files are counted, not thrown. Rejects with
 * DownloadAborted when `signal` aborts (files already saved stay saved).
 */
export async function downloadFiles(paths: readonly string[], opts: DownloadOptions = {}): Promise<DownloadProgress> {
  const cs = opts.caches ?? globalThis.caches;
  const doFetch = opts.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const toUrl = opts.url ?? ((p: string) => p);
  const progress: DownloadProgress = { done: 0, total: paths.length, failed: 0, bytes: 0 };
  const open = new Map<string, Promise<Cache>>();
  const cacheOf = (name: string) => {
    let c = open.get(name);
    if (!c) open.set(name, (c = cs.open(name)));
    return c;
  };
  let next = 0;
  const report = () => opts.onProgress?.({ ...progress });
  const worker = async () => {
    while (next < paths.length) {
      if (opts.signal?.aborted) return;
      const path = paths[next++];
      const name = cacheFor(path) ?? CACHE.chapters;
      const url = toUrl(path);
      try {
        const cache = await cacheOf(name);
        if (!(await cache.match(url, { ignoreSearch: true }))) {
          const res = await doFetch(url, { signal: opts.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.clone().arrayBuffer();
          await cache.put(url, res);
          progress.bytes += body.byteLength;
        }
      } catch {
        if (opts.signal?.aborted) return;
        progress.failed++;
      }
      progress.done++;
      report();
    }
  };
  report();
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 6) }, worker));
  if (opts.signal?.aborted) throw new DownloadAborted();
  return progress;
}

/** Delete data paths from their caches (any ?v=). Returns how many entries were removed. */
export async function removeFiles(paths: readonly string[], opts: { url?: (path: string) => string; caches?: CacheStorage } = {}): Promise<number> {
  const cs = opts.caches ?? globalThis.caches;
  const toUrl = opts.url ?? ((p: string) => p);
  let n = 0;
  const open = new Map<string, Cache>();
  for (const path of paths) {
    const name = cacheFor(path) ?? CACHE.chapters;
    let cache = open.get(name);
    if (!cache) open.set(name, (cache = await cs.open(name)));
    if (await cache.delete(toUrl(path), { ignoreSearch: true })) n++;
  }
  return n;
}

/** Delete whole caches (default: the data caches). Returns the names that existed. */
export async function clearCaches(names: readonly string[] = DATA_CACHES, cs: CacheStorage = globalThis.caches): Promise<string[]> {
  const out: string[] = [];
  for (const name of names) if (await cs.delete(name)) out.push(name);
  return out;
}

/** Number of entries in each runtime cache that exists. */
export async function countCached(cs: CacheStorage = globalThis.caches): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const have = new Set(await cs.keys());
  for (const name of RUNTIME_CACHES) {
    if (!have.has(name)) continue;
    out[name] = (await (await cs.open(name)).keys()).length;
  }
  return out;
}
