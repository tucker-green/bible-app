/**
 * Chapter model for the reader: turns a TextChapter (+ its OrigChapter) into interactive "units".
 *
 * A unit is a run of consecutive English WordTokens, separated only by spaces, that point at the
 * same original word(s): "the beginning" -> ἀρχῇ, "In the beginning" -> בְּרֵאשִׁית. Plain strings and
 * words with no original behind them stay plain text. Pure and DOM-free (unit-tested).
 */
import { baseStrongs, normalizeStrongs } from '../../lib/data';
import type { AlignmentKind, OrigChapter, TextChapter, Token } from '../../lib/types';
import { OW } from '../../lib/types';

export type UnitKind =
  /** Linked to one or more words of the OrigChapter. */
  | 'linked'
  /** No word in the OrigChapter, but the translation's own tagging carries a Strong's number (KJV / Textus Receptus). */
  | 'lexicon'
  /** Supplied by the translators (KJV italics): no original word behind it. */
  | 'supplied';

export interface Unit {
  /** Index in ChapterModel.units (rendered as data-u). */
  id: number;
  /** English verse (0 = Psalm superscription). */
  verse: number;
  /** English text of the unit, inner spaces included ("the beginning"). */
  text: string;
  /** Number of English words. */
  wordCount: number;
  kind: UnitKind;
  /** Sorted, de-duplicated indices into OrigChapter.words ([] for lexicon / supplied units). */
  links: number[];
  /** Approximate link: automatic ('bridged') alignment or a confidence below 1. */
  approx: boolean;
  /** Lowest alignment confidence among the unit's tokens (1 when not given). */
  conf: number;
  /** Strong's ids from TokenInfo.s (KJV tagging not matched to an original word), normalised. */
  strongs: string[];
  /** Morphology codes paired with `strongs` (TokenInfo.m). */
  morphs: string[];
  /** Original-language forms paired with `strongs` (TokenInfo.o, e.g. the KJV's Textus Receptus form). */
  forms: string[];
  /** The content word among `links` (index into OrigChapter.words), or -1. */
  primary: number;
  /** Base Strong's id used to find related words ("" = do not mark related words). */
  kinKey: string;
  /** Words of Jesus (TextVerse.wj covers the unit's tokens). */
  wj?: boolean;
}

/** A verse (or superscription) as a sequence of plain text and units. */
export type Piece = string | Unit;

export interface VerseModel {
  v: number;
  pieces: Piece[];
  /**
   * Red letter: wj[i] is true when pieces[i] lies in a TextVerse.wj range (words of Jesus).
   * Present only for verses that have such ranges; units also carry `wj`.
   */
  wj?: boolean[];
}

export interface ChapterModel {
  /** "TR/BOOK/CHAPTER" (matches WordRef.key). */
  key: string;
  tr: string;
  book: string;
  chapter: number;
  alignment: AlignmentKind;
  text: TextChapter;
  orig: OrigChapter | null;
  units: Unit[];
  verses: VerseModel[];
  superscription: Piece[] | null;
  /** Original word index -> units linked to it. */
  byOrig: Map<number, number[]>;
  /** Base Strong's -> units whose content word has it. */
  byKin: Map<string, number[]>;
  /** Total English word tokens (for diagnostics). */
  tokenCount: number;
}

export const chapterKey = (tr: string, book: string, chapter: number): string => `${tr}/${book}/${chapter}`;

/* ------------------------------------------------------------------------ */
/* Content-word ranking                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Rank of a morphology code as "the word to show": lower is more contentful.
 * Greek (Robinson): verbs and nouns 0, adjectives 1, pronouns / adverbs 2, conjunctions /
 * prepositions / particles 3, article 4. Hebrew (OSHB): verbs and nouns 0, adjectives 1,
 * pronouns / adverbs / other particles 2, pronominal suffix 3, prepositions / conjunctions /
 * article 4, object marker 5.
 */
