/**
 * The search panel (src/app/README.md "Open search with a query"). Renders while `searchOpen`;
 * the query is `searchQuery`, typed in the header field (id SEARCH_INPUT_ID), which is the
 * combobox of this panel's result listbox (see ./combobox.ts): ↑/↓ (PageUp/PageDown) move through
 * the options with aria-activedescendant, Enter opens one, Tab moves into the panel, Esc closes.
 *
 * Layout (Scholar; docs/EXPERIENCE.md §1):
 *   ≥ 1100 px      overlay under the header, two columns — left: what the query means, testament
 *                  switch, per-book bar list, tips; right: results.
 *   600–1099 px    single-column overlay; testament + book chips above the results.
 *   phones         full-screen sheet below the header; stays above the on-screen keyboard
 *                  (html[data-keyboard="open"] + --kb-h from the VisualViewport, shell/chrome.ts).
 *
 * Results, in order: "Go to John 3:16" (parseReference) / "Open the book of Job" (matchBookName),
 * people & places (name index), then verses grouped by book, paged in as you scroll. Strong's and
 * Greek/Hebrew queries get a lexicon card on top. Runtime translations without a corpus (NIV)
 * search the KJV instead and say so.
 */
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  closeSearch,
  goToHash,
  meta,
  navigate,
  passage,
  remoteTranslations,
  route,
  SEARCH_INPUT_ID,
  searchKeys,
  searchOpen,
  searchQuery,
  translations,
} from '../../app/state';
import { getBookByNum } from '../../lib/books';
import type { BookInfo } from '../../lib/books';
import { feedback } from '../../lib/feedback';
import type { NameIndexEntry } from '../../lib/names';
import { formatReference, matchBookName, parseReference } from '../../lib/reference';
import { warmSearch } from '../../lib/search/client';
import type { SearchHit, SearchSuggestion } from '../../lib/search/client';
import type { VerseRef } from '../../lib/types';
import { focusables, useMedia } from '../common/hooks';
import { SEARCH_LISTBOX_ID, searchCombo } from './combobox';
import {
  addRecent,
  bookCounts,
  clearRecent,
  groupByBook,
  hitKey,
  hitOptionId,
  isPassageQuery,
  nameQuery,
  phraseSuggestion,
  QUERY_HINTS,
  readRecent,
  searchTranslation,
  segments,
  testamentCounts,
  TRY_QUERIES,
} from './model';
import { BookBars, BookChips, Glyph, HintList, LangText, LexCard, Notice, QueryChip, TestamentSwitch } from './parts';
import { useLexEntries, useNames, useSearch, useVersePreview } from './useSearch';
import './search.css';

/* ------------------------------------------------------------------------ */
/* Options                                                                   */
/* ------------------------------------------------------------------------ */

type Option =
  | { kind: 'goto'; id: string; ref: VerseRef }
  /** The whole chapter of a verse reference ("Read Romans 8"). */
  | { kind: 'chapter'; id: string; ref: VerseRef }
  | { kind: 'book'; id: string; book: BookInfo }
  | { kind: 'entity'; id: string; entry: NameIndexEntry }
  | { kind: 'verse'; id: string; hit: SearchHit };

const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const ENTITY_KIND: Record<string, string> = { person: 'Person', place: 'Place', group: 'People group', other: 'Name' };

function entityHash(e: NameIndexEntry): string {
  return `#/${e.kind === 'place' ? 'place' : 'person'}/${e.id}`;
}

/** The first tabbable control after the header's search box (outside the panel), in document order. */
function afterSearchField(): HTMLElement | null {
  const box = inputEl()?.closest('.search');
  if (!box) return null;
  let seen = false;
  for (const el of focusables(document.body)) {
    if (box.contains(el)) {
      seen = true;
      continue;
    }
    if (seen && el.tabIndex >= 0 && !el.closest('#search-panel')) return el;
  }
  return null;
}

function inputEl(): HTMLInputElement | null {
  return typeof document === 'undefined' ? null : (document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null);
}

