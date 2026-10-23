/**
 * Static canon: the 66 books of the Protestant canon in English order.
 * Verse counts per chapter live in public/data/meta.json (generated from the BSB);
 * everything else about a book is here so the app can render navigation before
 * any data has loaded.
 */
import type { BookId } from './types';

export interface BookInfo {
  id: BookId;
  num: number;
  name: string;
  short: string;
  testament: 'OT' | 'NT';
  chapters: number;
  /** Lower-case aliases accepted by the reference parser (besides id, name and short). */
  aliases: string[];
}

type Row = [id: string, name: string, short: string, chapters: number, aliases: string[]];

const OT: Row[] = [
  ['GEN', 'Genesis', 'Gen', 50, ['ge', 'gn', 'gen']],
  ['EXO', 'Exodus', 'Exod', 40, ['ex', 'exo', 'exod']],
  ['LEV', 'Leviticus', 'Lev', 27, ['le', 'lv', 'lev']],
  ['NUM', 'Numbers', 'Num', 36, ['nu', 'nm', 'nb', 'num']],
  ['DEU', 'Deuteronomy', 'Deut', 34, ['dt', 'de', 'deut', 'deu']],
  ['JOS', 'Joshua', 'Josh', 24, ['jos', 'jsh', 'josh']],
  ['JDG', 'Judges', 'Judg', 21, ['jdg', 'jg', 'jdgs', 'judg']],
  ['RUT', 'Ruth', 'Ruth', 4, ['ru', 'rth', 'rut']],
  ['1SA', '1 Samuel', '1 Sam', 31, ['1sa', '1sam', '1 sam', '1sm', '1s', 'i sam', 'i samuel', 'first samuel', '1st samuel']],
  ['2SA', '2 Samuel', '2 Sam', 24, ['2sa', '2sam', '2 sam', '2sm', '2s', 'ii sam', 'ii samuel', 'second samuel', '2nd samuel']],
  ['1KI', '1 Kings', '1 Kgs', 22, ['1ki', '1kgs', '1 kgs', '1kg', '1k', 'i kings', 'first kings', '1st kings']],
  ['2KI', '2 Kings', '2 Kgs', 25, ['2ki', '2kgs', '2 kgs', '2kg', '2k', 'ii kings', 'second kings', '2nd kings']],
  ['1CH', '1 Chronicles', '1 Chr', 29, ['1ch', '1chr', '1 chr', '1chron', '1 chron', 'i chronicles', 'first chronicles', '1st chronicles']],
  ['2CH', '2 Chronicles', '2 Chr', 36, ['2ch', '2chr', '2 chr', '2chron', '2 chron', 'ii chronicles', 'second chronicles', '2nd chronicles']],
  ['EZR', 'Ezra', 'Ezra', 10, ['ezr', 'ez']],
  ['NEH', 'Nehemiah', 'Neh', 13, ['ne', 'neh']],
  ['EST', 'Esther', 'Esth', 10, ['es', 'est', 'esth']],
  ['JOB', 'Job', 'Job', 42, ['jb']],
  ['PSA', 'Psalms', 'Ps', 150, ['ps', 'psa', 'psalm', 'pss', 'psm', 'pslm']],
  ['PRO', 'Proverbs', 'Prov', 31, ['pr', 'prv', 'pro', 'prov']],
  ['ECC', 'Ecclesiastes', 'Eccl', 12, ['ec', 'ecc', 'eccl', 'eccles', 'qoheleth']],
  ['SNG', 'Song of Songs', 'Song', 8, ['song', 'sos', 'so', 'sng', 'song of solomon', 'canticles', 'canticle of canticles']],
  ['ISA', 'Isaiah', 'Isa', 66, ['is', 'isa']],
  ['JER', 'Jeremiah', 'Jer', 52, ['je', 'jr', 'jer']],
  ['LAM', 'Lamentations', 'Lam', 5, ['la', 'lam']],
  ['EZK', 'Ezekiel', 'Ezek', 48, ['eze', 'ezk', 'ezek']],
  ['DAN', 'Daniel', 'Dan', 12, ['da', 'dn', 'dan']],
  ['HOS', 'Hosea', 'Hos', 14, ['ho', 'hos']],
  ['JOL', 'Joel', 'Joel', 3, ['jl', 'joe', 'jol']],
  ['AMO', 'Amos', 'Amos', 9, ['am', 'amo']],
  ['OBA', 'Obadiah', 'Obad', 1, ['ob', 'oba', 'obad']],
  ['JON', 'Jonah', 'Jonah', 4, ['jnh', 'jon']],
  ['MIC', 'Micah', 'Mic', 7, ['mi', 'mic']],
  ['NAM', 'Nahum', 'Nah', 3, ['na', 'nah', 'nam']],
  ['HAB', 'Habakkuk', 'Hab', 3, ['hb', 'hab']],
  ['ZEP', 'Zephaniah', 'Zeph', 3, ['zp', 'zep', 'zeph']],
  ['HAG', 'Haggai', 'Hag', 2, ['hg', 'hag']],
  ['ZEC', 'Zechariah', 'Zech', 14, ['zc', 'zec', 'zech']],
  ['MAL', 'Malachi', 'Mal', 4, ['ml', 'mal']],
];

