/** Small hand-made chapters (shapes copied from public/data) for UI logic tests. */
import type { OrigChapter, OrigWord, TextChapter } from '../../src/lib/types';

const g = (text: string, strongs: string, lemma: string, morph: string, gloss: string, verse: number, i: number): OrigWord => [
  text,
  strongs,
  lemma,
  morph,
  gloss,
  verse,
  '',
  i,
  '',
  '',
];

/** John 1:1–2 (SBLGNT), indices as in public/data/orig/JHN/1.json. */
export const JHN1_ORIG: OrigChapter = {
  book: 'JHN',
  chapter: 1,
  lang: 'grc',
  edition: 'SBLGNT',
  words: [
    g('Ἐν', 'G1722', 'ἐν', 'PREP', 'in', 1, 0),
    g('ἀρχῇ', 'G0746', 'ἀρχή', 'N-DSF', 'beginning', 1, 1),
    g('ἦν', 'G2258', 'εἰμί', 'V-IAI-3S', 'was', 1, 2),
    g('ὁ', 'G3588', 'ὁ', 'T-NSM', 'the', 1, 3),
    g('λόγος', 'G3056', 'λόγος', 'N-NSM', 'word', 1, 4),
    g('καὶ', 'G2532', 'καί', 'CONJ', 'and', 1, 5),
    g('ὁ', 'G3588', 'ὁ', 'T-NSM', 'the', 1, 6),
    g('λόγος', 'G3056', 'λόγος', 'N-NSM', 'word', 1, 7),
    g('ἦν', 'G2258', 'εἰμί', 'V-IAI-3S', 'was', 1, 8),
    g('πρὸς', 'G4314', 'πρός', 'PREP', 'with', 1, 9),
    g('τὸν', 'G3588', 'ὁ', 'T-ASM', 'the', 1, 10),
    g('θεόν', 'G2316', 'θεός', 'N-ASM', 'God', 1, 11),
  ],
};

/** KJV John 1:1 (first half) + an invented verse 2 exercising supplied and lexicon-only words. */
export const JHN1_KJV: TextChapter = {
  tr: 'KJV',
  book: 'JHN',
  chapter: 1,
  verses: [
    {
      v: 1,
      t: [
        ['In', [0]],
        ' ',
        ['the', [1]],
        ' ',
        ['beginning', [1]],
        ' ',
        ['was', [2]],
        ' ',
        ['the', [3, 4]],
        ' ',
        ['Word', [3, 4]],
        ', ',
        ['and', [5]],
        ' ',
        ['the', [6, 7]],
        ' ',
        ['Word', [6, 7]],
        ' ',
        ['was', [8]],
        ' ',
        ['with', [9]],
        ' ',
        ['God', [10, 11]],
        '.',
      ],
    },
    {
      v: 2,
      t: [
        ['It', [], { i: 1 }],
        ' ',
        ['is', [], { i: 1 }],
        ' ',
        'so',
        ' ',
        ['preferred', [], { s: ['G1096'], m: ['V-2RAI-3S'], o: ['γεγονεν'] }],
        ' ',
        ['before', [], { s: ['G1715'], m: ['PREP'], o: ['εμπροσθεν'] }],
        ' ',
        ['me', [], { s: ['G1715'], m: ['PREP'], o: ['εμπροσθεν'] }],
        '; ',
        ['the', [3, 4]],
        ' ',
        ['Word', [3, 4]],
        '.',
      ],
    },
  ],
};

const h = (text: string, strongs: string, lemma: string, morph: string, gloss: string, verse: number, group: number, translit: string, lxx = ''): OrigWord => [
  text,
  strongs,
  lemma,
  morph,
  gloss,
  verse,
  '',
  group,
  translit,
  lxx,
];

/** Genesis 1:1 (WLC morphemes), as in public/data/orig/GEN/1.json. */
export const GEN1_ORIG: OrigChapter = {
  book: 'GEN',
  chapter: 1,
  lang: 'hbo',
  edition: 'WLC',
  words: [
    h('בְּ', 'H0871a', 'בְּ', 'R', 'in', 1, 0, 'bə', 'ἐν|G1722'),
    h('רֵאשִׁית', 'H7225', 'רֵאשִׁית', 'Ncfsa', 'beginning', 1, 0, 'rēʾšiyṯ', 'ἀρχῇ|G0746'),
    h('בָּרָא', 'H1254', 'בָּרָא', 'Vqp3ms', 'created', 1, 2, 'bārāʾ', 'ἐποίησεν|G4160'),
    h('אֱלֹהִים', 'H0430', 'אֱלֹהִים', 'Ncmpa', 'God', 1, 3, 'ʾĕlōhiym', 'θεὸς|G2316'),
    h('אֵת', 'H0853', 'אֵת', 'To', '[direct object]', 1, 4, 'ʾēṯ'),
    h('הַ', 'H1886a', 'הַ', 'Td', 'the', 1, 5, 'ha', 'τὸν|G3588'),
    h('שָּׁמַיִם', 'H8064', 'שָׁמַיִם', 'Ncmpa', 'heavens', 1, 5, 'ššāmayim', 'οὐρανὸν|G3772'),
  ],
};

export const GEN1_BSB: TextChapter = {
  tr: 'BSB',
  book: 'GEN',
  chapter: 1,
  headings: [[1, 'The Creation']],
  paras: [],
  verses: [
    {
      v: 1,
      t: [
        ['In', [0, 1]],
        ' ',
        ['the', [0, 1]],
        ' ',
        ['beginning', [0, 1]],
        ' ',
        ['God', [3]],
        ' ',
        ['created', [2]],
        ' ',
        ['the', [5, 6]],
        ' ',
        ['heavens', [5, 6]],
        '.',
      ],
    },
  ],
};
