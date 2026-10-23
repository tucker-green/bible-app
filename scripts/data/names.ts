/**
 * Stage "names": people, places and other proper names from STEPBible's TIPNR
 * (Translators Individualised Proper Names with all References, CC BY 4.0).
 *
 * Reads  .cache/sources/TIPNR.txt, the orig stage's  public/data/orig/{BOOK}/{C}.json  and, when present,
 *        public/data/text/{BSB,KJV}/{BOOK}/{C}.json  (only their capitalisation, to tell a common noun used
 *        as a name from the same noun used plainly in one verse), so it runs after orig, bsb and kjv.
 * Writes public/data/names/
 *   entities/{p|l|g}/{NNN}.json   NameEntityChunk (p = person, l = place, g = group / other)
 *   chapters/{BOOK}/{C}.json      NameChapter: orig word index -> entity id (which person/place a word is)
 *   family.json                   FamilyGraph (people only)
 *   index.json                    NameIndex (every entity, for search / autocomplete)
 *
 * TIPNR layout (see the header of the file): records start with a "$========== KIND" line, where KIND
 * is PERSON(s), PLACE, PLACE+PERSON, OTHER or EXCLUDED OTHER (the last is skipped, as STEPBible does).
 * The next line is the record header (tab separated):
 *   people:  UniqueName=uStrong, description, parents "Father + Mother", siblings, partners, offspring,
 *            tribe, #summary HTML, type (Male / Female / Group)
 *   places:  UniqueName=uStrong, OpenBible name, founder, inhabitants, Google Maps URL (…/@lat,long,14z),
 *            palopenmaps URL, region, #summary HTML, "Place"
 *   other:   UniqueName=uStrong, description, …, #summary HTML, type (Supernatural, Time, Group…)
 * followed by sub-lines "– Named / Greek / Spelled / Name combined / Mentioned / … / Total" with
 *   [significance, AltName|UniqueName, dStrong«eStrong=form(+dStrong«eStrong=form…), English name(s), refs]
 * and "@Briefest= / @Brief= / @Short= / @Article= / @Ambiguity=" lines. A line that is just "$" ends the data.
 *
 * References use English versification (verified: Mal.4.5, Jol.2.32, Gen.31.55a/b and Psalm titles as
 * verse 0 all occur), so they are matched directly against OrigWord[OW.verse]. "Gen.17.23b" = the 2nd
 * word in Gen 17:23 carrying that (base) Strong's number.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { BookInfo } from '../../src/lib/books';
import type {
  EntityKind,
  FamilyGraph,
  NameChapter,
  NameEntity,
  NameEntityChunk,
  NameIndex,
  OrigChapter,
  TextChapter,
} from '../../src/lib/types';
import { OW, packRef } from '../../src/lib/types';
import { BOOKS, baseStrongs, cleanOut, log, normStrongs, outPath, srcPath, writeJson } from './common';
import { escapeHtml, greekFold, hebrewSkeleton, isSafeDefHtml, sanitizeStepDef, stripCantillation } from './lexicon';

const STAGE = 'names';

/** Put STEPBible's @Article (adapted AI-written prose, CC BY 4.0) after the factual summary. */
const INCLUDE_ARTICLE = true;

/* ======================================================================== */
/* TIPNR parsing                                                             */
/* ======================================================================== */

export type TipnrSection = 'PERSON' | 'PLACE' | 'PLACE+PERSON' | 'OTHER';

/** One component of a (possibly combined) name form: "H0410I«H0410=אֵל". */
export interface TipnrStrong {
  /** Disambiguated Strong's (STEP dStrong), normalised: "H8646G". */
  dStrong: string;
  /** Extended Strong's (eStrong), normalised: "H3667a"; "" when not given. */
  eStrong: string;
  /** Hebrew / Greek form ("" for "Mentioned" individuals). */
  form: string;
}

export interface TipnrSub {
  /** "Named", "Greek", "Spelled", "Name combined", "Mentioned", "(same form with Variant)", … */
  kind: string;
  /** "Abram|Abraham@Gen.11.26-1Pe" */
  uniqueName: string;
  strongs: TipnrStrong[];
  /** Translated name column, e.g. "Abiah =KJV; his father =ESV; Abijah =NIV". */
  english: string;
  /** Raw reference list. */
  refs: string;
}

export interface TipnrRecord {
  section: TipnrSection;
  /** "Abraham@Gen.11.26-1Pe" */
  uniqueName: string;
  /** "H0085" */
  uStrong: string;
  /** Header fields after "UniqueName=uStrong" (index 0 = description / OpenBible name …). */
  fields: string[];
  subs: TipnrSub[];
  briefest: string;
  brief: string;
  short: string;
  article: string;
  /** 1-based line number of the header line (for messages). */
  line: number;
}

const SECTION_RE = /^\$=+\s*(PERSON\(s\)|PLACE\+PERSON|PLACE|EXCLUDED OTHER|OTHER)\s*$/;

/** Parse one "dStrong«eStrong=form" component (also "H8010H=." and "H0410G«H0410=אֵל=God"). */
export function parseStrongPart(part: string): TipnrStrong | null {
  const m = /^\s*([GH]\d{1,4}[A-Za-z]?)(?:«([GH]\d{1,4}[A-Za-z]?))?\s*=?\s*([^=]*)/.exec(part);
  if (!m) return null;
  const lang = m[1][0] as 'G' | 'H';
  const dStrong = normStrongs(lang, m[1]);
  if (!dStrong) return null;
  const eStrong = m[2] ? normStrongs(m[2][0] as 'G' | 'H', m[2]) : '';
  const form = m[3].trim();
  return { dStrong, eStrong, form: form === '.' ? '' : form };
}

/**
 * Split TIPNR.txt into records. Lines before the first real "$========== " record (the field
 * descriptions, whose template records have no space after the "=" run) and everything after the
 * terminating "$" line (change notes, private working notes) are ignored.
 */
export function parseTipnr(text: string): TipnrRecord[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const records: TipnrRecord[] = [];
  let cur: TipnrRecord | null = null;
  let skipping = true; // inside header / EXCLUDED records
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\t+$/, '');
    if (raw === '$' && started) break;
    const sec = SECTION_RE.exec(raw);
    if (sec && /^\$=+ /.test(raw)) {
      started = true;
      cur = null;
      const kind = sec[1] === 'PERSON(s)' ? 'PERSON' : sec[1];
      if (kind === 'EXCLUDED OTHER') {
        skipping = true;
        continue;
      }
      skipping = false;
      const header = (lines[++i] ?? '').replace(/\t+$/, '');
      const cells = header.split('\t');
      const hm = /^([^=\t]+)=([GH]\d{1,4}[A-Za-z]?)\s*$/.exec(cells[0].trim());
      if (!hm) throw new Error(`TIPNR line ${i + 1}: bad record header "${cells[0].slice(0, 60)}"`);
      const lang = hm[2][0] as 'G' | 'H';
      cur = {
        section: kind as TipnrSection,
        uniqueName: hm[1].trim(),
        uStrong: normStrongs(lang, hm[2]),
        fields: cells.slice(1).map((c) => c.trim()),
        subs: [],
        briefest: '',
        brief: '',
        short: '',
        article: '',
        line: i + 1,
      };
      records.push(cur);
      continue;
    }
    if (!started || skipping || !cur) continue;
    if (raw.startsWith('– ')) {
      const cells = raw.split('\t');
      const kind = cells[0].slice(2).trim();
      if (kind === 'Total') continue; // abbreviated ("ff") summary of the lines above
      const strongs = (cells[2] ?? '')
        .split('+')
        .map(parseStrongPart)
        .filter((s): s is TipnrStrong => !!s);
      cur.subs.push({
        kind,
        uniqueName: (cells[1] ?? '').trim(),
        strongs,
        english: (cells[3] ?? '').trim(),
        refs: (cells[4] ?? '').trim(),
      });
      continue;
    }
    const at = /^@(Briefest|Brief|Short|Article)=\s*(.*)$/.exec(raw);
    if (at) {
      const v = at[2].replace(/\t[\s\S]*$/, '').trim();
      if (at[1] === 'Briefest') cur.briefest = v;
      else if (at[1] === 'Brief') cur.brief = v;
      else if (at[1] === 'Short') cur.short = v;
      else cur.article = v;
    }
  }
  return records;
}

