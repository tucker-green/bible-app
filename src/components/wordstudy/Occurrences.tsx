/**
 * "Every occurrence": the concordance verses for the word, grouped by book and paged, each with the
 * verse in the translation being read and the English words that translate this word marked
 * (found through the token links: a token linked to an original word with this Strong's number, or a
 * KJV word tagged with it). Chapters load lazily as the list grows — the next page loads by itself
 * when the end of the list scrolls into view, or with "Show more".
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { announce, translations } from '../../app/state';
import { getBookByNum } from '../../lib/books';
import { loadOrig, loadText } from '../../lib/data';
import { formatReference, refToHash } from '../../lib/reference';
import type { OrigChapter, TextChapter } from '../../lib/types';
import { unpackRef } from '../../lib/types';
import { Typeset } from '../common/Typeset';
import { bookOptions, chaptersOf, groupRefsByBook, markTokens, plural, verseRuns } from './model';
import type { RefGroup } from './model';

export const OCC_PAGE = 25;

type ChapterData = { text: TextChapter; orig: OrigChapter | null } | 'error';

export interface OccurrencesProps {
  /** Concordance verses (packed refs), canonical order. */
  refs: number[];
  /** Does a Strong's id belong to the studied word? */
  match: (id: string) => boolean;
  /** Translation to preview the verses in. */
  tr: string;
  /** Book filter (book number, 0 = all). */
  book: number;
  onBook: (bookNum: number) => void;
  word: ComponentChildren;
  /** Note shown when `tr` is not the translation being read (e.g. NIV previews fall back to the KJV). */
  trNote?: string;
}

