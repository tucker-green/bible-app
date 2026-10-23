/**
 * Hash router. Routes:
 *   #/{TR}/{BOOK}/{CHAPTER}[/{VERSE}[-{END}]]   read a chapter (optionally targeting verses)
 *   #/about                                      about & credits
 *   #/search?q=...&tr=...                        open the search panel over the last-read chapter
 *   #/word/{STRONGS}                             word study page (G3056, H7225, H0871a…)
 *   #/person/{ID}  #/place/{ID}                  person / place page (names data ids: p0685, l0123…)
 *   #/lineage/{ID}                               family-tree explorer centred on a person
 *   #/compare/{TR1},{TR2}[,{TR3}]/{BOOK}/{CH}[/{VERSE}]   translations side by side
 *   #/study                                      my highlights, notes and bookmarks
 * An empty hash opens the last-read chapter (localStorage "rootword:last"), else #/KJV/JHN/1.
 *
 * parseRoute / routeToHash / resolveTranslation are pure (unit-tested); startRouter() wires
 * window.location.hash to the signals in ./state.
 */
import { getBook } from '../lib/books';
import { normalizeStrongs } from '../lib/data';
import { hashToRef, refToHash } from '../lib/reference';
import type { VerseRef } from '../lib/types';
import { passage, route, searchOpen, searchQuery } from './state';
import { readString, writeString } from './storage';

export type Route =
  | { name: 'read'; tr: string; ref: VerseRef }
  | { name: 'about' }
  | { name: 'search'; q: string; tr?: string }
  /** Word study; `id` is a normalised Strong's id ("G3056", "H0871a"). */
  | { name: 'word'; id: string }
  /** Person or place page; `id` is a names-data entity id ("p0685", "l0123"), lower-cased. */
  | { name: 'person'; id: string }
  | { name: 'place'; id: string }
  /** Lineage explorer centred on a person entity id. */
  | { name: 'lineage'; id: string }
  /** 2–3 translations side by side for one chapter (optionally scrolled to a verse). */
  | { name: 'compare'; trs: string[]; book: string; chapter: number; verse?: number }
  /** My study: highlights, notes, bookmarks. */
  | { name: 'study' }
  | { name: 'notfound'; path: string };

/** Route names that show a full page instead of the reader. */
export type PageRouteName = Exclude<Route['name'], 'read' | 'search' | 'notfound'>;

/** Entity ids are a kind letter + digits ("p0685", "l0123", "g0007"). */
const ENTITY_ID = /^[a-z][0-9]{1,6}$/;

/** The KJV is the default translation (owner's decision) and the fallback for unknown ones. */
export const DEFAULT_TR = 'KJV';
export const DEFAULT_REF: VerseRef = { book: 'JHN', chapter: 1 };
export const DEFAULT_HASH = refToHash(DEFAULT_TR, DEFAULT_REF);
/** localStorage key (without prefix) of the last chapter read. */
export const LAST_READ_KEY = 'last';

