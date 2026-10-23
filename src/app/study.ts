/**
 * Personal study data: highlights, notes and bookmarks, kept only in this browser.
 *
 * Verse keys are "BOOK.CHAPTER.VERSE" in English versification, e.g. "JHN.3.16" — translation-
 * independent, so a highlight made in the KJV shows in every translation.
 *
 * Storage — localStorage "rootword:study", versioned JSON:
 *   { "version": 1, "highlights": { "JHN.3.16": "yellow" },
 *     "notes": { "JHN.3.16": { "text": "…", "created": ISO, "updated": ISO } },
 *     "bookmarks": { "JHN.3.16": { "tr": "KJV", "created": ISO, "label"?: "…" } } }
 *  - read once when this module loads; every change to the signals is written back, debounced
 *    (WRITE_DELAY_MS) and flushed when the page is hidden. Writing the signals directly also persists
 *    (the verse sheet does that for bookmarks), but prefer the actions below.
 *  - older shapes go through MIGRATIONS (version n → n + 1) before use; entries that fail validation
 *    are dropped. A value that is not JSON is copied to "rootword:study.corrupt" before anything is
 *    overwritten. Data written by a NEWER version of Rootword is loaded but never overwritten
 *    (studyStatus = 'newer') so an old cached build cannot destroy it.
 *  - exception safe: disabled storage (private mode) or a full quota never throw; studyStatus says
 *    what happened ('unavailable' / 'full') and the user is told once with a toast.
 *  - cross-tab: the `storage` event from another tab replaces the signals; changes this tab has not
 *    written yet are re-applied on top (per verse), so two tabs never undo each other.
 *
 * Export / import: exportStudy() downloads a JSON file ({ format: "rootword-study", version, … });
 * readStudyFile() / parseStudyJson() validate a file and applyStudyImport() merges it (or replaces
 * everything). Merge rule: nothing on this device is lost — new verses are added; where both have a
 * highlight or bookmark for the same verse this device's wins; two different notes on one verse are
 * kept together (older text first).
 *
 * The module wires itself up on import in a browser (initStudy() is idempotent).
 */
import { batch, computed, effect, signal } from '@preact/signals';
import { getBook } from '../lib/books';
import { showToast } from './state';
import { STORAGE_PREFIX } from './storage';

/* ------------------------------------------------------------------------ */
/* Types and shapes                                                          */
/* ------------------------------------------------------------------------ */

/** Named highlight colours; each also has a distinct pattern so colour is never the only cue. */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];

/** Display name of each colour. */
export const HIGHLIGHT_NAMES: Record<HighlightColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  purple: 'Purple',
};

/**
 * The underline style that goes with each colour in the reader (reader.css: solid / double / dashed
 * / dotted / wavy) — the cue for anyone who can't tell the tints apart.
 */
export const HIGHLIGHT_PATTERNS: Record<HighlightColor, 'solid' | 'double' | 'dashed' | 'dotted' | 'wavy'> = {
  yellow: 'solid',
  green: 'double',
  blue: 'dashed',
  pink: 'dotted',
  purple: 'wavy',
};

export interface Note {
  text: string;
  /** ISO timestamps */
  created: string;
  updated: string;
}

export interface Bookmark {
  /** Translation the bookmark was made in. */
  tr: string;
  created: string;
  label?: string;
}

export interface StudyData {
  highlights: Record<string, HighlightColor>;
  notes: Record<string, Note>;
  bookmarks: Record<string, Bookmark>;
}

export interface StudyCounts {
  highlights: number;
  notes: number;
  bookmarks: number;
  total: number;
}

/* ------------------------------------------------------------------------ */
/* Constants                                                                 */
/* ------------------------------------------------------------------------ */

