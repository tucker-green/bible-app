/**
 * Book + chapter picker: a "Go to" reference field, OT and NT book grids and the chapter grid of the
 * chosen book. Popover on desktop, bottom sheet on phones (books first, then chapters).
 */
import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { meta, navigate, passage } from '../../app/state';
import { BOOKS, getBook } from '../../lib/books';
import type { BookInfo } from '../../lib/books';
import { parseReference } from '../../lib/reference';
import { Icon } from '../common/Icon';
import { Popover } from '../common/Popover';
import { useMedia } from '../common/hooks';

const OT = BOOKS.filter((b) => b.testament === 'OT');
const NT = BOOKS.filter((b) => b.testament === 'NT');

/** Arrow-key movement inside a grid of buttons with `cols` columns. */
function gridKeys(e: KeyboardEvent, cols: number): void {
  const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
  const d = keys[e.key];
  if (!d) return;
  const grid = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button');
  const list = [...grid];
  const i = list.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  const next = list[Math.min(Math.max(i + d, 0), list.length - 1)];
  e.preventDefault();
  next?.focus();
}

export function BookPicker({ open, onClose, anchor }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement> }) {
  const cur = passage.value.ref;
  const [sel, setSel] = useState<BookInfo>(getBook(cur.book) ?? BOOKS[42]);
  const [step, setStep] = useState<'books' | 'chapters'>('books');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const phone = useMedia('(max-width: 640px)');

  useEffect(() => {
    if (open) {
      setSel(getBook(passage.value.ref.book) ?? BOOKS[42]);
      setStep('books');
      setQ('');
      setErr('');
    }
  }, [open]);

  const go = (book: string, chapter: number) => {
    onClose();
    navigate({ book, chapter });
  };

  const pickBook = (b: BookInfo) => {
    if (b.chapters === 1) return go(b.id, 1);
    setSel(b);
    if (phone) setStep('chapters');
  };

  const submit = (e: Event) => {
    e.preventDefault();
    const m = meta.value;
    const ref = parseReference(q, {
      verseCount: (book, ch) => m?.books.find((b) => b.id === book)?.verses[ch - 1],
    });
    if (!ref) {
      setErr(q.trim() ? `“${q.trim()}” isn’t a passage Rootword knows.` : 'Type a reference, e.g. Jn 3:16.');
      return;
    }
    onClose();
    navigate(ref);
  };

  const bookGrid = (books: BookInfo[], title: string) => (
    <section class="books__col">
      <p class="eyebrow books__eyebrow">
        <span>{title}</span>
        <span class="tnum">{books.length}</span>
      </p>
      <div class="books__grid" onKeyDown={(e) => gridKeys(e, 4)}>
        {books.map((b) => (
          <button
            key={b.id}
            type="button"
            title={b.name}
            aria-label={b.name}
            aria-current={b.id === cur.book ? 'true' : undefined}
            aria-pressed={b.id === sel.id}
            class={b.id === sel.id ? 'is-sel' : ''}
            onClick={() => pickBook(b)}
          >
            {b.short}
          </button>
        ))}
      </div>
    </section>
  );

  const chapterCol = (
    <section class="books__col books__col--ch" aria-live="polite">
      {phone && (
        <button type="button" class="btn books__back" onClick={() => setStep('books')}>
          <Icon name="left" /> Books
        </button>
      )}
      <h3 class="books__title">{sel.name}</h3>
      <p class="books__sub">{sel.chapters === 1 ? '1 chapter' : `${sel.chapters} chapters`}</p>
      <div class="chapters" onKeyDown={(e) => gridKeys(e, phone ? 6 : 5)}>
        {Array.from({ length: sel.chapters }, (_, i) => i + 1).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${sel.name} ${c}`}
            aria-current={sel.id === cur.book && c === cur.chapter ? 'true' : undefined}
            onClick={() => go(sel.id, c)}
          >
            {c}
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} label="Choose a passage" class="books" initialFocus=".books__goto input">
      <form class="books__goto" onSubmit={submit} role="search">
        <label for="goto-input" class="eyebrow">
          Go to
        </label>
        <div class="books__goto-row">
          <input
            id="goto-input"
            type="text"
            autoComplete="off"
            spellcheck={false}
            placeholder="Jn 3:16, Ps 23, 1 Cor 13…"
            value={q}
            aria-invalid={err ? 'true' : undefined}
            aria-describedby={err ? 'goto-err' : undefined}
            onInput={(e) => {
              setQ((e.target as HTMLInputElement).value);
              setErr('');
            }}
          />
          <button class="btn-primary" type="submit">
            Go
          </button>
        </div>
        {err && (
          <p id="goto-err" class="books__err" role="alert">
            {err}
          </p>
        )}
      </form>
      {phone && step === 'chapters' ? (
        chapterCol
      ) : (
        <div class="books__cols">
          {bookGrid(OT, 'Old Testament')}
          {bookGrid(NT, 'New Testament')}
          {!phone && chapterCol}
        </div>
      )}
    </Popover>
  );
}
