/**
 * App shell (docs/EXPERIENCE.md §1, §4): skip link, header (banner), the routed page in <main>
 * (reader, about, or a code-split page from src/pages/), the search panel, settings sheet, the
 * bottom dock (listen bar + phone toolbar), toasts and the polite live region.
 */
import { Component } from 'preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { About } from '../components/about/About';
import { focusSearchTrigger, Header } from '../components/header/Header';
import { ListenBar } from '../components/listen/ListenBar';
import { Reader } from '../components/reader/Reader';
import { SearchPanel } from '../components/search/SearchPanel';
import { SettingsSheet } from '../components/settings/SettingsSheet';
import { observeDock, startChrome } from '../components/shell/chrome';
import { Toolbar } from '../components/toolbar/Toolbar';
import { nextChapter, prevChapter } from '../lib/data';
import { refToHash } from '../lib/reference';
import { PageRoute } from './pages';
import { DEFAULT_HASH, parseRoute, safeDecode } from './router';
import {
  closePanel,
  closeSearch,
  closeSettings,
  closeVerseSheet,
  liveMessage,
  navigate,
  openSearch,
  panel,
  passage,
  pinnedWord,
  route,
  SEARCH_INPUT_ID,
  searchOpen,
  settingsOpen,
  toastMessage,
  verseSheet,
} from './state';
import './app.css';

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

/** True while a modal dialog (verse sheet, settings, a bottom sheet, a drawer…) is open. */
function modalOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
}

/** Global shortcuts: "/" search, ←/→ chapter (when not on a word), Esc closes panels. */
function useGlobalKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (e.key === 'Escape') {
        if (searchOpen.value) {
          closeSearch();
          focusSearchTrigger();
        } else if (settingsOpen.value) closeSettings();
        else if (panel.value) closePanel();
        // A verse panel whose focus was lost (e.g. to <body>) can still be dismissed.
        else if (verseSheet.value && !(t instanceof Element && t.closest('[role="dialog"]'))) closeVerseSheet();
        return;
      }
      if (isTyping(t)) return;
      if (e.key === '/') {
        // Never pull focus out of an open dialog (modal or not).
        if ((t instanceof Element && t.closest('[role="dialog"]')) || verseSheet.value || settingsOpen.value || panel.value || modalOpen()) return;
        e.preventDefault();
        openSearch();
        const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
        requestAnimationFrame(() => input?.focus());
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && route.value.name === 'read') {
        if (t instanceof Element && t.closest('[data-u], [role="dialog"], [role="radiogroup"], .books__grid, .chapters, .seg')) return;
        if (pinnedWord.value || verseSheet.value || searchOpen.value || settingsOpen.value || panel.value || document.querySelector('.pop')) return;
        // Step from the chapter last asked for (the URL), not the one still on screen: quick presses
        // while a chapter change is animating must each move one chapter on.
        const asked = parseRoute(location.hash);
        const ref = asked?.name === 'read' ? asked.ref : passage.value.ref;
        const target = e.key === 'ArrowLeft' ? prevChapter(ref.book, ref.chapter) : nextChapter(ref.book, ref.chapter);
        if (target) {
          e.preventDefault();
          navigate({ book: target[0], chapter: target[1] }, asked?.name === 'read' ? asked.tr : passage.value.tr);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

function NotFound({ path }: { path: string }) {
  const { tr, ref } = passage.value;
  return (
    <div class="page page--about">
      <article class="about">
        <header class="ch-head">
          <p class="eyebrow">Not found</p>
          <h1 class="ch-title">
            <span>No such page</span>
          </h1>
          <span class="ch-rule" aria-hidden="true" />
          <p class="about__lede">
            Rootword doesn’t know “{safeDecode(path).slice(0, 80)}”. Try the passage picker in the header, or{' '}
            <a href={refToHash(tr, { book: ref.book, chapter: ref.chapter })}>go back to reading</a> (or start at{' '}
            <a href={DEFAULT_HASH}>John 1</a>).
          </p>
        </header>
      </article>
    </div>
  );
}

/**
 * Keeps one page's render error from taking the whole app down: the shell (header, toolbar, search)
 * stays usable, the page shows a notice, and the next route change renders afresh.
 */
export class RouteBoundary extends Component<{ routeKey: string; children: ComponentChildren }, { error: unknown; key: string }> {
  state = { error: null as unknown, key: this.props.routeKey };

  static getDerivedStateFromProps(props: { routeKey: string }, state: { key: string }) {
    return props.routeKey !== state.key ? { key: props.routeKey, error: null } : null;
  }

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('render error') };
  }

  componentDidCatch(error: unknown) {
    console.error('Rootword: a page failed to render', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { tr, ref } = passage.peek();
    return (
      <div class="page page--about">
        <article class="about">
          <div class="notice" role="alert">
            <div>
              <p class="notice__title">Something went wrong showing this page.</p>
              <p>
                The rest of Rootword still works.{' '}
                <a href={refToHash(tr, { book: ref.book, chapter: ref.chapter })}>Go back to reading</a> or try again.
              </p>
              <div class="notice__actions">
                <button type="button" class="btn-primary" onClick={() => this.setState({ error: null })}>
                  Try again
                </button>
              </div>
            </div>
          </div>
        </article>
      </div>
    );
  }
}

/** Move focus to the main content after a page change (not on chapter changes inside the reader). */
function usePageFocus(): void {
  const prev = useRef(route.peek().name);
  useEffect(() => {
    const name = route.value.name;
    const was = prev.current;
    prev.current = name;
    if (name === was || name === 'search' || (name === 'read' && was === 'search')) return;
    if (name === 'read') return;
    const want = route.peek();
    requestAnimationFrame(() => {
      // A quick Back may already have left this page: never focus (and so scroll to) the reader's title.
      if (route.peek() !== want) return;
      const h = document.getElementById('page-title') ?? document.querySelector<HTMLElement>('main h1');
      if (h) {
        if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
        h.focus({ preventScroll: true });
      }
    });
  }, [route.value.name, route.value]);
}

/**
 * Keep keyboard focus on screen. Long chapters are laid out lazily (content-visibility: auto), so
 * after the browser scrolls a focused element into view, the blocks around it can render taller
 * than their placeholders and push it out of sight again (e.g. Tab to the chapter-end links).
 * Once layout has settled, bring a keyboard-focused element that ended up hidden back into view,
 * clear of the header and the bottom dock.
 */
function useKeepFocusInView(): void {
  useEffect(() => {
    let timer = 0;
    const reveal = (el: HTMLElement) => {
      if (document.activeElement !== el || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const top = Math.max(0, document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0);
      const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 0;
      if (r.top < top || r.bottom > window.innerHeight - dock) el.scrollIntoView({ block: 'center' });
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(':focus-visible')) return;
      // dialogs, sheets and panels manage their own scrolling
      if (el.closest('[role="dialog"], [role="tooltip"], #search-panel, .pop')) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => requestAnimationFrame(() => reveal(el)), 120);
    };
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('focusin', onFocus);
      window.clearTimeout(timer);
    };
  }, []);
}