/** localStorage key (without the "rootword:" prefix). */
export const STUDY_STORAGE_KEY = 'study';
const FULL_KEY = STORAGE_PREFIX + STUDY_STORAGE_KEY;
const CORRUPT_KEY = `${FULL_KEY}.corrupt`;
/** Current storage / export format version. */
export const STUDY_VERSION = 1;
/** Debounce for writes to localStorage. */
export const WRITE_DELAY_MS = 400;
/** Longest note (characters). */
export const MAX_NOTE_LENGTH = 10000;
/** Longest bookmark label (characters). */
export const MAX_LABEL_LENGTH = 120;
/** Largest import file accepted (bytes). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Whether changes are being saved: 'ok'; 'unavailable' (storage disabled, e.g. some private modes);
 * 'full' (quota exceeded); 'newer' (the stored data came from a newer Rootword — kept read-only).
 */
export type StudyStatus = 'ok' | 'unavailable' | 'full' | 'newer';

/* ------------------------------------------------------------------------ */
/* Verse keys                                                                */
/* ------------------------------------------------------------------------ */

export function verseKey(book: string, chapter: number, verse: number): string {
  return `${book}.${chapter}.${verse}`;
}

export interface VerseKeyParts {
  book: string;
  chapter: number;
  verse: number;
}

const KEY_RE = /^([0-9A-Z]{3})\.(\d{1,3})\.(\d{1,3})$/;
/** Longest chapter (Psalm 119). */
const MAX_VERSE = 176;

/** "JHN.3.16" → { book, chapter, verse }, or null for anything that isn't a real verse key. */
export function parseVerseKey(key: string): VerseKeyParts | null {
  const m = typeof key === 'string' ? KEY_RE.exec(key) : null;
  if (!m) return null;
  const info = getBook(m[1]);
  const chapter = Number(m[2]);
  const verse = Number(m[3]);
  if (!info || info.id !== m[1] || chapter < 1 || chapter > info.chapters || verse < 1 || verse > MAX_VERSE) return null;
  return { book: info.id, chapter, verse };
}

export function isVerseKey(key: string): boolean {
  return parseVerseKey(key) !== null;
}

/** Canonical order (Genesis 1:1 … Revelation 22:21); unknown keys sort last. */
export function compareVerseKeys(a: string, b: string): number {
  return keyRank(a) - keyRank(b);
}

function keyRank(key: string): number {
  const p = parseVerseKey(key);
  if (!p) return Number.MAX_SAFE_INTEGER;
  return getBook(p.book)!.num * 1_000_000 + p.chapter * 1_000 + p.verse;
}

export function isHighlightColor(c: unknown): c is HighlightColor {
  return typeof c === 'string' && (HIGHLIGHT_COLORS as string[]).includes(c);
}

/* ------------------------------------------------------------------------ */
/* Actions                                                                   */
/* ------------------------------------------------------------------------ */

function nowIso(): string {
  return new Date().toISOString();
}

/** Plain text only: CRLF → LF, other control characters dropped, length capped. */
export function cleanNoteText(text: string, max = MAX_NOTE_LENGTH): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

/** Highlight a verse (null removes it). Returns false for an invalid key. */
export function setHighlight(key: string, color: HighlightColor | null): boolean {
  if (!isVerseKey(key) || (color !== null && !isHighlightColor(color))) return false;
  const cur = highlights.peek();
  if ((cur[key] ?? null) === color) return true;
  const next = { ...cur };
  if (color) next[key] = color;
  else delete next[key];
  highlights.value = next;
  return true;
}

/**
 * Save a note (null or blank text deletes it). Keeps `created`, bumps `updated` when the text
 * changes. Returns the stored note (or null when deleted / invalid key).
 */
export function setNote(key: string, text: string | null): Note | null {
  if (!isVerseKey(key)) return null;
  const cur = notes.peek();
  const clean = text === null ? '' : cleanNoteText(text);
  if (!clean.trim()) {
    if (cur[key]) {
      const next = { ...cur };
      delete next[key];
      notes.value = next;
    }
    return null;
  }
  const prev = cur[key];
  if (prev && prev.text === clean) return prev;
  const t = nowIso();
  const note: Note = { text: clean, created: prev?.created ?? t, updated: t };
  notes.value = { ...cur, [key]: note };
  return note;
}

