// @vitest-environment node
/**
 * src/lib/offline.ts (cache names, routes, book file lists, downloads into Cache Storage) and the
 * web app manifest in vite.config.ts. Cache Storage is an in-memory fake (FakeCaches).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bookFiles,
  CACHE,
  cacheFor,
  chapterFiles,
  clearCaches,
  countCached,
  DATA_CACHES,
  dataStamp,
  DownloadAborted,
  downloadFiles,
  estimateBookBytes,
  filesToRemove,
  formatBytes,
  lexiconFiles,
  removeFiles,
  ROUTES,
  upsertSaved,
} from '../src/lib/offline';
import type { DownloadProgress, SavedBook } from '../src/lib/offline';
import { fakeCaches } from './pwa.fakes';

describe('offline: routes and cache names', () => {
  it('routes data files to their caches under any base path and ?v=', () => {
    const at = (p: string) => `https://example.github.io/bible-app/data/${p}?v=1`;
    expect(ROUTES.chapters.test(at('text/KJV/JHN/1.json'))).toBe(true);
    expect(ROUTES.chapters.test(at('orig/GEN/1.json'))).toBe(true);
    expect(ROUTES.chapters.test(at('xref/PSA/23.json'))).toBe(true);
    expect(ROUTES.chapters.test(at('names/chapters/RUT/4.json'))).toBe(true);
    expect(ROUTES.study.test(at('lex/G/030.json'))).toBe(true);
    expect(ROUTES.study.test(at('names/entities/p/006.json'))).toBe(true);
    expect(ROUTES.search.test(at('search/KJV.json'))).toBe(true);
    expect(ROUTES.meta.test('http://localhost:5173/data/meta.json')).toBe(true);
    expect(ROUTES.fonts.test('https://x.io/bible-app/assets/literata-latin-wght-normal-AbC.woff2')).toBe(true);
    // the app shell is never a data route
    expect(ROUTES.chapters.test('https://x.io/bible-app/index.html')).toBe(false);
    expect(ROUTES.study.test('https://x.io/bible-app/assets/index-abc.js')).toBe(false);
  });

  it('knows the cache of every data path (chapters before study)', () => {
    expect(cacheFor('text/KJV/JHN/1.json')).toBe(CACHE.chapters);
    expect(cacheFor('names/chapters/JHN/1.json')).toBe(CACHE.chapters);
    expect(cacheFor('names/index.json')).toBe(CACHE.study);
    expect(cacheFor('lex/index.json')).toBe(CACHE.study);
    expect(cacheFor('conc/H/072.json')).toBe(CACHE.study);
    expect(cacheFor('search/WEB.json')).toBe(CACHE.search);
    expect(cacheFor('meta.json')).toBe(CACHE.meta);
    expect(DATA_CACHES).toEqual(['rw-chapters', 'rw-study', 'rw-search']);
  });
});

describe('offline: what a book needs', () => {
  it('lists every chapter file of a book, chapter by chapter', () => {
    expect(chapterFiles('JHN', 3, ['KJV', 'BSB'])).toEqual(['text/KJV/JHN/3.json', 'text/BSB/JHN/3.json', 'orig/JHN/3.json', 'xref/JHN/3.json', 'names/chapters/JHN/3.json']);
    const files = bookFiles('JON', 4, ['KJV']);
    expect(files).toHaveLength(16);
    expect(files.slice(0, 4)).toEqual(['text/KJV/JON/1.json', 'orig/JON/1.json', 'xref/JON/1.json', 'names/chapters/JON/1.json']);
    expect(files[15]).toBe('names/chapters/JON/4.json');
  });

  it('lists the lexicon chunks from lex/index.json', () => {
    const index: [string, string, string, string][] = [
      ['G0026', 'ἀγάπη', 'agapē', 'love'],
      ['G0025', 'ἀγαπάω', 'agapaō', 'to love'],
      ['G3056', 'λόγος', 'logos', 'word'],
      ['H0871a', 'בְּ', 'be', 'in'],
      ['H7225', 'רֵאשִׁית', 'reshit', 'beginning'],
    ];
    expect(lexiconFiles(index)).toEqual(['lex/index.json', 'lex/G/000.json', 'lex/G/030.json', 'lex/H/008.json', 'lex/H/072.json']);
  });

  it('estimates sizes and formats bytes', () => {
    expect(estimateBookBytes(4, 1)).toBeGreaterThan(200_000);
    expect(estimateBookBytes(4, 5)).toBeGreaterThan(estimateBookBytes(4, 1));
    expect(estimateBookBytes(4, 1, true) - estimateBookBytes(4, 1)).toBeGreaterThan(10_000_000);
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(840_000)).toBe('840 KB');
    expect(formatBytes(1_234_567)).toBe('1.2 MB');
    expect(formatBytes(2_100_000_000)).toBe('2.1 GB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('merges saved books and removes only the files no other record needs', () => {
    const a: SavedBook = { book: 'RUT', trs: ['KJV'], chapters: 4, bytes: 100, at: '2026-10-23T00:00:00Z' };
    const b: SavedBook = { book: 'RUT', trs: ['WEB'], chapters: 4, bytes: 50, at: '2026-10-24T00:00:00Z' };
    const list = upsertSaved([a], b);
    expect(list).toHaveLength(1);
    expect(list[0].trs).toEqual(['KJV', 'WEB']);
    const jon: SavedBook = { book: 'JON', trs: ['KJV'], chapters: 4, bytes: 1, at: '' };
    expect(filesToRemove(jon, list)).toHaveLength(16);
    // a KJV record of Ruth next to a WEB one: only the KJV text goes
    const gone = filesToRemove(a, [{ ...b }]);
    expect(gone).toEqual(['text/KJV/RUT/1.json', 'text/KJV/RUT/2.json', 'text/KJV/RUT/3.json', 'text/KJV/RUT/4.json']);
  });

  it('identifies the data set by version and build date', () => {
    expect(dataStamp({ version: '1', generated: '2026-10-23' })).toBe('1|2026-10-23');
    // A content hash is the whole identity: the same data rebuilt another day keeps its stamp.
    expect(dataStamp({ version: '3f2a9c1b7d4e', generated: '2026-10-23' })).toBe('3f2a9c1b7d4e');
    expect(dataStamp({ version: '3f2a9c1b7d4e', generated: '2026-10-24' })).toBe('3f2a9c1b7d4e');
  });
});

describe('offline: downloads into Cache Storage', () => {
  const okFetch = vi.fn(async (url: string) => new Response(JSON.stringify({ url }), { status: url.includes('missing') ? 404 : 200 }));

  it('saves each file into its cache, skips files already cached under another ?v=', async () => {
    const caches = fakeCaches();
    await (await caches.open(CACHE.chapters)).put('./data/orig/JON/1.json', new Response('{}'));
    okFetch.mockClear();
    const seen: DownloadProgress[] = [];
    const res = await downloadFiles(['text/KJV/JON/1.json', 'orig/JON/1.json', 'lex/G/000.json'], {
      url: (p) => `./data/${p}?v=1`,
      caches,
      fetch: okFetch,
      concurrency: 2,
      onProgress: (p) => seen.push(p),
    });
    expect(res).toMatchObject({ done: 3, total: 3, failed: 0 });
    expect(res.bytes).toBeGreaterThan(0);
    expect(okFetch).toHaveBeenCalledTimes(2); // orig/JON/1 was cached already
    expect(await caches.peek(CACHE.chapters)).toEqual(['./data/orig/JON/1.json', './data/text/KJV/JON/1.json?v=1']);
    expect(await caches.peek(CACHE.study)).toEqual(['./data/lex/G/000.json?v=1']);
    expect(seen[0].done).toBe(0);
    expect(seen.map((p) => p.done)).toEqual([...seen.map((p) => p.done)].sort((x, y) => x - y));
    expect(await countCached(caches)).toEqual({ 'rw-chapters': 2, 'rw-study': 1 });
  });

  it('counts failures instead of throwing', async () => {
    const caches = fakeCaches();
    const res = await downloadFiles(['text/KJV/missing.json', 'xref/JON/1.json'], { caches, fetch: okFetch });
    expect(res).toMatchObject({ done: 2, failed: 1 });
    const offline = await downloadFiles(['xref/JON/2.json'], {
      caches,
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(offline.failed).toBe(1);
  });

  it('stops on cancel, keeping what was saved', async () => {
    const caches = fakeCaches();
    const ctl = new AbortController();
    const slow = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/3.json')) ctl.abort();
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response('{}');
    });
    const paths = bookFiles('PSA', 20, ['KJV']);
    await expect(downloadFiles(paths, { caches, fetch: slow, signal: ctl.signal, concurrency: 1 })).rejects.toBeInstanceOf(DownloadAborted);
    const kept = await caches.peek(CACHE.chapters);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(paths.length);
  });

  it('removes files and clears whole caches', async () => {
    const caches = fakeCaches();
    await downloadFiles(['text/KJV/RUT/1.json', 'text/KJV/RUT/2.json', 'search/KJV.json'], { caches, fetch: okFetch, url: (p) => `./data/${p}?v=1` });
    expect(await removeFiles(['text/KJV/RUT/1.json'], { caches, url: (p) => `./data/${p}` })).toBe(1);
    expect(await caches.peek(CACHE.chapters)).toEqual(['./data/text/KJV/RUT/2.json?v=1']);
    await (await caches.open('workbox-precache-v2-x')).put('index.html', new Response(''));
    expect(await clearCaches(DATA_CACHES, caches)).toEqual(['rw-chapters', 'rw-search']);
    expect(await caches.keys()).toEqual(['workbox-precache-v2-x']);
  });
});

describe('web app manifest (vite.config.ts)', () => {
  const pngSize = (file: string) => {
    const b = readFileSync(join(process.cwd(), 'public', file));
    expect(b.subarray(1, 4).toString()).toBe('PNG');
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  };

  it('describes an installable standalone app with Scholar colours', async () => {
    const { MANIFEST } = await import('../vite.config');
    expect(MANIFEST).toMatchObject({
      name: 'Rootword',
      short_name: 'Rootword',
      display: 'standalone',
      start_url: './',
      scope: './',
      theme_color: '#fafaf7',
      background_color: '#fafaf7',
    });
    expect(MANIFEST.description).toMatch(/Greek or Hebrew/);
    const icons = MANIFEST.icons ?? [];
    for (const size of ['192x192', '512x512']) {
      expect(icons.some((i) => i.sizes === size && i.purpose === 'any')).toBe(true);
      expect(icons.some((i) => i.sizes === size && i.purpose === 'maskable')).toBe(true);
    }
    for (const i of icons) {
      if (i.type === 'image/png') expect(pngSize(i.src), i.src).toBe(i.sizes);
      expect(i.src.startsWith('/'), `${i.src} must be relative (GitHub Pages subpath)`).toBe(false);
    }
    expect(pngSize('apple-touch-icon.png')).toBe('180x180');
  });
});
