/**
 * Family-tree layout for the lineage explorer (pure, DOM-free; tests/ui/names-layout.test.ts).
 *
 * World coordinates: the focus person's box is centred at (0, 0); ancestors are laid out upward
 * (negative y) as a tidy tree over the focus, descendants downward. Brothers and sisters stand to
 * the left of the focus on its row, partners to the right (joined by a double rule).
 *
 * Subtrees are packed with contours (each subtree's leftmost / rightmost edge per depth), so a
 * family only takes the width it needs; a parent is centred over its first and last child.
 */
import type { LineageNode } from '../../lib/names';

export type NodeRole = 'focus' | 'ancestor' | 'descendant' | 'partner' | 'sibling';

export interface PlacedNode {
  /** Unique within the layout (a person can appear twice: cousin marriages, repeated lines). */
  key: string;
  id: string;
  name: string;
  brief: string;
  gen: number;
  role: NodeRole;
  /** Centre and size, world units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The node this one hangs from, toward the focus (undefined for focus / partners / siblings). */
  via?: string;
  /** Next nodes away from the focus (parents for ancestors, children for descendants). */
  next: string[];
  moreParents: boolean;
  moreChildren: boolean;
  repeat: boolean;
  /** Descendants: partner names ("m. Bathsheba"). */
  partnerNames: string[];
}

export interface RowLabel {
  gen: number;
  y: number;
}

export interface GroupLabel {
  text: string;
  x: number;
  y: number;
  align: 'start' | 'end';
}

