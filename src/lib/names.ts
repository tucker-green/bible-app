/**
 * People, places and lineage (STEPBible TIPNR data, see scripts/data/names.ts):
 *
 * - Loaders for public/data/names/: per-chapter word -> entity maps, entity chunks, the family graph
 *   and the search index. Concurrent calls share one request; chapters and chunks live in small LRU
 *   caches; failed requests are not cached. A missing chapter map resolves to an empty one.
 * - entityForWord / entityForToken: which person or place an original-language word names.
 * - Lineage helpers over the FamilyGraph: ancestors, descendants, a render-ready lineageTree,
 *   findPath (Adam -> Jesus), siblingsOf, partnersOf.
 *
 * URLs come from data.ts's dataUrl() (same base and cache-busting version as every other file).
 * Fetch defaults to the global fetch; configureNames({ fetch }) swaps in a mock for tests.
 * No DOM access at import time.
 */
import { DataError, Lru, baseStrongs, dataUrl, type FetchLike } from './data';
import type {
  BookId,
  EntityKind,
  FamilyGraph,
  NameChapter,
  NameEntity,
  NameEntityChunk,
  NameIndex,
  WordToken,
} from './types';

/* ------------------------------------------------------------------------ */
/* Configuration and caches                                                  */
/* ------------------------------------------------------------------------ */

export interface NamesConfig {
  fetch: FetchLike;
  /** Max chapter maps kept in memory. */
  chapterCacheSize: number;
  /** Max entity chunks kept in memory. */
  chunkCacheSize: number;
}

const config: NamesConfig = {
  fetch: (url, init) => fetch(url, init),
  chapterCacheSize: 40,
  chunkCacheSize: 24,
};

let chapterCache = new Lru<string, Promise<NameChapter>>(config.chapterCacheSize);
let chunkCache = new Lru<string, Promise<NameEntityChunk>>(config.chunkCacheSize);
let familyPromise: Promise<FamilyGraph> | null = null;
let indexPromise: Promise<NameIndex> | null = null;

/** Override configuration (tests). Clears the caches. */
export function configureNames(opts: Partial<NamesConfig>): void {
  Object.assign(config, opts);
  resetNamesCache();
}

/** Drop every cached names file. */
export function resetNamesCache(): void {
  chapterCache = new Lru(config.chapterCacheSize);
  chunkCache = new Lru(config.chunkCacheSize);
  familyPromise = null;
  indexPromise = null;
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = dataUrl(path);
  let res: Response;
  try {
    res = await config.fetch(url);
  } catch (err) {
    throw Object.assign(new DataError(url, 0), { cause: err });
  }
  if (!res.ok) throw new DataError(url, res.status);
  return (await res.json()) as T;
}

function cachedIn<T>(cache: Lru<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = load();
  cache.set(key, p);
  p.catch(() => {
    if (cache.get(key) === p) cache.delete(key);
  });
  return p;
}

function once<T>(get: () => Promise<T> | null, set: (p: Promise<T> | null) => void, load: () => Promise<T>): Promise<T> {
  const hit = get();
  if (hit) return hit;
  const p = load();
  set(p);
  p.catch(() => {
    if (get() === p) set(null);
  });
  return p;
}

/* ------------------------------------------------------------------------ */
/* Ids and paths                                                             */
/* ------------------------------------------------------------------------ */

/** "p0685" (person), "l0123" (place), "g0007" (group / other). */
export function isEntityId(id: string): boolean {
  return /^[plg]\d{4,}$/.test(id);
}

/** Entity chunk file for an id: "p0685" -> "names/entities/p/006.json". */
export function entityChunkPath(id: string): string {
  const n = Number(id.slice(1));
  return `names/entities/${id[0]}/${String(Math.floor(n / 100)).padStart(3, '0')}.json`;
}

/** Kind implied by an id's letter ('g' covers both groups and other names). */
export function kindOfId(id: string): EntityKind | undefined {
  return id[0] === 'p' ? 'person' : id[0] === 'l' ? 'place' : id[0] === 'g' ? 'group' : undefined;
}

/* ------------------------------------------------------------------------ */
/* Loaders                                                                   */
/* ------------------------------------------------------------------------ */

/** public/data/names/chapters/{BOOK}/{C}.json; an empty map if the chapter has none (404). */
export function loadNameChapter(book: BookId, chapter: number): Promise<NameChapter> {
  return cachedIn(chapterCache, `${book}/${chapter}`, async () => {
    try {
      return await fetchJson<NameChapter>(`names/chapters/${book}/${chapter}.json`);
    } catch (err) {
      if (err instanceof DataError && err.status === 404) return { book, chapter, words: {} };
      throw err;
    }
  });
}

