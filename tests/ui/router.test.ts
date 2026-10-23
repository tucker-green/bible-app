import { describe, expect, it } from 'vitest';
import { compareHash, DEFAULT_HASH, parseRoute, resolveTranslation, routeToHash } from '../../src/app/router';
import type { Route } from '../../src/app/router';

describe('hash routes', () => {
  it('parses reading routes', () => {
    expect(parseRoute('#/KJV/JHN/1')).toEqual({ name: 'read', tr: 'KJV', ref: { book: 'JHN', chapter: 1 } });
    expect(parseRoute('#/BSB/jhn/3/16')).toEqual({ name: 'read', tr: 'BSB', ref: { book: 'JHN', chapter: 3, verse: 16 } });
    expect(parseRoute('#/KJV/PSA/23/1-4')).toEqual({ name: 'read', tr: 'KJV', ref: { book: 'PSA', chapter: 23, verse: 1, verseEnd: 4 } });
  });

  it('round-trips every route kind', () => {
    const routes: Route[] = [
      { name: 'read', tr: 'KJV', ref: { book: 'JHN', chapter: 1 } },
      { name: 'read', tr: 'BSB', ref: { book: '1CO', chapter: 13, verse: 4, verseEnd: 7 } },
      { name: 'read', tr: 'YLT', ref: { book: 'PSA', chapter: 119, verse: 105 } },
      { name: 'about' },
      { name: 'search', q: 'G3056' },
      { name: 'search', q: 'living water & “faith”', tr: 'BSB' },
    ];
    for (const r of routes) expect(parseRoute(routeToHash(r))).toEqual(r);
  });

  it('treats an empty hash as "use the default"', () => {
    expect(parseRoute('')).toBeNull();
    expect(parseRoute('#')).toBeNull();
    expect(parseRoute('#/')).toBeNull();
    expect(DEFAULT_HASH).toBe('#/KJV/GEN/1');
  });

  it('reports unknown routes and impossible chapters as not found', () => {
    expect(parseRoute('#/KJV/XYZ/1')).toMatchObject({ name: 'notfound' });
    expect(parseRoute('#/KJV/JHN/99')).toMatchObject({ name: 'notfound' });
    expect(parseRoute('#/nothing-here')).toMatchObject({ name: 'notfound' });
  });

  it('accepts about and search case-insensitively, with a trailing slash', () => {
    expect(parseRoute('#/About/')).toEqual({ name: 'about' });
    expect(parseRoute('#/search?q=love&tr=KJV')).toEqual({ name: 'search', q: 'love', tr: 'KJV' });
    expect(parseRoute('#/search')).toEqual({ name: 'search', q: '' });
  });
});

describe('translation fallback', () => {
  const available = [{ id: 'KJV' }, { id: 'BSB' }, { id: 'WEB' }, { id: 'NIV' }];

  it('keeps available translations, matching case-insensitively', () => {
    expect(resolveTranslation('BSB', available)).toBe('BSB');
    expect(resolveTranslation('bsb', available)).toBe('BSB');
  });

  it('falls back to the KJV for unknown / unavailable translations', () => {
    expect(resolveTranslation('ESV', available)).toBe('KJV');
    expect(resolveTranslation('', available)).toBe('KJV');
  });

  it('falls back to the first available when even the KJV is missing', () => {
    expect(resolveTranslation('ESV', [{ id: 'BSB' }])).toBe('BSB');
  });

  it('leaves the request alone while translations are unknown', () => {
    expect(resolveTranslation('NIV', [])).toBe('NIV');
  });
});

describe('page routes (extension points)', () => {
  it('parses word study routes, normalising the Strong’s id', () => {
    expect(parseRoute('#/word/G3056')).toEqual({ name: 'word', id: 'G3056' });
    expect(parseRoute('#/word/g26')).toEqual({ name: 'word', id: 'G0026' });
    expect(parseRoute('#/word/H871a')).toEqual({ name: 'word', id: 'H0871a' });
    expect(parseRoute('#/word/love')).toMatchObject({ name: 'notfound' });
  });

  it('parses person, place and lineage routes', () => {
    expect(parseRoute('#/person/p0685')).toEqual({ name: 'person', id: 'p0685' });
    expect(parseRoute('#/place/L0123')).toEqual({ name: 'place', id: 'l0123' });
    expect(parseRoute('#/lineage/p0001/')).toEqual({ name: 'lineage', id: 'p0001' });
    expect(parseRoute('#/person/abraham')).toMatchObject({ name: 'notfound' });
  });

  it('parses compare routes with 2–3 translations', () => {
    expect(parseRoute('#/compare/KJV,BSB/JHN/3')).toEqual({ name: 'compare', trs: ['KJV', 'BSB'], book: 'JHN', chapter: 3 });
    expect(parseRoute('#/compare/kjv,bsb,web/jhn/3/16')).toEqual({ name: 'compare', trs: ['KJV', 'BSB', 'WEB'], book: 'JHN', chapter: 3, verse: 16 });
    expect(parseRoute('#/compare/KJV/JHN/3')).toMatchObject({ name: 'notfound' });
    expect(parseRoute('#/compare/KJV,KJV/JHN/3')).toMatchObject({ name: 'notfound' });
    expect(parseRoute('#/compare/KJV,BSB,WEB,ASV/JHN/3')).toMatchObject({ name: 'notfound' });
    expect(parseRoute('#/compare/KJV,BSB/JHN/99')).toMatchObject({ name: 'notfound' });
    expect(compareHash(['KJV', 'BSB'], 'JHN', 3, 16)).toBe('#/compare/KJV,BSB/JHN/3/16');
  });

  it('parses my study and round-trips every page route', () => {
    expect(parseRoute('#/study')).toEqual({ name: 'study' });
    const routes: Route[] = [
      { name: 'word', id: 'G3056' },
      { name: 'person', id: 'p0685' },
      { name: 'place', id: 'l0123' },
      { name: 'lineage', id: 'p0685' },
      { name: 'compare', trs: ['KJV', 'BSB'], book: 'PSA', chapter: 23 },
      { name: 'compare', trs: ['KJV', 'BSB', 'YLT'], book: 'JHN', chapter: 1, verse: 14 },
      { name: 'study' },
    ];
    for (const r of routes) expect(parseRoute(routeToHash(r))).toEqual(r);
  });
});
