import { describe, expect, it } from 'vitest';
import {
  findBook,
  formatChapter,
  formatReference,
  hashToRef,
  matchBookName,
  parseReference,
  refIncludes,
  refToHash,
} from '../src/lib/reference';

describe('parseReference', () => {
  const cases: [string, ReturnType<typeof parseReference>][] = [
    ['John 3:16', { book: 'JHN', chapter: 3, verse: 16 }],
    ['jn 3 16', { book: 'JHN', chapter: 3, verse: 16 }],
    ['Jn3:16', { book: 'JHN', chapter: 3, verse: 16 }],
    ['JHN.3.16', { book: 'JHN', chapter: 3, verse: 16 }],
    ['john 3.16', { book: 'JHN', chapter: 3, verse: 16 }],
    ['  John   3 : 16  ', { book: 'JHN', chapter: 3, verse: 16 }],
    ['1 Cor 13', { book: '1CO', chapter: 13 }],
    ['1co13:4-7', { book: '1CO', chapter: 13, verse: 4, verseEnd: 7 }],
    ['1 Cor. 13:4–7', { book: '1CO', chapter: 13, verse: 4, verseEnd: 7 }],
    ['First Corinthians 13', { book: '1CO', chapter: 13 }],
    ['1st Corinthians 13', { book: '1CO', chapter: 13 }],
    ['I Cor 13', { book: '1CO', chapter: 13 }],
    ['Ps 23', { book: 'PSA', chapter: 23 }],
    ['psalm 23:1–4', { book: 'PSA', chapter: 23, verse: 1, verseEnd: 4 }],
    ['Psalms 119:176', { book: 'PSA', chapter: 119, verse: 176 }],
    ['Song of Songs 2:4', { book: 'SNG', chapter: 2, verse: 4 }],
    ['Song of Solomon 2:4', { book: 'SNG', chapter: 2, verse: 4 }],
    ['Gen 1', { book: 'GEN', chapter: 1 }],
    ['Genesis', { book: 'GEN', chapter: 1 }],
    ['Romans', { book: 'ROM', chapter: 1 }],
    ['1 Corinthians', { book: '1CO', chapter: 1 }],
    ['Rev 22:21', { book: 'REV', chapter: 22, verse: 21 }],
    ['Phlm 4', { book: 'PHM', chapter: 1, verse: 4 }],
    ['Jude 3', { book: 'JUD', chapter: 1, verse: 3 }],
    ['Jude 1:3', { book: 'JUD', chapter: 1, verse: 3 }],
    ['Jude 1', { book: 'JUD', chapter: 1 }],
    ['3 John 4', { book: '3JN', chapter: 1, verse: 4 }],
    ['Obad 1-4', { book: 'OBA', chapter: 1, verse: 1, verseEnd: 4 }],
    ['II Kings 2', { book: '2KI', chapter: 2 }],
    ['ii kgs 2:11', { book: '2KI', chapter: 2, verse: 11 }],
    ['Second Samuel 7', { book: '2SA', chapter: 7 }],
    ['Mark 5', { book: 'MRK', chapter: 5 }],
    ['Job 38', { book: 'JOB', chapter: 38 }],
    ['Acts 2:38', { book: 'ACT', chapter: 2, verse: 38 }],
    ['is 53', { book: 'ISA', chapter: 53 }],
    ['so 2', { book: 'SNG', chapter: 2 }],
    ['am 5:24', { book: 'AMO', chapter: 5, verse: 24 }],
    ['Gene 1', { book: 'GEN', chapter: 1 }], // unambiguous prefix
    ['Philippians 2:5-11', { book: 'PHP', chapter: 2, verse: 5, verseEnd: 11 }],
    ['Phil 4:13', { book: 'PHP', chapter: 4, verse: 13 }],
    ['John 3:16-18', { book: 'JHN', chapter: 3, verse: 16, verseEnd: 18 }],
    ['John 3:16-3:18', { book: 'JHN', chapter: 3, verse: 16, verseEnd: 18 }],
    ['John 3:16-4:2', { book: 'JHN', chapter: 3, verse: 16 }], // cross-chapter: keep the start
    ['John 3:16a', { book: 'JHN', chapter: 3, verse: 16 }],
    ['John 3:16, 18', { book: 'JHN', chapter: 3, verse: 16 }],
    ['John 3,16', { book: 'JHN', chapter: 3, verse: 16 }],
    ['John 3 v 16', { book: 'JHN', chapter: 3, verse: 16 }],
    ['Gen 1-3', { book: 'GEN', chapter: 1 }],
    ['Genesis chapter 3', { book: 'GEN', chapter: 3 }],
    ['1CO 13', { book: '1CO', chapter: 13 }],
    ['john 3:16-16', { book: 'JHN', chapter: 3, verse: 16 }],
  ];
  for (const [input, expected] of cases) {
    it(`parses ${JSON.stringify(input)}`, () => {
      expect(parseReference(input)).toEqual(expected);
    });
  }

  it('treats ordinary words and word-like book names as text, not references', () => {
    for (const s of [
      'so', 'is', 'am', 'job', 'Job', 'mark', 'acts', 'John', 'love', 'in the beginning', 'I am', 'i am the way',
      'faith 3', '3 days', '7 seals', 'the 3', 'jo 3', 'Gen', 'rom', '', '   ', 'jesus wept',
    ]) {
      expect(parseReference(s), s).toBeNull();
    }
  });

  it('rejects impossible chapters and verses', () => {
    expect(parseReference('Gen 51')).toBeNull();
    expect(parseReference('Jude 2:1')).toBeNull();
    expect(parseReference('Ps 151')).toBeNull();
    expect(parseReference('John 0')).toBeNull();
    expect(parseReference('John 3:0')).toBeNull();
    expect(parseReference('John 3:200')).toBeNull();
    expect(parseReference('John 3:18-16')).toBeNull();
  });

  it('validates verses against a verse-count source when given', () => {
    const verseCount = (book: string, ch: number) => (book === 'JHN' && ch === 3 ? 36 : undefined);
    expect(parseReference('John 3:37', { verseCount })).toBeNull();
    expect(parseReference('John 3:36', { verseCount })).toEqual({ book: 'JHN', chapter: 3, verse: 36 });
    expect(parseReference('John 3:30-40', { verseCount })).toEqual({ book: 'JHN', chapter: 3, verse: 30, verseEnd: 36 });
  });
});