/* ======================================================================== */
/* References                                                                */
/* ======================================================================== */

/** STEPBible book abbreviations (as used by TIPNR) -> book. */
const STEP_ABBR = [
  'Gen', 'Exo', 'Lev', 'Num', 'Deu', 'Jos', 'Jdg', 'Rut', '1Sa', '2Sa', '1Ki', '2Ki', '1Ch', '2Ch', 'Ezr', 'Neh',
  'Est', 'Job', 'Psa', 'Pro', 'Ecc', 'Sng', 'Isa', 'Jer', 'Lam', 'Ezk', 'Dan', 'Hos', 'Jol', 'Amo', 'Oba', 'Jon',
  'Mic', 'Nam', 'Hab', 'Zep', 'Hag', 'Zec', 'Mal', 'Mat', 'Mrk', 'Luk', 'Jhn', 'Act', 'Rom', '1Co', '2Co', 'Gal',
  'Eph', 'Php', 'Col', '1Th', '2Th', '1Ti', '2Ti', 'Tit', 'Phm', 'Heb', 'Jas', '1Pe', '2Pe', '1Jn', '2Jn', '3Jn',
  'Jud', 'Rev',
];
const STEP_BOOK = new Map<string, BookInfo>(STEP_ABBR.map((a, i) => [a, BOOKS[i]]));

export function stepBook(abbr: string): BookInfo | undefined {
  return STEP_BOOK.get(abbr);
}

export interface TipnrRef {
  book: BookInfo;
  chapter: number;
  /** English verse; 0 = Psalm title. */
  verse: number;
  /** Occurrence of the Strong's number in the verse: 1 for "a", 2 for "b"…; 0 when not given. */
  occ: number;
}

/**
 * Parse a TIPNR reference list: "Gen.17.23a; Gen.17.23b; Exo.1.13, Exo.1.19; Num.13.8,16".
 * "LXX.…" references (names found only in the Septuagint) and "etc" are skipped; a bare verse
 * ("16") or chapter.verse ("7.11") continues the previous book / chapter.
 */
export function parseTipnrRefs(list: string): { refs: TipnrRef[]; etc: boolean; bad: string[] } {
  const refs: TipnrRef[] = [];
  const bad: string[] = [];
  let etc = false;
  let book: BookInfo | undefined;
  let chapter = 0;
  for (let tok of list.split(/[;,]/)) {
    tok = tok.trim();
    if (!tok) continue;
    if (/^etc\.?$/i.test(tok)) {
      etc = true;
      continue;
    }
    if (/^LXX\b/i.test(tok)) continue;
    let m = /^([1-3]?[A-Z][a-z]{1,2})\.(\d+)\.(\d+)([a-z]?)$/.exec(tok);
    if (m) {
      book = stepBook(m[1]);
      if (!book) {
        bad.push(tok);
        continue;
      }
      chapter = +m[2];
      refs.push({ book, chapter, verse: +m[3], occ: occOf(m[4]) });
      continue;
    }
    m = /^(?:(\d+)\.)?(\d+)([a-z]?)$/.exec(tok);
    if (m && book && chapter) {
      if (m[1]) chapter = +m[1];
      refs.push({ book, chapter, verse: +m[2], occ: occOf(m[3]) });
      continue;
    }
    bad.push(tok);
  }
  return { refs, etc, bad };
}

function occOf(letter: string): number {
  return letter ? letter.charCodeAt(0) - 96 : 0;
}

/* ======================================================================== */
/* Field helpers                                                             */
/* ======================================================================== */

/** A family / founder link: "Canaan@Gen.9.18-1Ch(d)" -> { name: "Canaan@Gen.9.18-1Ch", flag: "d" }. */
export interface TipnrLink {
  name: string;
  /** "?" uncertain, "a" ancestor rather than parent, "d" group descended from, "f" founder. */
  flag: string;
}

/** Split a link list ("A@x, B@y(?)" or "Father@x + Mother@y"), dropping empties and ">" placeholders. */
export function parseLinks(field: string | undefined): TipnrLink[] {
  if (!field) return [];
  const out: TipnrLink[] = [];
  for (let part of field.split(/[,+]/)) {
    part = part.trim();
    if (!part || part === '>') continue;
    let flag = '';
    const fm = /\(([a-z?]+)\)\s*$/.exec(part);
    if (fm) {
      flag = fm[1];
      part = part.slice(0, fm.index).trim();
    }
    part = part.replace(/=[GH]\d{1,4}[A-Za-z]?$/, '').trim(); // "Maon@1Ch.2.45=H4584H" (place founders)
    if (part.includes('@')) out.push({ name: part, flag });
  }
  return out;
}

