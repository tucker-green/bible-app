import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseStrongs,
  configureData,
  dataBaseUrl,
  DataError,
  isAramaic,
  isNT,
  loadChapter,
  loadConcordance,
  loadLexEntry,
  loadLexIndex,
  loadMeta,
  loadOrig,
  loadText,
  Lru,
  nextChapter,
  normalizeStrongs,
  origLang,
  ow,
  parseLxx,
  prefetchChapter,
  prevChapter,
  registerTextSource,
  relatedTokens,
  strongsChunk,
  tokenAt,
  tokensLinkedTo,
  tokensToText,
  toWord,
  unregisterTextSource,
  verseWordIndices,
  wordGroup,
} from '../src/lib/data';
import type { LexChunk, OrigChapter, TextChapter, WordToken } from '../src/lib/types';

const GEN1: OrigChapter = {
  book: 'GEN',
  chapter: 1,
  lang: 'hbo',
  edition: 'WLC',
  words: [
    ['בְּ', 'H0871a', 'בְּ', 'R', 'in', 1, '', 0, 'bə', 'ἐν|G1722'],
    ['רֵאשִׁית', 'H7225', 'רֵאשִׁית', 'Ncfsa', 'beginning', 1, '', 0, 'rēʾšiyṯ', 'ἀρχῇ|G0746'],
    ['בָּרָא', 'H1254', 'בָּרָא', 'Vqp3ms', 'created', 1, '', 2, 'bārāʾ', 'ἐποίησεν|G4160'],
    ['אֱלֹהִים', 'H0430', 'אֱלֹהִים', 'Ncmpa', 'God', 1, '', 3, 'ʾĕlōhiym', 'θεὸς|G2316'],
    ['וְ', 'H2050b', 'וְ', 'C', 'and', 2, '', 4, 'wə', ''],
  ],
  aramaic: [3],
};

const GEN1_BSB: TextChapter = {
  tr: 'BSB',
  book: 'GEN',
  chapter: 1,
  verses: [
    { v: 1, t: [['In', [0, 1]], ' ', ['the', [1]], ' ', ['beginning', [1]], ' ', ['God', [3]], ' ', ['created', [2]], '.'] },
    { v: 2, t: [['And', [4]], ' the earth…'] },
  ],
};

const LEX_H008: LexChunk = {
  H0871: { id: 'H0871', lemma: 'בְּ', translit: 'be', pos: 'Preposition', gloss: 'in', def: 'in' },
  H0871a: { id: 'H0871a', lemma: 'בְּ', translit: 'be', pos: 'Preposition', gloss: 'in, with, by', def: 'in, with, by' },
  H0872: { id: 'H0872', lemma: 'בִּאָה', translit: 'bi.ah', pos: 'Noun', gloss: 'entrance', def: 'entrance' },
};

