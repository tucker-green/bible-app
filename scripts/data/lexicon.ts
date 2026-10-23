/**
 * Lexicon stage.
 *
 *   STEPBible TBESG / TBESH (brief lexicons, CC BY 4.0)  ─┐
 *   OpenScriptures Strong's Greek / Hebrew dictionaries  ─┼─> public/data/lex/{G|H}/{NNN}.json  (LexChunk)
 *   Macula Hebrew (morpheme classes for prefix/suffix ids) ┘   public/data/lex/index.json          (LexIndex)
 *
 * Keys are normalised Strong's ids ("G0026", "H1121a", "H2050b"). One entry per STEP eStrong id
 * (STEP's dStrong sub-senses of the same id are folded into that entry as "Other uses"); a base id
 * ("H1121") is always present too, aliasing its most representative lettered variant.
 *
 * Macula Hebrew (the source of WLCM.tsv, and so of every OT word in public/data/orig/) tags prefixes
 * and suffixes with its own extended ids whose base number is unrelated to the morpheme (H2050b = the
 * conjunction וְ, but Strong's H2050 is הָתַת "to break in"). Those ids get short, accurate entries
 * written here, chosen by how Macula actually uses each id, so that "and" / "the" / "in" / "his" show
 * the right word instead of falling back to an unrelated base entry.
 */
import { readFileSync, statSync } from 'node:fs';
import { getBook } from '../../src/lib/books';
import type { BookInfo } from '../../src/lib/books';
import type { LexChunk, LexEntry, LexIndex } from '../../src/lib/types';
import { baseStrongs, chunkOf, cleanOut, log, normStrongs, outPath, srcPath, writeJson } from './common';

const STAGE = 'lexicon';

/** Highest classic Strong's numbers (the KJV's numbering). */
export const MAX_STRONGS = { G: 5624, H: 8674 } as const;

type Lang = 'G' | 'H';

/* ======================================================================== */
/* Small text helpers                                                        */
/* ======================================================================== */

/** Escape text for use as HTML element content. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

/** Decode the handful of HTML entities that occur in the sources (plus numeric ones). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Hebrew: drop cantillation accents (U+0591–U+05AF); keep vowels, dagesh, shin/sin dots and maqaf. */
export function stripCantillation(s: string): string {
  return s.replace(/[\u0591-\u05AF]/g, '');
}

/** Consonant skeleton of a Hebrew word (final forms folded), for loose lemma comparison. */
export function hebrewSkeleton(s: string): string {
  const finals: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
  return s
    .normalize('NFD')
    .replace(/[^\u05D0-\u05EA]/g, '')
    .replace(/[ךםןףץ]/g, (c) => finals[c]);
}

/** Greek folded for loose comparison: no accents/breathings, lower case, final sigma folded. */
export function greekFold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^\p{L}]/gu, '');
}

function lemmaKey(lemma: string, lang: Lang): string {
  return lang === 'H' ? hebrewSkeleton(lemma) : greekFold(lemma);
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/* ======================================================================== */
/* Strong's dictionaries (OpenScriptures JSON-in-JS)                         */
/* ======================================================================== */

export interface StrongsRaw {
  lemma?: string;
  translit?: string;
  xlit?: string;
  pron?: string;
  derivation?: string;
  strongs_def?: string;
  kjv_def?: string;
}

/**
 * Parse an OpenScriptures `strongs-*-dictionary.js` file WITHOUT evaluating it: the object literal
 * after `var x =` is valid JSON, so it is cut out by brace matching (string-aware) and handed to
 * JSON.parse. Only string fields of object values are kept. Throws if no object literal is found.
 */
export function parseStrongsJs(text: string): Record<string, StrongsRaw> {
  // Skip the leading licence comment(s) so nothing inside them can be mistaken for the object.
  let pos = 0;
  for (;;) {
    const rest = /^\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))/.exec(text.slice(pos));
    if (!rest) break;
    pos += rest[0].length;
  }
  const m = /^\s*(?:(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=|module\.exports\s*=)\s*\{/.exec(text.slice(pos));
  if (!m) throw new Error("Strong's dictionary: no object literal found");
  const start = pos + m[0].length - 1;
  let depth = 0;
  let inStr = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Strong's dictionary: unterminated object literal");
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error("Strong's dictionary: not an object");
  const out: Record<string, StrongsRaw> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[GH]\d+[a-z]?$/.test(key) || !value || typeof value !== 'object') continue;
    const entry: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === 'string') entry[k] = v;
    out[key] = entry as StrongsRaw;
  }
  return out;
}

/** Strong's text fields, trimmed. Braces (used around some Aramaic definitions) are dropped. */
function strongsFields(s: StrongsRaw): Pick<LexEntry, 'strongsDef' | 'kjv' | 'deriv'> {
  const out: Pick<LexEntry, 'strongsDef' | 'kjv' | 'deriv'> = {};
  const def = squash((s.strongs_def ?? '').replace(/[{}]/g, ''));
  const kjv = squash(s.kjv_def ?? '');
  const deriv = squash(s.derivation ?? '').replace(/[;,\s]+$/, '');
  if (def) out.strongsDef = def;
  if (kjv) out.kjv = kjv;
  if (deriv) out.deriv = deriv;
  return out;
}

/* ======================================================================== */
/* STEPBible brief lexicons                                                  */
/* ======================================================================== */

export interface StepRow {
  /** Normalised eStrong id, e.g. "G0026", "H1121a" (may exceed the classic range: "G6029"). */
  eid: string;
  /** dStrong id, e.g. "H0430G". */
  did: string;
  /** dStrong relation text after "=", e.g. "a Name of", "a Part of", "" for a plain entry. */
  rel: string;
  /** uStrong id: the related entry for "a Form of" / "a Name of" rows, else the row's own id. */
  uid: string;
  lemma: string;
  translit: string;
  /** STEP morph code, e.g. "G:N-F", "H:V", "N:N-M-P". */
  morph: string;
  gloss: string;
  /** Raw definition HTML. */
  def: string;
}

/** Parse TBESG / TBESH: data rows start with an id ("G0001", "H1121a") followed by 7 tab-separated fields. */
export function parseStepLexicon(text: string, prefix: Lang): StepRow[] {
  const rows: StepRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^[GH]\d{4,5}[A-Za-z]?\t/.test(line)) continue;
    const c = line.split('\t');
    if (c.length < 8) continue;
    const eid = normStrongs(prefix, c[0]);
    if (!eid) continue;
    const dm = /^\s*(\S+)\s*=\s*(.*)$/.exec(c[1]);
    rows.push({
      eid,
      did: dm ? dm[1] : c[1].trim(),
      rel: dm ? dm[2].trim() : '',
      uid: (/^\s*([GH]\d{4,5}[A-Za-z]?)/.exec(c[2])?.[1] ?? '').trim(),
      lemma: c[3].trim(),
      translit: c[4].trim(),
      morph: c[5].trim(),
      gloss: squash(c[6]),
      def: c[7],
    });
  }
  return rows;
}

const TYPE_NAMES: Record<string, string> = {
  A: 'Adjective',
  ADV: 'Adverb',
  ART: 'Article',
  T: 'Article',
  COND: 'Conditional particle',
  CONJ: 'Conjunction',
  COR: 'Correlative',
  D: 'Demonstrative pronoun',
  DEMP: 'Demonstrative pronoun',
  IMPP: 'Impersonal pronoun',
  INDP: 'Indefinite pronoun',
  INJ: 'Interjection',
  INTJ: 'Interjection',
  INTG: 'Interrogative',
  I: 'Interrogative pronoun',
  N: 'Noun',
  NEG: 'Negative particle',
  PART: 'Particle',
  PRT: 'Particle',
  PREP: 'Preposition',
  PERP: 'Personal pronoun',
  P: 'Personal pronoun',
  POSP: 'Possessive pronoun',
  S: 'Possessive pronoun',
  REFP: 'Reflexive pronoun',
  F: 'Reflexive pronoun',
  RELP: 'Relative pronoun',
  R: 'Relative pronoun',
  V: 'Verb',
  X: 'Indefinite pronoun',
  Q: 'Correlative pronoun',
  K: 'Correlative pronoun',
  C: 'Reciprocal pronoun',
};

