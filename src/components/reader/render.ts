/**
 * Chapter -> HTML string. The reader sets this once per (translation, chapter, mode) with
 * innerHTML: every word is a plain <span data-u> (no per-word components or listeners), so even
 * Psalm 119 (~2,500 tokens) renders in a few milliseconds. All text is escaped here.
 *
 * Pure and DOM-free (unit-tested).
 */
import { transliterate } from '../../lib/greek';
import type { ChapterModel, Piece, Unit } from './model';
import { unitOrigWords } from './model';

export type Layout = 'paragraphs' | 'verses' | 'poetry';

export interface RenderOptions {
  mode: 'reading' | 'interlinear';
  layout: Layout;
  headings: boolean;
  ilTranslit: boolean;
  ilGloss: boolean;
}

/* ------------------------------------------------------------------------ */
/* Text helpers                                                              */
/* ------------------------------------------------------------------------ */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Escape, then set the divine name (LORD, GOD — YHWH in the OT) in small capitals. */
export function typeset(s: string): string {
  return escapeHtml(s).replace(
    /\b([LG])(ORD|OD)((?:[’']|&#39;)S)?\b/g,
    (_m, first: string, rest: string, poss: string | undefined) => `${first}<span class="sc">${rest}${poss ?? ''}</span>`,
  );
}

/** Poetic books: one verse per line, split into cola. */
const POETRY = new Set(['PSA', 'PRO', 'SNG', 'LAM', 'JOB']);

/** Which layout to use for a chapter. */
export function chooseLayout(model: ChapterModel, pref: 'auto' | 'paragraphs' | 'verses'): Layout {
  if (pref === 'verses') return POETRY.has(model.book) ? 'poetry' : 'verses';
  if (POETRY.has(model.book)) return 'poetry';
  if (pref === 'paragraphs') return 'paragraphs';
  return model.text.paras ? 'paragraphs' : 'verses';
}

/** "1:1–5" / "1:6" */
export function headingRange(chapter: number, from: number, to: number): string {
  return to > from ? `${chapter}:${from}–${to}` : `${chapter}:${from}`;
}

export interface HeadingInfo {
  text: string;
  /** Verse range covered ("1:1–5"); "" for a major heading stacked over a section heading. */
  range: string;
  major: boolean;
}

/**
 * Headings keyed by verse, each with the verse range it covers. When several headings start at
 * the same verse (Psalm 119: "Your Word Is a Lamp to My Feet" + "Aleph"), the earlier ones are
 * major headings without a range; the last one is the section heading.
 */
export function headingsByVerse(model: ChapterModel): Map<number, HeadingInfo[]> {
  const out = new Map<number, HeadingInfo[]>();
  const hs = model.text.headings ?? [];
  const lastVerse = model.text.verses[model.text.verses.length - 1]?.v ?? 1;
  hs.forEach(([v, text], i) => {
    const next = hs.slice(i + 1).find(([nv]) => nv > v);
    const to = next ? next[0] - 1 : lastVerse;
    const list = out.get(v) ?? [];
    list.push({ text, range: headingRange(model.chapter, v, to), major: false });
    out.set(v, list);
  });
  for (const list of out.values()) {
    for (let i = 0; i < list.length - 1; i++) {
      list[i].major = true;
      list[i].range = '';
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Units                                                                     */
/* ------------------------------------------------------------------------ */

function unitClass(u: Unit, extra = ''): string {
  let c = 'w';
  if (u.kind === 'supplied') c += ' w--sup';
  else if (u.kind === 'lexicon') c += ' w--lex';
  if (u.approx) c += ' w--approx';
  return extra ? `${c} ${extra}` : c;
}

function unitAttrs(u: Unit, firstId: number): string {
  return `data-u="${u.id}" tabindex="${u.id === firstId ? 0 : -1}"`;
}

function readingPieces(pieces: Piece[], firstId: number): string {
  let html = '';
  for (const p of pieces) {
    if (typeof p === 'string') html += typeset(p);
    else html += `<span class="${unitClass(p)}" ${unitAttrs(p, firstId)}>${typeset(p.text)}</span>`;
  }
  return html;
}

/** Split a verse's pieces into poetic cola after ";" or ":" (followed by a space). */
export function splitCola(pieces: Piece[]): Piece[][] {
  const cola: Piece[][] = [[]];
  for (const p of pieces) {
    if (typeof p !== 'string') {
      cola[cola.length - 1].push(p);
      continue;
    }
    let rest = p;
    const re = /[;:]\s+/;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) {
      const cut = m.index + 1;
      cola[cola.length - 1].push(rest.slice(0, cut));
      cola.push([]);
      rest = rest.slice(cut + m[0].length - 1);
    }
    if (rest) cola[cola.length - 1].push(rest);
  }
  return cola.filter((c) => c.some((p) => typeof p !== 'string' || p.trim()));
}

/* ------------------------------------------------------------------------ */
/* Interlinear                                                               */
/* ------------------------------------------------------------------------ */

export interface IlCell {
  unit: Unit | null;
  /** English text including attached punctuation ("Word," / "“Let"). */
  en: string;
}

/**
 * Interlinear cells for a verse: every unit and every plain word becomes a cell; punctuation sticks
 * to the neighbouring English (closing marks to the previous cell, opening marks to the next).
 */
export function interlinearCells(pieces: Piece[]): IlCell[] {
  const cells: IlCell[] = [];
  let prefix = '';
  for (const p of pieces) {
    if (typeof p !== 'string') {
      cells.push({ unit: p, en: prefix + p.text });
      prefix = '';
      continue;
    }
    // Split into whitespace-separated chunks, remembering whether each touched the previous cell.
    const re = /(\s*)(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p))) {
      const [, space, chunk] = m;
      const hasWord = /[\p{L}\p{N}]/u.test(chunk);
      const touchesPrev = !space && m.index === 0;
      if (hasWord) {
        cells.push({ unit: null, en: prefix + chunk });
        prefix = '';
      } else if (touchesPrev && cells.length && !prefix) {
        cells[cells.length - 1].en += chunk;
      } else if (/^[,.;:!?’”)\]»…—–-]+$/.test(chunk) && cells.length && !prefix) {
        // a closing mark after a space (rare): still belongs to the previous word
        cells[cells.length - 1].en += chunk;
      } else {
        prefix += chunk;
      }
    }
  }
  if (prefix) {
    if (cells.length) cells[cells.length - 1].en += prefix;
    else cells.push({ unit: null, en: prefix });
  }
  return cells;
}

function ilCellHtml(model: ChapterModel, cell: IlCell, opts: RenderOptions, firstId: number): string {
  const u = cell.unit;
  const en = `<span class="il__en">${typeset(cell.en)}</span>`;
  if (!u) return `<span class="il il--plain">${en}</span>`;
  const orig = model.orig;
  let or = '';
  let tr = '';
  let gl = '';
  if (u.kind === 'linked' && orig) {
    const spans = unitOrigWords(orig, u.links);
    const text = spans.map((s) => s.text).join(' ');
    const lang = orig.lang;
    const attrs = lang === 'hbo' ? 'lang="he" dir="rtl"' : 'lang="grc"';
    or = `<span class="il__or" ${attrs}>${escapeHtml(text)}</span>`;
    if (opts.ilTranslit) {
      const t = lang === 'grc' ? transliterate(text) : spans.map((s) => s.translit).join(' ');
      tr = `<span class="il__tr">${escapeHtml(t)}</span>`;
    }
    if (opts.ilGloss) gl = `<span class="il__gl">${escapeHtml(spans.map((s) => s.gloss).filter(Boolean).join(' '))}</span>`;
  } else if (u.kind === 'lexicon') {
    const form = u.forms.join(' ');
    or = form
      ? `<span class="il__or il__or--tr" lang="grc">${escapeHtml(form)}</span>`
      : `<span class="il__or il__or--none">${escapeHtml(u.strongs.join(' '))}</span>`;
    if (opts.ilTranslit) tr = `<span class="il__tr">${form ? escapeHtml(transliterate(form)) : ''}</span>`;
  } else {
    or = '<span class="il__or il__or--none" aria-hidden="true">—</span>';
  }
  const multi = u.wordCount > 1 ? ' il--multi' : '';
  return `<span class="${unitClass(u, `il${multi}`)}" ${unitAttrs(u, firstId)}>${en}${or}${tr}${gl}</span>`;
}

function ilPieces(model: ChapterModel, pieces: Piece[], opts: RenderOptions, firstId: number): string {
  return interlinearCells(pieces)
    .map((c) => ilCellHtml(model, c, opts, firstId))
    .join('');
}

/* ------------------------------------------------------------------------ */
/* Chapter                                                                   */
/* ------------------------------------------------------------------------ */

function vn(v: number): string {
  return `<span class="vn" aria-hidden="true">${v}</span><span class="sr-only">Verse ${v}. </span>`;
}

/** The whole prose block (headings, superscription, paragraphs) as HTML. */
export function renderChapterHtml(model: ChapterModel, opts: RenderOptions): string {
  const il = opts.mode === 'interlinear';
  const firstId = model.units.length ? 0 : -1;
  const heads = opts.headings ? headingsByVerse(model) : new Map<number, HeadingInfo[]>();
  const paras = new Set(model.text.paras ?? []);
  const layout = opts.layout;
  let html = '';
  let open = false;
  const blockClose = il ? '</div>' : '</p>';
  const close = () => {
    if (open) html += blockClose;
    open = false;
  };

  const headingHtml = (v: number) =>
    (heads.get(v) ?? [])
      .map((h) =>
        h.major
          ? `<h2 class="sec sec--major" data-sec="${v}"><span class="sec__title">${typeset(h.text)}</span></h2>`
          : `<h2 class="sec" data-sec="${v}"><span class="sec__title">${typeset(h.text)}</span><span class="sec__ref">${h.range}</span></h2>`,
      )
      .join('');

  const supHtml = () => {
    if (!model.superscription) return '';
    return il
      ? `<div class="il-para il-para--sup" data-v="0">${ilPieces(model, model.superscription, opts, firstId)}</div>`
      : `<p class="superscription" data-v="0">${readingPieces(model.superscription, firstId)}</p>`;
  };

  let supDone = false;
  model.verses.forEach((V, i) => {
    const v = V.v;
    const hasHeading = heads.has(v);
    const startsPara = i === 0 || hasHeading || layout !== 'paragraphs' || paras.has(v);
    if (startsPara) {
      close();
      html += headingHtml(v);
      if (!supDone) {
        html += supHtml();
        supDone = true;
      }
      const first = i === 0 || hasHeading;
      if (il) {
        html += `<div class="il-para${first ? ' first' : ''}">`;
      } else if (layout === 'paragraphs') {
        html += `<p class="para${first ? ' first' : ''}">`;
      } else {
        html += `<p class="vl${layout === 'poetry' ? ' vl--poetry' : ''}">`;
      }
      open = true;
    } else if (!il) {
      html += ' ';
    }
    let body: string;
    if (il) body = ilPieces(model, V.pieces, opts, firstId);
    else if (layout === 'poetry')
      body = splitCola(V.pieces)
        .map((c, ci) => `<span class="colon${ci ? ' cont' : ''}">${readingPieces(c, firstId).trim()}</span>`)
        .join('');
    else body = readingPieces(V.pieces, firstId).replace(/\s+$/, '');
    html += `<span class="verse" id="v${v}" data-v="${v}">${vn(v)}${body}</span>`;
  });
  close();
  if (!supDone) html = supHtml() + html;
  return html;
}
