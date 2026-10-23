/**
 * Personal study UI: the verse sheet's Highlight and Note sections and the My study page (#/study):
 * tabs, grouping, previews, filter, search, inline editing, deleting, export / import, delete all,
 * empty states, and that notes are rendered as plain text.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({ feedback: vi.fn(), primeFeedback: vi.fn() }));
vi.mock('../../src/lib/feedback', () => fb);

import { meta, passage, toastMessage } from '../../src/app/state';
import {
  bookmarks,
  highlights,
  notes,
  reloadStudyFromStorage,
  setHighlight,
  setNote,
  studyCounts,
  toggleBookmark,
} from '../../src/app/study';
import { AUTOSAVE_MS } from '../../src/components/study/NoteEditor';
import { resetPreviews } from '../../src/components/study/previews';
import { HighlightSection } from '../../src/components/verse/HighlightSection';
import { NoteSection } from '../../src/components/verse/NoteSection';
import { configureData } from '../../src/lib/data';
import type { DataMeta, TextChapter } from '../../src/lib/types';
import MyStudyPage from '../../src/pages/MyStudyPage';

const ch = (book: string, chapter: number, verses: [number, string][]): TextChapter => ({
  tr: 'KJV',
  book,
  chapter,
  verses: verses.map(([v, s]) => ({ v, t: [s] })),
});
const FILES: Record<string, unknown> = {
  'text/KJV/GEN/1.json': ch('GEN', 1, [[1, 'In the beginning God created the heaven and the earth.']]),
  'text/KJV/PSA/23.json': ch('PSA', 23, [[1, 'The LORD is my shepherd; I shall not want.']]),
  'text/KJV/JHN/3.json': ch('JHN', 3, [
    [3, 'Jesus answered and said unto him, Verily, verily, I say unto thee.'],
    [16, 'For God so loved the world, that he gave his only begotten Son.'],
  ]),
  'text/KJV/ROM/8.json': ch('ROM', 8, [[28, 'And we know that all things work together for good.']]),
};
const fetchMock = async (url: string) => {
  const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
  const body = FILES[path];
  return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nope', { status: 404 });
};

beforeEach(() => {
  localStorage.clear();
  reloadStudyFromStorage();
  resetPreviews();
  configureData({ base: '/data/', fetch: fetchMock });
  meta.value = { translations: [{ id: 'KJV', abbr: 'KJV', name: 'King James Version' }] } as unknown as DataMeta;
  passage.value = { tr: 'KJV', ref: { book: 'JHN', chapter: 3 } };
  toastMessage.value = null;
  fb.feedback.mockClear();
  window.scrollTo = vi.fn() as never;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/* ---- verse sheet sections ------------------------------------------------------------------- */

