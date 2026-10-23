/**
 * Stage "bsb": the Berean Standard Bible text with word links -> public/data/text/BSB/{BOOK}/{C}.json
 *
 *  - Verse text and tokenisation: Clear-Bible's BSB target TSVs (nt_BSB.tsv / ot_BSB.tsv).
 *  - Word links: Clear-Bible's manual BSB<->SBLGNT/WLC alignment; link indices point into the
 *    same English chapter's OrigChapter.words, laid out exactly as the orig stage does
 *    (`computeOrigLayout`).
 *  - Psalm titles (English verse 000) become TextChapter.superscription. The manual alignment
 *    leaves titles unaligned (and ~20 verses with no aligned word), so those words are linked by a
 *    small statistical aligner (association learned from the manual alignment + title
 *    co-occurrence + gloss match + word position); such tokens carry a confidence `c` (0.3-0.9).
 *  - Section headings and paragraph starts: the 2016 Berean Study Bible USFX (same versification).
 *    Only headings / paragraph breaks are taken from it, never verse text.
 */
import { existsSync, readFileSync } from 'node:fs';
import { foldWord } from '../../src/lib/tokenize';
import type { OrigChapter, TextChapter, TextVerse, Token, TokenInfo, WordToken } from '../../src/lib/types';
import { OW } from '../../src/lib/types';
import {
  allChapters,
  cleanOut,
  log,
  outPath,
  readJson,
  srcPath,
  writeJson,
  type AlignRecord,
  type BsbTokenRow,
  type Testament,
} from './common';
import { computeOrigLayout } from './orig';

/* ------------------------------------------------------------------------ */
/* Verse text                                                                */
/* ------------------------------------------------------------------------ */

