/**
 * Stage "kjv": the King James Version with its own Strong's tagging -> public/data/text/KJV/{BOOK}/{C}.json
 *
 * Source: CrossWire's KJV module as JSON (npm @metaxia/scriptures-source-crosswire-kjv, packed in
 * .cache/sources/kjv-crosswire.tgz and extracted to .cache/kjv/). Each verse lists its words with
 *   lemma  "strong:G3588 strong:G2316 lemma.TR:ο lemma.TR:θεος"  (Strong's + Textus Receptus form)
 *   morph  "robinson:T-NSM robinson:N-NSM" (NT)  /  "strongMorph:TH8804" (OT, not decodable)
 *   metadata.src   TR word positions (NT, most verses), metadata.type "added" (italics) or
 *                  "x-split-N" (one original word rendered by separated English words).
 * Words are linked to the original word of the SAME English verse (OrigChapter, SBLGNT / WLC)
 * with the same base Strong's number. When a number occurs more than once, occurrences are matched
 * to candidates monotonically by relative position (TR positions when known); an article+noun tag
 * ("God" = ὁ θεός) links both words, the article being the one next to the noun. In the OT, where
 * the KJV tags a whole Hebrew word ("And the earth" = וְהָאָרֶץ), the English function words go to
 * the prefix / suffix morpheme they translate when the BSB-trained table says so ("And" -> וְ).
 * Numbers that cannot be linked (TR-only words, other lexical choices) stay on the token as
 * TokenInfo.s (+ m morphology, o TR form) so the word card can still show a lexicon entry.
 * Psalm titles (absent from the CrossWire module) come from the eBible KJV OSIS and are linked like
 * the bridged translations, through the BSB title (`parseKjvPsalmTitles`).
 * Italic (translator-supplied) words get TokenInfo.i = 1. "Lord"/"God" tagged as the divine name
 * (H3068/H3069/H3050) are printed "LORD"/"GOD" as in printed KJVs. Pauline subscriptions
 * (colophons) are left out of the verse text.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fitsMorpheme, isFunctionWord, lemmas, wordClass } from '../../src/lib/align/normalize';
import { TableBuilder, type TranslationTable } from '../../src/lib/align/table';
import { bridgeText, type PlainText } from './bridged';
import { segment } from '../../src/lib/tokenize';
import type { BookId, OrigChapter, OrigWord, TextChapter, TextVerse, Token, TokenInfo, WordToken } from '../../src/lib/types';
import { OW } from '../../src/lib/types';
import { allChapters, baseStrongs, cleanOut, log, normStrongs, outPath, readJson, ROOT, srcPath, writeJson } from './common';

/* ------------------------------------------------------------------------ */
/* Source                                                                    */
/* ------------------------------------------------------------------------ */

/** CrossWire / OSIS book directory -> USFM id. */
export const KJV_BOOK_DIRS: Record<string, BookId> = {
  Gen: 'GEN', Exod: 'EXO', Lev: 'LEV', Num: 'NUM', Deut: 'DEU', Josh: 'JOS', Judg: 'JDG', Ruth: 'RUT',
  '1Sam': '1SA', '2Sam': '2SA', '1Kgs': '1KI', '2Kgs': '2KI', '1Chr': '1CH', '2Chr': '2CH', Ezra: 'EZR',
  Neh: 'NEH', Esth: 'EST', Job: 'JOB', Ps: 'PSA', Prov: 'PRO', Eccl: 'ECC', Song: 'SNG', Isa: 'ISA',
  Jer: 'JER', Lam: 'LAM', Ezek: 'EZK', Dan: 'DAN', Hos: 'HOS', Joel: 'JOL', Amos: 'AMO', Obad: 'OBA',
  Jonah: 'JON', Mic: 'MIC', Nah: 'NAM', Hab: 'HAB', Zeph: 'ZEP', Hag: 'HAG', Zech: 'ZEC', Mal: 'MAL',
  Matt: 'MAT', Mark: 'MRK', Luke: 'LUK', John: 'JHN', Acts: 'ACT', Rom: 'ROM', '1Cor': '1CO', '2Cor': '2CO',
  Gal: 'GAL', Eph: 'EPH', Phil: 'PHP', Col: 'COL', '1Thess': '1TH', '2Thess': '2TH', '1Tim': '1TI',
  '2Tim': '2TI', Titus: 'TIT', Phlm: 'PHM', Heb: 'HEB', Jas: 'JAS', '1Pet': '1PE', '2Pet': '2PE',
  '1John': '1JN', '2John': '2JN', '3John': '3JN', Jude: 'JUD', Rev: 'REV',
};

/** Raw word object of the CrossWire JSON. */
export interface KjvRawWord {
  text: string;
  lemma?: string | null;
  morph?: string | null;
  metadata?: { src?: string; type?: string; colophon?: boolean } | null;
}

/** One Strong's tag of an English word. */
export interface KjvTag {
  /** Normalised Strong's id ("G0025", "H1961"). */
  strongs: string;
  /** Robinson code (NT) or Strong's TVM code "TH8804" (OT); "" if none. */
  morph: string;
  /** Textus Receptus form (NT), "" if none. */
  form: string;
  /** 1-based TR word position in the verse (NT), 0 if unknown. */
  src: number;
}

/** One `words[]` entry: usually one English word, sometimes a phrase ("the name of"), or bare punctuation. */
export interface KjvEntry {
  text: string;
  tags: KjvTag[];
  /** Italics: supplied by the translators. */
  added: boolean;
  /** x-split group id ("x-split-1793") or "". */
  split: string;
  /** The raw lemma attribute (consecutive identical ones are one tagged element). */
  lemmaAttr: string;
}

export interface KjvVerse {
  verse: number;
  entries: KjvEntry[];
}

const DIVINE_NAME = new Set(['H3068', 'H3069', 'H3050']);