/** Add or remove a bookmark. Returns true when the verse is now bookmarked. */
export function toggleBookmark(key: string, tr: string, label?: string): boolean {
  if (!isVerseKey(key)) return false;
  const cur = bookmarks.peek();
  const next = { ...cur };
  if (cur[key]) {
    delete next[key];
    bookmarks.value = next;
    return false;
  }
  const bm: Bookmark = { tr: cleanTr(tr) ?? 'KJV', created: nowIso() };
  const l = cleanLabel(label);
  if (l) bm.label = l;
  next[key] = bm;
  bookmarks.value = next;
  return true;
}

/** Rename a bookmark (empty label removes it). Returns false when the verse isn't bookmarked. */
export function setBookmarkLabel(key: string, label: string | null): boolean {
  const cur = bookmarks.peek();
  const bm = cur[key];
  if (!bm) return false;
  const l = cleanLabel(label ?? undefined);
  const nb: Bookmark = { tr: bm.tr, created: bm.created };
  if (l) nb.label = l;
  bookmarks.value = { ...cur, [key]: nb };
  return true;
}

/** Remove every highlight, note and bookmark from this browser (the UI asks first). */
export function clearAll(): void {
  batch(() => {
    highlights.value = {};
    notes.value = {};
    bookmarks.value = {};
  });
  flushStudy();
}

/* ------------------------------------------------------------------------ */
/* Validation and migration                                                  */
/* ------------------------------------------------------------------------ */

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function cleanIso(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 40) return null;
  const t = Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function cleanTr(x: unknown): string | null {
  return typeof x === 'string' && /^[A-Za-z0-9-]{1,16}$/.test(x) ? x.toUpperCase() : null;
}

function cleanLabel(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const l = cleanNoteText(x, MAX_LABEL_LENGTH * 2)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
  return l || undefined;
}

export function emptyStudy(): StudyData {
  return { highlights: {}, notes: {}, bookmarks: {} };
}

/**
 * Validate (and normalise) study maps from storage or an import. Unknown verse keys, colours and
 * malformed entries are dropped and counted in `skipped`. Notes longer than the limit are cut.
 */
export function sanitizeStudy(d: Record<string, unknown>): { data: StudyData; skipped: number } {
  const out = emptyStudy();
  let skipped = 0;
  const fallback = nowIso();
  if (isObj(d.highlights)) {
    for (const [k, c] of Object.entries(d.highlights)) {
      if (isVerseKey(k) && isHighlightColor(c)) out.highlights[k] = c;
      else skipped++;
    }
  } else if (d.highlights !== undefined) skipped++;
  if (isObj(d.notes)) {
    for (const [k, n] of Object.entries(d.notes)) {
      if (!isVerseKey(k) || !isObj(n) || typeof n.text !== 'string') {
        skipped++;
        continue;
      }
      const text = cleanNoteText(n.text);
      if (!text.trim()) {
        skipped++;
        continue;
      }
      const created = cleanIso(n.created) ?? cleanIso(n.updated) ?? fallback;
      out.notes[k] = { text, created, updated: cleanIso(n.updated) ?? created };
    }
  } else if (d.notes !== undefined) skipped++;
  if (isObj(d.bookmarks)) {
    for (const [k, b] of Object.entries(d.bookmarks)) {
      if (!isVerseKey(k) || !isObj(b)) {
        skipped++;
        continue;
      }
      const bm: Bookmark = { tr: cleanTr(b.tr) ?? 'KJV', created: cleanIso(b.created) ?? fallback };
      const l = cleanLabel(b.label);
      if (l) bm.label = l;
      out.bookmarks[k] = bm;
    }
  } else if (d.bookmarks !== undefined) skipped++;
  return { data: out, skipped };
}

/**
 * Migration hook: MIGRATIONS[n] turns a version-n object into version n + 1. Version 0 is the
 * unversioned shape of the pre-release stub (same maps, no "version" field).
 */
