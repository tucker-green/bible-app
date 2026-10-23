// @vitest-environment node
/**
 * Word study: the pipeline stage (scripts/data/wordstudy.ts) on small fixtures, and the browser module
 * (src/lib/wordstudy.ts). A last block checks the generated data when public/data/study exists.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chunkStudies,
  derivationRefs,
  greekForm,
  hebrewWordTexts,
  isAffixPos,
  lxxStrongs,
  morphemeIdsFromLex,
  parseStrongsDictionary,
  relatedIndex,
  STUDY_CAPS,
  StudyCounter,
  studyKey,
  topCounts,
} from '../scripts/data/wordstudy';
import { BOOKS } from '../src/lib/books';
import { configureData, DataError } from '../src/lib/data';
import type { OrigChapter, OrigWord, WordStudy, WordStudyChunk } from '../src/lib/types';
import {
  bookDistribution,
  CANON_SECTIONS,
  configureWordStudy,
  findStudy,
  isLxxOnly,
  loadWordStudy,
  loadWordStudyChunk,
  lxxBridge,
  sectionOfBook,
  studyChunkPath,
  studyLang,
  topBooks,
  topForms,
} from '../src/lib/wordstudy';

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                  */
/* ------------------------------------------------------------------------ */

/** Lexicon parts of speech as the lexicon stage writes them (exact ids). */
const LEX_POS = new Map<string, string>([
  ['H2050', 'Verb'],
  ['H2050b', 'Conjunction (prefix)'],
  ['H1886a', 'Article (prefix)'],
  ['H0001b', 'Article (suffix, Aramaic)'],
  ['H0871a', 'Preposition (prefix)'],
  ['H2050c', 'Suffix, pronominal (3rd person masculine singular)'],
  ['H0518a', 'Conditional particle'],
  ['H1121', 'Noun, masculine'],
  ['H1121a', 'Noun, masculine'],
  ['H7225', 'Noun, feminine'],
  ['G4053', 'Adjective'],
]);
const lexPos = (id: string) => LEX_POS.get(id);
const key = (id: string) => studyKey(id, lexPos);

const w = (text: string, strongs: string, lemma: string, morph: string, verse: number, group: number, lxx = ''): OrigWord => [
  text,
  strongs,
  lemma,
  morph,
  '',
  verse,
  '',
  group,
  '',
  lxx,
];

/** Gen 1:1 (first words) as the orig stage writes them, plus an out-of-order morpheme (as in Josh 6:24). */
const GEN1: OrigChapter = {
  book: 'GEN',
  chapter: 1,
  lang: 'hbo',
  edition: 'WLC',
  words: [
    w('בְּ', 'H0871a', 'בְּ', 'R', 1, 0, 'ἐν|G1722'),
    w('רֵאשִׁית', 'H7225', 'רֵאשִׁית', 'Ncfsa', 1, 0, 'ἀρχῇ|G0746'),
    w('בָּרָא', 'H1254', 'בָּרָא', 'Vqp3ms', 1, 2, 'ἐποίησεν|G4160'),
    w('וְ', 'H2050b', 'וְ', 'C', 1, 3, 'καὶ|G2532'),
    w('אֵת', 'H0853', 'אֵת', 'To', 1, 4, ''),
    w('הָ', 'H1886a', 'הַ', 'Td', 1, 3, 'τὴν|G3588'),
    w('אָרֶץ', 'H0776', 'אֶרֶץ', 'Ncbsa', 1, 3, 'γῆν|G1093'),
    w('בֵּן', 'H1121a', 'בֵּן', 'Ncmsa', 2, 7, 'υἱὸς|G5207'),
    w('בְּנוֹ', 'H1121', 'בֵּן', 'Ncmsc', 2, 8, 'υἱὸς|G5207'),
    w('אִם', 'H0518a', 'אִם', 'Tc', 2, 9, 'ἐμοῦ|G1700'),
    w('תֹהוּ', '', '', 'Ncmsa', 2, 10, 'ἀόρατος|'),
  ],
};

