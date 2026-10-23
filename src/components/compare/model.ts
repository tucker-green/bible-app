/**
 * Compare view model (pure and DOM-free; unit-tested in tests/ui/compare-model.test.ts).
 *
 * The signature trick of the compare page: every translation links its words to the SAME original
 * words (OrigChapter indices). So the columns are built with the reader's own chapter model
 * (reader/model.ts) and then merged into ONE unit space — unit ids are renumbered column after
 * column and `byOrig` / `byKin` are rebuilt over all of them. The reader's controller and word card
 * then work unchanged: `linkedUnits()` of a word in one column returns the words of every column that
 * render the same Greek / Hebrew word, so they light up together.
 *
 * Each column gets two ChapterModel "views" over the merged units:
 *   - `model`      key = the compare key: what the word card and the controller see;
 *   - `sheetModel` key = "TR/BOOK/CHAPTER": what that column's verse sheet sees.
 *
 * The grid HTML reuses render.ts (renderChapterHtml on one verse at a time, layout "verses" /
 * "poetry") through a small adapter that drops the per-verse id (it would repeat in every column)
 * and inserts a run-in translation label.
 */
import { resolveTranslation } from '../../app/router';
import type { AlignmentKind, OrigChapter, TextChapter, TranslationMeta } from '../../lib/types';
import type { ChapterModel, Piece, Unit, VerseModel } from '../reader/model';
import { buildChapterModel, chapterKey } from '../reader/model';
import type { HeadingInfo, Layout, RenderOptions } from '../reader/render';
import { chooseLayout, escapeHtml, headingsByVerse, renderChapterHtml, typeset } from '../reader/render';

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 3;

/* ------------------------------------------------------------------------ */
/* Translation choice                                                        */
/* ------------------------------------------------------------------------ */

/**
 * The translations to show for the requested ones: each resolved like the reader does
 * (resolveTranslation: exact / case-insensitive, else the KJV), duplicates dropped, at most three,
 * and topped up to two (KJV, then BSB, then picker order). While nothing is known yet
 * (`available` empty) the request is returned unchanged.
 */
export function resolveCompareTrs(requested: readonly string[], available: readonly Pick<TranslationMeta, 'id'>[]): string[] {
  if (!available.length) return [...requested];
  const out: string[] = [];
  for (const r of requested) {
    const id = resolveTranslation(r, available);
    if (!out.includes(id)) out.push(id);
    if (out.length === MAX_COLUMNS) break;
  }
  const fill = ['KJV', 'BSB', ...available.map((t) => t.id)];
  for (const id of fill) {
    if (out.length >= MIN_COLUMNS) break;
    if (!out.includes(id) && available.some((t) => t.id === id)) out.push(id);
  }
  return out;
}

/** Column `index` switches to `id`; if `id` is already another column, the two swap places. */
export function setColumn(trs: readonly string[], index: number, id: string): string[] {
  const out = [...trs];
  const j = out.indexOf(id);
  if (j === index || index < 0 || index >= out.length) return out;
  if (j >= 0) out[j] = out[index];
  out[index] = id;
  return out;
}

/** Remove column `index` (never below two columns). */
export function removeColumn(trs: readonly string[], index: number): string[] {
  if (trs.length <= MIN_COLUMNS || index < 0 || index >= trs.length) return [...trs];
  return trs.filter((_, i) => i !== index);
}

/** The translation "Add a translation" appends: the first one (picker order) not shown yet, or null. */
export function nextTranslation(trs: readonly string[], available: readonly Pick<TranslationMeta, 'id'>[]): string | null {
  if (trs.length >= MAX_COLUMNS) return null;
  return available.find((t) => !trs.includes(t.id))?.id ?? null;
}

/** The usual partner for a quick compare: the KJV, or the BSB when reading the KJV. */
export function partnerFor(tr: string, available: readonly Pick<TranslationMeta, 'id'>[]): string | null {
  const want = tr === 'KJV' ? 'BSB' : 'KJV';
  if (available.some((t) => t.id === want)) return want;
  return available.find((t) => t.id !== tr)?.id ?? null;
}

/* ------------------------------------------------------------------------ */
/* Merged model                                                              */
/* ------------------------------------------------------------------------ */

export interface CompareInput {
  tr: string;
  abbr: string;
  name: string;
  alignment: AlignmentKind;
  /** null while the chapter is loading or when it failed: the column stays in place, empty. */
  text: TextChapter | null;
}

