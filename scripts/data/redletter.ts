/**
 * Stage "redletter": the words of Jesus -> TextVerse.wj (token index ranges [start, end) into `t`),
 * written into public/data/text/{TR}/{BOOK}/{C}.json in place. Runs after "bridged" (it needs every
 * translation's text and the orig files); re-running it gives the same result.
 *
 * Sources
 *   KJV  .cache/sources/kjv.osis.xml (eBible KJV via open-bibles, public domain): <q who="Jesus" sID/> …
 *        <q eID/> milestones, restarted at every verse. It is a different electronic edition from our
 *        CrossWire KJV (spelling and punctuation differ here and there), so its red words are mapped
 *        onto our tokens by aligning the two verses word by word (weighted LCS, fuzzy spelling match).
 *   WEB  .cache/sources/web.usfx.xml <wj>…</wj> spans (the source of our WEB text), aligned the same way.
 *   BSB, ASV, YLT  have no red-letter markup, so it is propagated through the original-language links:
 *        each Greek word gets one vote per source translation (red if the KJV/WEB words linked to it are
 *        red, black if they are not); Greek words with no decisive vote between two red ones (or a red one
 *        and the verse edge) are filled in; then a BSB/ASV/YLT word is red when most of its links are.
 *
 * Words without a decision of their own (unlinked or unaligned words) take their neighbours' colour
 * when the neighbours agree (red on both sides, or red and the verse edge) — but never across a
 * quotation mark that closes and reopens the speech. Punctuation between two red words is red; after
 * a red word and before a black one only the closing punctuation and quotation marks are red
 * ("righteousness.” Then"); before a red word only the opening quotation marks are ("said, “Truly").
 * String tokens are split at those boundaries (the tokens still concatenate to the verse text), so a
 * range never colours narrative words.
 *
 * The log line gives counts per translation; the stage also checks itself against WEB's own markup
 * (propagating from the KJV alone) and spot-checks passages (Matt 5–7, John 3:16, Acts 9:4–6,
 * Rev 1:11, 1 Cor 11:24–25 and narrative verses). It throws only on structural problems (bad ranges,
 * text that no longer reproduces the verse) or if the KJV source yields almost nothing.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { segment, foldWord } from '../../src/lib/tokenize';
import type { BookId, OrigChapter, TextChapter, TextVerse, Token } from '../../src/lib/types';
import { OW } from '../../src/lib/types';
import { KJV_BOOK_DIRS } from './kjv';
import { allChapters, log, outPath, readJson, srcPath } from './common';

const STAGE = 'redletter';

/** red = 1, unknown = 0, black = -1 */
export type Tri = 1 | 0 | -1;

/** A source verse reduced to its words and whether each is spoken by Jesus. */
export interface SourceVerse {
  words: string[];
  red: boolean[];
}

/** "BOOK C" -> verse -> words; only verses with at least one red word are kept. */
export type SourceBible = Map<string, Map<number, SourceVerse>>;

/** Translations whose sources mark the words of Jesus themselves. */
export const MARKED = ['KJV', 'WEB'] as const;
/** Translations that get red letter by propagation through the original-language links. */
export const PROPAGATED = ['BSB', 'ASV', 'YLT'] as const;

/* ======================================================================== */
/* Source parsing                                                            */
/* ======================================================================== */

const decodeXml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
    return m;
  });