const MAT1: OrigChapter = {
  book: 'MAT',
  chapter: 1,
  lang: 'grc',
  edition: 'SBLGNT',
  words: [
    w('Ἰησοῦ', 'G2424', 'Ἰησοῦς', 'N-GSM', 1, 0),
    w('χριστοῦ', 'G5547', 'Χριστός', 'N-GSM', 1, 1),
    w('τὸν', 'G3588', 'ὁ', 'T-ASM', 2, 2),
    w('τόν', 'G3588', 'ὁ', 'T-ASM', 2, 3),
    w('τοὺς', 'G3588', 'ὁ', 'T-APM', 2, 4),
    w('Χριστοῦ', 'G5547', 'Χριστός', 'N-GSM', 16, 5),
    w('περισσὸν', 'G4053c', 'περισσός', 'A-ASN', 17, 6),
  ],
};

/* ------------------------------------------------------------------------ */
/* Pipeline: keying                                                          */
/* ------------------------------------------------------------------------ */

describe('isAffixPos / studyKey', () => {
  it('recognises the lexicon parts of speech of prefix, suffix and article morphemes', () => {
    expect(isAffixPos('Conjunction (prefix)')).toBe(true);
    expect(isAffixPos('Preposition (prefix, Aramaic)')).toBe(true);
    expect(isAffixPos('Article (suffix, Aramaic)')).toBe(true);
    expect(isAffixPos('Suffix, pronominal (1st person singular)')).toBe(true);
    expect(isAffixPos('Suffix, directional')).toBe(true);
    // "particle" contains "article" but is not one
    expect(isAffixPos('Conditional particle')).toBe(false);
    expect(isAffixPos('Noun, masculine')).toBe(false);
    expect(isAffixPos('')).toBe(false);
    expect(isAffixPos(undefined)).toBe(false);
  });

  it('keeps the full id of Hebrew prefix/suffix/article morphemes and folds everything else to the base', () => {
    expect(key('H2050b')).toBe('H2050b'); // "and", not H2050 "to break in"
    expect(key('H1886a')).toBe('H1886a');
    expect(key('H0001b')).toBe('H0001b');
    expect(key('H2050c')).toBe('H2050c');
    expect(key('H1121a')).toBe('H1121'); // lettered sense of an ordinary word
    expect(key('H0518a')).toBe('H0518'); // "Conditional particle" is no morpheme
    expect(key('H7225')).toBe('H7225');
    expect(key('G4053c')).toBe('G4053');
    expect(key('G0026')).toBe('G0026');
    // no lexicon entry under the exact id: base
    expect(key('H3807q')).toBe('H3807');
    // a Greek id is never kept whole, whatever its pos says
    expect(studyKey('G1234a', () => 'Article (prefix)')).toBe('G1234');
  });

  it('lists the morpheme ids of a lexicon', () => {
    expect([...morphemeIdsFromLex(LEX_POS)].sort()).toEqual(['H0001b', 'H0871a', 'H1886a', 'H2050b', 'H2050c']);
  });
});

/* ------------------------------------------------------------------------ */
/* Pipeline: forms                                                           */
/* ------------------------------------------------------------------------ */

describe('greekForm', () => {
  it('lower-cases common words and folds the positional grave into an acute', () => {
    expect(greekForm('τὸν', 'ὁ')).toBe('τόν');
    expect(greekForm('Λόγος', 'λόγος')).toBe('λόγος');
    expect(greekForm('Ἐν', 'ἐν')).toBe('ἐν');
  });

  it('drops the extra accent an enclitic throws back', () => {
    expect(greekForm('ἄνθρωπός', 'ἄνθρωπος')).toBe('ἄνθρωπος');
    expect(greekForm('σῶμά', 'σῶμα')).toBe('σῶμα');
  });

  it('capitalises proper nouns (capitalised lemma), whatever the printed case', () => {
    expect(greekForm('χριστοῦ', 'Χριστός')).toBe('Χριστοῦ');
    expect(greekForm('Ἀβραὰμ', 'Ἀβραάμ')).toBe('Ἀβραάμ');
    expect(greekForm('Ἰησοῦ', 'Ἰησοῦς')).toBe('Ἰησοῦ');
  });

  it('returns NFC whatever the input normalisation', () => {
    const nfd = 'λόγου'.normalize('NFD');
    expect(greekForm(nfd, 'λόγος')).toBe('λόγου'.normalize('NFC'));
    expect(greekForm(nfd, 'λόγος').length).toBe(5);
  });
});

