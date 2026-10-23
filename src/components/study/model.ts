/**
 * Pure helpers for the My study page: group study entries by book in canonical order, search notes,
 * split text around matches, and friendly dates. No DOM, no signals — unit-tested.
 */
import type { HighlightColor } from '../../app/study';
import { compareVerseKeys, parseVerseKey } from '../../app/study';
import { getBook } from '../../lib/books';
import { formatReference } from '../../lib/reference';
import type { VerseRef } from '../../lib/types';

export interface StudyItem<T> {
  key: string;
  ref: VerseRef;
  /** "John 3:16" */
  label: string;
  value: T;
}

export interface BookGroup<T> {
  book: string;
  /** "John", "Psalms" */
  name: string;
  items: StudyItem<T>[];
}

/** Entries of a study map as items, in canonical order, skipping invalid keys. */
export function studyItems<T>(map: Record<string, T>, keep?: (key: string, value: T) => boolean): StudyItem<T>[] {
  const out: StudyItem<T>[] = [];
  for (const key of Object.keys(map).sort(compareVerseKeys)) {
    const p = parseVerseKey(key);
    if (!p) continue;
    const value = map[key];
    if (keep && !keep(key, value)) continue;
    const ref: VerseRef = { book: p.book, chapter: p.chapter, verse: p.verse };
    out.push({ key, ref, label: formatReference(ref), value });
  }
  return out;
}

/** Items grouped by book (Genesis → Revelation), each group in chapter / verse order. */
export function groupByBook<T>(items: StudyItem<T>[]): BookGroup<T>[] {
  const groups: BookGroup<T>[] = [];
  for (const it of items) {
    let g = groups[groups.length - 1];
    if (!g || g.book !== it.ref.book) {
      g = { book: it.ref.book, name: getBook(it.ref.book)?.name ?? it.ref.book, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

/** Count highlights per colour. */
export function colorCounts(map: Record<string, HighlightColor>): Record<HighlightColor, number> {
  const out: Record<HighlightColor, number> = { yellow: 0, green: 0, blue: 0, pink: 0, purple: 0 };
  for (const c of Object.values(map)) if (c in out) out[c]++;
  return out;
}

/** Lower-case, accents removed, curly quotes straightened — for forgiving matching. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
}

/** The words of a search query (folded), empty when there is nothing to search for. */
export function queryTerms(query: string): string[] {
  return foldText(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Every term appears in the note text or its reference label. */
export function matchesQuery(terms: string[], ...fields: string[]): boolean {
  if (!terms.length) return true;
  const hay = fields.map(foldText).join('\n');
  return terms.every((t) => hay.includes(t));
}

export type Piece = string | { mark: string };

/**
 * Split `text` into plain strings and `{ mark }` pieces wherever a query term occurs (accent- and
 * case-insensitive). Rendering the pieces as text nodes keeps notes safe from HTML injection.
 */
export function markPieces(text: string, terms: string[]): Piece[] {
  if (!terms.length || !text) return [text];
  // Fold character by character so indices map back onto the original text.
  const folded: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = foldText(text[i]);
    for (let j = 0; j < f.length; j++) {
      folded.push(f[j]);
      map.push(i);
    }
  }
  const hay = folded.join('');
  const hits: [number, number][] = [];
  for (const t of terms) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(t, from);
      if (at < 0) break;
      hits.push([map[at], map[at + t.length - 1] + 1]);
      from = at + t.length;
    }
  }
  if (!hits.length) return [text];
  hits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push([h[0], h[1]]);
  }
  const out: Piece[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) out.push(text.slice(pos, s));
    out.push({ mark: text.slice(s, e) });
    pos = e;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

/** "just now", "5 minutes ago", "yesterday", "3 days ago", "12 Mar", "12 Mar 2024". */
export function friendlyDate(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const sec = Math.round((now.getTime() - t) / 1000);
  if (sec < 45) return 'just now';
  const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;
  const min = Math.round(sec / 60);
  if (rtf && min < 60) return rtf.format(-min, 'minute');
  const hr = Math.round(min / 60);
  if (rtf && hr < 24 && d.getDate() === now.getDate()) return rtf.format(-hr, 'hour');
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (rtf && days >= 1 && days < 7) return rtf.format(-days, 'day');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** "1 highlight", "3 notes" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
}

/** "12 highlights, 4 notes and 1 bookmark" (zero parts left out; "nothing" when all are zero). */
export function describeCounts(c: { highlights: number; notes: number; bookmarks: number }): string {
  const parts = [
    c.highlights ? plural(c.highlights, 'highlight') : '',
    c.notes ? plural(c.notes, 'note') : '',
    c.bookmarks ? plural(c.bookmarks, 'bookmark') : '',
  ].filter(Boolean);
  if (!parts.length) return 'nothing';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