/** "https://www.google.com/maps/@33.545097,36.224661,14z" -> [33.545097, 36.224661]; undefined if none. */
export function parseCoords(...urls: (string | undefined)[]): [number, number] | undefined {
  for (const url of urls) {
    // "@lat,long,14z" (Google) or "@lat,long" at the end (palopenmaps); "@0,14z" means unknown.
    const m = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?=,\d+(?:\.\d+)?z|$|[/?#&])/.exec(url ?? '');
    if (!m) continue;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (lat === 0 && lon === 0) continue;
    return [lat, lon];
  }
  return undefined;
}

/**
 * Display name from a unique name: "a_wife_of_Solomon@1Ki.4.11" -> "A wife of Solomon". TIPNR's
 * placeholder ancestors ("Unnamed#3@Mat.1.15", inserted where a genealogy skips generations) -> "Unnamed".
 */
export function displayName(uniqueName: string): string {
  const base = uniqueName
    .split('@')[0]
    .split('|')[0]
    .replace(/^Unnamed#\d+$/, 'Unnamed')
    // A few alternative names are CamelCase: "PharaohNeco", "PottersField", "motherInLaw_of_Peter".
    .replace(/InLaw/g, '-in-law')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base ? base[0].toUpperCase() + base.slice(1) : uniqueName;
}

export interface NameOption {
  /** With the words TIPNR puts in parentheses: "(Mount )Zion" -> "Mount Zion", "Corner (Gate)" -> "Corner Gate". */
  full: string;
  /** Without them (they are not part of this word): "Zion", "Corner". */
  short: string;
  /** How many of the Bibles TIPNR compares (ESV, NIV, KJV) use it: "Jonathan =ESV,NIV,KJV" -> 3. */
  tags: number;
}

/**
 * The renderings in a "Translated name" cell: "Jehonathan; Jonathan =ESV,NIV,KJV",
 * "Abiah =KJV; his father =ESV; Abijah =NIV", "Valley of/ Hamon-gog" ("/" joins the parts of a
 * combined name), "Areli,Arelite" (first spelling only), "[ ]" (not translated: none).
 */
export function nameOptions(cell: string): NameOption[] {
  const tidy = (x: string) =>
    x
      .replace(/\s+/g, ' ')
      .replace(/\s+(?=[-–’'])|(?<=[-–])\s+/g, '')
      .trim()
      .replace(/\s*[:;,.]+$/, '');
  const out: NameOption[] = [];
  for (const seg of cell.split(';')) {
    let text = seg.trim();
    let tags = 0;
    const tm = /=\s*([A-Za-z]+(?:\s*,\s*[A-Za-z]+)*)\s*$/.exec(text);
    if (tm) {
      tags = tm[1].split(',').length;
      text = text.slice(0, tm.index);
    }
    text = text
      .replace(/\[[^\]]*\]/g, ' ') // "[ie re-founder]" remarks; "[ ]" = not translated
      .replace(/,\s*\//g, '/') // "Adami,/ Nekeb"
      .split(',')[0] // "Areli,Arelite"
      .replace(/\/\s*(?=[-–])/g, '') // "Bath/-shua"
      .replace(/\//g, ' '); // "Valley of/ Achor"
    const full = tidy(text.replace(/[()]/g, ''));
    if (!full) continue;
    out.push({ full, short: tidy(text.replace(/\([^)]*\)/g, ' ')) || full, tags });
  }
  return out;
}

/**
 * The English name to show for a form: the capitalised rendering most of the compared Bibles use
 * (first listed on a tie), so "Jehonathan; Jonathan =ESV,NIV,KJV" -> "Jonathan" and
 * "Abiah =KJV; his father =ESV; Abijah =NIV" -> "Abiah". Words in parentheses are dropped
 * ("(Mount )Zion" -> "Zion") unless the result is one of `names` (the entity's own name, e.g.
 * "Corner (Gate)" for the Corner Gate). "" when the cell has no rendering ("[ ]").
 */
export function englishName(cell: string, ...names: string[]): string {
  const opts = nameOptions(cell);
  if (!opts.length) return '';
  const cap = (o: NameOption) => (/^\p{Lu}/u.test(o.short) ? 1 : 0);
  let best = opts[0];
  for (const o of opts.slice(1)) if (cap(o) > cap(best) || (cap(o) === cap(best) && o.tags > best.tags)) best = o;
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}]/gu, '');
  return names.some((n) => n && norm(n) === norm(best.full)) ? best.full : best.short;
}

/** Latin letters that slipped into Greek forms ("Κολaσσαεύς" in TIPNR's Colossae) -> Greek. */
const GREEK_HOMOGLYPHS: Record<string, string> = { a: 'α', o: 'ο', e: 'ε', i: 'ι', u: 'υ', v: 'ν', k: 'κ', x: 'χ', t: 'τ', A: 'Α', O: 'Ο', E: 'Ε' };

export function cleanForm(strong: string, form: string): string {
  const f = stripCantillation(form);
  return strong[0] === 'G' && /[\u0370-\u03FF\u1F00-\u1FFF]/.test(f) ? f.replace(/[A-Za-z]/g, (c) => GREEK_HOMOGLYPHS[c] ?? c) : f;
}

/**
 * Sanitise TIPNR summary / article HTML to the app's subset (<b>, <i>, <br>, ref spans) using the
 * lexicon's STEP sanitiser: <ref="Gen.11.26"> becomes a ref span, <strong="H0085">Abraham</strong>
 * becomes <b>Abraham</b> (the attribute is dropped), anything else is escaped text.
 */
export function sanitizeTipnrHtml(raw: string): string {
  // A "<" that cannot start a tag ("a < b") is text, not the start of an element.
  let s = (raw ?? '').replace(/^\s*#/, '').replace(/<(?![A-Za-z/!])/g, '&lt;');
  // "first mentioned at <ref…>Gen.11.26</ref>) <br>" — a stray ")" in every TIPNR summary.
  s = s.replace(/(<\/ref>)\)/gi, (m, close: string, at: number) => {
    const before = s.slice(0, at);
    const opens = (before.match(/\(/g) ?? []).length;
    const closes = (before.match(/\)/g) ?? []).length;
    return opens > closes ? m : close;
  });
  s = s.replace(/<BR\s*\/?>/g, '<br>');
  const html = stripCantillation(sanitizeStepDef(s, 'H'))
    .replace(/<br>\s*([;,.])/g, '$1<br>')
    .replace(/\s+([;,.])(?=<br>|$)/g, '$1')
    .replace(/<b>\s*<\/b>/g, '');
  if (!isSafeDefHtml(html)) return escapeHtml(html.replace(/<[^>]*>/g, ''));
  return html;
}

/* ======================================================================== */
/* Entities                                                                  */
/* ======================================================================== */

export interface BuiltEntity extends NameEntity {
  /** Raw link strings by relation, resolved later. */
  _links: Record<'parents' | 'siblings' | 'partners' | 'children', TipnrLink[]>;
}

/** A claim that word occurrence (verse, Strong's base, occ) refers to an entity. */
interface Claim {
  id: string;
  /** 0 = any occurrence in the verse. */
  occ: number;
  /** 3 = single-word form, 2 = component of a combined name. */
  prio: number;
  /**
   * Tie-break among equal `prio`: 2 = a line for the record's own name, 1 = an alternative name
   * ("Abram|Abraham"), 0 = "(same form with alt. meaning)" (some Bibles read it differently).
   */
  rank: number;
  /** Hebrew / Greek spellings of this component (for the sibling-Strong's pass and run choice). */
  forms: string[];
  /** Base Strong's of every component of the name line the claim comes from (one for a single-word form). */
  parts: string[];
}

export function entityKind(rec: TipnrRecord): EntityKind {
  const type = (rec.fields[7] ?? '').trim();
  if (rec.section === 'PLACE' || rec.section === 'PLACE+PERSON') return 'place';
  if (type === 'Group') return 'group';
  if (rec.section === 'PERSON') return 'person';
  return 'other';
}

const KIND_LETTER: Record<EntityKind, 'p' | 'l' | 'g'> = { person: 'p', place: 'l', group: 'g', other: 'g' };

/** "p0685" -> "names/entities/p/006.json" (relative to the data dir). */
export function entityChunkPath(id: string): string {
  const n = Number(id.slice(1));
  return `names/entities/${id[0]}/${String(Math.floor(n / 100)).padStart(3, '0')}.json`;
}

function cleanBrief(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s*\.\s*$/, '').trim();
}

/** Build entities (without resolved links / chapter-derived refs). Ids: kind letter + number by UniqueName. */
export function buildEntities(records: TipnrRecord[]): BuiltEntity[] {
  const byKind = new Map<string, TipnrRecord[]>();
  for (const r of records) {
    const letter = KIND_LETTER[entityKind(r)];
    let list = byKind.get(letter);
    if (!list) byKind.set(letter, (list = []));
    list.push(r);
  }
  const out: BuiltEntity[] = [];
  for (const letter of ['p', 'l', 'g']) {
    const list = (byKind.get(letter) ?? []).sort((a, b) => (a.uniqueName < b.uniqueName ? -1 : a.uniqueName > b.uniqueName ? 1 : 0));
    list.forEach((rec, i) => out.push(buildEntity(rec, `${letter}${String(i + 1).padStart(4, '0')}`)));
  }
  return out;
}

function buildEntity(rec: TipnrRecord, id: string): BuiltEntity {
  const kind = entityKind(rec);
  const f = rec.fields;
  const isPlace = kind === 'place';
  const type = (f[7] ?? '').trim();
  const description = isPlace ? '' : (f[0] ?? '').trim();
  const brief = cleanBrief(rec.brief) || cleanBrief(rec.briefest) || cleanBrief(description) || cleanBrief(rec.short);

  let summary = sanitizeTipnrHtml(f[6] ?? '');
  if (INCLUDE_ARTICLE && rec.article) {
    const art = sanitizeTipnrHtml(rec.article);
    if (art) summary = summary ? `${summary}<br>${art}` : art;
  }

  // Single-word forms first, so that a word's own name wins over a combined name containing the same
  // word (the LORD's אֵל is "God", not "God Most High"); then the components of combined names.
  const forms: [string, string, string][] = [];
  const seenForm = new Set<string>();
  const name = displayName(rec.uniqueName);
  const subs = rec.subs.filter((sub) => sub.kind !== 'Mentioned');
  for (const sub of [...subs.filter((x) => x.strongs.length === 1), ...subs.filter((x) => x.strongs.length > 1)]) {
    const alt = displayName(sub.uniqueName);
    const en = englishName(sub.english, alt, name) || alt;
    for (const s of sub.strongs) {
      const strong = s.eStrong || baseStrongs(s.dStrong);
      const form = cleanForm(strong, s.form);
      if (!form) continue;
      const key = `${strong}|${form}`;
      if (seenForm.has(key)) continue;
      seenForm.add(key);
      forms.push([strong, form, en]);
    }
  }

  const group = (f[5] ?? '').trim();
  const e: BuiltEntity = {
    id,
    name,
    kind,
    uniqueName: rec.uniqueName,
    brief,
    summary,
    forms,
    refs: [],
    _links: {
      // Places: the "Founder / origin" column ("Salma … the father of Bethlehem").
      parents: kind === 'other' ? [] : parseLinks(f[1]),
      siblings: kind === 'person' || kind === 'group' ? parseLinks(f[2]) : [],
      partners: kind === 'person' ? parseLinks(f[3]) : [],
      children: kind === 'person' || kind === 'group' ? parseLinks(f[4]) : [],
    },
  };
  if (type === 'Male') e.gender = 'male';
  else if (type === 'Female') e.gender = 'female';
  if (group && group !== '>') e.group = group;
  if (isPlace) {
    const coords = parseCoords(f[3], f[4]);
    if (coords) e.coords = coords;
  }
  return e;
}

/* ======================================================================== */
/* Word mapping                                                              */
/* ======================================================================== */

export interface ClaimIndex {
  /** "bookNum.chapter.verse|H0085" -> claims */
  claims: Map<string, Claim[]>;
  /** "bookNum.chapter.verse" -> base Strong's ids that have claims in that verse. */
  byVerse: Map<string, string[]>;
  /** Entity id -> ids of its parents, children, partners and siblings (for tie-breaks). */
  relatives?: Map<string, Set<string>>;
  /** Base Strong's ids whose every (properly capitalised) occurrence belongs to an entity ("etc"). */
  everywhere: Map<string, string>;
  /** The same, by entity id: the LORD -> H3068, H0430, H0410. */
  everywhereById?: Map<string, Set<string>>;
  /** Explicit refs per entity id (packed). */
  refs: Map<string, Set<number>>;
  badRefs: string[];
}

/**
 * Greek "etc" lists are not used: κύριος "etc" (TIPNR files every "Lord" under the LORD) would also
 * claim the many NT uses that refer to Jesus (or mean "sir"), which TIPNR does not separate.
 */
const ETC_LANGS = new Set(['H']);

/**
 * Strong's numbers that TIPNR folds into another one in its own tagging: יְהֹוִה (H3069, "GOD" in
 * "Lord GOD") is listed only in the LORD record's Total line, its words being tagged H3068 by STEP.
 */
const STRONGS_ALIASES: Record<string, string> = { H3069: 'H3068' };

export function buildClaims(records: TipnrRecord[], ids: Map<string, string>): ClaimIndex {
  const claims = new Map<string, Claim[]>();
  const byVerse = new Map<string, string[]>();
  const everywhere = new Map<string, string>();
  const refs = new Map<string, Set<number>>();
  const badRefs: string[] = [];
  for (const rec of records) {
    const id = ids.get(rec.uniqueName);
    if (!id) continue;
    let set = refs.get(id);
    if (!set) refs.set(id, (set = new Set()));
    for (const sub of rec.subs) {
      const parsed = parseTipnrRefs(sub.refs);
      for (const b of parsed.bad) badRefs.push(`${rec.uniqueName}: "${b}"`);
      for (const r of parsed.refs) set.add(packRef(r.book.num, r.chapter, r.verse));
      if (sub.kind === 'Mentioned') continue; // implied individual: no word in the text names them
      const parts = new Map<string, string[]>();
      for (const s of sub.strongs) {
        const b = baseStrongs(s.dStrong);
        parts.set(b, [...(parts.get(b) ?? []), s.form].filter(Boolean));
      }
      if (parsed.etc) {
        for (const b of parts.keys()) if (ETC_LANGS.has(b[0]) && !everywhere.has(b)) everywhere.set(b, id);
      }
      const prio = parts.size > 1 ? 2 : 3;
      const rank = /alt\. meaning/.test(sub.kind) ? 0 : sub.uniqueName.includes('|') ? 1 : 2;
      const partList = [...parts.keys()];
      for (const r of parsed.refs) {
        const vk = `${r.book.num}.${r.chapter}.${r.verse}`;
        for (const [b, forms] of parts) {
          const key = `${vk}|${b}`;
          let list = claims.get(key);
          if (!list) {
            claims.set(key, (list = []));
            const bases = byVerse.get(vk) ?? [];
            bases.push(b);
            byVerse.set(vk, bases);
          }
          const have = list.find((c) => c.id === id && c.occ === r.occ);
          // One claim per entity and occurrence; a single-word form outranks a combined-name component.
          if (!have) list.push({ id, occ: r.occ, prio, rank, forms, parts: partList });
          else if (prio > have.prio) Object.assign(have, { prio, rank, forms, parts: partList });
        }
      }
    }
  }
  const everywhereById = new Map<string, Set<string>>();
  for (const [b, id] of everywhere) everywhereById.set(id, new Set([...(everywhereById.get(id) ?? []), b]));
  return { claims, byVerse, everywhere, everywhereById, refs, badRefs };
}

export interface MapStats {
  words: number;
  mapped: number;
  /** Words mapped by each pass: exact Strong's + occurrence, sibling Strong's, neighbouring verse, "etc". */
  byPass: [exact: number, sibling: number, neighbour: number, everywhere: number];
  ambiguous: number;
  ambiguousSamples: string[];
}

export function newMapStats(): MapStats {
  return { words: 0, mapped: 0, byPass: [0, 0, 0, 0], ambiguous: 0, ambiguousSamples: [] };
}

/** Proper noun, for the fallback passes and the coverage report: Hebrew "Np…", Greek noun with a capitalised lemma. */
export function isProperNoun(lang: 'grc' | 'hbo', w: OrigChapter['words'][number]): boolean {
  if (lang === 'hbo') return /^Np/.test(w[OW.morph]);
  return /^N-/.test(w[OW.morph]) && /^\p{Lu}/u.test(w[OW.lemma]);
}

/**
 * A Hebrew prefix, suffix or particle morpheme with one of Macula's lettered ids (H1886a the article,
 * H0871a בְּ, H3641b כֶם "your"), whose digits say nothing about the word.
 */
export function isAffixMorpheme(lang: 'grc' | 'hbo', w: OrigChapter['words'][number]): boolean {
  return lang === 'hbo' && /^H\d{4}[a-z]$/.test(w[OW.strongs]) && /^[CRST]/.test(w[OW.morph]);
}

/**
 * A word that is itself (part of) a name: a proper noun, a gentilic (Hebrew "Ng…", Greek adjective
 * with a capitalised lemma: Ἰουδαῖος), or a word glossed with a capital ("Holy Place", "LORD").
 */
export function isNameLike(lang: 'grc' | 'hbo', w: OrigChapter['words'][number]): boolean {
  if (isProperNoun(lang, w) || /^\p{Lu}/u.test(w[OW.gloss])) return true;
  return lang === 'hbo' ? /^Ng/.test(w[OW.morph]) : /^\p{Lu}/u.test(w[OW.lemma]);
}

/** Loose spelling key: Hebrew consonants (finals folded), Greek without accents / case. */
export function spellingKey(s: string): string {
  return /[֐-׿]/.test(s) ? hebrewSkeleton(s) : greekFold(s);
}

/** 1 - normalised Levenshtein distance of two spelling keys (0 when either is empty). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** Minimum spelling similarity for the sibling-Strong's pass (מִצְרַיִם ~ מִצְרִי = 0.8, גֵּרְשׁוֹן ~ גֵּרְשֹׁם = 0.6). */
const MIN_SIMILARITY = 0.5;

/** The single entity a claim list points to (highest priority first), or undefined if they disagree. */
function winner(cands: Claim[]): { id?: string; ids: string[] } {
  if (!cands.length) return { ids: [] };
  const top = Math.max(...cands.map((c) => c.prio));
  let best = cands.filter((c) => c.prio === top);
  const ids = [...new Set(best.map((c) => c.id))];
  if (ids.length === 1) return { id: ids[0], ids };
  const topRank = Math.max(...best.map((c) => c.rank));
  best = best.filter((c) => c.rank === topRank);
  const ranked = [...new Set(best.map((c) => c.id))];
  return ranked.length === 1 ? { id: ranked[0], ids } : { ids: ranked };
}

/** Pick the claim for the k-th occurrence: "a"/"b"… suffix first, else an unsuffixed claim. */
function pick(list: Claim[], k: number): Claim[] {
  const exact = list.filter((c) => c.occ === k);
  return exact.length ? exact : list.filter((c) => c.occ === 0);
}

/**
 * Map every word of a chapter to the entity it names.
 *
 * 1. Exact: a word with base Strong's S belonging to the k-th occurrence of S in its English verse
 *    matches TIPNR's claim for that verse and S with suffix k ("Gen.17.23b" = 2nd), else a suffix
 *    beyond our last occurrence (STEP counted one more), else an unsuffixed claim. An occurrence is a
 *    run of adjacent words with the same S, because Macula splits names such as בֵּית אֵל (Bethel,
 *    H1008) into two words where STEP has one. An unsuffixed claim takes every proper-noun occurrence,
 *    but only the best occurrence(s) of a common noun (see runChoice). When several entities claim
 *    the word, single-word forms beat components of combined names; a remaining tie is left unmapped.
 * 2. Sibling Strong's: an unmapped proper noun takes a claim in the same verse whose Strong's number
 *    does not occur in our text, if the spellings are similar (TIPNR tags "Egyptians" H4713 where
 *    Macula has H4714, Hezekiah H2396 where Macula has H3169).
 * 3. Neighbouring verse: an unmapped proper noun takes an unconsumed claim with the same Strong's in
 *    the previous / next verse (verse divisions differ slightly, e.g. Gal 2:19/20).
 * 4. "etc" (applied right after pass 1): names of God listed as "every occurrence" (YHWH, Elohim, El)
 *    map every word with that Strong's whose contextual gloss is capitalised ("God", not "gods").
 */
export function mapChapter(
  orig: OrigChapter,
  bookNum: number,
  idx: ClaimIndex,
  stats?: MapStats,
  english?: ReadonlySet<number>,
): Record<string, string> {
  const { ids, pass } = mapChapterDetailed(orig, bookNum, idx, stats, english);
  const out: Record<string, string> = {};
  ids.forEach((id, i) => {
    if (!id) return;
    out[String(i)] = id;
    if (stats) stats.byPass[pass[i]]++;
  });
  if (stats) {
    stats.words += ids.length;
    stats.mapped += Object.keys(out).length;
  }
  return out;
}

/**
 * mapChapter with the pass (0-3, -1 = unmapped) that mapped each word, for audits and tests.
 * `english`: original-word indices that an English translation renders with a capital letter
 * mid-sentence ("the Book of the Chronicles", "the LORD of Hosts"), see capitalisedWords().
 */
export function mapChapterDetailed(
  orig: OrigChapter,
  bookNum: number,
  idx: ClaimIndex,
  stats?: MapStats,
  english?: ReadonlySet<number>,
): { ids: (string | undefined)[]; pass: number[] } {
  const words = orig.words;
  const n = words.length;
  const lang = orig.lang;
  const ids: (string | undefined)[] = new Array(n);
  const pass: number[] = new Array(n).fill(-1);
  const base: string[] = new Array(n).fill('');
  const occ: number[] = new Array(n).fill(0);
  const runs = new Map<string, number>(); // "verse|S" -> number of runs (occurrences) in our text
  const runWords = new Map<string, number[][]>(); // "verse|S" -> word indices of each run
  const verseKey = (v: number) => `${bookNum}.${orig.chapter}.${v}`;
  const claimsAt = (v: number, b: string) => idx.claims.get(`${verseKey(v)}|${b}`);
  // Written-word number of each word (Macula splits prefixes / suffixes into separate words).
  const wordNo: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) wordNo[i] = wordNo[i - 1] + (words[i][OW.group] === words[i - 1][OW.group] ? 0 : 1);
  const nameLike = words.map((w) => isNameLike(lang, w));

  for (let i = 0; i < n; i++) {
    const s = words[i][OW.strongs];
    if (!s) continue;
    const b = baseStrongs(s);
    const v = words[i][OW.verse];
    // Macula numbers Hebrew prefix / suffix / particle morphemes with lettered ids ("H1886a" = the
    // article, "H0871a" = בְּ) that share their digits with unrelated names (H1886 Dothan, H0871
    // Atharim): such a morpheme is a name candidate only if it is spelled like one of the claimed forms.
    if (isAffixMorpheme(lang, words[i])) {
      const forms = (claimsAt(v, b) ?? []).flatMap((c) => c.forms);
      const key = spellingKey(words[i][OW.text]);
      if (!forms.some((f) => similarity(spellingKey(f), key) >= MIN_SIMILARITY)) continue;
    }
    base[i] = b;
    const sameRun = i > 0 && base[i - 1] === b && words[i - 1][OW.verse] === v;
    const rk = `${v}|${b}`;
    if (!sameRun) runs.set(rk, (runs.get(rk) ?? 0) + 1);
    occ[i] = runs.get(rk)!;
    let rl = runWords.get(rk);
    if (!rl) runWords.set(rk, (rl = []));
    if (sameRun) rl[rl.length - 1].push(i);
    else rl.push([i]);
  }
  const set = (i: number, id: string, p: number) => {
    ids[i] = id;
    pass[i] = p;
  };
  const ambiguous = (i: number, cands: string[]) => {
    if (!stats) return;
    stats.ambiguous++;
    if (stats.ambiguousSamples.length < 40)
      stats.ambiguousSamples.push(`${orig.book} ${orig.chapter}:${words[i][OW.verse]} ${base[i]} #${occ[i]} -> ${cands.join(' / ')}`);
  };

  /**
   * TIPNR counts occurrences in STEP's tagging, which sometimes has one more word with the number
   * than Macula (Gilead inside "Ramoth-gilead", tagged H7433 by Macula): a claim whose suffix is
   * beyond our last occurrence goes to the last occurrence no suffix names (Rom 16:14 "Hermas" b), or
   * whose suffix names only a combined-name component standing apart from the rest of its name: STEP's
   * occurrence that our text lacks (1 Ki 4:13: Ramoth-gilead "a" claims the lone Gilead, which is
   * Gilead "b"). Returns occurrence -> claims.
   */
  const overflowCache = new Map<string, Map<number, Claim[]>>();
  const overflow = (v: number, b: string, list: Claim[]): Map<number, Claim[]> => {
    const key = `${v}|${b}`;
    let m = overflowCache.get(key);
    if (m) return m;
    overflowCache.set(key, (m = new Map()));
    const have = runs.get(key) ?? 0;
    const over = [...new Set(list.filter((c) => c.occ > have).map((c) => c.occ))].sort((x, y) => y - x);
    if (!over.length) return m;
    const free: number[] = [];
    for (let r = have; r >= 1; r--) {
      const run = runWords.get(key)![r - 1];
      const named = list.filter((c) => c.occ === r);
      if (named.every((c) => c.parts.length > 1 && !run.some((i) => anchoredPart(c, i)))) free.push(r);
    }
    over.forEach((o, j) => {
      if (j < free.length) m!.set(free[j], list.filter((c) => c.occ === o));
    });
    return m;
  };

  // Bases each entity is claimed with in a verse (plus its "every occurrence" names), for anchoring.
  const entityBases = (v: number, id: string): Set<string> => {
    const out = new Set(idx.everywhereById?.get(id) ?? []);
    for (const b of idx.byVerse.get(verseKey(v)) ?? []) if (claimsAt(v, b)!.some((c) => c.id === id)) out.add(b);
    return out;
  };
  const near = (i: number, j: number, dist: number) => Math.abs(wordNo[i] - wordNo[j]) <= dist;
  const byVerseWords = new Map<number, number[]>();
  words.forEach((w, j) => byVerseWords.set(w[OW.verse], [...(byVerseWords.get(w[OW.verse]) ?? []), j]));
  const verseWords = (v: number) => byVerseWords.get(v) ?? [];
  /**
   * A combined-name component is next to another component of the same name ("son" in Ben-hinnom):
   * the next or previous written word in Hebrew (articles and prepositions are prefixes; "his sons
   * through the fire in the Valley of Ben-hinnom" is two words away), within three words in Greek
   * (τῇ στοᾷ τῇ καλουμένῃ Σολομῶντος).
   */
  const partWindow = lang === 'grc' ? 3 : 1;
  const anchoredPart = (c: Claim, i: number) => {
    if (c.parts.length < 2) return true;
    const v = words[i][OW.verse];
    return verseWords(v).some((j) => base[j] && base[j] !== base[i] && c.parts.includes(base[j]) && near(i, j, partWindow));
  };
  /** The written word(s) of a run, with their prefixes and suffixes: "בְנ" + "וֹ" -> "בְנוֹ". */
  const spelledAs = (run: number[]): string[] => {
    const groups = new Set(run.map((i) => words[i][OW.group]));
    let whole = '';
    for (let j = run[0]; j >= 0 && groups.has(words[j][OW.group]); j--) whole = words[j][OW.text] + whole;
    for (let j = run[0] + 1; j < n && groups.has(words[j][OW.group]); j++) whole += words[j][OW.text];
    return [run.map((i) => words[i][OW.text]).join(''), whole];
  };

  /**
   * An unsuffixed TIPNR reference says the verse names the entity, not how often. For proper nouns
   * every occurrence is taken (TIPNR's a/b marks are incomplete: Abraham twice in Gen 25:6), but a
   * common noun that serves as a name ("son" in Ben-hinnom, "acts" vs the Book of the Chronicles,
   * "hosts" in the LORD of hosts) is often used in its ordinary sense elsewhere in the same verse.
   * When a claim could take several occurrences, keep the best, compared in this order:
   *  - a name-like occurrence (proper noun or capitalised gloss);
   *  - for a combined name, one next to another of its components (Hinnom after "son");
   *  - one an English translation capitalises (the Book of the "Chronicles", "Beulah");
   *  - for a person, one right after "son of" / "daughter of" (Jerahmeel son of "Hammelech");
   *  - one next to another name of the same entity (יְהוָה צְבָאוֹת, not צְבָא "army");
   *  - one spelled exactly like TIPNR's form (בְּנוֹ Beno, not בְּנֵי "sons"; שַׁבָּת, not שַׁבָּתוֹת "weeks").
   * Occurrences still equal are all kept (the Sabbath twice in Lev 24:8). A single candidate is kept.
   */
  const runIsNameLike = (run: number[]) => run.some((i) => nameLike[i]);
  /** The entity is already named in the verse by a name-like word (mapped, or a name of God). */
  const namedInVerse = (id: string, v: number) =>
    verseWords(v).some(
      (j) => nameLike[j] && base[j] && (ids[j] === id || idx.everywhere.get(STRONGS_ALIASES[base[j]] ?? base[j]) === id),
    );
  const bestRuns = new Map<string, Set<number>>();
  const runChoice = (c: Claim, v: number, b: string): Set<number> => {
    const key = `${v}|${b}|${c.id}|${c.prio}`;
    let best = bestRuns.get(key);
    if (best) return best;
    const list = claimsAt(v, b)!;
    const over = overflow(v, b, list);
    // A component away from the rest of its name is not part of it when the name itself is in the verse
    // (גֵיא בֶן־הִנֹּם, all tagged H1516 by Macula: "their sons" בְּנֵיהֶם after it is not "Ben"). When
    // the other components are missing (Macula numbers them differently: עִיר H5892 in the "City of
    // Palms", where TIPNR has H5899) there is nothing to measure against.
    const strict =
      c.parts.length > 1 &&
      verseWords(v).some((j) => base[j] && base[j] !== b && c.parts.includes(base[j])) &&
      namedInVerse(c.id, v);
    const open = (runWords.get(`${v}|${b}`) ?? [])
      .map((run, r0) => ({ run, r: r0 + 1 }))
      .filter(({ r }) => !list.some((x) => x.occ === r) && !over.has(r)) // no suffix names these
      .filter(({ run }) => !strict || runIsNameLike(run) || run.some((i) => anchoredPart(c, i)));
    if (open.length <= 1) {
      bestRuns.set(key, (best = new Set(open.map((o) => o.r))));
      return best;
    }
    const mine = entityBases(v, c.id);
    const vw = verseWords(v);
    const person = c.id[0] === 'p';
    const formKeys = new Set(c.forms.map(spellingKey).filter(Boolean));
    let top: number[] = [];
    let topScore: number[] = [];
    for (const { run, r } of open) {
      const first = run[0];
      const prevWord = vw.filter((j) => wordNo[j] === wordNo[first] - 1 && base[j]).map((j) => base[j]);
      const score = [
        runIsNameLike(run) ? 1 : 0,
        run.some((i) => anchoredPart(c, i)) ? 1 : 0,
        english && run.some((i) => english.has(i)) ? 1 : 0,
        person && prevWord.some((p) => p === 'H1121' || p === 'H1323') ? 1 : 0,
        vw.some(
          (j) =>
            !run.includes(j) && nameLike[j] && base[j] !== b && mine.has(STRONGS_ALIASES[base[j]] ?? base[j]) && run.some((i) => near(i, j, 1)),
        )
          ? 1
          : 0,
        spelledAs(run).some((t) => formKeys.has(spellingKey(t))) ? 1 : 0,
      ];
      const d = topScore.length ? score.findIndex((x, k) => x !== topScore[k]) : -2;
      if (d === -2 || (d >= 0 && score[d] > topScore[d])) {
        top = [r];
        topScore = score;
      } else if (d === -1) top.push(r);
    }
    bestRuns.set(key, (best = new Set(top)));
    return best;
  };

  /** Claims for word i: an overflowing suffix given to its occurrence, its own suffix, else unsuffixed claims. */
  const candidates = (i: number): Claim[] => {
    const v = words[i][OW.verse];
    const b = base[i];
    const list = claimsAt(v, b);
    if (!list) return [];
    const k = occ[i];
    const over = overflow(v, b, list).get(k);
    if (over?.length) return over;
    const exact = list.filter((c) => c.occ === k);
    if (exact.length) return exact;
    const loose = list.filter((c) => c.occ === 0);
    if (runIsNameLike(runWords.get(`${v}|${b}`)![k - 1])) return loose;
    return loose.filter((c) => runChoice(c, v, b).has(k));
  };

  // 1. Exact: names (and suffixed claims) first, then common nouns, which look at the names mapped.
  const ties: [number, string[]][] = [];
  const later: number[] = [];
  const exactPass = (i: number) => {
    const w = winner(candidates(i));
    if (w.id) set(i, w.id, 0);
    else if (w.ids.length > 1) ties.push([i, w.ids]);
  };
  for (let i = 0; i < n; i++) {
    if (!base[i]) continue;
    const v = words[i][OW.verse];
    const list = claimsAt(v, base[i]);
    if (!list) continue;
    const named = list.some((c) => c.occ === occ[i]) || overflow(v, base[i], list).has(occ[i]);
    if (named || runIsNameLike(runWords.get(`${v}|${base[i]}`)![occ[i] - 1])) exactPass(i);
    else later.push(i);
  }
  for (const i of later) exactPass(i);
  // Still tied: take the one candidate with a relative named in the same verse ("Mamre the Amorite"
  // next to his brothers Eshcol and Aner, rather than the place Mamre); otherwise leave it unmapped.
  for (const [i, cands] of ties) {
    const v = words[i][OW.verse];
    const inVerse = new Set<string>();
    for (let j = 0; j < n; j++) if (ids[j] && words[j][OW.verse] === v) inVerse.add(ids[j]!);
    const withKin = cands.filter((c) => [...(idx.relatives?.get(c) ?? [])].some((r) => inVerse.has(r) && !cands.includes(r)));
    if (withKin.length === 1) set(i, withKin[0], 0);
    else ambiguous(i, cands);
  }

  // "etc" (pass 3, run before the fallbacks so that they never take a word that is a name of God).
  for (let i = 0; i < n; i++) {
    if (ids[i] || !base[i]) continue;
    const ev = idx.everywhere.get(STRONGS_ALIASES[base[i]] ?? base[i]);
    if (ev && /^\p{Lu}/u.test(words[i][OW.gloss])) set(i, ev, 3);
  }

  const unmappedProper = (i: number) => !ids[i] && !!base[i] && isProperNoun(lang, words[i]);

  // 2. Sibling Strong's in the same verse.
  const verses = [...new Set(words.map((w) => w[OW.verse]))];
  for (const v of verses) {
    const bases = idx.byVerse.get(verseKey(v));
    if (!bases) continue;
    const orphans = bases.filter((b) => !runs.has(`${v}|${b}`));
    if (!orphans.length) continue;
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      if (words[i][OW.verse] !== v || !unmappedProper(i)) continue;
      groups.set(base[i], [...(groups.get(base[i]) ?? []), i]);
    }
    const usedOrphans = new Set<string>();
    for (const [, members] of groups) {
      const keys = [...new Set(members.flatMap((i) => [spellingKey(words[i][OW.lemma]), spellingKey(words[i][OW.text])]))];
      let best: { b: string; sim: number } | null = null;
      for (const ob of orphans) {
        if (usedOrphans.has(ob)) continue;
        const list = idx.claims.get(`${verseKey(v)}|${ob}`)!;
        const forms = list.flatMap((c) => c.forms.map(spellingKey));
        const sim = Math.max(0, ...forms.flatMap((f) => keys.map((k) => similarity(f, k))));
        if (sim >= MIN_SIMILARITY && (!best || sim > best.sim)) best = { b: ob, sim };
      }
      if (!best) continue;
      usedOrphans.add(best.b);
      const list = idx.claims.get(`${verseKey(v)}|${best.b}`)!;
      // Occurrence among this group's runs.
      let k = 0;
      let prevIdx = -2;
      for (const i of members) {
        if (i !== prevIdx + 1) k++;
        prevIdx = i;
        const w = winner(pick(list, k));
        const id = w.id ?? winner(list).id;
        if (id) set(i, id, 1);
      }
    }
  }

  // 3. Same Strong's in the neighbouring verse, when that verse's claims are not used up by our text.
  for (let i = 0; i < n; i++) {
    if (!unmappedProper(i)) continue;
    const v = words[i][OW.verse];
    const found = new Set<string>();
    for (const nv of [v - 1, v + 1]) {
      const list = idx.claims.get(`${verseKey(nv)}|${base[i]}`);
      if (!list) continue;
      const have = runs.get(`${nv}|${base[i]}`) ?? 0;
      const spare = list.filter((c) => (c.occ === 0 ? have === 0 : c.occ > have));
      const w = winner(spare);
      if (w.id) found.add(w.id);
    }
    if (found.size === 1) set(i, [...found][0], 2);
  }

  return { ids, pass };
}

