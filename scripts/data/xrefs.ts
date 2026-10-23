/**
 * Stage "xrefs": OpenBible.info cross references -> public/data/xref/{BOOK}/{CHAPTER}.json (XrefChapter).
 *
 * Source: .cache/sources/openbible-cross-references.txt (OpenBible.info, CC BY; "From Verse\tTo Verse\tVotes",
 * OSIS-style refs such as "Gen.1.1", "Prov.8.22-Prov.8.30", "1Chr.16.26"; ranges may cross chapters and
 * even books, e.g. "2Chr.36.22-Ezra.1.3"). Votes are community relevance votes and may be zero or negative.
 *
 * Rules:
 *  - every OSIS book abbreviation must map to a USFM id (unknown ones throw);
 *  - pairs with votes <= 0 are dropped;
 *  - self-references are dropped: a target equal to the source verse, or a range that contains it
 *    (e.g. Lev 3:6 -> Lev 3:1–17), since the reader is already looking at that passage;
 *  - refs are mapped to English (BSB) versification: OpenBible follows the ESV, whose 3 John 1:15 is the
 *    second half of 3 John 1:14 in the BSB/KJV. Any other ref past the end of its chapter is dropped
 *    (range ends are clamped to the chapter's last verse) and reported;
 *  - duplicate (source, target) pairs keep the highest vote;
 *  - each verse's targets are sorted by votes desc, then canonical order, and capped at XREF_CAP.
 *
 * Every one of the 1189 chapters gets a file (verses = {} when it has no cross references).
 */
import { existsSync, readFileSync } from 'node:fs';
import type { BookId, TextChapter, XrefChapter, XrefTarget } from '../../src/lib/types';
import { packRef, unpackRef } from '../../src/lib/types';
import { compareXrefTargets } from '../../src/lib/xrefs';
import { BOOKS, cleanOut, log, outPath, readJson, srcPath, writeJson } from './common';

export const XREF_SOURCE = 'openbible-cross-references.txt';

/** Maximum targets kept per source verse. */
export const XREF_CAP = 40;

