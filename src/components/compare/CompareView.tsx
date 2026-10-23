/**
 * The compare grid (docs/EXPERIENCE.md §1–2): one row per verse with a cell per translation —
 * side-by-side columns when the container is wide enough, interleaved (each verse stacked
 * translation by translation with a run-in label) when it is not; compare.css decides with a
 * container query. Rendered once per model as an HTML string (model.ts → the reader's render.ts)
 * and wired to ONE CompareController (the reader's controller), so hover / tap / keyboard / press-
 * and-slide scrubbing behave exactly as in the reader, and the word card, verse sheet and scrub
 * loupe are the reader's own components.
 *
 * Cross-highlighting: the merged model links every column's words to the same original words, so
 * the controller's `is-linked` already marks the counterparts in the other columns; they also get
 * `is-twin` here (a stronger underline) so the eye finds them across the gutter.
 */
import { effect } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { activeWord, closeVerseSheet, closeWord, pinnedWord, settings, verseSheet } from '../../app/state';
import type { WordRef } from '../../app/state';
import { bookmarks, highlights, notes } from '../../app/study';
import { announceRendered } from '../../app/transitions';
import { decorateVerses } from '../reader/decorate';
import type { HeadingInfo } from '../reader/render';
import { attachSwipe } from '../reader/swipe';
import { VerseSheet } from '../verse/VerseSheet';
import { Loupe } from '../word/Loupe';
import { WordCard } from '../word/WordCard';
import { captureAnchor, CompareController, restoreAnchor } from './controller';
import type { Anchor } from './controller';
import type { CompareModel } from './model';
import { compareGridHtml, counterpartUnits } from './model';

/** Chapters with more verse rows than this use content-visibility on the rows. */
const LONG_ROWS = 60;

export interface CompareViewProps {
  cm: CompareModel;
  heads: Map<number, HeadingInfo[]>;
  /** Swipe left / right on the text (touch) changes chapter. */
  swipe?: { label: (dir: 'next' | 'prev') => string | null; go: (dir: 'next' | 'prev') => void };
}

export function CompareView({ cm, heads, swipe }: CompareViewProps) {
  const controller = useMemo(() => new CompareController(), []);
  controller.colKeys = cm.columns.map((c) => c.sheetModel.key);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cmRef = useRef(cm);
  cmRef.current = cm;
  const twins = useRef<HTMLElement[]>([]);
  const swipeRef = useRef(swipe);
  swipeRef.current = swipe;

  const applyMarks = () => {
    const el = rootRef.current;
    if (!el) return;
    decorateVerses(el, cm.book, cm.chapter, { highlights: highlights.peek(), notes: notes.peek(), bookmarks: bookmarks.peek() });
  };

  /** The counterparts of the open word in the other columns. */
  const markTwins = (ref: WordRef | null) => {
    for (const el of twins.current) el.classList.remove('is-twin');
    twins.current = [];
    const m = cmRef.current;
    if (!ref || ref.key !== m.key) return;
    for (const id of counterpartUnits(m, ref.unit)) {
      const el = controller.el(id);
      if (!el) continue;
      el.classList.add('is-twin');
      twins.current.push(el);
    }
  };

  // The grid HTML, built once per model (never on hover). It is part of the JSX (not set in an
  // effect) so a re-mounted page is inserted complete and keeps its scroll position; the same
  // string object on re-render means Preact leaves the DOM (and the word states) alone.
  const html = useMemo(() => compareGridHtml(cm, heads), [cm, heads]);
  const lastHtml = useRef('');
  const keep = useRef<Anchor | null>(null);
  if (html !== lastHtml.current) {
    // a re-render of the same page (a column arriving late, a retry, headings): keep the place
    const el = rootRef.current;
    keep.current = lastHtml.current && el?.firstElementChild ? captureAnchor(el) : null;
    lastHtml.current = html;
  }

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    controller.attach(el);
    closeWord();
    // long chapters (Ps 119): rows off screen skip layout until they come near
    el.classList.toggle('is-long', cm.rows.length > LONG_ROWS);
    controller.index(cm.merged);
    if (keep.current) restoreAnchor(el, keep.current);
    keep.current = null;
    twins.current = [];
    applyMarks();
    announceRendered(cm.key);
  }, [html]);

  // Word states follow the open word (pinned wins over hover / focus), plus the cross-column twins.
  useEffect(
    () =>
      effect(() => {
        const p = pinnedWord.value;
        const a = activeWord.value;
        void settings.value.markRelated;
        controller.highlight(p ?? a, Boolean(p));
        markTwins(p ?? a);
      }),
    [],
  );

  // A column's verse sheet ("Study this verse") pins words with its own key: map it to the grid's.
  useEffect(
    () =>
      effect(() => {
        const p = pinnedWord.value;
        const m = cmRef.current;
        if (p && p.key !== m.key && m.columns.some((c) => c.sheetModel.key === p.key)) pinnedWord.value = { ...p, key: m.key };
      }),
    [],
  );

  // Study marks follow the signals (no re-render of the grid).
  useEffect(
    () =>
      effect(() => {
        void highlights.value;
        void notes.value;
        void bookmarks.value;
        applyMarks();
      }),
    [],
  );

  // Swipe left / right changes chapter (never while scrubbing).
  useEffect(() => {
    const area = bodyRef.current;
    if (!area) return;
    return attachSwipe(area, {
      label: (dir) => swipeRef.current?.label(dir) ?? null,
      go: (dir) => swipeRef.current?.go(dir),
      busy: () => controller.isScrubbing(),
    });
  }, []);

  // Leaving the page: close what belongs to it.
  useEffect(
    () => () => {
      controller.detach();
      const m = cmRef.current;
      const w = pinnedWord.peek() ?? activeWord.peek();
      if (w && w.key === m.key) closeWord();
      const vs = verseSheet.peek();
      if (vs && m.columns.some((c) => c.sheetModel.key === vs.key)) closeVerseSheet();
    },
    [],
  );

  const ref = pinnedWord.value ?? activeWord.value;
  const col = ref && ref.key === cm.key ? (cm.colOfUnit[ref.unit] ?? 0) : 0;
  const cardModel = cm.columns[col]?.model ?? cm.merged;

  return (
    <div class="cmp-body" ref={bodyRef}>
      <div ref={rootRef} class="prose cmp-grid" lang="en" dangerouslySetInnerHTML={{ __html: html }} />
      <WordCard model={cardModel} controller={controller} />
      {cm.columns.map((c) => (c.available ? <VerseSheet key={c.tr} model={c.sheetModel} controller={controller} /> : null))}
      <Loupe model={cm.merged} />
    </div>
  );
}
