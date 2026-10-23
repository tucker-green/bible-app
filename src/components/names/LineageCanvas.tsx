/**
 * The family-tree canvas: ancestors above, descendants below, brothers and sisters to the left and
 * partners to the right of the centred person (layout.ts), on a pan & zoom stage (camera.ts).
 *
 * - Tap / click a person: the tree re-centres on them (route #/lineage/{id}); the boxes glide from
 *   where they were to their new places (FLIP), instant under reduced motion. The centred person
 *   links to their page.
 * - Keyboard: one roving tab stop; ←/→ along a row, ↑ toward the ancestors, ↓ toward the
 *   descendants, Home = the centred person, Enter / Space re-centres, + / − zoom, 0 resets.
 *   The camera follows focus.
 * - Changing the depth keeps the camera; people already on screen slide to their new places.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { reducedMotion } from '../../app/state';
import type { Camera } from './camera';
import { fitRect, placeAt, revealRect, usePanZoom } from './camera';
import type { Move, PlacedNode, TreeLayout } from './layout';
import { DEFAULT_LAYOUT, moveFrom } from './layout';
import { entityHash, generationLabel, relationToFocus } from './model';

/** Screen centres of the people on the canvas when a re-centre starts (for the glide on the next page). */
export interface Handoff {
  to: string;
  scale: number;
  centres: Map<string, { x: number; y: number }>;
  /** Focus the new centre person after the switch (keyboard / click), else leave focus alone. */
  refocus: boolean;
}

const ZOOM_STEP = 1.25;

