import { afterEach, describe, expect, it } from 'vitest';
import {
  addRecent,
  bookCounts,
  clearRecent,
  groupByBook,
  isNameMatch,
  isPassageQuery,
  nameQuery,
  phraseSuggestion,
  readRecent,
  scriptRuns,
  searchTranslation,
  segments,
  testamentCounts,
} from '../../src/components/search/model';
import type { SearchHit } from '../../src/lib/search/client';
import { parseReference } from '../../src/lib/reference';

const hit = (bookNum: number, book: string, chapter: number, verse: number, text = 'x'): SearchHit => ({
  bookNum,
  book,
  chapter,
  verse,
  text,
  highlights: [],
});

afterEach(() => {
  localStorage.clear();
});

describe('segments (safe highlighting)', () => {
  it('splits text into plain and marked runs', () => {
    expect(segments('For God so loved the world', [[11, 16]])).toEqual([
      { text: 'For God so ', hit: false },
      { text: 'loved', hit: true },
      { text: ' the world', hit: false },
    ]);
  });

  it('sorts, merges overlaps and clamps bad spans without losing or duplicating text', () => {
    const text = 'In the beginning';
    const segs = segments(text, [
      [7, 16],
      [0, 2],
      [1, 6],
      [-5, 0],
      [14, 99],
      [9, 9],
    ]);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs).toEqual([
      { text: 'In the', hit: true },
      { text: ' ', hit: false },
      { text: 'beginning', hit: true },
    ]);
  });

  it('keeps markup in verse text as text', () => {
    const segs = segments('<b>love</b>', [[3, 7]]);
    expect(segs[1]).toEqual({ text: 'love', hit: true });
    expect(segs.map((s) => s.text).join('')).toBe('<b>love</b>');
  });

  it('handles no spans and empty text', () => {
    expect(segments('abc', undefined)).toEqual([{ text: 'abc', hit: false }]);
    expect(segments('', [])).toEqual([{ text: '', hit: false }]);
  });
});

describe('grouping and facets', () => {
  it('groups consecutive hits by book', () => {
    const groups = groupByBook([hit(1, 'GEN', 1, 1), hit(1, 'GEN', 2, 3), hit(43, 'JHN', 3, 16)]);
    expect(groups.map((g) => [g.book, g.name, g.hits.length])).toEqual([
      ['GEN', 'Genesis', 2],
      ['JHN', 'John', 1],
    ]);
  });

  it('counts verses per testament from byBook', () => {
    expect(testamentCounts({ 1: 3, 39: 2, 40: 5, 66: 1 })).toEqual({ all: 11, OT: 5, NT: 6 });
    expect(testamentCounts(undefined)).toEqual({ all: 0, OT: 0, NT: 0 });
  });

  it('lists books with matches in canonical order, optionally one testament', () => {
    const byBook = { 43: 4, 1: 2, 19: 9 };
    expect(bookCounts(byBook).map((b) => [b.book.id, b.count])).toEqual([
      ['GEN', 2],
      ['PSA', 9],
      ['JHN', 4],
    ]);
    expect(bookCounts(byBook, 'NT').map((b) => b.book.id)).toEqual(['JHN']);
  });
});

describe('searchTranslation', () => {
  it('searches a bundled translation’s own corpus', () => {
    expect(searchTranslation('BSB', ['KJV', 'BSB'])).toEqual({ tr: 'BSB', fallback: false });
  });

  it('falls back to the KJV for runtime translations without a corpus', () => {
    expect(searchTranslation('NIV', ['KJV', 'BSB'], ['NIV'])).toEqual({ tr: 'KJV', fallback: true });
    expect(searchTranslation('XYZ', ['KJV', 'BSB'])).toEqual({ tr: 'KJV', fallback: true });
  });

  it('trusts the requested translation while meta.json is loading unless it is remote', () => {
    expect(searchTranslation('WEB', [])).toEqual({ tr: 'WEB', fallback: false });
    expect(searchTranslation('NIV', [], ['NIV'])).toEqual({ tr: 'KJV', fallback: true });
  });
});

describe('query classification', () => {
  it('treats references with a chapter as passages, bare book names as searches', () => {
    expect(isPassageQuery('Rom 8:28', parseReference('Rom 8:28'))).toBe(true);
    expect(isPassageQuery('ps 23', parseReference('ps 23'))).toBe(true);
    expect(isPassageQuery('Genesis', parseReference('Genesis'))).toBe(false);
    expect(isPassageQuery('love', parseReference('love'))).toBe(false);
  });

  it('recognises name-like queries only', () => {
    expect(nameQuery(' Abraham ')).toBe('Abraham');
    expect(nameQuery('Mary Magdalene')).toBe('Mary Magdalene');
    expect(nameQuery('faith OR hope')).toBeNull();
    expect(nameQuery('"in the beginning"')).toBeNull();
    expect(nameQuery('-works')).toBeNull();
    expect(nameQuery('G3056')).toBeNull();
    expect(nameQuery('λόγος')).toBeNull();
    expect(nameQuery('a')).toBeNull();
  });

  it('matches names at the start of a word, not in the middle', () => {
    expect(isNameMatch('Mary Magdalene', 'magd')).toBe(true);
    expect(isNameMatch('Abraham', 'abra')).toBe(true);
    expect(isNameMatch('Abraham', 'raham')).toBe(false);
  });

  it('offers the exact phrase for several plain words', () => {
    expect(phraseSuggestion('in the beginning')).toEqual({ query: '"in the beginning"', label: 'Only the exact phrase “in the beginning”' });
    expect(phraseSuggestion('love')).toBeNull();
    expect(phraseSuggestion('"in the beginning"')).toBeNull();
    expect(phraseSuggestion('faith OR hope')).toBeNull();
  });

  it('wraps Greek and Hebrew runs for lang attributes', () => {
    expect(scriptRuns('Greek λόγος (G3056)')).toEqual([{ text: 'Greek ' }, { text: 'λόγος', lang: 'grc' }, { text: ' (G3056)' }]);
    expect(scriptRuns('Hebrew שָׁלוֹם')).toEqual([{ text: 'Hebrew ' }, { text: 'שָׁלוֹם', lang: 'he' }]);
    expect(scriptRuns('plain')).toEqual([{ text: 'plain' }]);
  });
});

describe('recent searches', () => {
  it('keeps the latest six, most recent first, without duplicates', () => {
    for (const q of ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7']) addRecent(q);
    addRecent('C3');
    expect(readRecent()).toEqual(['C3', 'g7', 'f6', 'e5', 'd4', 'b2']);
    clearRecent();
    expect(readRecent()).toEqual([]);
  });

  it('survives garbage in storage', () => {
    localStorage.setItem('rootword:recentSearches', '{"no":1}');
    expect(readRecent()).toEqual([]);
    localStorage.setItem('rootword:recentSearches', '[1, "love", null]');
    expect(readRecent()).toEqual(['love']);
  });
});
