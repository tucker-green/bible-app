/**
 * Cross references UI — pure helpers: vote strength bands, OT/NT grouping, preview text, the reading
 * line search, the back trail, batched preview loading.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { groupXrefs, indexAtLine, previewText, truncate, uniqueTargets, verseText, votesLabel, xrefStrength } from '../../src/components/xrefs/model';
import { pruneTrail, sameChapter, visibleEntry } from '../../src/components/xrefs/navigate';
import type { TrailEntry } from '../../src/components/xrefs/navigate';
import { cachedPreview, loadPreviews, previewTranslation, resetPreviewCache, runLimited } from '../../src/components/xrefs/previews';
import { configureData, registerTextSource, unregisterTextSource } from '../../src/lib/data';
import type { TextChapter, XrefTarget } from '../../src/lib/types';

const ROM5_8: XrefTarget = [45005008, 0, 70];
const JN1_1: XrefTarget = [43001001, 43001003, 12];
const GEN1_1: XrefTarget = [1001001, 0, 40];
const ISA9_6: XrefTarget = [23009006, 0, 3];
const PS23: XrefTarget = [19023001, 19023006, 5];

describe('xrefStrength', () => {
  it('bands votes absolutely: ≥10 strong, 4–9 moderate, 1–3 weak', () => {
    expect(xrefStrength(1)).toEqual({ level: 1, word: 'weak' });
    expect(xrefStrength(3).level).toBe(1);
    expect(xrefStrength(4)).toEqual({ level: 2, word: 'moderate' });
    expect(xrefStrength(9).level).toBe(2);
    expect(xrefStrength(10)).toEqual({ level: 3, word: 'strong' });
    expect(xrefStrength(1268).level).toBe(3);
  });
  it('labels votes', () => {
    expect(votesLabel(1)).toBe('1 vote');
    expect(votesLabel(70)).toBe('70 votes');
  });
});

describe('groupXrefs', () => {
  const list = [ROM5_8, GEN1_1, JN1_1, PS23, ISA9_6];

  it('splits into testaments keeping vote order; the strongest target’s group comes first', () => {
    const d = groupXrefs(list);
    expect(d.groups.map((g) => g.testament)).toEqual(['NT', 'OT']);
    expect(d.groups[0].items).toEqual([ROM5_8, JN1_1]);
    expect(d.groups[1].items).toEqual([GEN1_1, PS23, ISA9_6]);
    expect(d.groups[1].title).toBe('Old Testament');
    expect(d.total).toBe(5);
    expect(d.hidden).toBe(0);
  });

  it('limits to the strongest N overall and counts the rest as hidden', () => {
    const d = groupXrefs(list, 2);
    expect(d.groups.map((g) => [g.testament, g.items])).toEqual([
      ['NT', [ROM5_8]],
      ['OT', [GEN1_1]],
    ]);
    expect(d.hidden).toBe(3);
  });

  it('keeps the group order stable when collapsed to one testament', () => {
    // strongest is OT, but the first N happen to be NT only — no empty groups, no flip on expand
    const d = groupXrefs([GEN1_1, ROM5_8, JN1_1], 0);
    expect(d.groups).toEqual([]);
    expect(groupXrefs([GEN1_1, ROM5_8]).groups.map((g) => g.testament)).toEqual(['OT', 'NT']);
  });

  it('handles an empty list', () => {
    expect(groupXrefs([])).toEqual({ groups: [], total: 0, hidden: 0 });
  });

  it('de-duplicates by range', () => {
    expect(uniqueTargets([ROM5_8, [45005008, 0, 3], JN1_1])).toEqual([ROM5_8, JN1_1]);
  });
});

describe('preview text', () => {
  const ch: TextChapter = {
    tr: 'KJV',
    book: 'ROM',
    chapter: 5,
    verses: [
      { v: 8, t: ['But ', ['God', [1]], ' commendeth his love toward us,\n  in that, while we were yet sinners, Christ died for us.'] },
      { v: 9, t: [] },
    ],
  };

  it('extracts one verse as plain text, whitespace collapsed', () => {
    expect(verseText(ch, 8)).toBe('But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us.');
    expect(verseText(ch, 9)).toBeNull();
    expect(verseText(ch, 99)).toBeNull();
  });

  it('adds an ellipsis for ranges and shortens long verses at a word boundary', () => {
    expect(previewText('In the beginning.', true)).toBe('In the beginning. …');
    expect(previewText('In the beginning.', false)).toBe('In the beginning.');
    expect(previewText(null, true)).toBeNull();
    const long = 'word '.repeat(60).trim();
    const t = truncate(long, 40);
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(41);
    expect(t).not.toMatch(/\s…$/);
    // a long range is not given a second ellipsis
    expect(previewText(long, true)!.endsWith('……')).toBe(false);
  });
});

describe('indexAtLine', () => {
  const tops = [100, 180, 260, 400, 900];
  const top = (i: number) => tops[i];
  it('finds the last verse starting at or above the line', () => {
    expect(indexAtLine(tops.length, top, 50)).toBe(0);
    expect(indexAtLine(tops.length, top, 100)).toBe(0);
    expect(indexAtLine(tops.length, top, 200)).toBe(1);
    expect(indexAtLine(tops.length, top, 399)).toBe(2);
    expect(indexAtLine(tops.length, top, 5000)).toBe(4);
    expect(indexAtLine(0, top, 10)).toBe(-1);
  });
  it('reads only O(log n) positions', () => {
    let reads = 0;
    const n = 176;
    indexAtLine(n, (i) => (reads++, i * 40), 3000);
    expect(reads).toBeLessThanOrEqual(9);
  });
});

describe('back trail', () => {
  const e = (from: [string, number, number], to: [string, number, number], token = 't'): TrailEntry => ({
    from: { tr: 'KJV', ref: { book: from[0], chapter: from[1], verse: from[2] } },
    to: { tr: 'KJV', ref: { book: to[0], chapter: to[1], verse: to[2] } },
    token,
  });
  const a = e(['JHN', 3, 16], ['ROM', 5, 8], 'a');
  const b = e(['ROM', 5, 8], ['1JN', 4, 9], 'b');

  it('offers the newest entry whose target chapter is on screen', () => {
    expect(visibleEntry([a], { book: 'ROM', chapter: 5, verse: 8 })).toBe(a);
    expect(visibleEntry([a], { book: 'ROM', chapter: 5 })).toBe(a);
    expect(visibleEntry([a, b], { book: '1JN', chapter: 4, verse: 9 })).toBe(b);
    // back on Romans 5 after leaving 1 John: the first step is offered again
    expect(visibleEntry([a, b], { book: 'ROM', chapter: 5, verse: 8 })).toBe(a);
    expect(visibleEntry([a], { book: 'JHN', chapter: 3, verse: 16 })).toBeNull();
  });

  it('within one chapter, hides at the very verse it came from', () => {
    const same = e(['JHN', 3, 16], ['JHN', 3, 5]);
    expect(visibleEntry([same], { book: 'JHN', chapter: 3, verse: 5 })).toBe(same);
    expect(visibleEntry([same], { book: 'JHN', chapter: 3, verse: 16 })).toBeNull();
  });

  it('is kept while the reader stays on it and cleared once they leave', () => {
    const trail = [a, b];
    expect(pruneTrail(trail, { book: 'JHN', chapter: 3 })).toBe(trail);
    expect(pruneTrail(trail, { book: '1JN', chapter: 4 })).toBe(trail);
    expect(pruneTrail(trail, { book: 'ROM', chapter: 6 })).toEqual([]);
    expect(sameChapter({ book: 'ROM', chapter: 5, verse: 1 }, { book: 'ROM', chapter: 5 })).toBe(true);
  });
});

describe('preview loading', () => {
  const urls: string[] = [];
  const chapters: Record<string, TextChapter> = {
    'text/KJV/ROM/5.json': { tr: 'KJV', book: 'ROM', chapter: 5, verses: [{ v: 6, t: ['For when we were yet without strength.'] }, { v: 8, t: ['But God commendeth his love.'] }] },
    'text/KJV/JHN/1.json': { tr: 'KJV', book: 'JHN', chapter: 1, verses: [{ v: 1, t: ['In the beginning was the Word.'] }] },
  };
  beforeEach(() => {
    urls.length = 0;
    resetPreviewCache();
    configureData({
      base: '/data/',
      fetch: async (url: string) => {
        const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
        urls.push(path);
        await new Promise((r) => setTimeout(r, 5));
        const body = chapters[path];
        return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nope', { status: 500 });
      },
    });
  });
  afterEach(() => unregisterTextSource('NIV'));

  it('loads each chapter once for several targets and caches the lines', async () => {
    const targets: XrefTarget[] = [ROM5_8, [45005006, 0, 4], JN1_1];
    expect(cachedPreview('KJV', ROM5_8)).toBeUndefined();
    const failed = await loadPreviews('KJV', targets);
    expect(failed.size).toBe(0);
    expect(urls.sort()).toEqual(['text/KJV/JHN/1.json', 'text/KJV/ROM/5.json']);
    expect(cachedPreview('KJV', ROM5_8)).toBe('But God commendeth his love.');
    expect(cachedPreview('KJV', JN1_1)).toBe('In the beginning was the Word. …');
    await loadPreviews('KJV', targets);
    expect(urls.length).toBe(2); // all cached
  });

  it('marks verses missing from the translation, and reports failed chapters without caching them', async () => {
    const failed = await loadPreviews('KJV', [[45005099, 0, 1], GEN1_1]);
    expect(cachedPreview('KJV', [45005099, 0, 1])).toBeNull();
    expect([...failed]).toEqual(['1001001-1001001']);
    expect(cachedPreview('KJV', GEN1_1)).toBeUndefined();
  });

  it('uses the KJV for runtime translations (never spends the reader’s API quota on previews)', () => {
    expect(previewTranslation('BSB')).toBe('BSB');
    registerTextSource('NIV', async () => {
      throw new Error('must not be called');
    });
    expect(previewTranslation('NIV')).toBe('KJV');
  });

  it('runs at most N jobs at once', async () => {
    let running = 0;
    let peak = 0;
    const jobs = Array.from({ length: 10 }, () => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
    });
    await runLimited(jobs, 3);
    expect(peak).toBe(3);
    await runLimited([async () => Promise.reject(new Error('x')), async () => undefined], 2); // a failure does not stop the rest
  });
});
