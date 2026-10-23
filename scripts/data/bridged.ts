/**
 * Stage "bridged": World English Bible, American Standard Version and Young's Literal Translation
 * -> public/data/text/{WEB,ASV,YLT}/{BOOK}/{C}.json, plus the translation table the browser uses
 * to bridge runtime translations -> public/data/align/table.json.
 *
 * Sources:
 *   WEB  .cache/sources/web.usfx.xml   USFX (<book id="GEN">, <c id>, <v id>/<ve/>); footnotes <f> and
 *                                      cross references <x> are dropped; <d> = Psalm title (or a Ps 119
 *                                      letter heading); paragraphs / headings via the BSB stage's parser.
 *   ASV  .cache/sources/asv.zefania.xml  Zefania XML (<BIBLEBOOK bnumber><CHAPTER cnumber><VERS vnumber>).
 *                                      [Brackets] mark words supplied by the translators (printed in
 *                                      italics) -> TokenInfo.i. The source appends each Psalm's title
 *                                      ("Psalm 4  For the Chief Musician…"), "Book II" and Ps 119's
 *                                      letters ("BETH.") to the previous verse; they are moved back.
 *   YLT  .cache/sources/ylt.json        Young's Literal Translation (1898), full Bible, from
 *                                      scrollmapper/bible_databases (the open-bibles eng-ylt.zefania.xml
 *                                      is the *Revised* YLT, New Testament only). Its Psalm titles are
 *                                      part of verse 1 and are split off by alignment; `quotes' and
 *                                      -- dashes are typeset (‘ ’ —); Ps 119's "Aleph." become headings.
 *
 * Every verse is linked with the bridge aligner (src/lib/align) through the BSB's hand alignment,
 * using the same pruned table.json the browser loads, so a translation bridged here and one bridged
 * at runtime get identical treatment. Links carry TokenInfo.c (confidence).
 */
import { existsSync, readFileSync } from 'node:fs';
import { bridgeVerse } from '../../src/lib/align/bridge';
import { TableBuilder, TranslationTable } from '../../src/lib/align/table';
import type { AlignTableJson } from '../../src/lib/align/types';
import { getBookByNum } from '../../src/lib/books';
import type { OrigChapter, TextChapter, TextVerse, Token } from '../../src/lib/types';
import { parseUsfxLayout, titleCase } from './bsb';
import { allChapters, cleanOut, log, outPath, readJson, srcPath, SRC_DIR, writeJson } from './common';

/* ------------------------------------------------------------------------ */
/* Plain text model                                                          */
/* ------------------------------------------------------------------------ */

export interface PlainText {
  text: string;
  /** [start, end) character ranges of words supplied by the translators (ASV [brackets]). */
  supplied?: [number, number][];
}

export interface PlainVerse extends PlainText {
  v: number;
}

export interface PlainChapter {
  verses: PlainVerse[];
  superscription?: PlainText;
  headings?: [number, string][];
  paras?: number[];
}

/** "BOOK C" -> chapter. */
export type PlainBible = Map<string, PlainChapter>;

const chapterOf = (bible: PlainBible, key: string): PlainChapter => {
  let c = bible.get(key);
  if (!c) bible.set(key, (c = { verses: [] }));
  return c;
};

