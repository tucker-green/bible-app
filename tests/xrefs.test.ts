// @vitest-environment node
/**
 * Cross references: the pipeline stage (scripts/data/xrefs.ts) on a fixture of real OpenBible.info
 * lines plus edge cases, and the browser module (src/lib/xrefs.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectXrefs,
  OSIS_TO_USFM,
  parseOsisVerse,
  parseXrefLine,
  toChapters,
  XREF_CAP,
} from '../scripts/data/xrefs';
import type { RawXref, VerseCountFn } from '../scripts/data/xrefs';
import { BOOKS, getBookByNum } from '../src/lib/books';
import { configureData, DataError } from '../src/lib/data';
import type { DataMeta, XrefChapter, XrefTarget } from '../src/lib/types';
import { packRef } from '../src/lib/types';
import {
  compareXrefCanonical,
  compareXrefTargets,
  configureXrefs,
  expandXrefTarget,
  formatXrefTarget,
  groupXrefsByBook,
  groupXrefsByTestament,
  isXrefRange,
  loadXrefs,
  metaVerseCount,
  versesWithXrefs,
  xrefCount,
  xrefEnd,
  xrefHash,
  xrefKey,
  xrefsForVerse,
  xrefsForVerses,
  xrefStart,
  xrefTestament,
  xrefToRef,
} from '../src/lib/xrefs';

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'openbible-xrefs-sample.txt'), 'utf8');

/** English verse counts for the chapters the fixture touches; every other existing chapter has 50. */
const COUNTS: Record<string, number> = { 'GEN:1': 31, 'GEN:2': 25, '2CH:36': 23, 'EZR:1': 11, '2JN:1': 13, '3JN:1': 14 };
const verseCount: VerseCountFn = (bookNum, chapter) => {
  const b = getBookByNum(bookNum);
  if (!b || chapter < 1 || chapter > b.chapters) return undefined;
  return COUNTS[`${b.id}:${chapter}`] ?? 50;
};

const rows = (text: string): RawXref[] =>
  text
    .split('\n')
    .map(parseXrefLine)
    .filter((r): r is RawXref => r !== null);

/* ------------------------------------------------------------------------ */
/* Pipeline                                                                  */
/* ------------------------------------------------------------------------ */

describe('OSIS book mapping', () => {
  it('maps all 66 OpenBible abbreviations to our USFM ids, in canonical order', () => {
    expect(Object.keys(OSIS_TO_USFM)).toHaveLength(66);
    expect(Object.values(OSIS_TO_USFM)).toEqual(BOOKS.map((b) => b.id));
  });

  it('parses OSIS verses into packed refs', () => {
    expect(parseOsisVerse('Gen.1.1')).toBe(1_001_001);
    expect(parseOsisVerse('1Chr.16.26')).toBe(13_016_026);
    expect(parseOsisVerse('Ps.119.176')).toBe(19_119_176);
    expect(parseOsisVerse('Song.1.1')).toBe(22_001_001);
    expect(parseOsisVerse('Matt.5.3')).toBe(40_005_003);
    expect(parseOsisVerse('Phlm.1.4')).toBe(57_001_004);
    expect(parseOsisVerse('3John.1.14')).toBe(64_001_014);
    expect(parseOsisVerse('Rev.22.21')).toBe(66_022_021);
  });

  it('fails loudly on unknown books and malformed refs', () => {
    expect(() => parseOsisVerse('Bar.1.1')).toThrow(/unknown OSIS book abbreviation "Bar"/);
    expect(() => parseOsisVerse('Gen 1:1')).toThrow(/malformed/);
    expect(() => parseOsisVerse('Gen.0.1')).toThrow(/impossible/);
  });
});

