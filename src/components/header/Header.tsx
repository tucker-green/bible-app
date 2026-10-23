/**
 * Masthead (Scholar): R mark + wordmark · ‹ book/chapter › · translation · search · Reading |
 * Interlinear · Aa · theme. Phones (< 600px) get the compact top bar of docs/EXPERIENCE.md §1 —
 * just "John 1 · KJV" (each half opens its picker) — while the bottom toolbar carries the rest;
 * the bar hides on scroll down and comes back on scroll up (shell/chrome.ts).
 *
 * The book / translation pickers and the Aa panel are driven by the `panel` signal (openPanel /
 * togglePanel), so the header and the phone toolbar open the same panels.
 */
import { useEffect, useRef } from 'preact/hooks';
import {
  closePanel,
  closeSearch,
  cycleTheme,
  effectiveTheme,
  meta,
  navigate,
  openSearch,
  panel,
  panelAnchor,
  passage,
  readingMode,
  route,
  SEARCH_INPUT_ID,
  searchKeys,
  searchOpen,
  searchQuery,
  setReadingMode,
  theme,
  togglePanel,
  translations,
} from '../../app/state';
import { getBook } from '../../lib/books';
import { nextChapter, prevChapter } from '../../lib/data';
import { formatChapter, parseReference, refToHash } from '../../lib/reference';
import { shortName } from '../common/alignment';
import { BrandMark, Icon } from '../common/Icon';
import { UiIcon } from '../shell/icons';
import { DisplayPanel } from '../toolbar/DisplayPanel';
import { BookPicker } from './BookPicker';
import { TranslationPicker } from './TranslationPicker';
import './header.css';

export function ModeToggle({ class: cls = '' }: { class?: string }) {
  const mode = readingMode.value;
  return (
    <div class={`seg ${cls}`.trim()} role="group" aria-label="Reading mode">
      <button type="button" aria-pressed={mode === 'reading'} onClick={() => setReadingMode('reading')}>
        <Icon name="text" />
        Reading
      </button>
      <button type="button" aria-pressed={mode === 'interlinear'} onClick={() => setReadingMode('interlinear')}>
        <Icon name="inter" />
        Interlinear
      </button>
    </div>
  );
}

const THEME_NAME = { light: 'Light', dark: 'Dark', system: 'System' } as const;
const NEXT_THEME = { light: 'dark', dark: 'system', system: 'light' } as const;

export function ThemeToggle() {
  const t = theme.value;
  const label =
    t === 'system'
      ? `Theme: System (${effectiveTheme('system') === 'dark' ? 'dark' : 'light'} now). Switch to ${THEME_NAME[NEXT_THEME[t]]}`
      : `Theme: ${THEME_NAME[t]}. Switch to ${THEME_NAME[NEXT_THEME[t]]}`;
  return (
    <button type="button" class="btn btn--icon theme-btn" onClick={cycleTheme} aria-label={label} title={label} data-theme-mode={t}>
      <Icon name={t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'system'} />
    </button>
  );
}