/* ======================================================================== */
/* Family links                                                              */
/* ======================================================================== */

type Rel = 'parents' | 'siblings' | 'partners' | 'children';
const INVERSE: Record<Rel, Rel> = { parents: 'children', children: 'parents', siblings: 'siblings', partners: 'partners' };

export interface LinkReport {
  resolved: number;
  unresolved: string[];
  /** Uncertain "(?)" links kept: an uncertain parent where the child has no certain one, or who has no ancestry of their own. */
  uncertainKept: string[];
  /** Uncertain "(?)" links left out (e.g. Naamah as Noah's wife and Shem's mother; guessed half-siblings). */
  uncertain: string[];
  /** Links added to make the graph symmetric (A parent of B => B child of A, …). */
  added: number;
}

/**
 * Resolve link strings to entity ids and make every relation symmetric. TIPNR cites a person by
 * UniqueName, occasionally with an "AltName|" prefix or a different "-LastBook" suffix; those fall
 * back to a unique match on "Name@FirstRef".
 *
 * Links TIPNR marks "(?)" cannot be flagged in the FamilyGraph contract, so they are filtered:
 * an uncertain sibling or partner is left out (it never affects lineage); an uncertain parent/child
 * link is kept only when the child has no certain parent (it fills a gap: Jehoiachin -> Shealtiel ->
 * Pedaiah in Matthew's line) or the parent has no recorded parents (it cannot open a second line of
 * ancestry: Rahab -> Boaz). So Naamah, Lamech's daughter, is not made Shem's mother, which would
 * otherwise route Adam -> Noah through Cain.
 */
