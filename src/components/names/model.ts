/**
 * Pure helpers for the people / places / lineage UI (word-card entity block, #/person · #/place
 * pages, #/lineage explorer). DOM-free and unit-tested (tests/ui/names-model.test.ts).
 */
import { getBookByNum } from '../../lib/books';
import { findBook } from '../../lib/reference';
import type { NameIndexEntry, PathStep } from '../../lib/names';
import type { EntityKind, NameEntity, VerseRef } from '../../lib/types';
import { unpackRef } from '../../lib/types';
import type { DefNode } from '../word/definition';

/* ------------------------------------------------------------------------ */
/* Kinds, links, relation words                                              */
/* ------------------------------------------------------------------------ */

export const KIND_LABEL: Record<EntityKind, string> = {
  person: 'Person',
  place: 'Place',
  group: 'People group',
  other: 'Name',
};

/** "#/person/p0057", "#/place/l0195" (groups and other names use the person route, which shows any entity). */
export function entityHash(id: string, kind?: EntityKind): string {
  const k = kind ?? (id[0] === 'l' ? 'place' : 'person');
  return `#/${k === 'place' ? 'place' : 'person'}/${id}`;
}

export function lineageHash(id: string): string {
  return `#/lineage/${id}`;
}

export type Relation = 'parent' | 'partner' | 'child' | 'sibling';

/**
 * How the entity relates to the people listed, from the entity's own side, so only the entity's own
 * gender is needed: a man's parents make him "Son of", his children make him "Father of".
 */
export function relationPhrase(rel: Relation, gender?: 'male' | 'female'): string {
  const m = gender === 'male';
  const f = gender === 'female';
  switch (rel) {
    case 'parent':
      return m ? 'Son of' : f ? 'Daughter of' : 'Child of';
    case 'partner':
      return m ? 'Husband of' : f ? 'Wife of' : 'Partner of';
    case 'child':
      return m ? 'Father of' : f ? 'Mother of' : 'Parent of';
    case 'sibling':
      return m ? 'Brother of' : f ? 'Sister of' : 'Sibling of';
  }
}

export interface RelativeGroup {
  rel: Relation;
  label: string;
  /** Shown entries (resolved through the name index; unknown ids are skipped). */
  people: NameIndexEntry[];
  /** How many more exist beyond `people` (the "+N more" chip). */
  more: number;
}

/**
 * The family groups to show for a person: parents, partners, children (and siblings when asked),
 * each capped at `limit` names with a "+N more" count. Places carry founders in `parents`, which
 * read "Founded by" (TIPNR's "father of Bethlehem" is a founder or clan head).
 */
export function relativeGroups(
  entity: NameEntity,
  lookup: (id: string) => NameIndexEntry | undefined,
  opts: { limit?: Partial<Record<Relation, number>>; siblings?: boolean } = {},
): RelativeGroup[] {
  const order: Relation[] = opts.siblings ? ['parent', 'sibling', 'partner', 'child'] : ['parent', 'partner', 'child'];
  const field: Record<Relation, string[] | undefined> = {
    parent: entity.parents,
    partner: entity.partners,
    child: entity.children,
    sibling: entity.siblings,
  };
  const out: RelativeGroup[] = [];
  for (const rel of order) {
    const ids = [...new Set(field[rel] ?? [])].filter((id) => id !== entity.id);
    const people = ids.map(lookup).filter((e): e is NameIndexEntry => !!e);
    if (!people.length) continue;
    const limit = opts.limit?.[rel] ?? Infinity;
    const shown = people.slice(0, limit);
    const label = entity.kind === 'person' ? relationPhrase(rel, entity.gender) : rel === 'parent' ? 'Founded by' : relationPhrase(rel);
    out.push({ rel, label, people: shown, more: people.length - shown.length });
  }
  return out;
}

/** "1 of 10 people named Joseph" (null when the name is unique). */
export function namesakeNote(entity: Pick<NameEntity, 'id' | 'name' | 'kind'>, entries: Iterable<NameIndexEntry>): string | null {
  const ids: string[] = [];
  for (const e of entries) if (e.name === entity.name && e.kind === entity.kind) ids.push(e.id);
  if (ids.length < 2) return null;
  const noun = entity.kind === 'person' ? 'people' : entity.kind === 'place' ? 'places' : 'entries';
  return `One of ${ids.length} ${noun} named ${entity.name}`;
}