function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/* ------------------------------------------------------------------------ */
/* Panel                                                                     */
/* ------------------------------------------------------------------------ */

export function SearchPanel() {
  if (!searchOpen.value) return null;
  return <Panel />;
}

function Panel() {
  const raw = searchQuery.value;
  const query = raw.trim().replace(/\s+/g, ' ');
  const r = route.value;
  const requestedTr = r.name === 'search' && r.tr ? r.tr : passage.value.tr;
  const m = meta.value;
  const bundled = useMemo(() => m?.translations.map((t) => t.id) ?? [], [m]);
  const remote = remoteTranslations.value.map((t) => t.id);
  const { tr, fallback } = searchTranslation(requestedTr, bundled, remote);
  const trMeta = translations.value.find((t) => t.id === tr);
  const readMeta = translations.value.find((t) => t.id === requestedTr);
  const trName = trMeta?.name ?? tr;
  const wide = useMedia('(min-width: 1100px)');

  // What the query is: a reference to go to, a book name, a name of a person / place.
  const ref = useMemo(
    () =>
      query
        ? parseReference(query, { verseCount: (book, ch) => m?.books.find((b) => b.id === book)?.verses[ch - 1] })
        : null,
    [query, m],
  );
  const bookMatch = useMemo(() => (!ref && query ? (matchBookName(query) ?? null) : null), [query, ref]);
  const passageOnly = isPassageQuery(query, ref);

  // Filters: the testament switch persists while the panel is open; a book filter belongs to one query.
  const [testament, setTestament] = useState<'OT' | 'NT' | undefined>(undefined);
  const [bookSel, setBookSel] = useState<{ q: string; num: number } | null>(null);
  const bookFilter = bookSel && bookSel.q === query ? bookSel.num : undefined;

  const { view, loadMore, retry } = useSearch(query, tr, { testament, book: bookFilter }, Boolean(query) && !passageOnly);
  const names = useNames(passageOnly ? null : nameQuery(query));
  const current = view.query === query && view.status !== 'idle';
  const res = current ? view.response : null;
  // Results on screen: the current query's, or the previous query's while the next one runs.
  const onScreen = view.status === 'ready' || view.status === 'loading';
  const lex = useLexEntries(onScreen ? (view.response?.strongs ?? []) : []);
  const preview = useVersePreview(ref, requestedTr);
  const [recent, setRecent] = useState<string[]>(() => readRecent());

  /* ---- options (listbox) ------------------------------------------------- */
  const hits = onScreen && view.query ? view.hits : [];
  const options = useMemo(() => {
    const out: Option[] = [];
    if (ref) out.push({ kind: 'goto', id: 'so-goto', ref });
    if (ref?.verse && passageOnly) out.push({ kind: 'chapter', id: 'so-chapter', ref: { book: ref.book, chapter: ref.chapter } });
    if (bookMatch) out.push({ kind: 'book', id: 'so-book', book: bookMatch });
    for (const e of names) out.push({ kind: 'entity', id: `so-e-${e.id}`, entry: e });
    for (const h of hits) out.push({ kind: 'verse', id: hitOptionId(h), hit: h });
    return out;
  }, [ref, passageOnly, bookMatch, names, hits]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = activeId ? options.findIndex((o) => o.id === activeId) : -1;
  useEffect(() => setActiveId(null), [query, testament, bookFilter]);

  /* ---- refs for handlers ---------------------------------------------------- */
  const panelRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const hasMore = Boolean(view.response && view.status !== 'idle' && view.hits.length < view.response.total);
  const live = useRef({ options, activeIndex, hasMore, loadMore, query });
  live.current = { options, activeIndex, hasMore, loadMore, query };

  const pick = (q: string) => {
    searchQuery.value = q;
    const input = inputEl();
    if (input && !coarsePointer()) input.focus({ preventScroll: true });
  };

  const activate = (o: Option) => {
    feedback('select');
    setRecent(addRecent(live.current.query));
    inputEl()?.blur();
    closeSearch();
    switch (o.kind) {
      case 'goto':
      case 'chapter':
        searchQuery.value = '';
        navigate(o.ref, requestedTr);
        break;
      case 'book':
        searchQuery.value = '';
        navigate({ book: o.book.id, chapter: 1 }, requestedTr);
        break;
      case 'entity':
        goToHash(entityHash(o.entry));
        break;
      case 'verse':
        navigate({ book: o.hit.book, chapter: o.hit.chapter, verse: o.hit.verse }, requestedTr);
        break;
    }
  };
  const activateRef = useRef(activate);
  activateRef.current = activate;

  /* ---- combobox wiring (header field) ------------------------------------- */
  // Layout effect: the field's aria-activedescendant must never point at an option that is gone.
  useLayoutEffect(() => {
    searchCombo.value = { expanded: options.length > 0, activeId: activeIndex >= 0 ? options[activeIndex].id : null };
  });
  useEffect(
    () => () => {
      searchCombo.value = { expanded: false, activeId: null };
    },
    [],
  );

  useEffect(() => {
    const move = (delta: number, page = false) => {
      const { options: opts, activeIndex: at, hasMore: more, loadMore: load } = live.current;
      if (!opts.length) return;
      let i: number;
      if (at < 0) i = delta > 0 ? Math.min(opts.length - 1, page ? delta - 1 : 0) : -1;
      else i = at + delta;
      if (i >= opts.length) i = opts.length - 1;
      if (i < 0) i = page && at > 0 ? 0 : -1;
      setActiveId(i >= 0 ? opts[i].id : null);
      if (more && i >= opts.length - 4) load();
    };
    const handler = (e: KeyboardEvent): boolean => {
      if (e.altKey || e.ctrlKey || e.metaKey) return false;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          move(1);
          return true;
        case 'ArrowUp':
          e.preventDefault();
          move(-1);
          return true;
        case 'PageDown':
          e.preventDefault();
          move(8, true);
          return true;
        case 'PageUp':
          e.preventDefault();
          move(-8, true);
          return true;
        case 'Enter': {
          if (e.isComposing) return false;
          const { options: opts, activeIndex: at } = live.current;
          const o = at >= 0 ? opts[at] : opts[0]?.kind === 'goto' || opts[0]?.kind === 'book' ? opts[0] : undefined;
          e.preventDefault();
          if (o) activateRef.current(o);
          // Phones: the keyboard's Search key hides the keyboard so the results can be seen.
          else if (coarsePointer()) (e.target as HTMLElement | null)?.blur?.();
          return true;
        }
        case 'Tab': {
          if (e.shiftKey || !panelRef.current) return false;
          const first = focusables(panelRef.current)[0];
          if (!first) return false;
          e.preventDefault();
          first.focus();
          return true;
        }
        default:
          return false;
      }
    };
    searchKeys.handler = handler;
    return () => {
      if (searchKeys.handler === handler) searchKeys.handler = null;
    };
  }, []);

  // Keep the active option in view (below the sticky book heading).
  useEffect(() => {
    if (!activeId) return;
    const el = document.getElementById(activeId);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  // Opening: warm the index; put focus where it helps (the field with a keyboard, else the title,
  // so a phone's keyboard doesn't cover the results opened from a word card).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a instanceof Element && a !== document.body && a.closest('.search, #search-panel, [data-search-keep]')) return;
      const input = inputEl();
      if (input && !coarsePointer() && input.offsetParent !== null) input.focus({ preventScroll: true });
      else titleRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    warmSearch(tr);
  }, [tr]);

  // New results: back to the top.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [view.query, view.response?.query, testament, bookFilter]);

  // Touch: dragging the results puts the keyboard away, so more of them can be seen.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onMove = () => {
      const input = inputEl();
      if (input && document.activeElement === input) input.blur();
    };
    el.addEventListener('touchmove', onMove, { passive: true });
    return () => el.removeEventListener('touchmove', onMove);
  }, []);

  // Phones: the page under the full-screen sheet doesn't scroll.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('has-search');
    return () => root.classList.remove('has-search');
  }, []);

  // Incremental loading: fetch the next page when the end of the list comes near.
  useEffect(() => {
    const el = moreRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) live.current.loadMore();
      },
      { root: mainRef.current, rootMargin: '0px 0px 600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, view.hits.length]);

  // Shift+Tab from the first control goes back to the field. Tab from the last one carries on to
  // the control after the field (the panel hangs under it), which closes the search: the tab order
  // stays linear, so Tab alone can always get past search (no loop between field and panel).
  const onPanelKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const els = focusables(panelRef.current);
    if (!els.length) return;
    const a = document.activeElement;
    if (!e.shiftKey && a === els[els.length - 1]) {
      const next = afterSearchField();
      if (next) {
        e.preventDefault();
        next.focus();
        return;
      }
    }
    if ((!e.shiftKey && a === els[els.length - 1]) || (e.shiftKey && a === els[0])) {
      const input = inputEl();
      if (input) {
        e.preventDefault();
        input.focus();
      }
    }
  };

  /* ---- announcements (polite, once results settle) ------------------------ */
  const [said, setSaid] = useState('');
  const resultMsg = !query
    ? ''
    : passageOnly
      ? ref
        ? `Go to ${formatReference(ref)}. Press Enter.`
        : ''
      : view.status === 'error' && view.query === query
        ? `Search failed. ${view.error ?? ''}`
        : res && view.status === 'ready'
          ? `${res.total ? plural(res.total, 'verse') : 'No verses'} for ${query}${names.length ? `, ${plural(names.length, 'person or place', 'people and places')}` : ''}${ref ? `. Go to ${formatReference(ref)} is the first option` : ''}.`
          : '';
  useEffect(() => {
    if (!resultMsg) return;
    const t = setTimeout(() => setSaid(resultMsg), 700);
    return () => clearTimeout(t);
  }, [resultMsg]);

  /* ---- derived display ----------------------------------------------------- */
  const loading = Boolean(query) && !passageOnly && (view.status === 'loading' || (view.status !== 'error' && !current));
  const counts = testamentCounts(view.response?.byBook);
  // While the next query runs, the previous results stay (dimmed) rather than flashing a skeleton.
  const shown = view.response && (view.status === 'ready' || view.status === 'loading') ? view.response : null;
  const bookList = bookCounts(view.response?.byBook, testament);
  const groups = useMemo(() => groupByBook(hits), [hits]);
  const showFacets = Boolean(query) && !passageOnly && Boolean(view.response) && (view.response?.totalAll ?? 0) > 0;
  const filtered = Boolean(testament || bookFilter);
  const filterName = bookFilter ? getBookByNum(bookFilter)?.name : testament === 'OT' ? 'the Old Testament' : testament === 'NT' ? 'the New Testament' : '';

  const suggestions: SearchSuggestion[] = [];
  if (res && current) {
    const ph = phraseSuggestion(query);
    if (ph && res.total > 0) suggestions.push(ph);
    for (const s of res.suggestions) if (!suggestions.some((x) => x.query === s.query)) suggestions.push(s);
    if (ph && res.total === 0) suggestions.push(ph);
  }

  const setTestamentFilter = (t: 'OT' | 'NT' | undefined) => {
    setTestament(t);
    if (bookFilter && t && getBookByNum(bookFilter)?.testament !== t) setBookSel(null);
  };
  const setBookFilter = (num: number | undefined) => {
    setBookSel(num ? { q: query, num } : null);
    if (num && testament && getBookByNum(num)?.testament !== testament) setTestament(undefined);
  };

  /* ---- title ------------------------------------------------------------- */
  let title: JSX.Element | string;
  let sub: JSX.Element | string | null = null;
  if (!query) {
    title = 'Search the Bible';
    sub = `Words and phrases, Strong’s numbers, Greek and Hebrew words, people and places — or a reference. Searching the ${trName}.`;
  } else if (passageOnly) {
    title = 'Go to a passage';
    sub = ref ? `${formatReference(ref)} in the ${readMeta?.name ?? requestedTr}` : null;
  } else if (shown && view.status !== 'error') {
    const bare = view.query.replace(/^["“„«](.*)["”»]$/, '$1');
    const q = (
      <span class="sp-title__q">
        “<LangText text={bare} />”
      </span>
    );
    title = shown.total ? (
      <>
        <span class="tnum">{fmt(shown.total)}</span> {shown.total === 1 ? 'verse' : 'verses'} for {q}
        {filtered && <span class="sp-title__in"> in {filterName}</span>}
      </>
    ) : (
      <>
        No verses for {q}
        {filtered && <span class="sp-title__in"> in {filterName}</span>}
      </>
    );
    // The engine folds case ("abraham"); show a plain word the way it was typed.
    const interpreted =
      shown.interpreted.toLowerCase() === `“${view.query.toLowerCase()}”` ? `“${view.query}”` : shown.interpreted;
    sub = (
      <>
        Matching <LangText text={interpreted} /> in the {trName}
      </>
    );
  } else if (view.status === 'error' && view.query === query) {
    title = 'Search didn’t work';
    sub = view.error;
  } else {
    title = 'Searching…';
    sub = `Looking through the ${trName}`;
  }

  /* ---- render --------------------------------------------------------------- */
  const facetsAside = wide && showFacets;
  const listLabel = query ? `Results for ${query}` : 'Results';

  const renderOption = (o: Option): JSX.Element => {
    const active = o.id === activeId;
    const common = {
      id: o.id,
      role: 'option',
      'aria-selected': active,
      onClick: () => activate(o),
    } as const;
    switch (o.kind) {
      case 'goto':
        return (
          <div {...common} class={`sp-opt sp-goto${active ? ' is-active' : ''}`}>
            <span class="sp-opt__icon">
              <Glyph name="goto" />
            </span>
            <span class="sp-opt__body">
              <span class="sp-goto__label">
                Go to <b>{formatReference(o.ref)}</b>
                <span class="sp-goto__tr"> {readMeta?.abbr ?? requestedTr}</span>
              </span>
              {o.ref.verse && (
                <span class={`sp-goto__text${preview ? '' : ' is-loading'}${passageOnly ? ' is-full' : ''}`}>
                  {preview ?? '\u00a0'}
                </span>
              )}
            </span>
            <span class="kbd sp-opt__kbd" aria-hidden="true">
              ↵
            </span>
          </div>
        );
      case 'chapter': {
        const count = m?.books.find((b) => b.id === o.ref.book)?.verses[o.ref.chapter - 1];
        return (
          <div {...common} class={`sp-opt sp-goto${active ? ' is-active' : ''}`}>
            <span class="sp-opt__icon">
              <Glyph name="book" />
            </span>
            <span class="sp-opt__body">
              <span class="sp-goto__label">
                Read <b>{formatReference(o.ref)}</b>
              </span>
              {count ? <span class="sp-opt__meta">The whole chapter · {plural(count, 'verse')}</span> : null}
            </span>
          </div>
        );
      }
      case 'book':
        return (
          <div {...common} class={`sp-opt sp-goto${active ? ' is-active' : ''}`}>
            <span class="sp-opt__icon">
              <Glyph name="book" />
            </span>
            <span class="sp-opt__body">
              <span class="sp-goto__label">
                Open the book of <b>{o.book.name}</b>
              </span>
              <span class="sp-opt__meta">
                {plural(o.book.chapters, 'chapter')} · {o.book.testament === 'OT' ? 'Old Testament' : 'New Testament'}
              </span>
            </span>
            <span class="kbd sp-opt__kbd" aria-hidden="true">
              ↵
            </span>
          </div>
        );
      case 'entity':
        return (
          <div {...common} class={`sp-opt sp-ent${active ? ' is-active' : ''}`}>
            <span class={`sp-opt__icon sp-ent__icon is-${o.entry.kind}`}>
              <Glyph name={o.entry.kind === 'place' ? 'place' : o.entry.kind === 'person' ? 'person' : 'group'} />
            </span>
            <span class="sp-opt__body">
              <span class="sp-ent__name">
                {o.entry.name} <span class="sp-ent__kind">{ENTITY_KIND[o.entry.kind] ?? 'Name'}</span>
              </span>
              {o.entry.brief && <span class="sp-opt__meta">{o.entry.brief}</span>}
            </span>
            <span class="sp-ent__count tnum">{plural(o.entry.refCount, 'verse')}</span>
          </div>
        );
      case 'verse': {
        const h = o.hit;
        const spans = h.highlights.length ? h.highlights : view.linked[hitKey(h)];
        return (
          <div {...common} class={`sp-opt sp-hit${active ? ' is-active' : ''}`}>
            <span class="sp-hit__ref">
              {formatReference({ book: h.book, chapter: h.chapter, verse: h.verse })}
              <span class="sp-hit__tr"> {view.tr}</span>
            </span>
            <span class="sp-hit__text">
              {segments(h.text, spans).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : s.text))}
            </span>
          </div>
        );
      }
    }
  };

  const gotoOpts = options.filter((o) => o.kind === 'goto' || o.kind === 'chapter' || o.kind === 'book');
  const entOpts = options.filter((o) => o.kind === 'entity');
  const optById = new Map(options.map((o) => [o.id, o]));

  const facets = showFacets && (
    <>
      <div class="sp-facet">
        <h3 class="eyebrow sp-facet__h">Testament</h3>
        <TestamentSwitch counts={counts} value={testament} onChange={setTestamentFilter} />
      </div>
      {bookList.length > 0 && (
        <div class="sp-facet sp-facet--books">
          <div class="sp-facet__row">
            <h3 class="eyebrow sp-facet__h" id="sp-books-h">
              By book
            </h3>
            {bookFilter && (
              <button type="button" class="link-btn" onClick={() => setBookFilter(undefined)}>
                All books
              </button>
            )}
          </div>
          <BookBars books={bookList} value={bookFilter} onChange={setBookFilter} labelledBy="sp-books-h" />
        </div>
      )}
    </>
  );

  return (
    <>
      <div class="sp-scrim" aria-hidden="true" />
      <section
        id="search-panel"
        ref={panelRef}
        class={`sp${query && !passageOnly ? ' has-query' : ''}${facetsAside ? ' has-aside' : ''}`}
        aria-label="Search"
        data-keep-word
        onKeyDown={onPanelKeyDown}
      >
        <header class={`sp-head${loading && shown ? ' is-stale' : ''}`}>
          <div class="sp-head__text">
            <h2 class="sp-title" ref={titleRef} tabIndex={-1}>
              {title}
            </h2>
            {sub && <p class="sp-sub">{sub}</p>}
          </div>
        </header>
        <div class={`sp-progress${loading ? ' is-on' : ''}`} aria-hidden="true" />

        <div class="sp-body">
          {facetsAside && (
            <div class="sp-side" role="group" aria-label="Refine the results">
              {facets}
              <div class="sp-facet sp-facet--tips">
                <h3 class="eyebrow sp-facet__h">Search tips</h3>
                <HintList hints={QUERY_HINTS.slice(1, 8)} onPick={pick} compact />
              </div>
            </div>
          )}

          {/* focusable so the results can be scrolled from the keyboard too (axe: scrollable-region-focusable) */}
          <div class="sp-main" ref={mainRef} aria-busy={loading ? 'true' : 'false'} tabIndex={0} role="region" aria-label="Results">
            {fallback && query && !passageOnly && (
              <Notice>
                {`The ${readMeta?.abbr ?? requestedTr} can’t be searched here, so these are matches in the ${trName}. Verses open in the ${readMeta?.abbr ?? requestedTr}.`}
              </Notice>
            )}
            {current && res && res.errors.length > 0 && <Notice kind="alert">{res.errors.join(' · ')}</Notice>}

            {lex.length > 0 && !passageOnly && query && (
              <div class="sp-lexes">
                {lex.map((e, i) => (
                  <LexCard key={e.id} entry={e} tr={view.tr} compact={i > 0} />
                ))}
              </div>
            )}

            {!wide && showFacets && (
              <div class="sp-strip">
                <TestamentSwitch counts={counts} value={testament} onChange={setTestamentFilter} />
                {bookList.length > 1 && <BookChips books={bookList} value={bookFilter} onChange={setBookFilter} />}
              </div>
            )}

            {suggestions.length > 0 && res && res.total > 0 && (
              <p class="sp-suggest">
                <span class="sp-suggest__lbl">Also try</span>
                {suggestions.slice(0, 3).map((s) => (
                  <button key={s.query} type="button" class="sp-suggest__btn" onClick={() => pick(s.query)}>
                    <LangText text={s.label} />
                  </button>
                ))}
              </p>
            )}

            {options.length > 0 && (
              <div class={`sp-list${loading ? ' is-stale' : ''}`} role="listbox" id={SEARCH_LISTBOX_ID} aria-label={listLabel}>
                {gotoOpts.length > 0 && (
                  <div class="sp-group sp-group--goto" role="group" aria-labelledby="sp-g-goto">
                    <div class="sp-ghead" id="sp-g-goto">
                      <span>Go to</span>
                    </div>
                    {gotoOpts.map(renderOption)}
                  </div>
                )}
                {entOpts.length > 0 && (
                  <div class="sp-group sp-group--ents" role="group" aria-labelledby="sp-g-ents">
                    <div class="sp-ghead" id="sp-g-ents">
                      <span>People &amp; places</span>
                    </div>
                    {entOpts.map(renderOption)}
                  </div>
                )}
                {groups.map((g) => (
                  <div key={g.book} class="sp-group" role="group" aria-labelledby={`sp-g-${g.book}`}>
                    <div class="sp-ghead" id={`sp-g-${g.book}`}>
                      <span>{g.name}</span>
                      <span class="sp-ghead__n tnum">
                        <span class="sr-only">, </span>
                        {plural(view.response?.byBook[g.bookNum] ?? g.hits.length, 'verse')}
                      </span>
                    </div>
                    {g.hits.map((h) => renderOption(optById.get(hitOptionId(h)) as Option))}
                  </div>
                ))}
              </div>
            )}

            {hasMore && (
              <div class="sp-more" ref={moreRef}>
                <button type="button" class="btn-quiet" onClick={loadMore} disabled={view.loadingMore}>
                  {view.loadingMore
                    ? 'Loading more…'
                    : view.moreFailed
                      ? 'Couldn’t load more — try again'
                      : `Show more (${fmt((view.response?.total ?? 0) - view.hits.length)} more ${(view.response?.total ?? 0) - view.hits.length === 1 ? 'verse' : 'verses'})`}
                </button>
              </div>
            )}
            {!hasMore && current && res && res.total > 10 && view.status === 'ready' && (
              <p class="sp-end">
                End of results · {plural(res.total, 'verse')}
                {filtered ? ` in ${filterName}` : ''}
              </p>
            )}

            {/* states */}
            {!query && (
              <EmptyState
                recent={recent}
                onPick={pick}
                onClear={() => {
                  clearRecent();
                  setRecent([]);
                }}
              />
            )}
            {query && !passageOnly && hits.length === 0 && loading && <Skeleton />}
            {query && !passageOnly && current && res && view.status === 'ready' && res.total === 0 && (
              <NoResults
                query={query}
                tr={view.tr}
                suggestions={suggestions}
                filtered={filtered}
                hasOthers={options.length > 0}
                onPick={pick}
                onClearFilters={() => {
                  setTestament(undefined);
                  setBookSel(null);
                }}
              />
            )}
            {query && view.status === 'error' && view.query === query && (
              <div class="sp-state" role="alert">
                <p class="sp-state__title">The search index couldn’t be loaded.</p>
                <p class="sp-state__text">
                  {typeof navigator !== 'undefined' && navigator.onLine === false
                    ? 'You seem to be offline, and this translation’s search index isn’t saved on this device yet.'
                    : 'Check your connection and try again.'}
                </p>
                <button type="button" class="btn-primary" onClick={retry}>
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>

        <footer class="sp-foot">
          <span class="sp-foot__try" hidden={!query}>
            <span class="sp-foot__lbl">Try</span>
            {TRY_QUERIES.map((t) => (
              <QueryChip key={t.q} q={t.q} lang={t.lang} onPick={pick} />
            ))}
          </span>
          <span class="sp-foot__keys" aria-hidden="true">
            <span class="kbd">↑</span>
            <span class="kbd">↓</span> choose <span class="kbd">↵</span> open <span class="kbd">esc</span> close
          </span>
        </footer>
        <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {said}
        </p>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* States                                                                    */
/* ------------------------------------------------------------------------ */

function EmptyState({ recent, onPick, onClear }: { recent: string[]; onPick: (q: string) => void; onClear: () => void }) {
  return (
    <div class="sp-empty">
      {recent.length > 0 && (
        <section class="sp-recent" aria-labelledby="sp-recent-h">
          <div class="sp-facet__row">
            <h3 class="eyebrow" id="sp-recent-h">
              Recent
            </h3>
            <button type="button" class="link-btn" onClick={onClear}>
              Clear
            </button>
          </div>
          <div class="sp-recent__list">
            {recent.map((q) => (
              <button key={q} type="button" class="sp-recent__q" onClick={() => onPick(q)}>
                <Glyph name="history" />
                <LangText text={q} />
              </button>
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="sp-how-h">
        <h3 class="eyebrow" id="sp-how-h">
          How to search
        </h3>
        <HintList hints={QUERY_HINTS} onPick={onPick} />
      </section>
    </div>
  );
}

function Skeleton() {
  return (
    <div class="sp-skel" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} class="sp-skel__row">
          <span class="skeleton" style={{ width: '96px', height: '10px' }} />
          <span class="skeleton" style={{ width: '94%' }} />
          <span class="skeleton" style={{ width: i % 2 ? '58%' : '76%' }} />
        </div>
      ))}
    </div>
  );
}

function NoResults({
  query,
  tr,
  suggestions,
  filtered,
  hasOthers,
  onPick,
  onClearFilters,
}: {
  query: string;
  tr: string;
  suggestions: SearchSuggestion[];
  filtered: boolean;
  hasOthers: boolean;
  onPick: (q: string) => void;
  onClearFilters: () => void;
}) {
  return (
    <div class={`sp-state${hasOthers ? ' is-after' : ''}`}>
      {!hasOthers && <Glyph name="search" class="sp-state__icon" />}
      <p class="sp-state__title">
        No verses match “<LangText text={query} />”{filtered ? ' with these filters' : ''}.
      </p>
      {(suggestions.length > 0 || filtered) && (
        <ul class="sp-sugg">
          {filtered && (
            <li>
              <button type="button" class="sp-suggest__btn" onClick={onClearFilters}>
                Search the whole Bible
              </button>
            </li>
          )}
          {suggestions.map((s) => (
            <li key={s.query}>
              <button type="button" class="sp-suggest__btn" onClick={() => onPick(s.query)}>
                <LangText text={s.label} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="sp-state__text">
        Check the spelling, use fewer words, or end a word with <code>*</code> to match its beginning (<code>bless*</code>).
        {tr === 'KJV' && ' The KJV keeps old spellings: “shew”, “saith”, “hath”.'}
      </p>
      {!hasOthers && (
        <section class="sp-state__hints" aria-labelledby="sp-how-h2">
          <h3 class="eyebrow" id="sp-how-h2">
            How to search
          </h3>
          <HintList hints={QUERY_HINTS} onPick={onPick} />
        </section>
      )}
    </div>
  );
}
