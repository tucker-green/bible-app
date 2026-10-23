/**
 * The reading page: left rail (contents), the chapter (head, prose, chapter navigation), right rail
 * (reading key, keyboard, this edition), the word card, the verse sheet, and the scrub loupe. The
 * prose is rendered as one HTML string (see render.ts) and wired to a single delegated controller
 * (see interaction.ts); verse decorations (highlights, notes, bookmarks, listen mode) are applied
 * imperatively after each render (decorate.ts); swiping changes chapter (swipe.ts).
 */
import { effect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { resolveTranslation } from '../../app/router';
import {
  activeWord,
  closeWord,
  listeningVerse,
  meta,
  metaError,
  navigate,
  passage,
  pinnedWord,
  readingMode,
  reducedMotion,
  scrollBehavior,
  settings,
  showToast,
  translations,
  updateSettings,
  verseSheet,
} from '../../app/state';
import { bookmarks, highlights, notes } from '../../app/study';
import { announceRendered } from '../../app/transitions';
import { getBook } from '../../lib/books';
import { loadChapter, loadText, nextChapter, prefetchChapter, prevChapter } from '../../lib/data';
import { APIBIBLE_ATTRIBUTION, apiBibleMeta, createFumsIds, reportFums } from '../../lib/providers/apibible';
import type { FumsIds } from '../../lib/providers/apibible';
import { formatChapter, refToHash } from '../../lib/reference';
import type { TranslationMeta } from '../../lib/types';
import { alignmentOf } from '../common/alignment';
import { Icon } from '../common/Icon';
import { trapTab } from '../common/hooks';
import { UiIcon } from '../shell/icons';
import { useBackClose } from '../shell/sheet';
import { Typeset } from '../common/Typeset';
import { ModeToggle } from '../header/Header';
import { bookEyebrow } from '../word/cardModel';
import { Loupe } from '../word/Loupe';
import { WordCard } from '../word/WordCard';
import { VerseSheet } from '../verse/VerseSheet';
import { XrefBack } from '../xrefs/XrefBack';
import { XrefRail } from '../xrefs/XrefRail';
import { decorateVerses, markListening } from './decorate';
import { ReaderController } from './interaction';
import type { ChapterModel } from './model';
import { buildChapterModel, chapterKey } from './model';
import { chooseLayout, renderChapterHtml } from './render';
import { attachSwipe } from './swipe';
import './reader.css';

/* ------------------------------------------------------------------------ */
/* Interlinear FLIP (docs/EXPERIENCE.md §5)                                  */
/* ------------------------------------------------------------------------ */

interface Snapshot {
  rects: Map<number, { left: number; top: number }>;
  anchor: { unit: number; top: number } | null;
}

function headerBottom(): number {
  return Math.max(0, document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0);
}

/**
 * The element that actually has a box for verse `el`: interlinear verses are `display: contents`
 * (no box of their own, so measuring or scrollIntoView() on them does nothing); use their first
 * rendered cell instead.
 */
function verseBox(el: HTMLElement): HTMLElement {
  const r = el.getBoundingClientRect();
  if (r.width || r.height) return el;
  for (const c of Array.from(el.querySelectorAll<HTMLElement>('*'))) {
    const b = c.getBoundingClientRect();
    if (b.width || b.height) return c;
  }
  return el;
}

/** Positions of the word units on screen (only blocks in the viewport are measured). */
function snapshotVisible(prose: HTMLElement): Snapshot {
  const top = headerBottom();
  const vh = window.innerHeight;
  const rects = new Map<number, { left: number; top: number }>();
  let anchor: Snapshot['anchor'] = null;
  for (const block of Array.from(prose.children) as HTMLElement[]) {
    const br = block.getBoundingClientRect();
    if (br.bottom < top || br.top > vh) continue;
    block.querySelectorAll<HTMLElement>('[data-u]').forEach((u) => {
      const r = u.getBoundingClientRect();
      if (r.bottom < top || r.top > vh) return;
      const id = Number(u.dataset.u);
      rects.set(id, { left: r.left, top: r.top });
      if (r.top >= top && (!anchor || r.top < anchor.top - 1)) anchor = { unit: id, top: r.top };
    });
  }
  return { rects, anchor };
}

/** Keep the first visible word where it was, then let the words glide into their new places. */
function restoreAndFlip(controller: ReaderController, prose: HTMLElement, snap: Snapshot, toInterlinear: boolean): void {
  const a = snap.anchor;
  if (a) {
    const el = controller.el(a.unit);
    if (el) {
      const dy = el.getBoundingClientRect().top - a.top;
      if (Math.abs(dy) > 1) window.scrollBy(0, dy);
    }
  }
  if (reducedMotion() || typeof prose.animate !== 'function') return;
  if (!toInterlinear) {
    prose.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    return;
  }
  const vh = window.innerHeight;
  let i = 0;
  for (const [unit, old] of snap.rects) {
    if (i >= 160) break;
    const el = controller.el(unit);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) continue;
    const dx = old.left - r.left;
    const dy = old.top - r.top;
    const easing = 'cubic-bezier(.16, 1, .3, 1)';
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 280, easing });
    }
    el.querySelectorAll<HTMLElement>('.il__or, .il__tr, .il__gl').forEach((o) =>
      o.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], {
        duration: 200,
        delay: 60 + Math.min(i, 40) * 4,
        easing,
        fill: 'backwards',
      }),
    );
    i++;
  }
}

