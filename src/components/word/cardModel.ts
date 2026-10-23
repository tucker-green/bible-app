/**
 * What the word card shows for a unit, derived from the chapter data (pure, unit-tested).
 * Lexicon entries and concordance counts are loaded separately by the card component.
 */
import { getBook } from '../../lib/books';
import { baseStrongs, normalizeStrongs, toWord, wordGroup } from '../../lib/data';
import type { Word } from '../../lib/data';
import { transliterate } from '../../lib/greek';
import { describeMorph } from '../../lib/morph';
import type { MorphDescription } from '../../lib/morph';
import { formatReference } from '../../lib/reference';
import { OW } from '../../lib/types';
import type { ChapterModel, Unit } from '../reader/model';
import { cleanGloss } from '../reader/model';

export type CardLang = 'grc' | 'hbo' | 'arc';

export interface Morpheme {
  index: number;
  text: string;
  /** Linked by this English unit. */
  linked: boolean;
  /** The content morpheme shown in the card. */
  primary: boolean;
  gloss: string;
  pos: string;
}

export interface CardModel {
  kind: 'linked' | 'lexicon' | 'supplied';
  unitId: number;
  /** The English unit as printed. */
  english: string;
  /** "John 1:1", "Psalm 23 title", "Malachi 4:1 (Heb. 3:19)". */
  reference: string;
  testament: 'OT' | 'NT';
  lang: CardLang;
  /** "Greek" | "Hebrew" | "Aramaic" */
  langLabel: string;
  /** "SBLGNT" | "WLC" | "Textus Receptus"… */
  edition: string;
  approx: boolean;
  conf: number;
  /** The content word (null for supplied units). */
  primary: Word | null;
  /** Headword as written: Greek surface form; Hebrew: the whole written word. */
  headword: string;
  /** Hebrew: morphemes of the written word (with the linked ones marked). */
  morphemes: Morpheme[];
  /** Other original words linked by the unit (e.g. the article with a noun). */
  others: Word[];
  translit: string;
  /** Normalised Strong's id for lookups ("G3056", "H0430", "H0871a"); "" if none. */
  strongs: string;
  /** Display form without zero padding ("G3056", "H430"). */
  strongsLabel: string;
  morph: string;
  parsing: MorphDescription | null;
  gloss: string;
  lemma: string;
  /** Septuagint-equivalent Greek word (OT). */
  lxx: { text: string; strongs: string; strongsLabel: string; translit: string } | null;
  /** Lexicon-only (KJV / TR) note. */
  note: string;
}

/** "G0026" -> "G26", "H0871a" -> "H871a". */
export function displayStrongs(id: string): string {
  return id.replace(/^([GH])0+(?=\d)/, '$1');
}

const GENRE: [string, string, string][] = [
  // [first book, last book, genre]
  ['GEN', 'DEU', 'Torah'],
  ['JOS', 'EST', 'History'],
  ['JOB', 'JOB', 'Wisdom'],
  ['PSA', 'PSA', 'Poetry'],
  ['PRO', 'ECC', 'Wisdom'],
  ['SNG', 'SNG', 'Poetry'],
  ['ISA', 'DAN', 'Major Prophets'],
  ['HOS', 'MAL', 'Minor Prophets'],
  ['MAT', 'JHN', 'Gospel'],
  ['ACT', 'ACT', 'History'],
  ['ROM', 'PHM', 'Letters of Paul'],
  ['HEB', 'JUD', 'General Letters'],
  ['REV', 'REV', 'Apocalypse'],
];

/** "New Testament · Gospel", "Old Testament · Torah". */
export function bookEyebrow(bookId: string): string {
  const b = getBook(bookId);
  if (!b) return '';
  const g = GENRE.find(([from, to]) => {
    const f = getBook(from)!.num;
    const t = getBook(to)!.num;
    return b.num >= f && b.num <= t;
  });
  return `${b.testament === 'NT' ? 'New Testament' : 'Old Testament'}${g ? ` · ${g[2]}` : ''}`;
}

/** Card reference for a unit's verse. */
export function unitReference(model: ChapterModel, unit: Unit, sourceRef = ''): string {
  if (unit.verse === 0) return `${formatReference({ book: model.book, chapter: model.chapter })} title`;
  const base = formatReference({ book: model.book, chapter: model.chapter, verse: unit.verse });
  return sourceRef ? `${base} (Heb. ${sourceRef})` : base;
}

function langOf(model: ChapterModel, w: Word | null): CardLang {
  if (w) return w.lang;
  return getBook(model.book)?.testament === 'NT' ? 'grc' : 'hbo';
}

const LANG_LABEL: Record<CardLang, string> = { grc: 'Greek', hbo: 'Hebrew', arc: 'Aramaic' };

/** BCP 47 tag for markup: Greek "grc", Hebrew "he" (screen readers know it), Aramaic "arc". */
export function htmlLang(lang: CardLang): string {
  return lang === 'hbo' ? 'he' : lang;
}

