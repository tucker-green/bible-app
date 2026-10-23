/**
 * Stage "wordstudy": one WordStudy per Strong's id -> public/data/study/{G|H}/{NNN}.json (WordStudyChunk),
 * chunked like the lexicon (NNN = floor(number / 100)).
 *
 *   public/data/orig/**            occurrences, per-book counts, inflected forms, the LXX bridge (OW.lxx)
 *   public/data/lex/{G|H}/*.json   which lettered Hebrew ids are prefix/suffix/article morphemes (pos);
 *                                  which ids exist (related words are only listed when they have an entry)
 *   .cache/sources/strongs-*.js    Strong's derivation notes -> related words, both directions
 *
 * Keying (studyKey): the base Strong's id ("H1121a" counts as "H1121"), except Hebrew prefix/suffix/
 * article morpheme ids from Macula ("H2050b" and, "H1886a" the, "H0871a" in, "H2050c" his...), whose
 * base number is an unrelated word (H2050 is "to break in"): they keep their full id. This is the same
 * rule as the concordance's usageKey (scripts/data/lexicon.ts), derived here from the lexicon output
 * so this stage does not have to re-read the 84 MB Macula file.
 *
 * Every Strong's id in OW.strongs gets an entry; Greek ids that occur only as an LXX equivalent of an OT
 * word (never in the SBLGNT, e.g. G1700 ἐμοῦ) also get one, with total 0 and just the LXX bridge.
 *
 * Run after the orig and lexicon stages:  npx tsx -e "import('./scripts/data/wordstudy.ts').then(m => m.buildWordStudy())"
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { LexChunk, OrigChapter, WordStudy, WordStudyChunk } from '../../src/lib/types';
import { OW } from '../../src/lib/types';
import { allChapters, baseStrongs, chunkOf, cleanOut, log, outPath, readJson, srcPath, writeJson } from './common';

const STAGE = 'wordstudy';

/** Caps from the WordStudy contract (src/lib/types.ts). */
export const STUDY_CAPS = { forms: 40, lxx: 12, related: 12 } as const;

/* ======================================================================== */
/* Keying                                                                    */
/* ======================================================================== */

/** True for a lexicon part of speech that marks a written-on morpheme: "Conjunction (prefix)", "Article (suffix, Aramaic)", "Suffix, pronominal (…)". */
export function isAffixPos(pos: string | undefined): boolean {
  return !!pos && /\b(?:prefix|suffix|article)\b/i.test(pos);
}

/**
 * THE word-study key of a Strong's id (must match the concordance key):
 *   - a lettered Hebrew id whose lexicon entry is a prefix, suffix or article morpheme keeps its full
 *     id ("H2050b", "H1886a", "H0871a"; also STEP-style "H9xxx" ids with a letter) — its base number
 *     is an unrelated word;
 *   - every other id is folded to its base number ("H1121a" -> "H1121", "G4053c" -> "G4053").
 * `lexPos` returns the lexicon `pos` of an exact id (undefined when there is no entry under that id).
 */
export function studyKey(id: string, lexPos: (id: string) => string | undefined): string {
  if (/^H\d{4}[A-Za-z]$/.test(id) && isAffixPos(lexPos(id))) return id;
  return baseStrongs(id);
}

/** Read every lexicon chunk of one language: id -> pos (exact keys, including lettered ids). */
export function readLexPos(lang: 'G' | 'H'): Map<string, string> {
  const dir = outPath('lex', lang);
  if (!existsSync(dir)) throw new Error(`Missing ${dir}; run the lexicon stage first.`);
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter((n) => /^\d{3}\.json$/.test(n)).sort()) {
    const chunk = readJson<LexChunk>(outPath('lex', lang, f));
    for (const [id, e] of Object.entries(chunk)) out.set(id, e.pos ?? '');
  }
  return out;
}

/** The lettered Hebrew ids that keep their full id (for reporting / comparison with the concordance). */
export function morphemeIdsFromLex(lexPos: ReadonlyMap<string, string>): Set<string> {
  const out = new Set<string>();
  for (const id of lexPos.keys()) if (studyKey(id, (k) => lexPos.get(k)) === id && id !== baseStrongs(id)) out.add(id);
  return out;
}

/* ======================================================================== */
/* Surface forms                                                             */
/* ======================================================================== */

const GRAVE = '̀';
const ACUTE = '́';
const CIRCUMFLEX = '͂';

/** First letter upper-cased when that is a single character (Greek letters with breathings are). */
function capitalise(s: string): string {
  const first = String.fromCodePoint(s.codePointAt(0) ?? 0);
  const up = first.toUpperCase();
  return up.length === first.length ? up + s.slice(first.length) : s;
}