/* ------------------------------------------------------------------------ */
/* Summary: record lines + narrative, plain references made clickable        */
/* ------------------------------------------------------------------------ */

function nodeText(nodes: DefNode[]): string {
  let s = '';
  for (const n of nodes) {
    if (n.t === 'text') s += n.v;
    else if (n.t !== 'br') s += nodeText(n.c);
  }
  return s;
}

function trimLine(line: DefNode[]): DefNode[] {
  const out = line.slice();
  while (out.length && out[0].t === 'text' && !(out[0] as { v: string }).v.trim()) out.shift();
  while (out.length && out[out.length - 1].t === 'text' && !(out[out.length - 1] as { v: string }).v.trim()) out.pop();
  if (out[0]?.t === 'text') out[0] = { t: 'text', v: out[0].v.replace(/^\s+/, '') };
  const last = out[out.length - 1];
  if (last?.t === 'text') out[out.length - 1] = { t: 'text', v: last.v.replace(/\s+$/, '') };
  return out;
}

/**
 * TIPNR summaries open with a short record ("A man living at the time of the Patriarchs, first
 * mentioned at Gen 11:26 / referred to as … / son of Terah; …") and continue with narrative
 * paragraphs. Split the parsed summary at <br>: the first line and the lines after it that start in
 * lower case form the record; the rest are paragraphs.
 */
export function splitSummary(nodes: DefNode[]): { record: DefNode[][]; paragraphs: DefNode[][] } {
  const lines: DefNode[][] = [[]];
  for (const n of nodes) {
    if (n.t === 'br') lines.push([]);
    else lines[lines.length - 1].push(n);
  }
  const clean = lines.map(trimLine).filter((l) => nodeText(l).trim());
  const record: DefNode[][] = [];
  const paragraphs: DefNode[][] = [];
  clean.forEach((line, i) => {
    const text = nodeText(line).trim();
    if (!paragraphs.length && (i === 0 || /^[\p{Ll}(“"']/u.test(text))) record.push(line);
    else paragraphs.push(line);
  });
  return { record, paragraphs };
}

// "Genesis 35:19", "1 Sam 16:1", "Jam 2.23", "Matthew 2:5-6"
const REF_IN_TEXT = /(?<![\p{L}\d])((?:[1-3] ?)?\p{Lu}\p{Ll}{1,14}\.?) (\d{1,3})[:.](\d{1,3})(?:[-–](\d{1,3}))?(?![\d\p{L}])/gu;
// continuations after a reference: "; 48:7", ", 18", ", 5-6"
const CONT_CHAPTER = /^(\s*[;,]\s*)(\d{1,3}):(\d{1,3})(?:[-–](\d{1,3}))?(?![\d:])/;
const CONT_VERSE = /^(\s*,\s*)(\d{1,3})(?:[-–](\d{1,3}))?(?![\d:.]\d)(?=[\s,;).]|$)/;

function refNode(book: string, chapter: number, verse: number, end: number | undefined, label: string): DefNode | null {
  const b = findBook(book);
  if (!b || chapter < 1 || chapter > b.chapters || verse < 1) return null;
  const ref: VerseRef = { book: b.id, chapter, verse };
  if (end && end > verse) ref.verseEnd = end;
  return { t: 'ref', ref, id: `${b.id}.${chapter}.${verse}`, c: [{ t: 'text', v: label }] };
}

/** Turn plain-text references inside a text run into reference nodes (other text is kept as is). */
export function linkifyText(text: string): DefNode[] {
  const out: DefNode[] = [];
  let pos = 0;
  const push = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === 'text') last.v += v;
    else out.push({ t: 'text', v });
  };
  REF_IN_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_IN_TEXT.exec(text))) {
    const [label, book, ch, vs, ve] = m;
    const first = refNode(book, Number(ch), Number(vs), ve ? Number(ve) : undefined, label);
    if (!first || first.t !== 'ref') continue;
    push(text.slice(pos, m.index));
    out.push(first);
    let at = m.index + label.length;
    let chapter = Number(ch);
    // follow-on references in the same book
    for (;;) {
      const rest = text.slice(at);
      const c = CONT_CHAPTER.exec(rest);
      if (c) {
        const node = refNode(first.ref.book, Number(c[2]), Number(c[3]), c[4] ? Number(c[4]) : undefined, c[0].slice(c[1].length));
        if (!node) break;
        push(c[1]);
        out.push(node);
        chapter = Number(c[2]);
        at += c[0].length;
        continue;
      }
      const v = CONT_VERSE.exec(rest);
      if (v) {
        const node = refNode(first.ref.book, chapter, Number(v[2]), v[3] ? Number(v[3]) : undefined, v[0].slice(v[1].length));
        if (!node) break;
        push(v[1]);
        out.push(node);
        at += v[0].length;
        continue;
      }
      break;
    }
    pos = at;
    REF_IN_TEXT.lastIndex = at;
  }
  push(text.slice(pos));
  return out;
}

