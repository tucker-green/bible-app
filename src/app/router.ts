/**
 * Hash router. Routes:
 *   #/{TR}/{BOOK}/{CHAPTER}[/{VERSE}[-{END}]]   read a chapter (optionally targeting verses)
 *   #/about                                      about & credits
 *   #/search?q=...&tr=...                        open the search panel over the last-read chapter
 * An empty hash opens the last-read chapter (localStorage "rootword:last"), else #/KJV/JHN/1.
 *
 * parseRoute / routeToHash / resolveTranslation are pure (unit-tested); startRouter() wires
 * window.location.hash to the signals in ./state.
 */
import { hashToRef, refToHash } from '../lib/reference';
import type { VerseRef } from '../lib/types';
import { passage, route, searchOpen, searchQuery } from './state';
import { readString, writeString } from './storage';

export type Route =
  | { name: 'read'; tr: string; ref: VerseRef }
  | { name: 'about' }
  | { name: 'search'; q: string; tr?: string }
  | { name: 'notfound'; path: string };

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

/** Inverse of parseRoute. */
export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'read':
      return refToHash(r.tr, r.ref);
    case 'about':
      return '#/about';
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

/** Wire the location hash to the app state. Returns an unsubscribe function. */
export function startRouter(win: Window = window): () => void {
  // The chapter shown under non-reading routes (about, search) is the last one read.
  const initial = parseRoute(defaultReadHash());
  if (initial?.name === 'read') passage.value = { tr: initial.tr, ref: initial.ref };

  const apply = () => {
    let r = parseRoute(win.location.hash);
    if (!r) {
      const target = defaultReadHash();
      win.history.replaceState(win.history.state, '', target);
      r = parseRoute(target) as Route;
    }
    route.value = r;
    if (r.name === 'read') {
      const prev = passage.value;
      const same =
        prev.tr === r.tr &&
        prev.ref.book === r.ref.book &&
        prev.ref.chapter === r.ref.chapter &&
        prev.ref.verse === r.ref.verse &&
        prev.ref.verseEnd === r.ref.verseEnd;
      if (!same) passage.value = { tr: r.tr, ref: r.ref };
      writeString(LAST_READ_KEY, refToHash(r.tr, { book: r.ref.book, chapter: r.ref.chapter }));
    } else if (r.name === 'search') {
      searchQuery.value = r.q;
      searchOpen.value = true;
    }
  };
  win.addEventListener('hashchange', apply);
  apply();
  return () => win.removeEventListener('hashchange', apply);
}
