/**
 * Pan & zoom for the lineage canvas: pure camera maths (unit-tested) and usePanZoom(), which wires
 * pointer, touch and wheel input to a transformed "world" element without re-rendering Preact.
 *
 * Input model (docs/EXPERIENCE.md §2, §4):
 *  - drag (mouse, pen, one finger) pans; a drag never turns into a click on the person under it;
 *  - two-finger pinch zooms around the fingers' midpoint (and pans with them);
 *  - trackpad pinch / Ctrl (⌘) + wheel zooms at the cursor; a horizontal swipe pans sideways;
 *    a plain vertical wheel keeps scrolling the page (onWheelHint lets the canvas say how to zoom);
 *  - programmatic moves (centre on a person, fit, zoom buttons) glide over --dur-3, or jump under
 *    reduced motion.
 */
import { useEffect, useRef } from 'preact/hooks';
import { reducedMotion } from '../../app/state';

export interface Camera {
  /** Screen offset of the world origin, px from the viewport's top-left. */
  x: number;
  y: number;
  /** Scale (1 = 100%). */
  s: number;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Zoom by `factor` keeping the world point under screen point (px, py) fixed. */
export function zoomAt(c: Camera, factor: number, px: number, py: number): Camera {
  const s = clampScale(c.s * factor);
  const k = s / c.s;
  return { s, x: px - (px - c.x) * k, y: py - (py - c.y) * k };
}

/** Camera that puts world point (wx, wy) at screen point (px, py) at scale s. */
export function placeAt(wx: number, wy: number, px: number, py: number, s: number): Camera {
  return { s, x: px - wx * s, y: py - wy * s };
}

/** Scale and position that show all of `r` inside a vw × vh viewport with `pad` px around it. */
export function fitRect(r: Rect, vw: number, vh: number, pad = 24, maxScale = 1): Camera {
  const w = Math.max(1, r.maxX - r.minX);
  const h = Math.max(1, r.maxY - r.minY);
  const s = clampScale(Math.min(maxScale, (vw - 2 * pad) / w, (vh - 2 * pad) / h));
  return placeAt((r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2, vw / 2, vh / 2, s);
}

/**
 * Keep the world in reach: at least `keep` px of the bounds stay inside the viewport on each axis,
 * so the tree can't be flung out of sight.
 */
export function clampCamera(c: Camera, r: Rect, vw: number, vh: number, keep = 96): Camera {
  const left = r.minX * c.s + c.x;
  const right = r.maxX * c.s + c.x;
  const top = r.minY * c.s + c.y;
  const bottom = r.maxY * c.s + c.y;
  let { x, y } = c;
  const kx = Math.min(keep, (right - left) / 2);
  const ky = Math.min(keep, (bottom - top) / 2);
  if (right < kx) x += kx - right;
  if (left > vw - kx) x -= left - (vw - kx);
  if (bottom < ky) y += ky - bottom;
  if (top > vh - ky) y -= top - (vh - ky);
  return { s: c.s, x, y };
}

/** Pan so that the screen rect (left, top, right, bottom) is inside the viewport with `pad`; same camera if it already is. */
export function revealRect(c: Camera, sr: { left: number; top: number; right: number; bottom: number }, vw: number, vh: number, pad = 32): Camera {
  let dx = 0;
  let dy = 0;
  if (sr.right - sr.left > vw - 2 * pad) dx = vw / 2 - (sr.left + sr.right) / 2;
  else if (sr.left < pad) dx = pad - sr.left;
  else if (sr.right > vw - pad) dx = vw - pad - sr.right;
  if (sr.bottom - sr.top > vh - 2 * pad) dy = vh / 2 - (sr.top + sr.bottom) / 2;
  else if (sr.top < pad) dy = pad - sr.top;
  else if (sr.bottom > vh - pad) dy = vh - pad - sr.bottom;
  return dx || dy ? { s: c.s, x: c.x + dx, y: c.y + dy } : c;
}

/** Wheel delta in px (line / page modes normalised). */
export function wheelPx(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>, pageH = 800): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageH : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

/* ------------------------------------------------------------------------ */
/* Hook                                                                      */
/* ------------------------------------------------------------------------ */

export interface PanZoomApi {
  get(): Camera;
  set(c: Camera, animate?: boolean): void;
  zoomBy(factor: number, animate?: boolean): void;
  /** Viewport size in px. */
  size(): { w: number; h: number };
  /** True right after a drag, so the click that ends it can be ignored. */
  justDragged(): boolean;
}

export interface PanZoomOptions {
  /** World bounds for clamping (read on every move). */
  bounds: () => Rect;
  /** Called after every camera change (e.g. to update the zoom read-out). */
  onChange?: (c: Camera) => void;
  /** A plain vertical wheel over the canvas (the page scrolls): show "Ctrl + scroll to zoom". */
  onWheelHint?: () => void;
}

const DRAG_SLOP = 6;

export function usePanZoom(
  viewport: { current: HTMLElement | null },
  world: { current: HTMLElement | null },
  opts: PanZoomOptions,
): PanZoomApi {
  const cam = useRef<Camera>({ x: 0, y: 0, s: 1 });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const dragged = useRef(0);
  const animTimer = useRef(0);

  const apply = (c: Camera, animate = false) => {
    const vp = viewport.current;
    const el = world.current;
    if (!el || !vp) {
      cam.current = c;
      return;
    }
    const clamped = clampCamera(c, optsRef.current.bounds(), vp.clientWidth, vp.clientHeight);
    cam.current = clamped;
    const glide = animate && !reducedMotion();
    el.classList.toggle('is-gliding', glide);
    window.clearTimeout(animTimer.current);
    if (glide) animTimer.current = window.setTimeout(() => el.classList.remove('is-gliding'), 420);
    el.style.transform = `translate3d(${clamped.x}px, ${clamped.y}px, 0) scale(${clamped.s})`;
    optsRef.current.onChange?.(clamped);
  };

  const api = useRef<PanZoomApi>({
    get: () => cam.current,
    set: (c, animate) => apply(c, animate),
    zoomBy: (factor, animate = true) => {
      const vp = viewport.current;
      if (!vp) return;
      apply(zoomAt(cam.current, factor, vp.clientWidth / 2, vp.clientHeight / 2), animate);
    },
    size: () => ({ w: viewport.current?.clientWidth ?? 0, h: viewport.current?.clientHeight ?? 0 }),
    justDragged: () => performance.now() - dragged.current < 350,
  }).current;

  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { cam: Camera; x: number; y: number; d: number; mx: number; my: number } | null = null;
    let moving = false;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = vp.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const begin = () => {
      const list = [...pts.values()];
      const a = list[0];
      const b = list[1] ?? a;
      start = {
        cam: cam.current,
        x: a.x,
        y: a.y,
        d: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pts.set(e.pointerId, local(e));
      if (pts.size > 2) return;
      begin();
      if (pts.size === 2) {
        moving = true;
        try {
          vp.setPointerCapture(e.pointerId);
        } catch {
          /* pointer already gone */
        }
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, local(e));
      const list = [...pts.values()];
      if (list.length >= 2) {
        const [a, b] = list;
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const s = clampScale((start.cam.s * d) / start.d);
        // the world point that was under the start midpoint follows the fingers
        const wx = (start.mx - start.cam.x) / start.cam.s;
        const wy = (start.my - start.cam.y) / start.cam.s;
        apply({ s, x: mx - wx * s, y: my - wy * s });
        moving = true;
        return;
      }
      const p = list[0];
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!moving && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!moving) {
        moving = true;
        try {
          vp.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        vp.classList.add('is-dragging');
      }
      apply({ s: start.cam.s, x: start.cam.x + dx, y: start.cam.y + dy });
    };
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (moving) dragged.current = performance.now();
      if (pts.size) {
        begin(); // pinch -> one finger: keep panning from here
        return;
      }
      moving = false;
      start = null;
      vp.classList.remove('is-dragging');
    };
    // a drag that ends over a person must not re-centre on them
    const click = (e: MouseEvent) => {
      if (api.justDragged()) {
        e.preventDefault();
        e.stopPropagation();
        dragged.current = 0;
      }
    };
    const wheel = (e: WheelEvent) => {
      const { dx, dy } = wheelPx(e, vp.clientHeight);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const p = local(e);
        apply(zoomAt(cam.current, Math.exp(-dy * 0.0025), p.x, p.y));
        return;
      }
      if (Math.abs(dx) > Math.abs(dy) || e.shiftKey) {
        e.preventDefault();
        const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        apply({ ...cam.current, x: cam.current.x - d });
        return;
      }
      optsRef.current.onWheelHint?.();
    };
    // Safari trackpad pinch
    let gestureStart = 1;
    const gStart = (e: Event) => {
      e.preventDefault();
      gestureStart = cam.current.s;
    };
    const gChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const p = local(ge);
      const target = clampScale(gestureStart * ge.scale);
      apply(zoomAt(cam.current, target / cam.current.s, p.x, p.y));
    };

    vp.addEventListener('pointerdown', down);
    vp.addEventListener('pointermove', move);
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);
    // capture moving from a child (touch's implicit capture) to the viewport is not a release
    const lost = (e: PointerEvent) => {
      if (e.target === vp) up(e);
    };
    vp.addEventListener('lostpointercapture', lost);
    vp.addEventListener('click', click, true);
    vp.addEventListener('wheel', wheel, { passive: false });
    vp.addEventListener('gesturestart', gStart);
    vp.addEventListener('gesturechange', gChange);
    return () => {
      vp.removeEventListener('pointerdown', down);
      vp.removeEventListener('pointermove', move);
      vp.removeEventListener('pointerup', up);
      vp.removeEventListener('pointercancel', up);
      vp.removeEventListener('lostpointercapture', lost);
      vp.removeEventListener('click', click, true);
      vp.removeEventListener('wheel', wheel);
      vp.removeEventListener('gesturestart', gStart);
      vp.removeEventListener('gesturechange', gChange);
      window.clearTimeout(animTimer.current);
    };
  }, []);

  return api;
}
