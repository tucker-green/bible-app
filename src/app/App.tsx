/**
 * App shell (docs/EXPERIENCE.md §1, §4): skip link, header (banner), the routed page in <main>
 * (reader, about, or a code-split page from src/pages/), the search panel, settings sheet, the
 * bottom dock (listen bar + phone toolbar), toasts and the polite live region.
 */
import { useEffect, useRef } from 'preact/hooks';
import { About } from '../components/about/About';
import { Header } from '../components/header/Header';
import { ListenBar } from '../components/listen/ListenBar';
import { Reader } from '../components/reader/Reader';
import { SearchPanel } from '../components/search/SearchPanel';
import { SettingsSheet } from '../components/settings/SettingsSheet';
import { observeDock, startChrome } from '../components/shell/chrome';
import { Toolbar } from '../components/toolbar/Toolbar';
import { nextChapter, prevChapter } from '../lib/data';
import { refToHash } from '../lib/reference';
import { PageRoute } from './pages';
import { DEFAULT_HASH } from './router';
import {
  closePanel,
  closeSearch,
  closeSettings,
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

/** Global shortcuts: "/" search, ←/→ chapter (when not on a word), Esc closes panels. */
function useGlobalKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (e.key === 'Escape') {
        if (searchOpen.value) {
          closeSearch();
          (document.activeElement as HTMLElement | null)?.blur?.();
        } else if (settingsOpen.value) closeSettings();
        else if (panel.value) closePanel();
        return;
      }
      if (isTyping(t)) return;
      if (e.key === '/') {
        e.preventDefault();
        openSearch();
        const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
        requestAnimationFrame(() => input?.focus());
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && route.value.name === 'read') {
        if (t instanceof Element && t.closest('[data-u], [role="dialog"], [role="radiogroup"], .books__grid, .chapters, .seg')) return;
        if (pinnedWord.value || verseSheet.value || searchOpen.value || settingsOpen.value || panel.value || document.querySelector('.pop')) return;
        const { ref } = passage.value;
        const target = e.key === 'ArrowLeft' ? prevChapter(ref.book, ref.chapter) : nextChapter(ref.book, ref.chapter);
        if (target) {
          e.preventDefault();
          navigate({ book: target[0], chapter: target[1] });
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
            Rootword doesn’t know “{decodeURIComponent(path).slice(0, 80)}”. Try the passage picker in the header, or{' '}
            <a href={refToHash(tr, { book: ref.book, chapter: ref.chapter })}>go back to reading</a> (or start at{' '}
            <a href={DEFAULT_HASH}>John 1</a>).
          </p>
        </header>
      </article>
    </div>
  );
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
    requestAnimationFrame(() => {
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
          const target = document.getElementById('text') ?? document.getElementById('page-title') ?? document.getElementById('main');
          if (!target) return;
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          target.focus();
          target.scrollIntoView();
        }}
      >
        {r.name === 'read' || r.name === 'search' ? 'Skip to the text' : 'Skip to the content'}
      </a>
      <Header />
      <main id="main">{page}</main>
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