describe('parseXrefLine', () => {
  it('skips the header, comments and blank lines', () => {
    expect(parseXrefLine(FIXTURE.split('\n')[0])).toBeNull();
    expect(parseXrefLine('')).toBeNull();
    expect(parseXrefLine('# comment')).toBeNull();
  });

  it('parses single verses, ranges (also across chapters and books) and negative votes', () => {
    expect(parseXrefLine('Gen.1.1\tZech.12.1\t49')).toEqual({ from: 1_001_001, start: 38_012_001, end: 0, votes: 49 });
    expect(parseXrefLine('Gen.1.1\tProv.8.22-Prov.8.30\t59\r')).toEqual({
      from: 1_001_001,
      start: 20_008_022,
      end: 20_008_030,
      votes: 59,
    });
    expect(parseXrefLine('Heb.11.3\tGen.1.1-Gen.2.1\t10')?.end).toBe(1_002_001);
    expect(parseXrefLine('Isa.44.28\t2Chr.36.22-Ezra.1.3\t9')).toMatchObject({ start: 14_036_022, end: 15_001_003 });
    expect(parseXrefLine('Gen.1.1\tExod.31.18\t-31')?.votes).toBe(-31);
    expect(parseXrefLine('Gen.1.1\tExod.31.18-Exod.31.18\t3')?.end).toBe(0); // degenerate range = single verse
  });

  it('throws on malformed lines', () => {
    expect(() => parseXrefLine('Gen.1.1\tExod.31.18')).toThrow(/3 tab-separated/);
    expect(() => parseXrefLine('Gen.1.1\tExod.31.18\tmany')).toThrow(/vote/);
    expect(() => parseXrefLine('Gen.1.1\tExod.31.18-Exod.31.2\t4')).toThrow(/ends before/);
    expect(() => parseXrefLine('Gen.1.1\tMacc.1.1\t4')).toThrow(/unknown OSIS book/);
  });
});

describe('collectXrefs', () => {
  const { byVerse, stats } = collectXrefs(rows(FIXTURE), verseCount);
  const at = (b: number, c: number, v: number) => byVerse.get(packRef(b, c, v));

  it('drops votes <= 0 and self references, keeps the best vote of duplicates, sorts by votes', () => {
    expect(at(1, 1, 1)).toEqual([
      [19_033_009, 0, 72],
      [44_014_015, 0, 62], // duplicate with 3 votes dropped
      [20_008_022, 20_008_030, 59],
      [38_012_001, 0, 49],
      [13_016_026, 0, 43],
      [18_026_013, 0, 29],
    ]);
    expect(stats.droppedVotes).toBe(2); // -31 and 0
    expect(stats.lines).toBe(30);
  });

  it('breaks vote ties in canonical order', () => {
    expect(at(1, 1, 2)?.map((t) => t[0])).toEqual([18_026_013, 19_104_030, 23_040_012]);
    expect(at(40, 5, 3)).toEqual([
      [33_006_008, 0, 26],
      [14_033_019, 0, 11],
      [19_128_001, 0, 10],
      [66_019_009, 0, 10],
    ]);
  });

  it('drops ranges that contain the source verse (the passage being read)', () => {
    expect(at(3, 3, 6)).toEqual([
      [3_001_010, 0, 2],
      [49_002_013, 49_002_022, 2],
    ]);
    expect(stats.droppedSelf).toBe(2); // Gen 1:1 -> Gen 1:1 and Lev 3:6 -> Lev 3:1–17
  });

  it('keeps ranges across chapters and books with both ends', () => {
    expect(at(58, 11, 3)).toEqual([[1_001_001, 1_002_001, 10]]);
    expect(at(23, 44, 28)).toEqual([[14_036_022, 15_001_003, 9]]);
  });

  it('maps ESV 3 John 1:15 to English 3 John 1:14 (as source, target and range end)', () => {
    expect(at(64, 1, 15)).toBeUndefined();
    // 3 John 1:14 -> Gen 43:23 (2 votes) merged with 3 John 1:15 -> Gen 43:23 (5 votes)
    expect(at(64, 1, 14)).toEqual([
      [1_043_023, 0, 5],
      [43_010_003, 0, 2],
    ]);
    expect(at(63, 1, 1)).toEqual([[63_001_013, 64_001_014, 4]]);
    expect(stats.remapped).toBe(3);
    expect(stats.droppedDuplicate).toBe(2);
    expect(stats.outOfRange).toEqual([]);
  });

  it('counts what it kept', () => {
    const total = [...byVerse.values()].reduce((n, t) => n + t.length, 0);
    expect(stats.kept).toBe(total);
    expect(stats.verses).toBe(byVerse.size);
    expect(stats.maxPerVerse).toBe(6);
    expect(stats.lines).toBe(stats.kept + stats.droppedVotes + stats.droppedSelf + stats.droppedDuplicate + stats.droppedCap);
  });

  it('caps each verse, keeping the most-voted targets', () => {
    const capped = collectXrefs(rows(FIXTURE), verseCount, 2);
    expect(capped.byVerse.get(1_001_001)?.map((t) => t[2])).toEqual([72, 62]);
    expect(capped.stats.droppedCap).toBeGreaterThan(0);
    expect(capped.stats.maxPerVerse).toBe(2);
    expect(XREF_CAP).toBe(40);
  });

  it('drops refs outside English versification and clamps overlong range ends', () => {
    const { byVerse: bv, stats: st } = collectXrefs(
      rows('Gen.1.40\tJohn.1.1\t5\nGen.2.1\tJohn.1.99\t5\nGen.2.2\tGen.1.30-Gen.1.40\t5\nGen.2.3\tGen.1.30\t5'),
      verseCount,
    );
    expect(st.outOfRange).toEqual([
      ['GEN 1:40', 1],
      ['JHN 1:99', 1],
    ]);
    expect(st.clampedEnds).toBe(1);
    expect(bv.get(1_002_002)).toEqual([[1_001_030, 1_001_031, 5]]);
    expect(bv.get(1_002_003)).toEqual([[1_001_030, 0, 5]]);
  });
});