/** One entity chunk (names/entities/{p|l|g}/{NNN}.json). */
export function loadEntityChunk(id: string): Promise<NameEntityChunk> {
  if (!isEntityId(id)) return Promise.reject(new Error(`Not an entity id: ${id}`));
  const path = entityChunkPath(id);
  return cachedIn(chunkCache, path, () => fetchJson<NameEntityChunk>(path));
}

/** A person, place or group by id; undefined if unknown. */
export async function loadEntity(id: string): Promise<NameEntity | undefined> {
  if (!isEntityId(id)) return undefined;
  try {
    return (await loadEntityChunk(id))[id];
  } catch (err) {
    if (err instanceof DataError && err.status === 404) return undefined;
    throw err;
  }
}

/** Several entities (each chunk fetched once), in the order given; unknown ids are skipped. */
export async function loadEntities(ids: readonly string[]): Promise<NameEntity[]> {
  const found = await Promise.all(ids.map((id) => loadEntity(id)));
  return found.filter((e): e is NameEntity => !!e);
}

/** public/data/names/family.json (~0.3 MB, loaded once). */
export function loadFamily(): Promise<FamilyGraph> {
  return once(
    () => familyPromise,
    (p) => (familyPromise = p),
    () => fetchJson<FamilyGraph>('names/family.json'),
  );
}

/** public/data/names/index.json (~0.3 MB, loaded once): [id, name, kind, brief, refCount] per entity. */
export function loadNameIndex(): Promise<NameIndex> {
  return once(
    () => indexPromise,
    (p) => (indexPromise = p),
    () => fetchJson<NameIndex>('names/index.json'),
  );
}

/* ------------------------------------------------------------------------ */
/* Words -> entities                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Entity id named by original word `origIndex` of the chapter, if any. With `tr`, none when that
 * translation reads the word as a common noun (NameChapter.except: "accuser", not Satan).
 */
export function entityForWord(nameChapter: NameChapter | null | undefined, origIndex: number, tr?: string): string | undefined {
  const key = String(origIndex);
  if (tr && nameChapter?.except?.[key]?.includes(tr)) return undefined;
  return nameChapter?.words[key];
}

/** Entity named by an English token: the first of its linked original words that names one. */
export function entityForToken(nameChapter: NameChapter | null | undefined, token: WordToken, tr?: string): string | undefined {
  for (const i of token[1]) {
    const id = entityForWord(nameChapter, i, tr);
    if (id) return id;
  }
  return undefined;
}

/**
 * The form of an entity's name behind a word with this Strong's number:
 * Israel (the patriarch) + H3290 -> ["H3290", "יַעֲקֹב", "Jacob"]. Undefined if none matches.
 */
export function formForStrongs(entity: NameEntity, strongs: string): [string, string, string] | undefined {
  if (!strongs) return undefined;
  const b = baseStrongs(strongs);
  return entity.forms.find((f) => f[0] === strongs) ?? entity.forms.find((f) => baseStrongs(f[0]) === b);
}

/**
 * The name to show for an entity when hovering a word: the English name of the matching form when it
 * differs from the entity name ("Jacob" for the entity "Israel"), else the entity name.
 */
export function nameForWord(entity: NameEntity, strongs: string): string {
  const en = formForStrongs(entity, strongs)?.[2];
  return en && /^\p{Lu}/u.test(en) ? en : entity.name;
}

/* ------------------------------------------------------------------------ */
/* Index helpers                                                             */
/* ------------------------------------------------------------------------ */

export interface NameIndexEntry {
  id: string;
  name: string;
  kind: EntityKind;
  brief: string;
  refCount: number;
}

const indexMaps = new WeakMap<NameIndex, Map<string, NameIndexEntry>>();