describe('hebrewWordTexts', () => {
  it('joins every morpheme of a written word, even out of order', () => {
    const t = hebrewWordTexts(GEN1);
    expect(t[0]).toBe('בְּרֵאשִׁית');
    expect(t[1]).toBe('בְּרֵאשִׁית');
    expect(t[2]).toBe('בָּרָא');
    // group 3 = indices 3, 5, 6 (the object marker at 4 sits between them)
    expect(t[3]).toBe('וְהָאָרֶץ');
    expect(t[6]).toBe('וְהָאָרֶץ');
    expect(t[4]).toBe('אֵת');
  });

  it('normalises to NFC', () => {
    const ch: OrigChapter = { ...GEN1, words: [w('בְּ'.normalize('NFD'), 'H0871a', '', 'R', 1, 0), w('רֵאשִׁית'.normalize('NFD'), 'H7225', '', 'N', 1, 0)] };
    expect(hebrewWordTexts(ch)[1]).toBe('בְּרֵאשִׁית'.normalize('NFC'));
  });
});

describe('lxxStrongs', () => {
  it('extracts and normalises the Greek id of an OW.lxx field', () => {
    expect(lxxStrongs('ἐποίησεν|G4160')).toBe('G4160');
    expect(lxxStrongs('ἀρχῇ|G746')).toBe('G0746');
    expect(lxxStrongs('x|G4053c')).toBe('G4053');
    expect(lxxStrongs('ἀκατασκεύαστος|')).toBe('');
    expect(lxxStrongs('')).toBe('');
    expect(lxxStrongs('x|H1234')).toBe('');
  });
});

/* ------------------------------------------------------------------------ */
/* Pipeline: counting                                                        */
/* ------------------------------------------------------------------------ */

