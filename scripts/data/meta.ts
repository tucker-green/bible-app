/**
 * Stage "meta": public/data/meta.json (DataMeta) — books with verse counts, the bundled
 * translations, and credits for every dataset.
 *
 * Verse counts come from the BSB text files: verses[c - 1] is the highest verse number in chapter c
 * (the BSB omits a few verses, e.g. Matt 17:21, so this is not always the number of verses present).
 * A translation is listed only when public/data/text/{ID} exists.
 */
import { existsSync } from 'node:fs';
import type { BookMeta, DataMeta, TextChapter, TranslationMeta } from '../../src/lib/types';
import { BOOKS, log, outPath, readJson, writeJson } from './common';

export const DATA_VERSION = '1';

const OPEN_BIBLES = 'https://github.com/seven1m/open-bibles';

// The KJV is the app's default translation (owner's decision), so it is listed first.
export const TRANSLATIONS: TranslationMeta[] = [
  {
    id: 'KJV',
    name: 'King James Version',
    abbr: 'KJV',
    year: '1769',
    license: 'Public domain',
    alignment: 'strongs',
    description:
      'The classic 1611 translation in its 1769 Oxford edition. Words are linked through the Strong’s numbers tagged in the CrossWire text.',
    source: 'https://crosswire.org',
  },
  {
    id: 'BSB',
    name: 'Berean Standard Bible',
    abbr: 'BSB',
    year: '2022',
    license: 'Public domain',
    alignment: 'manual',
    description:
      'A modern, readable translation that stays close to the Greek and Hebrew. Every word is linked to the original by hand (Clear-Bible / Biblica alignment).',
    source: 'https://berean.bible',
  },
  {
    id: 'WEB',
    name: 'World English Bible',
    abbr: 'WEB',
    year: '2000',
    license: 'Public domain',
    alignment: 'bridged',
    description:
      'A modern-English update of the American Standard Version. Links to the Greek and Hebrew are matched automatically through the BSB and are approximate.',
    source: OPEN_BIBLES,
  },
  {
    id: 'ASV',
    name: 'American Standard Version',
    abbr: 'ASV',
    year: '1901',
    license: 'Public domain',
    alignment: 'bridged',
    description:
      'A formal, word-for-word revision of the King James Version. Links to the Greek and Hebrew are matched automatically through the BSB and are approximate.',
    source: OPEN_BIBLES,
  },
  {
    id: 'YLT',
    name: 'Young’s Literal Translation',
    abbr: 'YLT',
    year: '1898',
    license: 'Public domain',
    alignment: 'bridged',
    description:
      'Robert Young’s strictly literal rendering, keeping Hebrew and Greek tenses and word order. Links are matched automatically through the BSB and are approximate.',
    source: 'https://github.com/scrollmapper/bible_databases',
  },
];

type Credit = DataMeta['credits'][number];

/** Credits always shown (core text, alignments, original-language data, lexicons). */
const CORE_CREDITS: Credit[] = [
  { name: 'Berean Standard Bible', license: 'Public domain', url: 'https://berean.bible' },
  {
    name: 'Clear-Bible Alignments (BSB ↔ Greek / Hebrew)',
    license: 'CC BY 4.0',
    url: 'https://github.com/Clear-Bible/Alignments',
    note: 'Hand-made word alignment of the BSB to the SBLGNT and WLC by Clear Bible / Biblica.',
  },
  {
    name: 'SBL Greek New Testament (SBLGNT)',
    license: 'CC BY 4.0',
    url: 'https://sblgnt.com',
    note: 'Society of Biblical Literature and Logos Bible Software; word list, lemmas and parsing via Clear-Bible.',
  },
  {
    name: 'Westminster Leningrad Codex (WLC)',
    license: 'Public domain',
    url: 'https://tanach.us',
    note: 'Hebrew and Aramaic text of the Old Testament, morpheme-segmented edition via Clear-Bible.',
  },
  {
    name: 'Macula Hebrew',
    license: 'CC BY 4.0',
    url: 'https://github.com/Clear-Bible/macula-hebrew',
    note: 'Lemmas, morphology, transliteration, glosses and Septuagint-equivalent Greek words.',
  },
  {
    name: 'STEPBible lexicons (TBESG, TBESH)',
    license: 'CC BY 4.0',
    url: 'https://www.stepbible.org',
    note: 'Brief Greek and Hebrew lexicons by Tyndale House, Cambridge.',
  },
  {
    name: 'Strong’s Greek and Hebrew dictionaries',
    license: 'Public domain',
    url: 'https://github.com/openscriptures/strongs',
    note: 'OpenScriptures edition.',
  },
];