/** Timing of the last chapter render (also exposed as <html data-render-ms>). */
export interface RenderStats {
  key: string;
  mode: string;
  tokens: number;
  units: number;
  buildMs: number;
  domMs: number;
  layoutMs: number;
  totalMs: number;
}
export let lastRender: RenderStats | null = null;

let fumsIds: FumsIds | null = null;
/** API.Bible usage reporting ids (device id in localStorage, session id in sessionStorage). */
function getFumsIds(): FumsIds {
  if (!fumsIds) {
    let local: Storage | null = null;
    let session: Storage | null = null;
    try {
      local = localStorage;
      session = sessionStorage;
    } catch {
      /* storage blocked: ids live for this page only */
    }
    fumsIds = createFumsIds(local, session);
  }
  return fumsIds;
}

type LoadState =
  | { key: string; status: 'loading'; model: null }
  | { key: string; status: 'ready'; model: ChapterModel }
  | { key: string; status: 'error'; model: null; error: unknown };

function origLabel(model: ChapterModel | null, testament: 'OT' | 'NT'): string {
  if (testament === 'NT') return `Greek · ${model?.orig?.edition ?? 'SBLGNT'}`;
  const orig = model?.orig;
  const edition = orig?.edition ?? 'WLC';
  const aram = orig?.aramaic?.length ?? 0;
  if (orig && aram && aram >= orig.words.length * 0.95) return `Aramaic · ${edition}`;
  if (aram) return `Hebrew & Aramaic · ${edition}`;
  return `Hebrew · ${edition}`;
}

