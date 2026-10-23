/**
 * Bottom-sheet physics shared by the word card and the verse sheet (docs/EXPERIENCE.md §2.4, §5):
 *
 *  - detents: peek (≈45% of the viewport, or the content height when shorter), full (the sheet's
 *    max-height, ~90%) and closed; the sheet is positioned with transform only.
 *  - the drag follows the finger 1:1 (rubber-banding above full); on release the velocity is
 *    projected forward and the sheet springs to the chosen detent (critically-damped-ish spring),
 *    or jumps there under reduced motion.
 *  - inner scroll handoff: at peek any vertical drag moves the sheet; at full the content scrolls
 *    natively, and dragging down from scrollTop = 0 moves the sheet again.
 *  - mouse / pen: drag the handle; a click on the handle toggles peek ↔ full.
 *  - keyboard focus moving below the fold expands the sheet to full.
 *  - Android back / browser back closes it (useBackClose), Esc is handled by the component.
 *
 * The pure helpers (pickDetent, springStep) are unit-tested.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { reducedMotion } from '../../app/state';

export type Detent = 'peek' | 'full' | 'closed';

export interface DetentOffsets {
  full: number;
  peek: number;
  closed: number;
}

/**
 * Choose where a released sheet goes (pure). `offset` = current translateY (0 = full), `v` = velocity
 * in px/ms (positive = downwards). A fling (|v| ≥ 0.5) moves one detent in its direction; otherwise
 * the detent nearest to the projected position wins.
 */
export function pickDetent(offset: number, v: number, d: DetentOffsets): Detent {
  const order: [Detent, number][] = [
    ['full', d.full],
    ['peek', d.peek],
    ['closed', d.closed],
  ];
  // Collapse peek into full when the content is no taller than the peek height.
  const list = d.peek <= d.full + 1 ? order.filter(([n]) => n !== 'peek') : order;
  if (Math.abs(v) >= 0.5) {
    if (v > 0) return list.find(([, o]) => o > offset + 1)?.[0] ?? 'closed';
    const up = [...list].reverse().find(([, o]) => o < offset - 1);
    return up?.[0] ?? 'full';
  }
  const projected = offset + v * 180;
  let best: Detent = list[0][0];
  let dist = Infinity;
  for (const [n, o] of list) {
    const dd = Math.abs(projected - o);
    if (dd < dist) {
      dist = dd;
      best = n;
    }
  }
  return best;
}

/** One integration step of a damped spring (pure). x/target in px, v in px/s, dt in s. */
export function springStep(x: number, v: number, target: number, dt: number, stiffness = 520, damping = 0.92): { x: number; v: number } {
  const c = 2 * Math.sqrt(stiffness) * damping;
  const a = -stiffness * (x - target) - c * v;
  const nv = v + a * dt;
  return { x: x + nv * dt, v: nv };
}

export interface SheetOptions {
  open: boolean;
  onClose: () => void;
  /** Visible height at peek, as a fraction of the viewport height. Default .45 */
  peek?: number;
  /** Detent when opened. Default 'peek'. */
  initial?: 'peek' | 'full';
  /** The element whose scrolling hands off to the drag (default: the sheet itself). */
  scroller?: () => HTMLElement | null;
  /** Is the sheet form active at all (the word card is a popover on desktop). Default true. */
  enabled?: boolean;
}

export interface SheetApi {
  detent: Detent;
  setDetent: (d: 'peek' | 'full') => void;
  /** Animate closed, then call onClose. */
  close: () => void;
  /** Viewport y of the sheet's top edge at its resting detent. */
  restingTop: () => number;
  /** Pointer handlers for the drag handle (mouse / pen / touch). */
  handleProps: {
    onPointerDown: (e: PointerEvent) => void;
  };
}

/** Viewport height used for detents (the visual viewport when the keyboard is up). */
function viewportH(): number {
  return Math.round(window.visualViewport?.height ?? window.innerHeight);
}