describe('findBook / matchBookName', () => {
  it('finds by id, name, alias and unambiguous prefix', () => {
    expect(findBook('JHN')?.id).toBe('JHN');
    expect(findBook('Revelation')?.id).toBe('REV');
    expect(findBook('revel')?.id).toBe('REV');
    expect(findBook('canticles')?.id).toBe('SNG');
    expect(findBook('jo')).toBeUndefined();
    expect(findBook('phi')).toBeUndefined(); // Philippians or Philemon
  });
  it('matchBookName recognises spelled-out names, including word-like ones', () => {
    expect(matchBookName('Job')?.id).toBe('JOB');
    expect(matchBookName('john')?.id).toBe('JHN');
    expect(matchBookName('2 Kings')?.id).toBe('2KI');
    expect(matchBookName('love')).toBeUndefined();
  });
});

describe('formatReference', () => {
  it('formats long and short styles', () => {
    expect(formatReference({ book: 'JHN', chapter: 3, verse: 16 })).toBe('John 3:16');
    expect(formatReference({ book: 'JHN', chapter: 3, verse: 16 }, 'short')).toBe('John 3:16');
    expect(formatReference({ book: '1CO', chapter: 13, verse: 4, verseEnd: 7 }, 'short')).toBe('1 Cor 13:4–7');
    expect(formatReference({ book: '1CO', chapter: 13, verse: 4, verseEnd: 7 })).toBe('1 Corinthians 13:4–7');
    expect(formatReference({ book: 'PSA', chapter: 23 })).toBe('Psalm 23');
    expect(formatReference({ book: 'PSA', chapter: 23 }, 'short')).toBe('Ps 23');
    expect(formatReference({ book: 'JUD', chapter: 1, verse: 3 })).toBe('Jude 3');
    expect(formatReference({ book: 'PHM', chapter: 1 })).toBe('Philemon');
    expect(formatReference({ book: 'PHM', chapter: 1, verse: 4 }, 'short')).toBe('Phlm 4');
    expect(formatChapter('GEN', 1)).toBe('Genesis 1');
  });
  it('round-trips through parseReference', () => {
    for (const s of ['John 3:16', '1 Corinthians 13:4–7', 'Psalm 23', 'Song of Songs 2:4', 'Jude 3', 'Genesis 1']) {
      const ref = parseReference(s);
      expect(ref, s).not.toBeNull();
      expect(formatReference(ref!)).toBe(s);
    }
  });
});

describe('hash routes', () => {
  it('builds hashes', () => {
    expect(refToHash('BSB', { book: 'JHN', chapter: 3, verse: 16 })).toBe('#/BSB/JHN/3/16');
    expect(refToHash('KJV', { book: 'GEN', chapter: 1 })).toBe('#/KJV/GEN/1');
    expect(refToHash('BSB', { book: 'JHN', chapter: 3, verse: 16, verseEnd: 18 })).toBe('#/BSB/JHN/3/16-18');
  });
  it('parses hashes', () => {
    expect(hashToRef('#/BSB/JHN/3/16')).toEqual({ tr: 'BSB', ref: { book: 'JHN', chapter: 3, verse: 16 } });
    expect(hashToRef('#/KJV/gen/1')).toEqual({ tr: 'KJV', ref: { book: 'GEN', chapter: 1 } });
    expect(hashToRef('/BSB/JHN/3/16-18')).toEqual({ tr: 'BSB', ref: { book: 'JHN', chapter: 3, verse: 16, verseEnd: 18 } });
    expect(hashToRef('#/BSB/1CO/13/')).toEqual({ tr: 'BSB', ref: { book: '1CO', chapter: 13 } });
    expect(hashToRef('#/search?q=love')).toBeNull();
    expect(hashToRef('#/BSB/XXX/1')).toBeNull();
    expect(hashToRef('#/BSB/GEN/51')).toBeNull();
    expect(hashToRef('')).toBeNull();
  });
  it('round-trips', () => {
    const ref = { book: 'REV', chapter: 22, verse: 21 };
    expect(hashToRef(refToHash('NIV', ref))).toEqual({ tr: 'NIV', ref });
  });
  it('refIncludes', () => {
    expect(refIncludes({ book: 'JHN', chapter: 3, verse: 16, verseEnd: 18 }, 17)).toBe(true);
    expect(refIncludes({ book: 'JHN', chapter: 3, verse: 16 }, 17)).toBe(false);
    expect(refIncludes({ book: 'JHN', chapter: 3 }, 1)).toBe(false);
  });
});
