/**
 * Search-as-you-type for the panel: debounced (~150 ms after the last keystroke, immediately when
 * only a filter changes), every superseded request aborted through an AbortSignal, results paged
 * in (loadMore), and — for Strong's / lemma queries, whose hits carry no highlights — the English
 * words linked to the Strong's numbers highlighted afterwards (client.highlightLinked).
 *
 * Also: the name index (people & places), lexicon entries for Strong's queries and the text of a
 * typed reference ("Rom 8:28") for the "Go to" preview.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { loadLexEntry, loadText, tokensToText } from '../../lib/data';
import { loadNameIndex, searchNames } from '../../lib/names';
import type { NameIndexEntry } from '../../lib/names';
import { highlightLinked, isAbortError, search } from '../../lib/search/client';
import type { SearchHit, SearchResponse } from '../../lib/search/client';
import type { LexEntry, VerseRef } from '../../lib/types';
import { hitKey, isNameMatch } from './model';

export const PAGE_SIZE = 40;
export const DEBOUNCE_MS = 150;

export interface SearchFilters {
  testament?: 'OT' | 'NT';
  /** Book number 1–66. */
  book?: number;
}

export interface SearchView {
  /** idle: no query · loading: a request is pending (old results may still show) · ready · error */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The query the shown results belong to. */
  query: string;
  tr: string;
  filters: SearchFilters;
  response: SearchResponse | null;
  hits: SearchHit[];
  /** highlightLinked() spans by hit key, for Strong's / lemma queries. */
  linked: Record<string, [number, number][]>;
  loadingMore: boolean;
  moreFailed: boolean;
  error: string | null;
}

const IDLE: SearchView = {
  status: 'idle',
  query: '',
  tr: '',
  filters: {},
  response: null,
  hits: [],
  linked: {},
  loadingMore: false,
  moreFailed: false,
  error: null,
};

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return /fetch|network|failed|load/i.test(m) ? 'The search index could not be loaded.' : m || 'Search failed.';
}

export interface UseSearch {
  view: SearchView;
  loadMore: () => void;
  retry: () => void;
}

