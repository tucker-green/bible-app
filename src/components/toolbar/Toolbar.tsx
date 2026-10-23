/**
 * Phone bottom toolbar (docs/EXPERIENCE.md §1): Books · Translation · Search · Reading/Interlinear ·
 * Aa, within thumb reach, safe-area aware, every item ≥ 44×44 px with a visible label. Shown only on
 * compact layouts (CSS: < 600px wide); on larger screens the header carries the same controls.
 * On pages other than the reader the mode toggle becomes "Read" (back to the chapter).
 */
import {
  openSearch,
  panel,
  passage,
  readingMode,
  route,
  SEARCH_INPUT_ID,
  searchOpen,
  setReadingMode,
  togglePanel,
  translations,
} from '../../app/state';
import { getBook } from '../../lib/books';
import { refToHash } from '../../lib/reference';
import { UiIcon } from '../shell/icons';
import './toolbar.css';

export function Toolbar() {
  const p = panel.value;
  const { tr, ref } = passage.value;
  const book = getBook(ref.book);
  const trMeta = translations.value.find((t) => t.id === tr);
  const reading = route.value.name === 'read' || route.value.name === 'search';
  const il = readingMode.value === 'interlinear';
  const bookLabel = book ? (book.id === 'PSA' ? `Ps ${ref.chapter}` : `${book.short}${book.chapters > 1 ? ` ${ref.chapter}` : ''}`) : 'Books';

  return (
    <nav class="toolbar" aria-label="Reader tools">
      <button
        type="button"
        class="tb-btn"
        aria-haspopup="dialog"
        aria-expanded={p === 'books'}
        aria-label={`Books — ${bookLabel}`}
        onClick={(e) => togglePanel('books', e.currentTarget as HTMLElement)}
      >
        <UiIcon name="books" />
        <span class="tb-lbl">{bookLabel}</span>
      </button>
      <button
        type="button"
        class="tb-btn"
        aria-haspopup="dialog"
        aria-expanded={p === 'translations'}
        aria-label={`Translation — ${trMeta?.abbr ?? tr}`}
        onClick={(e) => togglePanel('translations', e.currentTarget as HTMLElement)}
      >
        <UiIcon name="translation" />
        <span class="tb-lbl">{trMeta?.abbr ?? tr}</span>
      </button>
      <button
        type="button"
        class="tb-btn"
        aria-expanded={searchOpen.value}
        aria-controls={searchOpen.value ? 'search-panel' : undefined}
        onClick={() => {
          openSearch();
          requestAnimationFrame(() => (document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null)?.focus());
        }}
      >
        <UiIcon name="search" />
        <span class="tb-lbl">Search</span>
      </button>
      {reading ? (
        <button
          type="button"
          class="tb-btn"
          aria-pressed={il}
          onClick={() => setReadingMode(il ? 'reading' : 'interlinear')}
          title={il ? 'Interlinear on — switch to reading' : 'Show the original under each word'}
        >
          <UiIcon name={il ? 'interlinear' : 'reading'} />
          <span class="tb-lbl">Interlinear</span>
        </button>
      ) : (
        <a class="tb-btn" href={refToHash(tr, { book: ref.book, chapter: ref.chapter })}>
          <UiIcon name="reading" />
          <span class="tb-lbl">Read</span>
        </a>
      )}
      <button
        type="button"
        class="tb-btn"
        aria-haspopup="dialog"
        aria-expanded={p === 'display'}
        aria-label="Aa: display settings and more"
        onClick={(e) => togglePanel('display', e.currentTarget as HTMLElement)}
      >
        <UiIcon name="aa" />
        <span class="tb-lbl">Aa</span>
      </button>
    </nav>
  );
}