export const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  0: (d) => ({ ...d, version: 1 }),
};

export interface MigratedStudy {
  data: StudyData;
  /** The version the object was written with. */
  version: number;
  skipped: number;
  /** Top-level fields this version doesn't know (kept when writing back). */
  extras: Record<string, unknown>;
}

/** Bring a stored / imported object up to STUDY_VERSION and validate it. Null when it isn't study data. */
export function migrateStudy(raw: unknown): MigratedStudy | null {
  if (!isObj(raw)) return null;
  const version = raw.version === undefined ? 0 : typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 0 ? raw.version : -1;
  if (version < 0) return null;
  let d: Record<string, unknown> = raw;
  for (let v = version; v < STUDY_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return null;
    d = step(d);
  }
  const { data, skipped } = sanitizeStudy(d);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!['version', 'highlights', 'notes', 'bookmarks', 'format', 'exported', 'app'].includes(k)) extras[k] = v;
  }
  return { data, version, skipped, extras };
}

/* ------------------------------------------------------------------------ */
/* Storage                                                                   */
/* ------------------------------------------------------------------------ */

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; code?: number } | null;
  return Boolean(err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014));
}

interface Loaded {
  data: StudyData;
  status: StudyStatus;
  version: number;
  extras: Record<string, unknown>;
}

function parseStored(raw: string | null): Loaded {
  if (raw === null) return { data: emptyStudy(), status: 'ok', version: STUDY_VERSION, extras: {} };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  const m = json === undefined ? null : migrateStudy(json);
  if (!m) {
    // Keep the unreadable value somewhere before it can be overwritten.
    try {
      store()?.setItem(CORRUPT_KEY, raw);
    } catch {
      /* nothing more we can do */
    }
    return { data: emptyStudy(), status: 'ok', version: STUDY_VERSION, extras: {} };
  }
  return { data: m.data, status: m.version > STUDY_VERSION ? 'newer' : 'ok', version: m.version, extras: m.extras };
}

function loadInitial(): Loaded {
  const s = store();
  if (!s) return { data: emptyStudy(), status: typeof window === 'undefined' ? 'ok' : 'unavailable', version: STUDY_VERSION, extras: {} };
  let raw: string | null;
  try {
    raw = s.getItem(FULL_KEY);
  } catch {
    return { data: emptyStudy(), status: 'unavailable', version: STUDY_VERSION, extras: {} };
  }
  return parseStored(raw);
}

/* ------------------------------------------------------------------------ */
/* State (read from storage when the module loads)                           */
/* ------------------------------------------------------------------------ */

const initial = loadInitial();

/** verse key -> colour */
export const highlights = signal<Record<string, HighlightColor>>(initial.data.highlights);
/** verse key -> note */
export const notes = signal<Record<string, Note>>(initial.data.notes);
/** verse key -> bookmark */
export const bookmarks = signal<Record<string, Bookmark>>(initial.data.bookmarks);
/** Saving state (see StudyStatus). */
export const studyStatus = signal<StudyStatus>(initial.status);
/** When the data was last written to this browser's storage (null: not this session). */
export const studySavedAt = signal<Date | null>(null);

export const studyCounts = computed<StudyCounts>(() => {
  const h = Object.keys(highlights.value).length;
  const n = Object.keys(notes.value).length;
  const b = Object.keys(bookmarks.value).length;
  return { highlights: h, notes: n, bookmarks: b, total: h + n + b };
});

/** What is in storage now (the snapshot our pending changes are relative to). */
let persisted: StudyData = initial.data;
let storedVersion = initial.version;
let storedExtras = initial.extras;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let warned = false;

function current(): StudyData {
  return { highlights: highlights.peek(), notes: notes.peek(), bookmarks: bookmarks.peek() };
}

function sameSnapshot(a: StudyData, b: StudyData): boolean {
  return a.highlights === b.highlights && a.notes === b.notes && a.bookmarks === b.bookmarks;
}