describe('StudyCounter', () => {
  const counter = new StudyCounter(key);
  counter.addChapter(1, GEN1);
  counter.addChapter(40, MAT1);
  const res = counter.result();

  it('counts occurrences per key and per book', () => {
    const s = res.get('H1121')!;
    expect(s.total).toBe(2); // H1121a + H1121
    expect(s.byBook).toHaveLength(66);
    expect(s.byBook[0]).toBe(2);
    expect(s.byBook.reduce((a, b) => a + b, 0)).toBe(2);
    expect(res.has('H1121a')).toBe(false);
    expect(res.get('G4053')!.total).toBe(1);
    expect(res.get('G3588')!.byBook[39]).toBe(3);
  });

  it('keeps prefix/suffix morphemes under their full id, never under the unrelated base', () => {
    expect(res.get('H2050b')!.total).toBe(1);
    expect(res.has('H2050')).toBe(false);
    expect(res.get('H0518')!.total).toBe(1);
  });

  it('records Hebrew forms as whole written words with the morpheme’s own morph code', () => {
    expect(res.get('H0871a')!.forms).toEqual([['בְּרֵאשִׁית', 'R', 1]]);
    expect(res.get('H7225')!.forms).toEqual([['בְּרֵאשִׁית', 'Ncfsa', 1]]);
    expect(res.get('H1886a')!.forms).toEqual([['וְהָאָרֶץ', 'Td', 1]]);
  });

  it('merges Greek accent and case variants and sorts forms by count', () => {
    expect(res.get('G3588')!.forms).toEqual([
      ['τόν', 'T-ASM', 2],
      ['τούς', 'T-APM', 1],
    ]);
    expect(res.get('G5547')!.forms).toEqual([['Χριστοῦ', 'N-GSM', 2]]);
  });

  it('builds the LXX bridge in both directions', () => {
    expect(res.get('H7225')!.lxx).toEqual([['G0746', 1]]);
    expect(res.get('H2050b')!.lxx).toEqual([['G2532', 1]]);
    expect(res.get('H1121')!.lxx).toEqual([['G5207', 2]]);
    expect(res.get('G5207')!.lxx).toEqual([['H1121', 2]]);
    expect(res.get('G2532')!.lxx).toEqual([['H2050b', 1]]);
    expect(res.get('H0853')!.lxx).toBeUndefined();
    // a word with no Strong's id contributes nothing
    expect([...res.values()].some((s) => s.lxx?.some(([id]) => id === ''))).toBe(false);
  });

  it('gives LXX-only Greek ids an entry with no occurrences', () => {
    const s = res.get('G1700')!;
    expect(s.total).toBe(0);
    expect(s.forms).toEqual([]);
    expect(s.lxx).toEqual([['H0518', 1]]);
  });

  it('caps forms and LXX lists', () => {
    const c = new StudyCounter(key);
    const words: OrigWord[] = [];
    for (let i = 0; i < 50; i++) words.push(w(`λόγος${'ς'.repeat(i)}`, 'G3056', 'λόγος', 'N-NSM', 1, i));
    c.addChapter(43, { book: 'JHN', chapter: 1, lang: 'grc', edition: 'SBLGNT', words });
    expect(c.result().get('G3056')!.forms).toHaveLength(STUDY_CAPS.forms);
    expect(c.result({ forms: 3, lxx: 1 }).get('G3056')!.forms).toHaveLength(3);
  });

  it('ranks with ties broken by id', () => {
    expect(topCounts(new Map([['G2', 1], ['G1', 1], ['G3', 5]]), 2)).toEqual([
      ['G3', 5],
      ['G1', 1],
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* Pipeline: related words                                                   */
/* ------------------------------------------------------------------------ */

describe("Strong's dictionary and related words", () => {
  const text = readFileSync(join(__dirname, 'fixtures', 'strongs-dictionary-sample.js'), 'utf8');

  it('parses the object literal without evaluating the file', () => {
    const dict = parseStrongsDictionary(text);
    expect([...dict.keys()]).toEqual(['G3056', 'G3004', 'G2127', 'G4533']);
    expect(dict.get('G3056')!.kjv_def).toBe('account, cause, "word"};');
    expect(dict.get('G4533')!.derivation).toBe('of Hebrew origin (H08012);');
    expect(dict.get('G4533')).not.toHaveProperty('extra'); // only string fields
    expect(dict.get('G4533')).not.toHaveProperty('n');
    expect((globalThis as { __strongsFixtureEvaluated?: boolean }).__strongsFixtureEvaluated).toBeUndefined();
  });

  it('normalises keys and rejects text without an object literal', () => {
    expect([...parseStrongsDictionary('var x = {"H1":{"lemma":"אָב"},"H08674":{}};').keys()]).toEqual(['H0001', 'H8674']);
    expect(() => parseStrongsDictionary('/* {"G1":{}} */ console.log(1)')).toThrow(/no `var x = \{`/);
    expect(() => parseStrongsDictionary('var x = {"G1":{"a":"}"}')).toThrow(/unterminated/);
  });

  it('extracts every Strong’s id of a derivation note', () => {
    expect(derivationRefs('from G1537 (ἐκ) and G5055 (τελέω);')).toEqual(['G1537', 'G5055']);
    expect(derivationRefs('of Hebrew origin (H08012);')).toEqual(['H8012']);
    expect(derivationRefs('from H6 (אָבַד); Compare H10 (אֲבַדֹּה).')).toEqual(['H0006', 'H0010']);
    expect(derivationRefs('from G3004 (λέγω); compare G3004')).toEqual(['G3004']);
    expect(derivationRefs('a primary verb;')).toEqual([]);
  });

  it('links sources and derived words both ways, ranked and capped', () => {
    const notes = new Map([
      ['G3056', 'from G3004 (λέγω);'],
      ['G2127', 'from a compound of G2095 (εὖ) and G3056 (λόγος);'],
      ['G3049', 'middle voice from G3056 (λόγος);'],
      ['G0249', 'from G0001 (α) (as a negative particle) and G3056 (λόγος);'],
      ['G9999', 'from G3056;'],
      ['G4533', 'of Hebrew origin (H08012);'],
      ['G3004', 'a primary verb; compare G3004'],
    ]);
    const totals = new Map([
      ['G2127', 42],
      ['G3049', 41],
      ['G0249', 3],
    ]);
    const exists = (id: string) => id !== 'G9999';
    const rel = relatedIndex(notes, totals, exists);
    // sources first (in note order), then derived words by frequency
    expect(rel.get('G3056')).toEqual(['G3004', 'G2127', 'G3049', 'G0249']);
    expect(rel.get('G3004')).toEqual(['G3056']); // self-reference ignored
    expect(rel.get('G2127')).toEqual(['G2095', 'G3056']);
    expect(rel.get('H8012')).toEqual(['G4533']); // cross-language, reverse direction
    expect(rel.get('G4533')).toEqual(['H8012']);
    expect(rel.has('G9999')).toBe(true); // its own sources still listed
    expect(rel.get('G3056')).not.toContain('G9999');
    expect(relatedIndex(notes, totals, exists, 2).get('G3056')).toEqual(['G3004', 'G2127']);
  });
});

describe('chunkStudies', () => {
  it('groups studies like the lexicon, extended ids with their base number', () => {
    const s = (id: string): WordStudy => ({ id, total: 1, byBook: new Array(66).fill(0), forms: [] });
    const chunks = chunkStudies(new Map(['G3056', 'G0026', 'H2050b', 'H2050', 'H7225'].map((id) => [id, s(id)])));
    expect([...chunks.keys()].sort()).toEqual(['G/000', 'G/030', 'H/020', 'H/072']);
    expect(Object.keys(chunks.get('H/020')!)).toEqual(['H2050', 'H2050b']);
  });
});

/* ------------------------------------------------------------------------ */
/* Browser module                                                            */
/* ------------------------------------------------------------------------ */

const zeros = () => new Array<number>(66).fill(0);
const study = (id: string, counts: Record<number, number>, extra: Partial<WordStudy> = {}): WordStudy => {
  const byBook = zeros();
  for (const [n, c] of Object.entries(counts)) byBook[Number(n) - 1] = c;
  return { id, total: byBook.reduce((a, b) => a + b, 0), byBook, forms: [], ...extra };
};

const LOGOS = study(
  'G3056',
  { 40: 33, 41: 24, 42: 33, 43: 40, 44: 65, 45: 7, 58: 12, 66: 18 },
  {
    forms: [
      ['λόγον', 'N-ASM', 130],
      ['λόγος', 'N-NSM', 68],
      ['λόγῳ', 'N-DSM', 45],
      ['λόγου', 'N-GSM', 28],
    ],
    lxx: [
      ['H1697', 668],
      ['H0561', 10],
      ['H1696', 10],
      ['H2967a', 2],
    ],
    related: ['G3004'],
  },
);
const HESED = study(
  'H2617',
  { 1: 11, 19: 127, 10: 12 },
  {
    forms: [
      ['חֶסֶד', 'Ncmsa', 61],
      ['חַסְדּוֹ', 'Ncmsc', 58],
      ['חֶסֶד', 'Ncmsc', 5],
    ],
    lxx: [['G1656', 142]],
  },
);

const CHUNKS: Record<string, WordStudyChunk> = {
  'study/G/030.json': { G3056: LOGOS },
  'study/H/026.json': { H2617: HESED },
  'study/H/020.json': {
    H2050: study('H2050', { 19: 1 }),
    H2050b: study('H2050b', { 1: 4134 }),
  },
  'study/H/011.json': { H1121: study('H1121', { 1: 5 }) },
};

describe('loading', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    configureData({ base: '/data/' });
    fetchMock = vi.fn(async (url: string) => {
      const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
      if (path === 'study/G/050.json') return new Response('boom', { status: 500 });
      const body = CHUNKS[path];
      return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('', { status: 404 });
    });
    configureWordStudy({ fetch: fetchMock as unknown as typeof fetch, cacheSize: 4 });
  });

  it('maps ids to chunk paths like the lexicon', () => {
    expect(studyChunkPath('G26')).toBe('study/G/000.json');
    expect(studyChunkPath('g3056')).toBe('study/G/030.json');
    expect(studyChunkPath('H2050b')).toBe('study/H/020.json');
    expect(studyChunkPath('nope')).toBeNull();
  });

  it('loads a study, resolving short and lettered ids', async () => {
    expect((await loadWordStudy('G3056'))?.total).toBe(LOGOS.total);
    expect((await loadWordStudy('h2617'))?.id).toBe('H2617');
    expect((await loadWordStudy('H2050b'))?.id).toBe('H2050b'); // morpheme kept whole
    expect((await loadWordStudy('H2050'))?.id).toBe('H2050');
    expect((await loadWordStudy('H1121a'))?.id).toBe('H1121'); // ordinary lettered id -> base
    expect(await loadWordStudy('G3057')).toBeUndefined();
    expect(await loadWordStudy('not an id')).toBeUndefined();
  });

  it('fetches each chunk once', async () => {
    await Promise.all([loadWordStudy('H2050'), loadWordStudy('H2050b'), loadWordStudyChunk('H2050c')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/data/study/H/020.json');
  });

  it('treats a missing chunk as empty and does not cache failures', async () => {
    expect(await loadWordStudy('G9999')).toBeUndefined();
    await expect(loadWordStudy('G5000')).rejects.toBeInstanceOf(DataError);
    await expect(loadWordStudy('G5000')).rejects.toBeInstanceOf(DataError);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('G/050')).length).toBe(2);
    await expect(loadWordStudyChunk('xyz')).rejects.toThrow(/Strong/);
  });

  it('finds a study in a chunk', () => {
    expect(findStudy(CHUNKS['study/H/020.json'], 'H2050b')?.id).toBe('H2050b');
    expect(findStudy(CHUNKS['study/H/020.json'], 'H2050z')?.id).toBe('H2050');
    expect(findStudy(CHUNKS['study/H/020.json'], '??')).toBeUndefined();
  });
});

describe('sections of the canon', () => {
  it('covers every book exactly once, in the right testament', () => {
    for (const b of BOOKS) {
      const s = sectionOfBook(b.num);
      expect(s, b.id).toBeDefined();
      expect(s!.testament).toBe(b.testament);
      expect(CANON_SECTIONS.filter((x) => b.num >= x.first && b.num <= x.last)).toHaveLength(1);
    }
    expect(sectionOfBook(0)).toBeUndefined();
    expect(sectionOfBook(58)!.id).toBe('general'); // Hebrews
    expect(sectionOfBook(57)!.id).toBe('paul'); // Philemon
  });
});

describe('bookDistribution', () => {
  it('groups a Greek word by NT section, with every book listed', () => {
    const d = bookDistribution(LOGOS);
    expect(d.map((s) => s.id)).toEqual(['gospels', 'acts', 'paul', 'general', 'revelation']);
    const gospels = d[0];
    expect(gospels.total).toBe(130);
    expect(gospels.share).toBeCloseTo(130 / LOGOS.total);
    expect(gospels.books.map((b) => [b.book, b.count])).toEqual([
      ['MAT', 33],
      ['MRK', 24],
      ['LUK', 33],
      ['JHN', 40],
    ]);
    expect(d.find((s) => s.id === 'paul')!.books).toHaveLength(13);
    expect(d.reduce((t, s) => t + s.total, 0)).toBe(LOGOS.total);
  });

  it('groups a Hebrew word by OT section', () => {
    const d = bookDistribution(HESED);
    expect(d.map((s) => [s.id, s.total])).toEqual([
      ['law', 11],
      ['history', 12],
      ['wisdom', 127],
      ['prophets', 0],
    ]);
  });

  it('hides empty sections and books on request, and can show both testaments', () => {
    const d = bookDistribution(HESED, { hideEmpty: true });
    expect(d.map((s) => s.id)).toEqual(['law', 'history', 'wisdom']);
    expect(d[1].books.map((b) => b.book)).toEqual(['2SA']);
    expect(bookDistribution(HESED, { testament: 'both' })).toHaveLength(9);
    expect(bookDistribution(HESED, { testament: 'NT' }).every((s) => s.total === 0)).toBe(true);
    // occurrences outside the word's own testament are never hidden by default
    expect(bookDistribution(study('G0001', { 1: 1, 40: 1 })).map((s) => s.id)[0]).toBe('law');
  });

  it('copes with a study that has no occurrences', () => {
    const d = bookDistribution(study('G1700', {}));
    expect(d).toHaveLength(5);
    expect(d.every((s) => s.total === 0 && s.share === 0)).toBe(true);
    expect(bookDistribution(study('G1700', {}), { hideEmpty: true })).toEqual([]);
  });
});

describe('topForms / topBooks / lxxBridge', () => {
  it('returns the most frequent forms with their share', () => {
    const f = topForms(LOGOS, 2);
    expect(f.map((r) => [r.text, r.morphs, r.count])).toEqual([
      ['λόγον', ['N-ASM'], 130],
      ['λόγος', ['N-NSM'], 68],
    ]);
    expect(f[0].share).toBeCloseTo(130 / LOGOS.total);
    expect(topForms(LOGOS)).toHaveLength(4);
    expect(topForms(LOGOS, 0)).toEqual([]);
  });

  it('can merge forms that differ only in parsing', () => {
    expect(topForms(HESED, 5).map((r) => r.text)).toEqual(['חֶסֶד', 'חַסְדּוֹ', 'חֶסֶד']);
    const merged = topForms(HESED, 5, { mergeMorph: true });
    expect(merged.map((r) => [r.text, r.morphs, r.count])).toEqual([
      ['חֶסֶד', ['Ncmsa', 'Ncmsc'], 66],
      ['חַסְדּוֹ', ['Ncmsc'], 58],
    ]);
  });

  it('lists the books where a word is most frequent', () => {
    expect(topBooks(LOGOS, 3).map((b) => [b.book, b.count])).toEqual([
      ['ACT', 65],
      ['JHN', 40],
      ['MAT', 33],
    ]);
    expect(topBooks(study('G1700', {}))).toEqual([]);
  });

  it('turns the LXX bridge into rows with shares', () => {
    const rows = lxxBridge(LOGOS);
    expect(rows[0]).toEqual({ id: 'H1697', count: 668, share: 668 / 690 });
    expect(lxxBridge(LOGOS, { minShare: 0.01 }).map((r) => r.id)).toEqual(['H1697', 'H0561', 'H1696']);
    expect(lxxBridge(LOGOS, { limit: 1 })).toHaveLength(1);
    expect(lxxBridge(study('G0001', {}))).toEqual([]);
  });

  it('knows the language and LXX-only words', () => {
    expect(studyLang(LOGOS)).toBe('grc');
    expect(studyLang(HESED)).toBe('hbo');
    expect(isLxxOnly(LOGOS)).toBe(false);
    expect(isLxxOnly(study('G1700', {}, { lxx: [['H2967a', 312]] }))).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* Generated data (skipped when public/data/study has not been built)        */
/* ------------------------------------------------------------------------ */

const STUDY_DIR = join(__dirname, '..', 'public', 'data', 'study');
const readChunk = (lang: string, n: string): WordStudyChunk => JSON.parse(readFileSync(join(STUDY_DIR, lang, `${n}.json`), 'utf8'));

describe.skipIf(!existsSync(join(STUDY_DIR, 'G', '030.json')))('generated word studies', () => {
  it('λόγος renders דָּבָר in the LXX, and the bridge runs back', () => {
    const logos = readChunk('G', '030').G3056;
    expect(logos.total).toBeGreaterThan(300);
    expect(logos.lxx![0][0]).toBe('H1697');
    expect(logos.related).toContain('G3004');
    expect(readChunk('H', '016').H1697.lxx![0][0]).toBe('G3056');
  });

  it('חֶסֶד is mostly ἔλεος', () => {
    const hesed = readChunk('H', '026').H2617;
    expect(hesed.lxx![0][0]).toBe('G1656');
    expect(hesed.byBook[18]).toBeGreaterThan(100); // Psalms
  });

  it('keeps "and" under H2050b, separate from H2050', () => {
    const c = readChunk('H', '020');
    expect(c.H2050b.total).toBeGreaterThan(40_000);
    expect(c.H2050b.related).toBeUndefined();
    expect(c.H2050b.forms[0][1]).toBe('C');
    expect(c.H2050?.total ?? 0).toBeLessThan(10);
  });

  it('has well-formed entries', () => {
    for (const [id, s] of Object.entries(readChunk('G', '000'))) {
      expect(s.id).toBe(id);
      expect(s.byBook).toHaveLength(66);
      expect(s.byBook.reduce((a, b) => a + b, 0)).toBe(s.total);
      expect(s.forms.length).toBeLessThanOrEqual(40);
      expect(s.lxx?.length ?? 0).toBeLessThanOrEqual(12);
      expect(s.related?.length ?? 0).toBeLessThanOrEqual(12);
    }
  });
});