/** Run `query` (already trimmed) against `tr`. `enabled` false (panel closed / no text search) resets. */
export function useSearch(query: string, tr: string, filters: SearchFilters, enabled: boolean): UseSearch {
  const [view, setView] = useState<SearchView>(IDLE);
  const viewRef = useRef(view);
  viewRef.current = view;
  const ctrl = useRef<AbortController | null>(null);
  const lastQuery = useRef('');
  const [attempt, setAttempt] = useState(0);
  const { testament, book } = filters;

  const link = useCallback((q: string, trId: string, hits: SearchHit[], strongs: string[], signal: AbortSignal) => {
    if (!strongs.length || !hits.length) return;
    highlightLinked(trId, hits, strongs, { signal }).then(
      (spans) => {
        if (signal.aborted) return;
        setView((cur) => {
          if (cur.query !== q) return cur;
          const linked = { ...cur.linked };
          hits.forEach((h, i) => {
            if (spans[i]?.length) linked[hitKey(h)] = spans[i];
          });
          return { ...cur, linked };
        });
      },
      () => undefined, // highlighting is a nicety: keep the plain results
    );
  }, []);

  useEffect(() => {
    // Whatever was in flight is stale now.
    ctrl.current?.abort();
    ctrl.current = null;
    if (!enabled || !query) {
      lastQuery.current = '';
      setView(IDLE);
      return;
    }
    const typed = query !== lastQuery.current;
    lastQuery.current = query;
    setView((v) => ({ ...v, status: 'loading', error: null }));
    const opts = { testament, book };
    const timer = setTimeout(
      () => {
        const c = new AbortController();
        ctrl.current = c;
        search(query, { tr, testament, book, limit: PAGE_SIZE }, { signal: c.signal }).then(
          (res) => {
            if (c.signal.aborted) return;
            setView({
              status: 'ready',
              query,
              tr,
              filters: opts,
              response: res,
              hits: res.results,
              linked: {},
              loadingMore: false,
              moreFailed: false,
              error: null,
            });
            link(query, tr, res.results, res.strongs, c.signal);
          },
          (err) => {
            if (c.signal.aborted || isAbortError(err)) return;
            setView((v) => ({ ...v, status: 'error', query, tr, error: errorText(err) }));
          },
        );
      },
      typed ? DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [query, tr, testament, book, enabled, attempt]);

  // Abort on unmount.
  useEffect(() => () => ctrl.current?.abort(), []);

  const loadMore = useCallback(() => {
    const v = viewRef.current;
    const c = ctrl.current;
    if (!c || c.signal.aborted || v.status !== 'ready' || v.loadingMore || !v.response) return;
    if (v.hits.length >= v.response.total) return;
    const offset = v.hits.length;
    setView({ ...v, loadingMore: true, moreFailed: false });
    search(v.query, { tr: v.tr, ...v.filters, limit: PAGE_SIZE, offset }, { signal: c.signal }).then(
      (res) => {
        if (c.signal.aborted) return;
        setView((cur) =>
          cur.response === v.response && cur.hits.length === offset
            ? { ...cur, hits: [...cur.hits, ...res.results], loadingMore: false }
            : cur,
        );
        link(v.query, v.tr, res.results, res.strongs, c.signal);
      },
      (err) => {
        if (c.signal.aborted || isAbortError(err)) return;
        setView((cur) => (cur.response === v.response ? { ...cur, loadingMore: false, moreFailed: true } : cur));
      },
    );
  }, [link]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { view, loadMore, retry };
}

/* ------------------------------------------------------------------------ */
/* People & places                                                           */
/* ------------------------------------------------------------------------ */

/** Matching people / places for a name-like query (null query = none). Debounced with the search. */
export function useNames(query: string | null, limit = 6): NameIndexEntry[] {
  const [found, setFound] = useState<{ q: string; list: NameIndexEntry[] }>({ q: '', list: [] });
  useEffect(() => {
    if (!query) {
      setFound({ q: '', list: [] });
      return;
    }
    let off = false;
    const timer = setTimeout(() => {
      loadNameIndex().then(
        (index) => {
          if (off) return;
          const list = searchNames(index, query, { limit: limit * 3 })
            .filter((e) => isNameMatch(e.name, query))
            .slice(0, limit);
          setFound({ q: query, list });
        },
        () => !off && setFound({ q: query, list: [] }),
      );
    }, DEBOUNCE_MS);
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, [query, limit]);
  return query && found.q === query ? found.list : [];
}

/* ------------------------------------------------------------------------ */
/* Lexicon entries for Strong's / lemma queries                              */
/* ------------------------------------------------------------------------ */

export function useLexEntries(ids: readonly string[], max = 3): LexEntry[] {
  const key = ids.slice(0, max).join(',');
  const [entries, setEntries] = useState<{ key: string; list: LexEntry[] }>({ key: '', list: [] });
  useEffect(() => {
    if (!key) {
      setEntries({ key: '', list: [] });
      return;
    }
    let off = false;
    Promise.all(key.split(',').map((id) => loadLexEntry(id).catch(() => undefined))).then((list) => {
      if (!off) setEntries({ key, list: list.filter((e): e is LexEntry => Boolean(e)) });
    });
    return () => {
      off = true;
    };
  }, [key]);
  return entries.key === key ? entries.list : [];
}

/* ------------------------------------------------------------------------ */
/* "Go to" preview                                                           */
/* ------------------------------------------------------------------------ */

/** The text of a typed reference's first verse in `tr` (null while loading / unavailable). */
export function useVersePreview(ref: VerseRef | null, tr: string): string | null {
  const key = ref?.verse ? `${tr}/${ref.book}/${ref.chapter}/${ref.verse}` : '';
  const [text, setText] = useState<{ key: string; text: string | null }>({ key: '', text: null });
  useEffect(() => {
    if (!key || !ref?.verse) return;
    let off = false;
    const timer = setTimeout(() => {
      loadText(tr, ref.book, ref.chapter).then(
        (ch) => {
          const v = ch.verses.find((x) => x.v === ref.verse);
          if (!off) setText({ key, text: v ? tokensToText(v.t).trim() : null });
        },
        () => !off && setText({ key, text: null }),
      );
    }, DEBOUNCE_MS);
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, [key]);
  return text.key === key ? text.text : null;
}
