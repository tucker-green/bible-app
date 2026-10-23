/**
 * Personal study data: highlights, notes and bookmarks, kept only in this browser.
 *
 * STUB: the shapes and signals are fixed so the reader can render decorations now; storage,
 * export/import and the UI are being written by the personal-study agent.
 * Verse keys are "BOOK.CHAPTER.VERSE" in English versification, e.g. "JHN.3.16" (translation-independent).
 */
import { signal } from '@preact/signals';

/** Named highlight colours; each also has a distinct pattern so colour is never the only cue. */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];

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

/** verse key -> colour */
export const highlights = signal<Record<string, HighlightColor>>({});
/** verse key -> note */
export const notes = signal<Record<string, Note>>({});
/** verse key -> bookmark */
export const bookmarks = signal<Record<string, Bookmark>>({});

export function verseKey(book: string, chapter: number, verse: number): string {
  return `${book}.${chapter}.${verse}`;
}
