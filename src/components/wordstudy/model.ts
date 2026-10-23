/**
 * Pure helpers for the word-study page (#/word/{id}): which English words in a verse translate the
 * studied word, occurrence grouping and paging, readable parsing for the forms table, the Strong's
 * cross-links in derivation notes, short summaries for the charts. DOM-free and unit-tested
 * (tests/ui/wordstudy-model.test.tsx).
 */
import { BOOKS, getBookByNum } from '../../lib/books';
import { baseStrongs, normalizeStrongs } from '../../lib/data';
import { describeMorph } from '../../lib/morph';
import type { MorphLang } from '../../lib/morph';
import type { BookId, LexEntry, LexIndex, OrigChapter, Token, WordStudy, WordStudyChunk } from '../../lib/types';
import { OW, unpackRef } from '../../lib/types';
import { CANON_SECTIONS, sectionOfBook, topBooks } from '../../lib/wordstudy';
import type { SectionId } from '../../lib/wordstudy';

/* ------------------------------------------------------------------------ */
/* Numbers and words                                                         */
/* ------------------------------------------------------------------------ */

export const fmt = (n: number): string => n.toLocaleString('en-US');

/** "1 verse", "318 verses". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/** A share as a percentage label: "51%", "<1%", "0%". */
export function pct(n: number, of: number): string {
  if (of <= 0 || n <= 0) return '0%';
  const p = (n / of) * 100;
  if (p < 1) return '<1%';
  if (p > 99 && n < of) return '99%';
  return `${Math.round(p)}%`;
}

/** "A, B and C". */
export function listAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "G0026" -> "G26", "H0871a" -> "H871a". */
export function strongsLabel(id: string): string {
  return id.replace(/^([GH])0+(?=\d)/, '$1');
}

/* ------------------------------------------------------------------------ */
/* Which original words belong to the study                                  */
/* ------------------------------------------------------------------------ */

/**
 * A predicate telling whether an original word's Strong's id (OrigWord strongs, or a KJV TokenInfo.s
 * id) is an occurrence of the studied word. Keys follow the concordance / word study: a base id
 * ("H2617") covers its extended ids ("H2617a"), except Hebrew prefix/suffix morphemes, which have
 * their own study ("H2050b" 'and' is not H2050 'to break in') — those are recognised by having their
 * own key in the study chunk.
 */
export function strongsMatcher(studyId: string, chunk?: WordStudyChunk | null): (id: string) => boolean {
  const target = normalizeStrongs(studyId) ?? studyId;
  const extended = target.length > 5;
  return (raw: string) => {
    if (!raw) return false;
    const id = normalizeStrongs(raw) ?? raw;
    if (extended) return id === target;
    if (baseStrongs(id) !== target) return false;
    return id === target || !chunk?.[id];
  };
}

/** Indices of the tokens of a verse that translate the studied word (linked words, or KJV Strong's tags). */
export function markTokens(tokens: readonly Token[], orig: OrigChapter | null, match: (id: string) => boolean): Set<number> {
  const out = new Set<number>();
  tokens.forEach((t, i) => {
    if (typeof t === 'string') return;
    const linked = orig ? t[1].some((w) => match(orig.words[w]?.[OW.strongs] ?? '')) : false;
    const tagged = t[2]?.s?.some(match) ?? false;
    if (linked || tagged) out.add(i);
  });
  return out;
}

export interface Run {
  text: string;
  hit: boolean;
}

/** The verse as runs of plain and marked text; a space between two marked words stays marked ("loving devotion"). */
export function verseRuns(tokens: readonly Token[], marked: ReadonlySet<number>): Run[] {
  const out: Run[] = [];
  const text = (t: Token) => (typeof t === 'string' ? t : t[0]);
  tokens.forEach((t, i) => {
    const s = text(t);
    const hit = marked.has(i) || (typeof t === 'string' && /^\s+$/.test(t) && marked.has(i - 1) && marked.has(i + 1));
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += s;
    else out.push({ text: s, hit });
  });
  return out.filter((r) => r.text);
}

/* ------------------------------------------------------------------------ */
/* Occurrences                                                               */
/* ------------------------------------------------------------------------ */