/** Parse one raw word. */
export function parseKjvWord(w: KjvRawWord): KjvEntry {
  const lemmaAttr = (w.lemma ?? '').trim();
  const strongs: string[] = [];
  const forms: string[] = [];
  for (const part of lemmaAttr.split(/\s+/)) {
    if (!part) continue;
    const m = /^(?:strong:)?([GH])(\d+[a-z]?)$/i.exec(part);
    if (m) {
      const id = normStrongs(m[1].toUpperCase() as 'G' | 'H', m[2]);
      if (id && !/^[GH]0000$/.test(id)) strongs.push(id);
      continue;
    }
    const tr = /^lemma\.TR:(.+)$/.exec(part);
    if (tr) forms.push(tr[1]);
  }
  const morphs = (w.morph ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((m) => m.replace(/^(?:robinson|strongMorph):/, ''));
  const srcs = (w.metadata?.src ?? '').split(/\s+/).filter(Boolean).map(Number);
  const tags: KjvTag[] = strongs.map((s, i) => ({
    strongs: s,
    morph: morphs.length === strongs.length ? morphs[i] : strongs.length === 1 ? (morphs[0] ?? '') : '',
    form: forms.length === strongs.length ? forms[i] : strongs.length === 1 ? (forms[0] ?? '') : '',
    src: srcs.length === strongs.length ? srcs[i] : (srcs[0] ?? 0),
  }));
  const type = w.metadata?.type ?? '';
  return {
    text: cleanEntryText(w.text, tags),
    tags,
    added: type === 'added',
    split: type.startsWith('x-split') ? type : '',
    lemmaAttr,
  };
}

/** Tidy one entry's text: en dashes inside names become hyphens; the divine name is printed in capitals. */
export function cleanEntryText(text: string, tags: readonly KjvTag[]): string {
  let t = text.trim().replace(/(?<=\p{L})[–‑](?=\p{L})/gu, '-');
  if (tags.length === 1 && DIVINE_NAME.has(tags[0].strongs)) {
    t = t.replace(/^(Lord|God|Jehovah|Jah)(?=$|[^\p{L}])/u, (m) => m.toUpperCase());
  }
  return t;
}

/** Directory with the extracted CrossWire JSON (extracting the tarball on first use). */
export function kjvDataDir(): string {
  const dir = join(ROOT, '.cache', 'kjv');
  const data = join(dir, 'package', 'data', 'crosswire-KJV');
  if (!existsSync(data)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['xzf', srcPath('kjv-crosswire.tgz'), '-C', dir]);
  }
  if (!existsSync(data)) throw new Error(`KJV data not found in ${data}`);
  return data;
}

/** Every KJV verse, keyed "BOOK C" (e.g. "JHN 3"), verses in order. Colophon words are dropped. */
export function readKjv(): Map<string, KjvVerse[]> {
  const root = kjvDataDir();
  const out = new Map<string, KjvVerse[]>();
  for (const dir of readdirSync(root)) {
    if (dir.endsWith('.json')) continue;
    const book = KJV_BOOK_DIRS[dir];
    if (!book) throw new Error(`Unknown KJV book directory ${dir}`);
    for (const c of readdirSync(join(root, dir))) {
      const verses: KjvVerse[] = [];
      for (const f of readdirSync(join(root, dir, c))) {
        const raw = JSON.parse(readFileSync(join(root, dir, c, f), 'utf8')) as { words: KjvRawWord[] };
        const entries = raw.words.filter((w) => !w.metadata?.colophon && w.text.trim()).map(parseKjvWord);
        verses.push({ verse: Number(f.replace(/\.json$/, '')), entries });
      }
      verses.sort((a, b) => a.verse - b.verse);
      out.set(`${book} ${Number(c)}`, verses);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Psalm titles                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Psalm titles (superscriptions) of the KJV. The CrossWire module has none, so they come from the
 * eBible KJV OSIS (.cache/sources/kjv.osis.xml, public domain, also the red-letter source): the
 * `<title type="psalm" canonical="true">` right after a Psalm's `<chapter sID>`, before its first
 * verse. Ps 119's acrostic letters (ALEPH, BETH…) are section headings, not titles. Words inside
 * `<transChange type="added">` (italics) are returned as supplied character ranges.
 */
export function parseKjvPsalmTitles(xml: string): Map<number, PlainText> {
  const out = new Map<number, PlainText>();
  const re = /<chapter\b[^>]*\bsID="Ps\.(\d+)\.[^"]*"[^>]*\/>([\s\S]*?)<verse\b[^>]*\bsID=/g;
  for (const m of xml.matchAll(re)) {
    const title = /<title\b[^>]*\btype="psalm"[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
    if (!title) continue;
    // Mark italics with control characters, drop other markup, collapse whitespace, then read the
    // marks back as character ranges.
    const marked = title[1]
      .replace(/<transChange\b[^>]*type="added"[^>]*>([\s\S]*?)<\/transChange>/g, (_x, inner: string) => `\u0001${inner.replace(/<[^>]+>/g, '')}\u0002`)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\u0001\s+/g, ' \u0001')
      .replace(/\s+\u0002/g, '\u0002 ')
      .replace(/\s+/g, ' ')
      .trim();
    let text = '';
    const supplied: [number, number][] = [];
    let open = -1;
    for (const ch of marked) {
      if (ch === '\u0001') open = text.length;
      else if (ch === '\u0002') {
        if (open >= 0) supplied.push([open, text.length]);
        open = -1;
      } else text += ch;
    }
    if (!text || /^[A-Z]+\.?$/.test(text)) continue;
    const p: PlainText = { text };
    const ranges = supplied.filter(([a, b]) => b > a && b <= text.length);
    if (ranges.length) p.supplied = ranges;
    out.set(Number(m[1]), p);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Text                                                                      */
/* ------------------------------------------------------------------------ */

/** One English word of a verse and the entry it came from. */
export interface KjvWord {
  text: string;
  entry: number;
}

/**
 * Lay out a verse: each entry's text, separated by a space unless the entry is closing punctuation
 * (",)" ";)") or the previous one opens a bracket. Returns the pieces (in order; joining them gives
 * the verse text) with the entry index of each word piece (-1 for spaces / punctuation).
 */
export function layoutVerse(entries: readonly KjvEntry[]): { text: string; entry: number; word: boolean }[] {
  const out: { text: string; entry: number; word: boolean }[] = [];
  let prev = '';
  entries.forEach((e, k) => {
    if (!e.text) return;
    if (prev && !/^[,.;:?!)\]’”]/.test(e.text) && !/[([‘“]$/.test(prev)) out.push({ text: ' ', entry: -1, word: false });
    for (const s of segment(e.text)) out.push({ text: s.text, entry: s.word ? k : -1, word: s.word });
    prev = e.text;
  });
  return out;
}

/** Plain verse text. */
export const kjvVerseText = (entries: readonly KjvEntry[]) => layoutVerse(entries).map((p) => p.text).join('');

/* ------------------------------------------------------------------------ */
/* Linking                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Monotone assignment of occurrences to candidates (both given as relative positions 0..1 in
 * order), minimising the summed position difference. With at least as many candidates as
 * occurrences each candidate is used at most once; otherwise candidates may be shared (in order).
 * Returns the candidate index for each occurrence.
 */
export function monotoneAssign(occ: readonly number[], cand: readonly number[]): number[] {
  const n = occ.length;
  const m = cand.length;
  if (!n) return [];
  if (!m) return occ.map(() => -1);
  const strict = n <= m;
  // dp[i][j]: best cost with occurrence i assigned to candidate j.
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(INF));
  const back: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-1));
  for (let j = 0; j < m; j++) dp[0][j] = Math.abs(occ[0] - cand[j]);
  for (let i = 1; i < n; i++) {
    let best = INF;
    let bestK = -1;
    for (let j = 0; j < m; j++) {
      // best over k < j (strict) or k <= j (shared)
      const k = strict ? j - 1 : j;
      if (k >= 0 && dp[i - 1][k] < best) {
        best = dp[i - 1][k];
        bestK = k;
      }
      if (best < INF) {
        dp[i][j] = best + Math.abs(occ[i] - cand[j]);
        back[i][j] = bestK;
      }
    }
  }
  let j = 0;
  for (let k = 1; k < m; k++) if (dp[n - 1][k] < dp[n - 1][j]) j = k;
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = j;
    j = back[i][j];
  }
  return out;
}