function mockFetch(files: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
    if (!(path in files)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(files[path]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

let fetchMock: ReturnType<typeof mockFetch>;

beforeEach(() => {
  fetchMock = mockFetch({
    'meta.json': { version: '7', generated: '2026-10-23', translations: [], books: [], credits: [] },
    'text/BSB/GEN/1.json': GEN1_BSB,
    'orig/GEN/1.json': GEN1,
    'orig/GEN/2.json': { ...GEN1, chapter: 2 },
    'text/BSB/GEN/2.json': { ...GEN1_BSB, chapter: 2 },
    'lex/H/008.json': LEX_H008,
    'lex/index.json': [['G0026', 'ἀγάπη', 'agapē', 'love']],
    'conc/G/000.json': { G0026: [40005044, 43013035] },
    'conc/H/008.json': { H0871: [1001001, 1001002] },
  });
  configureData({ base: '/data/', fetch: fetchMock });
});

describe('loaders', () => {
  it('loads and caches meta, then appends the version to later URLs', async () => {
    const [a, b] = await Promise.all([loadMeta(), loadMeta()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await loadOrig('GEN', 1);
    expect(fetchMock.mock.calls[1][0]).toBe('/data/orig/GEN/1.json?v=7');
  });

  it('de-duplicates concurrent chapter requests and caches results', async () => {
    const [x, y] = await Promise.all([loadText('BSB', 'GEN', 1), loadText('BSB', 'GEN', 1)]);
    expect(x).toBe(y);
    expect(await loadText('BSB', 'GEN', 1)).toBe(x);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/data/text/BSB/GEN/1.json');
  });

  it('loadChapter returns text and orig together; a missing orig layer is null', async () => {
    const { text, orig } = await loadChapter('BSB', 'GEN', 1);
    expect(text.verses).toHaveLength(2);
    expect(orig?.words).toHaveLength(5);
    fetchMock = mockFetch({ 'text/BSB/GEN/1.json': GEN1_BSB });
    configureData({ fetch: fetchMock });
    expect((await loadChapter('BSB', 'GEN', 1)).orig).toBeNull();
  });

  it('rejects with DataError on HTTP errors and does not cache failures', async () => {
    await expect(loadText('BSB', 'EXO', 1)).rejects.toBeInstanceOf(DataError);
    await expect(loadText('BSB', 'EXO', 1)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('wraps network failures', async () => {
    configureData({ fetch: vi.fn(async () => Promise.reject(new TypeError('offline'))) });
    await expect(loadMeta()).rejects.toMatchObject({ name: 'DataError', status: 0 });
  });

  it('loads lexicon entries by chunk with extended -> base fallback', async () => {
    expect((await loadLexEntry('H871a'))?.gloss).toBe('in, with, by');
    expect((await loadLexEntry('H0871b'))?.gloss).toBe('in'); // no H0871b: base entry
    expect((await loadLexEntry('strongs:H872'))?.gloss).toBe('entrance');
    expect(await loadLexEntry('H0899')).toBeUndefined();
    expect(await loadLexEntry('G9999')).toBeUndefined(); // chunk 404 -> undefined
    expect(await loadLexEntry('nonsense')).toBeUndefined();
    // one request for the H/008 chunk, one for G/099
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/data/lex/H/008.json', '/data/lex/G/099.json']);
  });

  it('loads the lexicon index once', async () => {
    const [a, b] = await Promise.all([loadLexIndex(), loadLexIndex()]);
    expect(a).toBe(b);
    expect(a[0][1]).toBe('ἀγάπη');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads concordance lists by base id', async () => {
    expect(await loadConcordance('G26')).toEqual([40005044, 43013035]);
    expect(await loadConcordance('H0871a')).toEqual([1001001, 1001002]);
    expect(await loadConcordance('G0027')).toEqual([]);
    expect(await loadConcordance('H9999')).toEqual([]);
  });

  it('prefetches a chapter and the next one, swallowing errors', async () => {
    prefetchChapter('BSB', 'GEN', 1);
    prefetchChapter('BSB', 'REV', 22); // 404s, must not throw
    await new Promise((r) => setTimeout(r, 0));
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(
      expect.arrayContaining(['/data/text/BSB/GEN/1.json', '/data/orig/GEN/1.json', '/data/text/BSB/GEN/2.json', '/data/orig/GEN/2.json']),
    );
    await loadOrig('GEN', 2);
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/data/orig/GEN/2.json')).toHaveLength(1);
  });

  it('keeps the chapter cache bounded', async () => {
    const files: Record<string, unknown> = {};
    for (let c = 1; c <= 5; c++) files[`orig/GEN/${c}.json`] = { ...GEN1, chapter: c };
    fetchMock = mockFetch(files);
    configureData({ fetch: fetchMock, chapterCacheSize: 2 });
    for (let c = 1; c <= 5; c++) await loadOrig('GEN', c);
    await loadOrig('GEN', 5); // cached
    await loadOrig('GEN', 1); // evicted -> refetched
    expect(fetchMock).toHaveBeenCalledTimes(6);
    configureData({ chapterCacheSize: 40 });
  });

  it('routes registered runtime translations to their source', async () => {
    const source = vi.fn(async (book: string, chapter: number): Promise<TextChapter> => ({ tr: 'NIV', book, chapter, verses: [] }));
    registerTextSource('NIV', source);
    const ch = await loadText('NIV', 'JHN', 3);
    expect(ch.tr).toBe('NIV');
    expect(source).toHaveBeenCalledWith('JHN', 3);
    expect(fetchMock).not.toHaveBeenCalled();
    unregisterTextSource('NIV');
    await expect(loadText('NIV', 'JHN', 3)).rejects.toBeInstanceOf(DataError);
  });

  it('builds an absolute base URL for workers', () => {
    configureData({ base: './data/' });
    const abs = dataBaseUrl(true);
    expect(abs).toMatch(/^https?:\/\/.+\/data\/$/);
    expect(dataBaseUrl()).toBe('./data/');
  });
});

describe('Strong’s helpers', () => {
  it('normalises ids', () => {
    expect(normalizeStrongs('G26')).toBe('G0026');
    expect(normalizeStrongs('g0026')).toBe('G0026');
    expect(normalizeStrongs('strongs:H430')).toBe('H0430');
    expect(normalizeStrongs('H0871a')).toBe('H0871a');
    expect(normalizeStrongs('H7225G')).toBe('H7225G');
    expect(normalizeStrongs('G12345')).toBeNull();
    expect(normalizeStrongs('love')).toBeNull();
    expect(baseStrongs('H0871a')).toBe('H0871');
    expect(strongsChunk('G0026')).toBe('000');
    expect(strongsChunk('H7225')).toBe('072');
  });
});

describe('word helpers', () => {
  it('reads tuples', () => {
    const w = GEN1.words[2];
    expect(ow.text(w)).toBe('בָּרָא');
    expect(ow.strongs(w)).toBe('H1254');
    expect(ow.morph(w)).toBe('Vqp3ms');
    expect(ow.verse(w)).toBe(1);
    expect(parseLxx(ow.lxx(w))).toEqual({ text: 'ἐποίησεν', strongs: 'G4160' });
    expect(parseLxx('')).toBeNull();
  });

  it('converts to friendly words', () => {
    expect(toWord(GEN1, 1)).toMatchObject({ index: 1, text: 'רֵאשִׁית', gloss: 'beginning', group: 0, lang: 'hbo', lxx: { text: 'ἀρχῇ', strongs: 'G0746' } });
    expect(toWord(GEN1, 3)?.lang).toBe('arc');
    expect(toWord(GEN1, 99)).toBeUndefined();
    expect(isAramaic(GEN1, 3)).toBe(true);
    expect(isAramaic(GEN1, 2)).toBe(false);
  });

  it('groups morphemes of one written word', () => {
    expect(wordGroup(GEN1, 0)).toEqual([0, 1]);
    expect(wordGroup(GEN1, 1)).toEqual([0, 1]);
    expect(wordGroup(GEN1, 2)).toEqual([2]);
    expect(verseWordIndices(GEN1, 2)).toEqual([4]);
  });

  it('finds tokens linked to an original word', () => {
    expect(tokensLinkedTo(GEN1_BSB, 1)).toEqual([
      { verse: 1, token: 0 },
      { verse: 1, token: 2 },
      { verse: 1, token: 4 },
    ]);
    expect(tokensLinkedTo(GEN1_BSB, 4)).toEqual([{ verse: 2, token: 0 }]);
    expect(tokensLinkedTo(GEN1_BSB, 42)).toEqual([]);
    const inTok = GEN1_BSB.verses[0].t[0] as WordToken;
    expect(relatedTokens(GEN1_BSB, inTok)).toHaveLength(3);
    expect(tokenAt(GEN1_BSB, { verse: 1, token: 6 })).toEqual(['God', [3]]);
    expect(tokensToText(GEN1_BSB.verses[0].t)).toBe('In the beginning God created.');
  });

  it('knows testaments and chapter order', () => {
    expect(isNT('JHN')).toBe(true);
    expect(isNT('GEN')).toBe(false);
    expect(isNT(40)).toBe(true);
    expect(origLang('MAL')).toBe('hbo');
    expect(nextChapter('GEN', 50)).toEqual(['EXO', 1]);
    expect(nextChapter('REV', 22)).toBeNull();
    expect(prevChapter('EXO', 1)).toEqual(['GEN', 50]);
    expect(prevChapter('GEN', 1)).toBeNull();
  });
});

describe('Lru', () => {
  it('evicts least recently used', () => {
    const l = new Lru<string, number>(2);
    l.set('a', 1);
    l.set('b', 2);
    l.get('a');
    l.set('c', 3);
    expect(l.keys()).toEqual(['a', 'c']);
  });
});