export interface TreeLayout {
  nodes: PlacedNode[];
  byKey: Map<string, PlacedNode>;
  /** SVG path data for parent–child connectors (one string per family). */
  links: string[];
  /** SVG path data for the partner double rule and the sibling bracket. */
  ties: string[];
  rows: RowLabel[];
  groups: GroupLabel[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  focusKey: string;
}

export interface LayoutOptions {
  nodeW: number;
  nodeH: number;
  focusW: number;
  focusH: number;
  /** Space between rows (room for the connectors). */
  rowGap: number;
  /** Space between neighbouring boxes on a row. */
  gap: number;
  /** Extra space between the focus and its siblings / partners. */
  groupGap: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  nodeW: 164,
  nodeH: 66,
  focusW: 204,
  focusH: 84,
  rowGap: 60,
  gap: 16,
  groupGap: 40,
};

/** Centre y of a generation's row. */
export function rowY(gen: number, o: LayoutOptions = DEFAULT_LAYOUT): number {
  if (gen === 0) return 0;
  const first = o.focusH / 2 + o.rowGap + o.nodeH / 2;
  const d = first + (Math.abs(gen) - 1) * (o.nodeH + o.rowGap);
  return gen < 0 ? -d : d;
}

interface Sub {
  /** Node positions relative to the subtree root's centre x. */
  items: { n: LineageNode; dx: number; path: string; via?: string }[];
  /** Per depth below the root: leftmost and rightmost edge relative to the root centre. */
  left: number[];
  right: number[];
}

/** Lay out one direction of the tree (kids = parents upward, children downward). */
function layoutSub(n: LineageNode, kids: (n: LineageNode) => LineageNode[], width: (n: LineageNode) => number, gap: number, path: string, via?: string): Sub {
  const w = width(n);
  const children = kids(n);
  if (!children.length) return { items: [{ n, dx: 0, path, via }], left: [-w / 2], right: [w / 2] };
  const subs = children.map((c, i) => layoutSub(c, kids, width, gap, `${path}.${i}`, path));
  const offsets: number[] = [0];
  const accR = subs[0].right.slice();
  const accL = subs[0].left.slice();
  for (let i = 1; i < subs.length; i++) {
    const s = subs[i];
    let shift = -Infinity;
    for (let d = 0; d < Math.min(accR.length, s.left.length); d++) shift = Math.max(shift, accR[d] - s.left[d] + gap);
    offsets.push(shift);
    for (let d = 0; d < s.left.length; d++) {
      const l = s.left[d] + shift;
      const r = s.right[d] + shift;
      if (d < accR.length) accR[d] = Math.max(accR[d], r);
      else accR.push(r);
      if (d < accL.length) accL[d] = Math.min(accL[d], l);
      else accL.push(l);
    }
  }
  const mid = (offsets[0] + offsets[offsets.length - 1]) / 2;
  const items: Sub['items'] = [{ n, dx: 0, path, via }];
  subs.forEach((s, i) => {
    for (const it of s.items) items.push({ ...it, dx: it.dx + offsets[i] - mid });
  });
  return {
    items,
    left: [-w / 2, ...accL.map((v) => v - mid)],
    right: [w / 2, ...accR.map((v) => v - mid)],
  };
}

/**
 * Place every person of a lineageTree() result. `partnerNames` of descendants and the focus's
 * siblings / partners come from the tree itself.
 */
export function layoutLineage(
  root: LineageNode,
  opts: Partial<LayoutOptions> & { briefOf?: (id: string) => string | undefined } = {},
): TreeLayout {
  const o: LayoutOptions = { ...DEFAULT_LAYOUT, ...opts };
  const briefOf = opts.briefOf ?? (() => undefined);
  const width = (n: LineageNode) => (n.gen === 0 ? o.focusW : o.nodeW);
  const height = (n: LineageNode) => (n.gen === 0 ? o.focusH : o.nodeH);
  const nodes: PlacedNode[] = [];
  const byKey = new Map<string, PlacedNode>();
  const focusKey = 'f';

  const add = (p: PlacedNode) => {
    nodes.push(p);
    byKey.set(p.key, p);
  };
  const base = (n: LineageNode, key: string, x: number, role: NodeRole, via?: string): PlacedNode => ({
    key,
    id: n.id,
    name: n.name,
    brief: n.brief,
    gen: n.gen,
    role,
    x,
    y: rowY(n.gen, o),
    w: width(n),
    h: height(n),
    via,
    next: [],
    moreParents: n.moreParents,
    moreChildren: n.moreChildren,
    repeat: !!n.repeat,
    partnerNames: n.gen > 0 ? n.partners.map((p) => p.name) : [],
  });

  // ancestors (the focus is the root of both directions)
  const up = layoutSub(root, (n) => n.parents, width, o.gap, focusKey);
  for (const it of up.items) {
    if (it.n === root) continue;
    add(base(it.n, `a${it.path}`, it.dx, 'ancestor', it.via === focusKey ? focusKey : `a${it.via}`));
  }
  const down = layoutSub(root, (n) => n.children, width, o.gap, focusKey);
  add(base(root, focusKey, 0, 'focus'));
  for (const it of down.items) {
    if (it.n === root) continue;
    add(base(it.n, `d${it.path}`, it.dx, 'descendant', it.via === focusKey ? focusKey : `d${it.via}`));
  }
  // next-links (away from the focus), in data order
  for (const p of nodes) if (p.via) byKey.get(p.via)?.next.push(p.key);
  // the focus has both directions: parents first, then children
  const focus = byKey.get(focusKey)!;
  focus.next.sort((a, b) => (a[0] === b[0] ? 0 : a[0] === 'a' ? -1 : 1));

  // siblings to the left, partners to the right (row 0)
  const sibs = root.siblings ?? [];
  const sibH = o.nodeH;
  sibs.forEach((s, i) => {
    const x = -(o.focusW / 2 + o.groupGap + o.nodeW / 2) - (sibs.length - 1 - i) * (o.nodeW + o.gap);
    add({ ...emptyNode(s.id, s.name, `s${i}`, 'sibling'), brief: briefOf(s.id) ?? '', x, w: o.nodeW, h: sibH });
  });
  const partners = root.partners;
  partners.forEach((s, i) => {
    const x = o.focusW / 2 + o.groupGap + o.nodeW / 2 + i * (o.nodeW + o.gap);
    add({ ...emptyNode(s.id, s.name, `p${i}`, 'partner'), brief: briefOf(s.id) ?? '', x, w: o.nodeW, h: o.nodeH });
  });

  /* connectors ---------------------------------------------------------- */
  const links: string[] = [];
  const r = (v: number) => Math.round(v * 10) / 10;
  for (const p of nodes) {
    const kids = p.next.map((k) => byKey.get(k)!).filter(Boolean);
    const ups = kids.filter((k) => k.role === 'ancestor');
    const downs = kids.filter((k) => k.role === 'descendant');
    for (const [group, dir] of [
      [ups, -1],
      [downs, 1],
    ] as const) {
      if (!group.length) continue;
      const y1 = p.y + (dir * p.h) / 2;
      const y2 = group[0].y - (dir * group[0].h) / 2;
      const ym = (y1 + y2) / 2;
      const xs = group.map((g) => g.x);
      const minX = Math.min(p.x, ...xs);
      const maxX = Math.max(p.x, ...xs);
      let d = `M${r(p.x)} ${r(y1)}V${r(ym)}`;
      if (maxX - minX > 0.5) d += `M${r(minX)} ${r(ym)}H${r(maxX)}`;
      for (const g of group) d += `M${r(g.x)} ${r(ym)}V${r(y2)}`;
      links.push(d);
    }
  }

  const ties: string[] = [];
  if (partners.length) {
    const last = nodes.filter((n) => n.role === 'partner').reduce((a, b) => (b.x > a.x ? b : a));
    const x1 = o.focusW / 2;
    ties.push(`M${r(x1)} -3H${r(last.x)}M${r(x1)} 3H${r(last.x)}`);
  }
  if (sibs.length) {
    const sibNodes = nodes.filter((n) => n.role === 'sibling');
    const minX = Math.min(...sibNodes.map((n) => n.x));
    const hasParents = focus.next.some((k) => k[0] === 'a');
    // hang the siblings from the focus's parent line when there is one, else a bracket above the row
    const y = hasParents ? (-o.focusH / 2 + (rowY(-1, o) + o.nodeH / 2)) / 2 : -o.focusH / 2 - 22;
    let d = `M${r(minX)} ${r(y)}H0`;
    for (const s of sibNodes) d += `M${r(s.x)} ${r(y)}V${r(-s.h / 2)}`;
    if (!hasParents) d += `M0 ${r(y)}V${r(-o.focusH / 2)}`;
    links.push(d);
  }

  /* labels and bounds ---------------------------------------------------- */
  const gens = [...new Set(nodes.filter((n) => n.gen !== 0).map((n) => n.gen))].sort((a, b) => a - b);
  const rows = gens.map((gen) => ({ gen, y: rowY(gen, o) }));
  const groups: GroupLabel[] = [];
  // group captions sit just above the side boxes, under the sibling line
  const labelY = -o.nodeH / 2 - 7;
  if (sibs.length) groups.push({ text: 'Brothers & sisters', x: Math.min(...nodes.filter((n) => n.role === 'sibling').map((n) => n.x - n.w / 2)), y: labelY, align: 'start' });
  if (partners.length) groups.push({ text: partners.length === 1 ? 'Partner' : 'Partners', x: o.focusW / 2 + o.groupGap, y: labelY, align: 'start' });

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const n of nodes) {
    bounds.minX = Math.min(bounds.minX, n.x - n.w / 2);
    bounds.maxX = Math.max(bounds.maxX, n.x + n.w / 2);
    bounds.minY = Math.min(bounds.minY, n.y - n.h / 2 - (n.moreParents ? 14 : 0));
    bounds.maxY = Math.max(bounds.maxY, n.y + n.h / 2 + (n.moreChildren ? 14 : 0));
  }
  if (groups.length) bounds.minY = Math.min(bounds.minY, labelY - 14, -o.focusH / 2 - 24);

