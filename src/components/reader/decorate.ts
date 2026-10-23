/**
 * Verse decorations applied to the rendered chapter (imperatively, after each render and whenever
 * the study signals change — the chapter HTML is never rebuilt for them):
 *
 *  - highlights (src/app/study.ts): <span class="verse" data-hl="yellow"> → a tint plus a per-colour
 *    underline style (solid / double / dashed / dotted / wavy) so colour is never the only cue;
 *  - notes / bookmarks: data-note / data-bm on the verse number, which draws a small glyph beside it
 *    and extends its accessible name ("Verse 16, highlighted yellow, bookmarked, has a note");
 *  - the verse being read aloud (listeningVerse): .is-listening.
 *
 * Pure DOM helpers (no signals) so they can be unit-tested with jsdom.
 */
import type { Bookmark, HighlightColor, Note } from '../../app/study';
import { verseKey } from '../../app/study';

export interface StudyMarks {
  highlights: Record<string, HighlightColor>;
  notes: Record<string, Note>;
  bookmarks: Record<string, Bookmark>;
}

/** Accessible name of a verse number with its study marks. */
export function verseLabel(v: number, hl: HighlightColor | undefined, note: boolean, bm: boolean): string {
  const parts = [`Verse ${v}`];
  if (hl) parts.push(`highlighted ${hl}`);
  if (bm) parts.push('bookmarked');
  if (note) parts.push('has a note');
  return parts.join(', ');
}

/** Apply highlight / note / bookmark marks to every verse in `root`. */
export function decorateVerses(root: HTMLElement, book: string, chapter: number, marks: StudyMarks): void {
  const verses = root.querySelectorAll<HTMLElement>('.verse[data-v]');
  for (let i = 0; i < verses.length; i++) {
    const el = verses[i];
    const v = Number(el.dataset.v);
    const key = verseKey(book, chapter, v);
    const hl = marks.highlights[key];
    const note = Boolean(marks.notes[key]);
    const bm = Boolean(marks.bookmarks[key]);
    if (hl) {
      if (el.dataset.hl !== hl) el.dataset.hl = hl;
    } else if (el.dataset.hl) delete el.dataset.hl;
    const vn = el.querySelector<HTMLElement>('[data-vn]');
    if (!vn) continue;
    toggleData(vn, 'note', note);
    toggleData(vn, 'bm', bm);
    const label = verseLabel(v, hl, note, bm);
    if (vn.getAttribute('aria-label') !== label) vn.setAttribute('aria-label', label);
  }
}

function toggleData(el: HTMLElement, name: string, on: boolean): void {
  if (on) {
    if (el.dataset[name] !== '') el.dataset[name] = '';
  } else if (name in el.dataset) delete el.dataset[name];
}

/** Mark the verse being read aloud; returns its element (or null). */
export function markListening(root: HTMLElement, verse: number | null): HTMLElement | null {
  root.querySelectorAll('.verse.is-listening').forEach((n) => n.classList.remove('is-listening'));
  if (verse === null) return null;
  const el = root.querySelector<HTMLElement>(`#v${verse}`);
  el?.classList.add('is-listening');
  return el;
}
