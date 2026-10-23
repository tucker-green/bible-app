// @vitest-environment node
/**
 * Unit tests for the pure helpers of the core data pipeline (scripts/data/orig|bsb|concordance|search|meta).
 */
import { describe, expect, it } from 'vitest';
import {
  assignVerses,
  cleanGloss,
  cleanTranslit,
  isSuspectRecord,
  layoutWords,
  lxxOf,
  majority,
  pruneSuspectRecords,
  recordContext,
  sourceVerseMap,
  transliterateHebrewWord,
} from '../scripts/data/orig';
import { AssocTable, alignByAssociation, buildTokens, glossWords, parseUsfxLayout, spaceTokens, titleCase, tokensText, verseText } from '../scripts/data/bsb';
import { chunkIndex, indexChapter } from '../scripts/data/concordance';
import { chapterRows, plainText } from '../scripts/data/search';
import { metaFor } from '../scripts/data/meta';
import type { AlignRecord, BsbTokenRow } from '../scripts/data/common';
import { chapterKey } from '../scripts/data/common';
import type { OrigChapter, OrigWord, TextChapter } from '../src/lib/types';

const tok = (text: string, skip = false) => ({ text, skip });

describe('spaceTokens / verseText', () => {
  it('rebuilds Gen 1:3 with curly quotes', () => {
    // As in ot_BSB.tsv: opening quotes carry skip_space_after, closing punctuation does not need it.
    const t = [tok('And'), tok('God'), tok('said', true), tok(','), tok('“', true), tok('Let'), tok('there'), tok('be'), tok('light', true), tok(',', true), tok('”'), tok('and'), tok('there'), tok('was'), tok('light', true), tok('.')];
    expect(verseText(t)).toBe('And God said, “Let there be light,” and there was light.');
  });

  it('keeps the em dash tight and removes stray spaces before closing punctuation', () => {
    expect(verseText([tok('morning', true), tok('—', true), tok('the'), tok('first'), tok('day', true), tok('.')])).toBe('morning—the first day.');
    // source sometimes lacks skip flags before a dash / question mark / closing paren
    expect(verseText([tok('the'), tok('day'), tok('—'), tok('those')])).toBe('the day— those');
    expect(verseText([tok('Most'), tok('High'), tok('—')])).toBe('Most High—');
    expect(verseText([tok('Jerubbesheth'), tok('?'), tok('Was')])).toBe('Jerubbesheth? Was');
    expect(verseText([tok('('), tok('that'), tok('is', true), tok(','), tok('Zoar'), tok(')', true), tok('.')])).toBe('(that is, Zoar).');
  });

  it('never ends with a space and gives one string per token', () => {
    const t = [tok('Amen'), tok('.')];
    expect(spaceTokens(t)).toEqual(['Amen', '.']);
  });
});

describe('buildTokens', () => {
  it('turns linked words into WordTokens and merges everything else', () => {
    const spaced = ['In ', 'the ', 'beginning ', 'God ', 'created', '.'];
    const tokens = buildTokens(spaced, [[0, 1], [0, 1], [0, 1], [3], undefined, undefined], [undefined, undefined, undefined, { c: 0.5 }]);
    expect(tokens).toEqual([['In', [0, 1]], ' ', ['the', [0, 1]], ' ', ['beginning', [0, 1]], ' ', ['God', [3], { c: 0.5 }], ' created.']);
    expect(tokensText(tokens)).toBe(spaced.join(''));
  });

  it('treats empty link lists as unlinked', () => {
    expect(buildTokens(['a ', 'b'], [[], undefined])).toEqual(['a b']);
  });
});

describe('majority / sourceVerseMap', () => {
  it('picks the most frequent key, ties to the first seen', () => {
    expect(majority([])).toBeUndefined();
    expect(majority(['b', 'a', 'a'])).toBe('a');
    expect(majority(['b', 'a'])).toBe('b');
  });

  it('maps each source verse to the English verse most of its tokens are in', () => {
    const rows = [
      { id: '39004001001', srcVerse: '39003019' },
      { id: '39004001002', srcVerse: '39003019' },
      { id: '19051000001', srcVerse: '19051002' },
    ];
    const m = sourceVerseMap(rows);
    expect(m.get('39003019')).toBe('39004001');
    expect(m.get('19051002')).toBe('19051000');
  });
});