describe('HighlightSection', () => {
  it('offers five named colours with patterns; picking one highlights the verse', () => {
    render(<HighlightSection book="JHN" chapter={3} verse={16} tr="KJV" />);
    const group = screen.getByRole('group', { name: 'Highlight colour' });
    const btns = within(group).getAllByRole('button');
    expect(btns.map((b) => b.textContent?.trim())).toEqual(['Yellow', 'Green', 'Blue', 'Pink', 'Purple']);
    expect(screen.getByRole('button', { name: 'Purple', description: 'wavy underline' })).toBe(btns[4]);
    expect(btns.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    // the pattern is part of each button's description (never colour alone)
    const desc = document.getElementById(btns[4].getAttribute('aria-describedby')!)!;
    expect(desc.textContent).toBe('wavy underline');
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(highlights.value['JHN.3.16']).toBe('green');
    expect(screen.getByRole('button', { name: 'Green' }).getAttribute('aria-pressed')).toBe('true');
    expect(fb.feedback).toHaveBeenCalledWith('select');
    expect(toastMessage.value).toBe('John 3:16 highlighted green');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(highlights.value['JHN.3.16']).toBeUndefined();
    expect(toastMessage.value).toBe('Highlight removed');

    // pressing the current colour again removes it
    fireEvent.click(screen.getByRole('button', { name: 'Pink' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pink' }));
    expect(highlights.value['JHN.3.16']).toBeUndefined();
  });
});

describe('NoteSection', () => {
  it('autosaves while typing, counts characters, and confirms on leaving', async () => {
    vi.useFakeTimers();
    render(<NoteSection book="JHN" chapter={3} verse={16} tr="KJV" />);
    const area = screen.getByRole('textbox', { name: 'Note on John 3:16' }) as HTMLTextAreaElement;
    expect(area.getAttribute('placeholder')).toBe('Write a note on John 3:16…');
    fireEvent.focus(area);
    area.value = 'Gave — <b>love</b>\nin action';
    fireEvent.input(area);
    expect(screen.getByText('Saving…')).toBeTruthy();
    expect(notes.value['JHN.3.16']).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_MS + 10);
    });
    expect(notes.value['JHN.3.16'].text).toBe('Gave — <b>love</b>\nin action');
    expect(document.getElementById('vs-note-count')!.textContent).toBe('28 / 10,000 characters');
    expect(fb.feedback).not.toHaveBeenCalled();
    fireEvent.blur(area);
    expect(fb.feedback).toHaveBeenCalledWith('success');
  });

  it('deletes in two steps', () => {
    setNote('JHN.3.16', 'to go');
    render(<NoteSection book="JHN" chapter={3} verse={16} tr="KJV" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('to go');
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByRole('group', { name: 'Delete the note on John 3:16?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(notes.value['JHN.3.16']).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(notes.value['JHN.3.16']).toBeUndefined();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(toastMessage.value).toBe('Note on John 3:16 deleted');
  });

  it('saves a pending edit when it unmounts (sheet closed mid-typing)', () => {
    vi.useFakeTimers();
    const { unmount } = render(<NoteSection book="JHN" chapter={3} verse={16} tr="KJV" />);
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    area.value = 'quick';
    fireEvent.input(area);
    unmount();
    expect(notes.value['JHN.3.16'].text).toBe('quick');
  });
});

/* ---- My study page --------------------------------------------------------------------------- */

function seed() {
  setHighlight('JHN.3.16', 'yellow');
  setHighlight('GEN.1.1', 'blue');
  setHighlight('PSA.23.1', 'blue');
  setNote('JHN.3.3', 'Born again / from above.\n<img src=x onerror="alert(1)">');
  setNote('PSA.23.1', 'The shepherd-king.');
  toggleBookmark('ROM.8.28', 'BSB', 'Memory verse');
}

const page = () => render(<MyStudyPage />);
const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('MyStudyPage', () => {
  it('lists highlights grouped by book in Bible order, with previews and jump links', async () => {
    seed();
    page();
    expect(screen.getByRole('heading', { level: 1, name: 'My study' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Highlights3', 'Notes2', 'Bookmarks1']);
    expect(tab(/Highlights/).getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getAllByRole('heading', { level: 2 }).map((h) => h.firstChild?.textContent)).toEqual(['Genesis', 'Psalms', 'John']);
    expect(screen.getByRole('link', { name: 'John 3:16' }).getAttribute('href')).toBe('#/KJV/JHN/3/16');
    await waitFor(() => expect(screen.getByText('For God so loved the world, that he gave his only begotten Son.')).toBeTruthy());
    expect(screen.getByText('For God so loved the world, that he gave his only begotten Son.').closest('[data-c]')!.getAttribute('data-c')).toBe('yellow');
  });

  it('filters by colour and removes a highlight', async () => {
    seed();
    page();
    const filter = screen.getByRole('group', { name: 'Filter by colour' });
    expect(within(filter).getAllByRole('button').map((b) => b.textContent)).toEqual(['All3', 'Yellow1', 'Blue2']);
    fireEvent.click(within(filter).getByRole('button', { name: /Blue/ }));
    expect(screen.queryByRole('link', { name: 'John 3:16' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Genesis 1:1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove highlight from Genesis 1:1' }));
    expect(highlights.value['GEN.1.1']).toBeUndefined();
    expect(fb.feedback).toHaveBeenCalledWith('success');
    expect(screen.queryByRole('link', { name: 'Genesis 1:1' })).toBeNull();
  });

  it('switches tabs with the arrow keys (and remembers the last one)', () => {
    seed();
    page();
    fireEvent.keyDown(tab(/Highlights/), { key: 'ArrowRight' });
    expect(tab(/Notes/).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab(/Notes/));
    fireEvent.keyDown(tab(/Notes/), { key: 'End' });
    expect(tab(/Bookmarks/).getAttribute('aria-selected')).toBe('true');
    expect(localStorage.getItem('rootword:studyTab')).toBe('bookmarks');
    cleanup();
    page();
    expect(tab(/Bookmarks/).getAttribute('aria-selected')).toBe('true');
  });

  it('shows notes as plain text, searches them, edits and deletes in place', async () => {
    seed();
    page();
    fireEvent.click(tab(/Notes/));
    const panel = screen.getByRole('tabpanel');
    // plain text: the markup is visible as text, nothing is injected
    expect(panel.querySelector('.ms-note-text img')).toBeNull();
    expect(screen.getByText(/onerror="alert\(1\)"/)).toBeTruthy();
    const born = [...panel.querySelectorAll('.ms-note-text')].find((n) => n.textContent!.startsWith('Born'))!;
    expect(born.textContent).toBe('Born again / from above.\n<img src=x onerror="alert(1)">');

    const search = screen.getByRole('searchbox', { name: 'Search your notes' });
    fireEvent.input(search, { target: { value: 'SHEPHERD' } });
    expect(screen.getByText('1 of 2 notes')).toBeTruthy();
    expect(panel.querySelector('mark')!.textContent).toBe('shepherd');
    fireEvent.input(search, { target: { value: 'zzz' } });
    expect(screen.getByText(/No notes contain “zzz”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit note on Psalm 23:1' }));
    const area = screen.getByRole('textbox', { name: 'Note on Psalm 23:1' }) as HTMLTextAreaElement;
    fireEvent.focus(area);
    area.value = 'The shepherd-king, edited.';
    fireEvent.input(area);
    fb.feedback.mockClear();
    // "Done" saves and confirms even when the tap doesn't blur the field (iOS)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(notes.value['PSA.23.1'].text).toBe('The shepherd-king, edited.');
    expect(fb.feedback).toHaveBeenCalledTimes(1);
    expect(fb.feedback).toHaveBeenCalledWith('success');
    expect(screen.getByText('The shepherd-king, edited.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note on John 3:3' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete the note on John 3:3?' })).getByRole('button', { name: 'Delete' }));
    expect(notes.value['JHN.3.3']).toBeUndefined();
  });

  it('lists bookmarks with their label and translation', async () => {
    seed();
    page();
    fireEvent.click(tab(/Bookmarks/));
    expect(screen.getByText('Memory verse')).toBeTruthy();
    expect(screen.getByText(/in the BSB/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('And we know that all things work together for good.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark on Romans 8:28' }));
    expect(bookmarks.value).toEqual({});
  });

  it('teaches the feature when empty', () => {
    page();
    expect(screen.getByRole('heading', { level: 2, name: 'Click a verse number to highlight it' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Read John 3 (KJV)' }).getAttribute('href')).toBe('#/KJV/JHN/3');
    fireEvent.click(tab(/Notes/));
    expect(screen.getByRole('heading', { level: 2, name: 'Click a verse number to write a note' })).toBeTruthy();
    // nothing to export yet
    expect((screen.getByRole('button', { name: 'Export a copy' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('imports a file after a preview: merge', async () => {
    setHighlight('JHN.3.16', 'yellow');
    page();
    const input = document.querySelector<HTMLInputElement>('.ms-data input[type=file]')!;
    const file = new File(
      [JSON.stringify({ format: 'rootword-study', version: 1, highlights: { 'GEN.1.1': 'green', 'JHN.3.16': 'pink' }, notes: {}, bookmarks: {} })],
      'backup.json',
      { type: 'application/json' },
    );
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    const dlg = await screen.findByRole('dialog', { name: 'Import study notes?' });
    expect(dlg.textContent).toContain('backup.json has 2 highlights');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Merge with mine' }));
    expect(highlights.value).toEqual({ 'JHN.3.16': 'yellow', 'GEN.1.1': 'green' });
    expect(toastMessage.value).toBe('Imported 1 highlight (1 kept as you had it)');
    expect(fb.feedback).toHaveBeenCalledWith('success');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains a bad import file', async () => {
    page();
    const input = document.querySelector<HTMLInputElement>('.ms-data input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['hello'], 'notes.txt')], configurable: true });
    fireEvent.change(input);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /isn’t a Rootword study export/.test(a.textContent ?? ''))).toBe(true);
    expect(fb.feedback).toHaveBeenCalledWith('error');
  });

  it('deletes everything only after confirming', () => {
    seed();
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything…' }));
    const dlg = screen.getByRole('alertdialog', { name: 'Delete all your study?' });
    expect(dlg.textContent).toContain('3 highlights, 2 notes and 1 bookmark');
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(studyCounts.value.total).toBe(6);
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete everything' }));
    expect(studyCounts.value.total).toBe(0);
    expect(toastMessage.value).toBe('Deleted 6 items from this browser');
  });
});
