/**
 * Shell behaviours that live on <html> rather than in any one component (docs/EXPERIENCE.md §1):
 *
 *  - compact chrome auto-hide: on phones (and phone landscape) the top bar — and in landscape the
 *    toolbar — slide away while reading down the page and come back on scroll up, at the top, at
 *    the end of the chapter, or when anything in them gets keyboard focus. (state.chromeHidden →
 *    <html data-chrome="hidden">.)
 *  - on-screen keyboard: the VisualViewport API sets --vv-h (visible height), --kb-h (keyboard
 *    overlap) and <html data-keyboard="open">, so sheets / search results can stay above the
 *    keyboard without the layout jumping (the viewport meta uses interactive-widget=resizes-visual).
 *  - the bottom dock (listen bar + phone toolbar) publishes its height as --dock-h so content,
 *    toasts and sheets can keep clear of it.
 *  - primeFeedback() on the first user gesture.
 */
import { effect } from '@preact/signals';
import { chromeHidden, panel, searchOpen, settingsOpen } from '../../app/state';
import { primeFeedback } from '../../lib/feedback';

/** Layouts with the compact top bar (phones) or auto-hiding chrome (phone landscape). */
export const COMPACT_QUERY = '(max-width: 599.98px), (max-height: 500px) and (pointer: coarse)';

/**
 * Decide the chrome state for a scroll step (pure, unit-tested).
 * `acc` accumulates movement in one direction so small jitters do not toggle the bar.
 */
export function chromeStep(
  s: { hidden: boolean; acc: number },
  y: number,
  dy: number,
  opts: { top: number; nearEnd: boolean; threshold?: number },
): { hidden: boolean; acc: number } {
  const threshold = opts.threshold ?? 24;
  if (y <= opts.top || opts.nearEnd) return { hidden: false, acc: 0 };
  if (dy > 0) {
    const acc = Math.max(0, s.acc) + dy;
    return { hidden: acc > threshold ? true : s.hidden, acc };
  }
  if (dy < 0) {
    const acc = Math.min(0, s.acc) + dy;
    return { hidden: acc < -threshold ? false : s.hidden, acc };
  }
  return s;
}

function startAutoHide(): () => void {
  const compact = matchMedia(COMPACT_QUERY);
  let lastY = window.scrollY;
  let st = { hidden: false, acc: 0 };
  let raf = 0;
  const blocked = () => Boolean(panel.value || searchOpen.value || settingsOpen.value);
  const apply = () => {
    raf = 0;
    const y = window.scrollY;
    const dy = y - lastY;
    lastY = y;
    if (!compact.matches || blocked()) {
      st = { hidden: false, acc: 0 };
    } else {
      const nearEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 48;
      st = chromeStep(st, y, dy, { top: 56, nearEnd });
    }
    if (chromeHidden.peek() !== st.hidden) chromeHidden.value = st.hidden;
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const reveal = (e: FocusEvent) => {
    const t = e.target;
    if (t instanceof Element && t.closest('.masthead, .toolbar, .listen-dock')) {
      st = { hidden: false, acc: 0 };
      chromeHidden.value = false;
    }
  };
  const onMq = () => apply();
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('focusin', reveal);
  compact.addEventListener('change', onMq);
  // Opening a panel / search always brings the bars back.
  const stop = effect(() => {
    if (panel.value || searchOpen.value || settingsOpen.value) {
      st = { hidden: false, acc: 0 };
      chromeHidden.value = false;
    }
  });
  return () => {
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('focusin', reveal);
    compact.removeEventListener('change', onMq);
    cancelAnimationFrame(raf);
    stop();
  };
}

function startVisualViewport(): () => void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return () => undefined;
  const on = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
    root.style.setProperty('--kb-h', `${kb}px`);
    // A keyboard is "open" when it eats a good part of the screen while a text field has focus.
    const typing = document.activeElement instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    root.dataset.keyboard = kb > 120 && typing ? 'open' : 'closed';
  };
  on();
  vv.addEventListener('resize', on);
  vv.addEventListener('scroll', on);
  document.addEventListener('focusin', on);
  document.addEventListener('focusout', on);
  return () => {
    vv.removeEventListener('resize', on);
    vv.removeEventListener('scroll', on);
    document.removeEventListener('focusin', on);
    document.removeEventListener('focusout', on);
  };
}

/** Publish the bottom dock's height as --dock-h on <html>. */
export function observeDock(el: HTMLElement): () => void {
  const root = document.documentElement;
  const set = () => root.style.setProperty('--dock-h', `${Math.round(el.getBoundingClientRect().height)}px`);
  set();
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const ro = new ResizeObserver(set);
  ro.observe(el);
  return () => ro.disconnect();
}

function startPrime(): () => void {
  const once = () => {
    primeFeedback();
    document.removeEventListener('pointerdown', once, true);
    document.removeEventListener('keydown', once, true);
  };
  document.addEventListener('pointerdown', once, true);
  document.addEventListener('keydown', once, true);
  return () => {
    document.removeEventListener('pointerdown', once, true);
    document.removeEventListener('keydown', once, true);
  };
}

/** Start every shell behaviour; returns a stop function. Called once by the App shell. */
export function startChrome(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const stops = [startAutoHide(), startVisualViewport(), startPrime()];
  return () => stops.forEach((s) => s());
}
