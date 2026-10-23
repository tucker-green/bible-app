import { describe, expect, it } from 'vitest';
import { buildChapterModel } from '../../src/components/reader/model';
import { interlinearCells, renderChapterHtml } from '../../src/components/reader/render';
import { decorateVerses, markListening, verseLabel } from '../../src/components/reader/decorate';
import type { TextChapter } from '../../src/lib/types';
import { JHN1_KJV, JHN1_ORIG } from './fixtures';

/** John 1 with an invented red-letter range over "and the Word was with God." (tokens 12–25). */
const RED: TextChapter = {
  ...JHN1_KJV,
  verses: JHN1_KJV.verses.map((v) => (v.v === 1 ? { ...v, wj: [[12, 26]] as [number, number][] } : v)),
};

function dom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

const opts = { mode: 'reading' as const, layout: 'paragraphs' as const, headings: true, ilTranslit: true, ilGloss: false };

describe('red letter (TextVerse.wj)', () => {
  const model = buildChapterModel(RED, JHN1_ORIG, { alignment: 'strongs', tr: 'KJV' });
  const v1 = model.verses[0];

  it('flags the pieces and units inside the range only', () => {
    expect(v1.wj).toBeDefined();
    expect(v1.wj!.length).toBe(v1.pieces.length);
    const red = v1.pieces.filter((_, i) => v1.wj![i]).map((p) => (typeof p === 'string' ? p : p.text));
    expect(red).toContain('the Word');
    expect(red).toContain('God');
    expect(red).not.toContain('In');
    const units = model.units.filter((u) => u.verse === 1);
    expect(units.find((u) => u.text === 'In')?.wj).toBeUndefined();
    expect(units.filter((u) => u.wj).map((u) => u.text)).toEqual(['and', 'the Word', 'was', 'with', 'God']);
    // verses without ranges are untouched
    expect(model.verses[1].wj).toBeUndefined();
  });

  it('never merges a unit across a red-letter boundary', () => {
    // "the Word" occurs twice with the same links ([3,4] / [6,7]); only the red one is wj
    const words = model.units.filter((u) => u.text === 'the Word' && u.verse === 1);
    expect(words.map((u) => Boolean(u.wj))).toEqual([false, true]);
  });

  it('renders .wj on red units and red plain text, keeping the verse text intact', () => {
    const el = dom(renderChapterHtml(model, opts));
    const red = [...el.querySelectorAll('#v1 .wj')].map((n) => n.textContent);
    expect(red).toContain('God');
    expect(red).toContain('.');
    const v = el.querySelector('#v1')!.cloneNode(true) as HTMLElement;
    v.querySelectorAll('.vn').forEach((n) => n.remove());
    expect(v.textContent).toBe('In the beginning was the Word, and the Word was with God.');
  });

  it('marks plain red words in interlinear cells', () => {
    const cells = interlinearCells(['so ', 'it'], [true, false]);
    expect(cells[0]).toMatchObject({ en: 'so', wj: true });
    expect(cells[1].wj).toBeUndefined();
  });
});

describe('verse decorations', () => {
  const model = buildChapterModel(JHN1_KJV, JHN1_ORIG, { alignment: 'strongs', tr: 'KJV' });

  it('verse numbers are labelled buttons that open the verse sheet', () => {
    const el = dom(renderChapterHtml(model, opts));
    const vn = el.querySelector('[data-vn="1"]')!;
    expect(vn.getAttribute('role')).toBe('button');
    expect(vn.getAttribute('aria-label')).toBe('Verse 1');
    expect(vn.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('applies highlights, notes and bookmarks from the study signals', () => {
    const el = dom(renderChapterHtml(model, opts));
    const now = new Date().toISOString();
    decorateVerses(el, 'JHN', 1, {
      highlights: { 'JHN.1.1': 'green' },
      notes: { 'JHN.1.2': { text: 'x', created: now, updated: now } },
      bookmarks: { 'JHN.1.2': { tr: 'KJV', created: now } },
    });
    expect((el.querySelector('#v1') as HTMLElement).dataset.hl).toBe('green');
    expect(el.querySelector('[data-vn="1"]')!.getAttribute('aria-label')).toBe('Verse 1, highlighted green');
    const vn2 = el.querySelector('[data-vn="2"]') as HTMLElement;
    expect('note' in vn2.dataset && 'bm' in vn2.dataset).toBe(true);
    expect(vn2.querySelectorAll('.vm').length).toBe(2);
    expect(vn2.getAttribute('aria-label')).toBe('Verse 2, bookmarked, has a note');
    // and removes them again
    decorateVerses(el, 'JHN', 1, { highlights: {}, notes: {}, bookmarks: {} });
    expect((el.querySelector('#v1') as HTMLElement).dataset.hl).toBeUndefined();
    expect(vn2.querySelector('.vn__marks')).toBeNull();
    expect(vn2.textContent).toBe('2');
    expect(vn2.getAttribute('aria-label')).toBe('Verse 2');
  });

  it('marks the verse being read aloud', () => {
    const el = dom(renderChapterHtml(model, opts));
    expect(markListening(el, 2)?.id).toBe('v2');
    expect(el.querySelectorAll('.is-listening').length).toBe(1);
    markListening(el, null);
    expect(el.querySelectorAll('.is-listening').length).toBe(0);
  });

  it('labels verse numbers in words', () => {
    expect(verseLabel(16, 'yellow', true, true)).toBe('Verse 16, highlighted yellow, bookmarked, has a note');
  });
});