/** Collapse whitespace and tidy spacing around punctuation. */
export function cleanText(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:?!’”)\]])/g, '$1')
    .replace(/([(“‘[])\s+/g, '$1')
    .trim();
}

/**
 * Remove [brackets] that mark translator-supplied words, returning the clean text and the character
 * ranges (in the clean text) of the supplied words.
 */
export function stripBrackets(raw: string): PlainText {
  let text = '';
  const supplied: [number, number][] = [];
  let open = -1;
  for (const ch of raw) {
    if (ch === '[') open = text.length;
    else if (ch === ']') {
      if (open >= 0 && text.length > open) supplied.push([open, text.length]);
      open = -1;
    } else text += ch;
  }
  return supplied.length ? { text, supplied } : { text };
}

/** Clean text that may contain [brackets]: whitespace first, then brackets (ranges refer to the result). */
function cleanBracketed(raw: string): PlainText {
  return stripBrackets(cleanText(raw).replace(/\[\s+/g, '[').replace(/\s+\]/g, ']'));
}

/* ------------------------------------------------------------------------ */
/* WEB (USFX)                                                                */
/* ------------------------------------------------------------------------ */

/** Elements whose content is never verse text. */
const WEB_SKIP = new Set(['f', 'x', 'fe', 'id', 'h', 'toc', 'rem', 'fig', 'languageCode', 'ide', 'cl', 'cp', 'ca', 'va', 'vp', 'ref', 'xt']);
const WEB_SKIP_P = new Set(['r', 'mt', 'mt1', 'mt2', 'mt3', 'mr', 'sr', 'cl', 'imt', 'is', 'ip', 'ie', 'ms', 'ms1', 'ms2', 'qa', 's', 's1', 's2']);

/** Parse the WEB USFX: verse text and Psalm titles (paragraphs / headings come from parseUsfxLayout). */
export function parseWebText(xml: string, canon: ReadonlySet<string>): PlainBible {
  const bible: PlainBible = new Map();
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w:]*)((?:\s+[^\s=>/]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  const attrs = (s: string) => {
    const a: Record<string, string> = {};
    for (const m of s.matchAll(/([^\s=]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = m[2];
    return a;
  };
  let book = '';
  let chapter = 0;
  let verse = 0;
  let lastVerse = 0;
  let buf = '';
  let title: string | undefined;
  const stack: { name: string; skip: boolean }[] = [];
  let skipDepth = 0;
  const flush = () => {
    if (book && chapter && verse) {
      const text = cleanText(buf);
      chapterOf(bible, `${book} ${chapter}`).verses.push({ v: verse, text });
    }
    buf = '';
    verse = 0;
  };
  for (const m of xml.matchAll(re)) {
    const [, close, name, attrText, selfClose, text] = m;
    if (text !== undefined) {
      if (skipDepth || !book) continue;
      if (title !== undefined) title += text;
      else if (verse) buf += text;
      continue;
    }
    if (!name) continue;
    if (close) {
      const fr = stack.pop();
      if (!fr) continue;
      if (fr.skip) skipDepth--;
      if (fr.name === 'd' && title !== undefined && book && chapter) {
        const t = cleanText(title);
        const ch = chapterOf(bible, `${book} ${chapter}`);
        // Ps 119's <d>ALEPH</d> are section headings; other <d> before verse 1 are Psalm titles.
        if (/^[A-Z]+(?: [A-Z]+)*\.?$/.test(t)) (ch.headings ??= []).push([lastVerse + 1, titleCase(t.replace(/\.$/, '').replace(/ AND /, ' and '))]);
        else if (t) ch.superscription = { text: t };
        title = undefined;
      }
      continue;
    }
    const a = attrs(attrText ?? '');
    if (name === 'book') {
      flush();
      book = selfClose || !canon.has(a.id) ? '' : a.id;
      chapter = 0;
      // Start each book with a clean element stack (unbalanced markup elsewhere cannot leak in).
      stack.length = 0;
      skipDepth = 0;
      title = undefined;
      if (!selfClose) stack.push({ name, skip: false });
      continue;
    }
    if (selfClose) {
      if (skipDepth || !book) continue;
      if (name === 'c') {
        flush();
        chapter = Number(a.id);
        lastVerse = 0;
      } else if (name === 'v') {
        flush();
        verse = lastVerse = Number(a.id);
      } else if (name === 've') flush();
      continue;
    }
    const skip = skipDepth > 0 || WEB_SKIP.has(name) || (name === 'p' && WEB_SKIP_P.has(a.sfm ?? a.style ?? ''));
    stack.push({ name, skip });
    if (skip) {
      skipDepth++;
      continue;
    }
    if (name === 'd') {
      flush();
      title = '';
    } else if (verse && (name === 'p' || name === 'q' || name === 'b')) buf += ' ';
  }
  flush();
  return bible;
}

/* ------------------------------------------------------------------------ */
/* ASV (Zefania)                                                             */
/* ------------------------------------------------------------------------ */

/** Decode the few XML entities Zefania files use. */
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

/** Every <VERS> of a Zefania file: [book number, chapter, verse, raw text (markup stripped)]. */
export function parseZefania(xml: string): [number, number, number, string][] {
  const out: [number, number, number, string][] = [];
  for (const bm of xml.matchAll(/<BIBLEBOOK\b[^>]*\bbnumber="(\d+)"[^>]*>([\s\S]*?)<\/BIBLEBOOK>/g)) {
    const b = Number(bm[1]);
    for (const cm of bm[2].matchAll(/<CHAPTER\b[^>]*\bcnumber="(\d+)"[^>]*>([\s\S]*?)<\/CHAPTER>/g)) {
      const c = Number(cm[1]);
      for (const vm of cm[2].matchAll(/<VERS\b[^>]*\bvnumber="(\d+)"[^>]*>([\s\S]*?)<\/VERS>/g)) {
        const raw = vm[2].replace(/<NOTE\b[\s\S]*?<\/NOTE>/g, '').replace(/<[^>]+>/g, '');
        out.push([b, c, Number(vm[1]), decodeXml(raw)]);
      }
    }
  }
  return out;
}

/**
 * Trailing material the ASV source appends to a verse after a long run of spaces: the next Psalm's
 * number, title and book division ("Book II  Psalm 42  For the Chief Musician…"), or Ps 119's next
 * letter ("BETH."). Returns the verse text without it and what was found.
 */
export function splitAsvTrailer(raw: string): { text: string; psalm?: number; title?: string; book?: string; letter?: string } {
  const m = /\s{3,}(?:(Book [IVX]+)\s+)?Psalm (\d+)(?:\s{2,}([\s\S]*))?$/.exec(raw);
  if (m) {
    const title = m[3]?.trim();
    const res: { text: string; psalm?: number; title?: string; book?: string; letter?: string } = { text: raw.slice(0, m.index), psalm: Number(m[2]) };
    if (m[1]) res.book = m[1];
    if (title && /^[A-Z]+\.?$/.test(title)) res.letter = title;
    else if (title) res.title = title;
    return res;
  }
  const l = /\s{3,}([A-Z]{2,})\.?\s*$/.exec(raw);
  if (l) return { text: raw.slice(0, l.index), letter: l[1] };
  return { text: raw };
}

export function parseAsv(xml: string): PlainBible {
  const bible: PlainBible = new Map();
  const pending: { title?: string; book?: string; letter?: string; at?: string } = {};
  const rows = parseZefania(xml);
  for (const [b, c, v, raw] of rows) {
    const info = getBookByNum(b);
    if (!info) continue;
    const ch = chapterOf(bible, `${info.id} ${c}`);
    // Material carried over from the previous verse.
    if (pending.at === `${info.id} ${c} ${v}`) {
      if (pending.title) ch.superscription = cleanBracketed(pending.title.replace(/`/g, '’'));
      if (pending.book) (ch.headings ??= []).push([v, pending.book]);
      if (pending.letter) (ch.headings ??= []).push([v, titleCase(pending.letter.replace(/\.$/, '').toUpperCase())]);
      delete pending.title;
      delete pending.book;
      delete pending.letter;
      delete pending.at;
    }
    const t = splitAsvTrailer(raw);
    if (t.psalm !== undefined) {
      pending.at = `PSA ${t.psalm} 1`;
      if (t.title) pending.title = t.title;
      if (t.book) pending.book = t.book;
      if (t.letter) pending.letter = t.letter;
    } else if (t.letter) {
      pending.at = `${info.id} ${c} ${v + 1}`;
      pending.letter = t.letter;
    }
    ch.verses.push({ v, ...cleanBracketed(t.text.replace(/`/g, '’')) });
  }
  return bible;
}

/* ------------------------------------------------------------------------ */
/* YLT (scrollmapper JSON)                                                   */
/* ------------------------------------------------------------------------ */

interface YltJson {
  books: { name: string; chapters: { chapter: number; verses: { verse: number; text: string }[] }[] }[];
}

/** YLT typography: `quote' -> ‘quote’, apostrophes -> ’, -- -> —. */
export function cleanYlt(raw: string): string {
  return cleanText(
    raw
      .replace(/`/g, '‘')
      .replace(/'/g, '’')
      .replace(/\s*--\s*/g, '—'),
  ).replace(/—\s+/g, '—');
}

const HEBREW_LETTERS =
  /^(Aleph|Beth|Gimel|Daleth|He|Vau|Waw|Zain|Zayin|Cheth|Heth|Teth|Yod|Jod|Caph|Kaph|Lamed|Mem|Nun|Samech|Ain|Ayin|Pe|Tzaddi|Tsadhe|Koph|Qoph|Resh|Shin|Schin|Tau|Taw)\.\s+/;

export function parseYlt(json: YltJson): PlainBible {
  const bible: PlainBible = new Map();
  if (json.books.length !== 66) throw new Error(`YLT source has ${json.books.length} books, expected 66`);
  json.books.forEach((bk, bi) => {
    const info = getBookByNum(bi + 1)!;
    for (const c of bk.chapters) {
      const ch = chapterOf(bible, `${info.id} ${c.chapter}`);
      for (const v of c.verses) {
        let text = cleanYlt(v.text);
        const letter = info.id === 'PSA' && c.chapter === 119 ? HEBREW_LETTERS.exec(text) : null;
        if (letter) {
          (ch.headings ??= []).push([v.verse, letter[1]]);
          text = text.slice(letter[0].length);
        }
        ch.verses.push({ v: v.verse, text });
      }
    }
  });
  return bible;
}

/** Sentence boundaries where a Psalm title merged into verse 1 may end (index of the verse text's start). */
function titleSplits(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/[.;:!?]\s+|—/g)) out.push((m.index ?? 0) + m[0].length);
  return out.filter((k) => k > 0 && k < text.length);
}

const linkCount = (tokens: readonly Token[]) =>
  tokens.reduce((n, t) => (typeof t === 'string' ? n : n + (t[2]?.c ?? 1)), 0);

/**
 * Split a Psalm title off the start of verse 1 (YLT prints them together): try each sentence
 * boundary and keep the one where the title part links best to the title's original words
 * (English verse 0) and the rest to verse 1's.
 */
export function splitTitle(text: string, bsb: TextChapter, orig: OrigChapter, table: TranslationTable): { title: string; rest: string } | undefined {
  if (!orig.words.some((w) => w[5] === 0)) return undefined;
  const v1 = bsb.verses.find((v) => v.v === 1)?.t;
  let best: { title: string; rest: string; score: number } | undefined;
  for (const k of titleSplits(text)) {
    const title = text.slice(0, k).trim();
    const rest = text.slice(k).trim();
    const score = linkCount(bridgeVerse(title, bsb.superscription, orig, 0, table)) + linkCount(bridgeVerse(rest, v1, orig, 1, table));
    if (!best || score > best.score) best = { title, rest, score };
  }
  // Must beat leaving the verse whole.
  const whole = linkCount(bridgeVerse(text, v1, orig, 1, table));
  return best && best.score > whole ? { title: best.title, rest: best.rest } : undefined;
}

/* ------------------------------------------------------------------------ */
/* Bridging                                                                  */
/* ------------------------------------------------------------------------ */

/** Bridge a plain text and turn words inside `supplied` ranges into unlinked italic words. */
export function bridgeText(p: PlainText, bsb: readonly Token[] | undefined, orig: OrigChapter, verse: number, table: TranslationTable): Token[] {
  const tokens = bridgeVerse(p.text, bsb, orig, verse, table);
  if (!p.supplied?.length) return tokens;
  const inSupplied = (start: number, end: number) => p.supplied!.some(([a, b]) => start >= a && end <= b);
  const out: Token[] = [];
  let pos = 0;
  for (const t of tokens) {
    if (typeof t === 'string') {
      // Unlinked words inside a supplied range still get the italic flag.
      let rest = t;
      let at = pos;
      for (const m of t.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu)) {
        const s = pos + (m.index ?? 0);
        const e = s + m[0].length;
        if (!inSupplied(s, e)) continue;
        const before = rest.slice(0, s - at);
        if (before) out.push(before);
        out.push([m[0], [], { i: 1 }]);
        rest = rest.slice(e - at);
        at = e;
      }
      if (rest) out.push(rest);
      pos += t.length;
      continue;
    }
    const s = pos;
    pos += t[0].length;
    out.push(inSupplied(s, pos) ? [t[0], [], { i: 1 }] : t);
  }
  // Merge adjacent strings.
  const merged: Token[] = [];
  for (const t of out) {
    const last = merged[merged.length - 1];
    if (typeof t === 'string' && typeof last === 'string') merged[merged.length - 1] = last + t;
    else merged.push(t);
  }
  return merged;
}

export interface BridgedStats {
  verses: number;
  words: number;
  linked: number;
  confSum: number;
  titles: number;
}

/** Build one translation's chapters from plain text. */
function writeTranslation(
  tr: string,
  bible: PlainBible,
  table: TranslationTable,
  load: (book: string, chapter: number) => { orig: OrigChapter; bsb: TextChapter },
  layout?: Map<string, { headings: [number, string][]; paras: number[] }>,
  splitTitles = false,
): BridgedStats {
  cleanOut('text', tr);
  const st: BridgedStats = { verses: 0, words: 0, linked: 0, confSum: 0, titles: 0 };
  for (const { book, chapter } of allChapters()) {
    const key = `${book.id} ${chapter}`;
    const src = bible.get(key);
    if (!src || !src.verses.length) throw new Error(`${tr}: no text for ${key}`);
    const { orig, bsb } = load(book.id, chapter);
    const bsbVerse = new Map(bsb.verses.map((v) => [v.v, v.t]));
    const verses = [...src.verses].sort((a, b) => a.v - b.v);
    let superscription = src.superscription;
    if (splitTitles && !superscription && book.id === 'PSA' && verses[0]?.v === 1) {
      const sp = splitTitle(verses[0].text, bsb, orig, table);
      if (sp) {
        superscription = { text: sp.title };
        verses[0] = { v: 1, text: sp.rest };
      }
    }
    const out: TextChapter = { tr, book: book.id, chapter, verses: [] };
    let prev = 0;
    for (const v of verses) {
      if (v.v <= prev || !v.text) continue; // duplicate verse numbers: keep the first; empty verses (text in a footnote): drop
      prev = v.v;
      const t = bridgeText(v, bsbVerse.get(v.v), orig, v.v, table);
      out.verses.push({ v: v.v, t } satisfies TextVerse);
      st.verses++;
      for (const tok of t) {
        if (typeof tok === 'string') {
          st.words += (tok.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
          continue;
        }
        st.words++;
        if (tok[1].length) {
          st.linked++;
          st.confSum += tok[2]?.c ?? 1;
        }
      }
    }
    if (superscription?.text) {
      out.superscription = bridgeText(superscription, bsb.superscription, orig, 0, table);
      st.titles++;
    }
    const present = new Set(out.verses.map((v) => v.v));
    const lay = layout?.get(key);
    const headings = [...(lay?.headings ?? []), ...(src.headings ?? [])].filter(([v]) => present.has(v));
    const paras = [...new Set([...(lay?.paras ?? []), ...(src.paras ?? [])])].filter((v) => v !== 1 && present.has(v)).sort((a, b) => a - b);
    if (headings.length) out.headings = headings.sort((a, b) => a[0] - b[0]);
    if (paras.length) out.paras = paras;
    writeJson(outPath('text', tr, book.id, `${chapter}.json`), out);
  }
  return st;
}

/** The table shipped to the browser, from the BSB's hand alignment and the KJV's Strong's tagging. */
export function buildTableJson(load: (book: string, chapter: number) => { orig: OrigChapter; bsb: TextChapter; kjv?: TextChapter }): AlignTableJson {
  const tb = new TableBuilder();
  tb.sources.push('BSB (Clear-Bible manual alignment)', 'KJV (CrossWire Strong’s tags)');
  for (const { book, chapter } of allChapters()) {
    const d = load(book.id, chapter);
    tb.addChapter(d.bsb, d.orig);
    if (d.kjv) tb.addChapter(d.kjv, d.orig);
  }
  return tb.toJson({ minLemmaCount: 2, minPairCount: 1, minProb: 0.01, maxPerLemma: 10 });
}

export function buildBridged(): void {
  const canon = new Set(allChapters().map((c) => c.book.id));
  const cache = new Map<string, { orig: OrigChapter; bsb: TextChapter; kjv?: TextChapter }>();
  const load = (book: string, chapter: number) => {
    const k = `${book} ${chapter}`;
    let d = cache.get(k);
    if (!d) {
      const op = outPath('orig', book, `${chapter}.json`);
      const bp = outPath('text', 'BSB', book, `${chapter}.json`);
      if (!existsSync(op) || !existsSync(bp)) throw new Error(`Missing ${op} or ${bp}; run the orig and bsb stages first.`);
      const kp = outPath('text', 'KJV', book, `${chapter}.json`);
      d = { orig: readJson<OrigChapter>(op), bsb: readJson<TextChapter>(bp), kjv: existsSync(kp) ? readJson<TextChapter>(kp) : undefined };
      cache.set(k, d);
    }
    return d;
  };
  if (!existsSync(outPath('text', 'KJV', 'GEN', '1.json'))) log('bridged', 'WARNING: no KJV text yet (run the kjv stage first); the table is learned from the BSB alone');

  const json = buildTableJson(load);
  const bytes = writeJson(outPath('align', 'table.json'), json);
  log('bridged', `align/table.json: ${json.info?.lemmas} lemmas, ${json.info?.pairs} pairs, ${(bytes / 1e6).toFixed(2)} MB`);
  const table = TranslationTable.fromJson(json);

  const report = (tr: string, st: BridgedStats) =>
    log(
      'bridged',
      `${tr}: ${st.verses} verses, ${st.linked}/${st.words} words linked (${((100 * st.linked) / Math.max(1, st.words)).toFixed(1)}%), ` +
        `mean confidence ${(st.confSum / Math.max(1, st.linked)).toFixed(2)}, ${st.titles} Psalm titles`,
    );

  const webXml = readFileSync(srcPath('web.usfx.xml'), 'utf8');
  report('WEB', writeTranslation('WEB', parseWebText(webXml, canon), table, load, parseUsfxLayout(webXml)));

  report('ASV', writeTranslation('ASV', parseAsv(readFileSync(srcPath('asv.zefania.xml'), 'utf8').replace(/^﻿/, '')), table, load));

  if (existsSync(`${SRC_DIR}/ylt.json`)) {
    const ylt = parseYlt(JSON.parse(readFileSync(srcPath('ylt.json'), 'utf8')) as YltJson);
    report('YLT', writeTranslation('YLT', ylt, table, load, undefined, true));
  } else {
    cleanOut('text', 'YLT');
    log('bridged', 'WARNING: .cache/sources/ylt.json (full YLT) missing; YLT skipped. eng-ylt.zefania.xml is the Revised YLT New Testament only.');
  }
}
