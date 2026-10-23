/**
 * Personal study data (src/app/study.ts): verse keys, actions, versioned localStorage persistence
 * (debounce, migration, corrupt / newer data, quota), cross-tab sync, export and import (validation,
 * merge rules).
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { toastMessage } from '../src/app/state';
import {
  applyStudyImport,
  bookmarks,
  clearAll,
  compareVerseKeys,
  emptyStudy,
  exportStudy,
  flushStudy,
  hasPendingWrite,
  highlights,
  importStudy,
  isVerseKey,
  MAX_NOTE_LENGTH,
  mergeStudy,
  migrateStudy,
  notes,
  parseStudyJson,
  parseVerseKey,
  readStudyFile,
  rebaseStudy,
  reloadStudyFromStorage,
  setBookmarkLabel,
  setHighlight,
  setNote,
  studyCounts,
  studyExportData,
  studyFileName,
  studyStatus,
  STUDY_VERSION,
  toggleBookmark,
  verseKey,
  WRITE_DELAY_MS,
} from '../src/app/study';
import type { StudyData } from '../src/app/study';

const KEY = 'rootword:study';
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? 'null');

beforeEach(() => {
  localStorage.clear();
  reloadStudyFromStorage();
  toastMessage.value = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('verse keys', () => {
  it('builds, parses and validates keys', () => {
    expect(verseKey('JHN', 3, 16)).toBe('JHN.3.16');
    expect(parseVerseKey('JHN.3.16')).toEqual({ book: 'JHN', chapter: 3, verse: 16 });
    expect(parseVerseKey('1SA.17.45')).toEqual({ book: '1SA', chapter: 17, verse: 45 });
    for (const bad of ['jhn.3.16', 'XYZ.1.1', 'JHN.22.1', 'JHN.0.1', 'JHN.3.0', 'PSA.119.177', '__proto__', 'JHN.3', 'JHN.3.16.1', '']) {
      expect(isVerseKey(bad), bad).toBe(false);
    }
    expect(isVerseKey('PSA.119.176')).toBe(true);
  });

  it('sorts in canonical order (Genesis → Revelation), chapters and verses numerically', () => {
    const keys = ['REV.1.1', 'JHN.3.16', 'GEN.1.1', 'JHN.3.2', 'JHN.10.1', 'MAL.4.6', 'MAT.1.1', 'bad'];
    expect([...keys].sort(compareVerseKeys)).toEqual(['GEN.1.1', 'MAL.4.6', 'MAT.1.1', 'JHN.3.2', 'JHN.3.16', 'JHN.10.1', 'REV.1.1', 'bad']);
  });
});

describe('actions', () => {
  it('setHighlight sets, changes and removes; rejects bad keys and colours', () => {
    expect(setHighlight('JHN.3.16', 'yellow')).toBe(true);
    expect(highlights.value).toEqual({ 'JHN.3.16': 'yellow' });
    setHighlight('JHN.3.16', 'blue');
    expect(highlights.value['JHN.3.16']).toBe('blue');
    setHighlight('JHN.3.16', null);
    expect(highlights.value).toEqual({});
    expect(setHighlight('NOPE.1.1', 'yellow')).toBe(false);
    expect(setHighlight('JHN.3.16', 'orange' as never)).toBe(false);
    expect(highlights.value).toEqual({});
  });

  it('setNote keeps created, bumps updated, deletes on blank, cleans control characters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    const a = setNote('JHN.3.16', 'First\r\nline\u0000')!;
    expect(a.text).toBe('First\nline');
    expect(a.created).toBe('2026-01-01T10:00:00.000Z');
    vi.setSystemTime(new Date('2026-01-02T10:00:00Z'));
    const b = setNote('JHN.3.16', 'Changed')!;
    expect(b.created).toBe('2026-01-01T10:00:00.000Z');
    expect(b.updated).toBe('2026-01-02T10:00:00.000Z');
    // same text: no change, same object
    expect(setNote('JHN.3.16', 'Changed')).toBe(b);
    expect(setNote('JHN.3.16', '   \n ')).toBeNull();
    expect(notes.value).toEqual({});
    expect(setNote('JHN.3.16', 'x'.repeat(MAX_NOTE_LENGTH + 50))!.text.length).toBe(MAX_NOTE_LENGTH);
    expect(setNote('bad', 'x')).toBeNull();
  });

  it('toggleBookmark adds with translation and label, removes; setBookmarkLabel renames', () => {
    expect(toggleBookmark('ROM.8.28', 'bsb', '  Memory   verse ')).toBe(true);
    expect(bookmarks.value['ROM.8.28']).toMatchObject({ tr: 'BSB', label: 'Memory verse' });
    expect(setBookmarkLabel('ROM.8.28', '')).toBe(true);
    expect(bookmarks.value['ROM.8.28'].label).toBeUndefined();
    expect(setBookmarkLabel('JHN.1.1', 'x')).toBe(false);
    expect(toggleBookmark('ROM.8.28', 'BSB')).toBe(false);
    expect(bookmarks.value).toEqual({});
    expect(toggleBookmark('bad', 'KJV')).toBe(false);
  });

  it('counts everything', () => {
    setHighlight('JHN.3.16', 'pink');
    setNote('JHN.3.16', 'n');
    toggleBookmark('GEN.1.1', 'KJV');
    expect(studyCounts.value).toEqual({ highlights: 1, notes: 1, bookmarks: 1, total: 3 });
  });
});

describe('persistence', () => {
  it('writes versioned JSON after a debounce, batching quick changes', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    setHighlight('JHN.3.16', 'yellow');
    setHighlight('JHN.3.17', 'green');
    setNote('JHN.3.16', 'hello');
    expect(stored()).toBeNull();
    expect(hasPendingWrite()).toBe(true);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 5);
    expect(spy.mock.calls.filter(([k]) => k === KEY)).toHaveLength(1);
    expect(stored()).toMatchObject({ version: STUDY_VERSION, highlights: { 'JHN.3.16': 'yellow', 'JHN.3.17': 'green' }, notes: { 'JHN.3.16': { text: 'hello' } }, bookmarks: {} });
    expect(hasPendingWrite()).toBe(false);
  });

  it('persists direct signal writes too (the verse sheet sets bookmarks itself)', () => {
    vi.useFakeTimers();
    bookmarks.value = { ...bookmarks.value, 'JHN.1.1': { tr: 'KJV', created: '2026-01-01T00:00:00.000Z' } };
    vi.advanceTimersByTime(WRITE_DELAY_MS + 5);
    expect(stored().bookmarks['JHN.1.1'].tr).toBe('KJV');
  });

  it('flushes immediately when the page is hidden', () => {
    vi.useFakeTimers();
    setHighlight('GEN.1.1', 'purple');
    window.dispatchEvent(new Event('pagehide'));
    expect(stored().highlights['GEN.1.1']).toBe('purple');
  });

  it('loads what is stored, dropping invalid entries', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        highlights: { 'JHN.3.16': 'yellow', 'XYZ.1.1': 'blue', 'JHN.3.17': 'orange' },
        notes: { 'JHN.3.16': { text: 'ok', created: '2026-01-01T00:00:00Z', updated: 'nonsense' }, 'JHN.3.18': { text: '' }, 'JHN.3.19': 'str' },
        bookmarks: { 'JHN.3.16': { tr: '<script>', created: 5 } },
      }),
    );
    reloadStudyFromStorage();
    expect(highlights.value).toEqual({ 'JHN.3.16': 'yellow' });
    expect(notes.value['JHN.3.16']).toEqual({ text: 'ok', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' });
    expect(Object.keys(notes.value)).toEqual(['JHN.3.16']);
    expect(bookmarks.value['JHN.3.16'].tr).toBe('KJV');
    expect(studyStatus.value).toBe('ok');
  });

  it('migrates the unversioned (v0) shape', () => {
    localStorage.setItem(KEY, JSON.stringify({ highlights: { 'PSA.23.1': 'green' } }));
    reloadStudyFromStorage();
    expect(highlights.value).toEqual({ 'PSA.23.1': 'green' });
    setHighlight('PSA.23.2', 'blue');
    flushStudy();
    expect(stored().version).toBe(1);
    expect(migrateStudy({ version: 'x' })).toBeNull();
    expect(migrateStudy([])).toBeNull();
  });

  it('backs up a corrupt value before overwriting it', () => {
    localStorage.setItem(KEY, '{not json');
    reloadStudyFromStorage();
    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe('{not json');
    expect(highlights.value).toEqual({});
    setHighlight('JHN.1.1', 'yellow');
    expect(flushStudy()).toBe(true);
    expect(stored().highlights['JHN.1.1']).toBe('yellow');
  });

  it('never overwrites data written by a newer version', () => {
    const newer = JSON.stringify({ version: STUDY_VERSION + 1, highlights: { 'JHN.1.1': 'blue' }, future: { x: 1 } });
    localStorage.setItem(KEY, newer);
    reloadStudyFromStorage();
    expect(studyStatus.value).toBe('newer');
    expect(highlights.value).toEqual({ 'JHN.1.1': 'blue' });
    setHighlight('JHN.1.2', 'pink');
    expect(flushStudy()).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(newer);
    expect(toastMessage.value).toMatch(/newer Rootword/);
  });

  it('keeps unknown top-level fields when writing', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, highlights: {}, prefs: { sort: 'date' } }));
    reloadStudyFromStorage();
    setHighlight('JHN.1.1', 'yellow');
    flushStudy();
    expect(stored().prefs).toEqual({ sort: 'date' });
  });

  it('survives a full quota: status "full", one toast, no throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    setHighlight('JHN.1.1', 'yellow');
    expect(() => flushStudy()).not.toThrow();
    expect(studyStatus.value).toBe('full');
    expect(toastMessage.value).toMatch(/storage is full/);
    expect(highlights.value['JHN.1.1']).toBe('yellow');
  });

  it('reports storage that cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    reloadStudyFromStorage();
    expect(studyStatus.value).toBe('unavailable');
    expect(highlights.value).toEqual({});
  });
});

describe('cross-tab sync', () => {
  const fromOtherTab = (value: unknown) =>
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: value === null ? null : JSON.stringify(value), storageArea: localStorage }));

  it('applies another tab’s write', () => {
    fromOtherTab({ version: 1, highlights: { 'JHN.1.1': 'green' }, notes: {}, bookmarks: {} });
    expect(highlights.value).toEqual({ 'JHN.1.1': 'green' });
    expect(hasPendingWrite()).toBe(false);
  });

  it('re-applies this tab’s unsaved changes on top', () => {
    vi.useFakeTimers();
    setHighlight('JHN.1.1', 'yellow');
    flushStudy();
    setHighlight('JHN.1.2', 'blue'); // pending
    setHighlight('JHN.1.1', null); // pending removal
    fromOtherTab({ version: 1, highlights: { 'JHN.1.1': 'yellow', 'GEN.1.1': 'pink' }, notes: { 'GEN.1.1': { text: 'theirs', created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' } }, bookmarks: {} });
    expect(highlights.value).toEqual({ 'GEN.1.1': 'pink', 'JHN.1.2': 'blue' });
    expect(notes.value['GEN.1.1'].text).toBe('theirs');
    vi.advanceTimersByTime(WRITE_DELAY_MS + 5);
    expect(stored().highlights).toEqual({ 'GEN.1.1': 'pink', 'JHN.1.2': 'blue' });
  });

  it('treats storage cleared elsewhere as empty', () => {
    setHighlight('JHN.1.1', 'yellow');
    flushStudy();
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null, storageArea: localStorage }));
    expect(highlights.value).toEqual({});
  });

  it('ignores other keys', () => {
    setHighlight('JHN.1.1', 'yellow');
    window.dispatchEvent(new StorageEvent('storage', { key: 'rootword:theme', newValue: 'dark', storageArea: localStorage }));
    expect(highlights.value).toEqual({ 'JHN.1.1': 'yellow' });
  });

  it('rebaseStudy is per entry', () => {
    const base: StudyData = { highlights: { a: 'yellow' }, notes: {}, bookmarks: {} } as never;
    const local: StudyData = { highlights: { a: 'yellow', b: 'blue' }, notes: {}, bookmarks: {} } as never;
    const remote: StudyData = { highlights: { a: 'green' }, notes: {}, bookmarks: {} } as never;
    expect(rebaseStudy(base, local, remote).highlights).toEqual({ a: 'green', b: 'blue' });
  });
});

describe('export', () => {
  it('builds a sorted, versioned file', () => {
    setHighlight('REV.22.21', 'blue');
    setHighlight('GEN.1.1', 'yellow');
    setNote('JHN.3.16', 'n');
    const d = studyExportData();
    expect(d).toMatchObject({ format: 'rootword-study', version: STUDY_VERSION, app: 'Rootword' });
    expect(Object.keys(d.highlights)).toEqual(['GEN.1.1', 'REV.22.21']);
    expect(Number.isFinite(Date.parse(d.exported))).toBe(true);
    expect(studyFileName(new Date(2026, 9, 3))).toBe('rootword-study-2026-10-03.json');
  });

  it('downloads a JSON Blob', async () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    const saved = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    onTestFinished(() => {
      Object.assign(URL, saved);
    });
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    setHighlight('JHN.3.16', 'yellow');
    const blob = exportStudy();
    expect(blob.type).toBe('application/json');
    expect(create).toHaveBeenCalledWith(blob);
    expect(clicks).toEqual([studyFileName()]);
    // (jsdom's Blob has no text(); readStudyFile falls back to FileReader)
    const back = await readStudyFile(blob);
    expect(back.ok && back.value.data.highlights).toEqual({ 'JHN.3.16': 'yellow' });
  });
});

describe('import', () => {
  const file = (o: unknown) => JSON.stringify({ format: 'rootword-study', version: 1, exported: '2026-10-01T00:00:00Z', highlights: {}, notes: {}, bookmarks: {}, ...(o as object) });

  it('rejects what is not a study export', () => {
    expect(parseStudyJson('not json')).toEqual({ ok: false, error: expect.stringMatching(/isn’t valid JSON/) });
    expect(parseStudyJson('[1,2]').ok).toBe(false);
    expect(parseStudyJson('{"format":"something-else"}').ok).toBe(false);
    expect(parseStudyJson('{"hello":1}').ok).toBe(false);
    expect(parseStudyJson(file({ version: 99 }))).toEqual({ ok: false, error: expect.stringMatching(/newer version/) });
    expect(parseStudyJson(file({}))).toEqual({ ok: false, error: expect.stringMatching(/no highlights, notes or bookmarks/) });
    expect(parseStudyJson(file({ highlights: { bad: 'x' } }))).toEqual({ ok: false, error: expect.stringMatching(/every entry was invalid/) });
  });

  it('validates, counts and reports skipped entries', () => {
    const r = parseStudyJson(`﻿${file({ highlights: { 'JHN.3.16': 'yellow', 'JHN.99.1': 'blue' }, notes: { 'JHN.3.16': { text: '<img src=x onerror=alert(1)>' } } })}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.counts).toEqual({ highlights: 1, notes: 1, bookmarks: 0, total: 2 });
    expect(r.value.skipped).toBe(1);
    expect(r.value.exported).toBe('2026-10-01T00:00:00.000Z');
    // stored as plain text, verbatim (rendering escapes it)
    expect(r.value.data.notes['JHN.3.16'].text).toBe('<img src=x onerror=alert(1)>');
  });

  it('also accepts a copy of the stored (unversioned) JSON', () => {
    const r = parseStudyJson(JSON.stringify({ highlights: { 'GEN.1.1': 'green' } }));
    expect(r.ok && r.value.counts.highlights).toBe(1);
  });

  it('mergeStudy never loses what is here', () => {
    const t = (d: number) => new Date(Date.UTC(2026, 0, d)).toISOString();
    const base: StudyData = {
      highlights: { 'JHN.1.1': 'yellow', 'JHN.1.2': 'blue' },
      notes: {
        'JHN.1.1': { text: 'mine', created: t(5), updated: t(6) },
        'JHN.1.2': { text: 'same', created: t(5), updated: t(5) },
        'JHN.1.3': { text: 'short', created: t(5), updated: t(5) },
      },
      bookmarks: { 'JHN.1.1': { tr: 'KJV', created: t(5) } },
    };
    const incoming: StudyData = {
      highlights: { 'JHN.1.1': 'green', 'JHN.1.2': 'blue', 'GEN.1.1': 'pink' },
      notes: {
        'JHN.1.1': { text: 'theirs', created: t(1), updated: t(2) },
        'JHN.1.2': { text: 'same', created: t(1), updated: t(1) },
        'JHN.1.3': { text: 'short, but longer now', created: t(1), updated: t(9) },
        'GEN.1.1': { text: 'new', created: t(1), updated: t(1) },
      },
      bookmarks: { 'JHN.1.1': { tr: 'BSB', created: t(1), label: 'Start' }, 'GEN.1.1': { tr: 'BSB', created: t(1) } },
    };
    const { data, summary } = mergeStudy(base, incoming);
    expect(data.highlights).toEqual({ 'JHN.1.1': 'yellow', 'JHN.1.2': 'blue', 'GEN.1.1': 'pink' });
    expect(data.notes['JHN.1.1'].text).toBe('theirs\n\nmine'); // older first
    expect(data.notes['JHN.1.1'].created).toBe(t(1));
    expect(data.notes['JHN.1.2']).toEqual({ text: 'same', created: t(1), updated: t(5) });
    expect(data.notes['JHN.1.3'].text).toBe('short, but longer now');
    expect(data.notes['GEN.1.1'].text).toBe('new');
    expect(data.bookmarks['JHN.1.1']).toEqual({ tr: 'KJV', created: t(1), label: 'Start' });
    expect(summary).toEqual({ added: { highlights: 1, notes: 1, bookmarks: 1, total: 3 }, kept: 1, combined: 1 });
    // idempotent: merging the result again changes nothing
    expect(mergeStudy(data, incoming).data).toEqual(data);
    // the base object is untouched
    expect(base.highlights['GEN.1.1']).toBeUndefined();
  });

  it('applyStudyImport merges or replaces, and saves at once', () => {
    setHighlight('JHN.3.16', 'yellow');
    const r = parseStudyJson(file({ highlights: { 'GEN.1.1': 'green' } }));
    if (!r.ok) throw new Error(r.error);
    applyStudyImport(r.value, 'merge');
    expect(highlights.value).toEqual({ 'JHN.3.16': 'yellow', 'GEN.1.1': 'green' });
    expect(stored().highlights).toEqual(highlights.value);
    applyStudyImport(r.value, 'replace');
    expect(highlights.value).toEqual({ 'GEN.1.1': 'green' });
    expect(stored().highlights).toEqual({ 'GEN.1.1': 'green' });
  });

  it('importStudy reads a File', async () => {
    const f = new File([file({ bookmarks: { 'PSA.23.1': { tr: 'KJV', created: '2026-01-01T00:00:00Z' } } })], 'backup.json', { type: 'application/json' });
    const out = await importStudy(f);
    expect(out).toMatchObject({ ok: true, added: { bookmarks: 1 } });
    expect(bookmarks.value['PSA.23.1'].tr).toBe('KJV');
    expect(await readStudyFile(new File(['x'.repeat(10)], 'a.txt'))).toMatchObject({ ok: false });
  });

  it('refuses huge files without reading them', async () => {
    const big = { size: 6 * 1024 * 1024, text: vi.fn() } as unknown as Blob;
    expect(await readStudyFile(big)).toEqual({ ok: false, error: expect.stringMatching(/too large/) });
    expect((big as unknown as { text: ReturnType<typeof vi.fn> }).text).not.toHaveBeenCalled();
  });
});

describe('clearAll', () => {
  it('empties everything and saves immediately', () => {
    setHighlight('JHN.3.16', 'yellow');
    setNote('JHN.3.16', 'n');
    toggleBookmark('JHN.3.16', 'KJV');
    clearAll();
    expect(studyCounts.value.total).toBe(0);
    expect(stored()).toMatchObject({ highlights: {}, notes: {}, bookmarks: {} });
    expect(emptyStudy()).toEqual({ highlights: {}, notes: {}, bookmarks: {} });
  });
});