export interface LinkedWord {
  text: string;
  links: number[];
  info?: TokenInfo;
}

const ARTICLE = 'G3588';

/** Robinson pronoun codes (personal, relative, demonstrative, reflexive, possessive…). */
const PRONOUN_MORPH = /^[PRCDKIXQFS]-/;
/** Case + number of a Robinson nominal code ("P-ASM" -> "AS", "P-1GS" -> "GS"), or "". */
export const caseNumber = (morph: string) => /^[A-Z]+-(?:[123])?([NGDAV])([SP])/.exec(morph)?.slice(1).join('') ?? '';
/** Case-number-gender of a Greek nominal / article code ("T-ASM" -> "ASM"), or "". */
export const cng = (morph: string) => /-([NGDAV][SP][MFN])$/.exec(morph)?.[1] ?? '';

/**
 * A Hebrew bound morpheme: a pronominal suffix, or a prefix before its written word's root
 * (in וּמִשְׁעַנְתֶּךָ the וּ and the ךָ; the root is the last morpheme that is not a suffix).
 */
export function isBoundMorpheme(words: readonly OrigWord[], j: number): boolean {
  const w = words[j];
  if (!w || !/^[\u0590-\u05FF]/.test(w[OW.text])) return false;
  if (w[OW.morph].startsWith('S')) return true;
  const g = w[OW.group];
  let root = j;
  for (let k = j + 1; k < words.length && words[k][OW.group] === g; k++) if (!words[k][OW.morph].startsWith('S')) root = k;
  return root !== j;
}

const OBJECT_PRONOUNS = new Set(['him', 'them', 'me', 'us', 'thee', 'it', 'her', 'you']);
const LEADING_PREPOSITIONS = new Set(['unto', 'to', 'with', 'for', 'upon', 'on', 'from', 'of', 'in', 'against', 'before', 'by']);

/**
 * The KJV's OT tagging often starts a tagged element with the object pronoun (or "unto them") of the
 * PREVIOUS word: "number | them, every one that entereth" = H935; "Deliver | me from the workers" =
 * H6466; "said | unto them, I am to be gathered" = H622. Such leading words are moved to the suffix
 * (and preposition) of the preceding word or of the word right after it (אֹתָם, אֲלֵיהֶם), when the
 * BSB-trained table backs the pairing. Indices of moved words are added to `moved`.
 */
function movePronouns(
  entries: readonly KjvEntry[],
  wordPieces: readonly { text: string; entry: number }[],
  wordLinks: number[][],
  lem: readonly string[],
  words: readonly OrigWord[],
  table: TranslationTable,
  moved: Set<number>,
): void {
  const linkedIdx = new Set(wordLinks.flat());
  const group = (start: number) => {
    const out: number[] = [];
    for (let k = start; k < words.length && words[k][OW.group] === start; k++) out.push(k);
    return out;
  };
  for (let wi = 1; wi < wordPieces.length; wi++) {
    const e = entries[wordPieces[wi].entry];
    const prev = entries[wordPieces[wi - 1].entry];
    if (prev.lemmaAttr === e.lemmaAttr || !prev.tags.length) continue; // not the start of a tagged element
    if (e.tags.length !== 1 || !e.tags[0].strongs.startsWith('H') || wordLinks[wi].length !== 1) continue;
    // Leading [preposition] pronoun of the element, followed by more words of the same element.
    let k = wi;
    const seq: number[] = [];
    if (LEADING_PREPOSITIONS.has(wordPieces[k].text.toLowerCase())) seq.push(k++);
    if (k >= wordPieces.length || !OBJECT_PRONOUNS.has(wordPieces[k].text.toLowerCase())) continue;
    if (entries[wordPieces[k].entry].lemmaAttr !== e.lemmaAttr) continue;
    seq.push(k++);
    if (k >= wordPieces.length || entries[wordPieces[k].entry].lemmaAttr !== e.lemmaAttr) continue; // the element is just these words
    const root = wordLinks[wi][0];
    if (/^[SR]/.test(words[root][OW.morph])) continue; // already a pronoun / preposition
    const before = wordLinks[wi - 1];
    if (before.length !== 1) continue;
    const own = group(words[before[0]][OW.group]);
    const after = own[own.length - 1] + 1;
    const pool = [...own, ...(after < words.length ? group(after) : [])].filter((j) => !linkedIdx.has(j));
    const picks: [number, number][] = [];
    for (const w of seq) {
      const suffix = OBJECT_PRONOUNS.has(wordPieces[w].text.toLowerCase());
      let best = -1;
      let bestP = 0;
      for (const j of pool) {
        if (picks.some(([, x]) => x === j)) continue;
        if (suffix !== words[j][OW.morph].startsWith('S')) continue;
        const pr = table.prob(lem[w], words[j][OW.strongs]);
        if (pr > bestP) {
          bestP = pr;
          best = j;
        }
      }
      if (best >= 0 && bestP >= (suffix ? 0.03 : 0.1)) picks.push([w, best]);
    }
    // All or nothing: the pronoun must find its suffix.
    if (!picks.some(([w]) => w === seq[seq.length - 1])) continue;
    for (const [w, j] of picks) {
      wordLinks[w] = [j];
      linkedIdx.add(j);
      moved.add(w);
    }
  }
}