export function useSheet(ref: { current: HTMLElement | null }, opts: SheetOptions): SheetApi {
  const enabled = opts.enabled !== false;
  const [detent, setDetentState] = useState<Detent>(opts.initial ?? 'peek');
  const st = useRef({
    offset: 0,
    raf: 0,
    detent: (opts.initial ?? 'peek') as Detent,
    closing: false,
    onClose: opts.onClose,
    peek: opts.peek ?? 0.45,
  });
  st.current.onClose = opts.onClose;
  st.current.peek = opts.peek ?? 0.45;

  const offsets = (): DetentOffsets => {
    const el = ref.current;
    const h = el ? el.offsetHeight : 0;
    const peekPx = Math.round(viewportH() * st.current.peek);
    return { full: 0, peek: Math.max(0, h - peekPx), closed: h + 24 };
  };

  const apply = (y: number) => {
    const el = ref.current;
    st.current.offset = y;
    if (!el) return;
    el.style.transform = `translate3d(0, ${Math.round(y * 10) / 10}px, 0)`;
    const visible = Math.max(0, el.offsetHeight - y);
    document.documentElement.style.setProperty('--sheet-visible', `${Math.round(visible)}px`);
  };

  const stop = () => {
    cancelAnimationFrame(st.current.raf);
    st.current.raf = 0;
  };

  const animateTo = (target: Detent, v0 = 0, done?: () => void) => {
    stop();
    const s = st.current;
    s.detent = target;
    if (target !== 'closed') setDetentState(target);
    if (reducedMotion()) {
      apply(offsets()[target]);
      done?.();
      return;
    }
    let x = s.offset;
    let v = v0 * 1000; // px/ms -> px/s
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
      last = now;
      // the target follows the content height (e.g. the definition arriving mid-animation)
      const to = offsets()[target];
      // closing is quicker and never overshoots back into view
      const r = springStep(x, v, to, dt, target === 'closed' ? 700 : 520, target === 'closed' ? 1 : 0.86);
      x = r.x;
      v = r.v;
      if (target === 'closed' && x > to) x = to;
      if (Math.abs(x - to) < 0.5 && Math.abs(v) < 20) {
        apply(to);
        s.raf = 0;
        done?.();
        return;
      }
      apply(x);
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  };

  const close = () => {
    const s = st.current;
    if (s.closing) return;
    s.closing = true;
    animateTo('closed', 0, () => {
      s.closing = false;
      s.onClose();
    });
  };

  // Open: start below the screen and spring up to the initial detent.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!opts.open || !enabled || !el) return;
    st.current.closing = false;
    const o = offsets();
    apply(o.closed);
    animateTo(opts.initial ?? 'peek');
    return stop;
  }, [opts.open, enabled]);

  // Content height changes (definition loads, word swaps): keep the current detent's visible height.
  useEffect(() => {
    const el = ref.current;
    if (!opts.open || !enabled || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const s = st.current;
      if (s.raf || s.closing || dragging.current) return;
      apply(offsets()[s.detent === 'closed' ? 'peek' : s.detent]);
    });
    ro.observe(el);
    const onResize = () => {
      const s = st.current;
      if (!s.raf && !s.closing) apply(offsets()[s.detent === 'closed' ? 'peek' : s.detent]);
    };
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [opts.open, enabled]);

  // Touch drag with inner-scroll handoff (touch events: preventDefault must be possible).
  const dragging = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!opts.open || !enabled || !el) return;
    let y0 = 0;
    let x0 = 0;
    let start = 0;
    let lastY = 0;
    let mode: 'none' | 'drag' | 'scroll' | null = null;
    let samples: [number, number][] = [];
    const scroller = () => opts.scroller?.() ?? el;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        mode = 'none';
        return;
      }
      const t = e.touches[0];
      y0 = lastY = t.clientY;
      x0 = t.clientX;
      start = st.current.offset;
      mode = null;
      samples = [[performance.now(), t.clientY]];
    };
    const onMove = (e: TouchEvent) => {
      if (mode === 'none' || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dy = t.clientY - y0;
      const dx = t.clientX - x0;
      const sc = scroller();
      if (mode === null) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        if (Math.abs(dx) > Math.abs(dy)) mode = 'none';
        else if (st.current.detent === 'full' && (dy < 0 || sc.scrollTop > 0)) mode = 'scroll';
        else mode = 'drag';
        if (mode === 'drag') {
          stop();
          dragging.current = true;
          y0 = t.clientY;
          start = st.current.offset;
        }
      } else if (mode === 'scroll' && sc.scrollTop <= 0 && t.clientY > lastY) {
        // scrolled back to the top and still pulling down: the sheet takes over
        mode = 'drag';
        stop();
        dragging.current = true;
        y0 = t.clientY;
        start = st.current.offset;
      }
      lastY = t.clientY;
      if (mode !== 'drag') return;
      if (e.cancelable) e.preventDefault();
      const raw = start + (t.clientY - y0);
      apply(raw < 0 ? raw * 0.25 : raw);
      samples.push([performance.now(), t.clientY]);
      if (samples.length > 6) samples.shift();
    };
    const onEnd = () => {
      if (mode !== 'drag') {
        mode = null;
        return;
      }
      mode = null;
      dragging.current = false;
      const now = performance.now();
      const recent = samples.filter(([ts]) => now - ts < 100);
      const a = recent[0] ?? samples[0];
      const b = recent[recent.length - 1] ?? samples[samples.length - 1];
      const v = a && b && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
      const target = pickDetent(st.current.offset, v, offsets());
      if (target === 'closed') {
        st.current.closing = true;
        animateTo('closed', v, () => {
          st.current.closing = false;
          st.current.onClose();
        });
      } else animateTo(target, v);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    // Keyboard focus below the fold: expand.
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t === el || st.current.detent === 'full') return;
      const r = t.getBoundingClientRect();
      if (r.bottom > viewportH() - 4) animateTo('full');
    };
    el.addEventListener('focusin', onFocus);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('focusin', onFocus);
    };
  }, [opts.open, enabled]);

  useEffect(
    () => () => {
      stop();
      document.documentElement.style.removeProperty('--sheet-visible');
    },
    [],
  );

  // Mouse / pen (and touch, via pointer capture) on the handle.
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return; // touch is handled by the touch listeners above
    if (e.button !== 0) return;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    stop();
    dragging.current = true;
    const y0 = e.clientY;
    const start = st.current.offset;
    let moved = false;
    let samples: [number, number][] = [[performance.now(), e.clientY]];
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      if (Math.abs(dy) > 3) moved = true;
      const raw = start + dy;
      apply(raw < 0 ? raw * 0.25 : raw);
      samples.push([performance.now(), ev.clientY]);
      if (samples.length > 6) samples = samples.slice(-6);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      dragging.current = false;
      if (!moved) {
        animateTo(st.current.detent === 'full' ? 'peek' : 'full');
        return;
      }
      const a = samples[0];
      const b = samples[samples.length - 1];
      const v = b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
      const target = pickDetent(st.current.offset, v, offsets());
      if (target === 'closed') close();
      else animateTo(target, v);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  return {
    detent,
    setDetent: (d) => animateTo(d),
    close,
    restingTop: () => {
      const el = ref.current;
      if (!el) return window.innerHeight;
      const o = offsets()[st.current.detent === 'closed' ? 'peek' : st.current.detent];
      return window.innerHeight - Math.max(0, el.offsetHeight - o);
    },
    handleProps: { onPointerDown },
  };
}

