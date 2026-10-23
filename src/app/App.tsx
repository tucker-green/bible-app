/** App shell: header, the routed page (reader / about), search panel, settings sheet, toast, live region. */
import { useEffect } from 'preact/hooks';
import { About } from '../components/about/About';
import { Header } from '../components/header/Header';
import { Reader } from '../components/reader/Reader';
import { SearchPanel } from '../components/search/SearchPanel';
import { SettingsSheet } from '../components/settings/SettingsSheet';
import { nextChapter, prevChapter } from '../lib/data';
import { refToHash } from '../lib/reference';
import { DEFAULT_HASH } from './router';
import {
  closeSearch,
  closeSettings,
  liveMessage,
  navigate,
  openSearch,
  passage,
  pinnedWord,
  route,
  SEARCH_INPUT_ID,
  searchOpen,
  settingsOpen,
  toastMessage,
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
        if (pinnedWord.value || searchOpen.value || settingsOpen.value || document.querySelector('.pop')) return;
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

export function App() {
  useGlobalKeys();
  const r = route.value;
  const toast = toastMessage.value;
  return (
    <>
      <a
        class="skip-link"
        href="#text"
        onClick={(e) => {
          e.preventDefault();
          const text = document.getElementById('text');
          text?.focus();
          text?.scrollIntoView();
        }}
      >
        Skip to the text
      </a>
      <Header />
      <main id="main">{r.name === 'about' ? <About /> : r.name === 'notfound' ? <NotFound path={r.path} /> : <Reader />}</main>
      <SearchPanel />
      <SettingsSheet />
      <div class="toast-region" role="status" aria-live="polite">
        {toast && <div class="toast">{toast}</div>}
      </div>
      <div class="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage.value}
      </div>
    </>
  );
}