const GENDERS: Record<string, string> = { M: 'masculine', F: 'feminine', N: 'neuter', C: 'common' };
const NUMBERS: Record<string, string> = { S: 'singular', P: 'plural' };
const PERSONS: Record<string, string> = { '1': '1st person', '2': '2nd person', '3': '3rd person' };

function genderWord(g: string): string {
  return g
    .split('/')
    .map((x) => GENDERS[x] ?? '')
    .filter(Boolean)
    .join('/');
}

/** Decode one "L:Type-Gender-Extra" part (no "/" or "+" combinations). */
function decodeMorphPart(part: string, lexLang: Lang): string {
  const m = /^([GHAN]):([A-Za-z]+)(?:-([^-]*))?(?:-(.*))?$/.exec(part.trim());
  if (!m) return '';
  const [, lang, typeRaw, f1 = '', f2 = ''] = m;
  const type = typeRaw.toUpperCase();
  const langNote =
    lang === 'A' ? ' (Aramaic)' : lang === 'H' && lexLang === 'G' ? ' (Hebrew)' : '';

  if (lang === 'N' || (type === 'N' && /^PRI$/.test(f1))) {
    // Names: N:N-M-P person, N:N--L place, N:N--LG/PG/TG gentilic, N:N--T title; G:N-PRI proper indeclinable.
    if (f1 === 'PRI') return 'Proper noun, indeclinable';
    const extra = f2.toUpperCase();
    const head = type === 'A' ? 'Adjective, proper' : 'Proper noun';
    if (extra.endsWith('G')) return `${type === 'A' ? 'Adjective' : 'Proper noun'}, gentilic`;
    if (extra === 'P') return f1 === 'F' ? `${head}, person (female)` : `${head}, person`;
    if (extra === 'L') return `${head}, place`;
    if (extra === 'T') return `${head}, title`;
    return head;
  }

  const name = TYPE_NAMES[type];
  if (!name) return '';
  const bits: string[] = [];
  if (type === 'N' && f1 === 'LI') return `Noun, letter (indeclinable)${langNote}`;
  if (type === 'A' && f1 === 'NUI') return `Numeral (indeclinable)${langNote}`;
  if (type === 'ADV' || type === 'PRT') {
    const q: Record<string, string> = { C: 'comparative', S: 'superlative', I: 'interrogative', N: 'negative' };
    if (q[f1]) bits.push(q[f1]);
  } else if (type === 'A') {
    if (f1) bits.push(genderWord(f1));
    const q: Record<string, string> = { C: 'comparative', S: 'superlative' };
    if (q[f2]) bits.push(q[f2]);
  } else if (/^[123]$/.test(f1)) {
    bits.push(PERSONS[f1]);
  } else if (f1) {
    // Hebrew pronouns: "CS" = common singular; nouns: "M", "F", "M/F".
    const g = /^([MFNC](?:\/[MFNC])?)([SP])?$/.exec(f1);
    if (g) {
      bits.push(genderWord(g[1]));
      if (g[2]) bits.push(NUMBERS[g[2]]);
    }
  }
  const detail = bits.filter(Boolean).join(' ');
  return `${name}${detail ? `, ${detail}` : ''}${langNote}`;
}

/**
 * STEP morph code -> readable part of speech.
 *   "G:V" -> "Verb";  "G:N-F" -> "Noun, feminine";  "N:N-M-P" -> "Proper noun, person";
 *   "A:N-M" -> "Noun, masculine (Aramaic)";  "G:A / G:ADV" -> "Adjective / Adverb".
 * `lexLang` is the lexicon the code comes from (a Hebrew loanword in the Greek lexicon is flagged).
 */
export function decodeStepMorph(code: string, lexLang: Lang = 'G'): string {
  const c = code.trim();
  if (!c) return '';
  const alts = c.split(/\s*\/\s*(?=[GHAN]:)/);
  return alts
    .map((alt) =>
      alt
        .split(/\s*\+\s*/)
        .map((p) => decodeMorphPart(p, lexLang))
        .filter(Boolean)
        .join(' + '),
    )
    .filter(Boolean)
    .join(' / ');
}

/* ======================================================================== */
/* Verse references                                                          */
/* ======================================================================== */

/** STEPBible book abbreviations -> USFM ids. */
export const STEP_BOOKS: Readonly<Record<string, string>> = {
  Gen: 'GEN', Exo: 'EXO', Lev: 'LEV', Num: 'NUM', Deu: 'DEU', Jos: 'JOS', Jdg: 'JDG', Rut: 'RUT',
  '1Sa': '1SA', '2Sa': '2SA', '1Ki': '1KI', '2Ki': '2KI', '1Ch': '1CH', '2Ch': '2CH', Ezr: 'EZR',
  Neh: 'NEH', Est: 'EST', Job: 'JOB', Psa: 'PSA', Pro: 'PRO', Ecc: 'ECC', Sng: 'SNG', Isa: 'ISA',
  Jer: 'JER', Lam: 'LAM', Ezk: 'EZK', Dan: 'DAN', Hos: 'HOS', Jol: 'JOL', Amo: 'AMO', Oba: 'OBA',
  Jon: 'JON', Mic: 'MIC', Nam: 'NAM', Hab: 'HAB', Zep: 'ZEP', Hag: 'HAG', Zec: 'ZEC', Mal: 'MAL',
  Mat: 'MAT', Mrk: 'MRK', Luk: 'LUK', Jhn: 'JHN', Act: 'ACT', Rom: 'ROM', '1Co': '1CO', '2Co': '2CO',
  Gal: 'GAL', Eph: 'EPH', Php: 'PHP', Col: 'COL', '1Th': '1TH', '2Th': '2TH', '1Ti': '1TI', '2Ti': '2TI',
  Tit: 'TIT', Phm: 'PHM', Heb: 'HEB', Jas: 'JAS', '1Pe': '1PE', '2Pe': '2PE', '1Jn': '1JN', '2Jn': '2JN',
  '3Jn': '3JN', Jud: 'JUD', Rev: 'REV',
};

/** Other spellings seen in STEP <ref> attributes (lower-case keys). */
const REF_ALIASES: Record<string, string> = {
  jude: 'JUD', luke: 'LUK', mark: 'MRK', john: 'JHN', matt: 'MAT', acts: 'ACT', '1jo': '1JN',
  '1cor': '1CO', '2cor': '2CO', '1tim': '1TI', '2tim': '2TI', phil: 'PHP', '1pet': '1PE',
  '2pet': '2PE', ps: 'PSA', eze: 'EZK', ezek: 'EZK', song: 'SNG',
};

const STEP_BOOKS_LOWER = new Map(Object.entries(STEP_BOOKS).map(([k, v]) => [k.toLowerCase(), v]));

/**
 * Resolve a STEP book abbreviation. Greek (Abbott-Smith) cites Samuel/Kings by their Septuagint names
 * "1–4 Kingdoms": STEP rewrote most attributes to Hebrew-Bible books (visible "1Ki.14:45" ->
 * attribute "1Sa.14.45") but some were left as-is (attribute and visible text both "1Ki"), and
 * "3Ki"/"4Ki" remain. So in the Greek lexicon: 3Ki/4Ki = 1/2 Kings, and 1Ki/2Ki whose visible
 * text also says 1Ki/2Ki = 1/2 Samuel.
 */
function resolveStepBook(abbr: string, lang: Lang, visible: string): BookInfo | undefined {
  const lower = abbr.toLowerCase();
  let usfm: string | undefined;
  if (lang === 'G') {
    if (lower === '3ki') usfm = '1KI';
    else if (lower === '4ki') usfm = '2KI';
    else if (lower === '1ki' || lower === '2ki') {
      const shown = /^\s*([1-4]?[A-Za-z]+)/.exec(visible)?.[1]?.toLowerCase();
      usfm = shown === lower ? (lower === '1ki' ? '1SA' : '2SA') : STEP_BOOKS_LOWER.get(lower);
    }
  }
  usfm ??= STEP_BOOKS_LOWER.get(lower) ?? REF_ALIASES[lower];
  return usfm ? getBook(usfm) : undefined;
}