/** The JSON written to localStorage for `data`. */
export function serializeStudy(data: StudyData, extras: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...extras, version: STUDY_VERSION, highlights: data.highlights, notes: data.notes, bookmarks: data.bookmarks });
}

function warn(status: StudyStatus): void {
  studyStatus.value = status;
  if (warned || status === 'ok') return;
  warned = true;
  if (status === 'full') showToast('Couldn’t save — this browser’s storage is full. Export a copy from My study.', 5000);
  else if (status === 'unavailable') showToast('This browser isn’t letting Rootword save your study — it will be lost when you close the tab.', 5000);
  else if (status === 'newer') showToast('Your study was saved by a newer Rootword — reload the page so changes here are saved.', 5000);
}

/** Write pending changes now (also called when the page is hidden). Returns true when saved. */
export function flushStudy(): boolean {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  const cur = current();
  if (sameSnapshot(cur, persisted)) return true;
  if (studyStatus.peek() === 'newer' || storedVersion > STUDY_VERSION) {
    warn('newer');
    return false;
  }
  const s = store();
  if (!s) {
    warn('unavailable');
    return false;
  }
  try {
    s.setItem(FULL_KEY, serializeStudy(cur, storedExtras));
  } catch (e) {
    warn(isQuotaError(e) ? 'full' : 'unavailable');
    return false;
  }
  persisted = cur;
  studySavedAt.value = new Date();
  if (studyStatus.peek() !== 'ok') studyStatus.value = 'ok';
  return true;
}

function scheduleWrite(): void {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushStudy, WRITE_DELAY_MS);
}

/** True while changes are waiting for the debounced write. */
export function hasPendingWrite(): boolean {
  return writeTimer !== undefined;
}

/** Per-map rebase: `remote` plus every entry `local` changed relative to `base`. Pure. */
export function rebaseStudy(base: StudyData, local: StudyData, remote: StudyData): StudyData {
  const map = <T>(b: Record<string, T>, l: Record<string, T>, r: Record<string, T>): Record<string, T> => {
    if (b === l) return r;
    const out = { ...r };
    const keys = new Set([...Object.keys(b), ...Object.keys(l)]);
    for (const k of keys) {
      if (JSON.stringify(b[k]) === JSON.stringify(l[k])) continue;
      if (k in l) out[k] = l[k];
      else delete out[k];
    }
    return out;
  };
  return {
    highlights: map(base.highlights, local.highlights, remote.highlights),
    notes: map(base.notes, local.notes, remote.notes),
    bookmarks: map(base.bookmarks, local.bookmarks, remote.bookmarks),
  };
}

function applyData(d: StudyData): void {
  batch(() => {
    highlights.value = d.highlights;
    notes.value = d.notes;
    bookmarks.value = d.bookmarks;
  });
}

/** Another tab wrote "rootword:study" (or cleared storage). */
function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== FULL_KEY) return;
  if (e.storageArea && e.storageArea !== store()) return;
  const remote = parseStored(e.newValue);
  storedVersion = remote.version;
  storedExtras = remote.extras;
  if (remote.status === 'newer') studyStatus.value = 'newer';
  const local = current();
  const pending = !sameSnapshot(local, persisted);
  const next = pending ? rebaseStudy(persisted, local, remote.data) : remote.data;
  persisted = remote.data;
  applyData(next);
}

let initialised = false;
let disposeEffect: (() => void) | null = null;

