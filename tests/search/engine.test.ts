import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CorpusIndex, SearchEngine, wordForms } from '../../src/lib/search/engine';
import type { EngineDeps, SearchResponse } from '../../src/lib/search/engine';
import type { ConcChunk, LexIndex, OrigChapter, SearchCorpus, TextChapter } from '../../src/lib/types';
import { CORPUS, makeEngine } from './fixture';

const refs = (r: SearchResponse) => r.results.map((h) => `${h.book} ${h.chapter}:${h.verse}`);
const marked = (r: SearchResponse, i = 0) => r.results[i].highlights.map(([a, b]) => r.results[i].text.slice(a, b));

describe('CorpusIndex', () => {
  const idx = new CorpusIndex(CORPUS);
  it('indexes folded terms with postings', () => {
    expect(idx.size).toBe(CORPUS.verses.length);
    expect(Array.from(idx.postingsOf('love'))).toEqual([4, 6, 10, 11, 12, 13]);
    expect(Array.from(idx.postingsOf('god'))).toContain(11); // God’s
    expect(idx.postingsOf('nonexistent').length).toBe(0);
  });
  it('indexes the parts of hyphenated words', () => {
    expect(Array.from(idx.postingsOf('seed-bearing'))).toEqual([3]);
    expect(Array.from(idx.postingsOf('seed'))).toEqual([3]);
    expect(Array.from(idx.postingsOf('bearing'))).toEqual([3]);
  });
  it('finds prefix terms', () => {
    expect(idx.prefixIds('lov').map((i) => idx.terms[i]).sort()).toEqual(['love', 'loved']);
  });
  it('maps packed refs and book ranges', () => {
    expect(idx.indexOfPacked(43003016)).toBe(8);
    expect(idx.indexOfPacked(99001001)).toBe(-1);
    expect(idx.bookStart[43]).toBe(7);
    expect(idx.bookStart[44]).toBe(11); // Acts absent: empty range
    expect(idx.bookStart[45]).toBe(11);
  });
});

describe('wordForms', () => {
  const vocab = new Set(
    'love loves loved loving loveth lovest lovely go goes went gone going goeth see saw seen seed sees seeing forest for fore the thing things bless blesses blessed blessing cry cried cries crying stop stopped stopping is am are was were be been being'.split(
      ' ',
    ),
  );
  const has = (t: string) => vocab.has(t);
  it('finds regular and KJV inflections', () => {
    expect(wordForms('love', has).sort()).toEqual(['love', 'loved', 'loves', 'loveth', 'lovest', 'loving'].sort());
    expect(wordForms('loved', has)).toContain('love');
    expect(wordForms('loveth', has)).toContain('loving');
    expect(wordForms('bless', has).sort()).toEqual(['bless', 'blessed', 'blesses', 'blessing']);
    expect(wordForms('cried', has).sort()).toEqual(['cried', 'cries', 'cry', 'crying']);
    expect(wordForms('stop', has).sort()).toEqual(['stop', 'stopped', 'stopping']);
  });
  it('uses the irregular table', () => {
    expect(wordForms('go', has).sort()).toEqual(['go', 'goes', 'goeth', 'going', 'gone', 'went']);
    expect(wordForms('went', has)).toContain('go');
    expect(wordForms('is', has).sort()).toEqual(['am', 'are', 'be', 'been', 'being', 'is', 'was', 'were']);
  });
  it('avoids false relatives', () => {
    expect(wordForms('see', has)).not.toContain('seed');
    expect(wordForms('forest', has)).not.toContain('for');
    expect(wordForms('thing', has)).not.toContain('the');
    expect(wordForms('the', has)).toEqual(['the']);
    expect(wordForms('lovely', has)).not.toContain('love');
  });
  it('lists the query word first', () => {
    expect(wordForms('loved', has)[0]).toBe('loved');
  });
});