export interface RefPart {
  book: BookInfo;
  chapter: number;
  verse: number;
  /** End of a range (same chapter unless chapterEnd is set). */
  verseEnd?: number;
  chapterEnd?: number;
  /** True for a chapter-only reference ("Psa.23"). */
  chapterOnly?: boolean;
  /** Separator printed before this part ("" for the first). */
  sep: string;
}

/**
 * Parse a STEP reference list: "Mat.5.43", "Heb.5.4; 7.11; 9.4", "1Co.14.9, 19", "Gen.4.2-10",
 * "Jude.12", "Jhn.8:7; 20:4, 8", "3Ki.3.8 8:5". Returns null if any piece cannot be parsed or a
 * chapter is out of range (the caller then keeps the reference as plain text).
 */
export function parseStepRefs(attr: string, lang: Lang = 'G', visible = ''): RefPart[] | null {
  const a = attr
    .trim()
    .replace(/:/g, '.')
    .replace(/(\d)(?:ff\.?|[a-c])(?=[\s;,.-]|$)/g, '$1') // "27b", "37ff" -> verse number
    .replace(/[.;,\s]+$/, '');
  const m = /^([1-4]?[A-Za-z]+)\.?\s*(\d.*)$/.exec(a);
  if (!m) return null;
  const book = resolveStepBook(m[1], lang, visible || attr);
  if (!book) return null;
  const tokens = m[2].split(/\s*([;,]|\s)\s*/);
  const parts: RefPart[] = [];
  let curChapter: number | undefined;
  let sep = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i % 2 === 1) {
      sep = t === ',' ? ', ' : '; ';
      continue;
    }
    if (!t) return null;
    let part: Omit<RefPart, 'book' | 'sep'> | null = null;
    let r: RegExpExecArray | null;
    if ((r = /^(\d+)\.(\d+)(?:-(\d+)(?:\.(\d+))?)?$/.exec(t))) {
      const chapter = +r[1];
      const verse = +r[2];
      if (r[4]) part = { chapter, verse, chapterEnd: +r[3], verseEnd: +r[4] };
      else part = { chapter, verse, ...(r[3] ? { verseEnd: +r[3] } : {}) };
    } else if ((r = /^(\d+)(?:-(\d+))?$/.exec(t))) {
      const n = +r[1];
      const end = r[2] ? +r[2] : undefined;
      if (curChapter !== undefined) part = { chapter: curChapter, verse: n, ...(end ? { verseEnd: end } : {}) };
      else if (book.chapters === 1) part = { chapter: 1, verse: n, ...(end ? { verseEnd: end } : {}) };
      else part = { chapter: n, verse: 1, chapterOnly: true };
    }
    if (!part) return null;
    const lastChapter = part.chapterEnd ?? part.chapter;
    if (part.chapter < 1 || part.chapter > book.chapters || lastChapter > book.chapters || part.verse < 1) return null;
    if (part.verseEnd !== undefined && part.chapterEnd === undefined && part.verseEnd <= part.verse) delete part.verseEnd;
    parts.push({ book, sep: parts.length ? sep : '', ...part });
    curChapter = lastChapter;
  }
  return parts.length ? parts : null;
}

/** Render parsed refs as `<span class="ref" data-ref="BOOK.C.V">label</span>` (book name only on the first). */
export function renderRefParts(parts: RefPart[]): string {
  let prevChapter = -1;
  return parts
    .map((p, i) => {
      let label: string;
      if (p.chapterOnly) label = `${p.chapter}`;
      else if (p.book.chapters === 1) label = p.verseEnd !== undefined ? `${p.verse}–${p.verseEnd}` : `${p.verse}`;
      else {
        const showChapter = i === 0 || p.chapter !== prevChapter || p.sep === '; ';
        label = showChapter ? `${p.chapter}:${p.verse}` : `${p.verse}`;
        if (p.chapterEnd !== undefined) label += `–${p.chapterEnd}:${p.verseEnd}`;
        else if (p.verseEnd !== undefined) label += `–${p.verseEnd}`;
      }
      if (i === 0) label = `${p.book.short} ${label}`;
      prevChapter = p.chapterEnd ?? p.chapter;
      return `${p.sep}<span class="ref" data-ref="${p.book.id}.${p.chapter}.${p.verse}">${escapeHtml(label)}</span>`;
    })
    .join('');
}

/** Bare STEP-style references inside text ("first mentioned at 1Sa.9.1; 2Ch.2.13; 4.16"). */
const BARE_REF_RE = new RegExp(
  `(?<![\\w.])(${Object.keys(STEP_BOOKS).join('|')})\\.(\\d{1,3})\\.(\\d{1,3})(?:-\\d{1,3})?(?:;\\s*\\d{1,3}\\.\\d{1,3}(?:-\\d{1,3})?)*(?![\\w.]*\\d)`,
  'g',
);

/* ======================================================================== */
/* Definition sanitiser                                                      */
/* ======================================================================== */

type DefNode =
  | { k: 'text'; s: string }
  | { k: 'html'; s: string }
  | { k: 'br' }
  | { k: 'open'; tag: 'b' | 'i' }
  | { k: 'close'; tag: 'b' | 'i' };

/** Bibliographic sigla used in Abbott-Smith parentheticals ("(cf. MM, VGT, see word)"). */
const BIBLIO_RE =
  /\b(?:MM|VGT|Cremer|Deiss(?:mann)?|Thayer|Swete|Boisacq|LAE|LS|Moulton|Kennedy|Lft|Lightfoot|Hort|Mayor|Westc(?:ott)?|Dalman|Burton|Grimm|Milligan|Zahn|Hatch|Trench|Edersheim|Schürer|Ramsay|Ellicott|Meyer|Plummer|Hastings|WM|Winer|Robertson|Thackeray|Helbing|Mayser|Nägeli|Rutherford|Lobeck|Veitch|Souter|Wetstein|Bengel|Alford|Vaughan|Sanday|Headlam|Lietzmann|Jannaris|Abbott|Buttmann|Driver|DB|ICC|EB|CGT|Exp|Syn|Gram|Bl|WH|Rec|Tdf|Treg|Lchm|mg|txt|om)\b\.?|\bField,|\bTr\.,|\bPr\.,\s*\d|see word|\d(?:st|nd|rd|th)? c\.(?:BC|AD)\b/;

const GREEK_OR_HEBREW_OR_DIGIT = /[\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF\d]/;
/** "(Herdotus Historicus)", "(Iliad by Homer)", "(Sophocles Tragicus), etc." — Middle Liddell author citations. */
const AUTHOR_CITATION_RE = /^[A-ZÆ][\w.'’-]*(?:[\s,;]+(?:by|of|the|and|etc\.?|al\.?|[A-ZÆ][\w.'’-]*))*$/;

function plainOf(html: string): string {
  return decodeEntities(html.replace(/<[^<>]*>/g, ''));
}

/**
 * Edit balanced (open … close) groups, innermost first, skipping over tag interiors. `edit` returns
 * the replacement for a group, or null to keep it. Groups spanning a line break, or longer than
 * `maxLen`, are never touched (protects against unbalanced brackets in the source). Whitespace
 * before a removed group goes with it ("instance (…)." -> "instance.").
 */
function editGroups(
  s: string,
  open: string,
  close: string,
  edit: (plain: string, raw: string) => string | null,
  maxLen = 700,
): string {
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<') {
      const j = s.indexOf('>', i);
      if (j > i && /^<\/?[A-Za-z!]/.test(s.slice(i, i + 2))) {
        i = j;
        continue;
      }
    }
    if (c === open) stack.push(i);
    else if (c === close && stack.length) {
      const start = stack.pop()!;
      const raw = s.slice(start, i + 1);
      if (raw.length > maxLen || /<(?:br|lb)\b/i.test(raw)) continue;
      const rep = edit(plainOf(raw), raw);
      if (rep === null || rep === raw) continue;
      let from = start;
      if (!rep) while (from > 0 && (s[from - 1] === ' ' || s[from - 1] === '\t')) from--;
      s = s.slice(0, from) + rep + s.slice(i + 1);
      i = from + rep.length - 1;
    }
  }
  return s;
}

