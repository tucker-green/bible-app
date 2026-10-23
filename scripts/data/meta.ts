/**
 * Stage "meta": public/data/meta.json (DataMeta) — books with verse counts, the bundled
 * translations, credits for every dataset, and the data set's identity.
 *
 * Verse counts: verses[c - 1] is the highest verse number any bundled translation has in chapter c
 * (the BSB omits a few verses, e.g. Matt 17:21; the WEB has Rom 14:24–26), so a reference to any
 * verse that exists in some translation is valid.
 * `version` is a content hash of every other file under public/data/ (paths, sizes and contents), so
 * it changes whenever the data does and never otherwise: the app appends it to data URLs (?v=) and
 * clears its offline caches when it changes (src/lib/offline.ts dataStamp, src/pwa.ts).
 * A translation is listed only when public/data/text/{ID} exists.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { BookMeta, DataMeta, TextChapter, TranslationMeta } from '../../src/lib/types';
import { BOOKS, log, outPath, readJson, writeJson } from './common';

/** Data format generation; part of the content identity (bump to force a refresh without content changes). */
export const DATA_FORMAT = '2';

/** Every file under `dir` (relative paths with "/", sorted), meta.json excluded. */
export function dataFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.filter((f) => f !== 'meta.json').sort();
}

/**
 * Content identity of the data set: the first 12 hex digits of a SHA-256 over the format generation
 * and each file's path, size and SHA-1 (meta.json itself excluded).
 */
export function dataVersion(dir: string, files: readonly string[] = dataFiles(dir), extra = ''): string {
  const h = createHash('sha256').update(`rootword-data ${DATA_FORMAT}\n${extra}\n`);
  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    h.update(`${f}\t${buf.length}\t${createHash('sha1').update(buf).digest('hex')}\n`);
  }
  return h.digest('hex').slice(0, 12);
}

const OPEN_BIBLES = 'https://github.com/seven1m/open-bibles';

