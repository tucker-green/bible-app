/**
 * Which verse the desktop "Cross references" rail block follows (docs/EXPERIENCE.md: "the
 * focused / hovered verse, or the verse under the reading position"). Last explicit pick wins:
 *
 *  - a verse targeted by the route (#/KJV/JHN/3/16, a contents link, a followed cross reference);
 *  - the mouse resting on a verse for DWELL_MS (so sweeping the pointer across the text towards the
 *    rail does not change it on the way);
 *  - keyboard focus on a word or verse number (roving focus, ←/→ ↑/↓); scrolling caused by focus
 *    moving elsewhere (Tab towards the rail) keeps the pick;
 *  - a word opened by tap / click (pinned card), the verse sheet's verse, the verse being read aloud.
 *
 * An explicit pick holds while its verse is on screen; once it scrolls away the block follows the
 * reading line (30 % down the visible text area).
 */
import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { listeningVerse, passage, pinnedWord, verseSheet } from '../../app/state';
import { indexAtLine } from './model';

export const DWELL_MS = 280;
/** The reading line, as a fraction of the visible text area below the header. */
export const READING_LINE = 0.3;
/** How long a route / render pick survives before scrolling may replace it (the reader's own scroll-to-verse). */
export const HOLD_MS = 900;

function prose(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#text .prose');
}

function headerBottom(): number {
  return Math.max(0, document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0);
}

function dockHeight(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 0;
}

/**
 * Box of a verse element. Interlinear verses are `display: contents` (no box of their own), so their
 * first and last cells stand in for them.
 */
export function verseBox(el: Element): { top: number; bottom: number } {
  const r = el.getBoundingClientRect();
  if (r.width || r.height) return { top: r.top, bottom: r.bottom };
  const first = el.firstElementChild;
  const last = el.lastElementChild;
  if (!first || !last) return { top: r.top, bottom: r.bottom };
  return { top: first.getBoundingClientRect().top, bottom: last.getBoundingClientRect().bottom };
}

/** Verse number of the `.verse` element containing `el` inside the prose, or null. */
export function verseOf(el: Element | null, root: HTMLElement | null = prose()): number | null {
  if (!el || !root) return null;
  const v = (el as Element).closest?.('.verse[data-v]') as HTMLElement | null;
  if (!v || !root.contains(v)) return null;
  const n = Number(v.dataset.v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The verse at the reading line (null before the chapter has rendered). */
export function verseAtReadingLine(root: HTMLElement | null = prose()): number | null {
  if (!root) return null;
  const els = root.querySelectorAll<HTMLElement>('.verse[data-v]');
  if (!els.length) return null;
  const top = headerBottom();
  const line = top + (window.innerHeight - top) * READING_LINE;
  const i = indexAtLine(els.length, (k) => verseBox(els[k]).top, line);
  return Number(els[i].dataset.v) || null;
}

function onScreen(verse: number, root: HTMLElement | null = prose()): boolean {
  const el = root?.querySelector<HTMLElement>(`.verse[data-v="${verse}"]`);
  if (!el) return false;
  const r = verseBox(el);
  return r.bottom > headerBottom() + 4 && r.top < window.innerHeight - dockHeight() - 4;
}

/** The verse the rail block shows for chapter (tr, book, chapter); null until the chapter is on screen. */
export function useReadingVerse(tr: string, book: string, chapter: number): number | null {
  const [verse, setVerse] = useState<number | null>(() => passage.peek().ref.verse ?? null);
  const explicit = useRef<number | null>(null);

  useEffect(() => {
    const key = `${tr}/${book}/${chapter}`;
    const mine = () => {
      const p = passage.peek();
      return p.tr === tr && p.ref.book === book && p.ref.chapter === chapter;
    };
    // After a render or a route target the reader scrolls the verse into view itself (a frame or a
    // smooth scroll later): hold the pick meanwhile instead of judging it "scrolled away".
    let holdUntil = 0;
    const hold = () => (holdUntil = Date.now() + HOLD_MS);
    explicit.current = passage.peek().ref.verse ?? null;
    if (explicit.current !== null) hold();
    setVerse(explicit.current);
    const pick = (v: number | null) => {
      if (v === null || !mine()) return;
      explicit.current = v;
      setVerse(v);
    };
    const follow = () => {
      const ex = explicit.current;
      if (ex !== null && (Date.now() < holdUntil || onScreen(ex))) {
        setVerse(ex);
        return;
      }
      explicit.current = null;
      const v = verseAtReadingLine();
      if (v !== null) setVerse(v);
    };

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(follow);
    };

    let dwell: ReturnType<typeof setTimeout> | undefined;
    let dwellOn: number | null = null;
    const onOver = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const v = verseOf(e.target as Element);
      if (v === dwellOn) return;
      clearTimeout(dwell);
      dwellOn = v;
      if (v !== null) dwell = setTimeout(() => pick(v), DWELL_MS);
    };
    const onFocus = (e: FocusEvent) => {
      const v = verseOf(e.target as Element);
      // Focus moving elsewhere (Tab from the text to the rail passes the chapter links at the
      // bottom) scrolls the page; that scroll must not swap the verse the reader is heading for.
      if (v === null) hold();
      else pick(v);
    };
    const onRendered = (e: Event) => {
      if ((e as CustomEvent<{ key?: string }>).detail?.key !== key) return;
      const target = passage.peek().ref.verse ?? null;
      if (explicit.current === null || !prose()?.querySelector(`.verse[data-v="${explicit.current}"]`)) explicit.current = target;
      if (explicit.current !== null) hold();
      requestAnimationFrame(follow);
    };

    document.addEventListener('pointerover', onOver, { passive: true });
    document.addEventListener('focusin', onFocus);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    window.addEventListener('rootword:rendered', onRendered);
    // The chapter may already be on screen (the block mounts after a resize, or after the render).
    if (prose()?.querySelector('.verse[data-v]')) requestAnimationFrame(follow);

    const unWord = effect(() => {
      const w = pinnedWord.value;
      if (!w || w.key !== key) return;
      pick(verseOf(prose()?.querySelector(`[data-u="${w.unit}"]`) ?? null));
    });
    const unListen = effect(() => {
      const v = listeningVerse.value;
      if (v !== null) pick(v);
    });
    const unSheet = effect(() => {
      const s = verseSheet.value;
      if (s && s.key === key) pick(s.verse);
    });
    let lastTarget = passage.peek().ref.verse;
    const unRoute = effect(() => {
      const v = passage.value.ref.verse;
      if (v === lastTarget) return;
      lastTarget = v;
      if (v) {
        hold();
        pick(v);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(dwell);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('rootword:rendered', onRendered);
      unWord();
      unListen();
      unSheet();
      unRoute();
    };
  }, [tr, book, chapter]);

  return verse;
}