/** Split a group's inner HTML on top-level ";" (outside tags and nested brackets). */
function splitClauses(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '<') {
      const j = inner.indexOf('>', i);
      if (j > i) i = j;
    } else if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (c === ';' && depth === 0) {
      out.push(inner.slice(last, i));
      last = i + 1;
    }
  }
  out.push(inner.slice(last));
  return out;
}

function isApparatusBracket(plain: string): boolean {
  return /^\[\s*(?:(?:very\s+)?frequently\s+|chiefly\s+|so\s+)?(?:in\s+)?(?:LXX|Aq\.?|Sm\.?|Al\.?|AI\.?|Th\.?|Theod\.?|OT|Aquila|Symmachus|Theodotion|Man\.\d)/i.test(plain);
}

/**
 * Parenthetical apparatus: attributions "(AS)", bibliographic notes "(cf. MM, VGT, see word)",
 * Middle Liddell author citations "(Sophocles Tragicus)". In a parenthetical that also cites verses,
 * only its bibliographic ";"-clauses are dropped.
 */
function editParen(plain: string, raw: string, middleLiddell: boolean): string | null {
  const p = squash(plain.slice(1, -1));
  if (/^(?:AS|ML|MD|AS\/ML|Abbott-Smith|Middle Liddell)$/.test(p)) return '';
  if (!/<ref\b/i.test(raw)) {
    if (BIBLIO_RE.test(p)) return '';
    if (middleLiddell && AUTHOR_CITATION_RE.test(p) && !GREEK_OR_HEBREW_OR_DIGIT.test(p)) return '';
    return null;
  }
  const clauses = splitClauses(raw.slice(1, -1));
  const kept = clauses.filter((c) => /<ref\b/i.test(c) || !BIBLIO_RE.test(plainOf(c)));
  if (kept.length === clauses.length) return null;
  return kept.length ? `(${kept.join(';').trim()})` : '';
}

/**
 * Sanitise a STEPBible definition into the small HTML subset the app renders:
 * only <b>, <i>, <br> and <span class="ref" data-ref="BOOK.C.V">label</span>. Everything else is
 * escaped text; no attribute from the source is ever copied. STEP <ref='Mat.5.43'> links become
 * ref spans with readable labels ("Matt 5:43"); unparseable or non-canonical refs (Apocrypha,
 * broken/nested markup) keep their text. "__1." outline markers become line breaks, and
 * apparatus that is unreadable in a popover is removed: "[in LXX …]" notes, bibliographic
 * parentheticals ("(cf. MM, VGT, see word)"), Middle Liddell author citations and dates,
 * transcriber notes, "(AS)"/"(ML)" attributions and "†" markers.
 */
export function sanitizeStepDef(raw: string, lang: Lang = 'G'): string {
  let s = (raw ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  // Elements removed together with their content.
  s = s.replace(
    /<(script|style|note|author|date|a|title|iframe|object|embed|svg|math|textarea|select|template|noscript|head)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
    '',
  );
  if (lang === 'G') {
    const middleLiddell = /\(ML\)/.test(s);
    s = editGroups(s, '[', ']', (plain) => (isApparatusBracket(plain) ? '' : null), 3000);
    // "[in LXX for …" left unclosed by a source typo: drop it up to the line break.
    s = s.replace(/\[\s*in\s+(?:LXX|Aq\.|Sm\.|Al\.|Th\.)[^[\]]*?(?=<(?:br|lb)\b)/gi, '');
    s = editGroups(s, '(', ')', (plain, rawGroup) => editParen(plain, rawGroup, middleLiddell));
    // Brackets emptied by the removals above ("[<date>…</date> <br>").
    s = s.replace(/\[\s*[,;]?\s*(?=$|<(?:br|lb)\b)/gi, '').replace(/\[\s*(?=,)/g, '');
  } else {
    // Leading sense label of a disambiguated entry: ": beginning<br>1) first, …".
    s = s.replace(/^\s*:\s*[^<]*<br\s*\/?>(?=[\s\S]*\S)/i, '').replace(/^\s*:\s*/, '');
  }

  const nodes: DefNode[] = [];
  const pushText = (text: string) => {
    const t = decodeEntities(text)
      .replace(/\s*_{2,}\s*/g, '\n')
      .replace(/\s*§\s*/g, '\n')
      .replace(/†/g, '');
    let last = 0;
    const emitPlain = (chunk: string) => {
      chunk.split('\n').forEach((line, i) => {
        if (i) nodes.push({ k: 'br' });
        if (line) nodes.push({ k: 'text', s: line });
      });
    };
    for (const m of t.matchAll(BARE_REF_RE)) {
      const at = m.index ?? 0;
      // Greek bare refs to 1–4 Kingdoms are ambiguous (see resolveStepBook): leave as text.
      if (lang === 'G' && /^[1-4]Ki$/.test(m[1])) continue;
      const parts = parseStepRefs(m[0], lang, m[0]);
      if (!parts) continue;
      emitPlain(t.slice(last, at));
      nodes.push({ k: 'html', s: renderRefParts(parts) });
      last = at + m[0].length;
    }
    emitPlain(t.slice(last));
  };

  let ref: { attr: string; depth: number; text: string } | null = null;
  const flushRef = (r: { attr: string; text: string }) => {
    const visible = decodeEntities(r.text);
    const parts = parseStepRefs(r.attr, lang, visible);
    if (!parts) {
      pushText(r.text);
      return;
    }
    const trailing = /([.;:,]+)\s*$/.exec(visible)?.[1] ?? '';
    nodes.push({ k: 'html', s: renderRefParts(parts) + escapeHtml(trailing) });
  };

  for (const piece of s.split(/(<[^<>]*>)/)) {
    if (!piece) continue;
    const tag = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)\b([^>]*)>$/.exec(piece);
    if (ref) {
      if (!tag) ref.text += piece;
      else if (tag[2].toLowerCase() === 'ref') {
        if (!tag[1]) ref.depth++;
        else if (--ref.depth === 0) {
          flushRef(ref);
          ref = null;
        }
      } else if (/^(?:br|lb)$/i.test(tag[2])) ref.text += ' ';
      continue;
    }
    if (!tag) {
      pushText(piece);
      continue;
    }
    const closing = tag[1] === '/';
    switch (tag[2].toLowerCase()) {
      case 'br':
      case 'lb':
        nodes.push({ k: 'br' });
        break;
      case 'b':
      case 'strong':
        nodes.push(closing ? { k: 'close', tag: 'b' } : { k: 'open', tag: 'b' });
        break;
      case 'i':
      case 'em':
      case 'def':
        nodes.push(closing ? { k: 'close', tag: 'i' } : { k: 'open', tag: 'i' });
        break;
      case 're':
        if (!closing) nodes.push({ k: 'br' });
        break;
      case 'ref':
        if (!closing) {
          const am = /^\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+))/.exec(tag[3]);
          ref = { attr: am ? (am[1] ?? am[2] ?? am[3] ?? '') : '', depth: 1, text: '' };
        }
        break;
      default:
        // Unknown element: drop the tag, keep its text (escaped later).
        break;
    }
  }
  if (ref) pushText(ref.text);

  // Render with balanced <b>/<i>.
  const out: string[] = [];
  const stack: ('b' | 'i')[] = [];
  for (const n of nodes) {
    if (n.k === 'text') out.push(escapeHtml(n.s));
    else if (n.k === 'html') out.push(n.s);
    else if (n.k === 'br') out.push('<br>');
    else if (n.k === 'open') {
      stack.push(n.tag);
      out.push(`<${n.tag}>`);
    } else {
      const at = stack.lastIndexOf(n.tag);
      if (at < 0) continue;
      const reopen = stack.splice(at);
      reopen.reverse().forEach((t) => out.push(`</${t}>`));
      reopen.reverse().slice(1).forEach((t) => {
        stack.push(t);
        out.push(`<${t}>`);
      });
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);

  let html = out.join('').normalize('NFC').replace(/\s+/g, ' ');
  html = html
    .replace(/<\/span>\*/g, '</span>')
    .replace(/<(b|i)>\s*<\/\1>/g, ' ')
    .replace(/<(b|i)>\s*<\/\1>/g, ' ')
    .replace(/\(\s*[,;]?\s*\)/g, '')
    .replace(/\[\s*[,;]?\s*\]/g, '')
    .replace(/ +([,;])(?=\s|<|$)/g, '$1')
    .replace(/ +\.(?=\s*(?:<br>|$))/g, '.')
    .replace(/((?<!&(?:amp|lt|gt))[,;])(?:\s*[,;])+/g, '$1')
    // (?<!&…) keeps the ";" that ends an entity we produced ("&gt;").
    .replace(/(?<!&(?:amp|lt|gt))[.,;]\s*\.(?=\s*(?:<br>|$))/g, '.')
    // Dangling ", etc" / "," left at a line end by removed citations.
    .replace(/,\s*(?:etc\b\.?)?\s*(?=<br>|$)/g, '')
    .replace(/(?<!&(?:amp|lt|gt));\s*etc\b\.?\s*(?=<br>|$)/g, '')
    .replace(/\s*<br>\s*/g, '<br>')
    .replace(/(?:<br>)+/g, '<br>')
    .replace(/^(?:\s|<br>)+|(?:\s|<br>)+$/g, '')
    .replace(/ {2,}/g, ' ');
  return html.trim();
}

/** True if `html` uses only the tags the app allows in LexEntry.def (used by tests and as a build check). */
export function isSafeDefHtml(html: string): boolean {
  for (const m of html.matchAll(/<[^>]*>/g)) {
    const t = m[0];
    if (!/^<(?:\/?b|\/?i|br|\/span|span class="ref" data-ref="[0-9A-Z]{3}\.\d{1,3}\.\d{1,3}")>$/.test(t)) return false;
  }
  // No stray "<" that is not part of an allowed tag, and every "&" starts an entity we produce.
  if (/<(?![/]?(?:b|i|br|span)\b)/.test(html)) return false;
  return !/&(?!amp;|lt;|gt;)/.test(html);
}

/* ======================================================================== */
/* Hebrew prefix / suffix morphemes (Macula extended ids)                    */
/* ======================================================================== */

export type MorphemeClass =
  | 'conj'
  | 'art'
  | 'interr'
  | 'prep-b'
  | 'prep-k'
  | 'prep-l'
  | 'rel'
  | 'dir-he'
  | 'par-he'
  | 'par-nun'
  | `sfx-${string}`
  | 'other';

/** Hebrew lemmas compared in canonical (NFC) mark order: sources differ in dagesh/vowel order. */
const heb = (...forms: string[]): Set<string> => new Set(forms.map((f) => f.normalize('NFC')));
const LEMMA = {
  conj: heb('וְ'),
  art: heb('הַ', 'ה', 'א', 'אָה', 'הּ'),
  interr: heb('הֲ', 'הַ'),
  rel: heb('שֶׁ'),
  b: heb('בְּ'),
  k: heb('כְּ'),
  l: heb('לְ'),
};

/** Classify one Macula Hebrew row (pos / type / lemma / morph) as a function morpheme, or 'other'. */
export function classifyMorpheme(row: { pos: string; type: string; lemma: string; morph: string }): MorphemeClass {
  const { pos, type, morph } = row;
  const lemma = row.lemma.normalize('NFC');
  if (pos === 'suffix') {
    if (type === 'pronominal') {
      const m = /^S[ph]?([123])([mfcb])([sp])$/.exec(morph);
      return m ? `sfx-${m[1]}${m[2] === 'b' ? 'c' : m[2]}${m[3]}` : 'other';
    }
    if (type === 'directional he') return 'dir-he';
    if (type === 'paragogic he') return 'par-he';
    if (type === 'paragogic nun') return 'par-nun';
    return 'other';
  }
  if (pos === 'conjunction' && LEMMA.conj.has(lemma)) return 'conj';
  if (pos === 'particle' && type === 'definite article' && LEMMA.art.has(lemma)) return 'art';
  if (pos === 'particle' && type === 'interrogative' && LEMMA.interr.has(lemma)) return 'interr';
  if (pos === 'particle' && type === 'relative' && LEMMA.rel.has(lemma)) return 'rel';
  // Prefixed prepositions (also tagged as conjunctions, e.g. כְּ "as/when", or Aramaic object-marking לְ).
  if (pos === 'preposition' || pos === 'conjunction' || (pos === 'particle' && type === 'direct object marker')) {
    if (LEMMA.b.has(lemma)) return 'prep-b';
    if (LEMMA.k.has(lemma)) return 'prep-k';
    if (LEMMA.l.has(lemma)) return 'prep-l';
  }
  return 'other';
}

interface MorphemeTemplate {
  lemma: string;
  translit: string;
  pos: string;
  gloss: string;
  def: string;
}

const PGN_WORDS: Record<string, string> = {
  '1cs': '1st person singular',
  '1cp': '1st person plural',
  '2ms': '2nd person masculine singular',
  '2fs': '2nd person feminine singular',
  '2cs': '2nd person singular',
  '2mp': '2nd person masculine plural',
  '2fp': '2nd person feminine plural',
  '2cp': '2nd person plural',
  '3ms': '3rd person masculine singular',
  '3fs': '3rd person feminine singular',
  '3cs': '3rd person singular',
  '3mp': '3rd person masculine plural',
  '3fp': '3rd person feminine plural',
  '3cp': '3rd person plural',
};

/** [possessive gloss, object gloss, Hebrew form(s), translit, Aramaic form(s), Aramaic translit] per person/gender/number. */
const SUFFIX_FORMS: Record<string, [string, string, string, string, string, string]> = {
  '1cs': ['my', 'me', '־ִי, ־נִי', '-i, -ni', '־ִי, ־נִי', '-i, -ni'],
  '1cp': ['our', 'us', '־נוּ', '-nu', '־נָא', '-na'],
  '2ms': ['your', 'you', '־ךָ', '-kha', '־ךְ', '-akh'],
  '2fs': ['your', 'you', '־ךְ', '-ekh', '־כִי', '-ki'],
  '2cs': ['your', 'you', '־ךָ, ־ךְ', '-kha, -ekh', '־ךְ', '-akh'],
  '2mp': ['your', 'you', '־כֶם', '-khem', '־כוֹן', '-khon'],
  '2fp': ['your', 'you', '־כֶן', '-khen', '־כֵן', '-khen'],
  '2cp': ['your', 'you', '־כֶם', '-khem', '־כוֹן', '-khon'],
  '3ms': ['his, its', 'him, it', '־וֹ, ־הוּ', '-o, -hu', '־הּ, ־וֹהִי', '-eh, -ohi'],
  '3fs': ['her, its', 'her, it', '־הּ, ־הָ', '-ah, -ha', '־הּ', '-ah'],
  '3cs': ['his, her, its', 'him, her, it', '־וֹ, ־הּ', '-o, -ah', '־הּ', '-eh'],
  '3mp': ['their', 'them', '־הֶם, ־ם', '-hem, -m', '־הוֹן', '-hon'],
  '3fp': ['their', 'them', '־הֶן, ־ן', '-hen, -n', '־הֵן', '-hen'],
  '3cp': ['their', 'them', '־הֶם', '-hem', '־הוֹן', '-hon'],
};

/**
 * Short, hand-checked entries for Hebrew/Aramaic function morphemes. `aramaic` selects the Aramaic
 * wording; `alsoPgn` (suffixes only) names a secondary person/gender/number the same id also covers.
 */
export function morphemeEntry(cls: MorphemeClass, aramaic: boolean, alsoPgn?: string): MorphemeTemplate | null {
  const A = aramaic ? ', Aramaic' : '';
  switch (cls) {
    case 'conj':
      return {
        lemma: 'וְ',
        translit: 've',
        pos: `Conjunction (prefix${A})`,
        gloss: 'and',
        def: aramaic
          ? '<b>and, but, then</b>; the Aramaic conjunction <i>ve</i> (וְ, also וּ), written joined to the front of the next word.'
          : '<b>and, but, then, so</b>; also <b>now, while</b>. The conjunction <i>ve</i> (וְ, also pointed וּ, וַ, וָ) is written joined to the front of the next word. It links words and clauses; at the start of a clause it often marks the next step of a narrative ("And he said…") and is frequently left untranslated. Joined to a verb it forms the <i>vav-consecutive</i> (וַיֹּאמֶר "and he said").',
      };
    case 'art':
      return aramaic
        ? {
            lemma: '־אָ',
            translit: '-a',
            pos: 'Article (suffix, Aramaic)',
            gloss: 'the',
            def: '<b>the</b>; the Aramaic definite ("emphatic") ending <i>-a</i>, written א or ה at the end of a noun: מַלְכָּא "the king".',
          }
        : {
            lemma: 'הַ',
            translit: 'ha',
            pos: 'Article (prefix)',
            gloss: 'the',
            def: '<b>the</b>; the definite article <i>ha</i> (הַ, also הָ, הֶ), written as a prefix and usually doubling the next consonant. It can also mark the person addressed ("O king") and, on a participle, mean "the one who…". After the prefixes בְּ, כְּ, לְ its ה drops out and only its vowel remains (בַּ "in the").',
          };
    case 'interr':
      return {
        lemma: 'הֲ',
        translit: 'ha',
        pos: `Particle, interrogative (prefix${A})`,
        gloss: '(question)',
        def: 'Interrogative <i>ha</i> (הֲ, also הַ, הֶ): prefixed to the first word of a question, usually one expecting "yes" or "no" ("Is…?", "Did…?", "Am I…?"). In English it is shown by word order and a question mark rather than by a word.',
      };
    case 'prep-b':
      return {
        lemma: 'בְּ',
        translit: 'be',
        pos: `Preposition (prefix${A})`,
        gloss: 'in, with, by',
        def: '<b>in, at, on, among; with, by means of; against</b>; with an infinitive, <b>when, while</b> ("when he came"). The preposition <i>be</i> (בְּ, also בִּ, בַּ) is written as a prefix; with the article it becomes בַּ "in the".',
      };
    case 'prep-k':
      return {
        lemma: 'כְּ',
        translit: 'ke',
        pos: `Preposition (prefix${A})`,
        gloss: 'like, as',
        def: '<b>like, as; according to; about, approximately</b> (with numbers); with an infinitive, <b>when, as soon as</b>. The preposition <i>ke</i> (כְּ, also כִּ, כַּ) is written as a prefix.',
      };
    case 'prep-l':
      return {
        lemma: 'לְ',
        translit: 'le',
        pos: `Preposition (prefix${A})`,
        gloss: 'to, for',
        def:
          '<b>to, toward; for, on behalf of; belonging to, of</b> ("a psalm of David"); <b>at, in regard to</b>; with an infinitive, <b>to, in order to</b>. It also marks the indirect object' +
          (aramaic ? ' and, in Aramaic, often the direct object' : '') +
          '. The preposition <i>le</i> (לְ, also לִ, לַ) is written as a prefix.',
      };
    case 'rel':
      return {
        lemma: 'שֶׁ',
        translit: 'she',
        pos: 'Particle, relative (prefix)',
        gloss: 'who, which, that',
        def: '<b>who, which, that</b>; the relative particle <i>she</i> (שֶׁ, also שַׁ), written as a prefix: a shorter equivalent of אֲשֶׁר, common in later books such as Ecclesiastes and the Song of Songs.',
      };
    case 'dir-he':
      return {
        lemma: '־ָה',
        translit: '-ah',
        pos: 'Suffix, directional',
        gloss: 'toward',
        def: 'Directional ending <i>-ah</i> (ה ָ, unstressed) added to a noun or place name to show motion <b>toward</b> it: אַרְצָה "to the land", מִצְרַיְמָה "to Egypt".',
      };
    case 'par-he':
      return {
        lemma: '־ָה',
        translit: '-ah',
        pos: 'Suffix, paragogic',
        gloss: '(emphasis)',
        def: 'Paragogic <i>-ah</i> (ה ָ): an extra ending on some verbs, especially first-person cohortatives ("let me…", "let us…") and imperatives, expressing resolve, a wish or emphasis. Not translated by a separate word.',
      };
    case 'par-nun':
      return {
        lemma: '־ן',
        translit: '-n',
        pos: 'Suffix, paragogic',
        gloss: '(emphasis)',
        def: 'Paragogic <i>nun</i> (ן): an extra <i>-n</i> on some imperfect verb forms (-ûn, -în), adding emphasis or a fuller style. Not translated by a separate word.',
      };
    default: {
      const pgn = /^sfx-(\w+)$/.exec(cls)?.[1];
      const forms = pgn ? SUFFIX_FORMS[pgn] : undefined;
      if (!pgn || !forms) return null;
      const [poss, obj, hForm, hTr, aForm, aTr] = forms;
      let def = `Pronominal suffix, ${PGN_WORDS[pgn]}: <b>${poss}</b> on nouns; <b>${obj}</b> on verbs and prepositions. Written joined to the end of the word (${aramaic ? aForm : hForm}).`;
      const also = alsoPgn && SUFFIX_FORMS[alsoPgn];
      if (alsoPgn && also) def += ` The same tag also covers the ${PGN_WORDS[alsoPgn]} (<b>${also[0]}, ${also[1]}</b>).`;
      const glossWords = [...new Set([...poss.split(', '), ...obj.split(', ')])].join(', ');
      return {
        lemma: aramaic ? aForm : hForm,
        translit: aramaic ? aTr : hTr,
        pos: `Suffix, pronominal (${PGN_WORDS[pgn]}${A})`,
        gloss: glossWords,
        def,
      };
    }
  }
}

export interface MorphemeUse {
  cls: MorphemeClass;
  aramaic: boolean;
  /** Secondary person/gender/number (suffix ids that cover two forms). */
  alsoPgn?: string;
  count: number;
  total: number;
}

/**
 * Decide which Macula ids are function morphemes: an id qualifies when at least 60% of its uses fall
 * in one morpheme class. Input rows: Macula strongnumberx (may contain "a|b"), lang, pos, type, lemma, morph.
 */
export function findMorphemeIds(
  rows: Iterable<{ strong: string; lang: string; pos: string; type: string; lemma: string; morph: string }>,
): Map<string, MorphemeUse> {
  const stats = new Map<string, { total: number; cls: Map<string, number>; aram: number }>();
  for (const r of rows) {
    if (!r.strong) continue;
    const cls = classifyMorpheme(r);
    for (const raw of r.strong.split('|')) {
      const id = normStrongs('H', raw);
      if (!id) continue;
      let st = stats.get(id);
      if (!st) stats.set(id, (st = { total: 0, cls: new Map(), aram: 0 }));
      st.total++;
      st.cls.set(cls, (st.cls.get(cls) ?? 0) + 1);
      if (r.lang === 'A') st.aram++;
    }
  }
  const out = new Map<string, MorphemeUse>();
  for (const [id, st] of stats) {
    const ranked = [...st.cls].sort((a, b) => b[1] - a[1]);
    const [cls, count] = ranked[0];
    if (cls === 'other' || count / st.total < 0.6) continue;
    const use: MorphemeUse = { cls: cls as MorphemeClass, aramaic: st.aram * 2 > st.total, count, total: st.total };
    const second = ranked[1];
    if (cls.startsWith('sfx-') && second && second[0].startsWith('sfx-') && second[1] / st.total >= 0.1) use.alsoPgn = second[0].slice(4);
    out.set(id, use);
  }
  return out;
}

/* ======================================================================== */
/* Entry assembly                                                            */
/* ======================================================================== */

const REL_SCORE = (rel: string): number => {
  const r = rel.toLowerCase();
  if (!r) return 3;
  if (/name of|greek of|aramaic of|in aramaic/.test(r)) return 2;
  if (/meaning of/.test(r)) return 1;
  return 0;
};

/** Primary row of a STEP id: a plain dStrong beats "a Name of" beats "a Meaning of" beats "a Part of"; then the fuller definition. */
export function pickPrimary(rows: StepRow[]): StepRow {
  let best = rows[0];
  for (const r of rows.slice(1)) {
    const d = REL_SCORE(r.rel) - REL_SCORE(best.rel);
    if (d > 0 || (d === 0 && r.def.length > best.def.length * 1.2)) best = r;
  }
  return best;
}

function cleanLemma(lemma: string, lang: Lang): string {
  const l = squash(lemma.replace(/\//g, '')).normalize('NFC');
  return lang === 'H' ? stripCantillation(l) : l;
}

/** STEP Hebrew transliterations mark syllables with dots ("e.lo.him"); drop them. */
function cleanTranslit(t: string, lang: Lang): string {
  return lang === 'H' ? squash(t.replace(/\./g, '')) : squash(t);
}

function strongsTranslit(s: StrongsRaw | undefined): string {
  return squash(s?.translit ?? s?.xlit ?? '');
}

/** Gloss from Strong's when STEP has none: first item of the KJV rendering list. */
function strongsGloss(s: StrongsRaw): string {
  const first = (s.kjv_def ?? s.strongs_def ?? '').split(/[,;]/)[0] ?? '';
  return squash(first.replace(/\[[^\]]*\]|[()+×X]/g, ' ')).replace(/\.$/, '');
}

/** Lemma of the first bold head word of a raw STEP definition ("<b>αὐτός</b>, -ή, -ό" -> "αὐτός"). */
function defHeadLemma(raw: string): string {
  return plainOf(/<b>([^<]*)<\/b>/i.exec(raw)?.[1] ?? '').trim();
}

/**
 * Build an entry from all STEP rows of one eStrong id. `lookup` finds another STEP id's primary row
 * (for "a Form of X" rows, which get a "Form of X" note, and X's definition when STEP's own
 * definition is evidently for a different word, e.g. G5209 ὑμᾶς carrying αὐτός).
 */
function entryFromStep(
  id: string,
  rows: StepRow[],
  lang: Lang,
  strongs?: StrongsRaw,
  lookup?: (uid: string) => StepRow | undefined,
): LexEntry {
  const primary = pickPrimary(rows);
  let def = sanitizeStepDef(primary.def, lang);
  let pos = decodeStepMorph(primary.morph, lang);
  const target = /form of/i.test(primary.rel) && primary.uid ? lookup?.(normStrongs(lang, primary.uid)) : undefined;
  if (target) {
    const head = lemmaKey(defHeadLemma(primary.def), lang);
    if (head && head !== lemmaKey(primary.lemma, lang) && head !== lemmaKey(target.lemma, lang)) {
      def = sanitizeStepDef(target.def, lang);
    }
    const tl = cleanLemma(target.lemma, lang);
    def = `<i>Form of</i> ${escapeHtml(tl)} (${escapeHtml(normStrongs(lang, primary.uid))})${def ? `<br>${def}` : ''}`;
    pos ||= decodeStepMorph(target.morph, lang);
  }
  const others = [
    ...new Set(rows.filter((r) => r !== primary).map((r) => r.gloss).filter((g) => g && g !== primary.gloss)),
  ];
  if (others.length) def += `${def ? '<br>' : ''}<i>Other uses:</i> ${escapeHtml(others.join('; '))}`;
  const e: LexEntry = {
    id,
    lemma: cleanLemma(primary.lemma, lang) || cleanLemma(strongs?.lemma ?? '', lang),
    translit: cleanTranslit(primary.translit, lang) || strongsTranslit(strongs),
    pos,
    gloss: primary.gloss || (strongs ? strongsGloss(strongs) : ''),
    def,
  };
  if (strongs) Object.assign(e, strongsFields(strongs));
  if (!e.def && e.strongsDef) {
    e.def = escapeHtml(e.strongsDef);
    delete e.strongsDef;
  }
  return e;
}

function entryFromStrongs(id: string, s: StrongsRaw, lang: Lang): LexEntry {
  const f = strongsFields(s);
  const e: LexEntry = {
    id,
    lemma: cleanLemma(s.lemma ?? '', lang),
    translit: strongsTranslit(s),
    pos: '',
    gloss: strongsGloss(s),
    def: escapeHtml(f.strongsDef ?? ''),
    ...f,
  };
  delete e.strongsDef; // already shown as `def`
  return e;
}

export interface LexBuild {
  /** Every key -> entry (aliases share the canonical entry object). */
  entries: Map<string, LexEntry>;
  /** Keys whose entry is their own (not a base-id alias). */
  canonical: Set<string>;
  stats: Record<string, number>;
}

interface Sources {
  stepG: StepRow[];
  stepH: StepRow[];
  strongsG: Record<string, StrongsRaw>;
  strongsH: Record<string, StrongsRaw>;
  /** Morpheme classification of Macula Hebrew ids. */
  morphemes: Map<string, MorphemeUse>;
  /** SBLGNT strongs -> lemma (first seen), for extended Greek ids absent from STEP. */
  greekLemmas: Map<string, string>;
  /** Every id in Macula's strongnumberx column (what the orig stage stores for OT words). */
  maculaIds?: Set<string>;
}

function groupBy(rows: StepRow[]): Map<string, StepRow[]> {
  const m = new Map<string, StepRow[]>();
  for (const r of rows) {
    const a = m.get(r.eid);
    if (a) a.push(r);
    else m.set(r.eid, [r]);
  }
  return m;
}

/** Strong's number of an id: "H1121a" -> 1121, "G20001" -> 20001. */
const numOf = (id: string): number => Number(/^[GH](\d+)/.exec(id)?.[1] ?? NaN);

/** Pure assembly of all entries from parsed sources (no I/O). */
export function assembleLexicon(src: Sources): LexBuild {
  const entries = new Map<string, LexEntry>();
  const canonical = new Set<string>();
  const stats: Record<string, number> = {};
  const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

  for (const lang of ['G', 'H'] as const) {
    const groups = groupBy(lang === 'G' ? src.stepG : src.stepH);
    const strongs = lang === 'G' ? src.strongsG : src.strongsH;
    const max = MAX_STRONGS[lang];
    const strongsOf = (base: string): StrongsRaw | undefined => strongs[`${lang}${Number(base.slice(1, 5))}`];
    const lookup = (uid: string): StepRow | undefined => {
      const g = groups.get(uid) ?? groups.get(`${uid}a`);
      return g && pickPrimary(g);
    };

    // Macula prefix/suffix ids (Hebrew only). Plain Strong's numbers are shared with the KJV and are
    // never taken over; a lettered STEP id that Macula uses for a morpheme (H3641b: STEP "Calneh",
    // Macula the 2nd-person-plural suffix) follows Macula, the source of every OT word in the app.
    const morphemes = new Map<string, MorphemeTemplate>();
    if (lang === 'H') {
      for (const [id, use] of src.morphemes) {
        if (!/^H\d{4}[a-z]$/.test(id)) continue;
        const t = morphemeEntry(use.cls, use.aramaic, use.alsoPgn);
        if (t) morphemes.set(id, t);
      }
    }

    // Lettered and plain STEP ids within the classic range, grouped by base number.
    const byBase = new Map<string, string[]>();
    for (const eid of groups.keys()) {
      const n = numOf(eid);
      if (!(n >= 1 && n <= max) || !/^[GH]\d{4}[A-Za-z]?$/.test(eid)) continue;
      if (morphemes.has(eid)) {
        bump(`${lang}.morphemeOverride`);
        continue;
      }
      const base = baseStrongs(eid);
      const list = byBase.get(base);
      if (list) list.push(eid);
      else byBase.set(base, [eid]);
    }

    for (const [base, ids] of byBase) {
      const s = strongsOf(base);
      const sKey = s?.lemma ? lemmaKey(s.lemma, lang) : '';
      // Representative variant for the base id.
      let rep = ids.includes(base) ? base : '';
      if (!rep) {
        const score = (eid: string) => {
          const p = pickPrimary(groups.get(eid)!);
          return (sKey && lemmaKey(p.lemma, lang) === sKey ? 2 : 0) + (p.morph.startsWith('N:') ? 0 : 1);
        };
        rep = ids.reduce((best, eid) => (score(eid) > score(best) ? eid : best), ids[0]);
      }
      for (const eid of ids) {
        const rows = groups.get(eid)!;
        const sameWord = eid === rep || (!!sKey && rows.some((r) => lemmaKey(r.lemma, lang) === sKey));
        entries.set(eid, entryFromStep(eid, rows, lang, sameWord ? s : undefined, lookup));
        canonical.add(eid);
        bump(`${lang}.step`);
      }
      if (rep !== base) {
        entries.set(base, entries.get(rep)!);
        bump(`${lang}.alias`);
      }
    }

    // Every classic Strong's number gets at least a Strong's-based entry.
    for (let n = 1; n <= max; n++) {
      const id = `${lang}${String(n).padStart(4, '0')}`;
      if (entries.has(id)) continue;
      const s = strongs[`${lang}${n}`];
      if (!s) {
        bump(`${lang}.noSource`);
        continue;
      }
      entries.set(id, entryFromStrongs(id, s, lang));
      canonical.add(id);
      bump(`${lang}.strongsOnly`);
    }

    if (lang === 'G') {
      // Extended SBLGNT ids missing from STEP's eStrong set (e.g. G4053b ἐκπερισσῶς): reuse the STEP
      // entry (often in its extra G6000+ range) whose lemma matches.
      const byLemma = new Map<string, string>();
      for (const [eid, rows] of groups) {
        const k = greekFold(pickPrimary(rows).lemma);
        if (k && !byLemma.has(k)) byLemma.set(k, eid);
      }
      for (const [id, lemma] of src.greekLemmas) {
        if (entries.has(id) || !/^G\d{4}[a-z]$/.test(id)) continue;
        const match = byLemma.get(greekFold(lemma));
        if (!match) continue;
        entries.set(id, entryFromStep(id, groups.get(match)!, 'G', undefined, lookup));
        canonical.add(id);
        bump('G.extended');
      }
    }
    for (const [id, t] of morphemes) {
      entries.set(id, { id, ...t });
      canonical.add(id);
      bump(`${lang}.morpheme`);
      // Keep the base-id invariant (never needed in practice: every H0001–H8674 already exists).
      if (!entries.has(baseStrongs(id))) entries.set(baseStrongs(id), entries.get(id)!);
    }
  }
  return { entries, canonical, stats };
}

/* ======================================================================== */
/* I/O                                                                       */
/* ======================================================================== */

/** Read selected columns of a header-row TSV from .cache/sources (no full-row objects for wide files). */
function readColumns<K extends string>(name: string, cols: readonly K[]): Record<K, string>[] {
  const lines = readFileSync(srcPath(name), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = lines[0].split('\t');
  const idx = cols.map((c) => {
    const i = header.indexOf(c);
    if (i < 0) throw new Error(`${name}: missing column ${c}`);
    return i;
  });
  const rows: Record<K, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split('\t');
    const row = {} as Record<K, string>;
    cols.forEach((c, j) => (row[c] = cells[idx[j]] ?? ''));
    rows.push(row);
  }
  return rows;
}

function loadSources(): Sources {
  const read = (n: string) => readFileSync(srcPath(n), 'utf8');
  const macula = readColumns('macula-hebrew.tsv', ['strongnumberx', 'lang', 'pos', 'type', 'lemma', 'morph'] as const);
  const morphemes = findMorphemeIds(
    macula.map((r) => ({ strong: r.strongnumberx, lang: r.lang, pos: r.pos, type: r.type, lemma: r.lemma, morph: r.morph })),
  );
  const maculaIds = new Set<string>();
  for (const r of macula) for (const part of r.strongnumberx.split('|')) if (normStrongs('H', part)) maculaIds.add(normStrongs('H', part));
  const greekLemmas = new Map<string, string>();
  for (const r of readColumns('SBLGNT.tsv', ['strongs', 'lemma'] as const)) {
    const id = normStrongs('G', r.strongs);
    if (id && !greekLemmas.has(id)) greekLemmas.set(id, r.lemma);
  }
  return {
    stepG: parseStepLexicon(read('TBESG.txt'), 'G'),
    stepH: parseStepLexicon(read('TBESH.txt'), 'H'),
    strongsG: parseStrongsJs(read('strongs-greek.js')),
    strongsH: parseStrongsJs(read('strongs-hebrew.js')),
    morphemes,
    greekLemmas,
    maculaIds,
  };
}

/** Ids used by the original-language texts (SBLGNT.tsv, WLCM.tsv), normalised like the orig stage does. */
function usedIds(): { G: Set<string>; H: Set<string> } {
  const G = new Set<string>();
  const H = new Set<string>();
  for (const r of readColumns('SBLGNT.tsv', ['strongs'] as const)) {
    const id = normStrongs('G', r.strongs);
    if (id) G.add(id);
  }
  for (const r of readColumns('WLCM.tsv', ['strongs'] as const)) {
    for (const part of r.strongs.split('|')) {
      const id = normStrongs('H', part);
      if (id) H.add(id);
    }
  }
  return { G, H };
}

export function buildLexicon(): void {
  const src = loadSources();
  const { entries, canonical, stats } = assembleLexicon(src);

  // Safety net: every definition must be in the allowed HTML subset.
  for (const e of entries.values()) {
    if (!isSafeDefHtml(e.def)) throw new Error(`Unsafe definition HTML in ${e.id}: ${e.def.slice(0, 200)}`);
  }

  cleanOut('lex');
  const chunks = new Map<string, LexChunk>();
  const keys = [...entries.keys()].sort();
  for (const key of keys) {
    const name = `${key[0]}/${chunkOf(key)}`;
    let c = chunks.get(name);
    if (!c) chunks.set(name, (c = {}));
    c[key] = entries.get(key)!;
  }
  let bytes = 0;
  for (const [name, chunk] of chunks) {
    const [dir, file] = name.split('/');
    const path = outPath('lex', dir, `${file}.json`);
    writeJson(path, chunk);
    bytes += statSync(path).size;
  }
  const index: LexIndex = keys
    .filter((k) => canonical.has(k))
    .map((k) => {
      const e = entries.get(k)!;
      return [k, e.lemma, e.translit, e.gloss];
    });
  writeJson(outPath('lex', 'index.json'), index);
  const indexBytes = statSync(outPath('lex', 'index.json')).size;

  // Coverage of the ids the texts actually use.
  const used = usedIds();
  for (const id of src.maculaIds ?? []) used.H.add(id);
  const missing: string[] = [];
  let exact = 0;
  let viaBase = 0;
  for (const id of [...used.G, ...used.H]) {
    if (entries.has(id)) exact++;
    else if (entries.has(baseStrongs(id))) viaBase++;
    else missing.push(id);
  }
  let classic = 0;
  for (const p of ['G', 'H'] as const)
    for (let n = 1; n <= MAX_STRONGS[p]; n++) if (entries.has(`${p}${String(n).padStart(4, '0')}`)) classic++;

  log(
    STAGE,
    `${entries.size} keys (${canonical.size} entries, ${index.length} index rows) in ${chunks.size} chunks, ` +
      `${(bytes / 1e6).toFixed(1)} MB + index ${(indexBytes / 1e6).toFixed(2)} MB; ` +
      `text ids ${used.G.size + used.H.size}: ${exact} exact, ${viaBase} via base, ${missing.length} missing` +
      `${missing.length ? ` (${missing.slice(0, 10).join(', ')})` : ''}; classic ${classic}/${MAX_STRONGS.G + MAX_STRONGS.H}; ` +
      Object.entries(stats)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
  );
}