/* One shared history entry for all open sheets, so closing one and opening another in the same
   tick (word sheet → verse sheet) never fights over history.back(). */
const backClosers = new Set<() => void>();
let backMarker: string | null = null;
let backListening = false;

function onBackPop(): void {
  if (!backMarker) return;
  if ((window.history.state as { rwSheet?: string } | null)?.rwSheet === backMarker) return;
  backMarker = null;
  [...backClosers].forEach((c) => c());
}

/**
 * Close an open sheet / dialog with the browser's (Android) back button: while any sheet is open
 * there is one extra history entry (same URL, so the hash router ignores it); back closes the open
 * sheets. Closing in-app removes the entry again.
 */
export function useBackClose(open: boolean, onClose: () => void): void {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const closer = () => cb.current();
    backClosers.add(closer);
    if (!backListening) {
      window.addEventListener('popstate', onBackPop);
      backListening = true;
    }
    if (!backMarker) {
      backMarker = `s${Date.now().toString(36)}`;
      window.history.pushState({ ...(window.history.state ?? {}), rwSheet: backMarker }, '');
    }
    return () => {
      backClosers.delete(closer);
      setTimeout(() => {
        if (backClosers.size || !backMarker) return;
        const m = backMarker;
        backMarker = null;
        if ((window.history.state as { rwSheet?: string } | null)?.rwSheet === m) window.history.back();
      }, 0);
    };
  }, [open]);
}

let sheetHolds = 0;
/**
 * While a bottom sheet is open, <html class="has-sheet"> lets the page reserve room under the text
 * (so the last lines can scroll above the sheet) and moves toasts above it. Ref-counted, so one
 * sheet closing while another opens never drops the class.
 */
export function useSheetClass(open: boolean): void {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    sheetHolds++;
    document.documentElement.classList.add('has-sheet');
    return () => {
      sheetHolds = Math.max(0, sheetHolds - 1);
      if (!sheetHolds) document.documentElement.classList.remove('has-sheet');
    };
  }, [open]);
}