export interface RefGroup {
  bookNum: number;
  book: BookId;
  name: string;
  short: string;
  section: SectionId | undefined;
  refs: number[];
}

/** Packed verse refs (canonical order) grouped by book. */
export function groupRefsByBook(refs: readonly number[]): RefGroup[] {
  const out: RefGroup[] = [];
  for (const r of refs) {
    const { bookNum } = unpackRef(r);
    let g = out[out.length - 1];
    if (!g || g.bookNum !== bookNum) {
      const b = getBookByNum(bookNum);
      if (!b) continue;
      g = { bookNum, book: b.id, name: b.name, short: b.short, section: sectionOfBook(bookNum)?.id, refs: [] };
      out.push(g);
    }
    g.refs.push(r);
  }
  return out;
}

/** The chapters (in order, de-duplicated) a list of verse refs lives in. */
export function chaptersOf(refs: readonly number[]): { book: BookId; chapter: number }[] {
  const seen = new Set<string>();
  const out: { book: BookId; chapter: number }[] = [];
  for (const r of refs) {
    const { bookNum, chapter } = unpackRef(r);
    const b = getBookByNum(bookNum);
    if (!b) continue;
    const k = `${b.id}/${chapter}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ book: b.id, chapter });
  }
  return out;
}

/** The book-filter options grouped by section of the canon (only books with verses). */
export function bookOptions(groups: readonly RefGroup[]): { id: SectionId; name: string; books: RefGroup[] }[] {
  const out: { id: SectionId; name: string; books: RefGroup[] }[] = [];
  for (const s of CANON_SECTIONS) {
    const books = groups.filter((g) => g.section === s.id);
    if (books.length) out.push({ id: s.id, name: s.name, books });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Summaries                                                                 */
/* ------------------------------------------------------------------------ */

/** "Most often in Acts (65), John (40) and Matthew (33)." / "Over half are in Psalms (127 of 247)." */
export function distributionSummary(study: WordStudy): string {
  const top = topBooks(study, 3);
  if (!top.length || study.total <= 0) return '';
  const used = study.byBook.filter((n) => n > 0).length;
  if (used === 1) return `Only in ${top[0].name}.`;
  if (top[0].share >= 0.5) {
    const lead = top[0].share >= 0.75 ? 'Most' : 'Over half';
    return `${lead} are in ${top[0].name} (${fmt(top[0].count)} of ${fmt(study.total)}).`;
  }
  return `Most often in ${listAnd(top.map((b) => `${b.name} (${fmt(b.count)})`))}.`;
}

/** Number of books (1-66) in which the word occurs. */
export function bookCountOf(study: WordStudy): number {
  return study.byBook.slice(0, BOOKS.length).filter((n) => n > 0).length;
}

/* ------------------------------------------------------------------------ */
/* Forms                                                                     */
/* ------------------------------------------------------------------------ */

export interface FormRow {
  text: string;
  code: string;
  /** Plain-English parsing, without the segments every form shares (see FormTable.shared). */
  parsing: string;
  ok: boolean;
  count: number;
}

export interface FormTable {
  rows: FormRow[];
  /** Leading parsing segments common to every parsed form ("Noun", "common"), shown once in the header. */
  shared: string[];
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Inflected forms with readable parsing, most frequent first (the data's order). Segments every form
 * shares ("Noun · common · …") are lifted out so each row says only what differs
 * ("Masculine plural construct").
 */
export function formTable(study: WordStudy, lang: MorphLang): FormTable {
  const parsed = study.forms.map(([text, code, count]) => {
    const d = describeMorph(code, lang);
    return { text, code, count, ok: d.ok, segs: d.ok ? d.long.split(' · ') : [] };
  });
  const ok = parsed.filter((r) => r.ok);
  const shared: string[] = [];
  while (ok.length && ok.every((r) => r.segs.length > shared.length + 1 && r.segs[shared.length] === ok[0].segs[shared.length])) {
    shared.push(ok[0].segs[shared.length]);
  }
  const rows = parsed.map((r) => ({
    text: r.text,
    code: r.code,
    count: r.count,
    ok: r.ok,
    parsing: r.ok ? cap(r.segs.slice(shared.length).join(' · ')) : r.code ? 'Not parsed' : '—',
  }));
  return { rows, shared };
}

/* ------------------------------------------------------------------------ */
/* Lexicon text                                                              */
/* ------------------------------------------------------------------------ */

export type StrongsPart = { t: 'text'; v: string } | { t: 'id'; id: string; label: string };

const STRONGS_IN_TEXT = /(^|[^\p{L}\p{N}])([GH])0*(\d{1,4})([a-zA-Z]?)(?![\p{L}\p{N}])/gu;

/** Split text such as "from G25 (ἀγαπάω)" into text and Strong's references to link. */
export function splitStrongs(text: string): StrongsPart[] {
  const out: StrongsPart[] = [];
  let at = 0;
  STRONGS_IN_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRONGS_IN_TEXT.exec(text))) {
    const start = m.index + m[1].length;
    const id = normalizeStrongs(`${m[2]}${m[3]}${m[4]}`);
    if (!id) continue;
    if (start > at) out.push({ t: 'text', v: text.slice(at, start) });
    out.push({ t: 'id', id, label: text.slice(start, m.index + m[0].length) });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ t: 'text', v: text.slice(at) });
  return out;
}

/** Where the lexicon definition comes from. */
export function lexSource(entry: Pick<LexEntry, 'id' | 'def'>): string {
  if (!entry.def) return 'Strong’s dictionary';
  return entry.id.startsWith('G') ? 'Abbott-Smith’s Manual Greek Lexicon, via STEPBible' : 'Brown-Driver-Briggs (abridged), via STEPBible';
}

/** True when the lexicon marks the word as Aramaic ("(Aramaic) corresponding to H433"). */
export function isAramaicEntry(entry: Pick<LexEntry, 'deriv' | 'pos'> | undefined): boolean {
  return /\bAramaic\b/i.test(`${entry?.deriv ?? ''} ${entry?.pos ?? ''}`);
}

/* ------------------------------------------------------------------------ */
/* Renderings                                                                */
/* ------------------------------------------------------------------------ */

export interface RenderingGroup {
  tr: string;
  name: string;
  rows: [english: string, count: number][];
}

/** Renderings per translation, in picker order (KJV first), then any others in the data. */
export function renderingGroups(renderings: LexEntry['renderings'], trs: readonly { id: string; name: string }[]): RenderingGroup[] {
  if (!renderings) return [];
  const out: RenderingGroup[] = [];
  const seen = new Set<string>();
  for (const t of trs) {
    const rows = renderings[t.id];
    if (rows?.length) {
      out.push({ tr: t.id, name: t.name, rows });
      seen.add(t.id);
    }
  }
  for (const [tr, rows] of Object.entries(renderings)) {
    if (!seen.has(tr) && rows.length) out.push({ tr, name: tr, rows });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Lexicon index (chips for the Septuagint bridge and related words)         */
/* ------------------------------------------------------------------------ */

export interface LexBrief {
  id: string;
  lemma: string;
  translit: string;
  gloss: string;
}

/** id -> [id, lemma, translit, gloss]; a base id also finds its first extended entry ("H2617" -> "H2617a"). */
export function lexIndexMap(index: LexIndex): Map<string, LexBrief> {
  const map = new Map<string, LexBrief>();
  for (const [id, lemma, translit, gloss] of index) {
    const row = { id, lemma, translit, gloss };
    map.set(id, row);
    const base = baseStrongs(id);
    if (base !== id && !map.has(base)) map.set(base, row);
  }
  // Exact base entries win over the fallback set above.
  for (const [id, lemma, translit, gloss] of index) if (baseStrongs(id) === id) map.set(id, { id, lemma, translit, gloss });
  return map;
}

export function lookupBrief(map: Map<string, LexBrief> | null, id: string): LexBrief | undefined {
  if (!map) return undefined;
  const norm = normalizeStrongs(id) ?? id;
  return map.get(norm) ?? map.get(baseStrongs(norm));
}

/** Route to another word's study page. */
export function wordHash(id: string): string {
  return `#/word/${normalizeStrongs(id) ?? id}`;
}
