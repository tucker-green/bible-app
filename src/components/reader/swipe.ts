/**
 * Swipe left / right on the reading area to change chapter (docs/EXPERIENCE.md §2.6): only with a
 * clear horizontal intent (≥ 64 px, < 25° from horizontal — classifySwipe), never while
 * scrubbing, selecting text, pinch-zoomed, with a sheet open, or from the screen edges (where the
 * browser's own back / forward swipe lives). An edge affordance ("John 2 →") fades in as the finger
 * travels. Settings → "Swipe to change chapter" (settings.swipeChapters) turns it off.
 *
 * Touch events (not pointer events) are used so the gesture is still seen when the browser starts
 * a vertical scroll; listeners are passive — nothing here ever blocks scrolling.
 */
import { panel, pinnedWord, searchOpen, settings, settingsOpen, verseSheet } from '../../app/state';
import { classifySwipe } from '../word/scrub';

export interface SwipeTarget {
  /** Label for the edge affordance, or null when there is no chapter that way. */
  label(dir: 'next' | 'prev'): string | null;
  go(dir: 'next' | 'prev'): void;
  /** A press-and-slide scrub is in progress. */
  busy(): boolean;
}

const EDGE_PX = 24;

/** Is the element (or an ancestor up to root) horizontally scrollable? */
function inHScroller(el: Element | null, root: Element): boolean {
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

export function attachSwipe(area: HTMLElement, target: SwipeTarget): () => void {
  let start: { x: number; y: number; t: number } | null = null;
  let dx = 0;
  let dy = 0;
  let hint: HTMLElement | null = null;

  const blocked = (): boolean => {
    if (!settings.value.swipeChapters) return true;
    if (target.busy()) return true;
    if (pinnedWord.value || verseSheet.value || panel.value || searchOpen.value || settingsOpen.value) return true;
    if ((window.visualViewport?.scale ?? 1) > 1.01) return true;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed) return true;
    return false;
  };

  const showHint = (dir: 'next' | 'prev', progress: number) => {
    const label = target.label(dir);
    if (!label) return hideHint();
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'swipe-hint';
      hint.setAttribute('aria-hidden', 'true');
      document.body.appendChild(hint);
    }
    const text = dir === 'next' ? `${label} →` : `← ${label}`;
    if (hint.textContent !== text) hint.textContent = text;
    hint.dataset.dir = dir;
    hint.classList.toggle('is-ready', progress >= 1);
    const p = Math.min(1, progress);
    const shift = (1 - p) * 24 * (dir === 'next' ? 1 : -1);
    hint.style.opacity = String(0.25 + p * 0.75);
    hint.style.transform = `translate3d(${shift}px, -50%, 0)`;
  };

  const hideHint = () => {
    if (!hint) return;
    hint.remove();
    hint = null;
  };

  const onStart = (e: TouchEvent) => {
    start = null;
    if (e.touches.length !== 1 || blocked()) return;
    const t = e.touches[0];
    const vw = document.documentElement.clientWidth;
    if (t.clientX < EDGE_PX || t.clientX > vw - EDGE_PX) return; // the browser's back / forward swipe
    if (inHScroller(e.target as Element, area)) return;
    start = { x: t.clientX, y: t.clientY, t: performance.now() };
    dx = 0;
    dy = 0;
  };

  const onMove = (e: TouchEvent) => {
    if (!start) return;
    if (e.touches.length !== 1 || target.busy()) {
      start = null;
      hideHint();
      return;
    }
    const t = e.touches[0];
    dx = t.clientX - start.x;
    dy = t.clientY - start.y;
    const dir = dx < 0 ? 'next' : 'prev';
    const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
    if (Math.abs(dx) > 16 && angle < 25) showHint(dir, Math.abs(dx) / 64);
    else hideHint();
  };

  const onEnd = () => {
    const s = start;
    start = null;
    hideHint();
    if (!s || blocked()) return;
    const dir = classifySwipe(dx, dy);
    if (dir && target.label(dir)) target.go(dir);
  };

  const onCancel = () => {
    start = null;
    hideHint();
  };

  area.addEventListener('touchstart', onStart, { passive: true });
  area.addEventListener('touchmove', onMove, { passive: true });
  area.addEventListener('touchend', onEnd, { passive: true });
  area.addEventListener('touchcancel', onCancel, { passive: true });
  return () => {
    area.removeEventListener('touchstart', onStart);
    area.removeEventListener('touchmove', onMove);
    area.removeEventListener('touchend', onEnd);
    area.removeEventListener('touchcancel', onCancel);
    hideHint();
  };
}