/**
 * A Greek word as printed, normalised for a forms table: NFC; the positional accent variants are folded
 * (grave -> acute, as before punctuation: τὸν -> τόν; the extra acute an enclitic throws back onto the
 * ultima is dropped: ἄνθρωπός -> ἄνθρωπος); lower-cased, except a proper noun (capitalised lemma) whose
 * first letter is capitalised, so χριστοῦ / Χριστοῦ are one form.
 */
export function greekForm(text: string, lemma: string): string {
  let d = text.normalize('NFD').split(GRAVE).join(ACUTE);
  let accents = 0;
  d = [...d]
    .filter((c) => {
      if (c !== ACUTE && c !== CIRCUMFLEX) return true;
      accents++;
      return accents === 1 || c !== ACUTE;
    })
    .join('');
  const lower = d.normalize('NFC').toLowerCase();
  const l = lemma.normalize('NFC');
  const proper = l !== '' && l[0] !== l[0].toLowerCase();
  return proper ? capitalise(lower) : lower;
}

/**
 * The whole written Hebrew word of every morpheme in a chapter: the texts of all morphemes sharing
 * OW.group, in index order, as printed (not normalised: the orig text keeps the WLC's mark order).
 * Morphemes of a word are normally contiguous but not always — the source orders a few out of place —
 * so this groups by the OW.group value rather than by position.
 */
export function hebrewWordTexts(ch: OrigChapter): string[] {
  const byGroup = new Map<number, string>();
  ch.words.forEach((w) => byGroup.set(w[OW.group], (byGroup.get(w[OW.group]) ?? '') + w[OW.text]));
  return ch.words.map((w) => byGroup.get(w[OW.group]) ?? w[OW.text]);
}

/* ======================================================================== */
/* Counting                                                                  */
/* ======================================================================== */

interface FormAcc {
  n: number;
  /** As-printed spellings of this (NFC form, morph) -> count; the most common one is published. */
  spellings: Map<string, number>;
}

interface Acc {
  total: number;
  byBook: number[];
  /** "NFC form\tmorph" -> count and spellings */
  forms: Map<string, FormAcc>;
  /** other-language key -> count */
  lxx: Map<string, number>;
}

/** Count one occurrence of a form: grouped by NFC (canonically equivalent spellings are one form). */
function addForm(a: Acc, spelling: string, morph: string): void {
  const k = `${spelling.normalize('NFC')}\t${morph}`;
  let f = a.forms.get(k);
  if (!f) a.forms.set(k, (f = { n: 0, spellings: new Map() }));
  f.n++;
  bump(f.spellings, spelling);
}

const newAcc = (): Acc => ({ total: 0, byBook: new Array<number>(66).fill(0), forms: new Map(), lxx: new Map() });

const bump = <K>(m: Map<K, number>, k: K, by = 1): void => {
  m.set(k, (m.get(k) ?? 0) + by);
};

/** "ἐποίησεν|G4160" -> "G4160" (normalised, base); "" when there is no usable Greek Strong's id. */
export function lxxStrongs(lxx: string): string {
  const raw = lxx.split('|')[1] ?? '';
  const m = /^G0*(\d{1,4})[A-Za-z]?$/.exec(raw.trim());
  return m ? `G${m[1].padStart(4, '0')}` : '';
}

/** Accumulates WordStudy figures chapter by chapter (see buildWordStudy). */
export class StudyCounter {
  private readonly acc = new Map<string, Acc>();
  constructor(private readonly key: (id: string) => string) {}

  private get(id: string): Acc {
    let a = this.acc.get(id);
    if (!a) this.acc.set(id, (a = newAcc()));
    return a;
  }

  addChapter(bookNum: number, ch: OrigChapter): void {
    const hebrew = ch.lang === 'hbo';
    const whole = hebrew ? hebrewWordTexts(ch) : null;
    ch.words.forEach((w, i) => {
      const raw = w[OW.strongs];
      const id = raw ? this.key(raw) : '';
      if (id) {
        const a = this.get(id);
        a.total++;
        a.byBook[bookNum - 1]++;
        addForm(a, whole ? whole[i] : greekForm(w[OW.text], w[OW.lemma]), w[OW.morph]);
      }
      if (hebrew && w[OW.lxx]) {
        const g = lxxStrongs(w[OW.lxx]);
        if (!g) return;
        const gk = this.key(g);
        const ga = this.get(gk); // creates an entry for LXX-only Greek ids too (total 0)
        if (id) {
          bump(this.get(id).lxx, gk);
          bump(ga.lxx, id);
        }
      }
    });
  }

