/**
 * Stage "orig": original-language words for every English chapter.
 *
 *   NT: SBLGNT.tsv (Clear-Bible's SBLGNT word list)            -> public/data/orig/{BOOK}/{C}.json  (lang "grc")
 *   OT: WLCM.tsv (WLC morphemes) + macula-hebrew.tsv enrichment  -> public/data/orig/{BOOK}/{C}.json  (lang "hbo")
 *
 * Files are keyed by ENGLISH (BSB) versification. Each source word is assigned to the English
 * verse it is translated in, using the manual BSB alignment (see `assignVerses`), so e.g. Hebrew
 * Mal 3:19-24 lands in MAL/4.json (with OW.ref "3:19"...) and Psalm-title words get verse 0.
 * About 15 NT alignment records that lump a whole following verse onto one English word are
 * pruned first (`pruneSuspectRecords`), so those words land in the English verse they belong to.
 * Hebrew transliteration comes from Macula; where Macula has none (mostly words with pronominal
 * suffixes, ~20% of morphemes) `transliterateHebrewWord` generates it in the same style.
 *
 * `computeOrigLayout` is exported because the bsb stage needs the very same source-id -> index
 * mapping to turn alignment records into token links.
 */
import { foldWord } from '../../src/lib/tokenize';
import type { OrigChapter, OrigWord } from '../../src/lib/types';
import {
  allChapters,
  cleanOut,
  log,
  normStrongs,
  outPath,
  readAlignment,
  readBsbTokens,
  readTsvColumns,
  writeJson,
  type AlignRecord,
  type BsbTokenRow,
  type Testament,
} from './common';

/* ------------------------------------------------------------------------ */
/* Versification                                                             */
/* ------------------------------------------------------------------------ */

export interface VerseAssignInput {
  /** Source verse key BBCCCVVV (Greek/Hebrew numbering). */
  src: string;
  /** English verse keys (BBCCCVVV) of every BSB token aligned to this word (with multiplicity). */
  aligned: string[];
}

