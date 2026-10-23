/**
 * "Where it occurs": occurrences per book as a compact column chart grouped by section of the canon
 * (Law · History · Wisdom · Prophets | Gospels · Acts · Paul · General letters · Revelation), with a
 * table alternative. Choosing a book filters the occurrence list.
 *
 * Input models (docs/EXPERIENCE.md): mouse hover shows the book in the read-out above the chart and a
 * click chooses it; keyboard: one Tab stop, ←/→ Home/End move between books, Enter/Space choose;
 * touch: tap a column, or press and slide across the chart (the read-out follows the finger, a
 * light tick per book) and lift to choose. The table lists every book as a button too.
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { feedback } from '../../lib/feedback';
import type { WordStudy } from '../../lib/types';
import { bookDistribution, topBooks } from '../../lib/wordstudy';
import type { BookCount } from '../../lib/wordstudy';
import { distributionSummary, fmt, pct, plural } from './model';

const SHORT: Record<string, string> = {
  law: 'Law',
  history: 'History',
  wisdom: 'Wisdom',
  prophets: 'Prophets',
  gospels: 'Gospels',
  acts: 'Acts',
  paul: 'Paul',
  general: 'General',
  revelation: 'Rev',
};

export interface DistributionProps {
  study: WordStudy;
  /** Verses per book number (from the concordance), for labels. */
  verses: ReadonlyMap<number, number>;
  /** Chosen book number, 0 = all. */
  value: number;
  onChange: (bookNum: number) => void;
  /** Jump to the occurrence list. */
  onShowVerses: () => void;
  /** The word as written, for captions. */
  word: ComponentChildren;
}