/** Verbs of the "it came to pass" formula, and the auxiliaries before them ("it shall come to pass"). */
const PASS_VERBS = new Set(['came', 'come', 'cometh', 'comes']);
const PASS_AUX = new Set(['shall', 'will', 'should', 'would', 'may', 'might', 'must', 'hath', 'had', 'is', 'was', 'be']);
/** Formulaic English words and the Strong's numbers they render. */
const FORMULA_TARGETS: Record<string, readonly string[]> = {
  pass: ['H1961', 'H1934'],
  behold: ['H2009', 'H2005', 'H0431', 'H0718', 'H0718a'],
  lo: ['H2009', 'H2005', 'H0431', 'H0718', 'H0718a'],
  saying: ['H0559'],
};
/** Words that may stay on a proper name the KJV tags together with it ("the LORD", "O God", "sons of Japheth"). */
const NAME_COMPANIONS = new Set(['the', 'o', 'of']);

/**
 * The KJV's Hebrew tagging is phrase-level: a tagged element can run over a whole clause, e.g.
 * "it came to pass, that Cain" = H7014 (Gen 4:3), "And it came to pass, that, when Abram" = H87
 * (Gen 12:14). After the function words went to their prefixes / suffixes:
 *  1. formulas go to the word they render, when the verse has it unclaimed: "(it) came / shall come
 *     to pass" -> וַיְהִי / וְהָיָה (H1961; a leading "And" -> its וַ), "behold" / "lo" -> הִנֵּה
 *     (H2009 / H2005), "saying" -> לֵאמֹר (H559); otherwise they are left unlinked rather than on the
 *     element's noun;
 *  2. in an element tagged with a proper name only, the other lowercase words ("that", "when",
 *     "came") go where the BSB-trained table says they belong among the verse's unclaimed words (a
 *     function word only within the name's written word or its neighbours), else they are unlinked:
 *     no person / place card for "And it came to pass, that, when".
 */
function rehomePhraseWords(
  entries: readonly KjvEntry[],
  wordPieces: readonly { text: string; entry: number }[],
  wordLinks: number[][],
  lem: readonly string[],
  words: readonly OrigWord[],
  cand: readonly number[],
  table: TranslationTable,
): void {
  if (!cand.some((j) => /^[\u0590-\u05FF]/.test(words[j][OW.text]))) return; // Hebrew only
  const n = wordPieces.length;
  const lower = wordPieces.map((p) => p.text.toLowerCase());
  // Tagged element = a block of consecutive words with the same (non-empty) lemma attribute,
  // punctuation inside notwithstanding ("it came to pass, that, when Abram").
  const block: number[] = [];
  wordPieces.forEach((p, wi) => {
    const attr = entries[p.entry].lemmaAttr;
    const prev = wi > 0 ? entries[wordPieces[wi - 1].entry].lemmaAttr : '';
    block.push(wi > 0 && attr && attr === prev ? block[wi - 1] : wi);
  });
  const baseOf = (j: number) => (words[j][OW.strongs] ? baseStrongs(words[j][OW.strongs]) : '');
  const claimedOutside = (span: ReadonlySet<number>) => {
    const out = new Set<number>();
    wordLinks.forEach((l, wi) => {
      if (!span.has(wi)) for (const j of l) out.add(j);
    });
    return out;
  };
  const relPos = (wi: number) => (n > 1 ? wi / (n - 1) : 0.5);
  const candPos = new Map(cand.map((j, r) => [j, cand.length > 1 ? r / (cand.length - 1) : 0.5]));
  const sameLinks = (a: number, b: number) => wordLinks[a].length === wordLinks[b].length && wordLinks[a].every((j, x) => j === wordLinks[b][x]);
  /** Does word wi share its tagged element with another word linked to the same root (a phrase tag)? */
  const inPhrase = (wi: number) => wordLinks[wi].length > 0 && wordPieces.some((_, k) => k !== wi && block[k] === block[wi] && sameLinks(k, wi));

  const relink = (span: number[], targets: readonly string[]) => {
    const set = new Set(span);
    if (span.every((wi) => wordLinks[wi].length && wordLinks[wi].every((j) => targets.includes(baseOf(j))))) return -1;
    const taken = claimedOutside(set);
    const mid = relPos(span[0]);
    let best = -1;
    for (const j of cand) {
      if (taken.has(j) || !targets.includes(baseOf(j)) || isBoundMorpheme(words, j)) continue;
      if (best < 0 || Math.abs(candPos.get(j)! - mid) < Math.abs(candPos.get(best)! - mid)) best = j;
    }
    for (const wi of span) {
      if (best >= 0) wordLinks[wi] = [best];
      else if (inPhrase(wi) || wordLinks[wi].every((j) => !targets.includes(baseOf(j)))) wordLinks[wi] = [];
    }
    return best;
  };

  // 1. Formulas.
  for (let wi = 1; wi + 1 < n; wi++) {
    if (lower[wi] !== 'to' || lower[wi + 1] !== 'pass') continue;
    let a = wi - 1;
    if (lower[a] === 'even' && a > 0) a--; // "It came even to pass"
    if (!PASS_VERBS.has(lower[a])) continue;
    while (a > 0 && PASS_AUX.has(lower[a - 1])) a--;
    if (a > 0 && lower[a - 1] === 'it') a--;
    const span = Array.from({ length: wi + 2 - a }, (_, k) => a + k);
    const j = relink(span, FORMULA_TARGETS.pass);
    // "And it came to pass" -> the וַ of וַיְהִי, when "And" rode on the same phrase tag.
    if (j >= 0 && a > 0 && lower[a - 1] === 'and' && block[a - 1] === block[a] && !span.includes(a - 1)) {
      const g = words[j][OW.group];
      const conj = cand.find((k) => k !== j && words[k][OW.group] === g && /^C/.test(words[k][OW.morph]));
      if (conj !== undefined && !claimedOutside(new Set([a - 1])).has(conj)) wordLinks[a - 1] = [conj];
    }
    wi++;
  }
  for (let wi = 0; wi < n; wi++) {
    const t = FORMULA_TARGETS[lower[wi]];
    if (t && lower[wi] !== 'pass' && inPhrase(wi)) relink([wi], t);
  }

  // 2. Other words of a phrase tag. Members of one element still linked to its single root.
  const members = new Map<number, number[]>();
  wordPieces.forEach((_, k) => members.set(block[k], [...(members.get(block[k]) ?? []), k]));
  for (const list of members.values()) {
    if (list.length < 2) continue;
    const e = entries[wordPieces[list[0]].entry];
    if (e.tags.length !== 1) continue;
    const tagBase = baseStrongs(e.tags[0].strongs);
    const root = [...new Set(list.flatMap((k) => wordLinks[k]))].find((j) => baseOf(j) === tagBase);
    if (root === undefined) continue;
    const isName = (k: number) => /^\p{Lu}/u.test(wordPieces[k].text) && !isFunctionWord(wordPieces[k].text);
    // A name element spells the name out ("Abram"); "to the grave" (שְׁאוֹל) and "their groves"
    // (אֲשֵׁרִים) are the KJV's common-noun renderings of a name and are ordinary elements.
    const nameElement = words[root][OW.morph].startsWith('Np') && list.some(isName);
    const near = new Set<number>();
    const g = words[root][OW.group];
    for (const j of cand) if (Math.abs(words[j][OW.group] - g) <= 3) near.add(j);
    for (const k of list) {
      const text = wordPieces[k].text;
      if (wordLinks[k].length !== 1 || wordLinks[k][0] !== root) continue; // moved already
      if (isName(k) || NAME_COMPANIONS.has(lower[k])) continue;
      // Prepositions and articles stay with the noun, as in the BSB ("the sons of Japheth"), and so
      // does a word that renders the root itself ("the grave" = שְׁאוֹל).
      const cls = wordClass(text);
      if (cls === 'prep' || cls === 'det') continue;
      const pRoot = table.prob(lem[k], words[root][OW.strongs]);
      if (pRoot >= (nameElement ? 0.05 : 0.02)) continue;
      const fn = cls !== 'content';
      if (!nameElement && fn) continue; // in ordinary elements only content words move
      const taken = claimedOutside(new Set([k]));
      let best = -1;
      let bestP = 0;
      for (const j of cand) {
        if (j === root || taken.has(j) || (fn ? !near.has(j) : isBoundMorpheme(words, j))) continue;
        const p = table.prob(lem[k], words[j][OW.strongs]);
        if (p > bestP) {
          bestP = p;
          best = j;
        }
      }
      const move = best >= 0 && bestP >= (nameElement ? 0.1 : 0.15) && bestP > 5 * pRoot;
      if (move) wordLinks[k] = [best];
      else if (nameElement) wordLinks[k] = [];
    }
  }
}