function SearchField() {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = searchOpen.value;

  // While open, a press or keyboard focus outside the field and the panel closes the search.
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest('.search, #search-panel, [data-search-keep]'));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) closeSearch();
    };
    const onFocus = (e: FocusEvent) => {
      if (!inside(e.target)) closeSearch();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (searchKeys.handler?.(e)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
      inputRef.current?.blur();
    } else if (e.key === 'Enter') {
      const m = meta.value;
      const ref = parseReference(searchQuery.value, {
        verseCount: (book, ch) => m?.books.find((b) => b.id === book)?.verses[ch - 1],
      });
      if (ref) {
        e.preventDefault();
        closeSearch();
        searchQuery.value = '';
        inputRef.current?.blur();
        navigate(ref);
      }
    }
  };

  return (
    <div class={`search${open ? ' is-open' : ''}`} data-keep-word>
      <button
        type="button"
        class="btn btn--icon search__btn-mobile"
        aria-label="Search"
        onClick={() => {
          openSearch();
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <Icon name="search" />
      </button>
      <label class="search__field">
        <Icon name="search" />
        <span class="sr-only">Search the Bible</span>
        <input
          ref={inputRef}
          id={SEARCH_INPUT_ID}
          class="search__input"
          type="search"
          autoComplete="off"
          spellcheck={false}
          enterKeyHint="search"
          placeholder="Search words, λόγος, G3056 or Jn 3:16"
          aria-controls={open ? 'search-panel' : undefined}
          value={searchQuery.value}
          onFocus={() => openSearch()}
          onInput={(e) => {
            searchQuery.value = (e.target as HTMLInputElement).value;
            if (!searchOpen.value) openSearch();
          }}
          onKeyDown={onKeyDown}
        />
        <span class="kbd search__kbd" aria-hidden="true">
          /
        </span>
        <button
          type="button"
          class="btn btn--icon search__close"
          aria-label="Close search"
          onClick={() => {
            closeSearch();
            inputRef.current?.blur();
          }}
        >
          <Icon name="close" />
        </button>
      </label>
    </div>
  );
}

export function Header() {
  const { tr, ref } = passage.value;
  const book = getBook(ref.book);
  const trMeta = translations.value.find((t) => t.id === tr);
  const prev = prevChapter(ref.book, ref.chapter);
  const next = nextChapter(ref.book, ref.chapter);
  const pop = panel.value;
  const bookBtn = useRef<HTMLButtonElement>(null);
  const trBtn = useRef<HTMLButtonElement>(null);
  const r = route.value.name;
  const reading = r === 'read' || r === 'search';
  const chapterLabel = formatChapter(ref.book, ref.chapter);

  return (
    <header class="masthead" id="masthead">
      <div class="masthead__inner">
        <a
          class="brand"
          href={refToHash(tr, { book: ref.book, chapter: ref.chapter })}
          title="Rootword — back to reading"
          aria-label="Rootword — back to reading"
        >
          <BrandMark />
          <span class="brand__word" aria-hidden="true">
            Rootword
          </span>
        </a>
        <span class="hdr-sep" aria-hidden="true" />

        <nav class="locator" aria-label="Passage">
          <button
            type="button"
            class="btn btn--icon locator__step"
            disabled={!prev}
            aria-label={prev ? `Previous chapter: ${formatChapter(prev[0], prev[1])}` : 'Previous chapter'}
            title={prev ? formatChapter(prev[0], prev[1]) : undefined}
            onClick={() => prev && navigate({ book: prev[0], chapter: prev[1] })}
          >
            <Icon name="left" />
          </button>
          <button
            ref={bookBtn}
            type="button"
            class="btn locator__ref"
            aria-haspopup="dialog"
            aria-expanded={pop === 'books'}
            aria-label={`${chapterLabel} — choose a passage`}
            onClick={(e) => togglePanel('books', e.currentTarget as HTMLElement)}
          >
            <span class="ref-book ref-book--long">{book?.id === 'PSA' ? 'Psalm' : book?.name}</span>
            <span class="ref-book ref-book--short">{book?.id === 'PSA' ? 'Ps' : book?.short}</span>
            {book && book.chapters > 1 && <span class="ref-ch"> {ref.chapter}</span>}
            <Icon name="chev" class="chev" />
          </button>
          <button
            type="button"
            class="btn btn--icon locator__step"
            disabled={!next}
            aria-label={next ? `Next chapter: ${formatChapter(next[0], next[1])}` : 'Next chapter'}
            title={next ? formatChapter(next[0], next[1]) : undefined}
            onClick={() => next && navigate({ book: next[0], chapter: next[1] })}
          >
            <Icon name="right" />
          </button>
        </nav>

        <button
          ref={trBtn}
          type="button"
          class="btn tr-btn"
          aria-haspopup="dialog"
          aria-expanded={pop === 'translations'}
          aria-label={`${trMeta?.abbr ?? tr}${trMeta ? ` ${shortName(trMeta.name)}` : ''} — choose a translation`}
          onClick={(e) => togglePanel('translations', e.currentTarget as HTMLElement)}
        >
          <span class="tr-btn__abbr">{trMeta?.abbr ?? tr}</span>{' '}
          {trMeta && <span class="tr-btn__name">{shortName(trMeta.name)}</span>}
          <Icon name="chev" class="chev" />
        </button>

        {/* Phones: the compact title "John 1 · KJV" (the toolbar has the other controls). */}
        <div class="hdr-title" role="group" aria-label="Passage and translation">
          <button
            type="button"
            class="hdr-title__ref"
            aria-haspopup="dialog"
            aria-expanded={pop === 'books'}
            aria-label={`${chapterLabel} — choose a passage`}
            onClick={(e) => togglePanel('books', e.currentTarget as HTMLElement)}
          >
            {chapterLabel}
          </button>
          <span class="hdr-title__dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            class="hdr-title__tr"
            aria-haspopup="dialog"
            aria-expanded={pop === 'translations'}
            aria-label={`${trMeta?.abbr ?? tr} — choose a translation`}
            onClick={(e) => togglePanel('translations', e.currentTarget as HTMLElement)}
          >
            {trMeta?.abbr ?? tr}
          </button>
        </div>

        <span class="hdr-spacer" />
        <SearchField />
        {reading && <ModeToggle class="mode-hdr" />}
        <button
          type="button"
          class="btn btn--icon aa-btn"
          aria-haspopup="dialog"
          aria-expanded={pop === 'display'}
          aria-label="Aa: display settings and more"
          title="Display settings, My study, Settings"
          onClick={(e) => togglePanel('display', e.currentTarget as HTMLElement)}
        >
          <UiIcon name="aa" />
        </button>
        <ThemeToggle />
      </div>
      <BookPicker open={pop === 'books'} onClose={closePanel} anchor={pop === 'books' && panelAnchor.current ? panelAnchor : bookBtn} />
      <TranslationPicker open={pop === 'translations'} onClose={closePanel} anchor={pop === 'translations' && panelAnchor.current ? panelAnchor : trBtn} />
      <DisplayPanel />
    </header>
  );
}