export function Distribution({ study, verses, value, onChange, onShowVerses, word }: DistributionProps) {
  const sections = useMemo(() => bookDistribution(study), [study]);
  const books = useMemo(() => sections.flatMap((s) => s.books), [sections]);
  const active = useMemo(() => books.filter((b) => b.count > 0), [books]);
  const max = Math.max(1, ...books.map((b) => b.count));
  const peaks = useMemo(() => topBooks(study, 3).map((b) => b.num), [study]);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [focusNum, setFocusNum] = useState<number>(() => value || active[0]?.num || 0);
  const chartRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; moved: boolean; scrub: boolean; num: number | null } | null>(null);
  const suppressClick = useRef(0);

  const byNum = (n: number | null) => (n ? books.find((b) => b.num === n) : undefined);
  const shown = byNum(hover) ?? byNum(value) ?? byNum(topBooks(study, 1)[0]?.num ?? null);
  const chosen = byNum(value);
  const tableId = `ws-dist-table-${study.id}`;

  const choose = (num: number, toggle: boolean) => {
    const next = toggle && num === value ? 0 : num;
    onChange(next);
    setFocusNum(num);
    feedback('select');
  };

  /* ---- keyboard: roving focus over books with occurrences ---- */
  const onKeyDown = (e: KeyboardEvent) => {
    const i = active.findIndex((b) => b.num === focusNum);
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = Math.min(active.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = Math.max(0, i - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = active.length - 1;
    if (to < 0) return;
    e.preventDefault();
    const num = active[to].num;
    setFocusNum(num);
    setHover(num);
    chartRef.current?.querySelector<HTMLButtonElement>(`[data-book="${num}"]`)?.focus();
  };

  /* ---- touch: tap or press-and-slide ---- */
  const nearest = (x: number): number | null => {
    const cols = chartRef.current?.querySelectorAll<HTMLElement>('[data-book]');
    if (!cols?.length) return null;
    let best: number | null = null;
    let dist = Infinity;
    cols.forEach((c) => {
      const r = c.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - x);
      if (d < dist) {
        dist = d;
        best = Number(c.dataset.book);
      }
    });
    return best;
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const num = nearest(e.clientX);
    touch.current = { x: e.clientX, y: e.clientY, moved: false, scrub: false, num };
    setHover(num);
  };
  const onPointerMove = (e: PointerEvent) => {
    const t = touch.current;
    if (!t || e.pointerType !== 'touch') return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (!t.scrub && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      // a vertical scroll: let the page have it
      touch.current = null;
      setHover(null);
      return;
    }
    if (!t.scrub && Math.abs(dx) > 8) {
      t.scrub = true;
      feedback('engage');
    }
    if (t.scrub) {
      const num = nearest(e.clientX);
      if (num !== t.num) {
        t.num = num;
        setHover(num);
        feedback('tick');
      }
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    const t = touch.current;
    if (!t || e.pointerType !== 'touch') return;
    touch.current = null;
    suppressClick.current = Date.now();
    setHover(null);
    if (t.num) choose(t.num, !t.scrub);
  };
  const onPointerCancel = () => {
    touch.current = null;
    setHover(null);
  };
  const onClickCapture = (e: MouseEvent) => {
    // the touch handlers already chose a book; swallow the synthetic click that follows
    if (Date.now() - suppressClick.current < 600) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const summary = distributionSummary(study);
  return (
    <div class="ws-dist">
      {summary && <p class="ws-lead">{summary}</p>}
      <div class="ws-readout" aria-hidden="true">
        {shown ? (
          <>
            <span class="ws-readout__book">{shown.name}</span>
            <span class="ws-readout__n tnum">
              {plural(shown.count, 'occurrence')} · {pct(shown.count, study.total)}
              {verses.get(shown.num) ? ` · ${plural(verses.get(shown.num)!, 'verse')}` : ''}
            </span>
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
      <div
        class={`ws-chart${value ? ' has-choice' : ''}`}
        ref={chartRef}
        role="toolbar"
        aria-label="Occurrences by book. Choose a book to list its verses"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={(e) => (e as PointerEvent).pointerType !== 'touch' && setHover(null)}
        onClickCapture={onClickCapture}
      >
        {sections.map((s) => (
          <div class="ws-chart__sec" key={s.id} style={{ '--n': s.books.length }}>
            <div class="ws-chart__cols">
              {s.books.map((b) => (
                <Column
                  key={b.num}
                  b={b}
                  max={max}
                  peak={peaks.indexOf(b.num)}
                  edge={b.num === books[0]?.num ? 'first' : b.num === books[books.length - 1]?.num ? 'last' : undefined}
                  pressed={value === b.num}
                  hot={hover === b.num}
                  tabIndex={b.num === (active.some((a) => a.num === focusNum) ? focusNum : active[0]?.num) ? 0 : -1}
                  verses={verses.get(b.num) ?? 0}
                  onChoose={() => choose(b.num, true)}
                  onHover={(on) => setHover(on ? b.num : null)}
                  onFocus={() => {
                    setFocusNum(b.num);
                    setHover(b.num);
                  }}
                />
              ))}
            </div>
            <div class="ws-chart__lbl">
              <span class="ws-chart__name">
                <span class="ws-chart__long">{s.name}</span>
                <span class="ws-chart__short">{SHORT[s.id] ?? s.name}</span>
              </span>
              <span class="ws-chart__total tnum">{fmt(s.total)}</span>
            </div>
          </div>
        ))}
      </div>
      <div class="ws-dist__foot">
        {chosen ? (
          <p class="ws-choice">
            <span>
              Listing the {plural(verses.get(chosen.num) ?? chosen.count, 'verse')} in <b>{chosen.name}</b>.
            </span>
            <button type="button" class="link-btn" onClick={onShowVerses}>
              Go to the verses
            </button>
            <button type="button" class="link-btn" onClick={() => onChange(0)}>
              Show every book
            </button>
          </p>
        ) : (
          <p class="ws-hint">
            <span class="ws-hint--fine">Choose a book to list its verses.</span>
            <span class="ws-hint--touch">Tap a book, or press and slide across the chart.</span>
          </p>
        )}
        <button type="button" class="btn-quiet ws-table-btn" aria-expanded={table} aria-controls={tableId} onClick={() => setTable(!table)}>
          {table ? 'Hide table' : 'Table view'}
        </button>
      </div>
      <div id={tableId} hidden={!table}>
        {table && <DistTable study={study} sections={sections} verses={verses} value={value} onChoose={(n) => choose(n, true)} word={word} />}
      </div>
    </div>
  );
}

function Column({
  b,
  max,
  peak,
  edge,
  pressed,
  hot,
  tabIndex,
  verses,
  onChoose,
  onHover,
  onFocus,
}: {
  b: BookCount;
  max: number;
  /** Rank among the labelled peaks (0 = most frequent), -1 = none. */
  peak: number;
  edge?: 'first' | 'last';
  pressed: boolean;
  hot: boolean;
  tabIndex: number;
  verses: number;
  onChoose: () => void;
  onHover: (on: boolean) => void;
  onFocus: () => void;
}) {
  const h = b.count ? Math.max(3, (b.count / max) * 100) : 0;
  if (!b.count) {
    return (
      <span class="ws-col is-zero" aria-hidden="true" title={`${b.name}: none`}>
        <span class="ws-col__bar" />
      </span>
    );
  }
  return (
    <span class={`ws-colw${edge ? ` is-${edge}` : ''}${peak === 0 ? ' is-top' : ''}`} style={{ '--h': `${h}%` }}>
      <button
        type="button"
        class={`ws-col${hot ? ' is-hot' : ''}`}
        data-book={b.num}
        aria-pressed={pressed}
        aria-label={`${b.name}: ${plural(b.count, 'occurrence')}${verses ? ` in ${plural(verses, 'verse')}` : ''}`}
        tabIndex={tabIndex}
        onClick={onChoose}
        onPointerEnter={(e) => (e as PointerEvent).pointerType !== 'touch' && onHover(true)}
        onFocus={onFocus}
        onBlur={() => onHover(false)}
      >
        <span class="ws-col__bar" style={{ height: `${h}%` }} />
      </button>
      {/* outside the button, so its visible text never competes with the button's name */}
      {peak >= 0 && (
        <span class="ws-col__peak tnum" aria-hidden="true">
          <span class="ws-col__peak-b">{b.short}</span> {fmt(b.count)}
        </span>
      )}
    </span>
  );
}

function DistTable({
  study,
  sections,
  verses,
  value,
  onChoose,
  word,
}: {
  study: WordStudy;
  sections: ReturnType<typeof bookDistribution>;
  verses: ReadonlyMap<number, number>;
  value: number;
  onChoose: (num: number) => void;
  word: ComponentChildren;
}) {
  return (
    <table class="ws-table ws-dist-table">
      <caption>
        Occurrences of {word} by book. Choose a book to list its verses.
      </caption>
      <thead>
        <tr>
          <th scope="col">Book</th>
          <th scope="col" class="num">
            Occurrences
          </th>
          <th scope="col" class="num">
            Verses
          </th>
          <th scope="col" class="num">
            Share
          </th>
        </tr>
      </thead>
      {sections
        .filter((s) => s.total > 0)
        .map((s) => (
          <tbody key={s.id}>
            <tr class="ws-table__group">
              <th scope="rowgroup" colSpan={4}>
                {s.name} <span class="tnum">· {fmt(s.total)} · {pct(s.total, study.total)}</span>
              </th>
            </tr>
            {s.books
              .filter((b) => b.count > 0)
              .map((b) => (
                <tr key={b.num}>
                  <th scope="row">
                    <button type="button" class="ws-table__book" aria-pressed={value === b.num} onClick={() => onChoose(b.num)}>
                      {b.name}
                    </button>
                  </th>
                  <td class="num tnum">{fmt(b.count)}</td>
                  <td class="num tnum">{fmt(verses.get(b.num) ?? 0)}</td>
                  <td class="num tnum">{pct(b.count, study.total)}</td>
                </tr>
              ))}
          </tbody>
        ))}
    </table>
  );
}
