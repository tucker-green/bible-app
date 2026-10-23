/**
 * Listen mode bar: reads the current chapter aloud verse by verse (logic in ./listen.ts), driving
 * `listeningVerse` in src/app/state.ts (the reader highlights and scrolls to that verse).
 *
 * Mounted once by the app shell; renders nothing until startListening() is called (the verse
 * sheet's "Listen from here", or <ListenButton/>). Phones: a compact bar above the bottom toolbar.
 * Wider screens (≥ 720px): a slim bar at the bottom of the reading column (#text).
 *
 * Layout contract with the shell:
 * - Docked: mounted inside the shell's `.listen-dock` (in the fixed bottom `.dock`, above the phone
 *   toolbar), the bar is in normal flow and the dock publishes --dock-h for padding and toasts.
 * - Floating (mounted anywhere else, e.g. a test page): position: fixed above `--bottom-bar-h`
 *   (or above whatever fixed element covers the bottom of the viewport); <html> gets
 *   `has-listen-float` and `--listen-top`, and listen.css pads the body and lifts toasts.
 * - <html> has class `has-listen` while the bar is shown (either way).
 */
import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { settings } from '../../app/state';
import { nextChapter } from '../../lib/data';
import { formatChapter } from '../../lib/reference';
import { MediaIcon } from './icons';
import {
  clampRate,
  LISTEN_RATES,
  listenContinue,
  listenState,
  nextVerse,
  prevVerse,
  setListenContinue,
  setListenRate,
  stopListening,
  toggleListening,
} from './listen';
import type { ListenState } from './listen';
import './listen.css';

export {
  listenContinue,
  listenState,
  nextVerse,
  pauseListening,
  prevVerse,
  resumeListening,
  setListenContinue,
  setListenRate,
  startListening,
  stopListening,
  toggleListening,
} from './listen';
export type { ListenState, ListenStatus } from './listen';

/** "1×", "0.75×", "1.25×" */
export function formatRate(r: number): string {
  return `${Number(r.toFixed(2))}×`;
}

function statusLine(s: ListenState): { text: string; verse?: string; total?: number } {
  const total = s.verses.filter((v) => v > 0).length;
  switch (s.status) {
    case 'loading':
      return { text: 'Loading…' };
    case 'ended':
      return { text: 'Finished' };
    case 'error':
      return { text: s.error ?? 'Couldn’t read aloud' };
    default: {
      const prefix = s.status === 'paused' ? 'Paused · ' : '';
      if (s.verse === 0) return { text: `${prefix}Title` };
      if (s.verse === null) return { text: prefix ? 'Paused' : 'Starting…' };
      return { text: `${prefix}Verse `, verse: String(s.verse), total };
    }
  }
}

