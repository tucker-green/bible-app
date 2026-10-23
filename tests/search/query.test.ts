import { describe, expect, it } from 'vitest';
import { allowedBooks, foldTerm, parseQuery, positiveLeaves } from '../../src/lib/search/query';

describe('parseQuery', () => {
  it('parses plain words as an implicit AND', () => {
    expect(parseQuery('Faith  hope').root).toEqual({
      kind: 'and',
      nodes: [
        { kind: 'word', raw: 'Faith', term: 'faith', mode: 'exact' },
        { kind: 'word', raw: 'hope', term: 'hope', mode: 'exact' },
      ],
    });
  });

  it('folds possessives, punctuation and accents', () => {
    expect(foldTerm('God’s')).toBe('god');
    expect(foldTerm('love,')).toBe('love');
    expect(foldTerm('Naïve')).toBe('naive');
    expect(parseQuery('“light,”').root).toMatchObject({ kind: 'word', term: 'light' });
  });

  it('parses OR (tighter than AND), NOT and groups', () => {
    const q = parseQuery('love faith OR hope -fear');
    expect(q.root).toMatchObject({
      kind: 'and',
      nodes: [
        { kind: 'word', term: 'love' },
        { kind: 'or', nodes: [{ term: 'faith' }, { term: 'hope' }] },
        { kind: 'not', node: { term: 'fear' } },
      ],
    });
    expect(parseQuery('(faith | hope) NOT love').root).toMatchObject({
      kind: 'and',
      nodes: [{ kind: 'or' }, { kind: 'not', node: { term: 'love' } }],
    });
  });

  it('parses phrases, prefixes and forms', () => {
    expect(parseQuery('"in the beginning"').root).toEqual({
      kind: 'phrase',
      raw: 'in the beginning',
      terms: [
        { term: 'in', mode: 'exact' },
        { term: 'the', mode: 'exact' },
        { term: 'beginning', mode: 'exact' },
      ],
    });
    expect(parseQuery('“son of man”').root).toMatchObject({ kind: 'phrase' });
    expect(parseQuery('"love*"').root).toMatchObject({ kind: 'word', term: 'love', mode: 'prefix' });
    expect(parseQuery('lov*').root).toMatchObject({ kind: 'word', term: 'lov', mode: 'prefix' });
    expect(parseQuery('love~').root).toMatchObject({ kind: 'word', term: 'love', mode: 'forms' });
    expect(parseQuery('a*').errors).toHaveLength(1);
  });

  it('keeps hyphenated words whole but splits other punctuation like corpus text', () => {
    expect(parseQuery('seed-bearing').root).toMatchObject({ kind: 'word', term: 'seed-bearing' });
    expect(parseQuery('3:16').root).toEqual({
      kind: 'phrase',
      raw: '3:16',
      terms: [
        { term: '3', mode: 'exact' },
        { term: '16', mode: 'exact' },
      ],
    });
    expect(parseQuery('word/dee*').root).toMatchObject({ kind: 'phrase', terms: [{ term: 'word' }, { term: 'dee', mode: 'prefix' }] });
  });

  it('recognises Strong’s numbers', () => {
    for (const q of ['G26', 'g26', 'G0026', 'strongs:G26']) expect(parseQuery(q).root).toMatchObject({ kind: 'strongs', id: 'G0026' });
    expect(parseQuery('H430').root).toMatchObject({ kind: 'strongs', id: 'H0430' });
    expect(parseQuery('H871a').root).toMatchObject({ kind: 'strongs', id: 'H0871a' });
    expect(parseQuery('strongs:love').errors).toHaveLength(1);
  });

  it('recognises lemma queries', () => {
    expect(parseQuery('λόγος').root).toMatchObject({ kind: 'lemma', lang: 'grc', by: 'script', text: 'λόγος' });
    expect(parseQuery('שָׁלוֹם').root).toMatchObject({ kind: 'lemma', lang: 'hbo', by: 'script' });
    expect(parseQuery('greek:logos').root).toMatchObject({ kind: 'lemma', lang: 'grc', by: 'translit', text: 'logos' });
    expect(parseQuery('hebrew:shalom').root).toMatchObject({ kind: 'lemma', lang: 'hbo', by: 'translit' });
    expect(parseQuery('lemma:agape').root).toMatchObject({ kind: 'lemma', lang: 'any' });
    expect(parseQuery('greek:"λόγος"').root).toMatchObject({ kind: 'lemma', lang: 'grc', by: 'script' });
  });

  it('extracts scope filters', () => {
    expect(parseQuery('love in:John').filters).toEqual({ books: [43] });
    expect(parseQuery('love in:NT').filters).toEqual({ testament: 'NT' });
    expect(parseQuery('love in:gospels').filters.books).toEqual([40, 41, 42, 43]);
    expect(parseQuery('love book:Rom,1Cor').filters.books).toEqual([45, 46]);
    const bad = parseQuery('love in:Narnia');
    expect(bad.errors[0]).toMatch(/Narnia/);
    expect(bad.root).toMatchObject({ kind: 'word', term: 'love' });
  });

  it('is forgiving about broken syntax', () => {
    expect(parseQuery('(love').errors).toEqual(['Missing “)”']);
    expect(parseQuery('love)').errors).toEqual(['Unmatched “)”']);
    expect(parseQuery('OR love').root).toMatchObject({ kind: 'word', term: 'love' });
    expect(parseQuery('love OR').root).toMatchObject({ kind: 'word', term: 'love' });
    expect(parseQuery('"unclosed phrase').root).toMatchObject({ kind: 'phrase' });
    expect(parseQuery('').root).toBeNull();
    expect(parseQuery('   ').root).toBeNull();
    expect(parseQuery('in:NT').root).toBeNull();
  });

  it('lists positive leaves', () => {
    const q = parseQuery('love -(fear OR hate) "son of man"');
    expect(positiveLeaves(q.root).map((n) => n.raw)).toEqual(['love', 'son of man']);
  });
});

describe('allowedBooks', () => {
  it('intersects testament, filters and book', () => {
    expect(allowedBooks({})).toBeUndefined();
    expect(allowedBooks({}, 'NT')?.size).toBe(27);
    expect([...(allowedBooks({ books: [1, 43] }, 'NT') ?? [])]).toEqual([43]);
    expect([...(allowedBooks({ testament: 'OT' }, undefined, 43) ?? [])]).toEqual([]);
  });
});
