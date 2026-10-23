/**
 * The compare page (src/pages/ComparePage.tsx + src/components/compare/*) with mocked data:
 * columns aligned verse by verse, the cross-column highlight through the reader's controller and
 * word card, column-aware verse sheets and ↑ / ↓, the translation chooser and URL correction.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({ feedback: vi.fn(), primeFeedback: vi.fn() }));
vi.mock('../../src/lib/feedback', () => fb);

import { activeWord, meta, passage, pinnedWord, route, toastMessage, verseSheet } from '../../src/app/state';
import { resetCompareCache } from '../../src/components/compare/data';
import { configureData } from '../../src/lib/data';
import type { DataMeta, TextChapter, TranslationMeta } from '../../src/lib/types';
import ComparePage from '../../src/pages/ComparePage';
import { JHN1_KJV, JHN1_ORIG } from './fixtures';

const tr = (id: string, name: string, alignment: TranslationMeta['alignment']): TranslationMeta => ({
  id,
  name,
  abbr: id,
  year: '1900',
  license: 'Public domain',
  alignment,
  description: '',
  source: '',
});

const META: DataMeta = {
  version: 'test',
  generated: '2026-01-01',
  translations: [tr('KJV', 'King James Version', 'strongs'), tr('BSB', 'Berean Standard Bible', 'manual'), tr('WEB', 'World English Bible', 'bridged')],
  books: [],
  credits: [],
};

const JHN1_BSB: TextChapter = {
  tr: 'BSB',
  book: 'JHN',
  chapter: 1,
  headings: [[1, 'The Beginning']],
  verses: [
    {
      v: 1,
      t: [['In', [0]], ' ', ['the', [1]], ' ', ['beginning', [1]], ' ', ['was', [2]], ' ', ['the', [3]], ' ', ['Word', [4]], '.'],
    },
    { v: 2, t: [['He', [3]], ' was here.'] },
  ],
};

const FILES: Record<string, unknown> = {
  'text/KJV/JHN/1.json': JHN1_KJV,
  'text/BSB/JHN/1.json': JHN1_BSB,
  'orig/JHN/1.json': JHN1_ORIG,
};

const fetchMock = async (url: string) => {
  const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
  const body = FILES[path];
  return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nope', { status: 404 });
};

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0)));
};

const page = async (trs = ['KJV', 'BSB'], verse?: number) => {
  window.history.replaceState(null, '', `#/compare/${trs.join(',')}/JHN/1${verse ? `/${verse}` : ''}`);
  route.value = { name: 'compare', trs, book: 'JHN', chapter: 1, verse };
  const r = render(<ComparePage trs={trs} book="JHN" chapter={1} verse={verse} />);
  await flush();
  return r;
};

const cell = (c: Element, col: number, row: number) => c.querySelector(`.cmp-grid [data-row="${row}"] [data-col="${col}"]`)!;
const word = (c: Element, col: number, text: string, nth = 0) =>
  [...c.querySelectorAll<HTMLElement>(`.cmp-grid [data-col="${col}"] [data-u]`)].filter((e) => e.textContent === text)[nth];

beforeEach(() => {
  resetCompareCache();
  configureData({ base: '/data/', fetch: fetchMock });
  vi.stubGlobal('fetch', fetchMock);
  meta.value = META;
  passage.value = { tr: 'KJV', ref: { book: 'JHN', chapter: 3 } };
  pinnedWord.value = null;
  activeWord.value = null;
  verseSheet.value = null;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;
  Element.prototype.scrollIntoView = vi.fn();
  fb.feedback.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  meta.value = null;
});

describe('ComparePage', () => {
  it('shows the translations verse by verse under a bar of choosers', async () => {
    const { container } = await page();
    expect(container.querySelector('h1')!.textContent).toBe('John1');
    expect(document.title).toContain('John 1 · KJV / BSB compared');
    // the bar: one chooser per column, with the alignment meter
    const selects = container.querySelectorAll<HTMLSelectElement>('.cmp-bar select');
    expect([...selects].map((s) => s.getAttribute('aria-label'))).toEqual(['KJV: translation in column 1', 'BSB: translation in column 2']);
    expect([...selects].map((s) => s.value)).toEqual(['KJV', 'BSB']);
    expect(container.querySelector('.cmp-head[data-col="1"] .meter__label')!.textContent).toBe('Hand-aligned');
    expect(container.querySelector('.cmp')!.getAttribute('data-n')).toBe('2');
    // rows aligned by verse, a cell per translation, the BSB's section heading across them
    const rows = container.querySelectorAll('.cmp-grid .cmp-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelectorAll('.cmp-cell').length).toBe(2);
    expect(container.querySelector('.cmp-grid h2.sec')!.textContent).toContain('The Beginning');
    expect(cell(container, 0, 1).textContent).toContain('In the beginning was the Word');
    expect(cell(container, 1, 2).textContent).toContain('He was here.');
    // unit ids are unique across the columns; one tab stop for the whole grid
    const ids = [...container.querySelectorAll<HTMLElement>('.cmp-grid [data-u]')].map((e) => e.dataset.u);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelectorAll('.cmp-grid [tabindex="0"]').length).toBe(1);
    // the header and "Back to reading" follow the chapter being compared
    expect(passage.value).toEqual({ tr: 'KJV', ref: { book: 'JHN', chapter: 1 } });
    expect(container.querySelector<HTMLAnchorElement>('.page-back a')!.getAttribute('href')).toBe('#/KJV/JHN/1');
    // chapter navigation keeps the translations
    expect(container.querySelector<HTMLAnchorElement>('.cmp-tools a[rel="next"]')!.getAttribute('href')).toBe('#/compare/KJV,BSB/JHN/2');
    expect(container.querySelector<HTMLAnchorElement>('.ch-nav a[rel="prev"]')!.getAttribute('href')).toBe('#/compare/KJV,BSB/LUK/24');
  });

  it('lights up the words that render the same Greek word in the other column and opens the word card', async () => {
    const { container } = await page();
    const kjv = word(container, 0, 'the Word');
    fireEvent.click(kjv);
    await flush();
    const p = pinnedWord.value!;
    expect(p.key).toBe('compare:KJV,BSB/JHN/1');
    expect(kjv.classList.contains('is-active')).toBe(true);
    const the = word(container, 1, 'the');
    const w = word(container, 1, 'Word');
    for (const el of [the, w]) {
      expect(el.classList.contains('is-linked')).toBe(true);
      expect(el.classList.contains('is-twin')).toBe(true);
    }
    // the KJV's own second "the Word" is the same word too (same column: linked, not a twin)
    const again = word(container, 0, 'the Word', 2);
    expect(again.classList.contains('is-linked')).toBe(true);
    expect(again.classList.contains('is-twin')).toBe(false);
    // the normal word card, for the KJV
    const card = document.getElementById('word-card')!;
    expect(card.getAttribute('aria-label')).toBe('Word study: λόγος');
    expect(card.textContent).toContain('“the Word”');
    // a word in the other column swaps the card; the KJV words become its twins
    fireEvent.click(w);
    await flush();
    expect(word(container, 1, 'Word').classList.contains('is-active')).toBe(true);
    expect(word(container, 0, 'the Word').classList.contains('is-twin')).toBe(true);
    expect(word(container, 1, 'the').classList.contains('is-twin')).toBe(false);
    expect(document.getElementById('word-card')!.textContent).toContain('“Word”');
    // closing clears every mark
    act(() => {
      pinnedWord.value = null;
    });
    expect(container.querySelectorAll('.cmp-grid .is-twin, .cmp-grid .is-linked, .cmp-grid .is-active').length).toBe(0);
  });

  it('opens the verse sheet of the column whose verse number was pressed', async () => {
    const { container } = await page();
    const vn = container.querySelector<HTMLElement>('.cmp-grid [data-col="1"] [data-vn="2"]')!;
    fireEvent.click(vn);
    await flush();
    expect(verseSheet.value).toEqual({ key: 'BSB/JHN/1', verse: 2 });
    const sheet = document.querySelector('.verse-sheet')!;
    expect(sheet.querySelector('.eyebrow')!.textContent).toBe('Verse · BSB');
    expect(sheet.querySelector('.vs-quote')!.textContent).toContain('He was here.');
    // "Study this verse" pins the word in the grid (its key maps to the grid's)
    fireEvent.click(sheet.querySelector('.vs-word__en')!);
    await flush();
    expect(pinnedWord.value?.key).toBe('compare:KJV,BSB/JHN/1');
    expect(word(container, 1, 'He').classList.contains('is-active')).toBe(true);
    expect(word(container, 0, 'the Word').classList.contains('is-twin')).toBe(true);
  });

  it('moves verse to verse within the same column with ↑ / ↓', async () => {
    const { container } = await page();
    const start = word(container, 1, 'Word');
    start.focus();
    fireEvent.keyDown(start, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(container.querySelector('.cmp-grid [data-col="1"] [data-vn="2"]'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(container.querySelector('.cmp-grid [data-col="1"] [data-vn="1"]'));
    // ← / → keep the reader's word-by-word order
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect((document.activeElement as HTMLElement).textContent).toBe('In');
    expect((document.activeElement as HTMLElement).closest('[data-col]')!.getAttribute('data-col')).toBe('1');
  });

  it('changes, adds and removes columns through the URL', async () => {
    const { container } = await page();
    const sel = container.querySelector<HTMLSelectElement>('.cmp-head[data-col="1"] select')!;
    fireEvent.change(sel, { target: { value: 'WEB' } });
    await waitFor(() => expect(location.hash).toBe('#/compare/KJV,WEB/JHN/1'));
    cleanup();
    const second = await page(['KJV', 'WEB']);
    // WEB has no file here: its column says so, the KJV still shows
    await waitFor(() => expect(second.container.querySelector('.cmp-head[data-col="1"]')!.textContent).toContain('Didn’t load'));
    expect(second.container.querySelectorAll('.cmp-grid .cmp-cell.is-empty').length).toBe(2);
    expect(cell(second.container, 0, 1).textContent).toContain('In the beginning');
    // borrowed section titles
    expect(second.container.querySelector('.cmp-note')!.textContent).toBe('Section titles from the BSB.');
    fireEvent.click(second.container.querySelector('.cmp-add')!);
    await waitFor(() => expect(location.hash).toBe('#/compare/KJV,WEB,BSB/JHN/1'));
    cleanup();
    const third = await page(['KJV', 'WEB', 'BSB']);
    expect(third.container.querySelector('.cmp')!.getAttribute('data-n')).toBe('3');
    expect(third.container.querySelector('.cmp-add')).toBeNull();
    fireEvent.click(third.container.querySelector('.cmp-head[data-col="1"] .cmp-head__x')!);
    await waitFor(() => expect(location.hash).toBe('#/compare/KJV,BSB/JHN/1'));
  });

  it('changes chapter with ← / → outside the text, not inside it', async () => {
    const { container } = await page();
    const w = word(container, 0, 'In');
    w.focus();
    fireEvent.keyDown(w, { key: 'ArrowRight' });
    expect(location.hash).toBe('#/compare/KJV,BSB/JHN/1');
    w.blur();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await waitFor(() => expect(location.hash).toBe('#/compare/KJV,BSB/JHN/2'));
    window.history.replaceState(null, '', '#/compare/KJV,BSB/JHN/1');
    act(() => {
      pinnedWord.value = { key: 'compare:KJV,BSB/JHN/1', unit: 0, via: 'click' };
    });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await flush(2);
    expect(location.hash).toBe('#/compare/KJV,BSB/JHN/1'); // a word card is open: keys stay with it
  });

  it('replaces an unknown translation in the URL', async () => {
    await page(['NIV', 'BSB']);
    await waitFor(() => expect(location.hash).toBe('#/compare/KJV,BSB/JHN/1'));
    expect(toastMessage.value).toContain('The NIV isn’t available here');
  });

  it('scrolls to and highlights a verse in the URL', async () => {
    const { container } = await page(['KJV', 'BSB'], 2);
    expect(window.scrollBy).toHaveBeenCalled();
    expect(container.querySelectorAll('.cmp-grid [data-row="2"] .verse.is-target').length).toBe(2);
  });
});
