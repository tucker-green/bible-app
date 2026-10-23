/**
 * Helpers shared by every data-pipeline stage. Stages read raw files from
 * .cache/sources/ (see scripts/fetch-sources.mjs) and write public/data/.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BOOKS, getBookByNum } from '../../src/lib/books';
import type { BookInfo } from '../../src/lib/books';

export const ROOT = process.cwd();
export const SRC_DIR = join(ROOT, '.cache', 'sources');
/** Output directory: public/data/, or $RW_DATA_OUT (build into a scratch copy without disturbing a running app). */
export const OUT_DIR = process.env.RW_DATA_OUT ? resolve(process.env.RW_DATA_OUT) : join(ROOT, 'public', 'data');

export function srcPath(name: string): string {
  const p = join(SRC_DIR, name);
  if (!existsSync(p)) throw new Error(`Missing source ${name}; run \`npm run data:fetch\` first.`);
  return p;
}

export function outPath(...parts: (string | number)[]): string {
  return join(OUT_DIR, ...parts.map(String));
}

/** Write minified JSON, creating parent directories. Returns bytes written. */
export function writeJson(path: string, data: unknown): number {
  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(data);
  writeFileSync(path, text);
  return text.length;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Remove a generated output directory before regenerating it. */
export function cleanOut(...parts: string[]): void {
  rmSync(outPath(...parts), { recursive: true, force: true });
}

/**
 * Parse a TSV file with a header row into objects. Fields are raw strings.
 * Lines starting with '#' and blank lines are skipped.
 */
export function readTsv(name: string): Record<string, string>[] {
  const text = readFileSync(srcPath(name), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const header = lines[0].split('\t');
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('#')) continue;
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = cells[j] ?? '';
    rows.push(row);
  }
  return rows;
}

/** Book number (1-66, as used in Clear/Macula BCV ids) -> BookInfo. */
export function bookByNum(num: number): BookInfo {
  const b = getBookByNum(num);
  if (!b) throw new Error(`Unknown book number ${num}`);
  return b;
}

export { BOOKS };

/** Parse a BBCCCVVV verse id (8 digits) into numbers. */
export function parseBcv(id: string): { book: number; chapter: number; verse: number } {
  return {
    book: Number(id.slice(0, 2)),
    chapter: Number(id.slice(2, 5)),
    verse: Number(id.slice(5, 8)),
  };
}

/**
 * Normalise a Strong's number to the app's canonical form:
 *   ("G", "25") -> "G0025";  ("H", "0871a") -> "H0871a";  "G3588" -> "G3588";  "H7225G" -> "H7225G".
 * Returns "" for empty / non-numeric input.
 */
export function normStrongs(prefix: 'G' | 'H', raw: string): string {
  const m = /^[GH]?0*(\d+)([A-Za-z]?)$/.exec(raw.trim());
  if (!m) return '';
  return `${prefix}${m[1].padStart(4, '0')}${m[2]}`;
}

/** Base Strong's id without extension letter: "H0871a" -> "H0871". */
export function baseStrongs(id: string): string {
  return id.replace(/^([GH]\d{4}).*$/, '$1');
}

/** Lexicon / concordance chunk index for a Strong's id: "G0026" -> "000", "H7225" -> "072". */
export function chunkOf(id: string): string {
  const n = Number(id.slice(1, 5));
  return String(Math.floor(n / 100)).padStart(3, '0');
}

export function log(stage: string, msg: string): void {
  console.log(`[${stage}] ${msg}`);
}

/* ------------------------------------------------------------------------ */
/* Lighter readers for very large / wide sources                             */
/* ------------------------------------------------------------------------ */

/**
 * Read only the named columns of a header-row TSV, in file order. Much lighter than
 * `readTsv` for wide files such as macula-hebrew.tsv (32 columns, 84 MB).
 * Throws if a requested column is missing from the header.
 */
export function readTsvColumns<K extends string>(name: string, cols: readonly K[]): Record<K, string>[] {
  const text = readFileSync(srcPath(name), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const header = lines[0].split('\t');
  const idx = cols.map((c) => {
    const i = header.indexOf(c);
    if (i < 0) throw new Error(`${name}: missing column "${c}" (have ${header.join(', ')})`);
    return i;
  });
  const rows: Record<K, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('#')) continue;
    const cells = line.split('\t');
    const row = {} as Record<K, string>;
    for (let j = 0; j < cols.length; j++) row[cols[j]] = cells[idx[j]] ?? '';
    rows.push(row);
  }
  return rows;
}

export type Testament = 'OT' | 'NT';

/** One English token of the BSB from the Clear-Bible target TSVs (nt_BSB.tsv / ot_BSB.tsv). */
export interface BsbTokenRow {
  /** BBCCCVVVWWW (11 digits). English verse = first 8 chars; Psalm titles use verse 000. */
  id: string;
  /** BBCCCVVV of the source-language verse this token translates (Hebrew/Greek numbering). */
  srcVerse: string;
  text: string;
  /** True when the source says no space follows this token. */
  skip: boolean;
  /** True for punctuation / tokens that are never aligned. */
  exclude: boolean;
}

export function readBsbTokens(t: Testament): BsbTokenRow[] {
  const file = t === 'NT' ? 'nt_BSB.tsv' : 'ot_BSB.tsv';
  return readTsvColumns(file, ['id', 'source_verse', 'text', 'skip_space_after', 'exclude'] as const)
    .filter((r) => r.id)
    .map((r) => ({
      id: r.id,
      srcVerse: r.source_verse,
      text: r.text,
      skip: r.skip_space_after === 'y',
      exclude: r.exclude === 'y',
    }));
}

/** One manual alignment record: source ids (n…/o… BCVW[P]) <-> BSB target ids (BBCCCVVVWWW). Many-to-many. */
export type AlignRecord = [source: string[], target: string[]];

export function readAlignment(t: Testament): AlignRecord[] {
  const file = t === 'NT' ? 'SBLGNT-BSB-manual.json' : 'WLCM-BSB-manual.json';
  const json = JSON.parse(readFileSync(srcPath(file), 'utf8')) as {
    records: { source: string[]; target: string[] }[];
  };
  return json.records.map((r) => [r.source, r.target]);
}

/** "BBCCC" chapter key for a book number and chapter, as used in Clear/Macula ids. */
export function chapterKey(bookNum: number, chapter: number): string {
  return String(bookNum).padStart(2, '0') + String(chapter).padStart(3, '0');
}

/** Every (book, chapter) of the canon in order, with its "BBCCC" key. */
export function allChapters(): { book: BookInfo; chapter: number; key: string }[] {
  const out: { book: BookInfo; chapter: number; key: string }[] = [];
  for (const book of BOOKS) {
    for (let c = 1; c <= book.chapters; c++) out.push({ book, chapter: c, key: chapterKey(book.num, c) });
  }
  return out;
}