export function Reader() {
  const { tr, ref } = passage.value;
  const m = meta.value;
  const list = translations.value;
  const trMeta = list.find((t) => t.id === tr) ?? null;
  const mode = readingMode.value;
  const s = settings.value;
  const book = getBook(ref.book)!;
  const key = chapterKey(tr, ref.book, ref.chapter);
  const controller = useMemo(() => new ReaderController(), []);
  const [st, setSt] = useState<LoadState>({ key: '', status: 'loading', model: null });
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const proseRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<ChapterModel | null>(null);
  const prevRender = useRef<{ key: string; mode: string } | null>(null);
  const pendingSnap = useRef<Snapshot | null>(null);
  const [drawer, setDrawer] = useState<'contents' | 'key' | null>(null);
  const drawerFrom = useRef<HTMLElement | null>(null);
  const openDrawer = (d: 'contents' | 'key', from: HTMLElement) => {
    drawerFrom.current = from;
    closeWord();
    setDrawer(d);
  };
  const closeDrawer = () => {
    setDrawer(null);
    const from = drawerFrom.current;
    if (from?.isConnected) requestAnimationFrame(() => from.focus({ preventScroll: true }));
  };

  // Interlinear FLIP: measure the words the moment the mode changes, before Preact re-renders.
  useEffect(
    () =>
      effect(() => {
        const m = readingMode.value;
        const el = proseRef.current;
        const prev = prevRender.current;
        if (el && prev && prev.mode !== m && modelRef.current?.key === prev.key) pendingSnap.current = snapshotVisible(el);
      }),
    [],
  );
  const resolved = m ? resolveTranslation(tr, list) : tr;
  const ready = Boolean(m) && resolved === tr;

  // Unknown / unavailable translation: fall back to the KJV (owner's decision).
  useEffect(() => {
    if (!m || resolved === tr) return;
    showToast(`The ${tr} isn’t available here — showing the ${resolved} instead.`);
    navigate(ref, resolved, { replace: true });
  }, [m, tr, resolved]);

  // New chapter: start at the top (unless a verse is targeted).
  useLayoutEffect(() => {
    if (!passage.peek().ref.verse) window.scrollTo(0, 0);
  }, [key]);

  // Load the chapter.
  useEffect(() => {
    if (!ready) return;
    let off = false;
    closeWord();
    setSt((cur) => (cur.key === key && cur.status === 'ready' ? cur : { key, status: 'loading', model: null }));
    setSlow(false);
    const t = setTimeout(() => !off && setSlow(true), 150);
    loadChapter(tr, ref.book, ref.chapter).then(
      ({ text, orig }) => {
        if (off) return;
        setSt({ key, status: 'ready', model: buildChapterModel(text, orig, { alignment: trMeta?.alignment, tr }) });
        const n = nextChapter(ref.book, ref.chapter);
        if (n) setTimeout(() => prefetchChapter(tr, n[0], n[1], { next: false }), 400);
      },
      (error: unknown) => {
        if (!off) setSt({ key, status: 'error', model: null, error });
      },
    );
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [key, attempt, ready]);

  const model = st.status === 'ready' && st.key === key ? st.model : null;
  const layout = model ? chooseLayout(model, s.layout) : 'paragraphs';
  modelRef.current = model;

  /** Highlights / notes / bookmarks on the verses on screen. */
  const applyMarks = () => {
    const el = proseRef.current;
    const m = modelRef.current;
    if (!el || !m) return;
    decorateVerses(el, m.book, m.chapter, { highlights: highlights.peek(), notes: notes.peek(), bookmarks: bookmarks.peek() });
  };

  // Render the prose once per (chapter, mode, layout, options) — never on hover.
  useLayoutEffect(() => {
    const el = proseRef.current;
    if (!el) return;
    controller.attach(el);
    closeWord();
    if (!model) {
      el.innerHTML = '';
      controller.index(null);
      prevRender.current = null;
      return;
    }
    const prev = prevRender.current;
    // The snapshot is taken when readingMode changes (before this commit moved anything).
    const snap = prev && prev.key === model.key && prev.mode !== mode ? (pendingSnap.current ?? snapshotVisible(el)) : null;
    pendingSnap.current = null;
    const t0 = performance.now();
    const html = renderChapterHtml(model, { mode, layout, headings: s.headings, ilTranslit: s.ilTranslit, ilGloss: s.ilGloss });
    const t1 = performance.now();
    el.innerHTML = html;
    controller.index(model);
    const t2 = performance.now();
    void el.offsetHeight; // force style + layout so the measurement includes it
    const t3 = performance.now();
    applyMarks();
    markListening(el, listeningVerse.peek());
    if (snap) restoreAndFlip(controller, el, snap, mode === 'interlinear');
    prevRender.current = { key: model.key, mode };
    lastRender = {
      key: model.key,
      mode,
      tokens: model.tokenCount,
      units: model.units.length,
      buildMs: +(t1 - t0).toFixed(2),
      domMs: +(t2 - t1).toFixed(2),
      layoutMs: +(t3 - t2).toFixed(2),
      totalMs: +(t3 - t0).toFixed(2),
    };
    document.documentElement.dataset.renderMs = String(lastRender.totalMs);
    (window as unknown as { __rootwordRender?: RenderStats }).__rootwordRender = lastRender;
    announceRendered(model.key);
  }, [model, mode, layout, s.headings, s.ilTranslit, s.ilGloss]);

  useEffect(() => () => controller.detach(), []);

  // Study marks follow the signals (no re-render of the chapter).
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

  // Listen mode: highlight the verse being read and keep it in view (a jump under reduced motion).
  useEffect(
    () =>
      effect(() => {
        const v = listeningVerse.value;
        const el = proseRef.current;
        if (!el) return;
        const marked = markListening(el, v);
        if (!marked) return;
        const target = verseBox(marked);
        const r = target.getBoundingClientRect();
        const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 0;
        if (r.top < headerBottom() + 8 || r.bottom > window.innerHeight - dock - 16) {
          target.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
        }
      }),
    [],
  );

  // Swipe left / right on the reading area changes chapter.
  useEffect(() => {
    const area = pageRef.current;
    if (!area) return;
    return attachSwipe(area, {
      label: (dir) => {
        const { ref: r } = passage.peek();
        const t = dir === 'next' ? nextChapter(r.book, r.chapter) : prevChapter(r.book, r.chapter);
        return t ? formatChapter(t[0], t[1], 'short') : null;
      },
      go: (dir) => {
        const { ref: r } = passage.peek();
        const t = dir === 'next' ? nextChapter(r.book, r.chapter) : prevChapter(r.book, r.chapter);
        if (t) navigate({ book: t[0], chapter: t[1] });
      },
      busy: () => controller.isScrubbing(),
    });
  }, []);

  // Close the verse sheet when the chapter changes.
  useEffect(() => {
    if (verseSheet.peek() && verseSheet.peek()!.key !== key) verseSheet.value = null;
  }, [key]);

  // Document title: "John 1 (KJV) — Rootword".
  useEffect(() => {
    document.title = `${formatChapter(ref.book, ref.chapter)} (${trMeta?.abbr ?? tr}) — Rootword`;
  }, [ref.book, ref.chapter, tr, trMeta?.abbr]);

  // Chapters from API.Bible (e.g. the NIV): report the view (FUMS), as API.Bible's terms require.
  useEffect(() => {
    const am = model ? apiBibleMeta(model.text) : undefined;
    if (am) reportFums(am, getFumsIds());
  }, [model]);

  // Word states follow the open word (pinned wins over hover / focus).
  useEffect(
    () =>
      effect(() => {
        const p = pinnedWord.value;
        const a = activeWord.value;
        void settings.value.markRelated;
        controller.highlight(p ?? a, Boolean(p));
      }),
    [],
  );

  // Verse targeting: #/KJV/JHN/3/16 scrolls to the verse and briefly highlights it.
  useEffect(() => {
    const root = proseRef.current;
    if (!model || !root || !ref.verse) return;
    const first = root.querySelector<HTMLElement>(`#v${ref.verse}`);
    if (!first) return;
    const to = ref.verseEnd ?? ref.verse;
    const els: HTMLElement[] = [];
    for (let v = ref.verse; v <= to; v++) {
      const el = root.querySelector<HTMLElement>(`#v${v}`);
      if (el) els.push(el);
    }
    requestAnimationFrame(() => {
      verseBox(first).scrollIntoView({ block: to > ref.verse! + 3 ? 'start' : 'center' });
      els.forEach((el) => {
        el.classList.remove('is-target');
        void el.offsetWidth;
        el.classList.add('is-target');
      });
    });
    const t = setTimeout(() => els.forEach((el) => el.classList.remove('is-target')), 3200);
    return () => clearTimeout(t);
  }, [model, ref.verse, ref.verseEnd]);

  const testament = book.testament;
  const verseCount = m?.books.find((b) => b.id === book.id)?.verses[ref.chapter - 1] ?? model?.text.verses.length ?? 0;

  return (
    <div ref={pageRef} class={`page page--read${mode === 'interlinear' ? ' is-interlinear' : ''}`}>
      <LeftRail model={model} tr={tr} bookId={book.id} chapter={ref.chapter} />
      <article class="text" id="text" tabIndex={-1} aria-labelledby="chapter-title">
        <header class="ch-head">
          <p class="eyebrow">{bookEyebrow(book.id)}</p>
          <h1 class={`ch-title${(book.id === 'PSA' ? 'Psalm' : book.name).length >= 12 ? ' ch-title--long' : ''}`} id="chapter-title">
            <span>{book.id === 'PSA' ? 'Psalm' : book.name}</span> <span class="num">{ref.chapter}</span>
          </h1>
          <span class="ch-rule" aria-hidden="true" />
          <p class="ch-meta">
            <b>{trMeta?.name ?? tr}</b>
            <span class="dot" aria-hidden="true" />
            <span>{origLabel(model, testament)}</span>
            <span class="dot" aria-hidden="true" />
            <span>{alignmentOf(trMeta).label}</span>
            {verseCount > 0 && (
              <>
                <span class="dot" aria-hidden="true" />
                <span class="tnum">{verseCount} verses</span>
              </>
            )}
          </p>
          <div class="ch-tools">
            <ModeToggle />
            <div class="rail-btns" role="group" aria-label="Chapter tools">
              <button type="button" class="rail-btn rail-btn--contents" aria-haspopup="dialog" onClick={(e) => openDrawer('contents', e.currentTarget as HTMLElement)}>
                <UiIcon name="study" />
                Contents
              </button>
              <button type="button" class="rail-btn rail-btn--key" aria-haspopup="dialog" onClick={(e) => openDrawer('key', e.currentTarget as HTMLElement)}>
                <UiIcon name="info" />
                Reading key
              </button>
            </div>
          </div>
        </header>
        {mode === 'interlinear' && <IlBar testament={testament} />}
        {trMeta?.alignment === 'bridged' && (
          <p class="approx-banner">
            <span aria-hidden="true">≈</span> Word links in the {trMeta.abbr} are matched automatically through the BSB and may be
            approximate. <a href="#/about">How links work</a>
          </p>
        )}
        <div
          ref={proseRef}
          class={`prose prose--${layout}${mode === 'interlinear' ? ' prose--il' : ''}`}
          lang="en"
          aria-busy={st.status === 'loading' ? 'true' : undefined}
        />
        {!model && st.status !== 'error' && (slow || !m) && !metaError.value && <Skeleton />}
        {(st.status === 'error' || metaError.value) && (
          <ErrorNotice
            message={metaError.value ? 'Rootword couldn’t load its Bible data.' : `${formatChapter(ref.book, ref.chapter)} didn’t load in the ${trMeta?.abbr ?? tr}.`}
            onRetry={() => (metaError.value ? location.reload() : setAttempt((n) => n + 1))}
            offerKjv={tr !== 'KJV' && !metaError.value}
          />
        )}
        <WordCard model={model} controller={controller} />
        <VerseSheet model={model} controller={controller} />
        <Loupe model={model} />
        <XrefBack />
        {model && <ChapterNav tr={tr} bookId={book.id} chapter={ref.chapter} />}
        {model && <Colophon trMeta={trMeta} testament={testament} model={model} />}
      </article>
      <RightRail trMeta={trMeta} testament={testament} />
      {drawer && (
        <RailDrawer side={drawer} onClose={closeDrawer}>
          {drawer === 'contents' ? (
            <LeftRail model={model} tr={tr} bookId={book.id} chapter={ref.chapter} inDrawer onPick={closeDrawer} />
          ) : (
            <RightRail trMeta={trMeta} testament={testament} inDrawer />
          )}
        </RailDrawer>
      )}
    </div>
  );
}

/**
 * The rails as drawers where they do not fit (docs/EXPERIENCE.md §1: tablets — both rails as drawers;
 * laptops — the reading key in a drawer). A modal side panel: focus moves in, Tab is trapped, Esc /
 * the scrim / × close it, focus returns to the button that opened it.
 */
function RailDrawer({ side, onClose, children }: { side: 'contents' | 'key'; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useBackClose(true, onClose);
  useEffect(() => {
    const el = ref.current;
    requestAnimationFrame(() => (el?.querySelector<HTMLElement>('a[href], button') ?? el)?.focus({ preventScroll: true }));
  }, []);
  const label = side === 'contents' ? 'In this chapter' : 'Reading key';
  return (
    <>
      <div class="drawer-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        class={`drawer drawer--${side === 'contents' ? 'left' : 'right'}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (ref.current) trapTab(e, ref.current);
        }}
      >
        <div class="drawer__head">
          <p class="eyebrow">{label}</p>
          <button type="button" class="drawer__close" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>
            <UiIcon name="close" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Skeleton() {
  const widths = [96, 100, 92, 98, 70, 0, 94, 99, 88, 97, 60];
  return (
    <div class="prose-skeleton" aria-hidden="true">
      {widths.map((w, i) => (w ? <span key={i} class="skeleton" style={{ width: `${w}%` }} /> : <span key={i} class="skeleton-gap" />))}
    </div>
  );
}

function ErrorNotice({ message, onRetry, offerKjv }: { message: string; onRetry: () => void; offerKjv: boolean }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <div class="notice" role="alert">
      <Icon name="alert" />
      <div>
        <p class="notice__title">{message}</p>
        <p>{offline ? 'You seem to be offline. Chapters you have opened before still work.' : 'Check your connection and try again.'}</p>
        <div class="notice__actions">
          <button type="button" class="btn-primary" onClick={onRetry}>
            <Icon name="retry" /> Try again
          </button>
          {offerKjv && (
            <button type="button" class="btn-quiet" onClick={() => navigate({ ...passage.value.ref, verse: undefined, verseEnd: undefined }, 'KJV')}>
              Read the KJV
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function IlBar({ testament }: { testament: 'OT' | 'NT' }) {
  const s = settings.value;
  return (
    <div class="il-bar" role="group" aria-label="Show beneath each word">
      <span class="lbl">Show</span>
      <label class="chk chk--fixed">
        <input type="checkbox" checked disabled />
        {testament === 'NT' ? 'Greek' : 'Hebrew'}
      </label>
      <label class="chk">
        <input type="checkbox" checked={s.ilTranslit} onChange={(e) => updateSettings({ ilTranslit: (e.target as HTMLInputElement).checked })} />
        Transliteration
      </label>
      <label class="chk">
        <input type="checkbox" checked={s.ilGloss} onChange={(e) => updateSettings({ ilGloss: (e.target as HTMLInputElement).checked })} />
        Gloss
      </label>
      <span class="note">in English word order</span>
    </div>
  );
}

function ChapterNav({ tr, bookId, chapter }: { tr: string; bookId: string; chapter: number }) {
  const prev = prevChapter(bookId, chapter);
  const next = nextChapter(bookId, chapter);
  return (
    <nav class="ch-nav" aria-label="Chapters">
      {prev ? (
        <a href={refToHash(tr, { book: prev[0], chapter: prev[1] })} rel="prev">
          <small>
            <Icon name="left" /> Previous
          </small>
          <span>{formatChapter(prev[0], prev[1])}</span>
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a href={refToHash(tr, { book: next[0], chapter: next[1] })} rel="next" class="ch-nav__next">
          <small>
            Next <Icon name="right" />
          </small>
          <span>{formatChapter(next[0], next[1])}</span>
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}

function Colophon({ trMeta, testament, model }: { trMeta: TranslationMeta | null; testament: 'OT' | 'NT'; model: ChapterModel }) {
  const remote = apiBibleMeta(model.text);
  const parts = [
    trMeta ? `${trMeta.abbr} text: ${trMeta.license.toLowerCase()}` : '',
    testament === 'NT' ? 'Greek: SBLGNT, CC BY 4.0' : 'Hebrew: WLC, public domain · Macula Hebrew, CC BY 4.0',
    trMeta?.alignment === 'manual' || trMeta?.alignment === 'bridged' ? 'Alignment: Clear Bible / Biblica, CC BY 4.0' : '',
    'Lexicons: STEPBible, CC BY 4.0',
  ].filter(Boolean);
  return (
    <footer class="colophon">
      {remote && (
        <p class="colophon__copy">
          {remote.copyright} ·{' '}
          <a href={APIBIBLE_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer">
            {APIBIBLE_ATTRIBUTION.text}
          </a>
        </p>
      )}
      <p>{parts.join(' · ')}</p>
      <p>
        <a href="#/about">About Rootword &amp; full credits</a>
      </p>
    </footer>
  );
}

/* ------------------------------------------------------------------------ */
/* Rails                                                                     */
/* ------------------------------------------------------------------------ */

function LeftRail({
  model,
  tr,
  bookId,
  chapter,
  inDrawer = false,
  onPick,
}: {
  model: ChapterModel | null;
  tr: string;
  bookId: string;
  chapter: number;
  inDrawer?: boolean;
  onPick?: () => void;
}) {
  const own = model?.text.headings?.length ? model.text.headings : null;
  const [borrowed, setBorrowed] = useState<[number, string][] | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const showHeads = settings.value.headings;

  // Translations without headings (KJV): borrow the BSB's section titles for navigation only.
  useEffect(() => {
    setBorrowed(null);
    if (!model || own || tr === 'BSB') return;
    let off = false;
    loadText('BSB', bookId, chapter).then(
      (t) => !off && setBorrowed(t.headings?.length ? t.headings : null),
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [model]);

  const heads = own ?? borrowed;

  // Scroll spy: the section whose start is above the reading line.
  useEffect(() => {
    if (!heads?.length) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const line = (document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 60) + 120;
        let cur: number | null = heads[0][0];
        for (const [v] of heads) {
          const el = document.getElementById(`v${v}`);
          if (el && verseBox(el).getBoundingClientRect().top <= line) cur = v;
        }
        setCurrent(cur);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', on);
    };
  }, [heads, model]);

  const verses = model?.text.verses.map((v) => v.v) ?? [];
  return (
    <aside
      class={`rail rail--left${inDrawer ? ' rail--drawer' : ''}`}
      aria-label={inDrawer ? undefined : 'In this chapter'}
      tabIndex={inDrawer ? undefined : 0}
      onClick={(e) => onPick && (e.target as Element).closest?.('a') && onPick()}>
      <section>
        <p class="eyebrow rail__title">In this chapter</p>
        {heads && showHeads ? (
          <>
            <ol class="toc">
              {heads.map(([v, t]) => (
                <li key={`${v}-${t}`}>
                  <a href={refToHash(tr, { book: bookId, chapter, verse: v })} aria-current={current === v ? 'true' : undefined}>
                    <span class="n">{v}</span>
                    <span>
                      <Typeset text={t} />
                    </span>
                  </a>
                </li>
              ))}
            </ol>
            {!own && <p class="rail__note">Section titles from the BSB.</p>}
          </>
        ) : verses.length ? (
          <div class="vgrid" role="list">
            {verses.map((v) => (
              <a key={v} role="listitem" href={refToHash(tr, { book: bookId, chapter, verse: v })} aria-label={`Verse ${v}`}>
                {v}
              </a>
            ))}
          </div>
        ) : null}
      </section>
      {!inDrawer && <XrefRail placement="left" />}
    </aside>
  );
}

function RightRail({ trMeta, testament, inDrawer = false }: { trMeta: TranslationMeta | null; testament: 'OT' | 'NT'; inDrawer?: boolean }) {
  const lang = testament === 'NT' ? 'Greek' : 'Hebrew';
  const align = alignmentOf(trMeta);
  return (
    <aside class={`rail rail--right${inDrawer ? ' rail--drawer' : ''}`} aria-label={inDrawer ? undefined : 'Reading key'} tabIndex={inDrawer ? undefined : 0}>
      {!inDrawer && <XrefRail placement="right" />}
      <section>
        <p class="eyebrow rail__title">Reading key</p>
        <ul class="key">
          <li>
            <span class="sample">
              <span class="w is-active">Word</span>
            </span>
            <span>
              Words link to the {lang}. Hover, tap, or press <span class="kbd">↵</span>.
            </span>
          </li>
          <li>
            <span class="sample">
              <span class="w is-linked">the beginning</span>
            </span>
            <span>A phrase that renders one original word.</span>
          </li>
          <li>
            <span class="sample">
              <span class="w is-kin">Word</span>
            </span>
            <span>The same {lang} word elsewhere in the chapter.</span>
          </li>
          <li>
            <span class="sample">
              <span class="w w--sup">it is</span>
            </span>
            <span>Supplied by the translators (KJV italics); nothing stands behind it.</span>
          </li>
          {trMeta?.alignment === 'bridged' && (
            <li>
              <span class="sample">
                <span class="w w--approx is-active">word</span>
              </span>
              <span>Dashed: an approximate link.</span>
            </li>
          )}
          <li>
            <span class="sample">
              <span class="vn vn--sample">16</span>
            </span>
            <span>Verse numbers open cross references, highlight, note, copy, share, compare and listen.</span>
          </li>
          <li class="key__touch">
            <span class="sample sample--ui">Press &amp; slide</span>
            <span>On a touch screen, press a word and slide across the text to study word after word.</span>
          </li>
        </ul>
      </section>
      <section>
        <p class="eyebrow rail__title">Keyboard</p>
        <div class="key-keys">
          <span class="kbd">Tab</span>
          <span>Into the text</span>
          <span>
            <span class="kbd">←</span> <span class="kbd">→</span>
          </span>
          <span>Previous / next word</span>
          <span>
            <span class="kbd">↑</span> <span class="kbd">↓</span>
          </span>
          <span>Verse to verse</span>
          <span class="kbd">↵</span>
          <span>Word study / verse actions</span>
          <span class="kbd">Esc</span>
          <span>Close it</span>
          <span class="kbd">/</span>
          <span>Search</span>
          <span>
            <span class="kbd">←</span> <span class="kbd">→</span>
          </span>
          <span>Chapter (outside the text)</span>
        </div>
      </section>
      <section class="edition">
        <p class="eyebrow rail__title">This edition</p>
        <dl>
          <dt>Text</dt>
          <dd>{trMeta ? `${trMeta.name}, ${trMeta.year}` : '—'}</dd>
          <dt>{lang}</dt>
          <dd>{testament === 'NT' ? 'SBL Greek New Testament' : 'Westminster Leningrad Codex'}</dd>
          {testament === 'OT' && (
            <>
              <dt>Greek</dt>
              <dd>Septuagint, via Macula Hebrew</dd>
            </>
          )}
          <dt>Links</dt>
          <dd>{align.long}</dd>
          <dt>Lexicon</dt>
          <dd>{testament === 'NT' ? 'Abbott-Smith · Strong’s' : 'BDB (abridged) · Strong’s'}</dd>
        </dl>
      </section>
    </aside>
  );
}