export interface CompareColumn {
  index: number;
  tr: string;
  abbr: string;
  name: string;
  alignment: AlignmentKind;
  /** The column has text (false while loading / after an error). */
  available: boolean;
  /** Word-card view: compare key, every unit, this column's verses and translation. */
  model: ChapterModel;
  /** Verse-sheet view: the same data keyed "TR/BOOK/CHAPTER". */
  sheetModel: ChapterModel;
  /** This column's verses by number. */
  verses: Map<number, VerseModel>;
  /** Its units are ids firstUnit … firstUnit + unitCount - 1. */
  firstUnit: number;
  unitCount: number;
}

export interface CompareModel {
  /** WordRef key of the merged unit space ("compare:KJV,BSB/JHN/1"). */
  key: string;
  book: string;
  chapter: number;
  columns: CompareColumn[];
  /** Every unit of every column; `units[i].id === i`. */
  units: Unit[];
  /** Column index of each unit. */
  colOfUnit: number[];
  /** Verse rows in order (union of the columns' verses); 0 = Psalm title. */
  rows: number[];
  /** What the controller and the scrub loupe use (column 0's view; every unit and link). */
  merged: ChapterModel;
}

/** WordRef key of a compare page: "compare:KJV,BSB/JHN/1". */
export function compareKey(trs: readonly string[], book: string, chapter: number): string {
  return chapterKey(`compare:${trs.join(',')}`, book, chapter);
}

function push<K>(map: Map<K, number[]>, k: K, id: number): void {
  const list = map.get(k);
  if (list) list.push(id);
  else map.set(k, [id]);
}

export function buildCompareModel(inputs: readonly CompareInput[], orig: OrigChapter | null, book: string, chapter: number): CompareModel {
  const key = compareKey(
    inputs.map((i) => i.tr),
    book,
    chapter,
  );
  const units: Unit[] = [];
  const colOfUnit: number[] = [];
  const byOrig = new Map<number, number[]>();
  const byKin = new Map<string, number[]>();
  let tokenCount = 0;

  const parts = inputs.map((inp, index) => {
    const m = inp.text
      ? buildChapterModel(inp.text, orig, { alignment: inp.alignment, tr: inp.tr })
      : emptyModel(chapterKey(inp.tr, book, chapter), inp.tr, inp.alignment, book, chapter, orig);
    tokenCount += m.tokenCount;
    const offset = units.length;
    const local = m.units.map((u) => {
      const nu: Unit = { ...u, id: u.id + offset };
      units.push(nu);
      colOfUnit.push(index);
      for (const l of nu.links) push(byOrig, l, nu.id);
      if (nu.kinKey) push(byKin, nu.kinKey, nu.id);
      return nu;
    });
    const remap = (ps: Piece[]): Piece[] => ps.map((p) => (typeof p === 'string' ? p : local[p.id]));
    const verses: VerseModel[] = m.verses.map((v) => ({ ...v, pieces: remap(v.pieces) }));
    const superscription = m.superscription ? remap(m.superscription) : null;
    return { inp, m, verses, superscription, offset, count: local.length };
  });

  const columns: CompareColumn[] = parts.map((p, index) => {
    const model: ChapterModel = {
      ...p.m,
      key,
      units,
      verses: p.verses,
      superscription: p.superscription,
      byOrig,
      byKin,
      tokenCount,
    };
    return {
      index,
      tr: p.inp.tr,
      abbr: p.inp.abbr,
      name: p.inp.name,
      alignment: p.inp.alignment,
      available: Boolean(p.inp.text),
      model,
      sheetModel: { ...model, key: chapterKey(p.inp.tr, book, chapter) },
      verses: new Map(p.verses.map((v) => [v.v, v])),
      firstUnit: p.offset,
      unitCount: p.count,
    };
  });

  const set = new Set<number>();
  let title = false;
  for (const c of columns) {
    if (c.model.superscription?.length) title = true;
    for (const v of c.model.verses) set.add(v.v);
  }
  const rows = [...set].sort((a, b) => a - b);
  if (title) rows.unshift(0);

  return {
    key,
    book,
    chapter,
    columns,
    units,
    colOfUnit,
    rows,
    merged: columns[0]?.model ?? emptyModel(key, '', 'none', book, chapter, orig),
  };
}

function emptyModel(key: string, tr: string, alignment: AlignmentKind, book: string, chapter: number, orig: OrigChapter | null): ChapterModel {
  return {
    key,
    tr,
    book,
    chapter,
    alignment,
    text: { tr, book, chapter, verses: [] },
    orig,
    units: [],
    verses: [],
    superscription: null,
    byOrig: new Map(),
    byKin: new Map(),
    tokenCount: 0,
  };
}