/** Parse a location hash. Returns null for an empty route ("", "#", "#/") — use the default. */
export function parseRoute(hash: string): Route | null {
  const raw = hash.replace(/^#/, '');
  const path = raw.replace(/^\/+/, '');
  if (!path) return null;
  const [pathPart, query = ''] = path.split('?');
  const head = pathPart.replace(/\/+$/, '').toLowerCase();
  if (head === 'about') return { name: 'about' };
  if (head === 'study') return { name: 'study' };
  const segs = pathPart.replace(/\/+$/, '').split('/');
  const kind = segs[0].toLowerCase();
  if (kind === 'word' && segs.length === 2) {
    const id = normalizeStrongs(safeDecode(segs[1]));
    return id ? { name: 'word', id } : { name: 'notfound', path: raw };
  }
  if ((kind === 'person' || kind === 'place' || kind === 'lineage') && segs.length === 2) {
    const id = safeDecode(segs[1]).toLowerCase();
    return ENTITY_ID.test(id) ? { name: kind, id } : { name: 'notfound', path: raw };
  }
  if (kind === 'compare') {
    const r = parseCompare(segs.slice(1));
    return r ?? { name: 'notfound', path: raw };
  }
  if (head === 'search') {
    const params = new URLSearchParams(query);
    const q = params.get('q') ?? '';
    const tr = params.get('tr') ?? undefined;
    return tr ? { name: 'search', q, tr } : { name: 'search', q };
  }
  const read = hashToRef(path);
  if (read) return { name: 'read', tr: read.tr, ref: read.ref };
  return { name: 'notfound', path: raw };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "KJV,BSB" / "JHN" / "3" [/ "16"] -> compare route (2–3 distinct translations). */
function parseCompare(segs: string[]): Route | null {
  if (segs.length < 3 || segs.length > 4) return null;
  const trs = [
    ...new Set(
      safeDecode(segs[0])
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (trs.length < 2 || trs.length > 3) return null;
  const book = getBook(segs[1]);
  if (!book) return null;
  const chapter = Number(segs[2]);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) return null;
  if (segs[3] !== undefined) {
    const verse = Number(segs[3]);
    if (!Number.isInteger(verse) || verse < 1) return null;
    return { name: 'compare', trs, book: book.id, chapter, verse };
  }
  return { name: 'compare', trs, book: book.id, chapter };
}

/** Hash of the compare page: compareHash(['KJV', 'BSB'], 'JHN', 3) -> "#/compare/KJV,BSB/JHN/3". */
export function compareHash(trs: readonly string[], book: string, chapter: number, verse?: number): string {
  return `#/compare/${trs.map(encodeURIComponent).join(',')}/${book}/${chapter}${verse ? `/${verse}` : ''}`;
}

/** Inverse of parseRoute. */
export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'read':
      return refToHash(r.tr, r.ref);
    case 'about':
      return '#/about';
    case 'study':
      return '#/study';
    case 'word':
      return `#/word/${r.id}`;
    case 'person':
    case 'place':
    case 'lineage':
      return `#/${r.name}/${r.id}`;
    case 'compare':
      return compareHash(r.trs, r.book, r.chapter, r.verse);
    case 'search': {
      const params = new URLSearchParams();
      params.set('q', r.q);
      if (r.tr) params.set('tr', r.tr);
      return `#/search?${params.toString()}`;
    }
    case 'notfound':
      return `#${r.path.startsWith('/') ? '' : '/'}${r.path}`;
  }
}

/**
 * The translation id to actually show for a requested one: an exact or case-insensitive match
 * among `available`, else the KJV, else the first available. While nothing is known yet
 * (`available` empty) the request is returned unchanged.
 */
export function resolveTranslation(tr: string, available: readonly { id: string }[]): string {
  if (!available.length) return tr;
  const exact = available.find((t) => t.id === tr);
  if (exact) return exact.id;
  const ci = available.find((t) => t.id.toLowerCase() === tr.toLowerCase());
  if (ci) return ci.id;
  return available.find((t) => t.id === DEFAULT_TR)?.id ?? available[0].id;
}

/** The chapter to open when the URL names none: last read, else John 1 in the KJV. */
export function defaultReadHash(): string {
  const last = readString(LAST_READ_KEY);
  if (last) {
    const r = parseRoute(last);
    if (r?.name === 'read') return refToHash(r.tr, { book: r.ref.book, chapter: r.ref.chapter });
  }
  return DEFAULT_HASH;
}

export interface RouterOptions {
  /**
   * Called for every hash change after the first with the state update to run; it may defer it,
   * e.g. inside a View Transition (src/app/transitions.ts). It MUST call `update` exactly once.
   */
  wrap?: (update: () => void, from: Route, to: Route) => void;
}

/** Wire the location hash to the app state. Returns an unsubscribe function. */
export function startRouter(win: Window = window, opts: RouterOptions = {}): () => void {
  // The chapter shown under non-reading routes (about, search) is the last one read.
  const initial = parseRoute(defaultReadHash());
  if (initial?.name === 'read') passage.value = { tr: initial.tr, ref: initial.ref };

  let first = true;
  let seq = 0;
  const apply = () => {
    const mine = ++seq;
    let r = parseRoute(win.location.hash);
    if (!r) {
      const target = defaultReadHash();
      win.history.replaceState(win.history.state, '', target);
      r = parseRoute(target) as Route;
    }
    const to = r;
    const update = () => {
      if (mine !== seq) return; // a later hash change superseded this one
      route.value = to;
      if (to.name === 'read') {
        const prev = passage.value;
        const same =
          prev.tr === to.tr &&
          prev.ref.book === to.ref.book &&
          prev.ref.chapter === to.ref.chapter &&
          prev.ref.verse === to.ref.verse &&
          prev.ref.verseEnd === to.ref.verseEnd;
        if (!same) passage.value = { tr: to.tr, ref: to.ref };
        writeString(LAST_READ_KEY, refToHash(to.tr, { book: to.ref.book, chapter: to.ref.chapter }));
      } else if (to.name === 'search') {
        searchQuery.value = to.q;
        searchOpen.value = true;
      }
    };
    if (first || !opts.wrap) {
      first = false;
      update();
    } else {
      opts.wrap(update, route.peek(), to);
    }
  };
  win.addEventListener('hashchange', apply);
  apply();
  return () => win.removeEventListener('hashchange', apply);
}