export function LineageCanvas({
  layout,
  title,
  handoff,
  onCentre,
}: {
  layout: TreeLayout;
  /** Accessible name of the tree group, e.g. "Family tree of Abraham". */
  title: string;
  handoff: Handoff | null;
  onCentre: (node: PlacedNode, h: Handoff) => void;
}) {
  const vpRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const [current, setCurrent] = useState(layout.focusKey);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef(0);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // generation labels sit in screen space at the left edge, following their rows vertically
  const rowsRef = useRef<HTMLDivElement>(null);
  const placeRows = (c: Camera) => {
    const box = rowsRef.current;
    if (!box) return;
    const h = box.clientHeight;
    box.querySelectorAll<HTMLElement>('[data-y]').forEach((el) => {
      // just above the row's boxes, in the gap where the connectors run (never over a name)
      const y = Number(el.dataset.y) * c.s + c.y - (Number(el.dataset.h) / 2) * c.s - el.offsetHeight - 3;
      el.style.transform = `translate3d(0, ${Math.round(y)}px, 0)`;
      el.style.visibility = c.s < 0.5 || y < -20 || y > h ? 'hidden' : '';
    });
  };

  const pad = 120;
  const pz = usePanZoom(vpRef, worldRef, {
    bounds: () => {
      const b = layoutRef.current.bounds;
      return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    },
    onChange: (c: Camera) => {
      if (zoomRef.current) zoomRef.current.textContent = `${Math.round(c.s * 100)}%`;
      placeRows(c);
    },
    onWheelHint: () => {
      setHint(true);
      window.clearTimeout(hintTimer.current);
      hintTimer.current = window.setTimeout(() => setHint(false), 1600);
    },
  });
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  const cur = layout.byKey.has(current) ? current : layout.focusKey;

  /* initial camera + arrival glide ------------------------------------------ */
  const prevLayout = useRef<TreeLayout | null>(null);
  useLayoutEffect(() => {
    const vp = vpRef.current;
    const world = worldRef.current;
    if (!vp || !world) return;
    const { w, h } = pz.size();
    const prev = prevLayout.current;
    prevLayout.current = layout;
    if (prev) {
      // depth changed: same camera, existing people slide to their new places
      const old = new Map<string, PlacedNode>();
      for (const n of prev.nodes) if (!old.has(n.id)) old.set(n.id, n);
      glide(world, (el) => {
        const n = layout.byKey.get(el.dataset.key ?? '');
        const o = n && old.get(n.id);
        return n && o ? { dx: o.x - n.x, dy: o.y - n.y } : null;
      });
      pz.set(pz.get());
      return;
    }
    const phone = w < 600;
    let cam: Camera;
    if (handoff) {
      cam = placeAt(0, 0, w / 2, h / 2, handoff.scale);
    } else {
      const fit = fitRect(layout.bounds, w, h, 28, 1);
      if (fit.s >= (phone ? 0.62 : 0.72)) cam = fit;
      else {
        // too big to fit: centre the person, zoomed so their parents and children are in view
        // (within reason — names must stay readable)
        let half = 0;
        for (const n of layout.nodes) if (Math.abs(n.gen) <= 1 && n.role !== 'partner' && n.role !== 'sibling') half = Math.max(half, Math.abs(n.x) + n.w / 2);
        const s = Math.max(phone ? 0.55 : 0.65, Math.min(phone ? 0.78 : 1, (w / 2 - 16) / Math.max(1, half)));
        const b = layout.bounds;
        const tall = (b.maxY - b.minY) * s > h - 56;
        cam = placeAt(0, tall ? 0 : (b.minY + b.maxY) / 2, w / 2, h / 2, s);
      }
    }
    pz.set(cam);
    if (handoff) {
      const vpr = vp.getBoundingClientRect();
      const s = cam.s;
      glide(world, (el) => {
        const id = el.dataset.id ?? '';
        const from = el.dataset.key === layout.focusKey ? handoff.centres.get(handoff.to) : handoff.centres.get(id);
        if (!from) return null;
        const r = el.getBoundingClientRect();
        return { dx: (from.x - (r.left + r.width / 2 - vpr.left)) / s, dy: (from.y - (r.top + r.height / 2 - vpr.top)) / s };
      });
      if (handoff.refocus) world.querySelector<HTMLElement>(`[data-key="${layout.focusKey}"]`)?.focus({ preventScroll: true });
    } else if (!reducedMotion()) {
      world.classList.add('is-arriving');
      window.setTimeout(() => world.classList.remove('is-arriving'), 900);
    }
  }, [layout]);

  // keep the camera in reach when the viewport changes size
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => pz.set(pz.get()));
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  /* actions ------------------------------------------------------------------ */
  const capture = (to: string, refocus: boolean): Handoff => {
    const centres = new Map<string, { x: number; y: number }>();
    const vp = vpRef.current!;
    const vpr = vp.getBoundingClientRect();
    worldRef.current?.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
      const id = el.dataset.id!;
      const r = el.getBoundingClientRect();
      const c = { x: r.left + r.width / 2 - vpr.left, y: r.top + r.height / 2 - vpr.top };
      // the box that was clicked wins over another appearance of the same person
      if (!centres.has(id) || el.dataset.key === currentClicked.current) centres.set(id, c);
    });
    return { to, scale: pz.get().s, centres, refocus };
  };
  const currentClicked = useRef('');
  const centreOn = (n: PlacedNode, viaKeyboard: boolean) => {
    if (n.key === layout.focusKey) return;
    currentClicked.current = n.key;
    onCentre(n, capture(n.id, viaKeyboard || document.activeElement?.closest('.lt-world') != null));
  };

  const reveal = (key: string) => {
    const el = worldRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`);
    const vp = vpRef.current;
    if (!el || !vp) return;
    const vpr = vp.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const { w, h } = pz.size();
    const next = revealRect(pz.get(), { left: r.left - vpr.left, top: r.top - vpr.top, right: r.right - vpr.left, bottom: r.bottom - vpr.top }, w, h, 40);
    if (next !== pz.get()) pz.set(next, true);
  };

  const focusKey = (key: string | undefined) => {
    if (!key) return;
    setCurrent(key);
    worldRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus({ preventScroll: true });
    reveal(key);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const moves: Record<string, Move> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home' };
    const t = e.target as HTMLElement;
    if (moves[e.key] && t.dataset.key) {
      e.preventDefault();
      focusKey(moveFrom(layout, t.dataset.key, moves[e.key]));
      return;
    }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      pz.zoomBy(ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      pz.zoomBy(1 / ZOOM_STEP);
    } else if (e.key === '0') {
      e.preventDefault();
      resetView();
    }
  };

  const resetView = () => {
    const { w, h } = pz.size();
    pz.set(placeAt(0, 0, w / 2, h / 2, w < 600 ? 0.78 : 1), true);
  };
  const fitView = () => {
    const { w, h } = pz.size();
    pz.set(fitRect(layout.bounds, w, h, 28, 1), true);
  };

  /* render ------------------------------------------------------------------- */
  const b = layout.bounds;
  const svgBox = { x: b.minX - 40, y: b.minY - 40, w: b.maxX - b.minX + 80, h: b.maxY - b.minY + 80 };
  const hintId = `${title.replace(/\W+/g, '-').toLowerCase()}-keys`;
  const focusNode = layout.byKey.get(layout.focusKey)!;
  const desc = useMemo(() => new Map(layout.nodes.map((n) => [n.key, describe(n, focusNode.name)])), [layout]);

  return (
    <div class="lt-stage">
      <div class="lt-viewport" ref={vpRef}>
        <div class="lt-world" ref={worldRef} role="group" aria-label={title} aria-describedby={hintId} onKeyDown={onKeyDown}>
          <svg class="lt-links" aria-hidden="true" style={{ left: `${svgBox.x}px`, top: `${svgBox.y}px`, width: `${svgBox.w}px`, height: `${svgBox.h}px` }} viewBox={`${svgBox.x} ${svgBox.y} ${svgBox.w} ${svgBox.h}`}>
            {layout.links.map((d, i) => (
              <path key={i} d={d} />
            ))}
            {layout.ties.map((d, i) => (
              <path key={`t${i}`} class="lt-tie" d={d} />
            ))}
          </svg>
          {layout.groups.map((g) => (
            <span key={g.text} class="lt-group" aria-hidden="true" style={{ left: `${g.x}px`, top: `${g.y}px` }}>
              {g.text}
            </span>
          ))}
          {layout.nodes.map((n) => (
            <Node
              key={n.key}
              n={n}
              current={n.key === cur}
              label={desc.get(n.key)!}
              onActivate={(viaKeyboard) => centreOn(n, viaKeyboard)}
              onFocus={() => {
                setCurrent(n.key);
                reveal(n.key);
              }}
            />
          ))}
        </div>
        <div class="lt-rows" ref={rowsRef} aria-hidden="true">
          {layout.rows.map((r) => (
            <span key={r.gen} class="lt-row" data-y={r.y} data-h={DEFAULT_LAYOUT.nodeH}>
              {generationLabel(r.gen)}
            </span>
          ))}
        </div>
        <div class="lt-tools" role="group" aria-label="Zoom">
          <button type="button" class="lt-tool" onClick={() => pz.zoomBy(ZOOM_STEP)} aria-label="Zoom in" title="Zoom in (+)">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5.5v13M5.5 12h13" />
            </svg>
          </button>
          <span class="lt-tool__pct" ref={zoomRef} aria-hidden="true">
            100%
          </span>
          <button type="button" class="lt-tool" onClick={() => pz.zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out" title="Zoom out (−)">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5.5 12h13" />
            </svg>
          </button>
          <button type="button" class="lt-tool" onClick={fitView} aria-label="Fit the whole tree" title="Fit the whole tree">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" />
            </svg>
          </button>
          <button type="button" class="lt-tool" onClick={resetView} aria-label={`Back to ${focusNode.name} at 100%`} title={`Back to ${focusNode.name} (0)`}>
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="6.5" />
              <circle cx="12" cy="12" r="1.6" />
              <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6" />
            </svg>
          </button>
        </div>
        <p class={`lt-wheel-hint${hint ? ' is-on' : ''}`} aria-hidden="true">
          Ctrl + scroll (⌘ + scroll on a Mac) or pinch to zoom
        </p>
      </div>
      <p class="lt-keys" id={hintId}>
        <span class="lt-keys__touch">Drag to move · pinch to zoom · tap a person to centre the tree on them.</span>
        <span class="lt-keys__mouse">Drag to move · Ctrl + scroll to zoom · click a person to centre the tree on them.</span>{' '}
        <span class="lt-keys__kbd">Arrow keys move between people, Enter centres, + and − zoom.</span>
      </p>
    </div>
  );
}

/**
 * What a screen reader hears besides the visible name and brief (the accessible name comes from the
 * content, so the visible text is always part of it): the relationship to the centred person, and
 * what lies beyond the edge of the tree.
 */
function describe(n: PlacedNode, focusName: string): { rel: string; extra: string } {
  const rel = n.role === 'focus' ? ', centred. ' : `, ${relationToFocus(n.gen, n.role)} of ${focusName}. `;
  const extra: string[] = [];
  if (n.moreParents) extra.push('more ancestors beyond this depth');
  if (n.moreChildren) extra.push('more descendants beyond this depth');
  if (n.repeat) extra.push('also shown elsewhere in this tree');
  if (n.role === 'focus') extra.push(`opens the page about ${n.name}`);
  return { rel, extra: extra.length ? `. ${extra.join('; ')}.` : '' };
}

function Node({
  n,
  current,
  label,
  onActivate,
  onFocus,
}: {
  n: PlacedNode;
  current: boolean;
  label: { rel: string; extra: string };
  onActivate: (viaKeyboard: boolean) => void;
  onFocus: () => void;
}) {
  const cls = `lt-node is-${n.role}${n.repeat ? ' is-repeat' : ''}${n.name === 'Unnamed' ? ' is-unnamed' : ''}`;
  const style = {
    left: `${n.x - n.w / 2}px`,
    top: `${n.y - n.h / 2}px`,
    width: `${n.w}px`,
    height: `${n.h}px`,
    '--d': String(Math.abs(n.gen) + (n.role === 'partner' || n.role === 'sibling' ? 1 : 0)),
  };
  const body = (
    <>
      <span class="lt-node__name">{n.name}</span>
      <span class="sr-only">{label.rel}</span>
      {n.brief && <span class="lt-node__brief">{n.brief}</span>}
      {n.partnerNames.length > 0 && <span class="lt-node__m">m. {n.partnerNames.join(', ')}</span>}
      {label.extra && <span class="sr-only">{label.extra}</span>}
      {n.moreParents && (
        <span class="lt-more lt-more--up" aria-hidden="true" title="More ancestors">
          <svg class="icon" viewBox="0 0 24 24">
            <path d="M7 14l5-5 5 5" />
          </svg>
        </span>
      )}
      {n.moreChildren && (
        <span class="lt-more lt-more--down" aria-hidden="true" title="More descendants">
          <svg class="icon" viewBox="0 0 24 24">
            <path d="M7 10l5 5 5-5" />
          </svg>
        </span>
      )}
    </>
  );
  if (n.role === 'focus') {
    return (
      <a class={cls} style={style} href={entityHash(n.id, 'person')} data-key={n.key} data-id={n.id} tabIndex={current ? 0 : -1} onFocus={onFocus}>
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      class={cls}
      style={style}
      data-key={n.key}
      data-id={n.id}
      tabIndex={current ? 0 : -1}
      onFocus={onFocus}
      onClick={(e) => onActivate((e as MouseEvent).detail === 0)}
    >
      {body}
    </button>
  );
}

/** FLIP: move each element by the offset `from` returns (world px), then let it glide back to its place. */
function glide(world: HTMLElement, from: (el: HTMLElement) => { dx: number; dy: number } | null): void {
  if (reducedMotion()) return;
  const moved: HTMLElement[] = [];
  world.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
    const d = from(el);
    if (!d) {
      el.classList.add('is-new');
      return;
    }
    if (Math.abs(d.dx) < 0.5 && Math.abs(d.dy) < 0.5) return;
    el.style.transition = 'none';
    el.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
    moved.push(el);
  });
  world.classList.add('is-gliding-in');
  void world.offsetWidth; // commit the start positions
  for (const el of moved) {
    el.style.transition = '';
    el.style.transform = '';
  }
  window.setTimeout(() => {
    world.classList.remove('is-gliding-in');
    world.querySelectorAll('.is-new').forEach((el) => el.classList.remove('is-new'));
  }, 700);
}