describe('assignVerses', () => {
  const exists = (keys: string[]) => (k: string) => keys.includes(k);

  it('uses the alignment, then the nearest aligned word of the same source verse', () => {
    const words = [
      { src: '39003019', aligned: ['39004001'] },
      { src: '39003019', aligned: [] },
      { src: '39003019', aligned: ['39004001', '39004001'] },
      { src: '39003020', aligned: [] }, // unaligned verse -> source_verse map
    ];
    const out = assignVerses(words, new Map([['39003020', '39004002']]), exists(['39004001', '39004002']));
    expect(out).toEqual(['39004001', '39004001', '39004001', '39004002']);
  });

  it('prefers the preceding aligned word on a tie', () => {
    const words = [
      { src: '01001001', aligned: ['01001001'] },
      { src: '01001001', aligned: [] },
      { src: '01001001', aligned: ['01001002'] },
    ];
    expect(assignVerses(words, new Map(), () => true)[1]).toBe('01001001');
  });

  it('clamps an unaligned Psalm-title verse 1 to the title (English verse 0)', () => {
    // Ps 51: Heb 51:1-2 = title (no alignment); Heb 51:2 is mapped to English 51:0 by the TSV.
    const words = [
      { src: '19050023', aligned: ['19050023'] },
      { src: '19051001', aligned: [] },
      { src: '19051002', aligned: [] },
      { src: '19051003', aligned: ['19051001'] },
    ];
    const out = assignVerses(words, new Map([['19051002', '19051000']]), exists(['19050023', '19051000', '19051001']));
    expect(out).toEqual(['19050023', '19051000', '19051000', '19051001']);
  });

  it('sends leading unaligned words of a source verse 1 to the English title', () => {
    // Ps 90:1 = "A prayer of Moses..." (title, unaligned) + verse text (aligned to English 90:1).
    const words = [
      { src: '19090001', aligned: [] },
      { src: '19090001', aligned: [] },
      { src: '19090001', aligned: ['19090001'] },
    ];
    expect(assignVerses(words, new Map(), exists(['19090000', '19090001']))).toEqual(['19090000', '19090000', '19090001']);
  });

  it('gives trailing unaligned words to an orphan English verse that claims the source verse', () => {
    // Acts 19:40 (SBLGNT) also holds English 19:41, which has no aligned words.
    const words = [
      { src: '44019040', aligned: ['44019040'] },
      { src: '44019040', aligned: [] },
      { src: '44019040', aligned: [] },
    ];
    const out = assignVerses(words, new Map(), () => true, new Map([['44019040', ['44019041']]]));
    expect(out).toEqual(['44019040', '44019041', '44019041']);
  });

  it('inherits within the book when nothing else applies', () => {
    const words = [
      { src: '64001014', aligned: ['64001014'] },
      { src: '64001015', aligned: [] }, // 3 John 15: no such English verse, no TSV mapping
    ];
    expect(assignVerses(words, new Map(), exists(['64001014']))).toEqual(['64001014', '64001014']);
  });
});

describe('layoutWords', () => {
  it('re-keys words to English chapters, in source order, with source refs', () => {
    const ids = ['o390030180011', 'o390030190011', 'o390030190021'];
    const records: AlignRecord[] = [
      [['o390030180011'], ['39003018001']],
      [['o390030190011'], ['39004001001']],
      [['o390030190021'], ['39004001002']],
    ];
    const bsb: BsbTokenRow[] = [
      { id: '39003018001', srcVerse: '39003018', text: 'x', skip: false, exclude: false },
      { id: '39004001001', srcVerse: '39003019', text: 'y', skip: false, exclude: false },
      { id: '39004001002', srcVerse: '39003019', text: 'z', skip: false, exclude: false },
    ];
    const { chapters, pos } = layoutWords(ids, records, bsb);
    expect(chapters.get('39003')).toEqual([{ id: 'o390030180011', verse: 18, ref: '' }]);
    expect(chapters.get('39004')).toEqual([
      { id: 'o390030190011', verse: 1, ref: '3:19' },
      { id: 'o390030190021', verse: 1, ref: '3:19' },
    ]);
    expect(pos.get('o390030190021')).toEqual(['39004', 1]);
  });
});