/** linkifyText over every text node outside existing references. */
export function linkifyRefs(nodes: DefNode[]): DefNode[] {
  const out: DefNode[] = [];
  for (const n of nodes) {
    if (n.t === 'text') out.push(...linkifyText(n.v));
    else if (n.t === 'b' || n.t === 'i') out.push({ t: n.t, c: linkifyRefs(n.c) });
    else out.push(n);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Places                                                                    */
/* ------------------------------------------------------------------------ */

/** "31.7054° N, 35.2103° E" */
export function formatCoords([lat, lon]: [number, number]): string {
  const f = (n: number) => Math.abs(n).toFixed(4);
  return `${f(lat)}° ${lat >= 0 ? 'N' : 'S'}, ${f(lon)}° ${lon >= 0 ? 'E' : 'W'}`;
}

/* ------------------------------------------------------------------------ */
/* Verse references                                                          */
/* ------------------------------------------------------------------------ */

export interface BookRefs {
  bookNum: number;
  book: string;
  name: string;
  refs: number[];
}

/** Packed refs grouped by book, canonical order. */
export function groupRefsByBook(refs: readonly number[]): BookRefs[] {
  const out: BookRefs[] = [];
  for (const r of [...refs].sort((a, b) => a - b)) {
    const { bookNum } = unpackRef(r);
    let g = out[out.length - 1];
    if (!g || g.bookNum !== bookNum) {
      const b = getBookByNum(bookNum);
      if (!b) continue;
      g = { bookNum, book: b.id, name: b.name, refs: [] };
      out.push(g);
    }
    g.refs.push(r);
  }
  return out;
}

/** The distinct chapters ("BOOK/C") a list of packed refs touches, in order. */
export function chaptersOf(refs: readonly number[]): { book: string; chapter: number }[] {
  const seen = new Set<string>();
  const out: { book: string; chapter: number }[] = [];
  for (const r of refs) {
    const { bookNum, chapter } = unpackRef(r);
    const b = getBookByNum(bookNum);
    if (!b) continue;
    const k = `${b.id}/${chapter}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ book: b.id, chapter });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Lineage                                                                   */
/* ------------------------------------------------------------------------ */

/** "Parents", "Grandparents", "Great-grandparents", "4 generations up"; the same downward. */
export function generationLabel(gen: number): string {
  const n = Math.abs(gen);
  if (gen === 0) return '';
  const up = gen < 0;
  if (n === 1) return up ? 'Parents' : 'Children';
  if (n === 2) return up ? 'Grandparents' : 'Grandchildren';
  if (n === 3) return up ? 'Great-grandparents' : 'Great-grandchildren';
  return `${n} generations ${up ? 'up' : 'down'}`;
}

/** Relationship of a tree node to the focus person, for accessible names: "grandparent", "child". */
export function relationToFocus(gen: number, role: 'focus' | 'ancestor' | 'descendant' | 'partner' | 'sibling'): string {
  if (role === 'focus') return 'centred';
  if (role === 'partner') return 'partner';
  if (role === 'sibling') return 'brother or sister';
  const n = Math.abs(gen);
  const base = role === 'ancestor' ? 'parent' : 'child';
  if (n === 1) return base;
  if (n === 2) return `grand${base}`;
  if (n === 3) return `great-grand${base}`;
  return `${role === 'ancestor' ? 'ancestor' : 'descendant'}, ${n} generations ${role === 'ancestor' ? 'up' : 'down'}`;
}

export type PathItem =
  | { kind: 'person'; step: PathStep; index: number; turn: boolean }
  | { kind: 'gap'; count: number; from: number; to: number };

/**
 * A path for display: runs of two or more "Unnamed" links (TIPNR gaps, e.g. between Matthan and
 * Jacob on the Adam → Jesus line) collapse into one gap item; the common ancestor of an up-then-down
 * path is flagged `turn`.
 */
export function pathItems(path: readonly PathStep[]): PathItem[] {
  const out: PathItem[] = [];
  for (let i = 0; i < path.length; i++) {
    const s = path[i];
    if (s.name === 'Unnamed') {
      let j = i;
      while (j + 1 < path.length && path[j + 1].name === 'Unnamed') j++;
      if (j > i) {
        out.push({ kind: 'gap', count: j - i + 1, from: i, to: j });
        i = j;
        continue;
      }
    }
    const next = path[i + 1];
    const turn = i > 0 && s.rel === 'parent' && next?.rel === 'child';
    out.push({ kind: 'person', step: s, index: i, turn });
  }
  return out;
}

/** "Adam is an ancestor of Jesus, 74 generations apart" / "… a descendant of …" / "… related through …". */
export function describePath(path: readonly PathStep[]): string {
  if (path.length < 2) return '';
  const from = path[0].name;
  const to = path[path.length - 1].name;
  const gens = path.length - 1;
  const g = `${gens} ${gens === 1 ? 'generation' : 'generations'}`;
  const ups = path.some((s) => s.rel === 'parent');
  const downs = path.some((s) => s.rel === 'child');
  if (downs && !ups) return gens === 1 ? `${from} is a parent of ${to}` : `${from} is an ancestor of ${to}, ${g} apart`;
  if (ups && !downs) return gens === 1 ? `${from} is a child of ${to}` : `${from} is a descendant of ${to}, ${g} apart`;
  const turn = path.find((s, i) => i > 0 && s.rel === 'parent' && path[i + 1]?.rel === 'child');
  return `${from} and ${to} are related through ${turn ? turn.name : 'a common ancestor'} (${gens} links)`;
}

/* ------------------------------------------------------------------------ */
/* Script runs and Strong's labels                                           */
/* ------------------------------------------------------------------------ */

const HEBREW = /[֑-״יִ-ﭏ]/;
const GREEK = /[Ͱ-Ͽἀ-῿]/;
const RUN = /([֑-״יִ-ﭏ][֑-״יִ-ﭏ\s־־'’/-]*[֑-״יִ-ﭏ]|[֑-״יִ-ﭏ])|([Ͱ-Ͽἀ-῿][Ͱ-Ͽἀ-῿̀-ͯ\s'’]*[Ͱ-Ͽἀ-῿̀-ͯ]|[Ͱ-Ͽἀ-῿])/g;

export interface ScriptRun {
  text: string;
  /** 'he' (Hebrew / Aramaic script) or 'grc' (Greek); undefined for everything else. */
  lang?: 'he' | 'grc';
}

/** Split text into Hebrew, Greek and other runs, so original-language words get lang / dir and their fonts. */
export function scriptRuns(text: string): ScriptRun[] {
  if (!HEBREW.test(text) && !GREEK.test(text)) return [{ text }];
  const out: ScriptRun[] = [];
  let pos = 0;
  RUN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN.exec(text))) {
    if (m.index > pos) out.push({ text: text.slice(pos, m.index) });
    out.push({ text: m[0], lang: m[1] ? 'he' : 'grc' });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** "H0085" -> "H85", "G0011" -> "G11", "H5800a" -> "H5800a". */
export function shortStrongs(id: string): string {
  return id.replace(/^([GH])0+(?=\d)/, '$1');
}
