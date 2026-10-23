import { describe, expect, it } from 'vitest';
import type { Route } from '../../src/app/router';
import { isChapterChange, navDirection } from '../../src/app/transitions';

const read = (tr: string, book: string, chapter: number, verse?: number): Route => ({
  name: 'read',
  tr,
  ref: verse ? { book, chapter, verse } : { book, chapter },
});

describe('chapter-change transitions', () => {
  it('slides for the next / previous chapter, also across books', () => {
    expect(navDirection(read('KJV', 'JHN', 1), read('KJV', 'JHN', 2))).toBe('next');
    expect(navDirection(read('KJV', 'JHN', 2), read('KJV', 'JHN', 1))).toBe('prev');
    expect(navDirection(read('KJV', 'MAL', 4), read('KJV', 'MAT', 1))).toBe('next');
    expect(navDirection(read('KJV', 'MAT', 1), read('KJV', 'MAL', 4))).toBe('prev');
  });

  it('cross-fades other jumps and translation switches; nothing for verse jumps', () => {
    expect(navDirection(read('KJV', 'JHN', 1), read('KJV', 'GEN', 1))).toBe('fade');
    expect(navDirection(read('KJV', 'JHN', 1), read('BSB', 'JHN', 1))).toBe('fade');
    expect(navDirection(read('KJV', 'JHN', 1), read('KJV', 'JHN', 1, 14))).toBe('none');
    expect(navDirection(read('KJV', 'JHN', 1), { name: 'word', id: 'G3056' })).toBe('fade');
    expect(navDirection(read('KJV', 'JHN', 1), { name: 'search', q: 'love' })).toBe('none');
  });

  it('knows a chapter change (page-turn feedback)', () => {
    expect(isChapterChange(read('KJV', 'JHN', 1), read('KJV', 'JHN', 2))).toBe(true);
    expect(isChapterChange(read('KJV', 'JHN', 1), read('BSB', 'JHN', 1))).toBe(false);
    expect(isChapterChange({ name: 'about' }, read('KJV', 'JHN', 1))).toBe(false);
  });
});