/** Most frequent key; ties go to the one seen first. */
export function majority(keys: readonly string[]): string | undefined {
  if (keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0];
  const counts = new Map<string, number>();
  let best = keys[0];
  let bestN = 0;
  for (const k of keys) {
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/**
 * Decide the English verse (BBCCCVVV) of every source word, given in source order.
 *
 *  1. Aligned words: the English verse of the BSB tokens aligned to them (majority).
 *  2. Unaligned words in a source verse that has aligned words: the nearest aligned word of the
 *     same source verse (ties -> the preceding one). Exception: in a source verse 1 that also holds
 *     an English Psalm title (English verse 000 exists, aligned words start English verse 1), the
 *     unaligned words before the first aligned word are the title -> English verse 000. And when
 *     an "orphan" English verse (tokens, but no aligned word) claims this source verse (`orphans`,
 *     from the target TSV), unaligned words after the last / before the first aligned word go there.
 *  3. Source verses with no aligned word at all: `srcVerseMap` (source verse -> English verse,
 *     from the BSB target TSV's source_verse column).
 *  4. Still unassigned: the same numbers if that English verse exists, clamped between the
 *     English verses of the surrounding assigned words of the same book (so an unaligned Hebrew
 *     Psalm title verse 1 followed by verse 2 = English 0 becomes English 0, not 1); otherwise
 *     inherit from the previous word of the same book (else the next).
 */
export function assignVerses(
  words: readonly VerseAssignInput[],
  srcVerseMap: ReadonlyMap<string, string>,
  englishExists: (key: string) => boolean,
  orphans: ReadonlyMap<string, readonly string[]> = new Map(),
): string[] {
  const n = words.length;
  const out: (string | undefined)[] = words.map((w) => majority(w.aligned));
  const unresolved: [number, number][] = [];

  for (let i = 0; i < n; ) {
    let j = i;
    while (j < n && words[j].src === words[i].src) j++;
    const aligned: number[] = [];
    for (let k = i; k < j; k++) if (out[k] !== undefined) aligned.push(k);
    if (aligned.length) {
      // A source verse 1 whose aligned words start English verse 1 of a chapter that has an English
      // title (verse 000): its leading unaligned words are the title (Ps 90:1 "A prayer of Moses...").
      const first = out[aligned[0]]!;
      const last = out[aligned[aligned.length - 1]]!;
      const titleKey = first.slice(0, 5) + '000';
      const leadIsTitle = words[i].src.endsWith('001') && first.endsWith('001') && englishExists(titleKey);
      // Orphan English verses (no aligned words) that claim this source verse take its unaligned
      // words beyond the aligned ones: trailing words -> the next orphan, leading -> the previous.
      const orph = orphans.get(words[i].src) ?? [];
      const trailTo = orph.find((e) => e > last && e.slice(0, 5) === last.slice(0, 5));
      const leadTo = [...orph].reverse().find((e) => e < first && e.slice(0, 5) === first.slice(0, 5) && !e.endsWith('000'));
      let a = 0; // aligned[a] is the first aligned index >= k (or past the end)
      for (let k = i; k < j; k++) {
        while (a < aligned.length && aligned[a] < k) a++;
        if (out[k] !== undefined) continue;
        if (a === 0 && leadIsTitle) {
          out[k] = titleKey;
          continue;
        }
        const edge = a === 0 ? leadTo : a === aligned.length ? trailTo : undefined;
        if (edge !== undefined) {
          out[k] = edge;
          continue;
        }
        const prev = a > 0 ? aligned[a - 1] : -1;
        const next = a < aligned.length ? aligned[a] : -1;
        const pick = prev < 0 ? next : next < 0 ? prev : k - prev <= next - k ? prev : next;
        out[k] = out[pick];
      }
    } else {
      const mapped = srcVerseMap.get(words[i].src);
      if (mapped !== undefined) for (let k = i; k < j; k++) out[k] = mapped;
      else unresolved.push([i, j]);
    }
    i = j;
  }

  for (const [i, j] of unresolved) {
    const src = words[i].src;
    let before: string | undefined;
    for (let k = i - 1; k >= 0 && sameBook(words[k].src, src); k--) if ((before = out[k]) !== undefined) break;
    let after: string | undefined;
    for (let k = j; k < n && sameBook(words[k].src, src); k++) if ((after = out[k]) !== undefined) break;
    let key: string | undefined;
    if (englishExists(src)) {
      key = src;
      if (after !== undefined && key > after) key = after;
      if (before !== undefined && key < before) key = before;
    } else key = before ?? after;
    if (key === undefined) throw new Error(`No English verse could be assigned to source verse ${src}`);
    for (let k = i; k < j; k++) out[k] = key;
  }
  return out as string[];
}

const sameBook = (a: string, b: string) => a.slice(0, 2) === b.slice(0, 2);

/** Source verse -> English verse it is mostly translated in, from the BSB target TSV's source_verse column. */
export function sourceVerseMap(tokens: readonly Pick<BsbTokenRow, 'id' | 'srcVerse'>[]): Map<string, string> {
  const votes = new Map<string, string[]>();
  for (const t of tokens) {
    if (!t.srcVerse) continue;
    let list = votes.get(t.srcVerse);
    if (!list) votes.set(t.srcVerse, (list = []));
    list.push(t.id.slice(0, 8));
  }
  const out = new Map<string, string>();
  for (const [src, keys] of votes) out.set(src, majority(keys)!);
  return out;
}

/** "C:V" of a BBCCCVVV key. */
export const cvOf = (key: string) => `${Number(key.slice(2, 5))}:${Number(key.slice(5, 8))}`;

/* ------------------------------------------------------------------------ */
/* Layout: which English chapter / index each source word lands in           */
/* ------------------------------------------------------------------------ */

export interface LayoutWord {
  id: string;
  /** English verse number within the chapter (0 = Psalm title). */
  verse: number;
  /** Source "C:V" when it differs from the English chapter:verse, else "". */
  ref: string;
}

export interface OrigLayout {
  /** English chapter key (BBCCC) -> its words in source order. */
  chapters: Map<string, LayoutWord[]>;
  /** Source id -> [English chapter key, index in that chapter's words]. */
  pos: Map<string, [string, number]>;
  /** Alignment records (kept so callers need not re-read them). */
  records: AlignRecord[];
  /** BSB target tokens (kept so callers need not re-read them). */
  bsb: BsbTokenRow[];
  /** Source links removed from suspect alignment records (see `pruneSuspectRecords`). */
  prunedLinks: number;
}

/** Source verse key BBCCCVVV of a source id ("n40001001001" / "o010010010011"). */
export const srcVerseOf = (id: string) => id.slice(1, 9);

/**
 * Lay out source words by English chapter. Pure given its inputs; `buildOrig` and `buildBsb`
 * both call it so their indices agree.
 */
export function layoutWords(sourceIds: readonly string[], records: readonly AlignRecord[], bsb: readonly BsbTokenRow[]): Pick<OrigLayout, 'chapters' | 'pos'> {
  const alignedTo = new Map<string, string[]>();
  const alignedEnglish = new Set<string>();
  for (const [src, tgt] of records) {
    const verses = tgt.map((t) => t.slice(0, 8));
    for (const v of verses) alignedEnglish.add(v);
    for (const s of src) {
      const list = alignedTo.get(s);
      if (list) list.push(...verses);
      else alignedTo.set(s, [...verses]);
    }
  }
  const english = new Set(bsb.map((t) => t.id.slice(0, 8)));
  const orphans = new Map<string, string[]>();
  for (const t of bsb) {
    const e = t.id.slice(0, 8);
    if (alignedEnglish.has(e) || !t.srcVerse) continue;
    const list = orphans.get(t.srcVerse) ?? [];
    if (!list.includes(e)) orphans.set(t.srcVerse, [...list, e].sort());
  }
  const inputs = sourceIds.map((id) => ({ src: srcVerseOf(id), aligned: alignedTo.get(id) ?? [] }));
  const verses = assignVerses(inputs, sourceVerseMap(bsb), (k) => english.has(k), orphans);

  const chapters = new Map<string, LayoutWord[]>();
  const pos = new Map<string, [string, number]>();
  sourceIds.forEach((id, i) => {
    const eng = verses[i];
    const ch = eng.slice(0, 5);
    let list = chapters.get(ch);
    if (!list) chapters.set(ch, (list = []));
    const src = inputs[i].src;
    pos.set(id, [ch, list.length]);
    list.push({ id, verse: Number(eng.slice(5, 8)), ref: src === eng ? '' : cvOf(src) });
  });
  return { chapters, pos };
}

/** What the suspect-record test needs to know about the target text. */
export interface RecordContext {
  /** English verses (BBCCCVVV) whose tokens name this source verse in the target TSV's source_verse. */
  claimants(srcVerse: string): ReadonlySet<string>;
  /** True if an English verse with no aligned token at all claims this source verse. */
  orphanClaimed(srcVerse: string): boolean;
}

/** Context where every source verse is translated by the same-numbered English verse. */
export const IDENTITY_CONTEXT: RecordContext = { claimants: (v) => new Set([v]), orphanClaimed: () => false };

/**
 * A few manual alignment records lump a whole following source verse (or the Shorter Ending of
 * Mark) onto one or two English words at the end of the previous verse, e.g. 1 John 2:13 "Father"
 * <- all 27 words of SBLGNT 2:14, leaving English 2:14 with no aligned word at all. Such a record
 * is suspect when
 *  - its sources all lie in verses claimed by an orphan English verse and not by the target's, or
 *  - it has many more sources than targets (>= 6 and >= 4x) and either very many (>= 20), sources
 *    mostly from a verse the target verse does not translate (>= 8), or any orphan-claimed source.
 */
export function isSuspectRecord([src, tgt]: AlignRecord, ctx: RecordContext = IDENTITY_CONTEXT): boolean {
  const target = tgt[0].slice(0, 8);
  const srcVerses = [...new Set(src.map(srcVerseOf))];
  const translatedHere = (v: string) => ctx.claimants(v).has(target);
  const orphanSource = srcVerses.some((v) => ctx.orphanClaimed(v));
  if (src.length >= 3 && orphanSource && !srcVerses.some(translatedHere)) return true;
  if (src.length < 6 || src.length < 4 * tgt.length) return false;
  if (src.length >= 20) return true;
  return (src.length >= 8 && !translatedHere(majority(src.map(srcVerseOf))!)) || orphanSource;
}

/** Build the RecordContext for a testament from its (raw) records and target tokens. */
export function recordContext(records: readonly AlignRecord[], bsb: readonly Pick<BsbTokenRow, 'id' | 'srcVerse'>[]): RecordContext {
  const aligned = new Set<string>();
  for (const [, tgt] of records) for (const t of tgt) aligned.add(t.slice(0, 8));
  const claim = new Map<string, Set<string>>();
  const orphan = new Set<string>();
  for (const t of bsb) {
    if (!t.srcVerse) continue;
    const e = t.id.slice(0, 8);
    let set = claim.get(t.srcVerse);
    if (!set) claim.set(t.srcVerse, (set = new Set()));
    set.add(e);
    if (!e.endsWith('000') && !aligned.has(e)) orphan.add(t.srcVerse);
  }
  return { claimants: (v) => claim.get(v) ?? new Set([v]), orphanClaimed: (v) => orphan.has(v) };
}

/** Lower-cased words of a gloss: "they were afraid" -> {they, were, afraid}. */
export const glossWordSet = (gloss: string) =>
  new Set(cleanGloss(gloss).toLowerCase().split(/[^\p{L}']+/u).filter(Boolean));

/**
 * Keep suspect records only for the source words whose gloss shares a word with the English they
 * are aligned to ("Father" keeps πατέρα); the other sources become unaligned. Returns the cleaned
 * records and how many source links were removed.
 */
export function pruneSuspectRecords(
  records: readonly AlignRecord[],
  glossOf: (sourceId: string) => string,
  englishOf: (targetId: string) => string,
  ctx: RecordContext = IDENTITY_CONTEXT,
): { records: AlignRecord[]; removed: number } {
  let removed = 0;
  const out: AlignRecord[] = [];
  for (const rec of records) {
    if (!isSuspectRecord(rec, ctx)) {
      out.push(rec);
      continue;
    }
    const eng = new Set(rec[1].map((t) => foldWord(englishOf(t))));
    const keep = rec[0].filter((s) => [...glossWordSet(glossOf(s))].some((g) => eng.has(foldWord(g))));
    removed += rec[0].length - keep.length;
    if (keep.length) out.push([keep, rec[1]]);
  }
  return { records: out, removed };
}

/** Read the source ids of a testament (cheap) and lay them out. */
export function computeOrigLayout(t: Testament): OrigLayout {
  const rows =
    t === 'NT'
      ? readTsvColumns('SBLGNT.tsv', ['id', 'gloss', 'gloss2'] as const)
      : readTsvColumns('WLCM.tsv', ['id', 'gloss', 'gloss2'] as const);
  const ids: string[] = [];
  const gloss = new Map<string, string>();
  for (const r of rows) {
    if (!r.id) continue;
    ids.push(r.id);
    gloss.set(r.id, `${r.gloss} ${r.gloss2}`);
  }
  const bsb = readBsbTokens(t);
  const text = new Map(bsb.map((tk) => [tk.id, tk.text]));
  const raw = readAlignment(t);
  const { records, removed } = pruneSuspectRecords(raw, (s) => gloss.get(s) ?? '', (id) => text.get(id) ?? '', recordContext(raw, bsb));
  const layout = layoutWords(ids, records, bsb);
  return { ...layout, records, bsb, prunedLinks: removed };
}

/* ------------------------------------------------------------------------ */
/* Glosses                                                                   */
/* ------------------------------------------------------------------------ */

/** Tidy an interlinear gloss: drop brackets (keeping implied words), dots-for-spaces, stray punctuation. */
export function cleanGloss(raw: string): string {
  let g = raw.trim();
  if (!g || g === '-' || g === '~') return '';
  g = g
    .replace(/\[|\]/g, '')
    .replace(/^~\s*/, '')
    .replace(/(?<=\p{L})\.(?=\p{L})/gu, ' ') // macula "he.said" -> "he said"
    .replace(/[.,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (g === '-' || /^\((?:et|dm)\)$/.test(g)) return '';
  return g;
}

/** Fallback glosses for very common words the sources leave unglossed (articles, object marker). */
const GLOSS_FALLBACK: Record<string, string> = {
  G3588: 'the',
  G3754: 'that',
  H0853: '[direct object]',
  H1886a: 'the',
};

function firstGloss(strongs: string, ...candidates: string[]): string {
  for (const c of candidates) {
    const g = cleanGloss(c);
    if (g) return g;
  }
  return GLOSS_FALLBACK[strongs] ?? '';
}

/* ------------------------------------------------------------------------ */
/* Hebrew transliteration (fallback when Macula has none)                    */
/* ------------------------------------------------------------------------ */

const H_CONS: Record<string, string> = {
  א: 'ʾ', ב: 'b', ג: 'g', ד: 'd', ה: 'h', ו: 'w', ז: 'z', ח: 'ḥ', ט: 'ṭ', י: 'y', כ: 'k', ך: 'k',
  ל: 'l', מ: 'm', ם: 'm', נ: 'n', ן: 'n', ס: 's', ע: 'ʿ', פ: 'p', ף: 'p', צ: 'ṣ', ץ: 'ṣ', ק: 'q',
  ר: 'r', ש: 'š', ת: 't',
};
const H_SPIRANT: Record<string, string> = { ב: 'ḇ', ג: 'ḡ', ד: 'ḏ', כ: 'ḵ', ך: 'ḵ', פ: 'p̄', ף: 'p̄', ת: 'ṯ' };
const H_VOWEL: Record<string, string> = {
  '\u05B1': 'ĕ', '\u05B2': 'ă', '\u05B3': 'ŏ', '\u05B4': 'i', '\u05B5': 'ē', '\u05B6': 'e',
  '\u05B7': 'a', '\u05B8': 'ā', '\u05B9': 'ō', '\u05BA': 'ō', '\u05BB': 'u', '\u05C7': 'o',
};
const SHEVA = '\u05B0';
const PATAH = '\u05B7';
const DAGESH = '\u05BC';
const SIN_DOT = '\u05C2';
const LONG_VOWELS = new Set(['ā', 'ē', 'ō']);
const isHolam = (v: string) => v === '\u05B9' || v === '\u05BA';

interface HUnit {
  letter: string;
  /** A point from H_VOWEL or SHEVA, or '' for none (the first full vowel when there are several). */
  vowel: string;
  /** Second full vowel on the same letter (perpetual qere, e.g. the lamed of יְרוּשָׁלִַם). */
  vowel2: string;
  dagesh: boolean;
  sin: boolean;
  /** Index of the morpheme this letter belongs to. */
  m: number;
  /** First letter of its morpheme. */
  start: boolean;
}

function hebrewUnits(morphemes: readonly string[]): HUnit[] {
  const units: HUnit[] = [];
  morphemes.forEach((text, m) => {
    let cur: HUnit | undefined;
    for (const ch of text.normalize('NFD')) {
      if (H_CONS[ch] !== undefined) {
        units.push((cur = { letter: ch, vowel: '', vowel2: '', dagesh: false, sin: false, m, start: !cur }));
      } else if (!cur) continue;
      else if (ch === DAGESH) cur.dagesh = true;
      else if (ch === SIN_DOT) cur.sin = true;
      else if (ch === SHEVA) cur.vowel ||= ch;
      else if (H_VOWEL[ch] !== undefined) {
        if (!cur.vowel || cur.vowel === SHEVA) cur.vowel = ch;
        else cur.vowel2 = ch;
      }
    }
  });
  return units;
}

/** A waw that is itself a vowel: shureq (וּ) or holem-waw (וֹ). */
const isVowelWaw = (u: HUnit | undefined) =>
  !!u && u.letter === 'ו' && ((u.dagesh && !u.vowel) || (isHolam(u.vowel) && !u.dagesh));

/**
 * Academic-style transliteration of one pointed Hebrew written word given as its morphemes
 * (e.g. ["וּ", "מִשְׁעַנְתֶּ", "ךָ"]); returns one string per morpheme. Follows the conventions of
 * Macula Hebrew's own transliteration so generated and supplied forms look alike: ʾ ʿ ḥ ṭ ṣ š ś,
 * spirants ḇ ḡ ḏ ḵ p̄ ṯ, ə for vocal sheva (always at a morpheme start), ô / û for holem-waw /
 * shureq, doubled consonants for dagesh forte (not for b g d k p t at a morpheme start), and
 * matres written as consonants ("iy", "ēy", "āh").
 */
export function transliterateHebrewWord(morphemes: readonly string[]): string[] {
  const units = hebrewUnits(morphemes);
  const out = morphemes.map(() => '');
  // What precedes the current letter: '' word start, 'n' unpointed consonant, 's' silent sheva,
  // 'v' short vowel / vocal sheva, 'L' long vowel (incl. vowel + mater).
  let prev = '' as '' | 'n' | 's' | 'v' | 'L';
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const { letter, vowel, dagesh, sin, m } = u;
    const last = i === units.length - 1;
    const next = units[i + 1];

    if (isVowelWaw(u) && (prev === '' || prev === 'n')) {
      out[m] += dagesh ? 'û' : 'ô';
      prev = 'L';
      continue;
    }

    // Unpointed yod / he / aleph after a vowel are matres (written, but they open no syllable) —
    // unless a vowel-waw follows, which makes them the onset of that syllable (šāʾûl).
    if (!vowel && !dagesh && (prev === 'v' || prev === 'L') && 'יהא'.includes(letter) && !isVowelWaw(next)) {
      out[m] += H_CONS[letter];
      prev = 'L';
      continue;
    }

    let cons = letter === 'ש' && sin ? 'ś' : H_CONS[letter];
    const begadkephat = H_SPIRANT[letter] !== undefined;
    if (begadkephat && !dagesh) cons = H_SPIRANT[letter];
    const doubled =
      dagesh && letter !== 'ה' && (prev === 'v' || prev === 'L') && !(u.start && begadkephat);
    if (doubled) cons += cons;

    if (last && vowel === PATAH && prev === 'L' && (letter === 'ח' || letter === 'ע' || (letter === 'ה' && dagesh))) {
      out[m] += 'ᵃ' + cons; // furtive patah: rûᵃḥ
      prev = 'v';
      continue;
    }

    out[m] += cons;
    if (vowel === SHEVA) {
      const vocal = !last && (u.start || prev === '' || prev === 's' || prev === 'L' || doubled);
      if (vocal) out[m] += 'ə';
      prev = vocal ? 'v' : 's';
    } else if (vowel) {
      let v = H_VOWEL[vowel];
      // כָּל / כָל "all": qamets hatuf.
      if (v === 'ā' && letter === 'כ' && next?.letter === 'ל' && !next.vowel && next === units.at(-1)) v = 'o';
      if (u.vowel2) v = vowel === '\u05B4' ? H_VOWEL[u.vowel2] + 'i' : v + H_VOWEL[u.vowel2];
      out[m] += v;
      prev = LONG_VOWELS.has(v) ? 'L' : 'v';
    } else {
      prev = 'n';
    }
  }
  return out;
}

/** Macula transliteration minus maqqef / sof-pasuq marks it appends ("ʿal-", "ʾāreṣ:"). */
export function cleanTranslit(raw: string): string {
  return raw.trim().replace(/[-:־׃]+$/u, '');
}

/** Normalise an LXX equivalent from Macula: "greek|G####", or "" when there is none. */
export function lxxOf(greek: string, greekStrong: string): string {
  const forms = greek.split('|').map((s) => s.trim()).filter((s) => /[Ͱ-Ͽἀ-῿]/u.test(s));
  if (!forms.length) return '';
  const strong = greekStrong.split('|').map((s) => normStrongs('G', s)).find(Boolean) ?? '';
  return `${forms.join(' ')}|${strong}`;
}

/* ------------------------------------------------------------------------ */
/* Build                                                                     */
/* ------------------------------------------------------------------------ */

/** "G0000" / "H0000" are placeholders for words without a Strong's number. */
const realStrongs = (id: string) => (/^[GH]0000$/.test(id) ? '' : id);

/** Word data independent of English versification (verse/ref/group filled in later). */
type BaseWord = { text: string; strongs: string; lemma: string; morph: string; gloss: string; translit: string; lxx: string; aramaic: boolean };

function greekWords(): Map<string, BaseWord> {
  const rows = readTsvColumns('SBLGNT.tsv', ['id', 'text', 'strongs', 'gloss', 'gloss2', 'lemma', 'morph'] as const);
  const out = new Map<string, BaseWord>();
  for (const r of rows) {
    if (!r.id) continue;
    const strongs = realStrongs(normStrongs('G', r.strongs));
    out.set(r.id, {
      text: r.text,
      strongs,
      lemma: r.lemma,
      morph: r.morph,
      gloss: firstGloss(strongs, r.gloss2, r.gloss),
      translit: '',
      lxx: '',
      aramaic: false,
    });
  }
  return out;
}

function hebrewWords(): Map<string, BaseWord> {
  type MaculaCol = 'xml:id' | 'transliteration' | 'strongnumberx' | 'greek' | 'greekstrong' | 'gloss' | 'english' | 'morph' | 'lang' | 'lemma';
  const cols: MaculaCol[] = ['xml:id', 'transliteration', 'strongnumberx', 'greek', 'greekstrong', 'gloss', 'english', 'morph', 'lang', 'lemma'];
  const macula = new Map<string, Record<MaculaCol, string>>();
  for (const r of readTsvColumns('macula-hebrew.tsv', cols)) macula.set(r['xml:id'], r);

  const rows = readTsvColumns('WLCM.tsv', ['id', 'text', 'strongs', 'gloss', 'gloss2'] as const).filter((r) => r.id);
  const out = new Map<string, BaseWord>();
  let generated = 0;
  // Walk written words (morphemes sharing an id minus its last char) so transliteration sees the whole word.
  for (let i = 0; i < rows.length; ) {
    const wordKey = rows[i].id.slice(0, -1);
    let j = i;
    while (j < rows.length && rows[j].id.slice(0, -1) === wordKey) j++;
    const morphs = rows.slice(i, j);
    const mac = morphs.map((r) => {
      const m = macula.get(r.id);
      if (!m) throw new Error(`Macula Hebrew has no row for ${r.id}`);
      return m;
    });
    const supplied = mac.map((m) => cleanTranslit(m.transliteration));
    const fallback = supplied.some((t) => !t) ? transliterateHebrewWord(morphs.map((r) => r.text)) : [];
    morphs.forEach((r, k) => {
      const m = mac[k];
      const strongs = realStrongs(normStrongs('H', (m.strongnumberx || r.strongs).split('|')[0]));
      let translit = supplied[k];
      if (!translit) {
        translit = fallback[k];
        generated++;
      }
      out.set(r.id, {
        text: r.text,
        strongs,
        lemma: m.lemma,
        morph: m.morph,
        gloss: firstGloss(strongs, r.gloss, m.english, m.gloss, r.gloss2),
        translit,
        lxx: lxxOf(m.greek, m.greekstrong),
        aramaic: m.lang === 'A',
      });
    });
    i = j;
  }
  log('orig', `Hebrew: ${out.size} morphemes; generated transliteration for ${generated} that Macula leaves blank`);
  return out;
}

export function buildOrig(): void {
  cleanOut('orig');
  const all = allChapters();
  let files = 0;
  let bytes = 0;
  let words = 0;
  let moved = 0;
  for (const t of ['NT', 'OT'] as const) {
    const layout = computeOrigLayout(t);
    log('orig', `${t}: ignored ${layout.prunedLinks} source links from ${t === 'NT' ? 'SBLGNT' : 'WLC'} alignment records that lump a whole verse onto one word`);
    const base = t === 'NT' ? greekWords() : hebrewWords();
    if (base.size !== layout.pos.size) throw new Error(`${t}: ${base.size} words but layout has ${layout.pos.size}`);
    for (const { book, chapter, key } of all) {
      if (book.testament !== t) continue;
      const list = layout.chapters.get(key) ?? [];
      if (!list.length) log('orig', `WARNING: ${book.id} ${chapter} has no original-language words`);
      const groupStart = new Map<string, number>();
      const aramaic: number[] = [];
      const out: OrigWord[] = list.map((lw, i) => {
        const w = base.get(lw.id)!;
        let group = i;
        if (t === 'OT') {
          const wk = lw.id.slice(0, -1);
          const g = groupStart.get(wk);
          if (g === undefined) groupStart.set(wk, i);
          else group = g;
        }
        if (w.aramaic) aramaic.push(i);
        if (lw.ref) moved++;
        return [w.text, w.strongs, w.lemma, w.morph, w.gloss, lw.verse, lw.ref, group, w.translit, w.lxx];
      });
      const chapterJson: OrigChapter = {
        book: book.id,
        chapter,
        lang: t === 'NT' ? 'grc' : 'hbo',
        edition: t === 'NT' ? 'SBLGNT' : 'WLC',
        words: out,
      };
      if (aramaic.length) chapterJson.aramaic = aramaic;
      bytes += writeJson(outPath('orig', book.id, `${chapter}.json`), chapterJson);
      files++;
      words += out.length;
    }
    // Every layout chapter must be a real chapter of the canon.
    const known = new Set(all.map((c) => c.key));
    for (const k of layout.chapters.keys()) if (!known.has(k)) throw new Error(`${t}: words assigned to unknown chapter ${k}`);
  }
  log('orig', `${files} chapter files, ${words} words (${moved} re-keyed to English versification), ${(bytes / 1e6).toFixed(1)} MB`);
}