/** Start persisting (idempotent; runs on import in a browser). */
export function initStudy(): void {
  if (initialised) return;
  initialised = true;
  disposeEffect = effect(() => {
    const cur = { highlights: highlights.value, notes: notes.value, bookmarks: bookmarks.value };
    if (sameSnapshot(cur, persisted)) return;
    scheduleWrite();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', flushStudy);
    document.addEventListener('visibilitychange', onVisibility);
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') flushStudy();
}

/** Tests: forget the in-memory state and read storage again (as on a fresh page load). */
export function reloadStudyFromStorage(): void {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  const l = loadInitial();
  persisted = l.data;
  storedVersion = l.version;
  storedExtras = l.extras;
  warned = false;
  batch(() => {
    applyData(l.data);
    studyStatus.value = l.status;
    studySavedAt.value = null;
  });
}

/** Tests: stop listening (initStudy() can run again afterwards). */
export function disposeStudy(): void {
  disposeEffect?.();
  disposeEffect = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pagehide', flushStudy);
    document.removeEventListener('visibilitychange', onVisibility);
  }
  clearTimeout(writeTimer);
  writeTimer = undefined;
  initialised = false;
}

/* ------------------------------------------------------------------------ */
/* Export                                                                    */
/* ------------------------------------------------------------------------ */

export const EXPORT_FORMAT = 'rootword-study';

export interface StudyExport extends StudyData {
  format: typeof EXPORT_FORMAT;
  version: number;
  app: 'Rootword';
  exported: string;
}

/** The export file's contents (pure aside from the clock). */
export function studyExportData(data: StudyData = current()): StudyExport {
  const sort = <T>(m: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(m).sort(([a], [b]) => compareVerseKeys(a, b)));
  return {
    format: EXPORT_FORMAT,
    version: STUDY_VERSION,
    app: 'Rootword',
    exported: nowIso(),
    highlights: sort(data.highlights),
    notes: sort(data.notes),
    bookmarks: sort(data.bookmarks),
  };
}

/** "rootword-study-2026-10-23.json" (local date). */
export function studyFileName(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `rootword-study-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** Build the JSON file of everything and start its download. Returns the Blob. */
export function exportStudy(): Blob {
  const blob = new Blob([`${JSON.stringify(studyExportData(), null, 2)}\n`], { type: 'application/json' });
  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = studyFileName();
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return blob;
}

/* ------------------------------------------------------------------------ */
/* Import                                                                    */
/* ------------------------------------------------------------------------ */

export type ImportMode = 'merge' | 'replace';

export interface ParsedImport {
  data: StudyData;
  counts: StudyCounts;
  /** Entries dropped because they were invalid. */
  skipped: number;
  /** When the file was exported (ISO), if it says. */
  exported?: string;
}

export type ParseResult = { ok: true; value: ParsedImport } | { ok: false; error: string };

export function countStudy(d: StudyData): StudyCounts {
  const h = Object.keys(d.highlights).length;
  const n = Object.keys(d.notes).length;
  const b = Object.keys(d.bookmarks).length;
  return { highlights: h, notes: n, bookmarks: b, total: h + n + b };
}

const NOT_STUDY = 'This file isn’t a Rootword study export.';

/** Validate the text of an export file (or a copy of the stored JSON). Pure. */
export function parseStudyJson(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, error: `${NOT_STUDY} It isn’t valid JSON.` };
  }
  if (!isObj(json)) return { ok: false, error: NOT_STUDY };
  if (json.format !== undefined && json.format !== EXPORT_FORMAT) return { ok: false, error: NOT_STUDY };
  if (json.format === undefined && !('highlights' in json || 'notes' in json || 'bookmarks' in json)) return { ok: false, error: NOT_STUDY };
  if (typeof json.version === 'number' && json.version > STUDY_VERSION) {
    return { ok: false, error: 'This file was made by a newer version of Rootword. Reload the page to update, then try again.' };
  }
  const m = migrateStudy(json);
  if (!m) return { ok: false, error: NOT_STUDY };
  const counts = countStudy(m.data);
  if (counts.total === 0) {
    return { ok: false, error: m.skipped ? 'Nothing in this file could be read — every entry was invalid.' : 'This file has no highlights, notes or bookmarks in it.' };
  }
  return { ok: true, value: { data: m.data, counts, skipped: m.skipped, exported: cleanIso(json.exported) ?? undefined } };
}

async function blobText(b: Blob): Promise<string> {
  if (typeof b.text === 'function') return b.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });
}

/** Read and validate a chosen file. */
export async function readStudyFile(file: Blob): Promise<ParseResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is too large to be a Rootword study export (over 5 MB).' };
  let text: string;
  try {
    text = await blobText(file);
  } catch {
    return { ok: false, error: 'Couldn’t read that file.' };
  }
  return parseStudyJson(text);
}

export interface MergeSummary {
  /** Entries new to this device. */
  added: StudyCounts;
  /** Highlights / bookmarks where this device already had something different (kept). */
  kept: number;
  /** Verses where two different notes were combined. */
  combined: number;
}

const earlier = (a: string, b: string) => (a <= b ? a : b);
const later = (a: string, b: string) => (a >= b ? a : b);

/** Merge `incoming` into `base` without losing anything in `base`. Pure. */
export function mergeStudy(base: StudyData, incoming: StudyData): { data: StudyData; summary: MergeSummary } {
  const data: StudyData = { highlights: { ...base.highlights }, notes: { ...base.notes }, bookmarks: { ...base.bookmarks } };
  const added = { highlights: 0, notes: 0, bookmarks: 0, total: 0 };
  let kept = 0;
  let combined = 0;
  for (const [k, c] of Object.entries(incoming.highlights)) {
    const mine = data.highlights[k];
    if (!mine) {
      data.highlights[k] = c;
      added.highlights++;
    } else if (mine !== c) kept++;
  }
  for (const [k, n] of Object.entries(incoming.notes)) {
    const mine = data.notes[k];
    if (!mine) {
      data.notes[k] = n;
      added.notes++;
      continue;
    }
    const a = mine.text.trim();
    const b = n.text.trim();
    if (a === b || a.includes(b)) {
      data.notes[k] = { ...mine, created: earlier(mine.created, n.created) };
    } else if (b.includes(a)) {
      data.notes[k] = { text: n.text, created: earlier(mine.created, n.created), updated: later(mine.updated, n.updated) };
    } else {
      const [first, second] = mine.updated <= n.updated ? [mine, n] : [n, mine];
      data.notes[k] = {
        text: cleanNoteText(`${first.text.trimEnd()}\n\n${second.text.trim()}`, MAX_NOTE_LENGTH * 2),
        created: earlier(mine.created, n.created),
        updated: later(mine.updated, n.updated),
      };
      combined++;
    }
  }
  for (const [k, b] of Object.entries(incoming.bookmarks)) {
    const mine = data.bookmarks[k];
    if (!mine) {
      data.bookmarks[k] = b;
      added.bookmarks++;
      continue;
    }
    const nb: Bookmark = { tr: mine.tr, created: earlier(mine.created, b.created) };
    const label = mine.label ?? b.label;
    if (label) nb.label = label;
    data.bookmarks[k] = nb;
  }
  added.total = added.highlights + added.notes + added.bookmarks;
  return { data, summary: { added, kept, combined } };
}

/** Apply a validated import: merge into what's here, or replace everything. Saves immediately. */
export function applyStudyImport(parsed: ParsedImport, mode: ImportMode = 'merge'): MergeSummary {
  let summary: MergeSummary;
  let data: StudyData;
  if (mode === 'replace') {
    data = parsed.data;
    summary = { added: countStudy(parsed.data), kept: 0, combined: 0 };
  } else {
    ({ data, summary } = mergeStudy(current(), parsed.data));
  }
  applyData(data);
  flushStudy();
  return summary;
}

export type ImportOutcome = ({ ok: true } & MergeSummary & { skipped: number }) | { ok: false; error: string };

/** Read, validate and apply a file in one step (the page shows a preview between the two). */
export async function importStudy(file: Blob | string, mode: ImportMode = 'merge'): Promise<ImportOutcome> {
  const res = typeof file === 'string' ? parseStudyJson(file) : await readStudyFile(file);
  if (!res.ok) return res;
  return { ok: true, skipped: res.value.skipped, ...applyStudyImport(res.value, mode) };
}

if (typeof window !== 'undefined') initStudy();
