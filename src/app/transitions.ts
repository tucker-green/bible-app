/**
 * Chapter / page changes with the View Transitions API (docs/EXPERIENCE.md §5): the text slides in
 * the direction of travel for the next / previous chapter, cross-fades for other jumps, and the
 * chapter numeral morphs. Without the API (or under reduced motion) a short CSS fade/slide is
 * played instead. Navigation itself never depends on any of this: the state update always runs.
 *
 * Wire-up: main.tsx passes `routeTransition` to startRouter({ wrap }). The reader announces each
 * finished chapter render with a "rootword:rendered" event (detail: { key }), which ends the wait.
 */
import { feedback } from '../lib/feedback';
import { getBook } from '../lib/books';
import { loadChapter } from '../lib/data';
import type { Route } from './router';
import { reducedMotion } from './state';

export type NavDirection = 'next' | 'prev' | 'fade' | 'none';

/** Canonical position of a chapter (for ordering). */
function chapterPos(book: string, chapter: number): number {
  return (getBook(book)?.num ?? 0) * 1000 + chapter;
}

/** True when b is the chapter right after a (across book boundaries). */
function isAdjacent(a: { book: string; chapter: number }, b: { book: string; chapter: number }): boolean {
  const pa = getBook(a.book);
  const pb = getBook(b.book);
  if (!pa || !pb) return false;
  if (pa.id === pb.id) return b.chapter === a.chapter + 1;
  return pb.num === pa.num + 1 && b.chapter === 1 && a.chapter === pa.chapters;
}

/**
 * How a route change should animate (pure):
 *  - the same chapter (verse jumps, search opening): none
 *  - the next / previous chapter: slide next / prev
 *  - another translation of the same chapter, other chapters, page changes: fade
 */
export function navDirection(from: Route, to: Route): NavDirection {
  if (from.name === 'read' && to.name === 'read') {
    const a = from.ref;
    const b = to.ref;
    if (a.book === b.book && a.chapter === b.chapter) return from.tr === to.tr ? 'none' : 'fade';
    if (isAdjacent(a, b)) return 'next';
    if (isAdjacent(b, a)) return 'prev';
    return 'fade';
  }
  if (from.name === 'search' || to.name === 'search') return 'none';
  if (from.name === to.name && JSON.stringify(from) === JSON.stringify(to)) return 'none';
  return 'fade';
}

/** Is this a change of the chapter being read (for the page-turn feedback)? */
export function isChapterChange(from: Route, to: Route): boolean {
  if (to.name !== 'read') return false;
  if (from.name !== 'read') return false;
  return chapterPos(from.ref.book, from.ref.chapter) !== chapterPos(to.ref.book, to.ref.chapter);
}

const RENDER_EVENT = 'rootword:rendered';

/** Tell transitions (and tests) that the reader finished rendering a chapter. */
export function announceRendered(key: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(RENDER_EVENT, { detail: { key } }));
}

/** Resolve on the next reader render, or after `ms`. */
function waitForRender(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener(RENDER_EVENT, done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, ms);
    window.addEventListener(RENDER_EVENT, done);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type StartViewTransition = (cb: () => Promise<void> | void) => { finished: Promise<void>; ready: Promise<void> };

let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
function playFallback(dir: NavDirection): void {
  const root = document.documentElement;
  clearTimeout(fallbackTimer);
  root.removeAttribute('data-vt-fallback');
  void root.offsetWidth; // restart the animation
  root.dataset.vtFallback = dir;
  fallbackTimer = setTimeout(() => root.removeAttribute('data-vt-fallback'), 420);
}

/**
 * The router's `wrap`: run `update` (the route/passage signal change) inside a View Transition
 * when that helps, else straight away. Always calls `update` exactly once.
 */
export function routeTransition(update: () => void, from: Route, to: Route): void {
  if (isChapterChange(from, to)) feedback('page');
  const dir = navDirection(from, to);
  const doc = typeof document !== 'undefined' ? document : null;
  const start = (doc as unknown as { startViewTransition?: StartViewTransition } | null)?.startViewTransition;
  if (!doc || dir === 'none' || doc.visibilityState === 'hidden') {
    update();
    return;
  }
  if (!start) {
    update();
    playFallback(dir);
    return;
  }
  const root = doc.documentElement;
  const run = () => {
    let updated = false;
    const safeUpdate = () => {
      if (updated) return;
      updated = true;
      update();
    };
    root.dataset.vt = reducedMotion() ? 'fade' : dir;
    try {
      const vt = start.call(doc, async () => {
        safeUpdate();
        await waitForRender(to.name === 'read' ? 450 : 60);
      });
      vt.finished.catch(() => undefined).finally(() => {
        safeUpdate();
        if (root.dataset.vt) delete root.dataset.vt;
      });
    } catch {
      safeUpdate();
      delete root.dataset.vt;
    }
  };
  // Give an already-requested (prefetched) chapter a moment to arrive, so the transition captures
  // the new text rather than a skeleton; the old page stays interactive meanwhile.
  if (to.name === 'read') {
    let pending: Promise<void>;
    try {
      pending = loadChapter(to.tr, to.ref.book, to.ref.chapter).then(
        () => undefined,
        () => undefined,
      );
    } catch {
      pending = Promise.resolve();
    }
    Promise.race([pending, sleep(220)]).then(run, run);
  } else {
    run();
  }
}
