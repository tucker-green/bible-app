/** My study page helpers (src/components/study/model.ts): grouping, search, marks, dates, counts. */
import { describe, expect, it } from 'vitest';
import {
  colorCounts,
  describeCounts,
  foldText,
  friendlyDate,
  groupByBook,
  markPieces,
  matchesQuery,
  plural,
  queryTerms,
  studyItems,
} from '../src/components/study/model';

describe('studyItems / groupByBook', () => {
  it('orders canonically, groups by book, skips invalid keys and applies a filter', () => {
    const map = { 'REV.1.3': 'a', 'JHN.3.16': 'b', 'GEN.1.1': 'c', 'JHN.1.1': 'd', 'PSA.23.1': 'e', 'junk.1.1': 'z' };
    const items = studyItems(map);
    expect(items.map((i) => i.key)).toEqual(['GEN.1.1', 'PSA.23.1', 'JHN.1.1', 'JHN.3.16', 'REV.1.3']);
    expect(items[1]).toMatchObject({ label: 'Psalm 23:1', ref: { book: 'PSA', chapter: 23, verse: 1 }, value: 'e' });
    const groups = groupByBook(items);
    expect(groups.map((g) => [g.name, g.items.length])).toEqual([
      ['Genesis', 1],
      ['Psalms', 1],
      ['John', 2],
      ['Revelation', 1],
    ]);
    expect(studyItems(map, (_k, v) => v === 'b').map((i) => i.key)).toEqual(['JHN.3.16']);
  });

  it('labels single-chapter books without a chapter', () => {
    expect(studyItems({ 'JUD.1.3': 1 })[0].label).toBe('Jude 3');
  });

  it('counts colours', () => {
    expect(colorCounts({ a: 'yellow', b: 'yellow', c: 'purple' })).toEqual({ yellow: 2, green: 0, blue: 0, pink: 0, purple: 1 });
  });
});

describe('search', () => {
  it('folds case, accents and curly quotes', () => {
    // (ə is a letter of its own, not an accented e)
    expect(foldText('Ἀγάπη “Love” bərēšîṯ')).toBe('αγαπη "love" bəresit');
    expect(queryTerms('  Born   AGAIN ')).toEqual(['born', 'again']);
    expect(queryTerms('   ')).toEqual([]);
  });

  it('needs every term, in the note or its reference', () => {
    expect(matchesQuery(['born', 'above'], 'Born again / from above', 'John 3:3')).toBe(true);
    expect(matchesQuery(['born', 'water'], 'Born again', 'John 3:3')).toBe(false);
    expect(matchesQuery(['john', '3'], 'nothing', 'John 3:3')).toBe(true);
    expect(matchesQuery([], 'x')).toBe(true);
    expect(matchesQuery(['resit'], 'bərēšîṯ')).toBe(true);
  });

  it('marks matches on the original text (accent-insensitive, merged, case kept)', () => {
    expect(markPieces('The LORD is my Shepherd; shepherd-king', ['shepherd'])).toEqual(['The LORD is my ', { mark: 'Shepherd' }, '; ', { mark: 'shepherd' }, '-king']);
    expect(markPieces('bərēšîṯ', ['res'])).toEqual(['bə', { mark: 'rēš' }, 'îṯ']);
    expect(markPieces('abcdef', ['bcd', 'cde'])).toEqual(['a', { mark: 'bcde' }, 'f']);
    expect(markPieces('<b>x</b>', ['x'])).toEqual(['<b>', { mark: 'x' }, '</b>']);
    expect(markPieces('plain', [])).toEqual(['plain']);
    expect(markPieces('plain', ['zzz'])).toEqual(['plain']);
  });
});

describe('dates and counts', () => {
  const now = new Date(2026, 9, 23, 12, 0, 0);
  const at = (d: Date) => d.toISOString();
  it('friendlyDate', () => {
    expect(friendlyDate(at(new Date(now.getTime() - 10_000)), now)).toBe('just now');
    expect(friendlyDate(at(new Date(now.getTime() - 5 * 60_000)), now)).toBe('5 minutes ago');
    expect(friendlyDate(at(new Date(now.getTime() - 3 * 3_600_000)), now)).toBe('3 hours ago');
    expect(friendlyDate(at(new Date(2026, 9, 22, 18)), now)).toBe('yesterday');
    expect(friendlyDate(at(new Date(2026, 9, 19, 9)), now)).toBe('4 days ago');
    expect(friendlyDate(at(new Date(2026, 2, 12)), now)).toBe('12 Mar');
    expect(friendlyDate(at(new Date(2024, 2, 12)), now)).toBe('12 Mar 2024');
    expect(friendlyDate('nope', now)).toBe('');
  });

  it('plural and describeCounts', () => {
    expect(plural(1, 'note')).toBe('1 note');
    expect(plural(1200, 'entry', 'entries')).toBe('1,200 entries');
    expect(describeCounts({ highlights: 2, notes: 1, bookmarks: 0 })).toBe('2 highlights and 1 note');
    expect(describeCounts({ highlights: 2, notes: 1, bookmarks: 3 })).toBe('2 highlights, 1 note and 3 bookmarks');
    expect(describeCounts({ highlights: 0, notes: 0, bookmarks: 1 })).toBe('1 bookmark');
    expect(describeCounts({ highlights: 0, notes: 0, bookmarks: 0 })).toBe('nothing');
  });
});