const TAG_RE = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w:]*)((?:\s+[^\s=>/]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;

function attrsOf(s: string): Record<string, string> {
  const a: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s=]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = m[2];
  return a;
}

/** Collects one verse's text with a red flag per character. */
export class VerseAccumulator {
  private text = '';
  private flags: boolean[] = [];
  add(text: string, red: boolean): void {
    this.text += text;
    for (let i = 0; i < text.length; i++) this.flags.push(red);
  }
  get empty(): boolean {
    return !this.text.trim();
  }
  /** Words and their flags (a word is red when its first character is). */
  result(): SourceVerse {
    const words: string[] = [];
    const red: boolean[] = [];
    let pos = 0;
    for (const s of segment(this.text)) {
      if (s.word) {
        words.push(s.text);
        red.push(this.flags[pos] ?? false);
      }
      pos += s.text.length;
    }
    return { words, red };
  }
}

function keep(bible: SourceBible, book: BookId, chapter: number, verse: number, sv: SourceVerse): void {
  if (!sv.red.some(Boolean)) return;
  const key = `${book} ${chapter}`;
  let ch = bible.get(key);
  if (!ch) bible.set(key, (ch = new Map()));
  ch.set(verse, sv);
}

/**
 * KJV OSIS (milestone markup): <verse sID osisID="Matt.4.4"/> … <verse eID/>, words of Jesus between
 * <q who="Jesus" sID/> and the <q eID/> with the same id (container <q who="Jesus">…</q> also
 * accepted). Titles and notes are skipped; books outside the 66-book canon are ignored.
 */
export function parseOsisRed(xml: string, books: Readonly<Record<string, BookId>> = KJV_BOOK_DIRS): SourceBible {
  const bible: SourceBible = new Map();
  const open = new Set<string>(); // sIDs of open Jesus milestones
  let containerRed = 0;
  let skip = 0;
  const stack: { name: string; red: boolean; skip: boolean }[] = [];
  let cur: { book: BookId; chapter: number; verse: number; acc: VerseAccumulator } | null = null;
  const finish = () => {
    if (cur) keep(bible, cur.book, cur.chapter, cur.verse, cur.acc.result());
    cur = null;
  };
  for (const m of xml.matchAll(TAG_RE)) {
    const [, close, name, attrText, selfClose, text] = m;
    if (text !== undefined) {
      if (cur && !skip) cur.acc.add(decodeXml(text), open.size > 0 || containerRed > 0);
      continue;
    }
    if (!name) continue;
    if (close) {
      const fr = stack.pop();
      if (fr?.red) containerRed--;
      if (fr?.skip) skip--;
      if (cur && !skip && (name === 'l' || name === 'p' || name === 'lg')) cur.acc.add(' ', false);
      continue;
    }
    const a = attrsOf(attrText ?? '');
    if (name === 'verse') {
      if (a.sID && a.osisID) {
        finish();
        const [osisBook, c, v] = a.osisID.split(/\s+/)[0].split('.');
        const book = books[osisBook];
        if (book && Number(c) && Number(v)) cur = { book, chapter: Number(c), verse: Number(v), acc: new VerseAccumulator() };
      } else if (a.eID) finish();
      continue;
    }
    if (name === 'q') {
      if (selfClose) {
        if (a.sID && a.who === 'Jesus') open.add(a.sID);
        else if (a.eID) open.delete(a.eID);
      } else {
        const red = a.who === 'Jesus';
        stack.push({ name, red, skip: false });
        if (red) containerRed++;
      }
      continue;
    }
    if (selfClose) {
      if (cur && !skip && name === 'lb') cur.acc.add(' ', false);
      continue;
    }
    const isSkip = name === 'title' || name === 'note';
    stack.push({ name, red: false, skip: isSkip });
    if (isSkip) skip++;
    else if (cur && !skip && (name === 'l' || name === 'p' || name === 'lg')) cur.acc.add(' ', false);
  }
  finish();
  return bible;
}

/** USFX elements whose content is never verse text (as in the bridged stage's WEB parser). */
const USFX_SKIP = new Set(['f', 'x', 'fe', 'id', 'h', 'toc', 'rem', 'fig', 'languageCode', 'ide', 'cl', 'cp', 'ca', 'va', 'vp', 'ref', 'xt', 'd']);
const USFX_SKIP_P = new Set(['r', 'mt', 'mt1', 'mt2', 'mt3', 'mr', 'sr', 'cl', 'imt', 'is', 'ip', 'ie', 'ms', 'ms1', 'ms2', 'qa', 's', 's1', 's2']);

/** WEB USFX: <book id>, <c id/>, <v id/> … <ve/>; words of Jesus inside <wj>…</wj> (may span verses). */
export function parseUsfxRed(xml: string, canon?: ReadonlySet<string>): SourceBible {
  const bible: SourceBible = new Map();
  let book = '';
  let chapter = 0;
  let red = 0;
  let skip = 0;
  const stack: { name: string; skip: boolean; red: boolean }[] = [];
  let cur: { verse: number; acc: VerseAccumulator } | null = null;
  const finish = () => {
    if (cur && book && chapter) keep(bible, book, chapter, cur.verse, cur.acc.result());
    cur = null;
  };
  for (const m of xml.matchAll(TAG_RE)) {
    const [, close, name, attrText, selfClose, text] = m;
    if (text !== undefined) {
      if (cur && !skip) cur.acc.add(decodeXml(text), red > 0);
      continue;
    }
    if (!name) continue;
    if (close) {
      const fr = stack.pop();
      if (!fr) continue;
      if (fr.skip) skip--;
      if (fr.red) red--;
      continue;
    }
    const a = attrsOf(attrText ?? '');
    if (name === 'book') {
      finish();
      book = selfClose || (canon && !canon.has(a.id)) ? '' : a.id;
      chapter = 0;
      stack.length = 0;
      skip = 0;
      red = 0;
      if (!selfClose) stack.push({ name, skip: false, red: false });
      continue;
    }
    if (selfClose) {
      if (skip || !book) continue;
      if (name === 'c') {
        finish();
        chapter = Number(a.id);
      } else if (name === 'v') {
        finish();
        cur = { verse: Number(a.id), acc: new VerseAccumulator() };
      } else if (name === 've') finish();
      continue;
    }
    const isSkip = skip > 0 || USFX_SKIP.has(name) || (name === 'p' && USFX_SKIP_P.has(a.sfm ?? a.style ?? ''));
    const isRed = name === 'wj';
    stack.push({ name, skip: isSkip, red: isRed });
    if (isSkip) skip++;
    if (isRed) red++;
    if (cur && !isSkip && (name === 'p' || name === 'q' || name === 'b')) cur.acc.add(' ', false);
  }
  finish();
  return bible;
}

/* ======================================================================== */
/* Word alignment                                                            */
/* ======================================================================== */

const key = (w: string) => foldWord(w).replace(/[^\p{L}\p{N}]/gu, '');

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Match score of two words: 3 same word, 2 spelling variant (honour / honor), 0 different. */
export function wordMatch(a: string, b: string): number {
  const x = key(a);
  const y = key(b);
  if (!x || !y) return 0;
  if (x === y) return 3;
  const short = Math.min(x.length, y.length);
  if (short < 4) return 0;
  return editDistance(x, y, short >= 7 ? 2 : 1) <= (short >= 7 ? 2 : 1) ? 2 : 0;
}

/**
 * Align two word sequences (maximum total match score, order preserving).
 * Returns, for each target word, the index of the source word it matches, or -1.
 */
export function alignWords(src: readonly string[], tgt: readonly string[]): number[] {
  const n = src.length;
  const m = tgt.length;
  const W = m + 1;
  const score = new Int32Array((n + 1) * W);
  const sim = new Uint8Array(n * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) sim[i * m + j] = wordMatch(src[i], tgt[j]);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = Math.max(score[(i - 1) * W + j], score[i * W + j - 1]);
      const s = sim[(i - 1) * m + j - 1];
      if (s) best = Math.max(best, score[(i - 1) * W + j - 1] + s);
      score[i * W + j] = best;
    }
  }
  const out = new Array<number>(m).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const s = sim[(i - 1) * m + j - 1];
    if (s && score[i * W + j] === score[(i - 1) * W + j - 1] + s) {
      out[j - 1] = i - 1;
      i--;
      j--;
    } else if (score[(i - 1) * W + j] >= score[i * W + j - 1]) i--;
    else j--;
  }
  return out;
}

/** Colours of the target words taken from an aligned source verse (0 where a word has no partner). */
export function transferFlags(src: SourceVerse, tgtWords: readonly string[]): Tri[] {
  return alignWords(src.words, tgtWords).map((i) => (i < 0 ? 0 : src.red[i] ? 1 : -1));
}

/* ======================================================================== */
/* Verse words, gap filling, punctuation and tokens                          */
/* ======================================================================== */