export function contentRank(morph: string, lang: 'grc' | 'hbo'): number {
  const m = morph.trim();
  if (!m) return 3;
  if (lang === 'grc') {
    if (/^(V|N)-/.test(m) || m === 'N-PRI') return 0;
    if (/^A-/.test(m) || /^A-NUI/.test(m)) return 1;
    if (/^T-/.test(m)) return 4;
    if (/^(CONJ|PREP|PRT|COND|INJ)/.test(m)) return 3;
    return 2; // pronouns (P-, R-, D-, C-, X-, Q-, K-, I-, F-, S-), ADV, HEB, ARAM…
  }
  const c = m.replace(/^[HA]/, '').replace(/^.*\//, '');
  const k = c[0];
  if (k === 'V' || k === 'N') return 0;
  if (k === 'A') return 1;
  if (k === 'S') return 3;
  if (k === 'R' || k === 'C') return 4;
  if (c.startsWith('Td')) return 4;
  if (c.startsWith('To')) return 5;
  return 2; // P (pronoun), D (adverb), T (other particles), …
}

/** True for function words whose "related" marks would be noise (articles, conjunctions, prepositions…). */
export function isFunctionWord(morph: string, lang: 'grc' | 'hbo'): boolean {
  return contentRank(morph, lang) >= 3;
}

/** The content word among `links` (ties: first in source order). -1 when there are none. */
export function primaryIndex(orig: OrigChapter | null, links: number[]): number {
  if (!orig || !links.length) return -1;
  const lang = orig.lang;
  let best = -1;
  let bestRank = Infinity;
  for (const i of links) {
    const w = orig.words[i];
    if (!w) continue;
    const r = contentRank(w[OW.morph], lang);
    if (r < bestRank) {
      best = i;
      bestRank = r;
    }
  }
  return best;
}

/* ------------------------------------------------------------------------ */
/* Grouping                                                                  */
/* ------------------------------------------------------------------------ */

const WHITESPACE = /^\s+$/;

export interface Draft {
  key: string;
  /** Words of Jesus (drafts never merge across a red-letter boundary). */
  wj?: boolean;
  kind: UnitKind;
  links: number[];
  conf: number;
  parts: string[];
  words: number;
  strongs: string[];
  morphs: string[];
  forms: string[];
}

function tokenDraft(t: Exclude<Token, string>): Draft | null {
  const [text, rawLinks, info] = t;
  const links = [...new Set(rawLinks)].sort((a, b) => a - b);
  const conf = info?.c ?? 1;
  const strongs = (info?.s ?? []).map((s) => normalizeStrongs(s) ?? s).filter(Boolean);
  let kind: UnitKind;
  let key: string;
  if (links.length) {
    kind = 'linked';
    key = `L${links.join(',')}`;
  } else if (info?.i) {
    kind = 'supplied';
    key = 'S';
  } else if (strongs.length) {
    kind = 'lexicon';
    key = `X${strongs.join(',')}`;
  } else {
    return null;
  }
  return { key, kind, links, conf, parts: [text], words: 1, strongs, morphs: info?.m ?? [], forms: info?.o ?? [] };
}

/** Token indices covered by red-letter ranges ([start, end) end-exclusive). */
function wjSet(ranges: readonly [number, number][] | undefined): Set<number> | null {
  if (!ranges?.length) return null;
  const set = new Set<number>();
  for (const [a, b] of ranges) for (let i = a; i < b; i++) set.add(i);
  return set;
}

/**
 * Group one verse's tokens into pieces; `ctx.makeUnit` turns each finished run into a Unit.
 * With red-letter ranges (`wj`, token indices), runs never cross a red-letter boundary and
 * `flags` (when given) receives one boolean per returned piece.
 * Exported for tests; buildChapterModel() is the normal entry point.
 */
export function groupTokens(tokens: Token[], verse: number, ctx: GroupContext, wj?: readonly [number, number][], flags?: boolean[]): Piece[] {
  const out: Piece[] = [];
  const red = wjSet(wj);
  const fl: boolean[] = [];
  let draft: Draft | null = null;
  let gap = ''; // whitespace seen after the current draft

  const flush = () => {
    if (!draft) return;
    const u = ctx.makeUnit(draft, verse);
    out.push(u);
    fl.push(Boolean(draft.wj));
    draft = null;
  };
  const pushText = (s: string, w: boolean) => {
    if (!s) return;
    const i = out.length - 1;
    const last = out[i];
    if (typeof last === 'string') {
      const blank = WHITESPACE.test(s);
      if (blank || fl[i] === w) {
        out[i] = last + s;
        return;
      }
      if (WHITESPACE.test(last)) {
        out[i] = last + s;
        fl[i] = w;
        return;
      }
    }
    out.push(s);
    fl.push(w);
  };

  tokens.forEach((t, ti) => {
    const w = red ? red.has(ti) : false;
    if (typeof t === 'string') {
      if (draft && WHITESPACE.test(t)) {
        gap += t;
        return;
      }
      flush();
      pushText(gap + t, w);
      gap = '';
      return;
    }
    const d = tokenDraft(t);
    if (!d) {
      flush();
      pushText(gap, w);
      pushText(t[0], w);
      gap = '';
      return;
    }
    if (w) d.wj = true;
    const cur = draft as Draft | null;
    if (cur && cur.key === d.key && Boolean(cur.wj) === w) {
      cur.parts.push(gap, d.parts[0]);
      cur.words += 1;
      cur.conf = Math.min(cur.conf, d.conf);
      gap = '';
      return;
    }
    flush();
    pushText(gap, w);
    gap = '';
    draft = d;
  });
  flush();
  pushText(gap, false);
  if (flags) flags.push(...fl);
  return out;
}

export interface GroupContext {
  makeUnit(d: Draft, verse: number): Unit;
}

/* ------------------------------------------------------------------------ */
/* Chapter model                                                             */
/* ------------------------------------------------------------------------ */

export function buildChapterModel(
  text: TextChapter,
  orig: OrigChapter | null,
  opts: { alignment?: AlignmentKind; tr?: string } = {},
): ChapterModel {
  const alignment = opts.alignment ?? 'manual';
  const bridged = alignment === 'bridged';
  const units: Unit[] = [];
  const byOrig = new Map<number, number[]>();
  const byKin = new Map<string, number[]>();
  let tokenCount = 0;
  const lang = orig?.lang ?? 'grc';

  const ctx: GroupContext = {
    makeUnit(d, verse) {
      const id = units.length;
      const primary = d.kind === 'linked' ? primaryIndex(orig, d.links) : -1;
      let kinKey = '';
      if (primary >= 0 && orig) {
        const w = orig.words[primary];
        const sid = w[OW.strongs];
        if (sid && !isFunctionWord(w[OW.morph], lang)) kinKey = baseStrongs(sid);
      } else if (d.kind === 'lexicon' && d.strongs[0]) {
        const m = d.morphs[0] ?? '';
        if (!isFunctionWord(m, d.strongs[0][0] === 'H' ? 'hbo' : 'grc')) kinKey = baseStrongs(d.strongs[0]);
      }
      const unit: Unit = {
        id,
        verse,
        text: d.parts.join(''),
        wordCount: d.words,
        kind: d.kind,
        links: d.links,
        approx: d.kind !== 'supplied' && (bridged || d.conf < 1),
        conf: d.conf,
        strongs: d.strongs,
        morphs: d.morphs,
        forms: d.forms,
        primary,
        kinKey,
      };
      if (d.wj) unit.wj = true;
      units.push(unit);
      for (const l of d.links) {
        const list = byOrig.get(l);
        if (list) list.push(id);
        else byOrig.set(l, [id]);
      }
      if (kinKey) {
        const list = byKin.get(kinKey);
        if (list) list.push(id);
        else byKin.set(kinKey, [id]);
      }
      return unit;
    },
  };

  const count = (tokens: Token[]) => {
    for (const t of tokens) if (typeof t !== 'string') tokenCount++;
  };

  let superscription: Piece[] | null = null;
  if (text.superscription?.length) {
    count(text.superscription);
    superscription = groupTokens(text.superscription, 0, ctx);
  }
  const verses: VerseModel[] = text.verses.map((v) => {
    count(v.t);
    if (!v.wj?.length) return { v: v.v, pieces: groupTokens(v.t, v.v, ctx) };
    const flags: boolean[] = [];
    const pieces = groupTokens(v.t, v.v, ctx, v.wj, flags);
    return { v: v.v, pieces, wj: flags };
  });

  return {
    key: chapterKey(opts.tr ?? text.tr, text.book, text.chapter),
    tr: opts.tr ?? text.tr,
    book: text.book,
    chapter: text.chapter,
    alignment,
    text,
    orig,
    units,
    verses,
    superscription,
    byOrig,
    byKin,
    tokenCount,
  };
}

/* ------------------------------------------------------------------------ */
/* Relations                                                                 */
/* ------------------------------------------------------------------------ */

/** Units that share at least one original word with `unitId` (the unit itself included). */
export function linkedUnits(model: ChapterModel, unitId: number): number[] {
  const u = model.units[unitId];
  if (!u) return [];
  if (!u.links.length) return [unitId];
  const set = new Set<number>([unitId]);
  for (const l of u.links) for (const id of model.byOrig.get(l) ?? []) set.add(id);
  return [...set].sort((a, b) => a - b);
}

/**
 * "Related" units: other units in the chapter whose content word has the same base Strong's
 * number, excluding the units linked to the same original word(s).
 */
export function relatedUnits(model: ChapterModel, unitId: number): number[] {
  const u = model.units[unitId];
  if (!u?.kinKey) return [];
  const linked = new Set(linkedUnits(model, unitId));
  return (model.byKin.get(u.kinKey) ?? []).filter((id) => !linked.has(id));
}

/* ------------------------------------------------------------------------ */
/* Original-language text of a unit                                          */
/* ------------------------------------------------------------------------ */

export interface OrigSpan {
  /** Linked morphemes of one written word, joined. */
  text: string;
  translit: string;
  gloss: string;
}

/** Strip Macula gloss notation: "makes.me.lie.down" -> "makes me lie down", drop "(et)" / "[…]" markers. */
export function cleanGloss(g: string): string {
  return g
    .replace(/\((?:et|obj)\)/gi, '')
    .replace(/\[direct object\]/gi, '')
    .replace(/[[\]]/g, '')
    .replace(/(\p{L})\.(?=\p{L})/gu, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The original words a unit links to, grouped by written word (Hebrew morphemes of one word are
 * joined without a space), in source order.
 */
export function unitOrigWords(orig: OrigChapter, links: number[]): OrigSpan[] {
  const out: OrigSpan[] = [];
  let lastGroup = -1;
  for (const i of links) {
    const w = orig.words[i];
    if (!w) continue;
    const g = w[OW.group];
    const gloss = cleanGloss(w[OW.gloss]);
    if (orig.lang === 'hbo' && g === lastGroup && out.length) {
      const cur = out[out.length - 1];
      cur.text += w[OW.text];
      cur.translit += w[OW.translit];
      if (gloss) cur.gloss = cur.gloss ? `${cur.gloss} ${gloss}` : gloss;
    } else {
      out.push({ text: w[OW.text], translit: w[OW.translit], gloss });
    }
    lastGroup = g;
  }
  return out;
}