export function Occurrences({ refs, match, tr, book, onBook, word, trNote }: OccurrencesProps) {
  const groups = useMemo(() => groupRefsByBook(refs), [refs]);
  const options = useMemo(() => bookOptions(groups), [groups]);
  const list = book ? (groups.find((g) => g.bookNum === book)?.refs ?? []) : refs;
  const [shown, setShown] = useState(OCC_PAGE);
  const [data, setData] = useState<Map<string, ChapterData>>(() => new Map());
  const sentinel = useRef<HTMLDivElement>(null);
  const visible = list.slice(0, shown);
  const chapters = useMemo(() => chaptersOf(visible), [list, shown]);
  const keyOf = (b: string, c: number) => `${tr}/${b}/${c}`;
  const missing = chapters.filter((c) => !data.has(keyOf(c.book, c.chapter)));
  const busy = missing.length > 0;
  const trName = translations.value.find((t) => t.id === tr)?.name ?? tr;

  useEffect(() => setShown(OCC_PAGE), [book]);

  useEffect(() => {
    if (!missing.length) return;
    let off = false;
    Promise.all(
      missing.map(async ({ book: b, chapter: c }): Promise<[string, ChapterData]> => {
        try {
          const [text, orig] = await Promise.all([loadText(tr, b, c), loadOrig(b, c).catch(() => null)]);
          return [keyOf(b, c), { text, orig }];
        } catch {
          return [keyOf(b, c), 'error'];
        }
      }),
    ).then((entries) => {
      if (off) return;
      setData((prev) => {
        const next = new Map(prev);
        for (const [k, v] of entries) next.set(k, v);
        return next;
      });
    });
    return () => {
      off = true;
    };
  }, [tr, missing.map((c) => `${c.book}/${c.chapter}`).join(',')]);

  // Load the next page when the end of the list comes near (only once the current page has arrived).
  const canMore = shown < list.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canMore || busy || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => Math.min(list.length, n + OCC_PAGE));
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [canMore, busy, list.length, shown]);

  // book sections of the visible slice
  const sections: (RefGroup & { shownRefs: number[] })[] = [];
  for (const r of visible) {
    const { bookNum } = unpackRef(r);
    let s = sections[sections.length - 1];
    if (!s || s.bookNum !== bookNum) {
      const g = groups.find((x) => x.bookNum === bookNum);
      if (!g) continue;
      s = { ...g, shownRefs: [] };
      sections.push(s);
    }
    s.shownRefs.push(r);
  }

  const more = Math.min(OCC_PAGE, list.length - shown);
  const selectId = 'ws-occ-book';
  return (
    <div class="ws-occ">
      <div class="ws-occ__bar">
        <label class="ws-occ__filter" for={selectId}>
          <span>Book</span>
          <select
            id={selectId}
            value={String(book)}
            onChange={(e) => onBook(Number((e.currentTarget as HTMLSelectElement).value))}
          >
            <option value="0">All books ({plural(refs.length, 'verse')})</option>
            {options.map((o) => (
              <optgroup key={o.id} label={o.name}>
                {o.books.map((g) => (
                  <option key={g.bookNum} value={String(g.bookNum)}>
                    {g.name} ({g.refs.length.toLocaleString('en-US')})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p class="ws-occ__tr">
          {trName} · <mark class="ws-hit ws-hit--key">marked</mark> words translate {word}
          {trNote && <span class="ws-occ__note"> {trNote}</span>}
        </p>
      </div>
      <div class="ws-occ__body" aria-busy={busy ? 'true' : undefined}>
        {sections.map((s) => (
          <section class="ws-occ__sec" key={s.bookNum} aria-labelledby={`ws-occ-b${s.bookNum}`}>
            <h3 class="ws-occ__book" id={`ws-occ-b${s.bookNum}`}>
              <span>{s.name}</span>
              <span class="ws-occ__n">{plural(s.refs.length, 'verse')}</span>
            </h3>
            <ol class="ws-occ__list">
              {s.shownRefs.map((r) => (
                <OccRow key={r} packed={r} tr={tr} match={match} data={dataFor(data, tr, r)} />
              ))}
            </ol>
          </section>
        ))}
      </div>
      <div ref={sentinel} class="ws-occ__sentinel" aria-hidden="true" />
      {more > 0 ? (
        <p class="ws-occ__more">
          <button
            type="button"
            class="btn-quiet"
            disabled={busy}
            onClick={() => {
              const n = Math.min(list.length, shown + OCC_PAGE);
              setShown(n);
              announce(`Showing ${n} of ${plural(list.length, 'verse')}`);
            }}
          >
            {busy ? 'Loading…' : `Show ${more} more`}
          </button>
          <span class="ws-occ__count">
            {Math.min(shown, list.length).toLocaleString('en-US')} of {plural(list.length, 'verse')}
          </span>
        </p>
      ) : (
        list.length > OCC_PAGE && <p class="ws-occ__count ws-occ__end">All {plural(list.length, 'verse')} shown.</p>
      )}
    </div>
  );
}

function dataFor(data: Map<string, ChapterData>, tr: string, packed: number): ChapterData | undefined {
  const { bookNum, chapter } = unpackRef(packed);
  const b = getBookByNum(bookNum)?.id;
  return b ? data.get(`${tr}/${b}/${chapter}`) : undefined;
}

function OccRow({ packed, tr, match, data }: { packed: number; tr: string; match: (id: string) => boolean; data: ChapterData | undefined }) {
  const { bookNum, chapter, verse } = unpackRef(packed);
  const book = getBookByNum(bookNum)?.id ?? '';
  const ref = { book, chapter, verse };
  let body: ComponentChildren;
  if (!data) {
    body = (
      <>
        <span class="skeleton ws-occ__skel" />
        <span class="skeleton ws-occ__skel is-short" />
      </>
    );
  } else if (data === 'error') {
    body = <span class="ws-occ__na">Preview unavailable</span>;
  } else {
    const v = verse === 0 ? null : data.text.verses.find((x) => x.v === verse);
    const tokens = v?.t ?? (verse === 0 ? data.text.superscription : undefined);
    if (!tokens) body = <span class="ws-occ__na">Not in this translation’s numbering</span>;
    else {
      const runs = verseRuns(tokens, markTokens(tokens, data.orig, match));
      body = runs.map((r, i) =>
        r.hit ? (
          <mark key={i} class="ws-hit">
            <Typeset text={r.text} />
          </mark>
        ) : (
          <Typeset key={i} text={r.text} />
        ),
      );
    }
  }
  return (
    <li class="ws-ref">
      <a class="ws-ref__at" href={refToHash(tr, ref)}>
        {verse === 0 ? `${formatReference({ book, chapter }, 'short')} title` : formatReference(ref, 'short')}
      </a>
      <span class="ws-ref__text">{body}</span>
    </li>
  );
}
