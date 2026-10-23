/**
 * Concordance stage (scripts/data/concordance.ts): Macula's Hebrew prefix/suffix morpheme ids keep
 * their full id instead of being merged into an unrelated base number, and land in the chunk that
 * src/lib/data.ts requests for them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkIndex, indexChapter } from '../scripts/data/concordance';
import { strongsChunk } from '../src/lib/data';
import type { ConcChunk, OrigChapter, OrigWord } from '../src/lib/types';

const w = (strongs: string, verse: number): OrigWord => ['x', strongs, '', '', '', verse, '', 0, '', ''];
const chapter = (book: string, ch: number, words: OrigWord[]): OrigChapter => ({ book, chapter: ch, lang: 'hbo', edition: 'WLC', words });

describe('indexChapter with morpheme ids', () => {
  const morphemes = new Set(['H2050b', 'H0871a', 'H1886a', 'H2050c']);

  it('keys morpheme ids by their full id and never merges them into the base number', () => {
    const index = new Map<string, Set<number>>();
    // Gen 1:1-2: בְּ ... הַ ... וְ ; Ps 62:3: H2050 "to break in" (the only real H2050).
    indexChapter(index, 1, chapter('GEN', 1, [w('H0871a', 1), w('H7225', 1), w('H1886a', 1), w('H2050b', 1), w('H2050b', 2), w('H2050c', 2)]), morphemes);
    indexChapter(index, 19, chapter('PSA', 62, [w('H2050', 3), w('H2050a', 4)]), morphemes);
    expect([...index.keys()].sort()).toEqual(['H0871a', 'H1886a', 'H2050', 'H2050b', 'H2050c', 'H7225']);
    expect([...index.get('H2050b')!]).toEqual([1_001_001, 1_001_002]);
    expect([...index.get('H2050c')!]).toEqual([1_001_002]);
    // A lettered id that is not a morpheme still counts under its base number.
    expect([...index.get('H2050')!].sort()).toEqual([19_062_003, 19_062_004]);
  });

  it('folds every id to its base number when no morpheme set is given', () => {
    const index = new Map<string, Set<number>>();
    indexChapter(index, 1, chapter('GEN', 1, [w('H0871a', 1), w('H0871', 2)]));
    expect([...index.keys()]).toEqual(['H0871']);
  });

  it('writes extended keys into the same chunk as their base number, as data.ts expects', () => {
    const index = new Map<string, Set<number>>([
      ['H2050b', new Set([1_001_001])],
      ['H2050', new Set([19_062_003])],
      ['H0871a', new Set([1_001_001])],
    ]);
    const chunks = chunkIndex(index);
    expect(chunks.get('H/020')).toEqual({ H2050: [19_062_003], H2050b: [1_001_001] });
    expect(chunks.get('H/008')).toEqual({ H0871a: [1_001_001] });
    expect(strongsChunk('H2050b')).toBe('020');
    expect(strongsChunk('H0871a')).toBe('008');
  });
});

const CONC = join(process.cwd(), 'public', 'data', 'conc');

describe.skipIf(!existsSync(join(CONC, 'H', '020.json')))('generated concordance', () => {
  const chunk = (lang: string, n: string): ConcChunk => JSON.parse(readFileSync(join(CONC, lang, `${n}.json`), 'utf8'));

  it('lists the conjunction, article and prefixes under their own ids', () => {
    const h020 = chunk('H', '020');
    expect(h020.H2050b.length).toBeGreaterThan(15000); // וְ "and"
    expect(h020.H2050c.length).toBeGreaterThan(5000); // 3ms suffix "his"
    expect(h020.H2050.length).toBeLessThan(10); // הוּת "to break in"
    expect(chunk('H', '018').H1886a.length).toBeGreaterThan(10000); // הַ "the"
    expect(chunk('H', '008').H0871a.length).toBeGreaterThan(8000); // בְּ "in"
    expect(chunk('H', '008').H0871.length).toBeLessThan(10); // אֲתָרִים Atharim
  });

  it('stores only base ids and lettered Hebrew ids, sorted and de-duplicated', () => {
    for (const [lang, n] of [['G', '030'], ['H', '020'], ['H', '004']]) {
      for (const [id, refs] of Object.entries(chunk(lang, n))) {
        expect(id).toMatch(lang === 'G' ? /^G\d{4}$/ : /^H\d{4}[a-z]?$/);
        expect(strongsChunk(id)).toBe(n);
        expect([...new Set(refs)].sort((a, b) => a - b)).toEqual(refs);
      }
    }
  });
});