const KJV_CREDIT: Credit = {
  name: 'King James Version with Strong’s numbers',
  license: 'Public domain',
  url: 'https://crosswire.org',
  note: 'CrossWire Bible Society KJV module.',
};

const OPEN_BIBLES_CREDIT: Credit = {
  name: 'open-bibles (World English Bible, American Standard Version)',
  license: 'Public domain',
  url: OPEN_BIBLES,
};

const YLT_CREDIT: Credit = {
  name: 'Young’s Literal Translation (1898), via scrollmapper/bible_databases',
  license: 'Public domain',
  url: 'https://github.com/scrollmapper/bible_databases',
};

const RED_LETTER_CREDIT: Credit = {
  name: 'King James Version red-letter markup (eBible.org edition, via open-bibles)',
  license: 'Public domain',
  url: OPEN_BIBLES,
  note: 'The words of Jesus as marked in eng-kjv.osis.xml; carried over to the other translations through the word links.',
};

const XREF_CREDIT: Credit = {
  name: 'OpenBible.info cross references',
  license: 'CC BY',
  url: 'https://www.openbible.info/labs/cross-references/',
  note: 'About 340,000 community-voted cross references, derived in part from the Treasury of Scripture Knowledge.',
};

const NAMES_CREDIT: Credit = {
  name: 'STEPBible TIPNR — Translators Individualised Proper Names with all References',
  license: 'CC BY 4.0',
  url: 'https://github.com/STEPBible/STEPBible-Data',
  note: 'People, places and family links by Tyndale House, Cambridge (STEPBible.org).',
};

/** Optional datasets: present when their pipeline stage has produced output. */
export interface StudyData {
  /** The redletter stage marked the KJV (TextVerse.wj). */
  redLetter?: boolean;
  /** public/data/xref exists. */
  xrefs?: boolean;
  /** public/data/names exists. */
  names?: boolean;
}

/** Translations / credits for the given set of present translation ids and study datasets. */
export function metaFor(present: (id: string) => boolean, data: StudyData = {}): Pick<DataMeta, 'translations' | 'credits'> {
  const translations = TRANSLATIONS.filter((t) => present(t.id));
  const credits = [...CORE_CREDITS];
  if (present('KJV')) credits.push(KJV_CREDIT);
  if (['WEB', 'ASV'].some(present)) credits.push(OPEN_BIBLES_CREDIT);
  if (present('YLT')) credits.push(YLT_CREDIT);
  if (data.redLetter) credits.push(RED_LETTER_CREDIT);
  if (data.xrefs) credits.push(XREF_CREDIT);
  if (data.names) credits.push(NAMES_CREDIT);
  return { translations, credits };
}

/** Which optional datasets public/data/ holds (see StudyData). */
export function studyDataPresent(): StudyData {
  const sermon = outPath('text', 'KJV', 'MAT', '5.json');
  const redLetter = existsSync(sermon) && readJson<TextChapter>(sermon).verses.some((v) => v.wj?.length);
  return { redLetter, xrefs: existsSync(outPath('xref')), names: existsSync(outPath('names')) };
}

export function buildMeta(): void {
  const books: BookMeta[] = BOOKS.map((b) => {
    const verses: number[] = [];
    for (let c = 1; c <= b.chapters; c++) {
      const p = outPath('text', 'BSB', b.id, `${c}.json`);
      if (!existsSync(p)) throw new Error(`Missing ${p}; run the bsb stage first.`);
      const ch = readJson<TextChapter>(p);
      verses.push(ch.verses.reduce((m, v) => Math.max(m, v.v), 0));
    }
    return { id: b.id, num: b.num, name: b.name, short: b.short, testament: b.testament, verses };
  });
  const meta: DataMeta = {
    version: DATA_VERSION,
    generated: new Date().toISOString().slice(0, 10),
    ...metaFor((id) => existsSync(outPath('text', id)), studyDataPresent()),
    books,
  };
  const bytes = writeJson(outPath('meta.json'), meta);
  const totalVerses = books.reduce((n, b) => n + b.verses.reduce((a, v) => a + v, 0), 0);
  log('meta', `${books.length} books, ${totalVerses} verse slots; translations: ${meta.translations.map((t) => t.id).join(', ')}; ${bytes} bytes`);
}