export interface KjvLinkOptions {
  /** BSB-trained table: redirects English function words inside a tagged Hebrew word to its prefix / suffix. */
  table?: TranslationTable;
  /** Match keys of original word j (default: its base Strong's id). */
  keysOf?: (j: number) => readonly string[];
  /** Learned equivalences: KJV Strong's -> source Strong's used for the same word (H3212 -> H1980). */
  equiv?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Link one KJV verse. `cand` are the indices of the OrigChapter words this English verse may link
 * to (its own words, plus words of adjacent verses the KJV has no verse for). `table` (BSB-trained)
 * redirects English function words inside a tagged Hebrew word to the prefix / suffix they render.
 */
export function linkKjvVerse(
  entries: readonly KjvEntry[],
  words: readonly OrigWord[],
  cand: readonly number[],
  opts: KjvLinkOptions = {},
): { pieces: { text: string; word?: LinkedWord }[]; tags: number; linked: number; unlinked: string[]; free: string[] } {
  const { table, equiv } = opts;
  const keysOf = opts.keysOf ?? ((j: number) => (words[j][OW.strongs] ? [baseStrongs(words[j][OW.strongs])] : []));
  const layout = layoutVerse(entries);
  // Occurrence = one original word the verse refers to (a Strong's number at a TR position, an
  // x-split group, or a run of consecutive entries with the same lemma attribute).
  const maxSrc = Math.max(0, ...entries.flatMap((e) => e.tags.map((t) => t.src)));
  const nE = entries.length;
  const runOf: number[] = [];
  let run = 0;
  entries.forEach((e, k) => {
    const prev = entries[k - 1];
    if (k > 0 && (!e.lemmaAttr || e.lemmaAttr !== prev.lemmaAttr || /[,;:.?!]$/.test(prev.text))) run++;
    runOf.push(run);
  });
  type Occ = { key: string; base: string; pos: number; entries: Set<number> };
  const occs = new Map<string, Occ>();
  const occOfTag = entries.map((e) => e.tags.map(() => ''));
  entries.forEach((e, k) => {
    e.tags.forEach((t, ti) => {
      const base = baseStrongs(t.strongs);
      const key = t.src && maxSrc ? `${base}@${t.src}` : e.split ? `${base}#${e.split}` : `${base}~${runOf[k]}`;
      occOfTag[k][ti] = key;
      let o = occs.get(key);
      if (!o) {
        const pos = t.src && maxSrc > 1 ? (t.src - 1) / (maxSrc - 1) : nE > 1 ? k / (nE - 1) : 0;
        occs.set(key, (o = { key, base, pos, entries: new Set() }));
      }
      o.entries.add(k);
    });
  });
  // Article tags that only ever come with a noun on one English word ("God" = ὁ θεός) are placed with
  // their noun (below), never on their own: a TR article whose noun the SBLGNT lacks must not land on
  // some other article of the verse (1 John 5:7 "the Father" on οἱ, John 11:45 "Jesus" on τὴν).
  const attachedArticle = new Set<string>();
  const freeArticle = new Set<string>();
  entries.forEach((e, k) =>
    e.tags.forEach((t, ti) => {
      if (t.strongs !== ARTICLE) return;
      (e.tags.some((x) => x.strongs !== ARTICLE) ? attachedArticle : freeArticle).add(occOfTag[k][ti]);
    }),
  );
  for (const key of freeArticle) attachedArticle.delete(key);
  // Hebrew bound morphemes (prefixes before a word's root, pronominal suffixes) never take a content
  // tag of another number (KJV H1 "fathers" is not the suffix נוּ "our").
  const bound = (j: number) => isBoundMorpheme(words, j);
  // Candidates by match key, with relative position in the verse's original words.
  type Cand = { j: number; pos: number };
  const candBy = new Map<string, Cand[]>();
  cand.forEach((j, r) => {
    const own = words[j][OW.strongs] ? baseStrongs(words[j][OW.strongs]) : '';
    for (const key of keysOf(j)) {
      if (key !== own && bound(j)) continue;
      let list = candBy.get(key);
      if (!list) candBy.set(key, (list = []));
      list.push({ j, pos: cand.length > 1 ? r / (cand.length - 1) : 0 });
    }
  });
  // Greek pronouns: the TR's case and number must agree with the SBLGNT word's ("them" = αὐτούς can
  // not take αὐτοῦ).
  const caseOk = (tagMorph: string, j: number) => {
    if (!PRONOUN_MORPH.test(tagMorph)) return true;
    const a = caseNumber(tagMorph);
    const b = caseNumber(words[j][OW.morph]);
    return !a || !b || a === b;
  };
  const tagOfOcc = new Map<string, KjvTag>();
  entries.forEach((e, k) => e.tags.forEach((t, ti) => tagOfOcc.set(occOfTag[k][ti], t)));
  const assigned = new Map<string, number>();
  const extraLinks = new Map<string, number[]>();
  const byBase = new Map<string, Occ[]>();
  for (const o of occs.values()) {
    const list = byBase.get(o.base);
    if (list) list.push(o);
    else byBase.set(o.base, [o]);
  }
  for (const list of byBase.values()) list.sort((a, b) => a.pos - b.pos);
  const assign = (list: readonly Occ[], cs: readonly Cand[]) => {
    // Pronouns: assign within each case-number class of the TR form first.
    const groups = new Map<string, Occ[]>();
    for (const o of list) {
      const m = tagOfOcc.get(o.key)?.morph ?? '';
      const cls = PRONOUN_MORPH.test(m) ? caseNumber(m) : '';
      groups.set(cls, [...(groups.get(cls) ?? []), o]);
    }
    for (const [cls, occ] of groups) {
      const pool = cls ? cs.filter((c) => caseOk(tagOfOcc.get(occ[0].key)!.morph, c.j)) : cs;
      const pick = monotoneAssign(
        occ.map((o) => o.pos),
        pool.map((c) => c.pos),
      );
      occ.forEach((o, i) => {
        if (pick[i] >= 0) assigned.set(o.key, pool[pick[i]].j);
      });
    }
  };
  // 1. Same Strong's number (or another form-number of the same Greek lemma). Articles that go with
  //    a noun wait for their noun.
  for (const [base, list] of byBase) {
    const cs = candBy.get(base);
    const occ = base === ARTICLE ? list.filter((o) => !attachedArticle.has(o.key)) : list;
    if (cs && occ.length) assign(occ, cs);
  }
  // 2. Learned equivalences (the KJV's Strong's vs the source's own choice, e.g. H3212 / H1980),
  //    only to words nothing else links.
  if (equiv) {
    const taken = new Set(assigned.values());
    for (const [base, list] of byBase) {
      const rest = list.filter((o) => !assigned.has(o.key) && !attachedArticle.has(o.key));
      const eq = rest.length ? equiv.get(base) : undefined;
      if (!eq) continue;
      const seen = new Set<number>();
      const cs: Cand[] = [];
      for (const s of eq) for (const c of candBy.get(s) ?? []) if (!taken.has(c.j) && !seen.has(c.j) && !bound(c.j)) (seen.add(c.j), cs.push(c));
      if (!cs.length) continue;
      cs.sort((a, b) => a.j - b.j);
      assign(rest, cs);
      for (const o of rest) if (assigned.has(o.key)) taken.add(assigned.get(o.key)!);
    }
  }
  // Article + noun on one English word: the article of the noun's own phrase — the nearest article
  // up to 3 words before the noun (over adjectives / particles), agreeing in case, number and gender
  // with the noun (or, for an indeclinable noun, with the TR article). No such article: none.
  const articleTaken = new Set(assigned.values());
  const inCand = new Set(cand);
  entries.forEach((e, k) => {
    if (e.tags.length < 2) return;
    const anchorIdx = e.tags.findIndex((t, ti) => t.strongs !== ARTICLE && assigned.has(occOfTag[k][ti]));
    if (anchorIdx < 0) return;
    const aj = assigned.get(occOfTag[k][anchorIdx])!;
    e.tags.forEach((t, ti) => {
      const key = occOfTag[k][ti];
      if (t.strongs !== ARTICLE || !attachedArticle.has(key) || assigned.has(key)) return;
      for (let r = aj - 1; r >= Math.max(0, aj - 3) && inCand.has(r); r--) {
        const w = words[r];
        if (w[OW.strongs] === ARTICLE) {
          const nounCng = cng(words[aj][OW.morph]);
          const ok = nounCng ? cng(w[OW.morph]) === nounCng : !cng(t.morph) || cng(w[OW.morph]) === cng(t.morph);
          if (ok && !articleTaken.has(r)) {
            assigned.set(key, r);
            articleTaken.add(r);
          }
          break;
        }
        if (!/^(?:A-|ADV|CONJ|PRT|N-|V-[A-Z]+P-)/.test(w[OW.morph])) break;
      }
    });
  });

  // A name written as two words with one number (בַּעַל חָנָן "Baal-hanan"): take the neighbours too.
  {
    const taken = new Set(assigned.values());
    const extra = new Map<string, number[]>();
    for (const o of occs.values()) {
      const j = assigned.get(o.key);
      if (j === undefined) continue;
      const pos = cand.indexOf(j);
      const more: number[] = [];
      for (const dir of [-1, 1]) {
        for (let r = pos + dir; r >= 0 && r < cand.length; r += dir) {
          const k = cand[r];
          if (taken.has(k) || !words[k][OW.strongs] || baseStrongs(words[k][OW.strongs]) !== baseStrongs(words[j][OW.strongs])) break;
          more.push(k);
        }
      }
      if (more.length) {
        extra.set(o.key, more);
        more.forEach((k) => taken.add(k));
      }
    }
    for (const [key, more] of extra) extraLinks.set(key, more);
  }

  // Per entry: links + unlinked tags.
  const entryLinks: number[][] = entries.map((e, k) => {
    const s = new Set<number>();
    e.tags.forEach((_, ti) => {
      const j = assigned.get(occOfTag[k][ti]);
      if (j !== undefined) s.add(j);
      for (const x of extraLinks.get(occOfTag[k][ti]) ?? []) s.add(x);
    });
    return [...s].sort((a, b) => a - b);
  });

  // Words, with OT prefix/suffix refinement inside runs of English words sharing one tagged element.
  const wordPieces = layout.filter((p) => p.word);
  const lem = lemmas(wordPieces.map((p) => p.text));
  const wordLinks = wordPieces.map((p) => entryLinks[p.entry]);
  const moved = new Set<number>();
  if (table) movePronouns(entries, wordPieces, wordLinks, lem, words, table, moved);
  if (table) {
    // Group word indices by (run, tagged element) for single-tag entries linked to one Hebrew word.
    const groups = new Map<string, number[]>();
    wordPieces.forEach((p, wi) => {
      if (moved.has(wi)) return;
      const e = entries[p.entry];
      if (e.tags.length !== 1 || entryLinks[p.entry].length !== 1 || !e.tags[0].strongs.startsWith('H')) return;
      const key = `${runOf[p.entry]}|${occOfTag[p.entry][0]}`;
      const list = groups.get(key);
      if (list) list.push(wi);
      else groups.set(key, [wi]);
    });
    for (const list of groups.values()) {
      const root = wordLinks[list[0]][0];
      const g = words[root][OW.group];
      const morphemes: number[] = [];
      for (let j = g; j < words.length && words[j][OW.group] === g; j++) if (j !== root) morphemes.push(j);
      if (!morphemes.length) continue;
      const rootS = words[root][OW.strongs];
      // In a run of several words, the root stays on the content word that best renders it.
      let keep = -1;
      if (list.length > 1) {
        for (const wi of list) {
          if (isFunctionWord(wordPieces[wi].text)) continue;
          if (keep < 0 || table.prob(lem[wi], rootS) > table.prob(lem[keep], rootS)) keep = wi;
        }
      }
      const used = new Set<number>();
      for (const wi of list) {
        // Only function words (and, the, in, his…) move, to a prefix / suffix morpheme of their kind.
        if (wi === keep || !isFunctionWord(wordPieces[wi].text)) continue;
        const cls = wordClass(wordPieces[wi].text);
        let best = -1;
        let bestP = 0;
        for (const j of morphemes) {
          if (used.has(j) || !fitsMorpheme(cls, words[j][OW.morph])) continue;
          const p = table.prob(lem[wi], words[j][OW.strongs]);
          if (p > bestP) {
            bestP = p;
            best = j;
          }
        }
        if (best >= 0 && bestP >= 0.15 && bestP > 2 * table.prob(lem[wi], rootS)) {
          wordLinks[wi] = [best];
          used.add(best);
        }
      }
    }
    rehomePhraseWords(entries, wordPieces, wordLinks, lem, words, cand, table);
  }

  let tags = 0;
  let linked = 0;
  let wi = 0;
  const pieces = layout.map((p) => {
    if (!p.word) return { text: p.text };
    const e = entries[p.entry];
    const links = wordLinks[wi++];
    const info: TokenInfo = {};
    if (e.added) info.i = 1;
    let unlinked = e.tags.filter((_, ti) => !assigned.has(occOfTag[p.entry][ti]));
    // A KJV "the" folded into a linked noun whose SBLGNT phrase has no matching article is no
    // separate word; with an unlinked (TR-only) noun it stays, after the noun.
    if (links.length) unlinked = unlinked.filter((t) => t.strongs !== ARTICLE || e.tags.every((x) => x.strongs === ARTICLE));
    unlinked = [...unlinked.filter((t) => t.strongs !== ARTICLE), ...unlinked.filter((t) => t.strongs === ARTICLE)];
    if (unlinked.length) {
      info.s = unlinked.map((t) => t.strongs);
      if (unlinked.some((t) => t.morph)) info.m = unlinked.map((t) => t.morph);
      if (unlinked.some((t) => t.form)) info.o = unlinked.map((t) => t.form);
    }
    if (e.tags.length) {
      tags++;
      if (links.length) linked++;
    }
    const word: LinkedWord = { text: p.text, links };
    if (Object.keys(info).length) word.info = info;
    return { text: p.text, word };
  });
  const taken = new Set(assigned.values());
  const unlinked = [...occs.values()].filter((o) => !assigned.has(o.key)).map((o) => o.base);
  const free = cand.filter((j) => !taken.has(j) && words[j][OW.strongs]).map((j) => baseStrongs(words[j][OW.strongs]));
  return { pieces, tags, linked, unlinked, free };
}

/** Pieces -> Token[] (unlinked words without info merge into the surrounding text). */
export function piecesToTokens(pieces: readonly { text: string; word?: LinkedWord }[]): Token[] {
  const out: Token[] = [];
  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (typeof last === 'string') out[out.length - 1] = last + s;
    else out.push(s);
  };
  for (const p of pieces) {
    const w = p.word;
    if (!w || (!w.links.length && !w.info)) {
      pushText(p.text);
      continue;
    }
    const tok: WordToken = [w.text, w.links];
    if (w.info) tok.push(w.info);
    out.push(tok);
  }
  return out;
}