describe('suspect alignment records', () => {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(3, '0')}`);

  it('flags a whole next verse lumped onto one word, but not ordinary records', () => {
    const lumped: AlignRecord = [ids('n62002014', 27), ['62002013048']];
    expect(isSuspectRecord(lumped)).toBe(true);
    expect(isSuspectRecord([ids('n43001001', 2), ['43001001001']])).toBe(false);
    // A long Hebrew number written as one English numeral in the same verse is fine.
    expect(isSuspectRecord([ids('o04031036', 12), ['04031036014']])).toBe(false);
  });

  it('respects versification offsets via the target TSV claims', () => {
    const bsb = [{ id: '05029005001', srcVerse: '05029004' }];
    const rec: AlignRecord = [ids('o05029004', 12), ['05029005014']];
    expect(isSuspectRecord(rec)).toBe(true); // naive: different verse number
    expect(isSuspectRecord(rec, recordContext([rec], bsb))).toBe(false); // English 29:5 translates Heb 29:4
  });

  it('prunes suspect records to the sources whose gloss matches the English', () => {
    const rec: AlignRecord = [['n62002014007', 'n62002014008', 'n62002014009', 'n62002014010', 'n62002014011', 'n62002014012', 'n62002014013', 'n62002014014'], ['62002013048']];
    const gloss: Record<string, string> = { n62002014007: 'father' };
    const { records, removed } = pruneSuspectRecords([rec], (s) => gloss[s] ?? 'other', () => 'Father');
    expect(records).toEqual([[['n62002014007'], ['62002013048']]]);
    expect(removed).toBe(7);
  });
});

describe('glosses, transliteration, LXX', () => {
  it('cleans interlinear glosses', () => {
    expect(cleanGloss('the [thing]')).toBe('the thing');
    expect(cleanGloss('he.said')).toBe('he said');
    expect(cleanGloss('ages.')).toBe('ages');
    expect(cleanGloss('~ illness.')).toBe('illness');
    expect(cleanGloss('-')).toBe('');
    expect(cleanGloss('(et)')).toBe('');
    expect(cleanGloss('shadow of death')).toBe('shadow of death');
  });

  it('strips maqqef / sof pasuq marks from Macula transliterations', () => {
    expect(cleanTranslit('ʿal-')).toBe('ʿal');
    expect(cleanTranslit('ʾāreṣ:')).toBe('ʾāreṣ');
  });

  it('formats the Septuagint equivalent', () => {
    expect(lxxOf('ἐποίησεν', '4160')).toBe('ἐποίησεν|G4160');
    expect(lxxOf('ἐν|ἐμοί', '1722|1698')).toBe('ἐν ἐμοί|G1722');
    expect(lxxOf('διάψαλμα', '')).toBe('διάψαλμα|');
    expect(lxxOf('’’', '')).toBe('');
    expect(lxxOf('', '')).toBe('');
  });

  it('transliterates pointed Hebrew in Macula style', () => {
    const one = (w: string) => transliterateHebrewWord([w])[0];
    expect(one('בָּרָא')).toBe('bārāʾ');
    expect(one('אֱלֹהִים')).toBe('ʾĕlōhiym');
    expect(one('יוֹם')).toBe('yôm');
    expect(one('הוּא')).toBe('hûʾ');
    expect(one('רוּחַ')).toBe('rûᵃḥ'); // furtive patah
    expect(one('שָׁאוּל')).toBe('šāʾûl'); // aleph before shureq is not a mater
    expect(one('כָּל')).toBe('kol'); // qamets hatuf
    expect(one('יְרוּשָׁלִַם')).toBe('yərûšālaim');
  });

  it('splits a word into its morphemes with doubling and vocal sheva by context', () => {
    expect(transliterateHebrewWord(['וַ', 'יֹּאמֶר'])).toEqual(['wa', 'yyōʾmer']);
    expect(transliterateHebrewWord(['הַ', 'שָּׁמַיִם'])).toEqual(['ha', 'ššāmayim']);
    expect(transliterateHebrewWord(['שִׁבְטְ', 'ךָ'])).toEqual(['šiḇṭə', 'ḵā']);
    expect(transliterateHebrewWord(['רֹעִ', 'י'])).toEqual(['rōʿi', 'y']);
  });
});

describe('Psalm-title aligner', () => {
  it('scores co-occurrence', () => {
    const t = new AssocTable();
    t.add(['H1732'], ['david']);
    t.add(['H1732', 'H3807a'], ['of', 'david']);
    t.add(['H3807a'], ['of']);
    expect(t.geo('H1732', 'david')).toBeCloseTo(1);
    expect(t.geo('H3807a', 'david')).toBeCloseTo(Math.sqrt(0.5 * 0.5));
    expect(t.dice('H1732', 'david')).toBeCloseTo(1);
    expect(t.dice('H1732', 'of', 2)).toBe(0); // co-occur only once
    expect(t.englishCount('of')).toBe(2);
  });

  it('adds "the" for a preposition with a fused article', () => {
    expect(glossWords({ strongs: 'H3807a', gloss: 'for', morph: 'Rd' })).toEqual(new Set(['for', 'the']));
    expect(glossWords({ strongs: 'H4210', gloss: 'a psalm' })).toEqual(new Set(['a', 'psalm']));
  });

  it('links by association and position, and lets a bare "the" follow its noun', () => {
    // "For the choirmaster. A Psalm of David" vs לַ מְנַצֵּחַ מִזְמוֹר לְ דָוִד
    const orig = [
      { strongs: 'H3807a', gloss: 'for', morph: 'Rd' },
      { strongs: 'H5329', gloss: 'director' },
      { strongs: 'H4210', gloss: 'psalm' },
      { strongs: 'H3807a', gloss: 'of', morph: 'R' },
      { strongs: 'H1732', gloss: 'David' },
    ];
    const gw = orig.map(glossWords);
    const assoc = (e: string, j: number) => (gw[j].has(e) ? 0.8 : e === 'choirmaster' && j === 1 ? 0.9 : 0);
    const out = alignByAssociation(['For', 'the', 'choirmaster', 'A', 'Psalm', 'of', 'David'], orig.length, assoc);
    expect(out.map((x) => x?.[0])).toEqual([0, 0, 1, 2, 2, 3, 4]);
    expect(out[3]?.[1]).toBe(0.5); // "A" borrowed from "Psalm", low confidence
  });
});

describe('USFX headings and paragraphs', () => {
  const xml = `<usfx><book id="PSA"><id id="PSA">x</id><h>Psalms</h>
<c id="1" /><p sfm="ms" style="ms1">BOOK I</p><p sfm="mr" style="mr">Psalms 1—41</p>
<s style="s1">The Two Ways<f caller="+"><ft>note</ft></f></s><p sfm="r" style="r">(Jeremiah 17:5–8)</p>
<b style="b" /><q style="q1"><v id="1" bcv="PSA.1.1" />Blessed is the man</q><q style="q2">who does not walk<ve /></q>
<q style="q1"><v id="2" bcv="PSA.1.2" />But his delight<ve /></q><b style="b" />
<q style="q1"><v id="3" bcv="PSA.1.3" />He is like a tree<ve /></q>
<p sfm="qa" style="qa">ALEPH</p><s style="s1">(Joshua–Malachi)</s>
<p sfm="m" style="m"><v id="4" bcv="PSA.1.4" />Not so the wicked.<ve /></p></book></usfx>`;

  it('collects s1/qa/ms headings (skipping parallel references) and paragraph starts', () => {
    const lay = parseUsfxLayout(xml).get('PSA 1')!;
    expect(lay.headings).toEqual([
      [1, 'Book I'],
      [1, 'The Two Ways'],
      [4, 'Aleph'],
    ]);
    expect(lay.paras).toEqual([3, 4]);
  });

  it('title-cases all-caps headings but keeps Roman numerals', () => {
    expect(titleCase('SIN and SHIN')).toBe('Sin and Shin');
    expect(titleCase('BOOK II')).toBe('Book II');
  });
});

describe('concordance', () => {
  it('indexes base Strong’s ids by English verse, Psalm titles under verse 1', () => {
    const w = (strongs: string, verse: number): OrigWord => ['x', strongs, '', '', '', verse, '', 0, '', ''];
    const ch: OrigChapter = { book: 'PSA', chapter: 51, lang: 'hbo', edition: 'WLC', words: [w('H1732', 0), w('H0871a', 3), w('H0871', 3), w('', 4)] };
    const index = new Map<string, Set<number>>();
    indexChapter(index, 19, ch);
    expect([...index.keys()].sort()).toEqual(['H0871', 'H1732']);
    expect([...index.get('H1732')!]).toEqual([19_051_001]);
    const chunks = chunkIndex(index);
    expect(chunks.get('H/008')).toEqual({ H0871: [19_051_003] });
    expect(chunks.get('H/017')).toEqual({ H1732: [19_051_001] });
  });
});

describe('search corpus rows', () => {
  it('emits the superscription as verse 0, then each verse', () => {
    const ch: TextChapter = {
      tr: 'BSB',
      book: 'PSA',
      chapter: 3,
      superscription: [['A', [0]], ' Psalm  of David.'],
      verses: [{ v: 1, t: [['O', [1]], ' LORD,\nhow many'] }],
    };
    expect(chapterRows(19, ch)).toEqual([
      [19, 3, 0, 'A Psalm of David.'],
      [19, 3, 1, 'O LORD, how many'],
    ]);
    expect(plainText([' a ', ['b', []]])).toBe('a b');
  });
});

describe('meta', () => {
  it('lists only present translations and their credits', () => {
    const m = metaFor((id) => id === 'BSB' || id === 'WEB');
    expect(m.translations.map((t) => t.id)).toEqual(['BSB', 'WEB']);
    expect(m.translations[0].alignment).toBe('manual');
    expect(m.credits.some((c) => c.url === 'https://github.com/seven1m/open-bibles')).toBe(true);
    expect(m.credits.some((c) => c.url === 'https://crosswire.org')).toBe(false);
    for (const url of ['https://github.com/Clear-Bible/Alignments', 'https://sblgnt.com', 'https://www.stepbible.org', 'https://github.com/openscriptures/strongs', 'https://berean.bible']) {
      expect(m.credits.some((c) => c.url === url)).toBe(true);
    }
  });
});

describe('common', () => {
  it('builds BBCCC chapter keys', () => {
    expect(chapterKey(1, 1)).toBe('01001');
    expect(chapterKey(66, 22)).toBe('66022');
  });
});