/** OSIS book abbreviation (as used by OpenBible.info) -> USFM id, in canonical order. */
export const OSIS_TO_USFM: Readonly<Record<string, BookId>> = {
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

const BOOK_NUM = new Map(BOOKS.map((b) => [b.id, b.num]));

/** OSIS abbreviation -> canonical book number (1–66). */
const OSIS_NUM = new Map<string, number>(
  Object.entries(OSIS_TO_USFM).map(([osis, id]) => {
    const num = BOOK_NUM.get(id);
    if (!num) throw new Error(`xrefs: OSIS_TO_USFM maps ${osis} to unknown book ${id}`);
    return [osis, num];
  }),
);

/**
 * Versification differences between OpenBible.info (ESV numbering) and our English (BSB) numbering,
 * as packed refs. ESV 3 John 1:15 ("Peace be to you...") is part of 3 John 1:14 in the BSB and KJV.
 */
export const VERSIFICATION_REMAP: ReadonlyMap<number, number> = new Map([[packRef(64, 1, 15), packRef(64, 1, 14)]]);

/** "Gen.1.1" -> packed ref (bookNum * 1e6 + chapter * 1e3 + verse). Throws on unknown books or malformed refs. */
export function parseOsisVerse(ref: string): number {
  const m = /^([1-3]?[A-Za-z]+)\.(\d{1,3})\.(\d{1,3})$/.exec(ref.trim());
  if (!m) throw new Error(`xrefs: malformed OSIS verse "${ref}"`);
  const num = OSIS_NUM.get(m[1]);
  if (!num) throw new Error(`xrefs: unknown OSIS book abbreviation "${m[1]}" in "${ref}"`);
  const chapter = Number(m[2]);
  const verse = Number(m[3]);
  if (chapter < 1 || verse < 1) throw new Error(`xrefs: impossible chapter/verse in "${ref}"`);
  return packRef(num, chapter, verse);
}

/** One line of the source file, parsed (refs packed; `end` = 0 for a single-verse target). */
export interface RawXref {
  from: number;
  start: number;
  end: number;
  votes: number;
}

/**
 * Parse one source line. Returns null for the header, comments and blank lines; throws on anything
 * malformed (wrong column count, unknown book, non-numeric votes, a range whose end precedes its start).
 */
export function parseXrefLine(line: string): RawXref | null {
  const text = line.replace(/\r$/, '');
  if (!text.trim() || text.startsWith('#') || text.startsWith('From Verse')) return null;
  const cols = text.split('\t');
  if (cols.length < 3) throw new Error(`xrefs: expected 3 tab-separated columns: "${text}"`);
  const [fromText, toText, votesText] = cols;
  if (fromText.includes('-')) throw new Error(`xrefs: source verse must be a single verse: "${text}"`);
  if (!/^-?\d+$/.test(votesText.trim())) throw new Error(`xrefs: bad vote count: "${text}"`);
  const from = parseOsisVerse(fromText);
  const [a, b, ...extra] = toText.split('-');
  if (extra.length) throw new Error(`xrefs: malformed range: "${text}"`);
  const start = parseOsisVerse(a);
  let end = b === undefined ? 0 : parseOsisVerse(b);
  if (end && end < start) throw new Error(`xrefs: range ends before it starts: "${text}"`);
  if (end === start) end = 0;
  return { from, start, end, votes: Number(votesText) };
}

/** Number of verses in a chapter by book number (English versification), undefined if no such chapter. */
export type VerseCountFn = (bookNum: number, chapter: number) => number | undefined;

export interface XrefStats {
  /** Lines read from the source (excluding the header). */
  lines: number;
  /** Pairs written to the output. */
  kept: number;
  /** Source verses with at least one target. */
  verses: number;
  maxPerVerse: number;
  droppedVotes: number;
  droppedSelf: number;
  droppedDuplicate: number;
  droppedCap: number;
  /** Refs that are past the end of their chapter (after versification remapping): [source text, count]. */
  outOfRange: [string, number][];
  remapped: number;
  clampedEnds: number;
}

const showRef = (p: number): string => {
  const { bookNum, chapter, verse } = unpackRef(p);
  return `${BOOKS[bookNum - 1]?.id ?? bookNum} ${chapter}:${verse}`;
};

/**
 * Turn parsed source rows into per-verse target lists, keyed by source packRef.
 * Applies every rule in the module comment. `verseCount` validates refs against English versification.
 */
export function collectXrefs(
  rows: Iterable<RawXref>,
  verseCount: VerseCountFn,
  cap = XREF_CAP,
): { byVerse: Map<number, XrefTarget[]>; stats: XrefStats } {
  const stats: XrefStats = {
    lines: 0, kept: 0, verses: 0, maxPerVerse: 0, droppedVotes: 0, droppedSelf: 0, droppedDuplicate: 0,
    droppedCap: 0, outOfRange: [], remapped: 0, clampedEnds: 0,
  };
  const outOfRange = new Map<string, number>();
  const noteOut = (p: number) => outOfRange.set(showRef(p), (outOfRange.get(showRef(p)) ?? 0) + 1);

  /** Remap to English versification; returns 0 when the verse does not exist there. */
  const fix = (p: number): number => {
    const mapped = VERSIFICATION_REMAP.get(p);
    if (mapped !== undefined) {
      stats.remapped++;
      p = mapped;
    }
    const { bookNum, chapter, verse } = unpackRef(p);
    const n = verseCount(bookNum, chapter);
    return n !== undefined && verse <= n ? p : 0;
  };

  // source -> "start:end" -> target (dedupe keeps the highest vote)
  const acc = new Map<number, Map<string, XrefTarget>>();
  for (const row of rows) {
    stats.lines++;
    if (row.votes <= 0) {
      stats.droppedVotes++;
      continue;
    }
    const from = fix(row.from);
    const start = fix(row.start);
    if (!from || !start) {
      noteOut(from ? row.start : row.from);
      continue;
    }
    let end = 0;
    if (row.end) {
      end = fix(row.end);
      if (!end) {
        // Range end past its chapter: clamp to the chapter's last verse.
        const { bookNum, chapter } = unpackRef(row.end);
        const last = verseCount(bookNum, chapter);
        if (!last) {
          noteOut(row.end);
          continue;
        }
        end = packRef(bookNum, chapter, last);
        stats.clampedEnds++;
      }
      if (end <= start) end = 0;
    }
    if (start <= from && from <= (end || start)) {
      stats.droppedSelf++;
      continue;
    }
    let targets = acc.get(from);
    if (!targets) acc.set(from, (targets = new Map()));
    const key = `${start}:${end}`;
    const prev = targets.get(key);
    if (prev) {
      stats.droppedDuplicate++;
      if (row.votes > prev[2]) prev[2] = row.votes;
      continue;
    }
    targets.set(key, [start, end, row.votes]);
  }

  const byVerse = new Map<number, XrefTarget[]>();
  for (const from of [...acc.keys()].sort((a, b) => a - b)) {
    const all = [...acc.get(from)!.values()].sort(compareXrefTargets);
    const kept = all.slice(0, cap);
    stats.droppedCap += all.length - kept.length;
    stats.kept += kept.length;
    stats.maxPerVerse = Math.max(stats.maxPerVerse, kept.length);
    byVerse.set(from, kept);
  }
  stats.verses = byVerse.size;
  stats.outOfRange = [...outOfRange.entries()];
  return { byVerse, stats };
}

/** Group per-verse targets into one XrefChapter per chapter of the canon (all 1189, empty ones included). */
export function toChapters(byVerse: Map<number, XrefTarget[]>): XrefChapter[] {
  const index = new Map<string, XrefChapter>();
  const chapters: XrefChapter[] = [];
  for (const b of BOOKS) {
    for (let c = 1; c <= b.chapters; c++) {
      const ch: XrefChapter = { book: b.id, chapter: c, verses: {} };
      index.set(`${b.num}:${c}`, ch);
      chapters.push(ch);
    }
  }
  for (const [from, targets] of byVerse) {
    const { bookNum, chapter, verse } = unpackRef(from);
    const ch = index.get(`${bookNum}:${chapter}`);
    if (!ch) throw new Error(`xrefs: no such chapter for ${showRef(from)}`);
    ch.verses[String(verse)] = targets;
  }
  return chapters;
}

/**
 * English verse counts (highest verse number per chapter) from the BSB text written by the bsb stage,
 * the same rule meta.json uses; falls back to an existing meta.json.
 */
export function englishVerseCounts(): VerseCountFn {
  const counts = new Map<string, number>();
  const hasBsb = existsSync(outPath('text', 'BSB', 'GEN', '1.json'));
  if (hasBsb) {
    for (const b of BOOKS) {
      for (let c = 1; c <= b.chapters; c++) {
        const ch = readJson<TextChapter>(outPath('text', 'BSB', b.id, `${c}.json`));
        counts.set(`${b.num}:${c}`, ch.verses.reduce((m, v) => Math.max(m, v.v), 0));
      }
    }
  } else if (existsSync(outPath('meta.json'))) {
    const meta = readJson<{ books: { num: number; verses: number[] }[] }>(outPath('meta.json'));
    for (const b of meta.books) b.verses.forEach((n, i) => counts.set(`${b.num}:${i + 1}`, n));
  } else {
    throw new Error('xrefs: need public/data/text/BSB (run the bsb stage first) for English verse counts.');
  }
  return (bookNum, chapter) => counts.get(`${bookNum}:${chapter}`);
}

export function buildXrefs(): XrefStats {
  const text = readFileSync(srcPath(XREF_SOURCE), 'utf8').replace(/^﻿/, '');
  const lines = text.split('\n');
  if (!lines[0].startsWith('From Verse\tTo Verse\tVotes')) {
    throw new Error(`xrefs: unexpected header in ${XREF_SOURCE}: "${lines[0].slice(0, 60)}"`);
  }
  const rows: RawXref[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseXrefLine(lines[i]);
    if (row) rows.push(row);
  }

  const { byVerse, stats } = collectXrefs(rows, englishVerseCounts());
  const chapters = toChapters(byVerse);

  cleanOut('xref');
  let bytes = 0;
  for (const ch of chapters) bytes += writeJson(outPath('xref', ch.book, `${ch.chapter}.json`), ch);

  if (stats.outOfRange.length) {
    const list = stats.outOfRange.map(([r, n]) => `${r}×${n}`).join(', ');
    log('xrefs', `WARNING: dropped refs outside English versification: ${list}`);
  }
  log(
    'xrefs',
    `${stats.kept} pairs from ${stats.lines} lines into ${chapters.length} chapters; ${stats.verses} verses ` +
      `(avg ${(stats.kept / Math.max(1, stats.verses)).toFixed(1)}, max ${stats.maxPerVerse}); dropped ` +
      `${stats.droppedVotes} with votes <= 0, ${stats.droppedSelf} self, ${stats.droppedDuplicate} duplicate, ` +
      `${stats.droppedCap} over cap ${XREF_CAP}; remapped ${stats.remapped}, clamped ${stats.clampedEnds}; ` +
      `${(bytes / 1024 / 1024).toFixed(2)} MB`,
  );
  return stats;
}