/**
 * Candidate original words for each KJV verse of a chapter: the verse's own words, plus words of
 * verses the KJV does not have (e.g. BSB 3 John 1:15 is the end of KJV 1:14), given to the
 * nearest preceding KJV verse (else the following one).
 */
export function candidatesByVerse(orig: OrigChapter, kjvVerses: readonly number[]): Map<number, number[]> {
  const have = new Set(kjvVerses);
  const sorted = [...kjvVerses].sort((a, b) => a - b);
  const out = new Map<number, number[]>(sorted.map((v) => [v, []]));
  orig.words.forEach((w, j) => {
    const v = w[OW.verse];
    let target = v;
    if (!have.has(v)) {
      if (v === 0) return; // Psalm titles: the KJV text has none
      const prev = [...sorted].reverse().find((x) => x < v);
      target = prev ?? sorted.find((x) => x > v) ?? -1;
    }
    out.get(target)?.push(j);
  });
  return out;
}

/** Translation table from the BSB's hand alignment only (used for the KJV's prefix refinement). */
export function bsbTable(origOf: (book: BookId, chapter: number) => OrigChapter): TranslationTable {
  const tb = new TableBuilder();
  for (const { book, chapter } of allChapters()) {
    const p = outPath('text', 'BSB', book.id, `${chapter}.json`);
    if (!existsSync(p)) throw new Error(`Missing ${p}; run the bsb stage first.`);
    tb.addChapter(readJson<TextChapter>(p), origOf(book.id, chapter));
  }
  return tb.toTable();
}

