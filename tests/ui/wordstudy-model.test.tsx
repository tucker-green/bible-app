/** Pure helpers of the word-study page (src/components/wordstudy/model.ts, WordChips.bridgeCut). */
import { describe, expect, it } from 'vitest';
import {
  bookCountOf,
  bookOptions,
  chaptersOf,
  distributionSummary,
  formTable,
  groupRefsByBook,
  isAramaicEntry,
  lexIndexMap,
  lexSource,
  listAnd,
  lookupBrief,
  markTokens,
  pct,
  plural,
  renderingGroups,
  splitStrongs,
  strongsLabel,
  strongsMatcher,
  verseRuns,
  wordHash,
} from '../../src/components/wordstudy/model';
import { bridgeCut } from '../../src/components/wordstudy/WordChips';
import type { OrigChapter, OrigWord, Token, WordStudy, WordStudyChunk } from '../../src/lib/types';
import { packRef } from '../../src/lib/types';

const w = (text: string, strongs: string): OrigWord => [text, strongs, text, '', '', 1, '', 0, '', ''];
const byBook = (counts: Record<number, number>) => Array.from({ length: 66 }, (_, i) => counts[i + 1] ?? 0);
const study = (id: string, counts: Record<number, number>, extra: Partial<WordStudy> = {}): WordStudy => {
  const b = byBook(counts);
  return { id, total: b.reduce((s, n) => s + n, 0), byBook: b, forms: [], ...extra };
};

describe('numbers and words', () => {
  it('formats shares, plurals and lists', () => {
    expect(pct(127, 247)).toBe('51%');
    expect(pct(1, 2000)).toBe('<1%');
    expect(pct(0, 10)).toBe('0%');
    expect(pct(5, 0)).toBe('0%');
    expect(pct(999, 1000)).toBe('99%');
    expect(pct(10, 10)).toBe('100%');
    expect(plural(1, 'verse')).toBe('1 verse');
    expect(plural(2248, 'verse')).toBe('2,248 verses');
    expect(listAnd(['a'])).toBe('a');
    expect(listAnd(['a', 'b', 'c'])).toBe('a, b and c');
    expect(strongsLabel('G0026')).toBe('G26');
    expect(strongsLabel('H0871a')).toBe('H871a');
    expect(wordHash('g26')).toBe('#/word/G0026');
  });
});

describe('strongsMatcher', () => {
  it('matches a base id and its extended forms', () => {
    const m = strongsMatcher('H2617');
    expect(m('H2617')).toBe(true);
    expect(m('H2617a')).toBe(true);
    expect(m('H2617b')).toBe(true);
    expect(m('H2618')).toBe(false);
    expect(m('')).toBe(false);
    expect(strongsMatcher('G26')('G0026')).toBe(true);
  });

  it('keeps Hebrew prefix/suffix morphemes apart from their base number', () => {
    const chunk: WordStudyChunk = {
      H2050: { id: 'H2050', total: 1, byBook: byBook({}), forms: [] },
      H2050b: { id: 'H2050b', total: 50000, byBook: byBook({}), forms: [] },
    };
    const base = strongsMatcher('H2050', chunk);
    expect(base('H2050')).toBe(true);
    expect(base('H2050b')).toBe(false); // 'and' is its own word
    const and = strongsMatcher('H2050b', chunk);
    expect(and('H2050b')).toBe(true);
    expect(and('H2050')).toBe(false);
    expect(and('H2050c')).toBe(false);
  });
});

describe('marking the English words', () => {
  const orig: OrigChapter = { book: 'PSA', chapter: 136, lang: 'hbo', edition: 'WLC', words: [w('הוֹדוּ', 'H3034'), w('חַסְדּ', 'H2617a'), w('וֹ', 'H2050c')] };
  const tokens: Token[] = [['give', [0]], ' ', ['thanks', [0]], '; for ', ['his', [2]], ' ', ['loving', [1]], ' ', ['devotion', [1]], '; ', ['mercy', [], { s: ['H2617'] }], '.'];

  it('marks tokens linked to the word or tagged with it', () => {
    const marked = markTokens(tokens, orig, strongsMatcher('H2617'));
    expect([...marked]).toEqual([6, 8, 10]);
    expect(markTokens(tokens, null, strongsMatcher('H2617'))).toEqual(new Set([10]));
  });

  it('joins marked words separated only by spaces', () => {
    const marked = markTokens(tokens, orig, strongsMatcher('H2617'));
    const runs = verseRuns(tokens, marked);
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(['loving devotion', 'mercy']);
    expect(runs.map((r) => r.text).join('')).toBe('give thanks; for his loving devotion; mercy.');
  });
});

describe('occurrence grouping', () => {
  const refs = [packRef(40, 5, 32), packRef(40, 5, 37), packRef(40, 7, 24), packRef(44, 1, 1), packRef(66, 19, 13)];
  it('groups by book and lists chapters once', () => {
    const groups = groupRefsByBook(refs);
    expect(groups.map((g) => [g.book, g.refs.length, g.section])).toEqual([
      ['MAT', 3, 'gospels'],
      ['ACT', 1, 'acts'],
      ['REV', 1, 'revelation'],
    ]);
    expect(chaptersOf(refs)).toEqual([
      { book: 'MAT', chapter: 5 },
      { book: 'MAT', chapter: 7 },
      { book: 'ACT', chapter: 1 },
      { book: 'REV', chapter: 19 },
    ]);
    expect(bookOptions(groups).map((o) => [o.name, o.books.map((b) => b.name)])).toEqual([
      ['Gospels', ['Matthew']],
      ['Acts', ['Acts']],
      ['Revelation', ['Revelation']],
    ]);
  });
});

