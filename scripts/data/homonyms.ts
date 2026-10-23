/**
 * Hebrew homonyms: which STEPBible lexicon entry an OT word's Strong's id really means.
 *
 * Macula Hebrew (the source of every OT word) and STEPBible's TBESH both split homonymous Strong's
 * numbers with letters, but not in the same way: Macula tags "house" with the plain H1004 while
 * STEP has H1004a "place" and H1004b "house"; Macula's H8227a is the scribe Shaphan, STEP's H8227a is
 * the rock badger and its H8227b Shaphan; Macula's plain H5035 is the skin bottle (STEP H5035a), its
 * H5035a the harp (STEP H5035b). Matching by letter or list order shows the wrong definition for
 * some of the most frequent OT nouns (house, city, garment, wilderness).
 *
 * `resolveHomonyms` decides, from how Macula actually uses each id (its English glosses, whether it
 * is a proper noun, and where it occurs), which STEP entry of the same number fits best:
 *  - a lettered Macula id whose own STEP entry shares (almost) no word with that usage while a sibling
 *    does is mapped to the sibling (the orig stage rewrites OrigWord.strongs, so the lexicon,
 *    concordance, word study and people cards all agree);
 *  - a plain Macula id with only lettered STEP entries gets the best-fitting one as its lexicon alias
 *    (the lexicon stage's base-id alias).
 * Prefix / suffix morpheme ids (H2050b "and", H3641b "you") are never touched.
 */
import { readFileSync } from 'node:fs';
import { baseStrongs, normStrongs, readTsvColumns, srcPath } from './common';
import { loadMorphemeIds, parseStepLexicon, pickPrimary, STEP_BOOKS, type StepRow } from './lexicon';

/** How Macula uses one id. */
export interface HomonymUsage {
  /** Occurrences. */
  count: number;
  /** Content words of the English glosses (stemmed) -> weight. */
  words: Map<string, number>;
  /** Occurrences tagged as a proper noun (morph "Np"). */
  proper: number;
  /** Verses ("GEN 2:8") where the id occurs. */
  verses: Set<string>;
}

/** What a STEP entry (eStrong id) says. */
export interface HomonymVariant {
  id: string;
  /** Content words (stemmed) of its glosses and the start of its definition. */
  words: Set<string>;
  /** A name (STEP morph "N:…"). */
  proper: boolean;
  /** Verses the entry is "only mentioned at" (people mentioned once or twice), or null. */
  only: Set<string> | null;
}

const STOP = new Set(
  (
    'the a an of to in on at by for with from into unto upon and or but nor his her its their my your our thy thine him them me us you ye he she it ' +
    'they we i o is are was were be been being am that this these those which who whom whose as not no all every also one some any so then there ' +
    'what when where how than very own direct object et dm used means also see meaning name means person place man woman son daughter ' +
    'living time first mentioned only'
  ).split(' '),
);