/** id -> entry (built once per index array): name and brief without loading the entity chunk. */
export function nameIndexMap(index: NameIndex): Map<string, NameIndexEntry> {
  let m = indexMaps.get(index);
  if (!m) {
    m = new Map(index.map(([id, name, kind, brief, refCount]) => [id, { id, name, kind, brief, refCount }]));
    indexMaps.set(index, m);
  }
  return m;
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Autocomplete: entries whose name starts with the query (then those containing it as a word,
 * then anywhere), most-mentioned first. Case and accents are ignored.
 */
export function searchNames(index: NameIndex, query: string, opts: { limit?: number; kind?: EntityKind } = {}): NameIndexEntry[] {
  const q = fold(query);
  if (!q) return [];
  const limit = opts.limit ?? 20;
  const scored: [number, NameIndexEntry][] = [];
  for (const e of nameIndexMap(index).values()) {
    if (opts.kind && e.kind !== opts.kind) continue;
    const n = fold(e.name);
    const score = n === q ? 0 : n.startsWith(q) ? 1 : ` ${n}`.includes(` ${q}`) ? 2 : n.includes(q) ? 3 : -1;
    if (score >= 0) scored.push([score, e]);
  }
  scored.sort((a, b) => a[0] - b[0] || b[1].refCount - a[1].refCount || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map((s) => s[1]);
}

/* ------------------------------------------------------------------------ */
/* Family graph                                                              */
/* ------------------------------------------------------------------------ */

export interface FamilyPerson {
  id: string;
  name: string;
  brief: string;
  parents: string[];
  children: string[];
  partners: string[];
  siblings: string[];
}

const familyMaps = new WeakMap<FamilyGraph, Map<string, FamilyPerson>>();

/** id -> person (built once per graph array). Every helper below accepts the raw graph. */
export function familyIndex(graph: FamilyGraph): Map<string, FamilyPerson> {
  let m = familyMaps.get(graph);
  if (!m) {
    m = new Map(
      graph.map(([id, name, brief, parents, children, partners, siblings]) => [
        id,
        { id, name, brief, parents, children, partners, siblings },
      ]),
    );
    familyMaps.set(graph, m);
  }
  return m;
}

export function familyPerson(graph: FamilyGraph, id: string): FamilyPerson | undefined {
  return familyIndex(graph).get(id);
}

export interface Relative {
  id: string;
  /** Generations away: 1 = parents / children, 2 = grandparents / grandchildren… */
  gen: number;
}

function walk(graph: FamilyGraph, id: string, depth: number, next: (p: FamilyPerson) => string[]): Relative[] {
  const fam = familyIndex(graph);
  const seen = new Set([id]);
  const out: Relative[] = [];
  let frontier = [id];
  for (let gen = 1; gen <= depth && frontier.length; gen++) {
    const nextFrontier: string[] = [];
    for (const cur of frontier) {
      const p = fam.get(cur);
      if (!p) continue;
      for (const r of next(p)) {
        if (seen.has(r) || !fam.has(r)) continue;
        seen.add(r);
        out.push({ id: r, gen });
        nextFrontier.push(r);
      }
    }
    frontier = nextFrontier;
  }
  return out;
}

/** Every ancestor up to `depth` generations, nearest first (each person once, at their nearest generation). */
export function ancestors(graph: FamilyGraph, id: string, depth = Infinity): Relative[] {
  return walk(graph, id, depth, (p) => p.parents);
}

/** Every descendant down to `depth` generations, nearest first. */
export function descendants(graph: FamilyGraph, id: string, depth = Infinity): Relative[] {
  return walk(graph, id, depth, (p) => p.children);
}

/** Brothers and sisters: those TIPNR lists, plus anyone sharing a parent (half-siblings included). */
export function siblingsOf(graph: FamilyGraph, id: string): string[] {
  const fam = familyIndex(graph);
  const p = fam.get(id);
  if (!p) return [];
  const out = new Set(p.siblings.filter((s) => s !== id));
  for (const parent of p.parents) for (const c of fam.get(parent)?.children ?? []) if (c !== id) out.add(c);
  return [...out].filter((s) => fam.has(s));
}

/** Husbands / wives (and concubines, as TIPNR records them). */
export function partnersOf(graph: FamilyGraph, id: string): string[] {
  return familyIndex(graph).get(id)?.partners ?? [];
}

export interface LineageNode {
  id: string;
  name: string;
  brief: string;
  /** Generations from the focus person: negative = ancestors, positive = descendants, 0 = focus. */
  gen: number;
  /** Ancestor side (focus and ancestors): parents, expanded up to `up` generations. */
  parents: LineageNode[];
  /** Descendant side (focus and descendants): children, expanded down to `down` generations. */
  children: LineageNode[];
  /** Partners, to draw couples (focus and descendants). */
  partners: { id: string; name: string }[];
  /** Focus only: brothers and sisters. */
  siblings?: { id: string; name: string }[];
  /** More parents / children exist beyond the depth limit (render an "expand" control). */
  moreParents: boolean;
  moreChildren: boolean;
  /** Already shown elsewhere in this tree (cousin marriage, repeated genealogy): not expanded again. */
  repeat?: boolean;
}

/**
 * A render-ready family tree around `id`: the focus node's `parents` branch upward `up` generations
 * and its `children` branch downward `down` generations. Each person is expanded once per direction;
 * later appearances are marked `repeat`. Null if `id` is not a person in the graph.
 */
export function lineageTree(graph: FamilyGraph, id: string, opts: { up?: number; down?: number } = {}): LineageNode | null {
  const fam = familyIndex(graph);
  const focus = fam.get(id);
  if (!focus) return null;
  const up = opts.up ?? 3;
  const down = opts.down ?? 3;
  const brief = (pid: string) => ({ id: pid, name: fam.get(pid)?.name ?? pid });
  const known = (ids: string[]) => ids.filter((x) => fam.has(x));

  const node = (p: FamilyPerson, gen: number): LineageNode => ({
    id: p.id,
    name: p.name,
    brief: p.brief,
    gen,
    parents: [],
    children: [],
    partners: gen >= 0 ? known(p.partners).map(brief) : [],
    moreParents: false,
    moreChildren: false,
  });

  const seenUp = new Set<string>([id]);
  const growUp = (n: LineageNode, p: FamilyPerson) => {
    const parents = known(p.parents);
    if (-n.gen >= up) {
      n.moreParents = parents.length > 0;
      return;
    }
    for (const pid of parents) {
      const pp = fam.get(pid)!;
      const child = node(pp, n.gen - 1);
      if (seenUp.has(pid)) child.repeat = true;
      else {
        seenUp.add(pid);
        growUp(child, pp);
      }
      n.parents.push(child);
    }
  };
  const seenDown = new Set<string>([id]);
  const growDown = (n: LineageNode, p: FamilyPerson) => {
    const children = known(p.children);
    if (n.gen >= down) {
      n.moreChildren = children.length > 0;
      return;
    }
    for (const cid of children) {
      const cp = fam.get(cid)!;
      const child = node(cp, n.gen + 1);
      if (seenDown.has(cid)) child.repeat = true;
      else {
        seenDown.add(cid);
        growDown(child, cp);
      }
      n.children.push(child);
    }
  };

  const root = node(focus, 0);
  root.siblings = siblingsOf(graph, id).map(brief);
  growUp(root, focus);
  growDown(root, focus);
  return root;
}

export interface PathStep {
  id: string;
  name: string;
  /** How this person relates to the previous step: 'child' (of the previous), 'parent', or 'self' (first). */
  rel: 'self' | 'parent' | 'child';
}

/**
 * Shortest chain of parent/child links from `fromId` to `toId` (breadth-first, so the fewest
 * generations; ties go to the line TIPNR lists first). direction:
 *  - 'down': descent only (from is an ancestor of to), e.g. Adam -> Jesus, Abraham -> David
 *  - 'up':   ascent only (from is a descendant of to)
 *  - 'any':  both, e.g. cousins via a common ancestor
 *  - 'auto' (default): 'down', else 'up', else 'any'.
 * Returns null if there is no such chain (or either id is not a person).
 */
export function findPath(
  graph: FamilyGraph,
  fromId: string,
  toId: string,
  opts: { direction?: 'auto' | 'down' | 'up' | 'any'; maxSteps?: number } = {},
): PathStep[] | null {
  const fam = familyIndex(graph);
  if (!fam.has(fromId) || !fam.has(toId)) return null;
  const dir = opts.direction ?? 'auto';
  if (dir === 'auto') {
    for (const d of ['down', 'up', 'any'] as const) {
      const p = findPath(graph, fromId, toId, { ...opts, direction: d });
      if (p) return p;
    }
    return null;
  }
  const maxSteps = opts.maxSteps ?? Infinity;
  const prev = new Map<string, { from: string; rel: 'parent' | 'child' } | null>([[fromId, null]]);
  let frontier = [fromId];
  for (let step = 0; frontier.length && !prev.has(toId) && step < maxSteps; step++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const p = fam.get(cur)!;
      const edges: [string, 'parent' | 'child'][] = [];
      // Parents first: in 'any' mode, equally short routes then go through a common ancestor.
      if (dir !== 'down') for (const c of p.parents) edges.push([c, 'parent']);
      if (dir !== 'up') for (const c of p.children) edges.push([c, 'child']);
      for (const [nid, rel] of edges) {
        if (prev.has(nid) || !fam.has(nid)) continue;
        prev.set(nid, { from: cur, rel });
        next.push(nid);
      }
    }
    frontier = next;
  }
  if (!prev.has(toId)) return null;
  const out: PathStep[] = [];
  for (let cur: string | undefined = toId; cur !== undefined; ) {
    const link = prev.get(cur);
    out.push({ id: cur, name: fam.get(cur)!.name, rel: link ? link.rel : 'self' });
    cur = link?.from;
  }
  return out.reverse();
}