/* ------------------------------------------------------------------------ */
/* Build                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Lemma groups (Greek only): for each lemma of the SBLGNT words, the Strong's ids used for it (each at
 * least `min` times): the form-numbers of one word (οὗτος G3778 / τούτου G5127; εἰμί G1510 / G2075).
 * Hebrew is left out: Macula gives every pronominal suffix the lemma הוּא, which would make "fathers"
 * (H1) match the suffix נוּ.
 */
export function lemmaGroups(chapters: Iterable<OrigChapter>, min = 5): Map<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  for (const oc of chapters) {
    if (oc.lang !== 'grc') continue;
    for (const w of oc.words) {
      if (!w[OW.strongs] || !w[OW.lemma]) continue;
      let m = counts.get(w[OW.lemma]);
      if (!m) counts.set(w[OW.lemma], (m = new Map()));
      const b = baseStrongs(w[OW.strongs]);
      m.set(b, (m.get(b) ?? 0) + 1);
    }
  }
  const out = new Map<string, string[]>();
  for (const [lemma, m] of counts) {
    const ids = [...m].filter(([, n]) => n >= min).map(([s]) => s);
    if (ids.length > 1) out.set(lemma, ids);
  }
  return out;
}

/** Match keys for an original word: base Strong's + the other form-numbers of its lemma (Greek). */
export function keysFor(words: readonly OrigWord[], groups: ReadonlyMap<string, readonly string[]>): (j: number) => readonly string[] {
  return (j) => {
    const w = words[j];
    if (!w[OW.strongs]) return [];
    const b = baseStrongs(w[OW.strongs]);
    const g = groups.get(w[OW.lemma]);
    return g && g.includes(b) ? g : [b];
  };
}