// The KJV is the app's default translation (owner's decision), so it is listed first.
export const TRANSLATIONS: TranslationMeta[] = [
  {
    id: 'KJV',
    name: 'King James Version',
    abbr: 'KJV',
    year: '1769',
    license: 'Public domain (Crown copyright in the UK)',
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

const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';

/** Credits always shown (core text, alignments, original-language data, lexicons). */
const CORE_CREDITS: Credit[] = [
  { name: 'Berean Standard Bible', license: 'Public domain', url: 'https://berean.bible' },
  {
    name: 'Clear-Bible Alignments (BSB ↔ Greek / Hebrew)',
    license: 'CC BY 4.0',
    licenseUrl: CC_BY_4,
    url: 'https://github.com/Clear-Bible/Alignments',
    note: 'Hand-made word alignment of the BSB to the SBLGNT and WLC by Clear Bible / Biblica. About 750 verses whose records pair each word with a neighbour’s English were re-paired automatically by Rootword (marked as approximate links).',
  },
  {
    name: 'SBL Greek New Testament (SBLGNT)',
    license: 'CC BY 4.0',
    licenseUrl: CC_BY_4,
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
    name: 'MACULA Hebrew Linguistic Datasets',
    license: 'CC BY 4.0',
    licenseUrl: CC_BY_4,
    url: 'https://github.com/Clear-Bible/macula-hebrew/',
    note: 'MACULA Hebrew Linguistic Datasets © 2022–2024 Biblica, Inc., available at https://github.com/Clear-Bible/macula-hebrew/. Lemmas, transliteration, glosses and Septuagint-equivalent Greek words (Rootword corrects the Greek column’s swapped χ / ξ and strips CATSS markup).',
  },
  {
    name: 'Open Scriptures Hebrew Bible morphology (via MACULA Hebrew)',
    license: 'CC BY 4.0',
    licenseUrl: CC_BY_4,
    url: 'https://hb.openscriptures.org',
    note: 'The Hebrew morphology codes shown as grammar.',
  },
  {
    name: 'Cherith Glosses for the Hebrew Old Testament (via MACULA Hebrew)',
    license: 'CC BY 4.0',
    licenseUrl: CC_BY_4,
    url: 'https://github.com/Clear-Bible/macula-hebrew/',
    note: 'By Andi Wu, © 2022 Cherith Analytics: the English glosses of Hebrew words.',
  },
  {
    name: 'STEPBible lexicons (TBESG, TBESH)',
    license: 'CC BY 4.0',
    licenseUrl: CC_BY_4,
    url: 'https://github.com/STEPBible/STEPBible-Data',
    note:
      'Tyndale House, Cambridge (STEPBible.org). Greek: brief definitions from Abbott-Smith’s Manual Greek Lexicon. Hebrew: glosses and parts of speech only — TBESH’s definitions are Online Bible’s Abridged BDB (© Larry Pierce), which needs Online Bible’s permission, so Rootword does not include them.',
  },
  {
    name: 'Strong’s Greek and Hebrew dictionaries (OpenScriptures JSON edition)',
    license: 'CC BY-SA',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    url: 'https://github.com/openscriptures/strongs',
    note:
      'JSON edition © Open Scriptures (Greek 2009, Hebrew 2010; Hebrew data cleaned by David Instone-Brewer, corrections and transliterations by David Troidl), marked CC BY-SA (no version stated), based on Strong’s 1890 dictionaries (public domain). Shared alike: the Strong’s fields of Rootword’s lexicon files (strongsDef, kjv, deriv) are under CC BY-SA.',
  },
];

const KJV_CREDIT: Credit = {
  name: 'King James Version with Strong’s numbers (CrossWire)',
  license: 'Public domain text; tagging: CrossWire general licence',
  url: 'https://crosswire.org',
  note:
    'KJV text public domain outside the UK (Crown copyright, administered by Cambridge University Press, within the UK). Strong’s and morphology tagging © CrossWire Bible Society 2003–2023 (OT Strong’s from the Bible Foundation, NT from the KJV2003 Project), licensed for any purpose. Via npm @metaxia/scriptures-source-crosswire-kjv.',
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
  name: 'King James Version red-letter markup and Psalm titles (eBible.org edition, via open-bibles)',
  license: 'Public domain',
  url: OPEN_BIBLES,
  note: 'The words of Jesus as marked in eng-kjv.osis.xml, carried over to the other translations through the word links; the KJV’s Psalm titles, which the CrossWire module lacks.',
};

const XREF_CREDIT: Credit = {
  name: 'OpenBible.info cross references',
  license: 'CC BY',
  licenseUrl: CC_BY_4,
  url: 'https://www.openbible.info/labs/cross-references/',
  note: 'About 340,000 community-voted cross references, derived in part from the Treasury of Scripture Knowledge, under a Creative Commons Attribution licence (the file is marked “CC-BY”); downloaded via the scrollmapper/bible_databases mirror.',
};

const NAMES_CREDIT: Credit = {
  name: 'STEPBible TIPNR — Translators Individualised Proper Names with all References',
  license: 'CC BY 4.0',
  licenseUrl: CC_BY_4,
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

/** Highest verse number per chapter of each book, over every bundled translation present. */
export function verseCounts(present: readonly string[]): BookMeta[] {
  return BOOKS.map((b) => {
    const verses: number[] = [];
    for (let c = 1; c <= b.chapters; c++) {
      const p = outPath('text', 'BSB', b.id, `${c}.json`);
      if (!existsSync(p)) throw new Error(`Missing ${p}; run the bsb stage first.`);
      let max = 0;
      for (const tr of present) {
        const f = outPath('text', tr, b.id, `${c}.json`);
        if (!existsSync(f)) continue;
        for (const v of readJson<TextChapter>(f).verses) max = Math.max(max, v.v);
      }
      verses.push(max);
    }
    return { id: b.id, num: b.num, name: b.name, short: b.short, testament: b.testament, verses };
  });
}

export function buildMeta(): void {
  const present = TRANSLATIONS.map((t) => t.id).filter((id) => existsSync(outPath('text', id)));
  const books = verseCounts(present);
  const files = dataFiles(outPath());
  const meta: DataMeta = {
    version: '',
    generated: new Date().toISOString().slice(0, 10),
    ...metaFor((id) => present.includes(id), studyDataPresent()),
    books,
  };
  // The identity covers meta.json's own content too (credits, verse counts), minus the version itself.
  meta.version = dataVersion(outPath(), files, JSON.stringify({ ...meta, generated: '' }));
  const bytes = writeJson(outPath('meta.json'), meta);
  const totalVerses = books.reduce((n, b) => n + b.verses.reduce((a, v) => a + v, 0), 0);
  log(
    'meta',
    `${books.length} books, ${totalVerses} verse slots; translations: ${meta.translations.map((t) => t.id).join(', ')}; ` +
      `data version ${meta.version} over ${files.length} files; ${bytes} bytes`,
  );
}
