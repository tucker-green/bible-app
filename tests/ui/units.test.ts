import { describe, expect, it } from 'vitest';
import {
  buildChapterModel,
  cleanGloss,
  contentRank,
  linkedUnits,
  primaryIndex,
  relatedUnits,
  unitOrigWords,
} from '../../src/components/reader/model';
import type { Unit } from '../../src/components/reader/model';
import type { TextChapter } from '../../src/lib/types';
import { GEN1_BSB, GEN1_ORIG, JHN1_KJV, JHN1_ORIG } from './fixtures';

const units = (pieces: (string | Unit)[]) => pieces.filter((p): p is Unit => typeof p !== 'string');

describe('unit grouping', () => {
  const model = buildChapterModel(JHN1_KJV, JHN1_ORIG, { alignment: 'strongs', tr: 'KJV' });

  it('merges consecutive words with identical link sets, keeping the space', () => {
    const v1 = units(model.verses[0].pieces);
    expect(v1.map((u) => u.text)).toEqual(['In', 'the beginning', 'was', 'the Word', 'and', 'the Word', 'was', 'with', 'God']);
    expect(v1[1]).toMatchObject({ links: [1], wordCount: 2, kind: 'linked' });
    expect(v1[3].links).toEqual([3, 4]);
  });

  it('reproduces the verse text exactly', () => {
    for (const v of model.verses) {
      const text = v.pieces.map((p) => (typeof p === 'string' ? p : p.text)).join('');
      const src = JHN1_KJV.verses.find((x) => x.v === v.v)!.t.map((t) => (typeof t === 'string' ? t : t[0])).join('');
      expect(text).toBe(src);
    }
  });

  it('does not merge across punctuation', () => {
    const t: TextChapter = { tr: 'X', book: 'JHN', chapter: 1, verses: [{ v: 1, t: [['God', [11]], ', ', ['God', [11]]] }] };
    const m = buildChapterModel(t, JHN1_ORIG);
    expect(units(m.verses[0].pieces).map((u) => u.text)).toEqual(['God', 'God']);
  });

  it('groups supplied words and lexicon-only words by their own keys', () => {
    const v2 = units(model.verses[1].pieces);
    expect(v2.map((u) => [u.text, u.kind])).toEqual([
      ['It is', 'supplied'],
      ['preferred', 'lexicon'],
      ['before me', 'lexicon'],
      ['the Word', 'linked'],
    ]);
    expect(v2[1]).toMatchObject({ strongs: ['G1096'], morphs: ['V-2RAI-3S'], forms: ['γεγονεν'] });
  });

  it('leaves unlinked untagged words as plain text', () => {
    const plain = model.verses[1].pieces.filter((p): p is string => typeof p === 'string').join('');
    expect(plain).toContain('so');
  });

  it('assigns sequential unit ids across the chapter', () => {
    expect(model.units.map((u) => u.id)).toEqual(model.units.map((_, i) => i));
    expect(model.units.every((u, i) => model.units[i] === u)).toBe(true);
  });

  it('marks bridged and low-confidence links as approximate', () => {
    const t: TextChapter = {
      tr: 'WEB',
      book: 'JHN',
      chapter: 1,
      verses: [{ v: 1, t: [['In', [0], { c: 0.6 }], ' ', ['beginning', [1]]] }],
    };
    const exact = buildChapterModel(t, JHN1_ORIG, { alignment: 'manual' });
    expect(units(exact.verses[0].pieces).map((u) => [u.approx, u.conf])).toEqual([
      [true, 0.6],
      [false, 1],
    ]);
    const bridged = buildChapterModel(t, JHN1_ORIG, { alignment: 'bridged' });
    expect(units(bridged.verses[0].pieces).every((u) => u.approx)).toBe(true);
  });

  it('keeps the lowest confidence of a merged unit', () => {
    const t: TextChapter = {
      tr: 'BSB',
      book: 'PSA',
      chapter: 23,
      verses: [],
      superscription: [['A', [0], { c: 0.5 }], ' ', ['Psalm', [0], { c: 0.9 }], ' ', ['of', [1], { c: 0.8 }], '.'],
    };
    const m = buildChapterModel(t, GEN1_ORIG);
    expect(m.superscription).not.toBeNull();
    const us = units(m.superscription!);
    expect(us.map((u) => [u.text, u.conf, u.verse])).toEqual([
      ['A Psalm', 0.5, 0],
      ['of', 0.8, 0],
    ]);
  });
});

