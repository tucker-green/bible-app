/**
 * Bible references: parsing what people type ("jn 3 16", "1 Cor 13:4–7", "Song of Songs 2:4"),
 * formatting VerseRefs for display, and the hash-route scheme  #/{TR}/{BOOK}/{CHAPTER}[/{VERSE}[-{END}]].
 *
 * Framework-free and DOM-free (safe to import from the pipeline or a worker).
 */
import { BOOKS, getBook } from './books';
import type { BookInfo } from './books';
import type { BookId, VerseRef } from './types';

/** Longest chapter in the Bible (Psalm 119) — used to reject absurd verse numbers when no verse counts are known. */
const MAX_VERSE = 176;

/** Optional verse-count source (e.g. from meta.json) for validating verse numbers. */
export interface ParseOptions {
  /** Number of verses in `chapter` of `book`, or undefined when unknown. */
  verseCount?: (book: BookId, chapter: number) => number | undefined;
}

/* ------------------------------------------------------------------------ */
/* Book-name lookup                                                          */
/* ------------------------------------------------------------------------ */

const ORDINALS: Record<string, string> = {
  i: '1', ii: '2', iii: '3', first: '1', second: '2', third: '3', '1st': '1', '2nd': '2', '3rd': '3',
};

/**
 * Canonical lookup key for a book name: lower-case, no dots/spaces/apostrophes, with a leading
 * ordinal ("ii ", "first ", "1st ") turned into a digit. "II Kings" -> "2kings", "Song of Songs" -> "songofsongs".
 */