export function ListenBar() {
  const s = listenState.value;
  const rate = clampRate(settings.value.listenRate);
  const ref = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState(false);
  const visible = s.status !== 'idle';

  useBarLayout(ref, visible);

  useEffect(() => {
    if (!visible) setMenu(false);
  }, [visible]);

  if (!visible) return null;

  const chapterName = formatChapter(s.book, s.chapter);
  const shortName = formatChapter(s.book, s.chapter, 'short');
  const next = nextChapter(s.book, s.chapter);
  const line = statusLine(s);
  const progress = (() => {
    const list = s.verses.filter((v) => v > 0);
    if (s.status === 'ended') return 1;
    if (!list.length || s.verse === null) return 0;
    const i = list.indexOf(s.verse);
    return i < 0 ? 0 : (i + 1) / list.length;
  })();

  let playLabel = 'Pause reading aloud';
  let playIcon: 'pause' | 'play' | 'replay' = 'pause';
  if (s.status === 'paused') {
    playLabel = 'Resume reading aloud';
    playIcon = 'play';
  } else if (s.status === 'ended') {
    playLabel = `Read ${chapterName} again`;
    playIcon = 'replay';
  } else if (s.status === 'error') {
    playLabel = 'Try reading aloud again';
    playIcon = 'replay';
  }
  const busy = s.status === 'loading';
  const navDisabled = busy || s.status === 'error';
  const nextLabel = s.status === 'ended' ? (next ? `Listen to ${formatChapter(next[0], next[1])}` : 'No next chapter') : 'Next verse';

  return (
    <section
      ref={ref}
      class={`listen is-${s.status}`}
      aria-label="Listen mode"
      aria-busy={busy ? 'true' : undefined}
      data-keep-word
      data-search-keep
    >
      <div class="listen__progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <button type="button" class="listen__play" aria-label={playLabel} title={playLabel} onClick={toggleListening}>
        {busy && <span class="listen__spin" aria-hidden="true" />}
        <MediaIcon name={playIcon} />
      </button>
      <div class="listen__info">
        <p class="listen__title">
          <span class="listen__name">
            <span class="listen__long">{chapterName}</span>
            <span class="listen__short" aria-hidden="true">
              {shortName}
            </span>
          </span>
          <span class="listen__tr"> · {s.tr}</span>
        </p>
        <p class={`listen__sub${s.status === 'error' ? ' is-error' : ''}`}>
          {line.text}
          {line.verse && <span class="listen__v tnum">{line.verse}</span>}
          {line.total ? <span class="tnum"> of {line.total}</span> : null}
        </p>
      </div>
      <button type="button" class="listen__btn listen__prev" aria-label="Previous verse" title="Previous verse" disabled={navDisabled} onClick={prevVerse}>
        <MediaIcon name="prev" />
      </button>
      <button
        type="button"
        class="listen__btn listen__next"
        aria-label={nextLabel}
        title={nextLabel}
        disabled={navDisabled || (s.status === 'ended' && !next)}
        onClick={nextVerse}
      >
        <MediaIcon name="next" />
      </button>
      <OptionsButton rate={rate} open={menu} setOpen={setMenu} barRef={ref} />
      <button
        type="button"
        class="listen__btn listen__close"
        aria-label="Stop reading aloud"
        title="Stop reading aloud"
        onClick={() => stopListening({ announce: true, restoreFocus: true })}
      >
        <MediaIcon name="close" />
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------------ */

function OptionsButton({
  rate,
  open,
  setOpen,
  barRef,
}: {
  rate: number;
  open: boolean;
  setOpen: (v: boolean) => void;
  barRef: RefObject<HTMLElement>;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const cont = listenContinue.value;
  const rates = [...new Set([...LISTEN_RATES, rate])].sort((a, b) => a - b);

  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLInputElement>('input:checked') ?? menu.current?.querySelector<HTMLInputElement>('input');
    requestAnimationFrame(() => first?.focus({ preventScroll: true }));
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    const onFocus = (e: FocusEvent) => {
      const t = e.target as Node;
      if (!barRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        class="listen__speed tnum"
        aria-label={`Speed ${formatRate(rate)} — listening options`}
        title="Speed and listening options"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'listen-options' : undefined}
        onClick={() => setOpen(!open)}
      >
        <span>{formatRate(rate)}</span>
      </button>
      {open && (
        <div ref={menu} id="listen-options" class="listen__menu" role="dialog" aria-label="Listening options">
          <fieldset class="listen__field">
            <legend class="listen__lbl">Speed</legend>
            <div class="listen__seg">
              {rates.map((r) => (
                <label key={r}>
                  <input type="radio" name="listen-rate" value={r} checked={r === rate} onChange={() => setListenRate(r)} />
                  <span class="tnum">{formatRate(r)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label class="listen__cont">
            <span>
              Continue into the next chapter
              <small>Keep reading when this chapter ends</small>
            </span>
            <input type="checkbox" role="switch" checked={cont} onChange={(e) => setListenContinue((e.currentTarget as HTMLInputElement).checked)} />
          </label>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Placement                                                                 */
/* ------------------------------------------------------------------------ */

/** Height of a fixed element (toolbar) covering the bottom of the viewport, ignoring `bar`. */
function bottomObstacle(bar: HTMLElement): number {
  if (typeof document.elementsFromPoint !== 'function') return 0;
  const vh = window.innerHeight;
  const vw = document.documentElement.clientWidth;
  let top = vh;
  for (const x of [vw * 0.2, vw * 0.5, vw * 0.8]) {
    const hit = document.elementsFromPoint(x, vh - 3).find((el) => !bar.contains(el));
    if (!hit) continue;
    for (let n: Element | null = hit; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const r = n.getBoundingClientRect();
      if (r.bottom >= vh - 6 && r.height > 0 && r.height < vh * 0.3) top = Math.min(top, r.top);
      break;
    }
  }
  return Math.max(0, Math.round(vh - top));
}

/**
 * Docked (inside the shell's `.listen-dock`, which stacks it above the phone toolbar and publishes
 * --dock-h): just align with the reading column on wide screens. Floating (anywhere else): also keep
 * above a fixed bottom toolbar and publish the bar's top edge as --listen-top with
 * html.has-listen-float so the page can make room for it. <html> gets `has-listen` either way.
 */
function useBarLayout(ref: RefObject<HTMLElement>, visible: boolean): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!visible) return;
    const el = ref.current;
    if (!el) return;
    const docked = Boolean(el.parentElement?.closest('.listen-dock, .dock'));
    // data-* (not classes): Preact owns `class` and rewrites it on every status change.
    el.toggleAttribute('data-docked', docked);
    root.classList.add('has-listen');
    if (!docked) root.classList.add('has-listen-float');
    let raf = 0;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      raf = 0;
      const vw = root.clientWidth;
      const col = vw >= 720 ? document.getElementById('text') : null;
      const r = col?.getBoundingClientRect();
      if (r && r.width >= 320 && r.left >= 0 && r.right <= vw + 1) {
        el.style.setProperty('--listen-x', `${Math.round(r.left)}px`);
        el.style.setProperty('--listen-w', `${Math.round(r.width)}px`);
        el.setAttribute('data-aligned', '');
      } else {
        el.removeAttribute('data-aligned');
      }
      if (docked) return;
      const contract = getComputedStyle(root).getPropertyValue('--bottom-bar-h').trim();
      const auto = contract ? 0 : bottomObstacle(el);
      el.toggleAttribute('data-auto-bottom', auto > 0);
      el.style.setProperty('--listen-auto-bottom', `${auto}px`);
      const top = window.innerHeight - el.getBoundingClientRect().top;
      if (top > 0 && Number.isFinite(top)) root.style.setProperty('--listen-top', `${Math.round(top)}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onScroll = () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(schedule, 140);
    };
    apply();
    window.addEventListener('resize', schedule);
    if (!docked) window.addEventListener('scroll', onScroll, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    ro?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(scrollTimer);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', onScroll);
      window.visualViewport?.removeEventListener('resize', schedule);
      ro?.disconnect();
      root.classList.remove('has-listen', 'has-listen-float');
      root.style.removeProperty('--listen-top');
    };
  }, [visible]);
}