/** Tokens that never take a space before them: closing punctuation, closing quotes, em dash, ellipsis. */
const NO_SPACE_BEFORE = /^(?:[,.;:?!)\]”’—…]|\.\.\.)/;
/** Tokens that never take a space after them: opening quotes and brackets. */
const NO_SPACE_AFTER = /[“‘([]$/;

/**
 * Give each source token its trailing space so that joining them reads naturally:
 * a space follows a token unless the source flags skip_space_after, the token opens a quote or
 * bracket, or the next token is closing punctuation / an em dash. The last token gets none.
 */
export function spaceTokens(tokens: readonly { text: string; skip: boolean }[]): string[] {
  return tokens.map((t, i) => {
    const next = tokens[i + 1];
    if (!next || t.skip || NO_SPACE_AFTER.test(t.text) || NO_SPACE_BEFORE.test(next.text)) return t.text;
    return t.text + ' ';
  });
}

/** The verse text the BSB stage renders for these source tokens. */
export function verseText(tokens: readonly { text: string; skip: boolean }[]): string {
  return spaceTokens(tokens).join('');
}

/**
 * Turn spaced token texts + per-token links into Token[]: linked words become WordTokens
 * ([word, links, info?]); trailing spaces, punctuation and unlinked words are merged into
 * plain strings. Joining every token's text reproduces `spaced.join('')`.
 */
export function buildTokens(
  spaced: readonly string[],
  links: readonly (number[] | undefined)[],
  infos?: readonly (TokenInfo | undefined)[],
): Token[] {
  const out: Token[] = [];
  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (typeof last === 'string') out[out.length - 1] = last + s;
    else out.push(s);
  };
  spaced.forEach((text, i) => {
    const l = links[i];
    if (!l || !l.length) return pushText(text);
    const word = text.trimEnd();
    const tok: WordToken = [word, l];
    const info = infos?.[i];
    if (info && Object.keys(info).length) tok.push(info);
    out.push(tok);
    pushText(text.slice(word.length));
  });
  return out;
}

/** Plain text of a token list. */
export const tokensText = (tokens: readonly Token[]) => tokens.map((t) => (typeof t === 'string' ? t : t[0])).join('');

/* ------------------------------------------------------------------------ */
/* Headings and paragraphs from the BSB USFX                                 */
/* ------------------------------------------------------------------------ */

export interface ChapterLayout {
  headings: [number, string][];
  paras: number[];
}

/** Elements whose text is never verse text or a heading. */
const SKIP_ELEMENTS = new Set(['f', 'x', 'fe', 'id', 'h', 'toc', 'd', 'rem', 'fig', 'languageCode', 'ide', 'cl', 'cp', 'ca', 'va', 'vp']);
/** <p> styles that are not body text (titles, cross-reference lines, section ranges). */
const SKIP_P = new Set(['r', 'mt', 'mt1', 'mt2', 'mt3', 'mr', 'sr', 'cl', 'd', 'imt', 'is', 'ip', 'ie']);
/** <p> styles that act as headings. */
const HEADING_P = new Set(['qa', 'ms', 'ms1', 'ms2']);

/** "ALEPH" -> "Aleph", "SIN and SHIN" -> "Sin and Shin", "BOOK II" -> "Book II". */
export function titleCase(s: string): string {
  return s.replace(/\p{L}+/gu, (w) => {
    if (/^[IVX]+$/.test(w) || w !== w.toUpperCase()) return w; // Roman numerals, words already cased
    return w[0] + w.slice(1).toLowerCase();
  });
}

/** Parse the USFX into per-chapter headings and paragraph-start verses. Keyed "BOOK C" (e.g. "GEN 1"). */
export function parseUsfxLayout(xml: string): Map<string, ChapterLayout> {
  const out = new Map<string, ChapterLayout>();
  const chapterOf = (key: string) => {
    let c = out.get(key);
    if (!c) out.set(key, (c = { headings: [], paras: [] }));
    return c;
  };
  type Frame = { name: string; mode: 'normal' | 'skip' | 'heading'; style?: string };
  const stack: Frame[] = [];
  let skipDepth = 0;
  let heading: { text: string; style: string } | undefined;
  let pendingHeadings: string[] = [];
  let pendingPara = true;
  let lastBlock: 'p' | 'q' | '' = '';

  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w:]*)((?:\s+[^\s=>/]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  const attrs = (s: string) => {
    const a: Record<string, string> = {};
    for (const m of s.matchAll(/([^\s=]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = m[2];
    return a;
  };
  for (const m of xml.matchAll(re)) {
    const [, close, name, attrText, selfClose, text] = m;
    if (text !== undefined) {
      if (skipDepth) continue;
      if (heading) heading.text += text;
      else if (text.trim()) pendingPara = false;
      continue;
    }
    if (!name) continue; // comment / processing instruction
    if (close) {
      const frame = stack.pop();
      if (!frame) continue;
      if (frame.mode === 'skip') skipDepth--;
      if (frame.mode === 'heading' && heading) {
        const h = heading.text.replace(/\s+/g, ' ').trim();
        const cased = heading.style === 's' ? h : titleCase(h);
        if (h && !/^\(.*\)$/.test(h)) pendingHeadings.push(cased);
        heading = undefined;
        pendingPara = true;
      }
      if (frame.name === 'p' && frame.mode === 'normal') lastBlock = 'p';
      continue;
    }
    const a = attrs(attrText ?? '');
    if (selfClose) {
      if (skipDepth) continue;
      if (name === 'c' || name === 'b') pendingPara = true;
      if (name === 'v') {
        const bcv = /^([0-9A-Z]{3})\.(\d+)\.(\d+)$/.exec(a.bcv ?? '');
        if (!bcv) continue;
        const verse = Number(bcv[3]);
        const ch = chapterOf(`${bcv[1]} ${Number(bcv[2])}`);
        for (const h of pendingHeadings) ch.headings.push([verse, h]);
        pendingHeadings = [];
        if (pendingPara && verse !== 1) ch.paras.push(verse);
        pendingPara = false;
      }
      continue;
    }
    let mode: Frame['mode'] = 'normal';
    const sfm = a.sfm ?? a.style ?? '';
    if (SKIP_ELEMENTS.has(name) || (name === 'p' && SKIP_P.has(sfm))) mode = 'skip';
    else if (name === 's' || (name === 'p' && HEADING_P.has(sfm))) mode = 'heading';
    if (skipDepth) mode = 'skip';
    stack.push({ name, mode });
    if (mode === 'skip') {
      skipDepth++;
      continue;
    }
    if (mode === 'heading') {
      heading = { text: '', style: name === 's' ? 's' : sfm };
      continue;
    }
    if (name === 'p') {
      pendingPara = true;
      lastBlock = 'p';
    } else if (name === 'q') {
      if (lastBlock === 'p') pendingPara = true;
      lastBlock = 'q';
    }
  }
  for (const c of out.values()) c.paras = [...new Set(c.paras)].sort((x, y) => x - y);
  return out;
}

/* ------------------------------------------------------------------------ */
/* Psalm-title aligner                                                       */
/* ------------------------------------------------------------------------ */

/** Co-occurrence counts between Strong's ids and (folded) English words over alignment units. */
export class AssocTable {
  private pair = new Map<string, number>();
  private bySrc = new Map<string, number>();
  private byEng = new Map<string, number>();

  /** Record one unit (an alignment record, or a whole Psalm title): its Strong's ids and English words. */
  add(strongs: Iterable<string>, english: Iterable<string>): void {
    const S = new Set(strongs);
    const E = new Set(english);
    for (const s of S) this.bySrc.set(s, (this.bySrc.get(s) ?? 0) + 1);
    for (const e of E) this.byEng.set(e, (this.byEng.get(e) ?? 0) + 1);
    for (const s of S) for (const e of E) this.pair.set(`${s} ${e}`, (this.pair.get(`${s} ${e}`) ?? 0) + 1);
  }

  private counts(strongs: string, english: string): [both: number, src: number, eng: number] {
    return [this.pair.get(`${strongs} ${english}`) ?? 0, this.bySrc.get(strongs) ?? 0, this.byEng.get(english) ?? 0];
  }

  /** Number of units containing this English word. */
  englishCount(english: string): number {
    return this.byEng.get(english) ?? 0;
  }

  /** sqrt(P(english | strongs) * P(strongs | english)): high only when each predicts the other. */
  geo(strongs: string, english: string): number {
    const [c, s, e] = this.counts(strongs, english);
    return c ? Math.sqrt((c / s) * (c / e)) : 0;
  }

  /** Dice coefficient 2c / (n_s + n_e), or 0 when they co-occur fewer than `minCount` times. */
  dice(strongs: string, english: string, minCount = 2): number {
    const [c, s, e] = this.counts(strongs, english);
    return c >= minCount ? (2 * c) / (s + e) : 0;
  }
}

export interface TitleWord {
  strongs: string;
  gloss: string;
  /** Morphology code; a Hebrew preposition with the article fused in ("Rd") also matches "the". */
  morph?: string;
}

/** Words of an original word's gloss (plus "the" for a preposition carrying the article). */
export function glossWords(w: TitleWord): Set<string> {
  const set = new Set(w.gloss.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean));
  if (w.morph && /^R.*d$/.test(w.morph)) set.add('the');
  return set;
}

/**
 * Link each English word of an unaligned passage (a Psalm title) to its most likely original word.
 * `assoc(foldedEnglish, j)` scores English word vs original word j in 0..1; the score is damped by
 * the difference in relative position, and links whose association is below `minScore` are dropped.
 * Returns, per English word, [index into the original words, confidence] or undefined.
 */
export function alignByAssociation(
  english: readonly string[],
  origCount: number,
  assoc: (english: string, j: number) => number,
  minScore = 0.35,
): ([number, number] | undefined)[] {
  // How far (in relative position) a determiner may sit from the article it links to.
  const window = Math.max(DETERMINER_WINDOW, 1.5 / Math.max(1, english.length - 1));
  const out = english.map((word, i): [number, number] | undefined => {
    const e = foldWord(word);
    const relE = english.length > 1 ? i / (english.length - 1) : 0;
    const determiner = DETERMINERS.has(e);
    let best: [number, number] | undefined;
    let bestScore = 0;
    for (let j = 0; j < origCount; j++) {
      const a = assoc(e, j);
      if (a < minScore) continue;
      const relH = origCount > 1 ? j / (origCount - 1) : 0;
      const d = Math.abs(relE - relH);
      if (determiner && d > window) continue; // an article far away is not this one
      const s = a * (1 - 0.6 * d);
      if (s > bestScore) {
        bestScore = s;
        best = [j, Math.round(Math.min(0.9, a) * 100) / 100];
      }
    }
    return best;
  });
  // "the servant": a determiner with no article of its own goes with the word it introduces.
  for (let i = out.length - 2; i >= 0; i--) {
    const next = out[i + 1];
    if (!out[i] && next && DETERMINERS.has(foldWord(english[i]))) out[i] = [next[0], Math.min(next[1], 0.5)];
  }
  return out;
}

const DETERMINERS = new Set(['the', 'a', 'an']);
/** Min. allowed distance (relative position, 0..1) between a determiner and the article it links to. */
const DETERMINER_WINDOW = 0.15;

/* ------------------------------------------------------------------------ */
/* Build                                                                     */
/* ------------------------------------------------------------------------ */

const IS_WORD = /[\p{L}\p{N}]/u;
/** English words aligned fewer times than this in the whole OT count as "rare" for the title aligner. */
const RARE_ENGLISH = 200;

export function buildBsb(): void {
  cleanOut('text', 'BSB');
  const usfx = parseUsfxLayout(readFileSync(srcPath('bsb.usfx.xml'), 'utf8'));
  const chapters = allChapters();
  let files = 0;
  let bytes = 0;
  let linked = 0;
  let words = 0;
  let dropped = 0;
  let titleLinked = 0;
  let titleWords = 0;
  let gapVerses = 0;
  let gapWords = 0;
  let gapLinked = 0;
  let verses = 0;

  for (const t of ['NT', 'OT'] as const satisfies readonly Testament[]) {
    const layout = computeOrigLayout(t);

    // Orig output must match the layout we just recomputed (same sources, same rules).
    const orig = new Map<string, OrigChapter>();
    for (const { book, chapter, key } of chapters) {
      if (book.testament !== t) continue;
      const p = outPath('orig', book.id, `${chapter}.json`);
      if (!existsSync(p)) throw new Error(`Missing ${p}; run the orig stage first.`);
      const oc = readJson<OrigChapter>(p);
      const expect = layout.chapters.get(key)?.length ?? 0;
      if (oc.words.length !== expect) throw new Error(`${book.id} ${chapter}: orig has ${oc.words.length} words, layout ${expect}; re-run the orig stage.`);
      orig.set(key, oc);
    }

    // target token id -> source ids
    const tgtToSrc = new Map<string, string[]>();
    for (const [src, tgt] of layout.records) {
      for (const id of tgt) {
        const list = tgtToSrc.get(id);
        if (list) list.push(...src);
        else tgtToSrc.set(id, [...src]);
      }
    }

    const assoc = learnAssociations(layout.records, layout.pos, orig, layout.bsb);

    // group tokens by chapter, then verse
    const byChapter = new Map<string, Map<number, BsbTokenRow[]>>();
    for (const tok of layout.bsb) {
      const ck = tok.id.slice(0, 5);
      let vm = byChapter.get(ck);
      if (!vm) byChapter.set(ck, (vm = new Map()));
      const v = Number(tok.id.slice(5, 8));
      let list = vm.get(v);
      if (!list) vm.set(v, (list = []));
      list.push(tok);
    }

    for (const { book, chapter, key } of chapters) {
      if (book.testament !== t) continue;
      const vm = byChapter.get(key);
      if (!vm) throw new Error(`BSB has no text for ${book.id} ${chapter}`);
      const origWords = orig.get(key)!.words;

      const linksOf = (tok: BsbTokenRow): number[] | undefined => {
        if (tok.exclude) return undefined;
        const src = tgtToSrc.get(tok.id);
        if (!src) return undefined;
        const idx = new Set<number>();
        for (const s of src) {
          const p = layout.pos.get(s);
          if (!p) continue;
          if (p[0] !== key) {
            dropped++;
            continue;
          }
          idx.add(p[1]);
        }
        return idx.size ? [...idx].sort((x, y) => x - y) : undefined;
      };

      const out: TextChapter = { tr: 'BSB', book: book.id, chapter, verses: [] };
      const verseNums = [...vm.keys()].sort((x, y) => x - y);
      const manual = new Map(verseNums.map((v) => [v, vm.get(v)!.map(linksOf)]));
      const linkedIdx = new Set<number>();
      for (const ls of manual.values()) for (const l of ls) l?.forEach((i) => linkedIdx.add(i));

      for (const v of verseNums) {
        const toks = vm.get(v)!;
        const spaced = spaceTokens(toks);
        const links = manual.get(v)!;
        const infos: (TokenInfo | undefined)[] = toks.map(() => undefined);
        const wordPos = toks.map((tk, i) => (!tk.exclude && IS_WORD.test(tk.text) ? i : -1)).filter((i) => i >= 0);

        // No manual links at all (Psalm titles, a handful of alignment gaps): link by association
        // to this verse's original words that nothing else links to, flagged with a confidence.
        if (!links.some(Boolean)) {
          const cand = origWords.map((w, i) => (w[OW.verse] === v && !linkedIdx.has(i) ? i : -1)).filter((i) => i >= 0);
          if (cand.length) {
            const tw: TitleWord[] = cand.map((i) => ({ strongs: origWords[i][OW.strongs], gloss: origWords[i][OW.gloss], morph: origWords[i][OW.morph] }));
            const gw = tw.map(glossWords);
            const aligned = alignByAssociation(wordPos.map((i) => toks[i].text), tw.length, (e, j) => {
              const st = tw[j].strongs;
              // Title co-occurrence only for words that are rare elsewhere (choirmaster, Maskil, ascents),
              // never for function words, which co-occur with everything in formulaic titles.
              const titleScore = v === 0 && st && assoc.global.englishCount(e) < RARE_ENGLISH ? assoc.titles.dice(st, e, 3) : 0;
              return Math.max(gw[j].has(e) ? 0.8 : 0, st ? assoc.global.geo(st, e) : 0, titleScore);
            });
            aligned.forEach((al, k) => {
              if (!al) return;
              links[wordPos[k]] = [cand[al[0]]];
              infos[wordPos[k]] = { c: al[1] };
            });
          }
          const n = wordPos.filter((i) => links[i]).length;
          if (v === 0) {
            titleWords += wordPos.length;
            titleLinked += n;
          } else {
            gapVerses++;
            gapLinked += n;
            gapWords += wordPos.length;
          }
        }

        if (v === 0) {
          out.superscription = buildTokens(spaced, links, infos);
          continue;
        }
        words += wordPos.length;
        linked += wordPos.filter((i) => links[i]).length;
        const verse: TextVerse = { v, t: buildTokens(spaced, links, infos) };
        out.verses.push(verse);
        verses++;
      }

      const lay = usfx.get(`${book.id} ${chapter}`);
      if (lay) {
        const present = new Set(out.verses.map((x) => x.v));
        const headings = lay.headings.filter(([v]) => present.has(v));
        const paras = lay.paras.filter((v) => present.has(v) && v !== 1);
        if (headings.length) out.headings = headings;
        if (paras.length) out.paras = paras;
      }
      bytes += writeJson(outPath('text', 'BSB', book.id, `${chapter}.json`), out);
      files++;
    }
  }
  log(
    'bsb',
    `${files} chapters, ${verses} verses; ${linked}/${words} words linked (${((100 * linked) / words).toFixed(1)}%); ` +
      `by association: Psalm titles ${titleLinked}/${titleWords} words, ${gapVerses} unaligned verses ${gapLinked}/${gapWords} words; ` +
      `${dropped} cross-chapter links dropped; ${(bytes / 1e6).toFixed(1)} MB`,
  );
}

/**
 * Association tables for the title aligner: `global` from every manual OT alignment record,
 * `titles` from co-occurrence across the Psalm titles themselves (formulaic: "For the choirmaster",
 * "A Psalm of David", "Maskil", "sons of Korah"...).
 */
function learnAssociations(
  records: readonly AlignRecord[],
  pos: ReadonlyMap<string, [string, number]>,
  orig: ReadonlyMap<string, OrigChapter>,
  bsb: readonly BsbTokenRow[],
): { global: AssocTable; titles: AssocTable } {
  const text = new Map<string, string>();
  for (const tk of bsb) if (!tk.exclude && IS_WORD.test(tk.text)) text.set(tk.id, tk.text);
  const global = new AssocTable();
  for (const [src, tgt] of records) {
    const strongs: string[] = [];
    for (const s of src) {
      const p = pos.get(s);
      const w = p && orig.get(p[0])?.words[p[1]];
      if (w && w[OW.strongs]) strongs.push(w[OW.strongs]);
    }
    const eng = tgt.flatMap((id) => (text.has(id) ? [foldWord(text.get(id)!)] : []));
    if (strongs.length && eng.length) global.add(strongs, eng);
  }
  const titles = new AssocTable();
  const titleEng = new Map<string, string[]>();
  for (const tk of bsb) {
    if (tk.id.slice(5, 8) !== '000' || !text.has(tk.id)) continue;
    const ck = tk.id.slice(0, 5);
    const list = titleEng.get(ck);
    if (list) list.push(foldWord(tk.text));
    else titleEng.set(ck, [foldWord(tk.text)]);
  }
  for (const [ck, eng] of titleEng) {
    const strongs = (orig.get(ck)?.words ?? []).filter((w) => w[OW.verse] === 0 && w[OW.strongs]).map((w) => w[OW.strongs]);
    if (strongs.length) titles.add(strongs, eng);
  }
  return { global, titles };
}