  return { nodes, byKey, links, ties, rows, groups, bounds, focusKey };
}

function emptyNode(id: string, name: string, key: string, role: NodeRole): PlacedNode {
  return {
    key,
    id,
    name,
    brief: '',
    gen: 0,
    role,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    next: [],
    moreParents: false,
    moreChildren: false,
    repeat: false,
    partnerNames: [],
  };
}

/* ------------------------------------------------------------------------ */
/* Keyboard movement                                                         */
/* ------------------------------------------------------------------------ */

export type Move = 'up' | 'down' | 'left' | 'right' | 'home';

/**
 * Where an arrow key goes from `key`:
 *  - left / right: the neighbour on the same row (nearest by x);
 *  - up: toward the ancestors (a descendant's parent in the tree, an ancestor's / the focus's first parent);
 *  - down: toward the descendants (an ancestor's child in the tree, the focus's / a descendant's first child);
 *  - home: the focus person.
 * Returns undefined when there is nowhere to go.
 */
export function moveFrom(layout: TreeLayout, key: string, move: Move): string | undefined {
  const n = layout.byKey.get(key);
  if (!n) return undefined;
  if (move === 'home') return layout.focusKey;
  if (move === 'left' || move === 'right') {
    const row = layout.nodes.filter((m) => Math.abs(m.y - n.y) < 1 && m.key !== key);
    const side = row.filter((m) => (move === 'left' ? m.x < n.x : m.x > n.x));
    if (!side.length) return undefined;
    return side.reduce((a, b) => (Math.abs(b.x - n.x) < Math.abs(a.x - n.x) ? b : a)).key;
  }
  const focus = layout.byKey.get(layout.focusKey)!;
  const firstAnc = (p: PlacedNode) => p.next.find((k) => k[0] === 'a');
  const firstDesc = (p: PlacedNode) => p.next.find((k) => k[0] === 'd');
  if (move === 'up') {
    if (n.role === 'descendant') return n.via;
    if (n.role === 'ancestor' || n.role === 'focus') return firstAnc(n);
    return firstAnc(focus);
  }
  // down
  if (n.role === 'ancestor') return n.via;
  if (n.role === 'descendant' || n.role === 'focus') return firstDesc(n);
  return firstDesc(focus);
}