describe('toChapters', () => {
  it('produces every chapter of the canon, with targets under string verse keys', () => {
    const chapters = toChapters(collectXrefs(rows(FIXTURE), verseCount).byVerse);
    expect(chapters).toHaveLength(1189);
    const gen1 = chapters.find((c) => c.book === 'GEN' && c.chapter === 1)!;
    expect(Object.keys(gen1.verses)).toEqual(['1', '2']);
    expect(chapters.find((c) => c.book === 'EXO' && c.chapter === 1)).toEqual({ book: 'EXO', chapter: 1, verses: {} });
    expect(chapters.find((c) => c.book === '3JN')?.verses['14']).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------ */
/* Browser module                                                            */
/* ------------------------------------------------------------------------ */

const PRO8: XrefTarget = [20_008_022, 20_008_030, 59];
const JHN1: XrefTarget = [43_001_001, 0, 304];
const GEN1_2: XrefTarget = [1_001_001, 1_002_003, 12];
const CHR_EZR: XrefTarget = [14_036_022, 15_001_003, 9];
const JUDE3: XrefTarget = [65_001_003, 0, 4];

const MAT5: XrefChapter = {
  book: 'MAT',
  chapter: 5,
  verses: {
    '3': [
      [33_006_008, 0, 26],
      [14_033_019, 0, 11],
      [19_128_001, 0, 10],
      [66_019_009, 0, 10],
    ],
    '4': [
      [23_061_002, 23_061_003, 19],
      [19_128_001, 0, 14],
      [40_005_003, 0, 8],
    ],
    '10': [[40_005_011, 40_005_012, 30]],
  },
};

function mockFetch(files: Record<string, unknown>, status: Record<string, number> = {}) {
  return vi.fn(async (url: string) => {
    const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
    if (status[path]) return new Response('error', { status: status[path] });
    if (!(path in files)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(files[path]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('loadXrefs', () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  beforeEach(() => {
    configureData({ base: '/data/', fetch: vi.fn() });
    fetchMock = mockFetch({ 'xref/MAT/5.json': MAT5 }, { 'xref/MAT/6.json': 500 });
    configureXrefs({ fetch: fetchMock });
  });

  it('fetches a chapter from the data directory, de-duplicates and caches it', async () => {
    const [a, b] = await Promise.all([loadXrefs('MAT', 5), loadXrefs('mat', 5)]);
    expect(a).toBe(b);
    expect(a.verses['3']).toHaveLength(4);
    expect(await loadXrefs('MAT', 5)).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/data/xref/MAT/5.json');
  });

  it('resolves a missing file to an empty chapter', async () => {
    expect(await loadXrefs('GEN', 3)).toEqual({ book: 'GEN', chapter: 3, verses: {} });
  });

  it('rejects other HTTP errors with DataError and does not cache them', async () => {
    await expect(loadXrefs('MAT', 6)).rejects.toBeInstanceOf(DataError);
    await expect(loadXrefs('MAT', 6)).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('wraps network failures', async () => {
    configureXrefs({ fetch: vi.fn(async () => Promise.reject(new TypeError('offline'))) });
    await expect(loadXrefs('MAT', 5)).rejects.toMatchObject({ name: 'DataError', status: 0 });
  });

  it('rejects unknown books and chapters without fetching', async () => {
    await expect(loadXrefs('XYZ', 1)).rejects.toThrow(/No such chapter/);
    await expect(loadXrefs('GEN', 51)).rejects.toThrow(/No such chapter/);
    await expect(loadXrefs('GEN', 0)).rejects.toThrow(/No such chapter/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults to the global fetch', async () => {
    const globalMock = mockFetch({ 'xref/MAT/5.json': MAT5 });
    vi.stubGlobal('fetch', globalMock);
    try {
      configureXrefs({ fetch: null });
      expect((await loadXrefs('MAT', 5)).chapter).toBe(5);
      expect(globalMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('selecting targets', () => {
  it('xrefsForVerse applies minVotes and limit, and tolerates a missing chapter', () => {
    expect(xrefsForVerse(MAT5, 3)).toEqual(MAT5.verses['3']);
    expect(xrefsForVerse(MAT5, 3)).not.toBe(MAT5.verses['3']); // a copy
    expect(xrefsForVerse(MAT5, 3, { limit: 2 }).map((t) => t[2])).toEqual([26, 11]);
    expect(xrefsForVerse(MAT5, 3, { minVotes: 11 }).map((t) => t[2])).toEqual([26, 11]);
    expect(xrefsForVerse(MAT5, 3, { minVotes: 10, limit: 3 })).toHaveLength(3);
    expect(xrefsForVerse(MAT5, 3, { limit: 0 })).toEqual([]);
    expect(xrefsForVerse(MAT5, 7)).toEqual([]);
    expect(xrefsForVerse(null, 3)).toEqual([]);
  });

  it('xrefsForVerses merges a passage, dropping targets inside it', () => {
    const merged = xrefsForVerses(MAT5, [3, 4]);
    // Ps 128:1 is in both (10 and 14 votes: keeps 14); Matt 5:4 -> Matt 5:3 is inside the selection.
    expect(merged).toEqual([
      [33_006_008, 0, 26],
      [23_061_002, 23_061_003, 19],
      [19_128_001, 0, 14],
      [14_033_019, 0, 11],
      [66_019_009, 0, 10],
    ]);
    expect(xrefsForVerses(MAT5, [4])).toContainEqual([40_005_003, 0, 8]);
    expect(xrefsForVerses(MAT5, [10, 11, 12])).toEqual([]);
    expect(xrefsForVerses(MAT5, [10, 11])).toEqual([[40_005_011, 40_005_012, 30]]); // range only partly selected
    expect(xrefsForVerses(MAT5, [3, 4], { limit: 2 })).toHaveLength(2);
    expect(xrefsForVerses(undefined, [1])).toEqual([]);
  });

  it('counts targets and lists verses that have any', () => {
    expect(xrefCount(MAT5, 4)).toBe(3);
    expect(xrefCount(MAT5, 4, 10)).toBe(2);
    expect(versesWithXrefs(MAT5)).toEqual([3, 4, 10]);
    expect(versesWithXrefs(MAT5, 20)).toEqual([3, 10]);
    expect(versesWithXrefs(null)).toEqual([]);
  });

  it('orders targets by votes, then canonically', () => {
    const list: XrefTarget[] = [JUDE3, [1_001_001, 0, 4], [1_001_001, 1_001_003, 4], PRO8];
    expect([...list].sort(compareXrefTargets)).toEqual([PRO8, [1_001_001, 0, 4], [1_001_001, 1_001_003, 4], JUDE3]);
    expect([...list].sort(compareXrefCanonical)[3]).toBe(JUDE3);
  });
});

describe('reading and formatting targets', () => {
  it('formats single verses and ranges in short (default) and long style', () => {
    expect(formatXrefTarget(PRO8)).toBe('Prov 8:22–30');
    expect(formatXrefTarget(PRO8, 'long')).toBe('Proverbs 8:22–30');
    expect(formatXrefTarget(JHN1)).toBe('John 1:1');
    expect(formatXrefTarget([19_033_006, 0, 1])).toBe('Ps 33:6');
    expect(formatXrefTarget([19_023_001, 19_023_006, 1], 'long')).toBe('Psalm 23:1–6');
    expect(formatXrefTarget([13_016_026, 0, 1])).toBe('1 Chr 16:26');
  });

  it('formats ranges across chapters and books, and single-chapter books', () => {
    expect(formatXrefTarget(GEN1_2)).toBe('Gen 1:1–2:3');
    expect(formatXrefTarget(GEN1_2, 'long')).toBe('Genesis 1:1–2:3');
    expect(formatXrefTarget(CHR_EZR)).toBe('2 Chr 36:22–Ezra 1:3');
    expect(formatXrefTarget(JUDE3)).toBe('Jude 3');
    expect(formatXrefTarget([57_001_004, 57_001_007, 1])).toBe('Phlm 4–7');
    expect(formatXrefTarget([63_001_013, 64_001_014, 4])).toBe('2 John 13–3 John 14');
  });

  it('unpacks both ends', () => {
    expect(xrefStart(PRO8)).toEqual({ book: 'PRO', bookNum: 20, chapter: 8, verse: 22 });
    expect(xrefEnd(PRO8)).toEqual({ book: 'PRO', bookNum: 20, chapter: 8, verse: 30 });
    expect(xrefEnd(JHN1)).toEqual(xrefStart(JHN1));
    expect(isXrefRange(PRO8)).toBe(true);
    expect(isXrefRange(JHN1)).toBe(false);
    expect(xrefKey(PRO8)).toBe('20008022-20008030');
    expect(xrefKey(JHN1)).toBe('43001001-43001001');
  });

  it('gives a VerseRef and a reading route', () => {
    expect(xrefToRef(PRO8)).toEqual({ book: 'PRO', chapter: 8, verse: 22, verseEnd: 30 });
    expect(xrefToRef(JHN1)).toEqual({ book: 'JHN', chapter: 1, verse: 1 });
    expect(xrefToRef(GEN1_2)).toEqual({ book: 'GEN', chapter: 1, verse: 1 }); // cross-chapter: first verse
    expect(xrefHash('KJV', PRO8)).toBe('#/KJV/PRO/8/22-30');
    expect(xrefHash('BSB', CHR_EZR)).toBe('#/BSB/2CH/36/22');
  });

  it('groups by testament and by book', () => {
    const list = [JHN1, PRO8, GEN1_2, JUDE3, [20_003_019, 0, 2] as XrefTarget];
    expect(xrefTestament(JHN1)).toBe('NT');
    expect(xrefTestament(PRO8)).toBe('OT');
    expect(xrefTestament([39_001_001, 0, 1])).toBe('OT'); // Malachi
    expect(xrefTestament([40_001_001, 0, 1])).toBe('NT'); // Matthew
    expect(groupXrefsByTestament(list)).toEqual({ OT: [PRO8, GEN1_2, [20_003_019, 0, 2]], NT: [JHN1, JUDE3] });
    expect(groupXrefsByTestament([])).toEqual({ OT: [], NT: [] });
    expect(groupXrefsByBook(list)).toEqual([
      { book: 'GEN', targets: [GEN1_2] },
      { book: 'PRO', targets: [PRO8, [20_003_019, 0, 2]] },
      { book: 'JHN', targets: [JHN1] },
      { book: 'JUD', targets: [JUDE3] },
    ]);
  });

  it('expands a target into single verses', () => {
    expect(expandXrefTarget(JHN1)).toEqual([{ book: 'JHN', chapter: 1, verse: 1 }]);
    const pro = expandXrefTarget(PRO8);
    expect(pro).toHaveLength(9);
    expect(pro[8]).toEqual({ book: 'PRO', chapter: 8, verse: 30 });
    expect(expandXrefTarget(PRO8, undefined, 3).map((r) => r.verse)).toEqual([22, 23, 24]);

    const meta = {
      books: [
        { id: 'GEN', verses: [31, 25] },
        { id: '2CH', verses: Array(36).fill(23) },
        { id: 'EZR', verses: [11] },
      ],
    } as unknown as DataMeta;
    const count = metaVerseCount(meta);
    expect(count('GEN', 2)).toBe(25);
    expect(count('EXO', 1)).toBeUndefined();
    const gen = expandXrefTarget(GEN1_2, count);
    expect(gen).toHaveLength(31 + 3);
    expect(gen[31]).toEqual({ book: 'GEN', chapter: 2, verse: 1 });
    const chrEzr = expandXrefTarget(CHR_EZR, count);
    expect(chrEzr.map((r) => `${r.book} ${r.chapter}:${r.verse}`)).toEqual([
      '2CH 36:22',
      '2CH 36:23',
      'EZR 1:1',
      'EZR 1:2',
      'EZR 1:3',
    ]);
    // Without verse counts a cross-chapter range stops where the first chapter's end is unknown.
    expect(expandXrefTarget(GEN1_2)).toEqual([{ book: 'GEN', chapter: 1, verse: 1 }]);
  });
});