export function resolveLinks(entities: BuiltEntity[]): LinkReport {
  const byUnique = new Map(entities.map((e) => [e.uniqueName, e]));
  const byStem = new Map<string, BuiltEntity[]>();
  const stem = (u: string) => {
    const [name, ref = ''] = u.split('|').pop()!.split('@');
    return `${name}@${ref.split('-')[0]}`;
  };
  for (const e of entities) {
    const k = stem(e.uniqueName);
    byStem.set(k, [...(byStem.get(k) ?? []), e]);
  }
  const resolve = (name: string): BuiltEntity | undefined => {
    const n = name.split('|').pop()!.trim();
    const hit = byUnique.get(n);
    if (hit) return hit;
    const cands = byStem.get(stem(n)) ?? [];
    return cands.length === 1 ? cands[0] : undefined;
  };

  const report: LinkReport = { resolved: 0, unresolved: [], uncertainKept: [], uncertain: [], added: 0 };
  type Edge = { from: BuiltEntity; rel: Rel; to: BuiltEntity; label: string };
  const certain: Edge[] = [];
  const unsure: Edge[] = [];
  for (const e of entities) {
    for (const rel of ['parents', 'siblings', 'partners', 'children'] as Rel[]) {
      for (const link of e._links[rel]) {
        const target = resolve(link.name);
        if (!target || target.id === e.id) {
          report.unresolved.push(`${e.uniqueName} ${rel}: ${link.name}`);
          continue;
        }
        report.resolved++;
        const edge = { from: e, rel, to: target, label: `${e.uniqueName} ${rel}: ${link.name}(${link.flag})` };
        (link.flag.includes('?') ? unsure : certain).push(edge);
      }
    }
  }

  // child id -> parent ids, from either side of the relation.
  const certainParents = new Map<string, Set<string>>();
  const anyParents = new Map<string, Set<string>>();
  const note = (map: Map<string, Set<string>>, child: string, parent: string) => {
    let s = map.get(child);
    if (!s) map.set(child, (s = new Set()));
    s.add(parent);
  };
  const asChildParent = (x: Edge): [string, string] | null =>
    x.rel === 'parents' ? [x.from.id, x.to.id] : x.rel === 'children' ? [x.to.id, x.from.id] : null;
  for (const x of certain) {
    const cp = asChildParent(x);
    if (cp) note(certainParents, ...cp), note(anyParents, ...cp);
  }
  for (const x of unsure) {
    const cp = asChildParent(x);
    if (cp) note(anyParents, ...cp);
  }

  const sets = new Map<string, Record<Rel, Set<string>>>();
  const relsOf = (id: string) => {
    let r = sets.get(id);
    if (!r) sets.set(id, (r = { parents: new Set(), siblings: new Set(), partners: new Set(), children: new Set() }));
    return r;
  };
  for (const x of certain) relsOf(x.from.id)[x.rel].add(x.to.id);
  for (const x of unsure) {
    const cp = asChildParent(x);
    let keep = false;
    if (cp) {
      const [child, parent] = cp;
      const childCertain = certainParents.get(child);
      keep = !!childCertain?.has(parent) || !childCertain?.size || !anyParents.get(parent)?.size;
    }
    if (keep) {
      relsOf(x.from.id)[x.rel].add(x.to.id);
      report.uncertainKept.push(x.label);
    } else report.uncertain.push(x.label);
  }

  // Symmetrise.
  for (const [id, rels] of [...sets]) {
    for (const rel of Object.keys(rels) as Rel[]) {
      for (const other of rels[rel]) {
        const back = relsOf(other)[INVERSE[rel]];
        if (!back.has(id)) {
          back.add(id);
          report.added++;
        }
      }
    }
  }
  const order = new Map(entities.map((e, i) => [e.id, i]));
  for (const e of entities) {
    const rels = sets.get(e.id);
    if (!rels) continue;
    for (const rel of Object.keys(rels) as Rel[]) {
      if (!rels[rel].size) continue;
      // TIPNR's own order first (eldest first, father before mother); links added by symmetry after.
      const own = e._links[rel].map((l) => resolve(l.name)?.id).filter((x): x is string => !!x && rels[rel].has(x));
      const rest = [...rels[rel]].sort((a, b) => order.get(a)! - order.get(b)!);
      e[rel] = [...new Set([...own, ...rest])];
    }
  }
  return report;
}