/** Units of other columns that share an original word with `unitId` (the cross-column counterparts). */
export function counterpartUnits(cm: CompareModel, unitId: number): number[] {
  const u = cm.units[unitId];
  if (!u?.links.length) return [];
  const col = cm.colOfUnit[unitId];
  const out = new Set<number>();
  for (const l of u.links) for (const id of cm.merged.byOrig.get(l) ?? []) if (cm.colOfUnit[id] !== col) out.add(id);
  return [...out].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------------ */
/* Grid HTML                                                                 */
/* ------------------------------------------------------------------------ */

const CELL_OPTS = (layout: Layout): RenderOptions => ({ mode: 'reading', layout, headings: false, ilTranslit: false, ilGloss: false });

/** Run-in translation label: the abbreviation on screen (phones), the full name for screen readers. */
export function labelHtml(c: Pick<CompareColumn, 'abbr' | 'name'>): string {
  return `<span class="cmp-lbl"><span class="cmp-lbl__abbr" aria-hidden="true">${escapeHtml(c.abbr)}</span><span class="sr-only">${escapeHtml(c.name)}: </span></span>`;
}

/** Insert `label` right after the opening tag of the first block (<p class="vl"> / <p class="superscription">). */
function withLabel(html: string, label: string): string {
  return html.replace(/^(<p\b[^>]*>)/, `$1${label}`);
}

/**
 * One cell: verse `verse` of a column (0 = the Psalm title) via render.ts, without the per-verse
 * id (it would repeat in every column) and with the run-in label; a muted note when the
 * translation has no such verse (e.g. Matthew 17:21 in the BSB).
 */
export function cellHtml(col: CompareColumn, verse: number, layout: Layout): string {
  if (!col.available) return '';
  const view = col.model;
  const label = labelHtml(col);
  if (verse === 0) {
    if (!view.superscription?.length) return `<p class="cmp-none">${label}<span class="cmp-none__txt">No title in the ${escapeHtml(col.abbr)}</span></p>`;
    return withLabel(renderChapterHtml({ ...view, verses: [], superscription: view.superscription }, CELL_OPTS(layout)), label);
  }
  const vm = col.verses.get(verse);
  if (!vm) {
    return `<p class="vl cmp-none">${label}<span class="cmp-none__txt">Verse ${verse} is not in the ${escapeHtml(col.abbr)}</span></p>`;
  }
  const html = renderChapterHtml({ ...view, verses: [vm], superscription: null }, CELL_OPTS(layout)).replace(/ id="v\d+"/, '');
  return withLabel(html, label);
}

/** A section heading spanning every column (same markup as the reader's). */
export function sectionHtml(h: HeadingInfo, verse: number): string {
  return h.major
    ? `<h2 class="sec sec--major cmp-sec" data-sec="${verse}"><span class="sec__title">${typeset(h.text)}</span></h2>`
    : `<h2 class="sec cmp-sec" data-sec="${verse}"><span class="sec__title">${typeset(h.text)}</span><span class="sec__ref">${h.range}</span></h2>`;
}

/** Section headings of a chapter text (the reader's headingsByVerse), or an empty map. */
export function headingsOf(text: TextChapter | null | undefined): Map<number, HeadingInfo[]> {
  if (!text?.headings?.length) return new Map();
  return headingsByVerse(buildChapterModel(text, null));
}

/** The whole grid: section headings and one row per verse with a cell per column. */
export function compareGridHtml(cm: CompareModel, heads: Map<number, HeadingInfo[]> = new Map()): string {
  const layouts = cm.columns.map((c) => chooseLayout(c.model, 'verses'));
  const done = new Set<number>();
  let html = '';
  for (const v of cm.rows) {
    const hv = v === 0 ? 1 : v;
    if (!done.has(hv)) {
      done.add(hv);
      for (const h of heads.get(hv) ?? []) html += sectionHtml(h, hv);
    }
    html += `<div class="cmp-row${v === 0 ? ' cmp-row--title' : ''}" data-row="${v}">`;
    cm.columns.forEach((c, k) => {
      html += `<div class="cmp-cell${c.available ? '' : ' is-empty'}" data-col="${k}">${cellHtml(c, v, layouts[k])}</div>`;
    });
    html += '</div>';
  }
  return html;
}

/** Plain text of one verse in a chapter (for the verse sheet's compare list); null when absent. */
export function verseText(text: TextChapter, verse: number): string | null {
  const v = text.verses.find((x) => x.v === verse);
  if (!v) return null;
  return v.t
    .map((t) => (typeof t === 'string' ? t : t[0]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