export function buildCardModel(model: ChapterModel, unit: Unit): CardModel {
  const testament = getBook(model.book)?.testament ?? 'NT';
  const orig = model.orig;
  const primary = orig && unit.primary >= 0 ? (toWord(orig, unit.primary) ?? null) : null;
  const lang = langOf(model, primary);
  const base: CardModel = {
    kind: unit.kind,
    unitId: unit.id,
    english: unit.text,
    reference: unitReference(model, unit, primary?.ref ?? ''),
    testament,
    lang,
    langLabel: LANG_LABEL[lang],
    edition: orig?.edition ?? (testament === 'NT' ? 'SBLGNT' : 'WLC'),
    approx: unit.approx,
    conf: unit.conf,
    primary,
    headword: '',
    morphemes: [],
    others: [],
    translit: '',
    strongs: '',
    strongsLabel: '',
    morph: '',
    parsing: null,
    gloss: '',
    lemma: '',
    lxx: null,
    note: '',
  };

  if (unit.kind === 'supplied') return base;

  if (unit.kind === 'lexicon' || !primary || !orig) {
    const sid = unit.strongs[0] ? (normalizeStrongs(unit.strongs[0]) ?? unit.strongs[0]) : '';
    const form = unit.forms[0] ?? '';
    const morph = unit.morphs[0] ?? '';
    const l: CardLang = sid.startsWith('H') ? 'hbo' : sid.startsWith('G') ? 'grc' : lang;
    return {
      ...base,
      kind: 'lexicon',
      lang: l,
      langLabel: LANG_LABEL[l],
      edition: testament === 'NT' ? 'Textus Receptus' : base.edition,
      headword: form,
      translit: form && l === 'grc' ? transliterate(form) : '',
      strongs: sid,
      strongsLabel: displayStrongs(sid),
      morph,
      parsing: morph ? describeMorph(morph, l) : null,
      note:
        testament === 'NT'
          ? 'This word is in the Greek text the KJV translated (the Textus Receptus) but not in the SBL Greek New Testament.'
          : 'The KJV’s Strong’s number for this word could not be matched to a word of the Hebrew text in this verse.',
    };
  }

  // Linked word(s)
  const lxx = primary.lxx;
  let headword = primary.text;
  let morphemes: Morpheme[] = [];
  let translit = primary.translit;
  if (orig.lang === 'hbo') {
    const group = wordGroup(orig, primary.index);
    morphemes = group.map((i) => {
      const w = orig.words[i];
      return {
        index: i,
        text: w[OW.text],
        linked: unit.links.includes(i),
        primary: i === primary.index,
        gloss: cleanGloss(w[OW.gloss]),
        pos: describeMorph(w[OW.morph], isAramaicWord(orig, i) ? 'arc' : 'hbo').pos,
      };
    });
    headword = morphemes.map((m) => m.text).join('');
    translit = primary.translit || group.map((i) => orig.words[i][OW.translit]).join('');
  } else if (!translit) {
    translit = transliterate(primary.text);
  }

  const groupSet = new Set(morphemes.map((m) => m.index));
  const others = unit.links
    .filter((i) => i !== primary.index && !groupSet.has(i))
    .map((i) => toWord(orig, i))
    .filter((w): w is Word => Boolean(w));

  // Hebrew: the gloss of every linked morpheme in the primary's written word, joined.
  const gloss =
    orig.lang === 'hbo'
      ? cleanGloss(
          morphemes
            .filter((m) => m.linked)
            .map((m) => m.gloss)
            .join(' '),
        ) || cleanGloss(primary.gloss)
      : cleanGloss(primary.gloss);

  const strongs = normalizeStrongs(primary.strongs) ?? primary.strongs;
  return {
    ...base,
    headword,
    morphemes: morphemes.length > 1 ? morphemes : [],
    others,
    translit,
    strongs,
    strongsLabel: displayStrongs(strongs),
    morph: primary.morph,
    parsing: primary.morph ? describeMorph(primary.morph, primary.lang) : null,
    gloss,
    lemma: primary.lemma,
    lxx: lxx
      ? {
          text: lxx.text.normalize('NFC'),
          strongs: /^G\d/.test(lxx.strongs) ? (normalizeStrongs(lxx.strongs) ?? '') : '',
          strongsLabel: /^G\d/.test(lxx.strongs) ? displayStrongs(normalizeStrongs(lxx.strongs) ?? lxx.strongs) : '',
          translit: transliterate(lxx.text.normalize('NFC')),
        }
      : null,
  };
}

function isAramaicWord(orig: NonNullable<ChapterModel['orig']>, i: number): boolean {
  return Boolean(orig.aramaic?.includes(i));
}

/** Base Strong's used for concordance / related lookups. */
export function cardBaseStrongs(c: CardModel): string {
  return c.strongs ? baseStrongs(c.strongs) : '';
}

/** A one-line spoken summary for the live region: "λόγος, logos, noun: word". */
export function cardSummary(c: CardModel): string {
  if (c.kind === 'supplied') return `${c.english}: supplied by the translators, no original word.`;
  const pos = c.parsing?.ok ? c.parsing.pos.toLowerCase() : '';
  const parts = [c.headword, c.translit].filter(Boolean).join(', ');
  const gloss = c.gloss ? `: ${c.gloss}` : '';
  return `${parts}${pos ? `, ${pos}` : ''}${gloss}`;
}
