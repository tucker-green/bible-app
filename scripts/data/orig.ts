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
import { FUNCTION_WORDS } from '../../src/lib/align/normalize';
import { foldWord } from '../../src/lib/tokenize';
import { greekFold, parseStepLexicon } from './lexicon';
import { loadHomonyms } from './homonyms';
import { readFileSync } from 'node:fs';
import type { OrigChapter, OrigWord } from '../../src/lib/types';
import {
  allChapters,
  baseStrongs,
  cleanOut,
  log,
  normStrongs,
  outPath,
  readAlignment,
  readBsbTokens,
  readTsvColumns,
  srcPath,
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
  /** Verses whose shuffled records were re-paired (see `repairShiftedRecords`). */
  shifted?: { verses: string[]; repaired: number; dropped: number };
}

/** Source verse key BBCCCVVV of a source id ("n40001001001" / "o010010010011"). */
export const srcVerseOf = (id: string) => id.slice(1, 9);

/**
 * Lay out source words by English chapter. Pure given its inputs; `buildOrig` and `buildBsb`
 * both call it so their indices agree.
 */
export function layoutWords(
  sourceIds: readonly string[],
  records: readonly AlignRecord[],
  bsb: readonly BsbTokenRow[],
  extraEnglish: readonly string[] = [],
  overrides: Readonly<Record<string, string>> = {},
): Pick<OrigLayout, 'chapters' | 'pos'> {
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
  const english = new Set([...bsb.map((t) => t.id.slice(0, 8)), ...extraEnglish]);
  const orphans = new Map<string, string[]>();
  for (const t of bsb) {
    const e = t.id.slice(0, 8);
    if (alignedEnglish.has(e) || !t.srcVerse) continue;
    const list = orphans.get(t.srcVerse) ?? [];
    if (!list.includes(e)) orphans.set(t.srcVerse, [...list, e].sort());
  }
  const inputs = sourceIds.map((id) => ({ src: srcVerseOf(id), aligned: alignedTo.get(id) ?? [] }));
  const verses = assignVerses(inputs, sourceVerseMap(bsb), (k) => english.has(k), orphans).map((v, i) => overrides[inputs[i].src] ?? v);

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

/* ------------------------------------------------------------------------ */
/* Shifted alignment records                                                 */
/* ------------------------------------------------------------------------ */

/** What the shift repair needs to know about each source / target id. */
export interface RecordInfo {
  /** Interlinear gloss of a source word ("gloss gloss2"). */
  glossOf(sourceId: string): string;
  /** Strong's id of a source word ("" if none). */
  strongsOf(sourceId: string): string;
  /** Text of a target (BSB) token; "" for punctuation / excluded tokens. */
  englishOf(targetId: string): string;
}

/** Stem used to compare an English word with a gloss word (case, possessive and plural folded). */
const engStem = (w: string) => {
  let s = foldWord(w).replace(/[^\p{L}]/gu, '');
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
};

/** Association of English words and Strong's numbers over alignment records (each record counted once per pair). */
export class RecordAssoc {
  private pair = new Map<string, number>();
  private src = new Map<string, number>();
  private eng = new Map<string, number>();
  add(strongs: Iterable<string>, english: Iterable<string>): void {
    const E = new Set(english);
    for (const e of E) this.eng.set(e, (this.eng.get(e) ?? 0) + 1);
    for (const s of new Set(strongs)) {
      this.src.set(s, (this.src.get(s) ?? 0) + 1);
      for (const e of E) this.pair.set(`${s} ${e}`, (this.pair.get(`${s} ${e}`) ?? 0) + 1);
    }
  }
  /** sqrt(P(e | s) * P(s | e)): high only when each predicts the other; 0 below `min` co-occurrences. */
  geo(s: string, e: string, min = 3): number {
    const c = this.pair.get(`${s} ${e}`) ?? 0;
    return c >= min ? Math.sqrt((c / (this.src.get(s) ?? 1)) * (c / (this.eng.get(e) ?? 1))) : 0;
  }
}

/** Minimum fit of a source word and an English word to count as a translation pair. */
const FIT_MIN = 0.15;

/**
 * Some hand-made alignment records pair each source word of a verse with the English of a different
 * source word (the targets are shuffled by one or more records: John 15:1 εἰμι -> "the", ἡ -> "true",
 * ἄμπελος -> "and"; Rev 1:1 Ἰησοῦ -> "Christ"; Gen 29:24 Leah -> "daughter"), a few hundred verses.
 * A source word fits an English word when its gloss contains it, else by the association learned
 * from all records (geometric mean of both conditional probabilities, so "of" / "the" fit no noun).
 * Per English verse with at least 3 records that fit nothing they are paired with (and 30% of its
 * records): all its records are re-paired by best fit (a source word takes a second English word
 * only right next to its first), and English words nothing fits stay unaligned. The repair is kept
 * only when it fits at least 3 more source words to a content word than the original pairing (and
 * 1.5 times as many):
 * a loose but correct translation is left alone. Repaired records are flagged (third element).
 */
export function repairShiftedRecords(
  records: readonly AlignRecord[],
  info: RecordInfo,
): { records: AlignRecord[]; verses: string[]; repaired: number; dropped: number } {
  const assoc = new RecordAssoc();
  const engOf = (t: string) => {
    const e = info.englishOf(t);
    return /[\p{L}\p{N}]/u.test(e) ? engStem(e) : '';
  };
  for (const [src, tgt] of records) {
    const strongs = src.map((x) => info.strongsOf(x)).filter(Boolean);
    const eng = tgt.map(engOf).filter(Boolean);
    if (strongs.length && eng.length) assoc.add(strongs, eng);
  }
  const glossStems = new Map<string, Set<string>>();
  const stemsOf = (sid: string) => {
    let g = glossStems.get(sid);
    if (!g) glossStems.set(sid, (g = new Set([...glossWordSet(info.glossOf(sid))].map(engStem).filter(Boolean))));
    return g;
  };
  // A gloss word that is a function word ("will" in "will.melt", "a") is weaker evidence than a content word.
  const fit = (sid: string, e: string) => {
    if (!e) return 0;
    if (stemsOf(sid).has(e)) return FUNCTION_WORDS.has(e) ? 0.5 : 1;
    const s = info.strongsOf(sid);
    return s ? assoc.geo(s, e) : 0;
  };
  const fitsAny = (sid: string, tgt: readonly string[]) => tgt.some((t) => fit(sid, engOf(t)) >= FIT_MIN);
  const matches = ([src, tgt]: AlignRecord) => !tgt.some((t) => engOf(t)) || src.some((sid) => fitsAny(sid, tgt));

  const byVerse = new Map<string, number[]>();
  records.forEach(([, tgt], i) => {
    if (!tgt.length) return;
    const v = tgt[0].slice(0, 8);
    const list = byVerse.get(v);
    if (list) list.push(i);
    else byVerse.set(v, [i]);
  });
  const replace = new Map<number, AlignRecord[]>();
  const verses: string[] = [];
  let repaired = 0;
  let dropped = 0;
  for (const [verse, idx] of byVerse) {
    const bad = idx.filter((i) => !matches(records[i]));
    if (bad.length < 3 || bad.length < 0.3 * idx.length) continue;
    const S = [...new Set(idx.flatMap((i) => records[i][0]))];
    const T = [...new Set(idx.flatMap((i) => records[i][1]))].filter((t) => engOf(t));
    // Source words fitting a content word of their own record (before) / of the re-pairing (after).
    const contentFit = (sid: string, t: string) => {
      const e = engOf(t);
      return !!e && !FUNCTION_WORDS.has(e) && fit(sid, e) >= 0.3;
    };
    let before = 0;
    for (const i of idx) for (const sid of records[i][0]) if (records[i][1].some((t) => contentFit(sid, t))) before++;
    const pairs: { sid: string; t: string; score: number }[] = [];
    for (const sid of S) for (const t of T) {
      const score = fit(sid, engOf(t));
      if (score >= FIT_MIN) pairs.push({ sid, t, score });
    }
    pairs.sort((a, b) => b.score - a.score || a.t.localeCompare(b.t) || a.sid.localeCompare(b.sid));
    const takenT = new Set<string>();
    const got = new Map<string, string[]>();
    for (const { sid, t } of pairs) {
      if (takenT.has(t)) continue;
      const mine = got.get(sid);
      if (mine && !mine.some((x) => Math.abs(Number(x.slice(8)) - Number(t.slice(8))) === 1)) continue;
      takenT.add(t);
      got.set(sid, [...(mine ?? []), t]);
    }
    const after = [...got].filter(([sid, ts]) => ts.some((t) => contentFit(sid, t))).length;
    if (after - before < 3 || after < 1.5 * before) continue;
    verses.push(verse);
    const out: AlignRecord[] = [];
    for (const [sid, ts] of got) out.push([[sid], ts.sort(), true]);
    out.sort((a, b) => a[0][0].localeCompare(b[0][0]));
    repaired += out.length;
    dropped += T.length - takenT.size;
    idx.forEach((i, k) => replace.set(i, k === 0 ? out : []));
  }
  const out: AlignRecord[] = [];
  records.forEach((r, i) => {
    const rep = replace.get(i);
    if (rep) out.push(...rep);
    else out.push(r);
  });
  return { records: out, verses, repaired, dropped };
}

/**
 * Source verses the BSB merges into a neighbouring verse but every other bundled translation (KJV,
 * WEB, ASV, YLT; NIV) keeps as a verse of the next chapter: SBLGNT Rev 12:18 "and he stood on the
 * sand of the sea" is BSB Rev 12:17 but Rev 13:1 elsewhere. Its words are laid out in that chapter
 * (the BSB, whose words cannot link across chapters, leaves them unlinked).
 */
export const SOURCE_VERSE_OVERRIDES: Readonly<Record<string, string>> = { '66012018': '66013001' };

/**
 * English verses that the BSB omits (it footnotes them) but the other bundled translations have, and
 * whose source words exist: SBLGNT Rom 16:24. Their words stay in that verse instead of joining the
 * previous one.
 */
export const EXTRA_ENGLISH_VERSES: readonly string[] = ['45016024'];

/** Read the source ids of a testament (cheap) and lay them out. */
export function computeOrigLayout(t: Testament): OrigLayout {
  const rows =
    t === 'NT'
      ? readTsvColumns('SBLGNT.tsv', ['id', 'gloss', 'gloss2', 'strongs'] as const)
      : readTsvColumns('WLCM.tsv', ['id', 'gloss', 'gloss2', 'strongs'] as const);
  const gloss = new Map<string, string>();
  const strongs = new Map<string, string>();
  for (const r of rows) {
    if (!r.id) continue;
    gloss.set(r.id, `${r.gloss} ${r.gloss2}`);
    strongs.set(r.id, baseStrongs(normStrongs(t === 'NT' ? 'G' : 'H', r.strongs.split('|')[0] ?? '')));
  }
  // Source order = id order (WLCM.tsv lists ~800 words out of order, e.g. Gen 1:4 כִּי before אֶת,
  // which split written words: Josh 6:24 וְ … הָעִיר).
  const ids = sortedIds(rows.map((r) => r.id).filter(Boolean));
  const bsb = readBsbTokens(t);
  const text = new Map(bsb.map((tk) => [tk.id, tk.exclude ? '' : tk.text]));
  const raw = readAlignment(t);
  const pruned = pruneSuspectRecords(raw, (s) => gloss.get(s) ?? '', (id) => text.get(id) ?? '', recordContext(raw, bsb));
  const shift = repairShiftedRecords(pruned.records, {
    glossOf: (s) => gloss.get(s) ?? '',
    strongsOf: (s) => strongs.get(s) ?? '',
    englishOf: (id) => text.get(id) ?? '',
  });
  const layout = layoutWords(ids, shift.records, bsb, t === 'NT' ? EXTRA_ENGLISH_VERSES : [], SOURCE_VERSE_OVERRIDES);
  return { ...layout, records: shift.records, bsb, prunedLinks: pruned.removed, shifted: shift };
}

/** Source ids in canonical order (fixed-width ids: lexical order = book, chapter, verse, word, morpheme). */
export const sortedIds = (ids: readonly string[]): string[] => [...ids].sort();

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

const CHI_XI: Record<string, string> = { χ: 'ξ', ξ: 'χ', Χ: 'Ξ', Ξ: 'Χ' };

/**
 * Macula Hebrew's `greek` column has χ and ξ swapped throughout (δόχα, ἐχ, ψυξή, ξεῖρας, ἀρξῇ: the
 * correct forms never occur, and ~10,400 of its χ/ξ forms are attested in the SBLGNT only once
 * swapped), so the two letters are swapped back unconditionally.
 */
export const unswapChiXi = (s: string): string => s.replace(/[χξΧΞ]/g, (c) => CHI_XI[c]);

/** Every letter Greek (plus combining marks / apostrophe), with at least one vowel. */
const GREEK_WORD = /^[\p{Script=Greek}\u0300-\u036f’]+$/u;
const GREEK_VOWEL = /[αεηιουωΑΕΗΙΟΥΩ]/u;
/** One-off CATSS spellings that no rule repairs. */
const LXX_SPELLING: Record<string, string> = { λεvῖται: 'λευῖται', 'αἰγψ/πτου': 'αἰγύπτου', '+ραυς+ῇ': '' };

/**
 * Clean one Septuagint form from Macula (which keeps CATSS apparatus): NFC; quotes, braces and the
 * CATSS sigla dropped ("{..^βαβυλῶνος}" -> βαβυλῶνος, bare "{δ}" -> ""), stray ")", "+", "=", "/",
 * "^" and trailing punctuation removed, hyphenated name parts split, Latin look-alikes inside a
 * Greek word mapped to Greek (ναβουξοδοvοσορ). Words that are still not Greek are dropped. The
 * result is NOT yet χ/ξ-corrected (see unswapChiXi).
 */
export function cleanLxxForm(raw: string): string {
  let s = raw.normalize('NFC');
  if (LXX_SPELLING[s] !== undefined) s = LXX_SPELLING[s];
  s = s
    .replace(/\{[δτ%+]?\}/gu, ' ') // bare sigla: {δ} {τ} {%} {+}
    .replace(/\.\.\.|\.\.\^|\.\.[δπ](?=\p{L})|\.\./gu, ' ') // CATSS prefixes
    .replace(/[‐‑–—-]/g, ' ')
    .replace(/[/\\]/g, '') // syllable / letter breaks inside a word: τῆ/ς
    .replace(/["{}\[\]^)(+=~%,.;:·\u0387\u037e]/g, ' ');
  const words = s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/\p{Script=Greek}/u.test(w) ? w.replace(/v/g, 'ν').replace(/o/g, 'ο').normalize('NFC') : w))
    .filter((w) => GREEK_WORD.test(w) && GREEK_VOWEL.test(w.normalize('NFD')) && !/ς\p{L}/u.test(w));
  return words.join(' ');
}

/**
 * Normalise an LXX equivalent from Macula: "greek|G####", or "" when there is none. Forms are
 * cleaned (cleanLxxForm), NFC and χ/ξ-corrected (unswapChiXi); `fixStrongs` may replace a Strong's
 * number that belongs to a different word (Macula pairs πρωί with G5459 φωσφόρος).
 */
export function lxxOf(greek: string, greekStrong: string, fixStrongs?: (form: string, strongs: string) => string): string {
  const forms = greek
    .split('|')
    .map((f) => unswapChiXi(cleanLxxForm(f)))
    .filter(Boolean);
  if (!forms.length) return '';
  let strong = greekStrong.split('|').map((x) => normStrongs('G', x)).find(Boolean) ?? '';
  if (fixStrongs && strong && forms.length === 1) strong = fixStrongs(forms[0], strong);
  return `${forms.join(' ')}|${strong}`;
}

/** Common substring of length >= n (Greek folded). */
function shareRun(a: string, b: string, n: number): boolean {
  if (a.length < n || b.length < n) return false;
  for (let i = 0; i + n <= a.length; i++) if (b.includes(a.slice(i, i + n))) return true;
  return false;
}

/** True when a Greek form plausibly belongs to a lemma (folded: a shared run of 3 letters, or 2 for short words). */
export function formFitsLemma(form: string, lemma: string): boolean {
  const f = greekFold(form);
  const l = greekFold(lemma);
  if (!f || !l) return true;
  const n = Math.min(3, f.length, l.length);
  return n < 2 ? f[0] === l[0] : shareRun(f, l, n);
}

/**
 * A Strong's corrector for LXX pairs. A number is kept when the SBLGNT uses it for the very same form
 * (articles, pronouns and suppletive forms included), or when the form fits its lemma. Otherwise it is
 * replaced by the classic id whose lemma is exactly the form (indeclinables: τεσσαράκοντα G1540 ->
 * G5062, πρωί G5459 -> G4404) or the number the SBLGNT mostly uses for the form, when that one fits.
 * Suppletive pairs that fit nothing (ὄψεται / G3700) are kept.
 */
export function lxxStrongsFixer(
  lemmaOf: (id: string) => string | undefined,
  byLemma: ReadonlyMap<string, string>,
  sblgnt: ReadonlyMap<string, ReadonlyMap<string, number>>,
): (form: string, strongs: string) => string {
  const classic = (id: string | undefined): id is string => !!id && /^G\d{4}$/.test(id) && Number(id.slice(1)) <= 5624;
  return (form, strongs) => {
    const key = greekFold(form);
    const seen = sblgnt.get(key);
    if (seen?.has(strongs)) return strongs;
    const lemma = lemmaOf(strongs);
    if (!lemma || formFitsLemma(form, lemma)) return strongs;
    const usual = seen ? [...seen].sort((a, b) => b[1] - a[1])[0][0] : undefined;
    for (const alt of [byLemma.get(key), usual]) {
      if (classic(alt) && alt !== strongs && formFitsLemma(form, lemmaOf(alt) ?? '')) return alt;
    }
    return strongs;
  };
}

/* ------------------------------------------------------------------------ */
/* Build                                                                     */
/* ------------------------------------------------------------------------ */

/** "G0000" / "H0000" are placeholders for words without a Strong's number. */
const realStrongs = (id: string) => (/^[GH]0000$/.test(id) ? '' : id);

/** Word data independent of English versification (verse/ref/group filled in later). */
type BaseWord = { text: string; strongs: string; lemma: string; morph: string; gloss: string; translit: string; lxx: string; aramaic: boolean };

/**
 * The SBLGNT word list's gloss2 column (the BSB's wording, used first) sometimes swaps the glosses of
 * two neighbouring words (Rev 13:1 κεφαλὰς "seven", ἑπτά "heads"). Returns the indices (into `rows`)
 * of words whose gloss2 is the other one's gloss and vice versa (within 2 words, same verse).
 */
export function swappedGloss2(rows: readonly { id: string; gloss: string; gloss2: string }[]): Set<number> {
  const out = new Set<number>();
  const f = (x: string) => cleanGloss(x).toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j <= i + 2 && j < rows.length; j++) {
      if (rows[j].id.slice(0, 9) !== rows[i].id.slice(0, 9)) break;
      const [gi, gj, hi, hj] = [f(rows[i].gloss), f(rows[j].gloss), f(rows[i].gloss2), f(rows[j].gloss2)];
      if (gi && gj && gi !== gj && hi === gj && hj === gi) {
        out.add(i);
        out.add(j);
      }
    }
  }
  return out;
}