  /** Occurrence totals so far (id -> total), e.g. to rank related words. */
  totals(): Map<string, number> {
    return new Map([...this.acc].map(([id, a]) => [id, a.total]));
  }

  ids(): string[] {
    return [...this.acc.keys()];
  }

  /** Finished WordStudy records (without `related`), by id. */
  result(caps: { forms: number; lxx: number } = STUDY_CAPS): Map<string, WordStudy> {
    const out = new Map<string, WordStudy>();
    for (const [id, a] of this.acc) {
      const forms = [...a.forms]
        .map(([k, f]): [string, string, number] => {
          const morph = k.slice(k.indexOf('\t') + 1);
          return [topCounts(f.spellings, 1)[0][0], morph, f.n];
        })
        .sort((x, y) => y[2] - x[2] || cmp(x[0], y[0]) || cmp(x[1], y[1]))
        .slice(0, caps.forms);
      const s: WordStudy = { id, total: a.total, byBook: a.byBook, forms };
      const lxx = topCounts(a.lxx, caps.lxx);
      if (lxx.length) s.lxx = lxx;
      out.set(id, s);
    }
    return out;
  }
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Most frequent first (ties by id), capped. */
export function topCounts(m: ReadonlyMap<string, number>, cap: number): [string, number][] {
  return [...m].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, cap);
}

/* ======================================================================== */
/* Strong's derivation notes -> related words                                */
/* ======================================================================== */

/**
 * Parse an OpenScriptures Strong's dictionary (`var strongsGreekDictionary = {...}; module.exports = …`)
 * WITHOUT evaluating it: skip leading comments, cut out the object literal after the first `=` by
 * string-aware brace matching, and JSON.parse it. Only string fields are kept.
 */
export function parseStrongsDictionary(text: string): Map<string, Record<string, string>> {
  let pos = 0;
  for (;;) {
    const c = /^\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))/.exec(text.slice(pos));
    if (!c) break;
    pos += c[0].length;
  }
  const head = /^\s*(?:(?:var|let|const)\s+[A-Za-z_$][\w$]*|module\.exports)\s*=\s*\{/.exec(text.slice(pos));
  if (!head) throw new Error("Strong's dictionary: no `var x = {` object literal found");
  const start = pos + head[0].length - 1;
  let depth = 0;
  let inStr = false;
  let end = -1;
  for (let i = start; i < text.length && end < 0; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) end = i;
  }
  if (end < 0) throw new Error("Strong's dictionary: unterminated object literal");
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error("Strong's dictionary: not an object");
  const out = new Map<string, Record<string, string>>();
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const m = /^([GH])0*(\d{1,4})$/.exec(k);
    if (!m || !v || typeof v !== 'object') continue;
    const fields: Record<string, string> = {};
    for (const [f, s] of Object.entries(v as Record<string, unknown>)) if (typeof s === 'string') fields[f] = s;
    out.set(`${m[1]}${m[2].padStart(4, '0')}`, fields);
  }
  return out;
}

/**
 * Phrases of a derivation note that name a word only as context, not as an etymological relative:
 * "a deity, especially (with G3588 (ὁ)) the supreme Divinity", "(with G1093 (γῆ) implied)",
 * "(with or without G3588 (ὁ))", "(often in connection with H376 (אִישׁ), H802 (אִשָּׁה)…)".
 * G1 (Α) "as a negative particle" / "as a particle of union" is the prefix ἀ-, not the word Alpha.
 * ("identical with", "compound of G3588 with G2245" and the like are kept.)
 */