const NT: Row[] = [
  ['MAT', 'Matthew', 'Matt', 28, ['mt', 'mat', 'matt']],
  ['MRK', 'Mark', 'Mark', 16, ['mk', 'mrk', 'mr', 'mar']],
  ['LUK', 'Luke', 'Luke', 24, ['lk', 'luk', 'lu']],
  ['JHN', 'John', 'John', 21, ['jn', 'jhn', 'joh']],
  ['ACT', 'Acts', 'Acts', 28, ['ac', 'act', 'acts of the apostles']],
  ['ROM', 'Romans', 'Rom', 16, ['ro', 'rm', 'rom']],
  ['1CO', '1 Corinthians', '1 Cor', 16, ['1co', '1cor', '1 cor', 'i cor', 'i corinthians', 'first corinthians', '1st corinthians']],
  ['2CO', '2 Corinthians', '2 Cor', 13, ['2co', '2cor', '2 cor', 'ii cor', 'ii corinthians', 'second corinthians', '2nd corinthians']],
  ['GAL', 'Galatians', 'Gal', 6, ['ga', 'gal']],
  ['EPH', 'Ephesians', 'Eph', 6, ['ep', 'eph', 'ephes']],
  ['PHP', 'Philippians', 'Phil', 4, ['php', 'phil', 'pp', 'philip']],
  ['COL', 'Colossians', 'Col', 4, ['co', 'col']],
  ['1TH', '1 Thessalonians', '1 Thess', 5, ['1th', '1thess', '1 thess', '1 thes', 'i thess', 'i thessalonians', 'first thessalonians', '1st thessalonians']],
  ['2TH', '2 Thessalonians', '2 Thess', 3, ['2th', '2thess', '2 thess', '2 thes', 'ii thess', 'ii thessalonians', 'second thessalonians', '2nd thessalonians']],
  ['1TI', '1 Timothy', '1 Tim', 6, ['1ti', '1tim', '1 tim', 'i tim', 'i timothy', 'first timothy', '1st timothy']],
  ['2TI', '2 Timothy', '2 Tim', 4, ['2ti', '2tim', '2 tim', 'ii tim', 'ii timothy', 'second timothy', '2nd timothy']],
  ['TIT', 'Titus', 'Titus', 3, ['ti', 'tit']],
  ['PHM', 'Philemon', 'Phlm', 1, ['phm', 'phlm', 'philem', 'pm']],
  ['HEB', 'Hebrews', 'Heb', 13, ['he', 'heb']],
  ['JAS', 'James', 'Jas', 5, ['jas', 'jm', 'jam']],
  ['1PE', '1 Peter', '1 Pet', 5, ['1pe', '1pet', '1 pet', '1pt', '1p', 'i pet', 'i peter', 'first peter', '1st peter']],
  ['2PE', '2 Peter', '2 Pet', 3, ['2pe', '2pet', '2 pet', '2pt', '2p', 'ii pet', 'ii peter', 'second peter', '2nd peter']],
  ['1JN', '1 John', '1 John', 5, ['1jn', '1jhn', '1 jn', '1jo', '1joh', 'i john', 'first john', '1st john']],
  ['2JN', '2 John', '2 John', 1, ['2jn', '2jhn', '2 jn', '2jo', '2joh', 'ii john', 'second john', '2nd john']],
  ['3JN', '3 John', '3 John', 1, ['3jn', '3jhn', '3 jn', '3jo', '3joh', 'iii john', 'third john', '3rd john']],
  ['JUD', 'Jude', 'Jude', 1, ['jud', 'jd', 'jude']],
  ['REV', 'Revelation', 'Rev', 22, ['re', 'rv', 'rev', 'revelations', 'apocalypse', 'the revelation']],
];

export const BOOKS: BookInfo[] = [
  ...OT.map((r, i) => toInfo(r, i + 1, 'OT' as const)),
  ...NT.map((r, i) => toInfo(r, i + 40, 'NT' as const)),
];

function toInfo([id, name, short, chapters, aliases]: Row, num: number, testament: 'OT' | 'NT'): BookInfo {
  return { id, num, name, short, testament, chapters, aliases };
}

const byId = new Map(BOOKS.map((b) => [b.id, b]));

export function getBook(id: BookId): BookInfo | undefined {
  return byId.get(id.toUpperCase());
}

export function getBookByNum(num: number): BookInfo | undefined {
  return BOOKS[num - 1];
}

/** Total chapters: 1189. */
export const TOTAL_CHAPTERS = BOOKS.reduce((n, b) => n + b.chapters, 0);