function Toast() {
  const toast = toastMessage.value;
  return (
    <div class="toast-region" role="status" aria-live="polite">
      {toast && (
        <div class="toast" key={toast}>
          {toast}
        </div>
      )}
    </div>
  );
}

/** Bottom dock: the listen bar above the phone toolbar (fixed; publishes --dock-h). */
function Dock() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? observeDock(ref.current) : undefined), []);
  return (
    <div class="dock" ref={ref}>
      <div class="listen-dock">
        <ListenBar />
      </div>
      <Toolbar />
    </div>
  );
}

export function App() {
  useGlobalKeys();
  usePageFocus();
  useKeepFocusInView();
  useEffect(() => startChrome(), []);
  const r = route.value;
  const page =
    r.name === 'about' ? <About /> : r.name === 'notfound' ? <NotFound path={r.path} /> : r.name === 'read' || r.name === 'search' ? <Reader /> : <PageRoute route={r} />;
  return (
    <>
      <a
        class="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          const article = document.getElementById('text');
          // Reading: land on the text itself (the next Tab is its first word, past the chapter tools).
          const target = article?.querySelector<HTMLElement>('.prose') ?? article ?? document.getElementById('page-title') ?? document.getElementById('main');
          if (!target) return;
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          (article ?? target).scrollIntoView();
          target.focus({ preventScroll: true });
        }}
      >
        {r.name === 'read' || r.name === 'search' ? 'Skip to the text' : 'Skip to the content'}
      </a>
      <Header />
      <main id="main">
        <RouteBoundary routeKey={JSON.stringify(r)}>{page}</RouteBoundary>
      </main>
      <SearchPanel />
      <SettingsSheet />
      <Dock />
      <Toast />
      <div class="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage.value}
      </div>
    </>
  );
}