/** STEP's extra Greek ids (G6000+) by folded lemma, for SBLGNT words numbered G0000 (ἄμωμον, Ἀρνί). */
function extendedGreekIds(): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of parseStepLexicon(readFileSync(srcPath('TBESG.txt'), 'utf8'), 'G')) {
    if (Number(r.eid.slice(1)) <= 5624 || !/^G\d{4}$/.test(r.eid)) continue;
    const k = greekFold(r.lemma);
    if (k && !out.has(k)) out.set(k, r.eid);
  }
  return out;
}

function greekWords(): Map<string, BaseWord> {
  const rows = readTsvColumns('SBLGNT.tsv', ['id', 'text', 'strongs', 'gloss', 'gloss2', 'lemma', 'morph'] as const).filter((r) => r.id);
  const out = new Map<string, BaseWord>();
  const swapped = swappedGloss2(rows);
  const extended = extendedGreekIds();
  let placeholders = 0;
  rows.forEach((r, i) => {
    const lemma = r.lemma.normalize('NFC');
    let strongs = realStrongs(normStrongs('G', r.strongs));
    if (!strongs && /^G?0+$/.test(r.strongs.trim())) {
      strongs = extended.get(greekFold(lemma)) ?? '';
      if (strongs) placeholders++;
    }
    out.set(r.id, {
      text: r.text.normalize('NFC'),
      strongs,
      lemma,
      morph: r.morph,
      gloss: swapped.has(i) ? firstGloss(strongs, r.gloss, r.gloss2) : firstGloss(strongs, r.gloss2, r.gloss),
      translit: '',
      lxx: '',
      aramaic: false,
    });
  });
  log('orig', `Greek: ${out.size} words; ${swapped.size} swapped BSB-order glosses replaced; ${placeholders} G0000 words given STEP's extended id`);
  return out;
}