/**
 * Learn KJV-Strong's -> source-Strong's equivalences from tags left unlinked by direct matching:
 * s -> s' when the unlinked s co-occurs with a free (unlinked) s' in the same verse in >= 30% of its
 * occurrences, at least 5 times, and >= 5x more often than s' is free in an average verse.
 */
export function learnEquivalences(stats: readonly { unlinked: string[]; free: string[] }[]): Map<string, string[]> {
  const n = new Map<string, number>();
  const c = new Map<string, Map<string, number>>();
  const fv = new Map<string, number>();
  for (const st of stats) {
    const free = new Set(st.free);
    for (const f of free) fv.set(f, (fv.get(f) ?? 0) + 1);
    for (const s of st.unlinked) {
      n.set(s, (n.get(s) ?? 0) + 1);
      let m = c.get(s);
      if (!m) c.set(s, (m = new Map()));
      for (const f of free) m.set(f, (m.get(f) ?? 0) + 1);
    }
  }
  const V = stats.length;
  const out = new Map<string, string[]>();
  for (const [s, m] of c) {
    const ns = n.get(s)!;
    const ids = [...m]
      // Never to or from the Greek article: an unlinked noun "co-occurs" with some free article in
      // most verses (G3772 "heaven" -> G3588 put 1 John 5:7 "heaven" on οἱ).
      .filter(([f, k]) => f !== s && f !== ARTICLE && s !== ARTICLE && k >= 5 && k / ns >= 0.3 && k / ns / ((fv.get(f) ?? 0) / V) >= 5 && f[0] === s[0])
      .sort((a, b) => b[1] - a[1])
      .map(([f]) => f);
    if (ids.length) out.set(s, ids);
  }
  return out;
}

export function buildKjv(): void {
  const kjv = readKjv();
  const origCache = new Map<string, OrigChapter>();
  const origOf = (book: BookId, chapter: number) => {
    const k = `${book} ${chapter}`;
    let oc = origCache.get(k);
    if (!oc) {
      const p = outPath('orig', book, `${chapter}.json`);
      if (!existsSync(p)) throw new Error(`Missing ${p}; run the orig stage first.`);
      origCache.set(k, (oc = readJson<OrigChapter>(p)));
    }
    return oc;
  };
  const table = bsbTable(origOf);
  const groups = lemmaGroups(allChapters().map(({ book, chapter }) => origOf(book.id, chapter)));
  const chapters = allChapters().map(({ book, chapter }) => {
    const vs = kjv.get(`${book.id} ${chapter}`);
    if (!vs) throw new Error(`KJV has no ${book.id} ${chapter}`);
    const orig = origOf(book.id, chapter);
    const cand = candidatesByVerse(
      orig,
      vs.map((v) => v.verse),
    );
    return { book, chapter, vs, orig, cand, keysOf: keysFor(orig.words, groups) };
  });

  // Pass 1: direct matching only, to learn where the KJV's numbering differs from the source's.
  const stats: { unlinked: string[]; free: string[] }[] = [];
  for (const ch of chapters) {
    for (const v of ch.vs) stats.push(linkKjvVerse(v.entries, ch.orig.words, ch.cand.get(v.verse) ?? [], { keysOf: ch.keysOf }));
  }
  const equiv = learnEquivalences(stats);
  log('kjv', `learned ${equiv.size} Strong's equivalences, e.g. ${[...equiv].slice(0, 8).map(([s, e]) => `${s}->${e.join('/')}`).join(', ')}`);

  const titles = parseKjvPsalmTitles(readFileSync(srcPath('kjv.osis.xml'), 'utf8'));
  let titled = 0;
  cleanOut('text', 'KJV');
  let files = 0;
  let bytes = 0;
  let verses = 0;
  let words = 0;
  let tagged = 0;
  let linked = 0;
  let italic = 0;
  let unlinkedTags = 0;
  const notInBsb: string[] = [];
  const notInKjv: string[] = [];
  for (const { book, chapter, vs, orig, cand, keysOf } of chapters) {
    const bsb = readJson<TextChapter>(outPath('text', 'BSB', book.id, `${chapter}.json`));
    const bsbVerses = new Set(bsb.verses.map((v) => v.v));
    const kjvVerses = new Set(vs.map((v) => v.verse));
    for (const v of vs) if (!bsbVerses.has(v.verse)) notInBsb.push(`${book.id} ${chapter}:${v.verse}`);
    for (const v of bsbVerses) if (!kjvVerses.has(v)) notInKjv.push(`${book.id} ${chapter}:${v}`);

    const out: TextChapter = { tr: 'KJV', book: book.id, chapter, verses: [] };
    const title = book.id === 'PSA' ? titles.get(chapter) : undefined;
    if (title) {
      // Linked like the bridged translations (approximate), through the BSB title's links.
      out.superscription = bridgeText(title, bsb.superscription, orig, 0, table);
      titled++;
    }
    for (const v of vs) {
      const res = linkKjvVerse(v.entries, orig.words, cand.get(v.verse) ?? [], { table, keysOf, equiv });
      const tv: TextVerse = { v: v.verse, t: piecesToTokens(res.pieces) };
      out.verses.push(tv);
      verses++;
      tagged += res.tags;
      linked += res.linked;
      for (const p of res.pieces) {
        if (!p.word) continue;
        words++;
        if (p.word.info?.i) italic++;
        unlinkedTags += p.word.info?.s?.length ?? 0;
      }
    }
    bytes += writeJson(outPath('text', 'KJV', book.id, `${chapter}.json`), out);
    files++;
  }
  log(
    'kjv',
    `${files} chapters, ${verses} verses, ${words} words; ${linked}/${tagged} tagged words linked to an original word ` +
      `(${((100 * linked) / tagged).toFixed(1)}%), ${unlinkedTags} Strong's tags kept as lexicon-only; ${italic} italic words; ` +
      `${titled} Psalm titles (eBible OSIS, bridged links); ${(bytes / 1e6).toFixed(1)} MB`,
  );
  log('kjv', `verses not in the BSB (${notInBsb.length}): ${notInBsb.join(', ')}`);
  log('kjv', `BSB verses not in the KJV (${notInKjv.length}): ${notInKjv.join(', ') || 'none'}`);
}

/** Exposed for the evaluation script: the BSB-only table builder over all chapters. */
export { TableBuilder };