const CONTEXT_ONLY = [
  /\((?:\w+\s+)?with(?:\s+or\s+without)?\s(?:[^()]|\([^()]*\))*\)/gi,
  /\bin connection with\b(?:[^;()]|\([^()]*\))*/gi,
  // α- as a prefix, not the word "Alpha": "from G1 (Α) (as a negative particle) and G1492 (εἴδω)".
  /\bG0*1\b\s*(?:\([^()]*\)\s*)?\(as (?:a )?(?:negative|connective|particle)[^()]*/gi,
];

/**
 * Every Strong's id named in a derivation note (context-only mentions excepted), normalised, in order,
 * de-duplicated: "from G1537 (ἐκ) and G5055 (τελέω);" -> ["G1537", "G5055"]; "of Hebrew origin (H08012)" -> ["H8012"].
 */
export function derivationRefs(deriv: string): string[] {
  const out: string[] = [];
  const text = CONTEXT_ONLY.reduce((t, re) => t.replace(re, ' '), deriv);
  for (const m of text.matchAll(/\b([GH])0*(\d{1,4})\b/g)) {
    const id = `${m[1]}${m[2].padStart(4, '0')}`;
    if (id !== `${m[1]}0000` && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Related words for every id, both directions: the words its derivation note names (its sources, in the
 * note's order) then the words whose notes name it (derived words, most frequent in the Bible first, ties
 * by id). Self-references and ids failing `exists` are dropped; capped at `cap`.
 * `derivations`: id -> derivation note. `totals`: id -> occurrences (for ranking derived words).
 */
export function relatedIndex(
  derivations: ReadonlyMap<string, string>,
  totals: ReadonlyMap<string, number>,
  exists: (id: string) => boolean,
  cap: number = STUDY_CAPS.related,
): Map<string, string[]> {
  const from = new Map<string, string[]>();
  const derived = new Map<string, Set<string>>();
  for (const [id, note] of derivations) {
    const refs = derivationRefs(note).filter((r) => r !== id);
    if (refs.length) from.set(id, refs);
    for (const r of refs) {
      let s = derived.get(r);
      if (!s) derived.set(r, (s = new Set()));
      s.add(id);
    }
  }
  const out = new Map<string, string[]>();
  for (const id of new Set([...from.keys(), ...derived.keys()])) {
    const list: string[] = [];
    const push = (r: string) => {
      if (r !== id && exists(r) && !list.includes(r)) list.push(r);
    };
    for (const r of from.get(id) ?? []) push(r);
    const kids = [...(derived.get(id) ?? [])].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || cmp(a, b));
    for (const r of kids) push(r);
    if (list.length) out.set(id, list.slice(0, cap));
  }
  return out;
}

/* ======================================================================== */
/* Stage                                                                     */
/* ======================================================================== */

/** Split finished studies into lexicon-style chunks: "G/030" -> { G3056: {...} }, ids sorted. */
export function chunkStudies(studies: ReadonlyMap<string, WordStudy>): Map<string, WordStudyChunk> {
  const chunks = new Map<string, WordStudyChunk>();
  for (const id of [...studies.keys()].sort()) {
    const key = `${id[0]}/${chunkOf(id)}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = {}));
    c[id] = studies.get(id)!;
  }
  return chunks;
}

export function buildWordStudy(): void {
  const lexPos = new Map([...readLexPos('G'), ...readLexPos('H')]);
  const key = (id: string) => studyKey(id, (k) => lexPos.get(k));

  const counter = new StudyCounter(key);
  for (const { book, chapter } of allChapters()) {
    counter.addChapter(book.num, readJson<OrigChapter>(outPath('orig', book.id, `${chapter}.json`)));
  }
  const studies = counter.result();

  // Related words from Strong's derivation notes (base ids). Prefix/suffix morpheme keys never take the
  // related words of their unrelated base number.
  const derivations = new Map<string, string>();
  for (const file of ['strongs-greek.js', 'strongs-hebrew.js']) {
    for (const [id, f] of parseStrongsDictionary(readFileSync(srcPath(file), 'utf8'))) {
      if (f.derivation) derivations.set(id, f.derivation);
    }
  }
  const related = relatedIndex(derivations, counter.totals(), (id) => lexPos.has(id) || studies.has(id));
  let withRelated = 0;
  for (const [id, s] of studies) {
    if (id !== baseStrongs(id)) continue;
    const r = related.get(id);
    if (r?.length) {
      s.related = r;
      withRelated++;
    }
  }

  cleanOut('study');
  let bytes = 0;
  const chunks = chunkStudies(studies);
  for (const [k, chunk] of chunks) {
    const [lang, n] = k.split('/');
    bytes += writeJson(outPath('study', lang, `${n}.json`), chunk);
  }
  const all = [...studies.values()];
  const g = all.filter((s) => s.id[0] === 'G').length;
  const morphemes = all.filter((s) => s.id !== baseStrongs(s.id)).length;
  const lxxOnly = all.filter((s) => s.total === 0).length;
  const withLxx = all.filter((s) => s.lxx).length;
  log(
    STAGE,
    `${studies.size} studies (${g} Greek incl. ${lxxOnly} LXX-only, ${studies.size - g} Hebrew incl. ${morphemes} prefix/suffix morpheme ids), ` +
      `${withLxx} with an LXX bridge, ${withRelated} with related words; ${chunks.size} chunks, ${(bytes / 1e6).toFixed(1)} MB`,
  );
}