/** Lemma of a Greek Strong's id and the reverse indexes the LXX Strong's fixer needs (TBESG + SBLGNT). */
function lxxFixer(): (form: string, strongs: string) => string {
  const lemma = new Map<string, string>();
  const byLemma = new Map<string, string>();
  for (const r of parseStepLexicon(readFileSync(srcPath('TBESG.txt'), 'utf8'), 'G')) {
    if (!lemma.has(r.eid)) lemma.set(r.eid, r.lemma);
    const k = greekFold(r.lemma);
    if (k && !byLemma.has(k)) byLemma.set(k, r.eid);
  }
  const forms = new Map<string, Map<string, number>>();
  for (const r of readTsvColumns('SBLGNT.tsv', ['text', 'strongs'] as const)) {
    const id = baseStrongsOf(normStrongs('G', r.strongs));
    if (!id) continue;
    const k = greekFold(r.text);
    let m = forms.get(k);
    if (!m) forms.set(k, (m = new Map()));
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return lxxStrongsFixer((id) => lemma.get(id) ?? lemma.get(`${id}a`), byLemma, forms);
}

const baseStrongsOf = (id: string) => (id ? baseStrongs(id) : '');

function hebrewWords(): Map<string, BaseWord> {
  type MaculaCol = 'xml:id' | 'transliteration' | 'strongnumberx' | 'greek' | 'greekstrong' | 'gloss' | 'english' | 'morph' | 'lang' | 'lemma';
  const cols: MaculaCol[] = ['xml:id', 'transliteration', 'strongnumberx', 'greek', 'greekstrong', 'gloss', 'english', 'morph', 'lang', 'lemma'];
  const macula = new Map<string, Record<MaculaCol, string>>();
  for (const r of readTsvColumns('macula-hebrew.tsv', cols)) macula.set(r['xml:id'], r);
  const { remap } = loadHomonyms();
  const fixStrongs = lxxFixer();

  // Id order: WLCM.tsv lists some morphemes out of order (see computeOrigLayout).
  const rows = readTsvColumns('WLCM.tsv', ['id', 'text', 'strongs', 'gloss', 'gloss2'] as const)
    .filter((r) => r.id)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = new Map<string, BaseWord>();
  let generated = 0;
  let remapped = 0;
  let lxxStrongsFixed = 0;
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
      let strongs = realStrongs(normStrongs('H', (m.strongnumberx || r.strongs).split('|')[0]));
      // Macula's letter for a homonym is not always STEP's (Macula H8227a Shaphan = STEP H8227b).
      const step = remap.get(strongs);
      if (step) {
        strongs = step;
        remapped++;
      }
      let translit = supplied[k];
      if (!translit) {
        translit = fallback[k];
        generated++;
      }
      const lxx = lxxOf(m.greek, m.greekstrong, (form, st) => {
        const fixed = fixStrongs(form, st);
        if (fixed !== st) lxxStrongsFixed++;
        return fixed;
      });
      out.set(r.id, {
        text: r.text,
        strongs,
        lemma: m.lemma,
        morph: m.morph,
        gloss: firstGloss(strongs, r.gloss, m.english, m.gloss, r.gloss2),
        translit,
        lxx,
        aramaic: m.lang === 'A',
      });
    });
    i = j;
  }
  log(
    'orig',
    `Hebrew: ${out.size} morphemes; generated transliteration for ${generated} that Macula leaves blank; ` +
      `${remapped} homonym ids re-lettered to STEP's (${remap.size} ids); ${lxxStrongsFixed} Septuagint Strong's numbers corrected`,
  );
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