/** Stem an English word for loose comparison: lower case, no possessive, plural folded. */
export function stemWord(w: string): string {
  let s = w.toLowerCase().replace(/[’']s$/, '').replace(/[’']/g, '');
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 3 && s.endsWith('es') && /(?:sh|ch|x|ss)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

/** Content words of an English gloss or definition text (stemmed). */
export function contentWords(text: string): string[] {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .split(/[^\p{L}’']+/u)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 1 && !STOP.has(w) && /^[a-z’']+$/.test(w))
    .map(stemWord)
    .filter((w) => w && !STOP.has(w));
}

/** "2Ch.29.12" / "2Ch.29.12; 31.15" -> {"2CH 29:12", "2CH 31:15"}. */
function stepVerses(text: string): string[] {
  const out: string[] = [];
  let book = '';
  for (const part of text.split(/[;,]\s*/)) {
    const m = /^\s*(?:([1-3]?[A-Za-z]{2,3})\.)?(\d+)[.:](\d+)/.exec(part);
    if (!m) continue;
    if (m[1]) book = STEP_BOOKS[m[1]] ?? '';
    if (book) out.push(`${book} ${Number(m[2])}:${Number(m[3])}`);
  }
  return out;
}

/** Variant info for one eStrong id from all its STEP rows. */
export function variantOf(id: string, rows: readonly StepRow[]): HomonymVariant {
  // The eStrong's own dStrong row ("H4060A" for H4060a) says what the entry mainly is; later rows
  // may be names built on it (H4060G "great stature", a man).
  const own = rows.find((r) => r.did.toLowerCase() === id.toLowerCase()) ?? pickPrimary([...rows]);
  const primary = pickPrimary([...rows]);
  const words = new Set<string>();
  for (const r of rows) for (const w of contentWords(r.gloss)) words.add(w);
  for (const w of contentWords(own.def.slice(0, 400))) words.add(w);
  for (const w of contentWords(primary.def.slice(0, 200))) words.add(w);
  let only: Set<string> | null = new Set();
  for (const r of rows) {
    const m = /only mentioned at ([^<]*)/i.exec(r.def);
    if (!m) {
      only = null;
      break;
    }
    for (const v of stepVerses(m[1])) only.add(v);
  }
  if (only && !only.size) only = null;
  return { id, words, proper: own.morph.startsWith('N:'), only };
}

/** True when the variant has the word, or (5+ letters) a word it begins / that begins it (measure ~ measurement). */
function hasWord(v: HomonymVariant, w: string): boolean {
  if (v.words.has(w)) return true;
  if (w.length < 5) return false;
  for (const x of v.words) if (x.length >= 5 && (x.startsWith(w) || w.startsWith(x))) return true;
  return false;
}

const glossScore = (u: HomonymUsage, v: HomonymVariant): number => {
  let hit = 0;
  let all = 0;
  for (const [w, n] of u.words) {
    all += n;
    if (hasWord(v, w)) hit += n;
  }
  return all ? hit / all : 0;
};

/** How well a STEP entry fits a usage (gloss overlap, proper-noun agreement, verse restriction). */
export function fitScore(u: HomonymUsage, v: HomonymVariant): { gloss: number; total: number } {
  const gloss = glossScore(u, v);
  let total = gloss;
  if (u.count) total += (u.proper * 2 >= u.count) === v.proper ? 0.3 : -0.3;
  if (v.only) {
    let inside = 0;
    for (const verse of u.verses) if (v.only.has(verse)) inside++;
    // Fits only when most of the usage is in those verses.
    total += inside * 2 >= u.verses.size ? 0.5 : -0.5;
  }
  return { gloss, total };
}

export interface HomonymResolution {
  /** Lettered Macula id -> the STEP id it really means (only ids that change). */
  remap: Map<string, string>;
  /** Plain Macula id -> the STEP id its lexicon alias should point to (only bases without a plain STEP entry). */
  alias: Map<string, string>;
}

/**
 * Decide remaps and aliases. `variants` lists the STEP eStrong ids per base number ("H1004" ->
 * [H1004a, H1004b]); `usage` is keyed by Macula id; `skip` holds the morpheme ids.
 */
export function resolveHomonyms(
  usage: ReadonlyMap<string, HomonymUsage>,
  variants: ReadonlyMap<string, HomonymVariant[]>,
  skip: ReadonlySet<string> = new Set(),
): HomonymResolution {
  const remap = new Map<string, string>();
  const alias = new Map<string, string>();
  for (const [id, u] of usage) {
    if (skip.has(id) || !/^H\d{4}[a-z]?$/.test(id)) continue;
    const cands = (variants.get(baseStrongs(id)) ?? []).filter((v) => !skip.has(v.id));
    if (cands.length < 2) continue;
    const scored = cands.map((v) => ({ v, ...fitScore(u, v) })).sort((a, b) => b.total - a.total || a.v.id.localeCompare(b.v.id));
    const best = scored[0];
    if (!best) continue;
    const own = scored.find((s) => s.v.id === id);
    if (id === baseStrongs(id)) {
      // Plain id: only matters when STEP has no plain entry of its own.
      if (!own && best.total > (scored[1]?.total ?? -Infinity)) alias.set(id, best.v.id);
      continue;
    }
    if (own) {
      if (best.v.id !== id && own.gloss < 0.15 && best.gloss > own.gloss && best.total >= own.total + 0.3) remap.set(id, best.v.id);
    } else if (best.gloss > 0 && best.total > (scored[1]?.total ?? -Infinity)) {
      remap.set(id, best.v.id);
    }
  }
  return { remap, alias };
}

/* ------------------------------------------------------------------------ */
/* I/O                                                                       */
/* ------------------------------------------------------------------------ */

/** "GEN 2:8!3" (Macula ref) -> "GEN 2:8". */
const verseOfRef = (ref: string) => ref.replace(/!.*$/, '');

/** Usage of every Macula Hebrew id (strongnumberx, first of "a|b"), from its glosses, morph and refs. */
export function maculaUsage(): Map<string, HomonymUsage> {
  const rows = readTsvColumns('macula-hebrew.tsv', ['ref', 'strongnumberx', 'gloss', 'english', 'morph'] as const);
  const out = new Map<string, HomonymUsage>();
  for (const r of rows) {
    const id = normStrongs('H', r.strongnumberx.split('|')[0] ?? '');
    if (!id) continue;
    let u = out.get(id);
    if (!u) out.set(id, (u = { count: 0, words: new Map(), proper: 0, verses: new Set() }));
    u.count++;
    if (r.morph.startsWith('Np')) u.proper++;
    u.verses.add(verseOfRef(r.ref));
    for (const w of new Set([...contentWords(r.english.replace(/\./g, ' ')), ...contentWords(r.gloss.replace(/\./g, ' '))])) {
      u.words.set(w, (u.words.get(w) ?? 0) + 1);
    }
  }
  return out;
}

/** STEP variants per base number (classic range), from TBESH. */
export function stepVariants(rows: readonly StepRow[] = parseStepLexicon(readFileSync(srcPath('TBESH.txt'), 'utf8'), 'H')): Map<string, HomonymVariant[]> {
  const byId = new Map<string, StepRow[]>();
  for (const r of rows) {
    if (!/^H\d{4}[a-z]?$/.test(r.eid) || Number(r.eid.slice(1, 5)) > 8674) continue;
    const list = byId.get(r.eid);
    if (list) list.push(r);
    else byId.set(r.eid, [r]);
  }
  const out = new Map<string, HomonymVariant[]>();
  for (const [id, rs] of byId) {
    const base = baseStrongs(id);
    const list = out.get(base);
    const v = variantOf(id, rs);
    if (list) list.push(v);
    else out.set(base, [v]);
  }
  return out;
}

let cached: HomonymResolution | null = null;

/** The resolution for the bundled sources (computed once per process). */
export function loadHomonyms(): HomonymResolution {
  if (!cached) cached = resolveHomonyms(maculaUsage(), stepVariants(), loadMorphemeIds());
  return cached;
}