export function bookKey(name: string): string {
  let s = name.toLowerCase().replace(/[.'’]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(i{1,3}|first|second|third|1st|2nd|3rd) (.+)$/.exec(s);
  if (m) s = ORDINALS[m[1]] + m[2];
  return s.replace(/ /g, '');
}

/** key -> book, for ids, names, short names and every alias. */
const KEY_TO_BOOK = new Map<string, BookInfo>();
/** Full-name keys (names + multi-word aliases such as "song of solomon") -> book; used for bare-name references and prefix matching. */
const FULL_NAME_KEYS = new Map<string, BookInfo>();

for (const b of BOOKS) {
  const keys = [b.id, b.name, b.short, ...b.aliases].map(bookKey);
  for (const k of keys) if (!KEY_TO_BOOK.has(k)) KEY_TO_BOOK.set(k, b);
  FULL_NAME_KEYS.set(bookKey(b.name), b);
  for (const a of b.aliases) {
    // Spelled-out aliases ("song of solomon", "first corinthians", "acts of the apostles").
    if (a.includes(' ') && a.length > 8 && !/^the /.test(a)) FULL_NAME_KEYS.set(bookKey(a), b);
  }
}
FULL_NAME_KEYS.set('psalm', getBook('PSA') as BookInfo);
FULL_NAME_KEYS.set('revelations', getBook('REV') as BookInfo);

/**
 * Book names that are also ordinary English words or common personal names. Typed alone they
 * are treated as search words, not references ("job", "mark", "acts", "John"...). Followed by a
 * chapter number they are references as usual ("Mark 5"). matchBookName still finds them, so the
 * UI can offer "Open the book of Job" beside the search results.
 */
const WORDLIKE_NAMES = new Set([
  'job', 'mark', 'acts', 'numbers', 'judges', 'lamentations', 'revelation', 'revelations',
  // personal names: searching for the person is at least as likely as opening the book
  'ruth', 'esther', 'daniel', 'joel', 'amos', 'jonah', 'micah', 'nahum', 'ezra', 'nehemiah', 'isaiah', 'jeremiah',
  'ezekiel', 'hosea', 'obadiah', 'habakkuk', 'zephaniah', 'haggai', 'zechariah', 'malachi', 'joshua',
  'matthew', 'luke', 'john', 'james', 'jude', 'titus', 'philemon',
]);

/**
 * Resolve a book name / abbreviation / USFM id to a book. Exact keys first, then an unambiguous
 * prefix (at least 3 letters) of a full book name ("Gene", "Philipp", "Revel").
 */
export function findBook(name: string): BookInfo | undefined {
  const key = bookKey(name);
  if (!key) return undefined;
  const exact = KEY_TO_BOOK.get(key);
  if (exact) return exact;
  const letters = key.replace(/^\d/, '');
  if (letters.length < 3) return undefined;
  let found: BookInfo | undefined;
  for (const [k, b] of FULL_NAME_KEYS) {
    if (!k.startsWith(key)) continue;
    if (found && found !== b) return undefined; // ambiguous ("phil" handled by alias; "jo" never reaches here)
    found = b;
  }
  return found;
}

/**
 * If `input` (trimmed) is exactly a full book name — including word-like ones such as "Job" or
 * "John" that parseReference deliberately ignores — return that book. Lets the UI offer
 * "Open the book of Job" next to search results.
 */
export function matchBookName(input: string): BookInfo | undefined {
  const key = bookKey(input);
  return FULL_NAME_KEYS.get(key) ?? (/^\d/.test(key) ? KEY_TO_BOOK.get(key) : undefined);
}

/* ------------------------------------------------------------------------ */
/* Parsing                                                                   */
/* ------------------------------------------------------------------------ */

// [digit prefix | ordinal word + space] book letters [rest starting with a digit]
const REF_RE = /^(?:([1-3]) ?|(i{1,3}|first|second|third|1st|2nd|3rd) )?([a-z][a-z.' ]*?)\s*(\d.*)?$/;

/**
 * Parse a typed reference. Returns null when the input is not a reference (so it can be used as
 * a text search instead) or names an impossible chapter / verse.
 *
 *  "John 3:16", "jn 3 16", "Jn3:16", "JHN.3.16", "1 Cor 13", "1co13:4-7", "First Corinthians 13",
 *  "Ps 23", "psalm 23:1–4", "Song of Songs 2:4", "Gen 1", "Genesis" (= chapter 1), "II Kings 2",
 *  single-chapter books: "Jude 3" / "Phlm 4" = verse 3 / 4 of chapter 1 ("Jude 1" = the chapter).
 *
 * A book typed alone is a reference only when it is spelled out in full and is not also an
 * ordinary word or personal name ("Genesis", "Romans", "1 Corinthians" yes; "job", "mark",
 * "acts", "John" no) — see matchBookName for those.
 */
export function parseReference(input: string, opts: ParseOptions = {}): VerseRef | null {
  const s = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s.length > 60) return null;
  const m = REF_RE.exec(s);
  if (!m) return null;
  const prefix = m[1] ?? (m[2] ? ORDINALS[m[2]] : '');
  const bookText = m[3].replace(/\b(?:chapter|chap|ch)\.?\s*$/, '').replace(/[.' ]+$/g, '');
  const rest = m[4];

  const key = bookKey(prefix + bookText);
  const book = findBook(key);
  if (!book) return null;

  if (!rest) {
    // A bare book name: only spelled-out, non-word-like names ("Genesis", "Song of Songs") or numbered books ("1 Cor").
    const bareOk = (FULL_NAME_KEYS.has(key) && !WORDLIKE_NAMES.has(key)) || (/^\d/.test(key) && KEY_TO_BOOK.has(key));
    if (!bareOk) return null;
    return { book: book.id, chapter: 1 };
  }
  return parseChapterVerse(book, rest, opts);
}

function parseChapterVerse(book: BookInfo, rest: string, opts: ParseOptions): VerseRef | null {
  let r = rest.trim();
  // Drop anything after a list separator ("3:16, 18", "3:16; 4:1"); a lone comma is a European separator ("3,16").
  if (r.includes(':') || r.includes(';')) r = r.split(/[;,]/)[0];
  else if ((r.match(/,/g) ?? []).length > 1) r = r.split(',').slice(0, 2).join(',');
  r = r
    .replace(/(\d)\s*(?:verses?|vv?)\.?\s*(?=\d)/g, '$1:')
    .replace(/\s*([:.,-])\s*/g, '$1')
    .replace(/[.,]/g, ':')
    .replace(/(\d)[a-z]+/g, '$1') // "16a", "16ff"
    .replace(/:+/g, ':')
    .replace(/ /g, ':')
    .replace(/[:-]+$/, '');
  const m = /^(\d{1,3})(?::(\d{1,3}))?(?:-(\d{1,3})(?::(\d{1,3}))?)?$/.exec(r);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] !== undefined ? Number(m[2]) : undefined;
  const c = m[3] !== undefined ? Number(m[3]) : undefined;
  const d = m[4] !== undefined ? Number(m[4]) : undefined;

  let chapter: number;
  let verse: number | undefined;
  let verseEnd: number | undefined;
  if (b === undefined) {
    if (book.chapters === 1 && (a > 1 || c !== undefined)) {
      // "Jude 3", "Phlm 4-6": a number after a single-chapter book is a verse.
      chapter = 1;
      verse = a;
      verseEnd = d === undefined ? c : undefined;
    } else {
      chapter = a; // "Gen 1", "Gen 1-3" (chapter range: open the first chapter)
    }
  } else {
    chapter = a;
    verse = b;
    if (c !== undefined) {
      if (d === undefined) verseEnd = c; // "3:16-18"
      else if (c === a) verseEnd = d; // "3:16-3:18"
      // else a cross-chapter range: keep just the starting verse
    }
  }

  if (chapter < 1 || chapter > book.chapters) return null;
  if (verse !== undefined) {
    const count = opts.verseCount?.(book.id, chapter) ?? MAX_VERSE;
    if (verse < 1 || verse > count) return null;
    if (verseEnd !== undefined) {
      if (verseEnd < verse) return null;
      verseEnd = Math.min(verseEnd, count);
      if (verseEnd === verse) verseEnd = undefined;
    }
  }
  const ref: VerseRef = { book: book.id, chapter };
  if (verse !== undefined) ref.verse = verse;
  if (verseEnd !== undefined) ref.verseEnd = verseEnd;
  return ref;
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                                */
/* ------------------------------------------------------------------------ */

export type RefStyle = 'long' | 'short';

/**
 * "John 3:16", "John 3:16–18", "Psalm 23" (long) / "John 3:16", "Ps 23", "1 Cor 13:4–7" (short).
 * Single-chapter books omit the chapter: "Jude 3", "Philemon". Ranges use an en dash.
 * Short style uses the SBL abbreviations from books.ts (John stays "John").
 */
export function formatReference(ref: VerseRef, style: RefStyle = 'long'): string {
  const book = getBook(ref.book);
  if (!book) return `${ref.book} ${ref.chapter}${ref.verse ? `:${ref.verse}` : ''}`;
  let name = style === 'short' ? book.short : book.name;
  // "Psalms 23" reads wrong: a single psalm is "Psalm 23".
  if (book.id === 'PSA' && style === 'long') name = 'Psalm';
  const verses = ref.verse ? `${ref.verse}${ref.verseEnd && ref.verseEnd !== ref.verse ? `–${ref.verseEnd}` : ''}` : '';
  if (book.chapters === 1) return verses ? `${name} ${verses}` : style === 'long' ? book.name : book.short;
  return verses ? `${name} ${ref.chapter}:${verses}` : `${name} ${ref.chapter}`;
}

/** Book-and-chapter label: "John 3", "Psalm 23", "Jude". */
export function formatChapter(book: BookId, chapter: number, style: RefStyle = 'long'): string {
  return formatReference({ book, chapter }, style);
}

/* ------------------------------------------------------------------------ */
/* Hash routes                                                               */
/* ------------------------------------------------------------------------ */

/** "#/BSB/JHN/3/16" (or "#/BSB/JHN/3/16-18", "#/BSB/JHN/3"). */
export function refToHash(tr: string, ref: VerseRef): string {
  let h = `#/${encodeURIComponent(tr)}/${ref.book}/${ref.chapter}`;
  if (ref.verse) {
    h += `/${ref.verse}`;
    if (ref.verseEnd && ref.verseEnd !== ref.verse) h += `-${ref.verseEnd}`;
  }
  return h;
}

/**
 * Parse a reading route. Accepts "#/BSB/JHN/3/16", "/BSB/jhn/3", "BSB/JHN/3/16-18". Returns null
 * for other routes (e.g. "#/search?q=…") or an unknown book / impossible chapter.
 */
export function hashToRef(hash: string): { tr: string; ref: VerseRef } | null {
  const path = hash.replace(/^#/, '').replace(/^\//, '').split(/[?#]/)[0];
  const m = /^([^/]+)\/([0-9A-Za-z]{3})\/(\d{1,3})(?:\/(\d{1,3})(?:-(\d{1,3}))?)?\/?$/.exec(path);
  if (!m) return null;
  const book = getBook(m[2]);
  if (!book) return null;
  const chapter = Number(m[3]);
  if (chapter < 1 || chapter > book.chapters) return null;
  const ref: VerseRef = { book: book.id, chapter };
  if (m[4]) {
    const v = Number(m[4]);
    if (v < 1) return null;
    ref.verse = v;
    if (m[5] && Number(m[5]) > v) ref.verseEnd = Number(m[5]);
  }
  let tr: string;
  try {
    tr = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return { tr, ref };
}

/** True when two refs point at the same chapter. */
export function sameChapter(a: VerseRef, b: VerseRef): boolean {
  return a.book === b.book && a.chapter === b.chapter;
}

/** Does `ref` (a verse or range) include verse `v`? A chapter-only ref includes nothing. */
export function refIncludes(ref: VerseRef, v: number): boolean {
  if (!ref.verse) return false;
  return v >= ref.verse && v <= (ref.verseEnd ?? ref.verse);
}
