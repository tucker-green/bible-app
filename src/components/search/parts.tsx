/**
 * Presentational pieces of the search panel: script-aware text, the lexicon header card for
 * Strong's / lemma queries, the testament switch, the per-book bar list (wide) / chip row
 * (narrow), the query-syntax hints and a few glyphs.
 */
import { Fragment } from 'preact';
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { closeSearch } from '../../app/state';
import { preloadPage } from '../../app/pages';
import { strongsLang } from '../../lib/data';
import { feedback } from '../../lib/feedback';
import type { LexEntry } from '../../lib/types';
import { SpeakButton } from '../word/SpeakButton';
import type { BookCount, QueryHint, TestamentCounts } from './model';
import { scriptRuns } from './model';

const fmt = (n: number) => n.toLocaleString('en-US');

/** "G0026" -> "G26", "H0871a" -> "H871a". */
export function displayStrongs(id: string): string {
  return id.replace(/^([GH])0+(?=\d)/, '$1');
}

/** Text with Greek / Hebrew runs wrapped in spans carrying lang (and dir for Hebrew). */
export function LangText({ text }: { text: string }) {
  const runs = scriptRuns(text);
  if (runs.length === 1 && !runs[0].lang) return <>{text}</>;
  return (
    <>
      {runs.map((r, i) =>
        r.lang ? (
          <span key={i} lang={r.lang} dir={r.lang === 'he' ? 'rtl' : undefined} class={`sp-${r.lang}`}>
            {r.text}
          </span>
        ) : (
          r.text
        ),
      )}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Glyphs                                                                    */
/* ------------------------------------------------------------------------ */

const GLYPHS = {
  person: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 19.5c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" />
    </>
  ),
  place: (
    <>
      <path d="M12 20.5s-6.2-5.6-6.2-10.6a6.2 6.2 0 0 1 12.4 0c0 5-6.2 10.6-6.2 10.6z" />
      <circle cx="12" cy="9.9" r="2.3" />
    </>
  ),
  group: (
    <>
      <circle cx="9" cy="8.6" r="3" />
      <circle cx="16.4" cy="9.6" r="2.4" />
      <path d="M3.6 19c.7-3 2.8-4.7 5.4-4.7s4.7 1.7 5.4 4.7M14.6 14.6c2.6-.4 4.9.9 5.8 3.9" />
    </>
  ),
  goto: <path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" />,
  book: <path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h9.5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.6v5.4M12 16.2v.2" />
    </>
  ),
  history: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.8v3.6h3.6" />
      <path d="M12 8.3V12l2.6 1.6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="M15.6 15.6 20 20" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, class: cls = '' }: { name: GlyphName; class?: string }) {
  return (
    <svg class={`icon ${cls}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {GLYPHS[name]}
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* Lexicon card (Strong's / lemma queries)                                   */
/* ------------------------------------------------------------------------ */

export function LexCard({ entry, tr, compact = false }: { entry: LexEntry; tr: string; compact?: boolean }) {
  const lang = strongsLang(entry.id);
  const htmlLang = lang === 'grc' ? 'grc' : 'he';
  const rend = entry.renderings?.[tr] ?? entry.renderings?.KJV ?? entry.renderings?.BSB;
  const rendTr = entry.renderings?.[tr] ? tr : entry.renderings?.KJV ? 'KJV' : 'BSB';
  const label = displayStrongs(entry.id);
  const headId = `sp-lex-${entry.id}`;
  return (
    <section class={`sp-lex${compact ? ' is-compact' : ''}`} aria-labelledby={headId}>
      <div class="sp-lex__head">
        <h3 class="sp-lex__lemma" id={headId}>
          <span lang={htmlLang} dir={lang === 'hbo' ? 'rtl' : undefined} class={`sp-lex__word sp-${htmlLang}`}>
            {entry.lemma}
          </span>
          <span class="sr-only">, Strong’s {label}</span>
        </h3>
        <SpeakButton text={entry.lemma} lang={lang} translit={entry.translit} />
        <span class="sp-lex__id" aria-hidden="true">
          {label}
        </span>
      </div>
      <p class="sp-lex__meta">
        {entry.translit && <i class="sp-lex__translit">{entry.translit}</i>}
        {entry.translit && entry.pos && <span aria-hidden="true"> · </span>}
        {entry.pos && <span>{entry.pos}</span>}
      </p>
      {entry.gloss && <p class="sp-lex__gloss">“{entry.gloss}”</p>}
      {!compact && (
        <dl class="sp-lex__facts">
          {typeof entry.verses === 'number' && (
            <div>
              <dt>Verses</dt>
              <dd class="tnum">{fmt(entry.verses)}</dd>
            </div>
          )}
          {rend && rend.length > 0 && (
            <div class="sp-lex__rend">
              <dt>{rendTr} renders it</dt>
              <dd>
                {rend.slice(0, 6).map(([w, n], i) => (
                  <Fragment key={w}>
                    {i > 0 && <span aria-hidden="true"> · </span>}
                    <span class="sp-lex__r">
                      {w} <span class="tnum sp-lex__n">{fmt(n)}</span>
                    </span>
                  </Fragment>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
      <a
        class="sp-lex__study"
        href={`#/word/${entry.id}`}
        onPointerEnter={() => preloadPage('word')}
        onFocus={() => preloadPage('word')}
        onClick={() => {
          feedback('select');
          closeSearch();
        }}
      >
        Open word study <Glyph name="goto" />
      </a>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Facets                                                                    */
/* ------------------------------------------------------------------------ */

export function TestamentSwitch({
  counts,
  value,
  onChange,
}: {
  counts: TestamentCounts;
  value: 'OT' | 'NT' | undefined;
  onChange: (t: 'OT' | 'NT' | undefined) => void;
}) {
  const items: [('OT' | 'NT' | undefined), string, string, number][] = [
    [undefined, 'All', 'Whole Bible', counts.all],
    ['OT', 'OT', 'Old Testament', counts.OT],
    ['NT', 'NT', 'New Testament', counts.NT],
  ];
  return (
    <div class="sp-seg" role="group" aria-label="Testament">
      {items.map(([t, short, long, n]) => (
        <button
          key={short}
          type="button"
          aria-pressed={value === t}
          disabled={t !== undefined && n === 0 && value !== t}
          title={`${long}: ${fmt(n)} ${n === 1 ? 'verse' : 'verses'}`}
          onClick={() => onChange(t)}
        >
          {short} <span class="tnum sp-seg__n">{fmt(n)}</span>
        </button>
      ))}
    </div>
  );
}

/** Roving tabindex over a list of buttons (one Tab stop; arrows / Home / End move). */
function useRoving(count: number, orientation: 'vertical' | 'horizontal') {
  const [at, setAt] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const cur = Math.min(at, Math.max(0, count - 1));
  const onKeyDown = (e: KeyboardEvent) => {
    const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    let to = -1;
    if (e.key === next) to = Math.min(count - 1, cur + 1);
    else if (e.key === prev) to = Math.max(0, cur - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = count - 1;
    if (to < 0) return;
    e.preventDefault();
    setAt(to);
    ref.current?.querySelectorAll<HTMLButtonElement>('button')[to]?.focus();
  };
  const tabIndex = (i: number) => (i === cur ? 0 : -1);
  const onFocusItem = (i: number) => setAt(i);
  return { ref, onKeyDown, tabIndex, onFocusItem };
}

export function BookBars({
  books,
  value,
  onChange,
  labelledBy,
}: {
  books: BookCount[];
  value: number | undefined;
  onChange: (book: number | undefined) => void;
  labelledBy: string;
}) {
  const max = Math.max(1, ...books.map((b) => b.count));
  const r = useRoving(books.length, 'vertical');
  let lastTestament = '';
  return (
    <div class="sp-bars" role="toolbar" aria-orientation="vertical" aria-labelledby={labelledBy} ref={r.ref} onKeyDown={r.onKeyDown}>
      {books.map(({ book, count }, i) => {
        const divider = lastTestament && lastTestament !== book.testament;
        lastTestament = book.testament;
        return (
          <button
            key={book.id}
            type="button"
            class={`sp-bar${divider ? ' is-first-nt' : ''}`}
            aria-pressed={value === book.num}
            tabIndex={r.tabIndex(i)}
            onFocus={() => r.onFocusItem(i)}
            onClick={() => onChange(value === book.num ? undefined : book.num)}
            title={`${book.name}: ${fmt(count)} ${count === 1 ? 'verse' : 'verses'}`}
          >
            <span class="sp-bar__name">{book.name}</span>
            <span class="sp-bar__track" aria-hidden="true">
              <span class="sp-bar__fill" style={{ width: `${Math.max(3, (count / max) * 100)}%` }} />
            </span>
            <span class="sp-bar__n tnum">{fmt(count)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function BookChips({
  books,
  value,
  onChange,
}: {
  books: BookCount[];
  value: number | undefined;
  onChange: (book: number | undefined) => void;
}) {
  const r = useRoving(books.length, 'horizontal');
  return (
    <div class="sp-chips" role="toolbar" aria-label="Filter by book" ref={r.ref} onKeyDown={r.onKeyDown}>
      {books.map(({ book, count }, i) => (
        <button
          key={book.id}
          type="button"
          class="sp-chip"
          aria-pressed={value === book.num}
          tabIndex={r.tabIndex(i)}
          onFocus={() => r.onFocusItem(i)}
          onClick={() => onChange(value === book.num ? undefined : book.num)}
          title={`${book.name}: ${fmt(count)} ${count === 1 ? 'verse' : 'verses'}`}
        >
          <span class="sp-chip__name">{book.short}</span> <span class="tnum sp-chip__n">{fmt(count)}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Hints                                                                     */
/* ------------------------------------------------------------------------ */

export function QueryChip({ q, lang, onPick, class: cls = '' }: { q: string; lang?: 'grc' | 'he'; onPick: (q: string) => void; class?: string }) {
  return (
    <button type="button" class={`sp-q ${cls}`.trim()} onClick={() => onPick(q)}>
      <span lang={lang}>{q}</span>
    </button>
  );
}

export function HintList({ hints, onPick, compact = false }: { hints: readonly QueryHint[]; onPick: (q: string) => void; compact?: boolean }) {
  return (
    <ul class={`sp-hints${compact ? ' is-compact' : ''}`}>
      {hints.map((h) => (
        <li key={h.q}>
          <QueryChip q={h.q} lang={h.lang} onPick={onPick} />
          <span class="sp-hints__what">
            {h.label}
            {h.note && !compact && (
              <span class="sp-hints__note">
                <LangText text={h.note} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'alert'; children: JSX.Element | JSX.Element[] | string | (JSX.Element | string)[] }) {
  return (
    <p class={`sp-note sp-note--${kind}`}>
      <Glyph name={kind === 'alert' ? 'alert' : 'book'} />
      <span>{children}</span>
    </p>
  );
}