/** One word of a verse's text: character range and the token it starts in. */
export interface VerseWord {
  text: string;
  start: number;
  end: number;
  token: number;
}

export interface VerseLayout {
  text: string;
  words: VerseWord[];
  /** gaps[i] = the non-word text before words[i]; gaps[words.length] = after the last word. */
  gaps: string[];
  /** Character offset where each token starts. */
  tokenStart: number[];
}

export const tokenText = (t: Token): string => (typeof t === 'string' ? t : t[0]);

export function layoutVerse(tokens: readonly Token[]): VerseLayout {
  const tokenStart: number[] = [];
  let text = '';
  for (const t of tokens) {
    tokenStart.push(text.length);
    text += tokenText(t);
  }
  const words: VerseWord[] = [];
  const gaps: string[] = [];
  let pos = 0;
  let gap = '';
  let tok = 0;
  for (const s of segment(text)) {
    if (s.word) {
      while (tok + 1 < tokens.length && tokenStart[tok + 1] <= pos) tok++;
      gaps.push(gap);
      gap = '';
      words.push({ text: s.text, start: pos, end: pos + s.text.length, token: tok });
    } else gap += s.text;
    pos += s.text.length;
  }
  gaps.push(gap);
  return { text, words, gaps, tokenStart };
}

/** Quotation marks that open a speech, and closing punctuation / quotation marks. */
const OPEN_QUOTE = /[“‘"'«]/;
const CLOSE_PUNCT = /[.,;:!?…’”'")\]»]/;
const CLOSES_SPEECH = /[”»]|’(?=\s|$)/;
const OPENS_SPEECH = /[“«‘]/;

/**
 * Decide unknown items (0) of a sequence from their neighbours: a run of unknowns becomes red when the
 * known items on both sides are red, or one side is red and the other is the edge; otherwise black.
 * (Used for the original words of a verse, which have no punctuation to go by.)
 */
export function fillUnknown(tri: readonly Tri[]): boolean[] {
  const n = tri.length;
  const out = tri.map((t) => t === 1);
  let i = 0;
  while (i < n) {
    if (tri[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && tri[j] === 0) j++;
    const left = i > 0 ? tri[i - 1] : null;
    const right = j < n ? tri[j] : null;
    const red = (left === 1 && right === 1) || (left === null && right === 1) || (left === 1 && right === null);
    for (let k = i; k < j; k++) out[k] = red;
    i = j;
  }
  return out;
}

/** How cheaply the speech may start or stop in a gap: at quotation marks, then at punctuation. */
export function switchFactor(gap: string): number {
  if (OPENS_SPEECH.test(gap) || CLOSES_SPEECH.test(gap) || /["«»]/.test(gap)) return 0.15;
  if (/[.;:!?]/.test(gap)) return 0.6;
  if (/[,—–()]/.test(gap)) return 0.75;
  return 1;
}

/**
 * The most plausible contiguous speech segmentation of a verse's words: a two-state (red / black)
 * minimum-cost path where labelling word i against its evidence costs |score[i]| and changing colour
 * in gap i costs lambda * switchFactor(gaps[i]). Words without evidence (score 0) lean very slightly
 * black, so a switch between a black and a red word happens as late as the punctuation allows
 * ("said, “I will come" switches at the quotation mark). Single mislinked words inside a run flip
 * (one word against two switches); longer runs of evidence are kept.
 */
export function smoothSpeech(score: readonly number[], gaps: readonly string[], lambda = 1): boolean[] {
  const n = score.length;
  if (!n) return [];
  const cost = (i: number, s: 0 | 1) => (s === 1 ? (score[i] < 0 ? -score[i] : score[i] === 0 ? 1e-3 : 0) : score[i] > 0 ? score[i] : 0);
  const back: [Uint8Array, Uint8Array] = [new Uint8Array(n), new Uint8Array(n)];
  let d0 = cost(0, 0);
  let d1 = cost(0, 1);
  for (let i = 1; i < n; i++) {
    const sw = lambda * switchFactor(gaps[i]);
    const n0a = d0;
    const n0b = d1 + sw;
    const n1a = d1;
    const n1b = d0 + sw;
    back[0][i] = n0b < n0a ? 1 : 0;
    back[1][i] = n1b < n1a ? 0 : 1;
    d0 = Math.min(n0a, n0b) + cost(i, 0);
    d1 = Math.min(n1a, n1b) + cost(i, 1);
  }
  const out = new Array<boolean>(n);
  let s: 0 | 1 = d1 < d0 ? 1 : 0;
  for (let i = n - 1; i >= 0; i--) {
    out[i] = s === 1;
    if (i > 0) s = back[s][i] as 0 | 1;
  }
  return out;
}

/** Red flag for every character of the verse text, from the words' flags (see the module comment). */
export function charFlags(layout: VerseLayout, red: readonly boolean[]): boolean[] {
  const flags = new Array<boolean>(layout.text.length).fill(false);
  const { words } = layout;
  words.forEach((w, i) => {
    if (red[i]) flags.fill(true, w.start, w.end);
  });
  for (let g = 0; g <= words.length; g++) {
    const start = g === 0 ? 0 : words[g - 1].end;
    const end = g === words.length ? layout.text.length : words[g].start;
    if (end <= start) continue;
    const left = g > 0 ? red[g - 1] : null;
    const right = g < words.length ? red[g] : null;
    if (left === null && right === null) continue;
    if ((left ?? right) && (right ?? left)) {
      flags.fill(true, start, end);
    } else if (left && !right) {
      let k = start;
      while (k < end && CLOSE_PUNCT.test(layout.text[k])) k++;
      flags.fill(true, start, k);
    } else if (!left && right) {
      let k = end;
      while (k > start && OPEN_QUOTE.test(layout.text[k - 1])) k--;
      flags.fill(true, k, end);
    }
  }
  return flags;
}

/** Merge adjacent string tokens (undoing an earlier run's splits). */
export function mergeStrings(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (typeof t === 'string' && typeof last === 'string') out[out.length - 1] = last + t;
    else if (t !== '') out.push(t);
  }
  return out;
}

/**
 * Apply per-word red flags to a verse: string tokens are split where the colour changes, and the
 * red tokens are returned as [start, end) ranges. Word tokens keep their identity (a word token is
 * red when its first character is).
 */
export function applyRed(tokens: readonly Token[], layout: VerseLayout, red: readonly boolean[]): { t: Token[]; wj?: [number, number][] } {
  if (!red.some(Boolean)) return { t: [...tokens] };
  const flags = charFlags(layout, red);
  const out: Token[] = [];
  const outRed: boolean[] = [];
  tokens.forEach((t, ti) => {
    const s = layout.tokenStart[ti];
    if (typeof t !== 'string') {
      // a word token: the colour of its first letter (or first character)
      const txt = t[0];
      const off = Math.max(0, txt.search(/[\p{L}\p{N}]/u));
      out.push(t);
      outRed.push(Boolean(flags[s + off]));
      return;
    }
    let runStart = 0;
    for (let k = 1; k <= t.length; k++) {
      if (k === t.length || flags[s + k] !== flags[s + runStart]) {
        out.push(t.slice(runStart, k));
        outRed.push(Boolean(flags[s + runStart]));
        runStart = k;
      }
    }
  });
  const wj: [number, number][] = [];
  for (let i = 0; i < out.length; i++) {
    if (!outRed[i]) continue;
    let j = i;
    while (j < out.length && outRed[j]) j++;
    wj.push([i, j]);
    i = j;
  }
  return wj.length ? { t: out, wj } : { t: out };
}

/** Red flag for each word of a verse (layout.words) in a tokenised verse with wj ranges. */
export function wordFlagsOf(layout: VerseLayout, wj: readonly [number, number][] | undefined): boolean[] {
  if (!wj?.length) return layout.words.map(() => false);
  return layout.words.map((w) => wj.some(([a, b]) => w.token >= a && w.token < b));
}

/* ======================================================================== */
/* Propagation through the original-language links                           */
/* ======================================================================== */

/** Votes per original word (index into OrigChapter.words): +1 / -1 per source translation. */
export type Votes = Map<number, number>;

/** Add one translation's verdicts: for each original word, the sign of (red links - black links). */
export function addVotes(votes: Votes, verses: readonly TextVerse[]): void {
  const sum = new Map<number, number>();
  for (const v of verses) {
    const red = new Set<number>();
    for (const [a, b] of v.wj ?? []) for (let i = a; i < b; i++) red.add(i);
    v.t.forEach((t, i) => {
      if (typeof t === 'string') return;
      for (const l of t[1]) sum.set(l, (sum.get(l) ?? 0) + (red.has(i) ? 1 : -1));
    });
  }
  for (const [l, s] of sum) if (s) votes.set(l, (votes.get(l) ?? 0) + Math.sign(s));
}

/**
 * Colour every original word of the chapter from the votes; words without a decisive vote are filled
 * from their neighbours within the same English verse (the speech is contiguous in the Greek too).
 */
export function origFlags(orig: OrigChapter, votes: Votes): Tri[] {
  const out: Tri[] = orig.words.map(() => 0);
  const byVerse = new Map<number, number[]>();
  orig.words.forEach((w, i) => {
    const v = w[OW.verse];
    const list = byVerse.get(v);
    if (list) list.push(i);
    else byVerse.set(v, [i]);
  });
  for (const idx of byVerse.values()) {
    const tri = idx.map((i): Tri => {
      const s = votes.get(i) ?? 0;
      return s > 0 ? 1 : s < 0 ? -1 : 0;
    });
    if (!tri.includes(1)) {
      idx.forEach((i, k) => (out[i] = tri[k] === 0 ? -1 : tri[k]));
      continue;
    }
    const filled = fillUnknown(tri);
    idx.forEach((i, k) => (out[i] = filled[k] ? 1 : -1));
  }
  return out;
}

/**
 * Link evidence per word of a verse: +c when most of the word's links are red original words, -c when
 * most are black (c = the token's alignment confidence, 1 for hand-made links), 0 for a tie or no links.
 */
export function linkScores(tokens: readonly Token[], layout: VerseLayout, orig: readonly Tri[]): number[] {
  return layout.words.map((w) => {
    const t = tokens[w.token];
    if (typeof t === 'string' || !t[1].length) return 0;
    let r = 0;
    for (const l of t[1]) if (orig[l] === 1) r++;
    const b = t[1].length - r;
    const c = t[2]?.c ?? 1;
    return r > b ? c : r < b ? -c : 0;
  });
}

/** Minimum share of a verse's words that must match a source verse word for word to use its colours. */
export const TEXT_COVERAGE = 0.6;

/**
 * Text evidence from a marked translation's verse (KJV / WEB): when the two wordings are close
 * (ASV is a revision of the KJV), aligned words take the source word's colour with weight `weight`.
 * Returns null when fewer than TEXT_COVERAGE of the target words match exactly.
 */
export function textScores(src: SourceVerse, tgtWords: readonly string[], weight = 2): number[] | null {
  if (!tgtWords.length) return null;
  const map = alignWords(src.words, tgtWords);
  let exact = 0;
  map.forEach((i, j) => {
    if (i >= 0 && wordMatch(src.words[i], tgtWords[j]) === 3) exact++;
  });
  if (exact / tgtWords.length < TEXT_COVERAGE) return null;
  return map.map((i) => (i < 0 ? 0 : src.red[i] ? weight : -weight));
}

/** A marked verse as a SourceVerse (its words and their colours). */
export function asSource(v: TextVerse): SourceVerse {
  const layout = layoutVerse(v.t);
  return { words: layout.words.map((w) => w.text), red: wordFlagsOf(layout, v.wj) };
}

/* ======================================================================== */
/* Verse-level drivers                                                       */
/* ======================================================================== */

/** Strip any previous red-letter result from a verse. */
export function resetVerse(v: TextVerse): TextVerse {
  const { wj: _wj, ...rest } = v;
  void _wj;
  return { ...rest, t: mergeStrings(v.t) };
}

/**
 * KJV verses where the eBible source lacks the words of Jesus that the WEB marks (Matt 13:57 "A
 * prophet is not without honour…"): re-derived from WEB's markup, like the runaway spans below.
 */
export const KJV_SOURCE_GAPS: ReadonlySet<string> = new Set(['MAT 13:57']);

/** Weight of an aligned word of the translation's own source markup (never outvoted by smoothing). */
const SOURCE_WEIGHT = 3;

/** Red letter for a verse from its own marked source verse (KJV OSIS / WEB USFX). */
export function markFromSource(v: TextVerse, src: SourceVerse | undefined): TextVerse {
  const base = resetVerse(v);
  if (!src) return base;
  const layout = layoutVerse(base.t);
  const score = transferFlags(
    src,
    layout.words.map((w) => w.text),
  ).map((t) => t * SOURCE_WEIGHT);
  const res = applyRed(base.t, layout, smoothSpeech(score, layout.gaps));
  return res.wj ? { ...base, t: res.t, wj: res.wj } : base;
}

/**
 * Red letter for a verse by propagation: link evidence through `orig` (the colour of every original
 * word of the chapter) plus text evidence from marked translations whose wording is close.
 */
export function markFromOrig(v: TextVerse, orig: readonly Tri[], texts: readonly (SourceVerse | undefined)[] = []): TextVerse {
  const base = resetVerse(v);
  const layout = layoutVerse(base.t);
  const score = linkScores(base.t, layout, orig);
  const words = layout.words.map((w) => w.text);
  for (const src of texts) {
    if (!src) continue;
    const ts = textScores(src, words);
    if (ts) ts.forEach((x, i) => (score[i] += x));
  }
  if (!score.some((x) => x > 0)) return base;
  const res = applyRed(base.t, layout, smoothSpeech(score, layout.gaps));
  return res.wj ? { ...base, t: res.t, wj: res.wj } : base;
}

/** Throws when ranges are malformed or the tokens no longer reproduce the text. */
export function checkVerse(before: TextVerse, after: TextVerse, where: string): void {
  const a = before.t.map(tokenText).join('');
  const b = after.t.map(tokenText).join('');
  if (a !== b) throw new Error(`${where}: red-letter split changed the text`);
  let prevEnd = 0;
  for (const [s, e] of after.wj ?? []) {
    if (!(Number.isInteger(s) && Number.isInteger(e) && s >= prevEnd && e > s && e <= after.t.length)) throw new Error(`${where}: bad wj range [${s}, ${e})`);
    prevEnd = e;
  }
}

/* ======================================================================== */
/* Finishing: whole quotations, never the narrator                           */
/* ======================================================================== */

/** Third-person verbs that introduce speech ("And Jesus answering said unto him, ‘Simon…’"). */
const SPEECH_VERB = /^(?:said|saith|says|saying|answered|answering|answereth|asked|asketh|asking|spake|spoke|speaketh|cried|crieth|replied|rebuked|told|tells|charged|commanded|declared)$/i;
/** Words that may sit between a speech verb and the speech ("said unto them,"). */
const SPEECH_OBJECT = /^(?:unto|to|him|her|them|me|us|you|thee|it|his|the|disciples|again|also|and)$/i;

/** One stretch of a verse's words between quotation marks / speech openings. */
export interface SpeechSegment {
  from: number;
  /** End word index (exclusive). */
  to: number;
  /** Narrative introducing the speech that follows (ends with a speech verb before the speech). */
  narrator: boolean;
  /** Inside quotation marks (opened in this verse). */
  quoted: boolean;
}

const OPEN_MARK = /[“‘«]/;
const CLOSE_MARK = /[”»]|’(?=\s|$)/;

/**
 * Split a verse's words into speech segments: at quotation marks (translations that print them), and
 * after a speech verb with its comma / colon ("saying, Neither go…" in the KJV and ASV, which print
 * none). A segment ending in a speech verb right before the speech is the narrator's.
 */
export function speechSegments(layout: VerseLayout): SpeechSegment[] {
  const { words, gaps } = layout;
  const out: SpeechSegment[] = [];
  let from = 0;
  let quoted = false;
  const narratorBefore = (end: number) => {
    // a speech verb among the last words before `end`, followed only by its objects ("began … to say,")
    for (let k = end - 1; k >= Math.max(from, end - 4); k--) {
      if (SPEECH_VERB.test(words[k].text)) return true;
      if (/^say$/i.test(words[k].text) && k > 0 && /^(?:to|and)$/i.test(words[k - 1].text)) return true;
      if (!SPEECH_OBJECT.test(words[k].text)) return false;
    }
    return false;
  };
  for (let i = 1; i <= words.length; i++) {
    const gap = gaps[i] ?? '';
    const opens = i < words.length && OPEN_MARK.test(gap);
    const closes = CLOSE_MARK.test(gap);
    const speechOpens = i < words.length && !opens && /[,:]\s*$/.test(gap) && narratorBefore(i);
    if (i === words.length || opens || closes || speechOpens) {
      const narrator = (opens || speechOpens) && narratorBefore(i);
      // The narrator's part is only the clause with the speech verb ("thee. | And he saith,").
      let clause = from;
      if (narrator) for (let k = i - 1; k > from; k--) if (/[.?!;]/.test(gaps[k])) {
        clause = k;
        break;
      }
      if (clause > from) out.push({ from, to: clause, narrator: false, quoted });
      out.push({ from: clause, to: i, narrator, quoted });
      from = i;
      quoted = opens ? true : closes ? false : quoted;
    }
  }
  return out.filter((sg) => sg.to > sg.from);
}

/**
 * Make each speech segment all-or-nothing: a partly red segment becomes red when at least half its
 * words are, else black, and a partly red narrator's segment ("And Jesus answering said unto him,")
 * becomes black. Segments that are wholly red or wholly black are kept (the source's own marking).
 */
export function wholeSegments(red: readonly boolean[], segments: readonly SpeechSegment[], narratorBlack = false): boolean[] {
  const out = [...red];
  for (const sg of segments) {
    const n = sg.to - sg.from;
    let r = 0;
    for (let i = sg.from; i < sg.to; i++) if (red[i]) r++;
    // A wholly red narrator's opening is black too when the marked translations say so (narratorBlack).
    const forceBlack = sg.narrator && narratorBlack && sg.from === 0;
    if (r === 0 || (r === n && !forceBlack)) continue;
    const on = !sg.narrator && r * 2 >= n;
    for (let i = sg.from; i < sg.to; i++) out[i] = on;
  }
  return out;
}

/** Red share of a source verse's words. */
const shareOf = (sv: SourceVerse | undefined) => (sv && sv.red.length ? sv.red.filter(Boolean).length / sv.red.length : 0);

/** Translations that print quotation marks (their quotations are the speech units). */
export const QUOTED_TRANSLATIONS: ReadonlySet<string> = new Set(['BSB', 'WEB', 'YLT']);

/**
 * Final pass over one verse of any translation.
 *  - Quotation-marked translations: each quotation (and each stretch between marks) is all-or-nothing
 *    (wholeSegments): "Take and | eat; this is My body" becomes the whole quotation.
 *  - Translations without quotation marks (KJV, ASV), where a "segment" runs on past the speech: a
 *    speech that starts one or two words after its "saying," / "said unto him," is widened back to
 *    it ("saying, Neither go into the town"); a propagated (ASV) run of at most 3 red words in a verse
 *    the KJV leaves (almost) black is dropped ("faithful and true." in Rev 21:5).
 *  - Either way, the narrator's opening ("And Jesus answering said unto him,") is black when the
 *    marked translations (`marked`: KJV / WEB, given for propagated translations) open the verse with
 *    narrative.
 *  - A propagated verse left black although every marked translation shows the words of Jesus in it:
 *    its single quotation, or the speech after its speech verb, or (a marked verse being entirely
 *    red, e.g. Matt 17:21, which has no Greek to propagate through) the whole verse is coloured.
 */
export function finishVerse(
  v: TextVerse,
  marked: readonly (SourceVerse | undefined)[] = [],
  quotedText = true,
  propagated = true,
): TextVerse {
  const layout = layoutVerse(v.t);
  if (!layout.words.length) return v;
  let red = wordFlagsOf(layout, v.wj);
  const segments = speechSegments(layout);
  const sources = marked.filter((m): m is SourceVerse => !!m && m.words.length > 0);
  const narratorBlack = sources.length > 0 && sources.every((m) => !m.red[0]);
  if (quotedText) red = wholeSegments(red, segments, narratorBlack);
  else {
    red = [...red];
    for (const sg of segments) {
      if (!sg.narrator) continue;
      const n = sg.to - sg.from;
      const r = red.slice(sg.from, sg.to).filter(Boolean).length;
      if (r && (r < n || (narratorBlack && sg.from === 0))) red.fill(false, sg.from, sg.to);
    }
    // widen a speech that starts just after its opening
    for (let k = 1; k < segments.length; k++) {
      const sg = segments[k];
      if (!segments[k - 1].narrator) continue;
      for (let i = sg.from + 1; i <= Math.min(sg.from + 2, sg.to - 1); i++) {
        if (red[i] && !red.slice(sg.from, i).some(Boolean)) {
          red.fill(true, sg.from, i);
          break;
        }
      }
    }
    // A short red run where the KJV (marked[0]; the ASV is its revision) has (almost) no red.
    if (propagated && marked[0]?.words.length && shareOf(marked[0]) < 0.2) {
      for (let i = 0; i < red.length; ) {
        if (!red[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j < red.length && red[j]) j++;
        if (j - i <= 3) red.fill(false, i, j);
        i = j;
      }
    }
  }
  if (propagated && !red.some(Boolean) && sources.length && sources.every((m) => shareOf(m) > 0.2)) {
    const speech = segments.filter((sg) => sg.quoted);
    const after = segments.length > 1 && segments[segments.length - 2].narrator ? [segments[segments.length - 1]] : [];
    const chosen = speech.length === 1 ? speech : !speech.length && after.length ? after : !speech.length && sources.some((m) => shareOf(m) === 1) ? segments : [];
    for (const sg of chosen) for (let i = sg.from; i < sg.to; i++) red[i] = true;
  }
  const base = resetVerse(v);
  const res = applyRed(base.t, layoutVerse(base.t), red);
  return res.wj ? { ...base, t: res.t, wj: res.wj } : base;
}

/** Red share of every verse of a chapter (verse -> share), for the consensus check. */
export function verseShares(ch: TextChapter): Map<number, number> {
  return new Map(ch.verses.map((v) => [v.v, shareOf(asSource(v))]));
}

/* ======================================================================== */
/* Evaluation helpers                                                        */
/* ======================================================================== */

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export const newConfusion = (): Confusion => ({ tp: 0, fp: 0, fn: 0, tn: 0 });

/** Word-level comparison of a predicted verse against a gold one (same tokens). */
export function compareVerse(c: Confusion, gold: TextVerse, pred: TextVerse): void {
  const lg = layoutVerse(gold.t);
  const lp = layoutVerse(pred.t);
  const g = wordFlagsOf(lg, gold.wj);
  const p = wordFlagsOf(lp, pred.wj);
  for (let i = 0; i < Math.min(g.length, p.length); i++) {
    if (g[i] && p[i]) c.tp++;
    else if (!g[i] && p[i]) c.fp++;
    else if (g[i] && !p[i]) c.fn++;
    else c.tn++;
  }
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
export const precision = (c: Confusion) => (c.tp + c.fp ? c.tp / (c.tp + c.fp) : 1);
export const recall = (c: Confusion) => (c.tp + c.fn ? c.tp / (c.tp + c.fn) : 1);

/** Share of words that are red in the given verses of a chapter. */
export function redShare(ch: TextChapter, from: number, to: number): number {
  let red = 0;
  let all = 0;
  for (const v of ch.verses) {
    if (v.v < from || v.v > to) continue;
    const f = wordFlagsOf(layoutVerse(v.t), v.wj);
    red += f.filter(Boolean).length;
    all += f.length;
  }
  return all ? red / all : 0;
}

/**
 * Passages checked after every run: [label, book, chapter, from, to, expected share of red words]:
 * red ≥ 95%, mostly ≥ 75%, part = narrative and speech (15% to < 100%), some ≥ 40%, black = none.
 */
export const SPOT_CHECKS: [string, BookId, number, number, number, 'red' | 'mostly' | 'part' | 'some' | 'black'][] = [
  ['Matt 5:3–48', 'MAT', 5, 3, 48, 'mostly'],
  ['Matt 6', 'MAT', 6, 1, 34, 'mostly'],
  ['Matt 7:1–27', 'MAT', 7, 1, 27, 'mostly'],
  ['John 3:16', 'JHN', 3, 16, 16, 'red'],
  ['Acts 9:4', 'ACT', 9, 4, 4, 'part'],
  ['Acts 9:5', 'ACT', 9, 5, 5, 'part'],
  // KJV (TR) opens with Saul's question; in the WEB/BSB/ASV the verse is all speech
  ['Acts 9:6', 'ACT', 9, 6, 6, 'some'],
  ['Rev 1:11', 'REV', 1, 11, 11, 'part'],
  ['1 Cor 11:24', '1CO', 11, 24, 24, 'part'],
  ['1 Cor 11:25', '1CO', 11, 25, 25, 'part'],
  ['Matt 4:18 (narrative)', 'MAT', 4, 18, 18, 'black'],
  ['Matt 7:28–29 (narrative)', 'MAT', 7, 28, 29, 'black'],
  ['John 1:1–14 (narrative)', 'JHN', 1, 1, 14, 'black'],
  ['Acts 9:7 (narrative)', 'ACT', 9, 7, 7, 'black'],
  ['Mark 1:1–8 (narrative)', 'MRK', 1, 1, 8, 'black'],
  ['Gen 1 (OT)', 'GEN', 1, 1, 31, 'black'],
];

/* ======================================================================== */
/* Stage                                                                     */
/* ======================================================================== */

/** Every verse of a marked chapter as a SourceVerse, by verse number. */
function sourceVerses(ch: TextChapter): Map<number, SourceVerse> {
  return new Map(ch.verses.map((v) => [v.v, asSource(v)]));
}

export interface RedLetterStats {
  /** Per translation: verses with red, red words, ranges, files rewritten. */
  counts: Record<string, { verses: number; words: number; ranges: number; files: number }>;
  /** Source verses with red text that found no verse in our text. */
  unmatched: Record<string, number>;
  /** Propagation from the KJV alone, compared with WEB's own markup (word level). */
  check: Confusion;
  /** KJV verses whose source marking was replaced by WEB's (runaway spans in the OSIS file). */
  corrected: string[];
  /** Spot checks: label -> translation -> share of red words. */
  spots: Record<string, Record<string, number>>;
  failures: string[];
  /** Propagated verses whose red share differs from both marked translations' by >= 0.4. */
  disagree: string[];
}

export function buildRedLetter(): RedLetterStats {
  const present = (tr: string) => existsSync(outPath('text', tr));
  const trs = [...MARKED, ...PROPAGATED].filter(present);
  const sources: Record<string, SourceBible> = {};
  if (present('KJV')) sources.KJV = parseOsisRed(readFileSync(srcPath('kjv.osis.xml'), 'utf8'));
  if (present('WEB')) sources.WEB = parseUsfxRed(readFileSync(srcPath('web.usfx.xml'), 'utf8'));

  const counts: RedLetterStats['counts'] = {};
  for (const tr of trs) counts[tr] = { verses: 0, words: 0, ranges: 0, files: 0 };
  const unmatched: Record<string, number> = {};
  const seen: Record<string, Set<string>> = {};
  for (const tr of Object.keys(sources)) {
    unmatched[tr] = 0;
    seen[tr] = new Set();
  }
  const check = newConfusion();
  const corrected: string[] = [];
  const disagree: string[] = [];
  const spots: RedLetterStats['spots'] = {};
  const spotKeys = new Map<string, (typeof SPOT_CHECKS)[number][]>();
  for (const s of SPOT_CHECKS) {
    const k = `${s[1]} ${s[2]}`;
    spotKeys.set(k, [...(spotKeys.get(k) ?? []), s]);
    spots[s[0]] = {};
  }

  for (const { book, chapter } of allChapters()) {
    const ck = `${book.id} ${chapter}`;
    const texts = new Map<string, { path: string; raw: string; ch: TextChapter }>();
    for (const tr of trs) {
      const path = outPath('text', tr, book.id, `${chapter}.json`);
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, 'utf8');
      texts.set(tr, { path, raw, ch: JSON.parse(raw) as TextChapter });
    }
    const hasRed = Object.values(sources).some((s) => s.has(ck));
    const result = new Map<string, TextChapter>();

    // 1. KJV / WEB from their own markup
    for (const tr of MARKED) {
      const t = texts.get(tr);
      if (!t) continue;
      const src = sources[tr]?.get(ck);
      result.set(tr, {
        ...t.ch,
        verses: t.ch.verses.map((v) => {
          const sv = src?.get(v.v);
          if (sv) seen[tr].add(`${ck}:${v.v}`);
          const out = markFromSource(v, sv);
          checkVerse(v, out, `${tr} ${ck}:${v.v}`);
          return out;
        }),
      });
    }

    const origPath = outPath('orig', book.id, `${chapter}.json`);
    const orig: OrigChapter | null = hasRed && existsSync(origPath) ? readJson<OrigChapter>(origPath) : null;
    let flags: Tri[] | null = null;
    if (orig) {
      const kjv = result.get('KJV');
      const web = result.get('WEB');
      if (kjv && web) {
        // self-check: propagation from the KJV alone (as marked by its source), scored against WEB's markup
        const kv: Votes = new Map();
        addVotes(kv, kjv.verses);
        const kf = origFlags(orig, kv);
        const kjvVerses = sourceVerses(kjv);
        for (const gold of web.verses) compareVerse(check, gold, markFromOrig(gold, kf, [kjvVerses.get(gold.v)]));

        // The eBible KJV has a few runaway <q> spans that colour whole narrative verses (Luke 7:1–9,
        // Mark 8:22–27…). A KJV verse marked red from its first word, whose WEB verse starts with
        // narrative (or has no words of Jesus at all), is re-derived from WEB's markup instead; so are
        // the verses of KJV_SOURCE_GAPS.
        const wv: Votes = new Map();
        addVotes(wv, web.verses);
        const wf = origFlags(orig, wv);
        const webVerses = sourceVerses(web);
        const kjvSrc = sources.KJV?.get(ck);
        kjv.verses = kjv.verses.map((v) => {
          const sv = kjvSrc?.get(v.v);
          const w = webVerses.get(v.v);
          const gap = KJV_SOURCE_GAPS.has(`${ck}:${v.v}`) && !!w?.red.some(Boolean);
          if (!gap && (!sv?.red[0] || !sv.red.every(Boolean) || !w?.words.length || w.red[0])) return v;
          const out = markFromOrig(v, wf, [w]);
          checkVerse(v, out, `KJV ${ck}:${v.v}`);
          corrected.push(`${ck}:${v.v}`);
          return out;
        });
      }
      // 2. BSB / ASV / YLT through the original-language links
      const votes: Votes = new Map();
      for (const tr of MARKED) {
        const r = result.get(tr);
        if (r) addVotes(votes, r.verses);
      }
      flags = origFlags(orig, votes);
    }
    const marked = MARKED.map((tr) => (result.has(tr) ? sourceVerses(result.get(tr)!) : new Map<number, SourceVerse>()));
    for (const tr of PROPAGATED) {
      const t = texts.get(tr);
      if (!t) continue;
      result.set(tr, {
        ...t.ch,
        verses: t.ch.verses.map((v) => {
          const out = flags ? markFromOrig(v, flags, marked.map((m) => m.get(v.v))) : resetVerse(v);
          checkVerse(v, out, `${tr} ${ck}:${v.v}`);
          return out;
        }),
      });
    }

    // 3. whole quotations, never the narrator; propagated verses left black against the KJV / WEB
    // The marked translations first (checked against each other only for the narrator's opening),
    // then the propagated ones against the finished KJV / WEB.
    const finish = (tr: string, against: readonly Map<number, SourceVerse>[], propagated: boolean) => {
      const ch = result.get(tr);
      if (!ch) return;
      ch.verses = ch.verses.map((v) => {
        const out = finishVerse(v, against.map((m) => m.get(v.v)), QUOTED_TRANSLATIONS.has(tr), propagated);
        checkVerse(v, out, `${tr} ${ck}:${v.v}`);
        return out;
      });
    };
    for (const tr of MARKED) finish(tr, MARKED.filter((x) => x !== tr).map((x) => marked[MARKED.indexOf(x)]), false);
    const finished = MARKED.map((tr) => (result.has(tr) ? sourceVerses(result.get(tr)!) : new Map<number, SourceVerse>()));
    for (const tr of PROPAGATED) finish(tr, finished, true);
    // consensus check: verses whose red share differs from the marked translations' by 0.4 or more
    if (hasRed) {
      const ref = MARKED.map((tr) => (result.has(tr) ? verseShares(result.get(tr)!) : new Map<number, number>()));
      for (const tr of PROPAGATED) {
        const ch = result.get(tr);
        if (!ch) continue;
        for (const [v, share] of verseShares(ch)) {
          const others = ref.map((m) => m.get(v)).filter((x): x is number => x !== undefined);
          if (!others.length) continue;
          const mean = others.reduce((a, b) => a + b, 0) / others.length;
          if (Math.abs(share - mean) >= 0.4 && others.every((x) => Math.abs(share - x) >= 0.4)) disagree.push(`${tr} ${ck}:${v}`);
        }
      }
    }

    // 4. write back what changed; count
    for (const [tr, ch] of result) {
      const t = texts.get(tr)!;
      const c = counts[tr];
      for (const v of ch.verses) {
        if (!v.wj?.length) continue;
        c.verses++;
        c.ranges += v.wj.length;
        c.words += wordFlagsOf(layoutVerse(v.t), v.wj).filter(Boolean).length;
      }
      const json = JSON.stringify(ch);
      if (json !== t.raw) {
        writeFileSync(t.path, json);
        c.files++;
      }
      for (const s of spotKeys.get(ck) ?? []) spots[s[0]][tr] = redShare(ch, s[3], s[4]);
    }
  }

  for (const [tr, bible] of Object.entries(sources)) {
    for (const [ck, verses] of bible) for (const v of verses.keys()) if (!seen[tr].has(`${ck}:${v}`)) unmatched[tr]++;
  }

  // spot checks
  const failures: string[] = [];
  for (const [label, , , , , expect] of SPOT_CHECKS) {
    for (const [tr, share] of Object.entries(spots[label])) {
      const ok =
        expect === 'black'
          ? share === 0
          : expect === 'red'
            ? share >= 0.95
            : expect === 'mostly'
              ? share >= 0.75
              : expect === 'some'
                ? share >= 0.4
                : share >= 0.15 && share < 1;
      if (!ok) failures.push(`${label} ${tr} ${pct(share)} red (expected ${expect})`);
    }
  }
  if (sources.KJV && counts.KJV && counts.KJV.verses < 1500) {
    throw new Error(`[${STAGE}] only ${counts.KJV.verses} KJV verses with words of Jesus; the OSIS source or parser is broken`);
  }

  log(
    STAGE,
    `${trs
      .map((tr) => `${tr} ${counts[tr].verses} verses / ${counts[tr].words} words`)
      .join(', ')}; KJV verses corrected from WEB ${corrected.length}; unmatched source verses ${Object.entries(unmatched)
      .map(([tr, n]) => `${tr} ${n}`)
      .join(', ')}; propagation check (KJV only -> WEB markup) precision ${pct(precision(check))} recall ${pct(recall(check))}; ` +
      `verses differing from the KJV and WEB by >= 40% of their words: ${disagree.length}${disagree.length ? ` (${disagree.slice(0, 8).join(', ')}${disagree.length > 8 ? ', …' : ''})` : ''}; spot checks ${
      SPOT_CHECKS.length * trs.length - failures.length
    }/${SPOT_CHECKS.length * trs.length} ok${failures.length ? ` — ${failures.join('; ')}` : ''}`,
  );
  return { counts, unmatched, check, corrected, spots, failures, disagree };
}
