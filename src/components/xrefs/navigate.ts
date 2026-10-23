/**
 * Following a cross reference, and the way back.
 *
 *  - followXref(): feedback('select'), closes the verse sheet (waiting for its Android-back history
 *    entry to be removed), rewrites the current history entry to the verse we came from (so the
 *    browser's Back lands on that verse, not the top of its chapter), pushes the target and records
 *    a trail entry for the "Back to John 3:16" chip (./XrefBack.tsx). Keyboard focus then moves to
 *    the target's verse number once the chapter has rendered.
 *  - goBackXref(): history.back() when the target is still the current history entry (and the
 *    translation has not been switched since), else a plain navigation to the origin verse.
 *
 * The trail helpers (visibleEntry, pruneTrail) are pure and unit-tested.
 */
import { signal } from '@preact/signals';
import { announce, closeVerseSheet, goToHash, navigate, passage, route, verseSheet } from '../../app/state';
import { feedback } from '../../lib/feedback';
import { formatReference, refToHash } from '../../lib/reference';
import type { VerseRef, XrefTarget } from '../../lib/types';
import { xrefToRef } from '../../lib/xrefs';

export interface TrailEntry {
  /** The verse the reader came from, in the translation they were reading. */
  from: { tr: string; ref: VerseRef };
  /** The target that was followed. */
  to: { tr: string; ref: VerseRef };
  /** Marks the history entry pushed for `to` (history.state.rwXref). */
  token: string;
}

/** Cross references followed, oldest first (at most MAX_TRAIL). */
export const xrefTrail = signal<TrailEntry[]>([]);
export const MAX_TRAIL = 8;

export function sameChapter(a: VerseRef, b: VerseRef): boolean {
  return a.book === b.book && a.chapter === b.chapter;
}

/**
 * The trail entry the back chip offers while reading `here`: the newest entry whose target chapter is
 * on screen — unless `here` is the very verse that entry came from (e.g. after the browser's Back
 * within one chapter), when there is nothing to go back to.
 */
export function visibleEntry(trail: readonly TrailEntry[], here: VerseRef): TrailEntry | null {
  for (let i = trail.length - 1; i >= 0; i--) {
    const e = trail[i];
    if (!sameChapter(e.to.ref, here)) continue;
    if (sameChapter(e.from.ref, here) && here.verse === e.from.ref.verse) return null;
    return e;
  }
  return null;
}

/** The trail after moving to `here`: kept while `here` is one of its chapters, cleared once the reader leaves it. */
export function pruneTrail(trail: readonly TrailEntry[], here: VerseRef): readonly TrailEntry[] {
  if (!trail.length) return trail;
  return trail.some((e) => sameChapter(e.to.ref, here) || sameChapter(e.from.ref, here)) ? trail : [];
}

export function clearTrail(): void {
  xrefTrail.value = [];
}

/* ------------------------------------------------------------------------ */
/* History helpers                                                           */
/* ------------------------------------------------------------------------ */

type HistState = Record<string, unknown> & { rwSheet?: string; rwXref?: string };

function histState(): HistState | null {
  const s = typeof history !== 'undefined' ? (history.state as unknown) : null;
  return s && typeof s === 'object' ? (s as HistState) : null;
}

/** The current history state without our markers (a sheet's back marker must never be copied). */
function cleanState(): Record<string, unknown> {
  const s = histState();
  if (!s) return {};
  const { rwSheet: _sheet, rwXref: _xref, ...rest } = s;
  return rest;
}

/**
 * Run `cb` once the verse sheet's extra history entry (shell/sheet.ts useBackClose, phones only) is
 * gone, so our navigation is not undone by the sheet's own history.back(). Immediate on desktop.
 */
export function afterSheetHistory(cb: () => void, timeout = 600): void {
  if (!histState()?.rwSheet) {
    cb();
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', onPop);
    clearTimeout(timer);
    cb();
  };
  const onPop = () => {
    if (!histState()?.rwSheet) setTimeout(finish, 0);
  };
  window.addEventListener('popstate', onPop);
  const timer = setTimeout(finish, timeout);
}

let seq = 0;
function newToken(): string {
  seq += 1;
  return `x${Date.now().toString(36)}${seq}`;
}

/* ------------------------------------------------------------------------ */
/* Focus                                                                     */
/* ------------------------------------------------------------------------ */

const RENDER_EVENT = 'rootword:rendered';
let cancelFocus: (() => void) | null = null;