describe('content word', () => {
  it('ranks nouns and verbs above articles, prepositions and particles', () => {
    expect(contentRank('N-NSM', 'grc')).toBeLessThan(contentRank('T-NSM', 'grc'));
    expect(contentRank('V-IAI-3S', 'grc')).toBe(0);
    expect(contentRank('PREP', 'grc')).toBe(3);
    expect(contentRank('Ncfsa', 'hbo')).toBe(0);
    expect(contentRank('R', 'hbo')).toBeGreaterThan(contentRank('Ncfsa', 'hbo'));
    expect(contentRank('To', 'hbo')).toBe(5);
    expect(contentRank('Sp3ms', 'hbo')).toBe(3);
  });

  it('picks the noun of article + noun and the root of prefix + root', () => {
    expect(primaryIndex(JHN1_ORIG, [3, 4])).toBe(4);
    expect(primaryIndex(GEN1_ORIG, [0, 1])).toBe(1);
    expect(primaryIndex(GEN1_ORIG, [5, 6])).toBe(6);
    expect(primaryIndex(GEN1_ORIG, [])).toBe(-1);
  });
});

describe('related words', () => {
  const model = buildChapterModel(JHN1_KJV, JHN1_ORIG, { alignment: 'strongs', tr: 'KJV' });
  const id = (text: string, nth = 0) => model.units.filter((u) => u.text === text)[nth].id;

  it('links units that share an original word', () => {
    // "the Word" in 1:1 (links 3,4) and in v2 (links 3,4) share the same original words
    const first = id('the Word', 0);
    const again = id('the Word', 2);
    expect(linkedUnits(model, first)).toEqual([first, again]);
  });

  it('marks other units of the same lexeme as related (not the linked ones)', () => {
    const first = id('the Word', 0);
    const second = id('the Word', 1); // the other λόγος (links 6,7)
    expect(relatedUnits(model, first)).toEqual([second]);
    expect(model.units[first].kinKey).toBe('G3056');
  });

  it('never marks function words as related', () => {
    const and = id('and');
    expect(model.units[and].kinKey).toBe('');
    expect(relatedUnits(model, and)).toEqual([]);
    const the = buildChapterModel(
      { tr: 'X', book: 'JHN', chapter: 1, verses: [{ v: 1, t: [['the', [3]], ' ', ['x', [4]], ' ', ['the', [6]]] }] },
      JHN1_ORIG,
    );
    expect(relatedUnits(the, 0)).toEqual([]);
  });

  it('relates lexicon-only units by their Strong’s number', () => {
    const t: TextChapter = {
      tr: 'KJV',
      book: 'JHN',
      chapter: 1,
      verses: [{ v: 1, t: [['Son', [], { s: ['G5207'], m: ['N-NSM'] }], ' ', 'and', ' ', ['son', [], { s: ['G5207'], m: ['N-ASM'] }]] }],
    };
    const m = buildChapterModel(t, JHN1_ORIG);
    expect(relatedUnits(m, 0)).toEqual([1]);
  });
});

describe('original words of a unit', () => {
  it('joins Hebrew morphemes of one written word without a space', () => {
    expect(unitOrigWords(GEN1_ORIG, [0, 1])).toEqual([{ text: 'בְּרֵאשִׁית', translit: 'bərēʾšiyṯ', gloss: 'in beginning' }]);
    expect(unitOrigWords(GEN1_ORIG, [5, 6]).map((s) => s.text)).toEqual(['הַשָּׁמַיִם']);
  });

  it('keeps Greek words separate', () => {
    expect(unitOrigWords(JHN1_ORIG, [10, 11]).map((s) => s.text)).toEqual(['τὸν', 'θεόν']);
  });

  it('cleans Macula gloss notation', () => {
    expect(cleanGloss('makes.me.lie.down')).toBe('makes me lie down');
    expect(cleanGloss('[direct object]')).toBe('');
    expect(cleanGloss('(et) heavens')).toBe('heavens');
  });

  it('builds a model for the BSB Genesis fixture', () => {
    const m = buildChapterModel(GEN1_BSB, GEN1_ORIG, { alignment: 'manual' });
    expect(units(m.verses[0].pieces).map((u) => u.text)).toEqual(['In the beginning', 'God', 'created', 'the heavens']);
  });
});
