/**
 * Helpers shared by every data-pipeline stage. Stages read raw files from
 * .cache/sources/ (see scripts/fetch-sources.mjs) and write public/data/.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BOOKS, getBookByNum } from '../../src/lib/books';
import type { BookInfo } from '../../src/lib/books';

export const ROOT = process.cwd();
export const SRC_DIR = join(ROOT, '.cache', 'sources');
export const OUT_DIR = join(ROOT, 'public', 'data');

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