describe('distributionSummary', () => {
  it('names the top books', () => {
    expect(distributionSummary(study('G3056', { 40: 33, 43: 40, 44: 65, 42: 33 }))).toBe('Most often in Acts (65), John (40) and Matthew (33).');
  });
  it('says when one book holds most of them', () => {
    expect(distributionSummary(study('H2617', { 19: 127, 1: 11, 10: 12, 23: 97 }))).toBe('Over half are in Psalms (127 of 247).');
    expect(distributionSummary(study('H9999', { 19: 90, 1: 10 }))).toBe('Most are in Psalms (90 of 100).');
    expect(distributionSummary(study('G9999', { 66: 3 }))).toBe('Only in Revelation.');
    expect(distributionSummary(study('G9998', {}))).toBe('');
    expect(bookCountOf(study('G3056', { 40: 1, 43: 2 }))).toBe(2);
  });
});

describe('formTable', () => {
  it('lifts the part of speech every Greek form shares', () => {
    const t = formTable(study('G3056', { 43: 3 }, { forms: [['λόγον', 'N-ASM', 2], ['λόγος', 'N-NSM', 1]] }), 'grc');
    expect(t.shared).toEqual(['Noun']);
    expect(t.rows.map((r) => r.parsing)).toEqual(['Accusative singular masculine', 'Nominative singular masculine']);
  });
  it('lifts shared Hebrew segments too and keeps what differs', () => {
    const t = formTable(study('H2617', { 19: 3 }, { forms: [['חֶסֶד', 'Ncmsa', 2], ['חַסְדּוֹ', 'Ncmsc', 1], ['?', '', 1]] }), 'hbo');
    expect(t.shared).toEqual(['Noun', 'common']);
    expect(t.rows.map((r) => r.parsing)).toEqual(['Masculine singular absolute', 'Masculine singular construct', '—']);
  });
  it('keeps everything when the forms differ in part of speech', () => {
    const t = formTable(study('G9999', { 43: 2 }, { forms: [['λέγει', 'V-PAI-3S', 1], ['λόγος', 'N-NSM', 1]] }), 'grc');
    expect(t.shared).toEqual([]);
    expect(t.rows[0].parsing.startsWith('Verb · ')).toBe(true);
  });
});

describe('lexicon text', () => {
  it('finds Strong’s numbers in derivation notes', () => {
    expect(splitStrongs('from G25 (ἀγαπάω)')).toEqual([
      { t: 'text', v: 'from ' },
      { t: 'id', id: 'G0025', label: 'G25' },
      { t: 'text', v: ' (ἀγαπάω)' },
    ]);
    const parts = splitStrongs('plural of H433; compare H3068G and H0871a.');
    expect(parts.filter((p) => p.t === 'id').map((p) => (p.t === 'id' ? p.id : ''))).toEqual(['H0433', 'H3068G', 'H0871a']);
    // not inside words, not without digits
    expect(splitStrongs('AG25 G G-12 HG1x')).toEqual([{ t: 'text', v: 'AG25 G G-12 HG1x' }]);
  });

  it('names the dictionary and spots Aramaic entries', () => {
    expect(lexSource({ id: 'G3056', def: 'x' })).toMatch(/Abbott-Smith/);
    expect(lexSource({ id: 'H2617', def: 'x' })).toMatch(/Brown-Driver-Briggs/);
    expect(lexSource({ id: 'H2617', def: '' })).toBe('Strong’s dictionary');
    expect(isAramaicEntry({ deriv: '(Aramaic) corresponding to H433 (אֱלוֹהַּ)', pos: 'Noun' })).toBe(true);
    expect(isAramaicEntry({ deriv: 'from H2616', pos: 'Noun' })).toBe(false);
  });

  it('orders renderings like the translation picker', () => {
    const groups = renderingGroups({ BSB: [['love', 3]], KJV: [['love', 2]], XYZ: [['x', 1]] }, [
      { id: 'KJV', name: 'King James Version' },
      { id: 'BSB', name: 'Berean Standard Bible' },
    ]);
    expect(groups.map((g) => [g.tr, g.name])).toEqual([
      ['KJV', 'King James Version'],
      ['BSB', 'Berean Standard Bible'],
      ['XYZ', 'XYZ'],
    ]);
    expect(renderingGroups(undefined, [])).toEqual([]);
  });

  it('looks up lexicon briefs, with base ids finding their first extended entry', () => {
    const map = lexIndexMap([
      ['H2617a', 'חֶסֶד', 'chesed', 'kindness'],
      ['H2617b', 'חֶסֶד', 'chesed', 'reproach'],
      ['G3056', 'λόγος', 'logos', 'word'],
    ]);
    expect(lookupBrief(map, 'H2617')?.gloss).toBe('kindness');
    expect(lookupBrief(map, 'H2617b')?.gloss).toBe('reproach');
    expect(lookupBrief(map, 'G3056a')?.lemma).toBe('λόγος');
    expect(lookupBrief(null, 'G3056')).toBeUndefined();
  });
});

describe('bridgeCut', () => {
  it('shows the top three (with ties) and anything of 2% or more', () => {
    // λόγος: 668, 10, 10, 10, 6… (sum 723): the three tied at 10 stay up front
    expect(bridgeCut([668, 10, 10, 10, 6, 4, 3], 723)).toBe(10);
    // חֶסֶד: 142, 3, 3, 2, 1… (sum 158)
    expect(bridgeCut([142, 3, 3, 2, 1, 1], 158)).toBe(3);
    // a big spread: 2% of 2296 = 46 lets the 3rd (53) in, not the 4th (3)
    expect(bridgeCut([2153, 70, 53, 3], 2296)).toBe(46);
    expect(bridgeCut([15], 15)).toBe(1);
    expect(bridgeCut([], 0)).toBe(0);
  });
});