/* ======================================================================== */
/* Stage                                                                     */
/* ======================================================================== */

export interface NamesResult {
  entities: NameEntity[];
  chapters: NameChapter[];
  family: FamilyGraph;
  index: NameIndex;
  stats: MapStats;
  links: LinkReport;
  badRefs: string[];
}

/** Capitalised words that do not mark a name: BSB capitalises pronouns referring to God ("His bride"). */
const CAPITAL_STOPWORDS = new Set(
  'I O He His Him Himself Me My Mine Myself You Your Yours Yourself Thou Thee Thy Thine Who Whom Whose'.split(' '),
);

/**
 * Original-word indices that a translation renders with a capital letter mid-sentence ("the Book of
 * the Chronicles", "your land Beulah"): evidence that a common noun is used as a name there.
 */
export function capitalisedWords(text: TextChapter, into: Set<number> = new Set()): Set<number> {
  for (const verse of text.verses) {
    let sentenceStart = true;
    for (const tok of verse.t) {
      if (typeof tok === 'string') {
        // The KJV has no quotation marks: speech starts with a capital after "saying," / "said:".
        if (/[.!?,:;“"‘(]\s*$/.test(tok)) sentenceStart = true;
        continue;
      }
      if (!sentenceStart && /^\p{Lu}/u.test(tok[0]) && !CAPITAL_STOPWORDS.has(tok[0])) for (const i of tok[1]) into.add(i);
      sentenceStart = false;
    }
  }
  return into;
}

export function assembleNames(
  text: string,
  loadOrig: (book: string, chapter: number) => OrigChapter | null,
  loadEnglish?: (book: string, chapter: number) => ReadonlySet<number> | undefined,
): NamesResult {
  const records = parseTipnr(text);
  const built = buildEntities(records);
  const ids = new Map(built.map((e) => [e.uniqueName, e.id]));
  const links = resolveLinks(built);
  const claimIdx = buildClaims(records, ids);
  claimIdx.relatives = new Map(
    built.map((e) => [e.id, new Set([...(e.parents ?? []), ...(e.children ?? []), ...(e.partners ?? []), ...(e.siblings ?? [])])]),
  );
  const byId = new Map(built.map((e) => [e.id, e]));

  const stats = newMapStats();
  const chapters: NameChapter[] = [];
  const refSets = new Map<string, Set<number>>();
  for (const [id, set] of claimIdx.refs) refSets.set(id, new Set(set));
  for (const book of BOOKS) {
    for (let c = 1; c <= book.chapters; c++) {
      const orig = loadOrig(book.id, c);
      if (!orig) continue;
      const words = mapChapter(orig, book.num, claimIdx, stats, loadEnglish?.(book.id, c));
      for (const [i, id] of Object.entries(words)) {
        let set = refSets.get(id);
        if (!set) refSets.set(id, (set = new Set()));
        set.add(packRef(book.num, c, orig.words[+i][OW.verse]));
      }
      chapters.push({ book: book.id, chapter: c, words });
    }
  }

  const entities: NameEntity[] = built.map((b) => {
    const { _links, ...e } = b;
    void _links;
    e.refs = [...(refSets.get(e.id) ?? [])].sort((x, y) => x - y);
    return e;
  });

  const family: FamilyGraph = entities
    .filter((e) => e.kind === 'person')
    .map((e) => {
      const people = (list?: string[]) => (list ?? []).filter((x) => byId.get(x)?.kind === 'person');
      return [e.id, e.name, e.brief, people(e.parents), people(e.children), people(e.partners), people(e.siblings)];
    });
  const index: NameIndex = entities.map((e) => [e.id, e.name, e.kind, e.brief, e.refs.length]);
  return { entities, chapters, family, index, stats, links, badRefs: claimIdx.badRefs };
}

export function buildNames(): NamesResult {
  const text = readFileSync(srcPath('TIPNR.txt'), 'utf8');
  const loadOrig = (book: string, chapter: number): OrigChapter | null => {
    const p = outPath('orig', book, `${chapter}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as OrigChapter) : null;
  };
  // Capitalisation in the BSB and KJV (earlier stages' output; used only to choose between
  // occurrences of a common noun that TIPNR lists as a name, see mapChapterDetailed).
  const loadEnglish = (book: string, chapter: number): Set<number> | undefined => {
    let out: Set<number> | undefined;
    for (const tr of ['BSB', 'KJV']) {
      const p = outPath('text', tr, book, `${chapter}.json`);
      if (existsSync(p)) out = capitalisedWords(JSON.parse(readFileSync(p, 'utf8')) as TextChapter, out);
    }
    return out;
  };
  const res = assembleNames(text, loadOrig, loadEnglish);

  cleanOut('names');
  const chunks = new Map<string, NameEntityChunk>();
  for (const e of res.entities) {
    const path = entityChunkPath(e.id);
    let chunk = chunks.get(path);
    if (!chunk) chunks.set(path, (chunk = {}));
    chunk[e.id] = e;
  }
  let bytes = 0;
  for (const [path, chunk] of chunks) bytes += writeJson(outPath(...path.split('/')), chunk);
  for (const ch of res.chapters) bytes += writeJson(outPath('names', 'chapters', ch.book, `${ch.chapter}.json`), ch);
  bytes += writeJson(outPath('names', 'family.json'), res.family);
  bytes += writeJson(outPath('names', 'index.json'), res.index);

  const kinds = res.entities.reduce<Record<string, number>>((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {});
  log(
    STAGE,
    `${res.entities.length} entities (${Object.entries(kinds)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')}), ${res.stats.mapped} words mapped in ${res.chapters.length} chapters, ` +
      `${res.links.resolved} family links (${res.links.unresolved.length} unresolved, ${res.links.uncertain.length} uncertain "(?)" left out, ${res.links.uncertainKept.length} kept), ${(bytes / 1e6).toFixed(1)} MB`,
  );
  return res;
}