function focusVerseNumber(verse: number): void {
  const active = document.activeElement as HTMLElement | null;
  // Never steal focus the reader has since put somewhere else (search, a dialog…).
  if (active && active !== document.body && !active.closest('#text, .rail, .xref-back, .verse-sheet')) return;
  const el = document.querySelector<HTMLElement>(`#text [data-vn="${verse}"]`);
  if (el && document.activeElement !== el) el.focus({ preventScroll: true });
}

/**
 * Move keyboard focus to a verse number once its chapter is on screen: after the reader's next
 * "rootword:rendered" for that chapter, or (same chapter, no re-render) shortly after the verse
 * sheet has finished closing.
 */
export function focusVerseAfterRender(tr: string, ref: VerseRef): void {
  cancelFocus?.();
  if (typeof window === 'undefined' || !ref.verse) return;
  const verse = ref.verse;
  const key = `${tr}/${ref.book}/${ref.chapter}`;
  const cur = passage.peek();
  const same = cur.tr === tr && sameChapter(cur.ref, ref) && Boolean(document.querySelector(`#text [data-vn="${verse}"]`));
  const t0 = Date.now();
  let later: ReturnType<typeof setTimeout> | undefined;
  const onRendered = (e: Event) => {
    if ((e as CustomEvent<{ key?: string }>).detail?.key !== key) return;
    stop();
    later = setTimeout(() => focusVerseNumber(verse), Math.max(40, 160 - (Date.now() - t0)));
  };
  const stop = () => {
    window.removeEventListener(RENDER_EVENT, onRendered);
    clearTimeout(giveUp);
  };
  window.addEventListener(RENDER_EVENT, onRendered);
  const giveUp = setTimeout(
    () => {
      stop();
      if (same) focusVerseNumber(verse);
    },
    same ? 220 : 10000,
  );
  cancelFocus = () => {
    stop();
    clearTimeout(later);
    cancelFocus = null;
  };
}

/* ------------------------------------------------------------------------ */
/* Following / going back                                                    */
/* ------------------------------------------------------------------------ */

export interface FollowOptions {
  /** Translation to open the target in (the one being read). */
  tr: string;
  /** The verse the reference was followed from. */
  from: VerseRef;
  target: XrefTarget;
}

/** Plain left clicks only: modified clicks (new tab / window) keep the link's default behaviour. */
export function isPlainClick(e: MouseEvent): boolean {
  return !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}

/** onClick for a cross-reference link (its href stays the real target for new tabs / copying). */
export function onXrefClick(e: MouseEvent, opts: FollowOptions): void {
  if (!isPlainClick(e)) return;
  e.preventDefault();
  followXref(opts);
}

export function followXref({ tr, from, target }: FollowOptions): void {
  feedback('select');
  const to = xrefToRef(target);
  const origin: VerseRef = { book: from.book, chapter: from.chapter, verse: from.verse };
  const go = () => {
    const fromTr = passage.peek().tr;
    if (route.peek().name === 'read') {
      const here = refToHash(fromTr, origin);
      if (location.hash !== here) history.replaceState(cleanState(), '', here);
    }
    const token = newToken();
    xrefTrail.value = [...xrefTrail.peek(), { from: { tr: fromTr, ref: origin }, to: { tr, ref: to }, token }].slice(-MAX_TRAIL);
    goToHash(refToHash(tr, to));
    // Hash navigation is synchronous: the entry just pushed is current — mark it as ours.
    history.replaceState({ ...cleanState(), rwXref: token }, '');
    focusVerseAfterRender(tr, to);
    announce(`${formatReference(to)}. Back to ${formatReference(origin)} is at the bottom of the screen.`);
  };
  if (verseSheet.peek()) {
    closeVerseSheet();
    afterSheetHistory(go);
  } else go();
}

/** Return to the verse an entry came from (and drop it, with anything followed after it). */
export function goBackXref(entry: TrailEntry): void {
  feedback('select');
  const trail = xrefTrail.peek();
  const i = trail.indexOf(entry);
  xrefTrail.value = i >= 0 ? trail.slice(0, i) : trail;
  const cur = passage.peek();
  const ref = entry.from.ref;
  if (histState()?.rwXref === entry.token && cur.tr === entry.from.tr) {
    history.back();
    focusVerseAfterRender(entry.from.tr, ref);
  } else {
    navigate(ref, cur.tr);
    focusVerseAfterRender(cur.tr, ref);
  }
}