describe('SearchEngine', () => {
  it('finds exact words, case-insensitively, in canonical order with highlights', async () => {
    const { engine } = makeEngine();
    const r = await engine.search('LOVE', { tr: 'TST' });
    expect(r.total).toBe(6);
    expect(refs(r)).toEqual(['GEN 22:2', 'MAT 5:44', 'JHN 13:34', 'ROM 5:5', '1CO 13:13', '1JN 4:8']);
    expect(marked(r, 2)).toEqual(['Love', 'love']); // "loved" is not "love"
    expect(r.results[4].highlights).toEqual([
      [r.results[4].text.indexOf('love'), r.results[4].text.indexOf('love') + 4],
      [r.results[4].text.lastIndexOf('love'), r.results[4].text.lastIndexOf('love') + 4],
    ]);
    expect(r.interpreted).toBe('“love”');
    expect(r.terms).toEqual(['love']);
  });

  it('matches possessives', async () => {
    const { engine } = makeEngine();
    const r = await engine.search('god', { tr: 'TST' });
    expect(refs(r)).toContain('ROM 5:5');
    expect(marked(r, refs(r).indexOf('ROM 5:5'))).toEqual(['God’s']);
  });

  it('handles AND, OR, NOT and groups', async () => {
    const { engine } = makeEngine();
    expect(refs(await engine.search('faith hope love', { tr: 'TST' }))).toEqual(['1CO 13:13']);
    expect(refs(await engine.search('wept OR shepherd', { tr: 'TST' }))).toEqual(['PSA 23:1', 'JHN 11:35']);
    expect(refs(await engine.search('love -god', { tr: 'TST' }))).toEqual(['MAT 5:44', 'JHN 13:34', '1CO 13:13']);
    expect(refs(await engine.search('(hope OR faith) -remain', { tr: 'TST' }))).toEqual(['ROM 5:5']);
    expect(refs(await engine.search('-the', { tr: 'TST' }))).toEqual(['GEN 1:3', 'MAT 5:44', 'JHN 11:35', 'JHN 13:34', 'ROM 5:5', '1JN 4:8']);
    const d = await engine.search('love (faith OR hope) -fear', { tr: 'TST' });
    expect(d.interpreted).toBe('“love” and (“faith” or “hope”) and not “fear”');
  });

  it('matches phrases and highlights the whole phrase', async () => {
    const { engine } = makeEngine();
    const r = await engine.search('"in the beginning"', { tr: 'TST' });
    expect(refs(r)).toEqual(['GEN 1:1', 'JHN 1:1']);
    expect(marked(r)).toEqual(['In the beginning']);
    expect(refs(await engine.search('"the beginning God"', { tr: 'TST' }))).toEqual(['GEN 1:1']);
    expect(refs(await engine.search('"beginning the"', { tr: 'TST' }))).toEqual([]);
    expect(refs(await engine.search('"one anoth*"', { tr: 'TST' }))).toEqual(['JHN 13:34']);
  });

  it('supports prefix wildcards and word forms', async () => {
    const { engine } = makeEngine();
    const p = await engine.search('lov*', { tr: 'TST' });
    expect(p.total).toBe(7);
    expect(p.interpreted).toBe('words starting with “lov” (love, loved)');
    const f = await engine.search('loved~', { tr: 'TST' });
    expect(f.total).toBe(7);
    expect(marked(f, refs(f).indexOf('JHN 13:34'))).toEqual(['Love', 'loved', 'love']);
    const all = await engine.search('love', { tr: 'TST', forms: true });
    expect(all.total).toBe(7);
  });

  it('matches parts of hyphenated words', async () => {
    const { engine } = makeEngine();
    const r = await engine.search('seed', { tr: 'TST' });
    expect(refs(r)).toEqual(['GEN 1:11']);
    expect(marked(r)).toEqual(['seed']);
  });

  it('answers Strong’s queries through the concordance', async () => {
    const { engine, calls } = makeEngine();
    const r = await engine.search('G26', { tr: 'TST' });
    expect(refs(r)).toEqual(['ROM 5:5', '1CO 13:13', '1JN 4:8']);
    expect(r.strongs).toEqual(['G0026']);
    expect(r.interpreted).toBe('Strong’s G0026 ἀγάπη (agapē, “love”)');
    expect(r.results[0].highlights).toEqual([]);
    expect(calls.conc).toEqual(['G0026']);
    expect(refs(await engine.search('strongs:G0026 -faith', { tr: 'TST' }))).toEqual(['ROM 5:5', '1JN 4:8']);
    expect((await engine.search('G9999', { tr: 'TST' })).total).toBe(0);
  });

  it('answers Greek / Hebrew lemma queries', async () => {
    const { engine } = makeEngine();
    const g = await engine.search('ἀγάπη', { tr: 'TST' });
    expect(refs(g)).toEqual(['ROM 5:5', '1CO 13:13', '1JN 4:8']);
    expect(g.interpreted).toBe('Greek ἀγάπη (G0026, agapē, “love”)');
    expect((await engine.search('αγαπη', { tr: 'TST' })).total).toBe(3); // unaccented
    expect(refs(await engine.search('greek:logos', { tr: 'TST' }))).toEqual(['JHN 1:1']);
    expect(refs(await engine.search('greek:agape', { tr: 'TST' }))).toEqual(['ROM 5:5', '1CO 13:13', '1JN 4:8']);
    expect(refs(await engine.search('hebrew:reshit', { tr: 'TST' }))).toEqual(['GEN 1:1']);
    expect(refs(await engine.search('רֵאשִׁית', { tr: 'TST' }))).toEqual(['GEN 1:1']);
    expect(refs(await engine.search('hebrew:logos', { tr: 'TST' }))).toEqual([]);
    const none = await engine.search('greek:xyzzy', { tr: 'TST' });
    expect(none.total).toBe(0);
    expect(none.errors[0]).toMatch(/xyzzy/);
  });

  it('applies book / testament filters and reports unfiltered counts per book', async () => {
    const { engine } = makeEngine();
    const r = await engine.search('love', { tr: 'TST', testament: 'NT' });
    expect(r.total).toBe(5);
    expect(r.totalAll).toBe(6);
    expect(r.byBook).toEqual({ 1: 1, 40: 1, 43: 1, 45: 1, 46: 1, 62: 1 });
    expect(r.interpreted).toBe('“love” — in the New Testament');
    expect(refs(await engine.search('love', { tr: 'TST', book: 'JHN' }))).toEqual(['JHN 13:34']);
    expect(refs(await engine.search('love', { tr: 'TST', book: 62 }))).toEqual(['1JN 4:8']);
    expect(refs(await engine.search('love in:John', { tr: 'TST' }))).toEqual(['JHN 13:34']);
    expect(refs(await engine.search('love in:OT', { tr: 'TST' }))).toEqual(['GEN 22:2']);
  });

  it('paginates', async () => {
    const { engine } = makeEngine();
    const r = await engine.search('love', { tr: 'TST', limit: 2, offset: 2 });
    expect(r.total).toBe(6);
    expect(refs(r)).toEqual(['JHN 13:34', 'ROM 5:5']);
    expect((await engine.search('love', { tr: 'TST', limit: 2, offset: 10 })).results).toEqual([]);
  });

  it('sorts by relevance on request', async () => {
    const { engine } = makeEngine();
    const r = await engine.search('love', { tr: 'TST', sort: 'relevance' });
    const scores = r.results.map((h) => h.score ?? 0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    // the verses that say "love" twice in few words come first
    expect(refs(r).slice(0, 2).sort()).toEqual(['1CO 13:13', '1JN 4:8']);
    expect(r.total).toBe(6);
  });

  it('suggests alternatives', async () => {
    const { engine } = makeEngine();
    const logos = await engine.search('logos', { tr: 'TST' });
    expect(logos.total).toBe(0);
    expect(logos.suggestions[0]).toEqual({ query: 'greek:logos', label: 'Greek λόγος (logos, “word”) — G3056' });
    const typo = await engine.search('shepard', { tr: 'TST' });
    expect(typo.suggestions).toContainEqual({ query: 'shepherd', label: 'Did you mean “shepherd”?' });
    const love = await engine.search('love', { tr: 'TST' });
    expect(love.suggestions).toEqual([{ query: 'love~', label: 'Include other forms: loved' }]);
  });

  it('handles empty and filter-only queries', async () => {
    const { engine } = makeEngine();
    for (const q of ['', '   ', 'in:NT', '!!!']) {
      const r = await engine.search(q, { tr: 'TST' });
      expect(r.total, q).toBe(0);
      expect(r.results).toEqual([]);
    }
  });

  it('builds each index once and rejects unknown translations', async () => {
    const { engine, calls } = makeEngine();
    await Promise.all([engine.search('love', { tr: 'TST' }), engine.search('hope', { tr: 'TST' }), engine.warm('TST')]);
    expect(calls.corpus).toBe(1);
    await expect(engine.search('love', { tr: 'NIV' })).rejects.toThrow(/no corpus/);
  });
});

describe('highlightLinked', () => {
  const text = (verses: { v: number; t: TextChapter['verses'][number]['t'] }[]): TextChapter => ({ tr: 'TST', book: 'ROM', chapter: 5, verses });
  const ROM5: TextChapter = text([
    { v: 5, t: [['And', [0]], ' ', ['hope', [1]], ' does not disappoint us, because ', ['God’s', [2]], ' ', ['love', [3]], ' has been poured out into our hearts.'] },
  ]);
  const ROM5_ORIG: OrigChapter = {
    book: 'ROM',
    chapter: 5,
    lang: 'grc',
    edition: 'SBLGNT',
    words: [
      ['ἡ', 'G3588', 'ὁ', 'T-NSF', 'the', 5, '', 0, '', ''],
      ['ἐλπὶς', 'G1680', 'ἐλπίς', 'N-NSF', 'hope', 5, '', 1, '', ''],
      ['θεοῦ', 'G2316', 'θεός', 'N-GSM', 'God', 5, '', 2, '', ''],
      ['ἀγάπη', 'G0026', 'ἀγάπη', 'N-NSF', 'love', 5, '', 3, '', ''],
    ],
  };
  const COR13: TextChapter = { tr: 'TST', book: '1CO', chapter: 13, verses: [{ v: 13, t: ['Something else entirely.'] }] };

  it('marks the English words linked to the searched Strong’s numbers', async () => {
    const { engine: base } = makeEngine();
    const engine = new SearchEngine({
      ...(base as unknown as { deps: EngineDeps }).deps,
      loadText: async (_tr, book) => (book === 'ROM' ? ROM5 : book === '1CO' ? COR13 : Promise.reject(new Error('404'))),
      loadOrig: async (book) => (book === 'ROM' ? ROM5_ORIG : Promise.reject(new Error('404'))),
    });
    const r = await engine.search('G26', { tr: 'TST' });
    const spans = await engine.highlightLinked('TST', r.results, r.strongs);
    expect(spans).toHaveLength(3);
    const rom = r.results.findIndex((h) => h.book === 'ROM');
    expect(spans[rom].map(([a, b]) => r.results[rom].text.slice(a, b))).toEqual(['love']);
    expect(spans[refs(r).indexOf('1CO 13:13')]).toEqual([]); // chapter text differs from the corpus: no spans
    expect(spans[refs(r).indexOf('1JN 4:8')]).toEqual([]); // chapter unavailable
    expect(await engine.highlightLinked('TST', r.results, [])).toEqual([[], [], []]);
    const plain = makeEngine().engine; // no text/orig loaders
    expect(await plain.highlightLinked('TST', r.results, r.strongs)).toEqual([[], [], []]);
  });
});

// Performance on the real corpus (skipped when the generated data is not present).
const BSB = join(process.cwd(), 'public', 'data', 'search', 'BSB.json');
describe.skipIf(!existsSync(BSB))('full BSB corpus', () => {
  it('builds the index and answers typical queries quickly', async () => {
    const corpus = JSON.parse(readFileSync(BSB, 'utf8')) as SearchCorpus;
    const lexPath = join(process.cwd(), 'public', 'data', 'lex', 'index.json');
    const engine = new SearchEngine({
      loadCorpus: async () => corpus,
      loadLexIndex: async () => (existsSync(lexPath) ? (JSON.parse(readFileSync(lexPath, 'utf8')) as LexIndex) : []),
      loadConcordance: async (id) => {
        const f = join(process.cwd(), 'public', 'data', 'conc', id[0], `${String(Math.floor(Number(id.slice(1, 5)) / 100)).padStart(3, '0')}.json`);
        return existsSync(f) ? ((JSON.parse(readFileSync(f, 'utf8')) as ConcChunk)[id.slice(0, 5)] ?? []) : [];
      },
    });
    const idx = await engine.index('BSB');
    expect(idx.size).toBeGreaterThan(31000);
    expect(idx.buildMs).toBeLessThan(3000);
    // warm the lexicon (one-off cost) before timing
    await engine.search('G26', { tr: 'BSB' });
    const queries = ['love', 'love~', 'lov*', '"in the beginning"', 'faith OR hope', 'faith hope love', 'love -god', 'G26', 'λόγος', 'the', 'in:John light', '"son of man" in:NT'];
    const times: { label: string; ms: number }[] = [];
    for (const q of queries) {
      for (const sort of ['canonical', 'relevance'] as const) {
        const t = performance.now();
        const r = await engine.search(q, { tr: 'BSB', sort });
        times.push({ label: `${q} (${sort})`, ms: performance.now() - t });
        expect(r.total, q).toBeGreaterThan(0);
      }
    }
    // Typically 0.1–20 ms here; the bounds leave room for slow CI runners.
    const sorted = times.map((t) => t.ms).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const slowest = times.reduce((a, b) => (b.ms > a.ms ? b : a));
    expect(median, 'median query time (ms)').toBeLessThan(50);
    expect(slowest.ms, `slowest: ${slowest.label}`).toBeLessThan(250);
    // Linked highlights on real chapters: G26 (agapē) in the BSB marks "love".
    const data = join(process.cwd(), 'public', 'data');
    const linked = new SearchEngine({
      loadCorpus: async () => corpus,
      loadLexIndex: async () => [],
      loadConcordance: async () => [],
      loadText: async (tr, book, ch) => JSON.parse(readFileSync(join(data, 'text', tr, book, `${ch}.json`), 'utf8')) as TextChapter,
      loadOrig: async (book, ch) => JSON.parse(readFileSync(join(data, 'orig', book, `${ch}.json`), 'utf8')) as OrigChapter,
    });
    const g26 = await engine.search('G26', { tr: 'BSB', limit: 10 });
    const spans = await linked.highlightLinked('BSB', g26.results, g26.strongs);
    const words = spans.flatMap((list, i) => list.map(([a, b]) => g26.results[i].text.slice(a, b).toLowerCase()));
    expect(spans.filter((l) => l.length).length).toBeGreaterThan(5);
    expect(words.some((w) => w.includes('love'))).toBe(true);

    const john316 = await engine.search('"For God so loved the world"', { tr: 'BSB' });
    expect(john316.results.map((h) => `${h.book} ${h.chapter}:${h.verse}`)).toContain('JHN 3:16');
  });
});
