import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assembleNames,
  buildClaims,
  buildEntities,
  capitalisedWords,
  cleanForm,
  displayName,
  englishName,
  mapChapterDetailed,
  newMapStats,
  parseCoords,
  parseLinks,
  parseTipnr,
  parseTipnrRefs,
  resolveLinks,
  sanitizeTipnrHtml,
  similarity,
  spellingKey,
} from '../scripts/data/names';
import { isSafeDefHtml } from '../scripts/data/lexicon';
import { configureData } from '../src/lib/data';
import {
  ancestors,
  configureNames,
  descendants,
  entityChunkPath,
  entityForToken,
  entityForWord,
  findPath,
  isEntityId,
  lineageTree,
  loadEntities,
  loadEntity,
  loadFamily,
  loadNameChapter,
  loadNameIndex,
  nameForWord,
  partnersOf,
  searchNames,
  siblingsOf,
  type LineageNode,
} from '../src/lib/names';
import type {
  FamilyGraph,
  NameChapter,
  NameEntity,
  NameEntityChunk,
  NameIndex,
  OrigChapter,
  OrigWord,
  TextChapter,
} from '../src/lib/types';
import { packRef } from '../src/lib/types';

/* ------------------------------------------------------------------------ */
/* TIPNR fixture (same layout as .cache/sources/TIPNR.txt, CRLF line ends)   */
/* ------------------------------------------------------------------------ */

const row = (...cells: string[]) => cells.join('\t');
const sub = (kind: string, unique: string, strongs: string, english: string, refs: string) =>
  row(`– ${kind}`, unique, strongs, english, refs);
const tail = (brief: string) => [`@Briefest= `, `@Brief= ${brief}`, `@Short= short`, `@Article= `, `@Ambiguity=`];
interface P {
  parents?: string;
  siblings?: string;
  partners?: string;
  children?: string;
  type?: string;
  brief?: string;
}
const person = (unique: string, subs: string[], p: P = {}) => [
  '$========== PERSON(s)',
  row(unique, 'Man living at some time', p.parents ?? ' + ', p.siblings ?? '', p.partners ?? '', p.children ?? '', '>', '#A person', p.type ?? 'Male'),
  ...subs,
  row('– Total', 'x', 'x', 'x', 'x', '1'),
  ...tail(p.brief ?? `Brief of ${unique}`),
];
const place = (unique: string, subs: string[], founder = '') => [
  '$========== PLACE',
  row(unique, 'Open name', founder, '', 'https://www.google.com/maps/@31.5,35.1,14z', 'https://palopenmaps.org/view/9999/@31.5,35.1', 'Judea', '#A location', 'Place'),
  ...subs,
  ...tail(`Brief of ${unique}`),
];

const FIXTURE = [
  'TIPNR - Translators Individualised Proper Names with all References = STEPBible.org CC BY\t\t>',
  'FIELD DESCRIPTIONS=',
  '$==========PERSON(s)', // template record of the header: no space after the "=" run
  row('UnifiedName=uStrong', 'Description', 'Parents Male+Female', 'Siblings', 'Partners', 'Offspring', 'Tribe', '#Summary', 'Type'),
  row('– Significance', 'UniqueName', 'dStrong«eStrong=Heb/Grk', 'Translated name', 'All Refs'),
  ...[
    '$========== PERSON(s)',
    row(
      'Abraham@Gen.11.26-1Pe=H0085',
      'Man living at the time of the Patriarchs',
      'Terah@Gen.11.24-Luk + ',
      'Nahor@Gen.11.26-',
      'Sarah@Gen.11.29-1Pe',
      'Isaac@Gen.17.19-Jas',
      'Early Patriarch',
      '#A man living at the time of the Patriarchs, first mentioned at <ref="Gen.11.26">Gen.11.26</ref>) <br>referred to as <strong="H0085">Abraham</strong> (אַבְרָהָם); <br> son of <strong="H8646G">Terah</strong>.',
      'Male',
    ),
    sub('Named', 'Abraham@Gen.11.26-1Pe', 'H0085«H0085=אַבְרָהָם', 'Abraham', 'Gen.17.23a; Gen.17.23b'),
    sub('Named', 'Abram|Abraham@Gen.11.26-1Pe', 'H0087«H0087=אַבְרָם', 'Abram', 'Gen.11.26'),
    sub('Greek', 'Abraham@Gen.11.26-1Pe', 'G0011«G0011=Ἀβραάμ', 'Abraham', 'Mat.1.1; LXX.Gen.46.20'),
    row('– Total', 'Abraham or Abram', 'Abraham, Abram', 'H0085, H0087, G0011', 'Gen.11.26; Gen.17.1ff', '3'),
    '@Briefest= Patriarch',
    '@Brief= Patriarch, father of Isaac.',
    '@Short= Abraham was the father of Isaac.',
    '@Article= Abraham left Ur (<ref="Gen.11.31">Gen.11.31</ref>). <BR>Second paragraph.',
    '@Ambiguity=',
  ],
  ...person('Terah@Gen.11.24-Luk=H8646G', [sub('Named', 'Terah@Gen.11.24-Luk', 'H8646G«H8646=תֶּרַח', 'Terah', 'Gen.11.26')], {
    children: 'Abraham@Gen.11.26-1Pe, Nahor@Gen.11.26-',
  }),
  ...person('Nahor@Gen.11.26-=H5152H', [sub('Named', 'Nahor@Gen.11.26-', 'H5152H«H5152=נָחוֹר', 'Nahor', 'Gen.11.26')], {
    parents: 'Terah@Gen.11.24-Luk + ',
  }),
  ...person('Sarah@Gen.11.29-1Pe=H8283', [sub('Named', 'Sarah@Gen.11.29-1Pe', 'H8283«H8283=שָׂרָה', 'Sarah', 'Gen.17.15')], {
    partners: 'Abraham@Gen.11.26-1Pe',
    type: 'Female',
  }),
  ...person('Isaac@Gen.17.19-Jas=H3327', [sub('Named', 'Isaac@Gen.17.19-Jas', 'H3327«H3327=יִצְחָק', 'Isaac', 'Gen.17.19')], {
    parents: 'Abraham@Gen.11.26-1Pe + Sarah@Gen.11.29-1Pe',
  }),
  // Two different men called Zechariah in one verse: the a/b suffix tells them apart.
  ...person('Zechariah@1Ch.9.21=H2148G', [sub('Named', 'Zechariah@1Ch.9.21', 'H2148G«H2148=זְכַרְיָה', 'Zechariah', '1Ch.9.21a')]),
  ...person('Zechariah@1Ch.9.37=H2148H', [sub('Named', 'Zechariah@1Ch.9.37', 'H2148H«H2148=זְכַרְיָה', 'Zechariah', '1Ch.9.21b')]),
  // An implied individual: "Mentioned" lines never claim a word.
  ...person('a_wife_of_Solomon@1Ki.4.11=H8010H', [sub('Mentioned', 'a_wife_of_Solomon@1Ki.4.11', 'H8010H=.', '[ ]', '1Ki.4.11')], {
    type: 'Female',
  }),
  ...person('Solomon@2Sa.5.14-Act=H8010', [sub('Named', 'Solomon@2Sa.5.14-Act', 'H8010«H8010=שְׁלֹמֹה', 'Solomon', '1Ki.4.11')]),
  // Tie between a person and a place, broken by the person's brother named in the same verse.
  ...person('Mamre@Gen.14.13=H4471H', [sub('Named', 'Mamre@Gen.14.13', 'H4471H«H4471=מַמְרֵא', 'Mamre', 'Gen.14.13')], {
    siblings: 'Eshcol@Gen.14.13-',
  }),
  ...person('Eshcol@Gen.14.13-=H0812G', [sub('Named', 'Eshcol@Gen.14.13-', 'H0812G«H0812=אֶשְׁכֹּל', 'Eshcol', 'Gen.14.13')], {
    siblings: 'Mamre@Gen.14.13',
  }),
  // A real tie (no kin elsewhere in the verse): left unmapped.
  ...person('Ben-hur@1Ki.4.8=H1133G', [sub('Named', 'Ben-hur@1Ki.4.8', 'H1133G«H1133=בֶּן־חוּר', 'Ben-hur', '1Ki.4.8')], {
    parents: 'Hur@1Ki.4.8 + ',
  }),
  ...person('Hur@1Ki.4.8=H1133H', [sub('Named', 'Hur@1Ki.4.8', 'H1133H«H1133=בֶּן־חוּר', 'Hur', '1Ki.4.8')]),
  // Rank tie-break: a line for the record's own name beats an alternative-name line.
  ...person('Jehoiakim@2Ki.23.34-Dan=H3079G', [sub('Named', 'Jehoiakim@2Ki.23.34-Dan', 'H3079G«H3079=יְהוֹיָקִים', 'Jehoiakim', 'Jer.27.1')]),
  ...person('Zedekiah@2Ki.24.17-Jer=H6667G', [
    sub('Named', 'Jehoiakim|Zedekiah@2Ki.24.17-Jer', 'H3079H«H3079=יְהוֹיָקִים', 'Zedekiah =ESV,NIV; Jehoiakim =KJV', 'Jer.27.1'),
  ]),
  // A single-word form beats a component of a combined name.
  ...person('Israel@Gen.25.26-Rev=H3478', [sub('Named', 'Israel@Gen.25.26-Rev', 'H3478«H3478=יִשְׂרָאֵל', 'Israel', 'Gen.33.20')]),
  ...person('Jesus@Isa.7.14-Rev=G2424G', [
    sub('Named', 'Christ|Jesus@Isa.7.14-Rev', 'G5547G«G5547=Χριστός', 'Christ =ESV,NIV,KJV; Messiah =NIV', 'Gal.2.20'),
  ]),
  ...place('Bethel@Gen.12.8-Zec=H1008', [sub('Named', 'Bethel@Gen.12.8-Zec', 'H1008«H1008=בֵּית־אֵל', 'Bethel', 'Gen.12.8a')]),
  ...place('Bethel@Gen.12.8b=H1008B', [sub('Named', 'Bethel@Gen.12.8b', 'H1008B«H1008=בֵּית־אֵל', 'Bethel', 'Gen.12.8b')], 'Abraham@Gen.11.26-1Pe'),
  ...place('Egypt@Gen.12.10-Rev=H4714', [sub('Named', 'Egypt@Gen.12.10-Rev', 'H4713«H4713=מִצְרִי', 'Egyptian', 'Gen.45.2')]),
  ...place('Mamre@Gen.13.18-=H4471G', [sub('Named', 'Mamre@Gen.13.18-', 'H4471G«H4471=מַמְרֵא', 'Mamre', 'Gen.14.13')]),
  // Macula's lettered prefix / suffix ids (H1886a = the article) must not count as Dothan (H1886).
  ...place('Dothan@Gen.37.17-2Ki=H1886', [sub('Named', 'Dothan@Gen.37.17-2Ki', 'H1886«H1886=דֹּתָן', 'Dothan', 'Gen.37.17a; Gen.37.17b')]),
  // STEP counts the Gilead inside "Ramoth-gilead" (one H7433 name in Macula), so the lone Gilead is "b".
  ...place('Gilead@Gen.31.21-Zec=H1568G', [sub('Named', 'Gilead@Gen.31.21-Zec', 'H1568G«H1568=גִּלְעָד', 'Gilead', '1Ki.4.13b')]),
  ...place('Ramoth@Gen.31.47-Hos=H7433', [
    sub('Named', 'Ramoth@Gen.31.47-Hos', 'H7433«H7433=רָמֹת גִּלְעָד', 'Ramoth-gilead', '1Ki.4.13'),
    sub('Name combined', 'Ramoth-gilead|Ramoth@Gen.31.47-Hos', 'H7418G«H7418=רָמוֹת+H1568M«H1568=גִּלְעָד', 'Ramoth/-gilead =ESV,KJV; Ramoth/ Gilead =NIV,KJV', '1Ki.4.13'),
  ]),
  // Common nouns as parts of names.
  ...place('Topheth@2Ki.23.10-Jer=H8612', [
    sub('Named', 'Topheth@2Ki.23.10-Jer', 'H8612«H8612=תֹּפֶת', 'Topheth', 'Jer.7.31'),
    sub('Name combined', 'Valley_of_Ben-hinnom|Topheth@2Ki.23.10-Jer', 'H1516«H1516=גַּיְא+H1121«H1121=בֵּן+H2011«H2011=הִנֹּם', 'Valley of/ the Son of/ Hinnom', 'Jer.7.31; 2Ch.28.3'),
  ]),
  ...person('Bath-shua@Gen.38.2-1Ch=H1340', [
    sub('Name combined', 'Bath-shua@Gen.38.2-1Ch', 'H1323G«H1323=בַּת+H7770«H7770=שׁוּעַ', 'Bath/-shua =ESV; daughter of/ Shua =ESV,NIV,KJV', 'Gen.38.2'),
  ], { type: 'Female' }),
  ...person('Shua@Gen.38.2=H7770', [sub('Named', 'Shua@Gen.38.2', 'H7770«H7770=שׁוּעַ', 'Shua', 'Gen.38.2')]),
  ...person('Beno@1Ch.24.26-=H1121B', [sub('Named', 'Beno@1Ch.24.26-', 'H1121B«H1121b=בְּנוֹ', 'Beno', '1Ch.24.26')]),
  ...person('Hammelech@Jer.36.26-=H4428H', [
    sub('Named', 'Hammelech@Jer.36.26-', 'H4428H«H4428=הַמֶּלֶךְ', 'Hammelech =KJV; the king =ESV,NIV', 'Jer.36.26'),
  ]),
  ...person('Jonathan@1Sa.13.2-1Ch=H3083G', [
    sub('Named', 'Jonathan@1Sa.13.2-1Ch', 'H3083G«H3083=יְהוֹנָתָן', 'Jehonathan; Jonathan =ESV,NIV,KJV', '1Sa.14.6'),
  ]),
  '$========== OTHER',
  row('Chronicles@1Ki.14.19-Est=H1697O', 'Name of a book', '', '', '', '', '>', '#Name of a book', 'Other'),
  sub('Named', 'Chronicles@1Ki.14.19-Est', 'H1697O«H1697=דָּבָר', 'Chronicle =ESV,KJV', '1Ki.14.19'),
  ...tail('Historical records of the kings'),
  '$========== OTHER',
  row('Sabbath@Exo.16.23-Heb=H7676', 'Name of a festival', '', '', '', '', '>', '#Name of a festival', 'Time'),
  sub('Named', 'Sabbath@Exo.16.23-Heb', 'H7676«H7676=שַׁבָּת', 'Sabbath', 'Lev.23.15; Lev.24.8'),
  ...tail('The seventh day'),
  '$========== OTHER',
  row('LORD@Gen.1.1-Rev=H3068G', 'The Deity', '', '', '', '', '>', '#The Deity', 'Supernatural'),
  sub('Named', 'LORD@Gen.1.1-Rev', 'H3068G«H3068=יהוה', 'LORD =ESV,NIV,KJV', 'Gen.2.4; etc'),
  sub('Named', 'God|LORD@Gen.1.1-Rev', 'H0430G«H0430=אֱלֹהִים', 'God', 'Gen.1.1; etc'),
  sub('Name combined', 'El-Elohe-Israel|LORD@Gen.1.1-Rev', 'H0410I«H0410=אֵל+H0430H«H0430=אֱלֹהִים+H3478«H3478=יִשְׂרָאֵל', 'El-Elohe-Israel', 'Gen.33.20'),
  sub('Named', 'God|LORD@Gen.1.1-Rev', 'H0410G«H0410=אֵל=God', 'God', 'Gen.16.13; etc'),
  sub('Named', 'Hosts|LORD@Gen.1.1-Rev', 'H6635B«H6635b=צָבָא', 'Hosts =ESV,KJV; Almighty =NIV', 'Isa.13.4'),
  sub('Greek', 'Lord|LORD@Gen.1.1-Rev', 'G2962G«G2962=κύριος', 'Lord', 'Mat.1.20; etc'),
  ...tail('Names or title used to refer to God'),
  '$========== EXCLUDED OTHER',
  row('Latin@Luk.23.38-Jhn=G4515', 'A language', '', '', '', '', '>', '#A language', 'Language'),
  sub('Named', 'Latin@Luk.23.38-Jhn', 'G4513«G4513=Ῥωμαϊκός', 'Latin', 'Luk.23.38'),
  'MERGED: Maacah@2Sa.10.6+Maacath@Jos.13.13; notes that are not records',
  '$',
  '$========== PERSON(s)',
  row('Ghost@Gen.1.1=H9999', 'After the end marker', ' + ', '', '', '', '>', '#x', 'Male'),
].join('\r\n');

/** An OrigWord with the fields the mapper reads. */
const w = (text: string, strongs: string, morph: string, gloss: string, verse: number, lemma = text): OrigWord => [
  text,
  strongs,
  lemma,
  morph,
  gloss,
  verse,
  '',
  0,
  '',
  '',
];
/** One verse of OrigWords, each its own written word unless a group (first-morpheme index) is given. */
const verse = (v: number, ...ws: [text: string, strongs: string, morph: string, gloss: string, group?: number][]): OrigWord[] =>
  ws.map(([text, strongs, morph, gloss, group], i) => {
    const x = w(text, strongs, morph, gloss, v);
    x[7] = group ?? i;
    return x;
  });
const chapter = (book: string, c: number, lang: 'hbo' | 'grc', words: OrigWord[]): OrigChapter => ({
  book,
  chapter: c,
  lang,
  edition: lang === 'hbo' ? 'WLC' : 'SBLGNT',
  words,
});

function fixtureIndex() {
  const records = parseTipnr(FIXTURE);
  const built = buildEntities(records);
  const ids = new Map(built.map((e) => [e.uniqueName, e.id]));
  resolveLinks(built);
  const idx = buildClaims(records, ids);
  idx.relatives = new Map(
    built.map((e) => [e.id, new Set([...(e.parents ?? []), ...(e.children ?? []), ...(e.partners ?? []), ...(e.siblings ?? [])])]),
  );
  const id = (unique: string) => ids.get(unique)!;
  return { records, built, idx, id };
}

/* ------------------------------------------------------------------------ */
/* Parsing                                                                    */
/* ------------------------------------------------------------------------ */

describe('parseTipnr', () => {
  const records = parseTipnr(FIXTURE);

  it('reads every real record between the field descriptions and the "$" terminator', () => {
    const names = records.map((r) => r.uniqueName);
    expect(names).toContain('Abraham@Gen.11.26-1Pe');
    expect(names).toContain('LORD@Gen.1.1-Rev');
    expect(names).not.toContain('UnifiedName'); // header template
    expect(names.some((n) => n.startsWith('Latin'))).toBe(false); // EXCLUDED OTHER
    expect(names.some((n) => n.startsWith('Ghost'))).toBe(false); // after "$"
    expect(records.filter((r) => r.section === 'PLACE')).toHaveLength(8);
  });

  it('splits header fields, sub-lines and @ lines', () => {
    const abraham = records.find((r) => r.uniqueName === 'Abraham@Gen.11.26-1Pe')!;
    expect(abraham.uStrong).toBe('H0085');
    expect(abraham.fields[1]).toBe('Terah@Gen.11.24-Luk +');
    expect(abraham.fields[7]).toBe('Male');
    expect(abraham.subs.map((s) => s.kind)).toEqual(['Named', 'Named', 'Greek']); // Total skipped
    expect(abraham.subs[1].strongs).toEqual([{ dStrong: 'H0087', eStrong: 'H0087', form: 'אַבְרָם' }]);
    expect(abraham.brief).toBe('Patriarch, father of Isaac.');
    expect(abraham.article).toMatch(/^Abraham left Ur/);
  });

  it('parses combined names and "Mentioned" forms', () => {
    const lord = records.find((r) => r.uniqueName === 'LORD@Gen.1.1-Rev')!;
    expect(lord.subs[2].strongs.map((s) => s.dStrong)).toEqual(['H0410I', 'H0430H', 'H3478']);
    const wife = records.find((r) => r.uniqueName.startsWith('a_wife'))!;
    expect(wife.subs[0].strongs).toEqual([{ dStrong: 'H8010H', eStrong: '', form: '' }]);
  });
});

describe('parseTipnrRefs', () => {
  it('parses suffixes, continuations, LXX-only refs and "etc"', () => {
    const r = parseTipnrRefs('Gen.17.23a; Gen.17.23b; Exo.1.13, Exo.1.19; Num.13.8,16; Heb.5.4; 7.11; LXX.Gen.46.20; ; Psa.3.0');
    expect(r.bad).toEqual([]);
    expect(r.etc).toBe(false);
    expect(r.refs.map((x) => `${x.book.id} ${x.chapter}:${x.verse}${x.occ ? `#${x.occ}` : ''}`)).toEqual([
      'GEN 17:23#1',
      'GEN 17:23#2',
      'EXO 1:13',
      'EXO 1:19',
      'NUM 13:8',
      'NUM 13:16',
      'HEB 5:4',
      'HEB 7:11',
      'PSA 3:0',
    ]);
    expect(parseTipnrRefs('Gen.2.4; etc').etc).toBe(true);
    expect(parseTipnrRefs('Xyz.1.1').bad).toEqual(['Xyz.1.1']);
  });
});

describe('field helpers', () => {
  it('parseLinks reads names, flags and founders', () => {
    expect(parseLinks('Terah@Gen.11.24-Luk + ')).toEqual([{ name: 'Terah@Gen.11.24-Luk', flag: '' }]);
    expect(parseLinks('Noah@Gen.5.29-2Pe + Naamah@Gen.4.22(?)')).toEqual([
      { name: 'Noah@Gen.5.29-2Pe', flag: '' },
      { name: 'Naamah@Gen.4.22', flag: '?' },
    ]);
    expect(parseLinks('Canaan@Gen.9.18-1Ch(d), Rahab@Jos.2.1-Jas(d?)').map((l) => l.flag)).toEqual(['d', 'd?']);
    expect(parseLinks('Maon@1Ch.2.45=H4584H')).toEqual([{ name: 'Maon@1Ch.2.45', flag: '' }]);
    expect(parseLinks(' + ')).toEqual([]);
    expect(parseLinks('>')).toEqual([]);
    expect(parseLinks('Word sometimes translated as a place')).toEqual([]);
  });

  it('parseCoords reads @lat,long and rejects empty or zero positions', () => {
    expect(parseCoords('https://www.google.com/maps/@33.545097,36.224661,14z')).toEqual([33.545097, 36.224661]);
    expect(parseCoords('https://www.google.com/maps/@,14z', 'https://palopenmaps.org/view/9999/@31.5,35.1')).toEqual([31.5, 35.1]);
    expect(parseCoords('https://www.google.com/maps/@0,14z', 'https://palopenmaps.org/view/9999/@0')).toBeUndefined();
    expect(parseCoords('@95,10')).toBeUndefined();
  });

  it('displayName and englishName', () => {
    expect(displayName('Abram|Abraham@Gen.11.26-1Pe')).toBe('Abram');
    expect(displayName('a_wife_of_Solomon@1Ki.4.11')).toBe('A wife of Solomon');
    expect(displayName('Unnamed#7@Mat.1.15')).toBe('Unnamed');
    expect(displayName('PharaohNeco|Neco@2Ki.23.29-Jer')).toBe('Pharaoh Neco');
    expect(displayName('motherInLaw_of_Peter@Mat.8.14')).toBe('Mother-in-law of Peter');
    expect(englishName('Abiah =KJV; his father =ESV; Abijah =NIV')).toBe('Abiah');
    expect(englishName('Areli,Arelite')).toBe('Areli');
    expect(englishName('Berechiah =EsV,KJV')).toBe('Berechiah');
    expect(englishName('[ ]')).toBe('');
    // The spelling the English Bibles use, not a bare transliteration listed first.
    expect(englishName('Jehonathan; Jonathan =ESV,NIV,KJV')).toBe('Jonathan');
    expect(englishName('Jehezekiah; Hezekiah =ESV,NIV,KJV')).toBe('Hezekiah');
    expect(englishName('Amaw =ESV; people =NIV,KJV')).toBe('Amaw'); // a name before a common noun
    // Words in parentheses are not part of this word, unless that makes the entity's own name.
    expect(englishName('(Mount )Zion')).toBe('Zion');
    expect(englishName('(Mount )Carmel', 'Mount Carmel')).toBe('Mount Carmel');
    expect(englishName('Corner (Gate)', 'Corner Gate')).toBe('Corner Gate');
    expect(englishName('Heliopolis (LXX)')).toBe('Heliopolis');
    // "/" joins the parts of a combined name.
    expect(englishName('Pharaoh/ Neco =ESV; Pharaoh/ Necho =NIV; Pharaoh/-necho =KJV')).toBe('Pharaoh Neco');
    expect(englishName('Bath/-shua =ESV; daughter of/ Shua =ESV,NIV,KJV')).toBe('Bath-shua');
    expect(englishName('Adami/-nekeb =ESV; Adami/ Nekeb =NIV; Adami,/ Nekeb =KJV')).toBe('Adami-nekeb');
    expect(englishName('father [ie re-founder] of/ Gibeon')).toBe('father of Gibeon');
    expect(englishName('Jehovah/–jireh: =KJV')).toBe('Jehovah–jireh');
    // A Latin letter in a Greek form (TIPNR's Colossae) is read as Greek.
    expect(cleanForm('G2858', 'Κολaσσαεύς')).toBe('Κολασσαεύς');
    expect(cleanForm('H0410', 'אֵל')).toBe('אֵל');
  });

  it('spelling similarity used by the sibling-Strong\'s pass', () => {
    expect(spellingKey('מִצְרַיִם')).toBe('מצרימ');
    expect(similarity(spellingKey('מִצְרַיִם'), spellingKey('מִצְרִי'))).toBeCloseTo(0.8);
    expect(similarity(spellingKey('Ἱεροσόλυμα'), spellingKey('Ἰερουσαλήμ'))).toBeGreaterThanOrEqual(0.5);
    expect(similarity(spellingKey('שְׁאוֹל'), spellingKey('מִצְרִי'))).toBeLessThan(0.5);
    expect(similarity('', 'x')).toBe(0);
  });
});

/* ------------------------------------------------------------------------ */
/* Sanitiser                                                                  */
/* ------------------------------------------------------------------------ */

describe('sanitizeTipnrHtml', () => {
  it('turns TIPNR markup into the allowed subset', () => {
    const raw =
      '#A man living at the time of United Monarchy, only mentioned at <ref="1Ki.4.6">1Ki.4.6</ref>) <br>only referred to as <strong="H5653G">Abda</strong> (עַבְדָּא); <br> father of <strong="H0151">Adoram</strong>.';
    expect(sanitizeTipnrHtml(raw)).toBe(
      'A man living at the time of United Monarchy, only mentioned at <span class="ref" data-ref="1KI.4.6">1 Kgs 4:6</span><br>only referred to as <b>Abda</b> (עַבְדָּא);<br>father of <b>Adoram</b>.',
    );
    expect(sanitizeTipnrHtml('Abel was a shepherd (<ref="Heb.11.4">Heb.11.4</ref>). <BR>Next.')).toBe(
      'Abel was a shepherd (<span class="ref" data-ref="HEB.11.4">Heb 11:4</span>).<br>Next.',
    );
  });

  it('strips cantillation from Hebrew', () => {
    expect(sanitizeTipnrHtml('הֶ֫בֶל')).toBe('הֶבֶל');
  });

  const hostile = [
    '<script>alert(1)</script>ok',
    '<img src=x onerror=alert(1)>ok',
    '<a href="javascript:alert(1)">click</a>',
    '<strong="H1" onclick="alert(1)">Bob</strong>',
    '<ref="Gen.1.1" onmouseover="x()">Gen.1.1</ref>',
    '<span class="ref" data-ref="X" onclick="y">s</span>',
    '<b><i>unclosed <br/> <iframe src=//evil></iframe><style>body{}</style>end',
    'a < b && c > d "quoted" &amp; &lt;script&gt;',
    '<svg><script>alert(1)</script></svg>',
    '<<script>>x',
    '<ref="javascript:alert(1)">x</ref>',
    '<!-- <script>alert(1)</script> -->text',
    '&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;',
  ];
  it.each(hostile)('neutralises hostile input %#', (input) => {
    const out = sanitizeTipnrHtml(input);
    expect(isSafeDefHtml(out)).toBe(true);
    expect(out).not.toMatch(/<(?:script|img|a|iframe|style|svg)\b|on\w+=|javascript:/i);
  });

  it('keeps plain text with angle brackets as escaped text', () => {
    expect(sanitizeTipnrHtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d');
  });
});

/* ------------------------------------------------------------------------ */
/* Entities and family links                                                  */
/* ------------------------------------------------------------------------ */

describe('buildEntities', () => {
  const { built, id } = fixtureIndex();
  const byId = new Map(built.map((e) => [e.id, e]));
  const get = (u: string) => byId.get(id(u))!;

  it('assigns compact ids per kind in UniqueName order', () => {
    const people = built.filter((e) => e.kind === 'person').map((e) => e.uniqueName);
    expect([...people].sort((a, b) => (a < b ? -1 : 1))).toEqual(people);
    expect(id('Abraham@Gen.11.26-1Pe')).toBe('p0001');
    expect(id('Bethel@Gen.12.8-Zec')).toMatch(/^l\d{4}$/);
    expect(id('LORD@Gen.1.1-Rev')).toMatch(/^g\d{4}$/);
    expect(entityChunkPath('p0685')).toBe('names/entities/p/006.json');
  });

  it('fills every NameEntity field', () => {
    const a = get('Abraham@Gen.11.26-1Pe');
    expect(a).toMatchObject({ name: 'Abraham', kind: 'person', gender: 'male', group: 'Early Patriarch', brief: 'Patriarch, father of Isaac' });
    expect(a.forms).toEqual([
      ['H0085', 'אַבְרָהָם', 'Abraham'],
      ['H0087', 'אַבְרָם', 'Abram'],
      ['G0011', 'Ἀβραάμ', 'Abraham'],
    ]);
    expect(a.summary).toContain('<span class="ref" data-ref="GEN.11.26">Gen 11:26</span>');
    expect(a.summary).toContain('<b>Terah</b>');
    expect(a.summary).toContain('Second paragraph'); // the @Article follows the summary
    expect(isSafeDefHtml(a.summary)).toBe(true);
    const bethel = get('Bethel@Gen.12.8-Zec');
    expect(bethel).toMatchObject({ kind: 'place', coords: [31.5, 35.1], group: 'Judea' });
    expect(bethel.gender).toBeUndefined();
    expect(get('a_wife_of_Solomon@1Ki.4.11').forms).toEqual([]);
  });

  it('lists single-word forms before combined names, with the English spelling used', () => {
    const lord = get('LORD@Gen.1.1-Rev');
    // אֵל is "God" (its own line), though the combined "El-Elohe-Israel" line comes first in TIPNR.
    expect(lord.forms.find((f) => f[0] === 'H0410')).toEqual(['H0410', 'אֵל', 'God']);
    expect(lord.forms.find((f) => f[0] === 'H3478')).toEqual(['H3478', 'יִשְׂרָאֵל', 'El-Elohe-Israel']);
    expect(lord.forms.findIndex((f) => f[0] === 'H3478')).toBeGreaterThan(lord.forms.findIndex((f) => f[0] === 'H6635'));
    expect(nameForWord(lord, 'H0410')).toBe('God');
    expect(get('Jonathan@1Sa.13.2-1Ch').forms).toEqual([['H3083', 'יְהוֹנָתָן', 'Jonathan']]);
    expect(get('Bath-shua@Gen.38.2-1Ch').forms.map((f) => f[2])).toEqual(['Bath-shua', 'Bath-shua']);
  });

  it('resolves family links symmetrically', () => {
    const a = get('Abraham@Gen.11.26-1Pe');
    expect(a.parents).toEqual([id('Terah@Gen.11.24-Luk')]);
    expect(a.partners).toEqual([id('Sarah@Gen.11.29-1Pe')]);
    // Offspring may include a founded place (TIPNR: "Salma … the father of Bethlehem").
    expect(a.children).toEqual([id('Isaac@Gen.17.19-Jas'), id('Bethel@Gen.12.8b')]);
    expect(get('Isaac@Gen.17.19-Jas').parents).toEqual([id('Abraham@Gen.11.26-1Pe'), id('Sarah@Gen.11.29-1Pe')]);
    expect(get('Sarah@Gen.11.29-1Pe').partners).toEqual([id('Abraham@Gen.11.26-1Pe')]); // stated on her record too
    expect(get('Terah@Gen.11.24-Luk').children).toEqual([id('Abraham@Gen.11.26-1Pe'), id('Nahor@Gen.11.26-')]);
    // A place founder becomes the place's "parent" (and the founder's "child").
    expect(get('Bethel@Gen.12.8b').parents).toEqual([id('Abraham@Gen.11.26-1Pe')]);
  });
});

describe('resolveLinks and uncertain "(?)" links', () => {
  const fam = [
    ...person('Lamech@Gen.4.18-=H3929G', [], { children: 'Naamah@Gen.4.22' }),
    ...person('Lamech@Gen.5.25-Luk=H3929H', [], { children: 'Noah@Gen.5.29-2Pe' }),
    ...person('Noah@Gen.5.29-2Pe=H5146', [], {
      parents: 'Lamech@Gen.5.25-Luk + ',
      partners: 'Naamah@Gen.4.22(?)',
      children: 'Shem@Gen.5.32-Luk',
    }),
    ...person('Naamah@Gen.4.22=H5279G', [], {
      parents: 'Lamech@Gen.4.18- + ',
      partners: 'Noah@Gen.5.29-2Pe(?)',
      children: 'Shem@Gen.5.32-Luk(?)',
      type: 'Female',
    }),
    ...person('Shem@Gen.5.32-Luk=H8035', [], { parents: 'Noah@Gen.5.29-2Pe + Naamah@Gen.4.22(?)' }),
    ...person('Jehoiachin@2Ki.24.6-Mat=H3078', [], {}),
    ...person('Shealtiel@1Ch.3.17-Mat=H7597A', [], { parents: 'Jehoiachin@2Ki.24.6-Mat(?) + ', children: 'Pedaiah@1Ch.3.18-(?)' }),
    ...person('Pedaiah@1Ch.3.18-=H6305H', [], { parents: 'Shealtiel@1Ch.3.17-Mat(?) + ' }),
    ...person('Salmon@Rut.4.20-Luk=H8012', [], { children: 'Boaz@Rut.2.1-Luk' }),
    ...person('Rahab@Jos.2.1-Jas=H7343', [], { children: 'Boaz@Rut.2.1-Luk(?)', type: 'Female' }),
    ...person('Boaz@Rut.2.1-Luk=H1162G', [], { parents: 'Salmon@Rut.4.20-Luk + Rahab@Jos.2.1-Jas(?)', siblings: 'Nobody@Gen.1.1' }),
    '$',
  ].join('\n');
  const built = buildEntities(parseTipnr(fam));
  const report = resolveLinks(built);
  const by = (u: string) => built.find((e) => e.uniqueName === u)!;
  const idOf = (u: string) => by(u).id;

  it('leaves out an uncertain parent that would open a second line of ancestry', () => {
    expect(by('Shem@Gen.5.32-Luk').parents).toEqual([idOf('Noah@Gen.5.29-2Pe')]);
    expect(by('Naamah@Gen.4.22').children).toBeUndefined();
    expect(by('Noah@Gen.5.29-2Pe').partners).toBeUndefined(); // uncertain partners are left out
    expect(report.uncertain.some((l) => l.includes('Naamah'))).toBe(true);
  });

  it('keeps an uncertain parent that fills a gap or has no ancestry of their own', () => {
    expect(by('Shealtiel@1Ch.3.17-Mat').parents).toEqual([idOf('Jehoiachin@2Ki.24.6-Mat')]);
    expect(by('Pedaiah@1Ch.3.18-').parents).toEqual([idOf('Shealtiel@1Ch.3.17-Mat')]);
    expect(by('Jehoiachin@2Ki.24.6-Mat').children).toEqual([idOf('Shealtiel@1Ch.3.17-Mat')]);
    expect(by('Boaz@Rut.2.1-Luk').parents).toEqual([idOf('Salmon@Rut.4.20-Luk'), idOf('Rahab@Jos.2.1-Jas')]);
    expect(report.uncertainKept.length).toBeGreaterThan(0);
  });

  it('reports unresolved names', () => {
    expect(report.unresolved).toEqual(['Boaz@Rut.2.1-Luk siblings: Nobody@Gen.1.1']);
  });
});

/* ------------------------------------------------------------------------ */
/* Word mapping                                                               */
/* ------------------------------------------------------------------------ */

describe('mapChapterDetailed', () => {
  const { idx, id } = fixtureIndex();
  const map = (book: string, num: number, c: number, lang: 'hbo' | 'grc', words: OrigWord[]) => {
    const stats = newMapStats();
    const r = mapChapterDetailed(chapter(book, c, lang, words), num, idx, stats);
    return { ...r, stats };
  };

  it('matches the a/b occurrence suffix to the n-th word with that Strong\'s', () => {
    const { ids, pass } = map('1CH', 13, 9, 'hbo', [
      w('זְכַרְיָה', 'H2148', 'Np', 'Zechariah', 21),
      w('בֶּן', 'H1121', 'Ncmsc', 'son', 21),
      w('זְכַרְיָה', 'H2148', 'Np', 'Zechariah', 21),
    ]);
    expect(ids).toEqual([id('Zechariah@1Ch.9.21'), undefined, id('Zechariah@1Ch.9.37')]);
    expect(pass).toEqual([0, -1, 0]);
  });

  it('counts adjacent words with the same Strong\'s as one occurrence (בֵּית אֵל)', () => {
    const { ids } = map('GEN', 1, 12, 'hbo', [
      w('בֵּית', 'H1008', 'Np', 'Bethel', 8),
      w('אֵל', 'H1008', 'Np', 'Bethel', 8),
      w('וְ', 'H2050b', 'C', 'and', 8),
      w('בֵית', 'H1008', 'Np', 'Bethel', 8),
      w('אֵל', 'H1008', 'Np', 'Bethel', 8),
    ]);
    expect(ids).toEqual([id('Bethel@Gen.12.8-Zec'), id('Bethel@Gen.12.8-Zec'), undefined, id('Bethel@Gen.12.8b'), id('Bethel@Gen.12.8b')]);
  });

  it('does not let "Mentioned" individuals claim the word they are inferred from', () => {
    const { ids } = map('1KI', 11, 4, 'hbo', [w('שְׁלֹמֹה', 'H8010', 'Np', 'Solomon', 11)]);
    expect(ids).toEqual([id('Solomon@2Sa.5.14-Act')]);
  });

  it('breaks ties by priority, by own-name lines, and by kin in the same verse', () => {
    // Single-word Israel beats the Israel component of "El-Elohe-Israel".
    expect(map('GEN', 1, 33, 'hbo', [w('יִשְׂרָאֵל', 'H3478', 'Np', 'Israel', 20)]).ids).toEqual([id('Israel@Gen.25.26-Rev')]);
    // Jehoiakim's own line beats Zedekiah's alternative-name line.
    expect(map('JER', 24, 27, 'hbo', [w('יְהוֹיָקִים', 'H3079', 'Np', 'Jehoiakim', 1)]).ids).toEqual([id('Jehoiakim@2Ki.23.34-Dan')]);
    // Mamre the Amorite (brother of Eshcol, named in the verse) rather than the place Mamre.
    const mamre = map('GEN', 1, 14, 'hbo', [w('מַמְרֵא', 'H4471', 'Np', 'Mamre', 13), w('אֶשְׁכֹּל', 'H0812', 'Np', 'Eshcol', 13)]);
    expect(mamre.ids).toEqual([id('Mamre@Gen.14.13'), id('Eshcol@Gen.14.13-')]);
    // Ben-hur vs Hur: still tied, left unmapped and counted.
    const benhur = map('1KI', 11, 4, 'hbo', [w('בֶּן', 'H1133', 'Np', 'Ben-hur', 8), w('חוּר', 'H1133', 'Np', 'Ben-hur', 8)]);
    expect(benhur.ids).toEqual([undefined, undefined]);
    expect(benhur.stats.ambiguous).toBe(2);
  });

  it('falls back to a similar-looking claim with a sibling Strong\'s number in the same verse', () => {
    const { ids, pass } = map('GEN', 1, 45, 'hbo', [
      w('מִצְרַיִם', 'H4714', 'Np', 'Egyptians', 2),
      w('שְׁאוֹל', 'H7585', 'Np', 'Sheol', 2), // unclaimed and unlike מִצְרִי: stays unmapped
    ]);
    expect(ids).toEqual([id('Egypt@Gen.12.10-Rev'), undefined]);
    expect(pass).toEqual([1, -1]);
  });

  it('falls back to an unused claim in the neighbouring verse (verse divisions differ)', () => {
    const { ids, pass } = map('GAL', 48, 2, 'grc', [
      w('Χριστῷ', 'G5547', 'N-DSM', 'Christ', 19, 'Χριστός'),
      w('νόμῳ', 'G3551', 'N-DSM', 'law', 19, 'νόμος'),
    ]);
    expect(ids).toEqual([id('Jesus@Isa.7.14-Rev'), undefined]);
    expect(pass).toEqual([2, -1]);
  });

  it('maps "etc" names of God everywhere (capitalised gloss only), but not Greek κύριος', () => {
    const lord = id('LORD@Gen.1.1-Rev');
    const { ids } = map('PSA', 19, 82, 'hbo', [
      w('יְהוָה', 'H3068', 'Np', 'LORD', 1),
      w('יְהֹוִה', 'H3069', 'Np', 'GOD', 1),
      w('אֱלֹהִים', 'H0430', 'Ncmpa', 'God', 1),
      w('אֱלֹהִים', 'H0430', 'Ncmpa', 'gods', 1),
    ]);
    expect(ids).toEqual([lord, lord, lord, undefined]);
    expect(map('ROM', 45, 1, 'grc', [w('κυρίου', 'G2962', 'N-GSM', 'Lord', 4, 'κύριος')]).ids).toEqual([undefined]);
  });

  it('ignores lettered prefix / suffix morphemes that share digits with a name (הָ H1886a is not Dothan)', () => {
    const dothan = id('Dothan@Gen.37.17-2Ki');
    const { ids } = map('GEN', 1, 37, 'hbo', verse(17,
      ['הָ', 'H1886a', 'Td', 'the', 0], ['אִישׁ', 'H0376', 'Ncmsa', 'man', 0],
      ['דֹּתָיְנָ', 'H1886', 'Np', 'Dothan', 2], ['ה', 'H1886c', 'Sd', 'to', 2],
      ['בְּ', 'H0871a', 'R', 'at', 4], ['דֹתָן', 'H1886', 'Np', 'Dothan', 4],
    ));
    expect(ids).toEqual([undefined, undefined, dothan, undefined, undefined, dothan]);
  });

  it('gives a suffix beyond our last occurrence to the last unsuffixed one (Gilead "b" in 1 Ki 4:13)', () => {
    const ramoth = id('Ramoth@Gen.31.47-Hos');
    const { ids } = map('1KI', 11, 4, 'hbo', verse(13,
      ['רָמֹת', 'H7433', 'Np', 'Ramoth', 0], ['גִּלְעָד', 'H7433', 'Np', 'Gilead', 1],
      ['בַּ', 'H0871a', 'Rd', 'in', 2], ['גִּלְעָד', 'H1568', 'Np', 'Gilead', 2],
    ));
    expect(ids).toEqual([ramoth, ramoth, undefined, id('Gilead@Gen.31.21-Zec')]);
  });

  it('takes the common-noun part of a combined name only where it is part of the name', () => {
    const topheth = id('Topheth@2Ki.23.10-Jer');
    // Jer 7:31: Macula tags the whole Valley of Ben-hinnom H1516, so "their sons" is not its "Ben".
    expect(map('JER', 24, 7, 'hbo', verse(31,
      ['תֹּפֶת', 'H8612', 'Np', 'Topheth'], ['גֵיא', 'H1516a', 'Ncbsc', 'the valley'], ['בֶן', 'H1516a', 'Np', 'of'],
      ['הִנֹּם', 'H1516a', 'Np', 'Ben Hinnom'], ['שְׂרֹף', 'H8313', 'Vqc', 'burn'], ['אֶת', 'H0853', 'To', ''], ['בְּנֵי', 'H1121', 'Ncmpc', 'sons'],
    )).ids).toEqual([topheth, topheth, topheth, topheth, undefined, undefined, undefined]);
    // 2 Chr 28:3: the "son" next to Hinnom, not "his sons" later in the verse.
    expect(map('2CH', 14, 28, 'hbo', verse(3,
      ['גֵיא', 'H1516', 'Ncbsc', 'valley'], ['בֶן', 'H1121', 'Ncmsc', 'son'], ['הִנֹּם', 'H2011', 'Np', 'Hinnom'],
      ['יַּבְעֵר', 'H1197', 'Vhw3ms', 'burned'], ['אֶת', 'H0853', 'To', ''], ['בָּנָיו', 'H1121', 'Ncmpc', 'sons'],
    )).ids).toEqual([topheth, topheth, topheth, undefined, undefined, undefined]);
    // A lone mention is kept: "a daughter of a Canaanite named Shua" is Bath-shua (Shua is her father).
    expect(map('GEN', 1, 38, 'hbo', verse(2,
      ['בַּת', 'H1323', 'Ncfsc', 'daughter'], ['אִישׁ', 'H0376', 'Ncmsc', 'man'], ['כְּנַעֲנִי', 'H3669', 'Ngmsa', 'Canaanite'],
      ['שְׁמוֹ', 'H8034', 'Ncmsc', 'name'], ['שׁוּעַ', 'H7770', 'Np', 'Shua'],
    )).ids).toEqual([id('Bath-shua@Gen.38.2-1Ch'), undefined, undefined, undefined, id('Shua@Gen.38.2')]);
  });

  it('chooses among the occurrences of a common noun that TIPNR names once', () => {
    const lord = id('LORD@Gen.1.1-Rev');
    // "The LORD of hosts musters an army": the צְבָא next to the LORD's name.
    expect(map('ISA', 23, 13, 'hbo', verse(4,
      ['יְהוָה', 'H3068', 'Np', 'LORD'], ['צְבָאוֹת', 'H6635', 'Ncbpa', 'hosts'], ['מְפַקֵּד', 'H6485', 'Vprmsa', 'mustering'], ['צְבָא', 'H6635', 'Ncbsc', 'army'],
    )).ids).toEqual([lord, lord, undefined, undefined]);
    // "The sons of Jaaziah: Beno": spelled like TIPNR's בְּנוֹ (with its suffix), not the plural בְּנֵי.
    expect(map('1CH', 13, 24, 'hbo', verse(26,
      ['בְּנֵי', 'H1121', 'Ncmpc', 'sons', 0], ['יַעֲזִיָּהוּ', 'H3269', 'Np', 'Jaaziah', 1], ['בְנ', 'H1121', 'Ncmsc', 'beno', 2], ['וֹ', 'H2050c', 'Sp3ms', 'his', 2],
    )).ids).toEqual([undefined, undefined, id('Beno@1Ch.24.26-'), undefined]);
    // "The king commanded Jerahmeel son of Hammelech": a person's name right after "son of".
    expect(map('JER', 24, 36, 'hbo', verse(26,
      ['הַ', 'H1886a', 'Td', 'the', 0], ['מֶּלֶךְ', 'H4428', 'Ncmsa', 'king', 0], ['יְרַחְמְאֵל', 'H3396', 'Np', 'Jerahmeel', 2],
      ['בֶּן', 'H1121', 'Ncmsc', 'son', 3], ['הַ', 'H1886a', 'Td', 'the', 4], ['מֶּלֶךְ', 'H4428', 'Ncmsa', 'king’s', 4],
    )).ids).toEqual([undefined, undefined, undefined, undefined, undefined, id('Hammelech@Jer.36.26-')]);
    // The Sabbath, not "weeks" (שַׁבָּתוֹת); occurrences that are equally good are all kept.
    const sabbath = id('Sabbath@Exo.16.23-Heb');
    expect(map('LEV', 3, 23, 'hbo', verse(15, ['שַּׁבָּת', 'H7676', 'Ncbsa', 'sabbath'], ['שֶׁבַע', 'H7651', 'Acfsa', 'seven'], ['שַׁבָּתוֹת', 'H7676', 'Ncbpa', 'weeks'])).ids)
      .toEqual([sabbath, undefined, undefined]);
    expect(map('LEV', 3, 24, 'hbo', verse(8, ['שַּׁבָּת', 'H7676', 'Ncbsa', 'sabbath'], ['יוֹם', 'H3117', 'Ncmsc', 'day'], ['שַּׁבָּת', 'H7676', 'Ncbsa', 'sabbath'])).ids)
      .toEqual([sabbath, undefined, sabbath]);
  });

  it('uses English capitals to tell the name from the common noun ("the Book of the Chronicles")', () => {
    const chron = id('Chronicles@1Ki.14.19-Est');
    const words = verse(19,
      ['דִּבְרֵי', 'H1697', 'Ncmpc', 'acts'], ['יָרָבְעָם', 'H3379', 'Np', 'Jeroboam'], ['סֵפֶר', 'H5612', 'Ncmsc', 'book'],
      ['דִּבְרֵי', 'H1697', 'Ncmpc', 'events'], ['יָּמִים', 'H3117', 'Ncmpa', 'days'],
    );
    const english = new Set([3, 4]); // BSB "the Book of the Chronicles" -> words 3-4
    expect(mapChapterDetailed(chapter('1KI', 14, 'hbo', words), 11, idx, undefined, english).ids).toEqual([undefined, undefined, undefined, chron, undefined]);
    // Without that evidence both stay: TIPNR names the verse, not the word.
    expect(map('1KI', 11, 14, 'hbo', words).ids).toEqual([chron, undefined, undefined, chron, undefined]);
  });

  it('capitalisedWords: mid-sentence capitals, not sentence or speech starts or pronouns of God', () => {
    const kjv: TextChapter = {
      tr: 'KJV',
      book: 'ISA',
      chapter: 62,
      verses: [
        {
          v: 4,
          t: [
            ['Thou', [1]], ' ', ['shalt', [2]], ' ', ['be', [3]], ' ', ['called', [3]], ' ', ['Hephzi-bah', [4, 5]], ', ', ['and', [6]], ' ',
            ['thy', [7]], ' ', ['land', [7]], ' ', ['Beulah', [8]], ': ', ['for', [9]], ' ', ['His', [10]], ' ', ['bride', [11]], '. ',
            ['The', [12]], ' ', ['LORD', [13]], ' ', ['saith', [14]], ', ', ['Behold', [15]], '.',
          ],
        },
      ],
    };
    expect([...capitalisedWords(kjv)].sort((a, b) => a - b)).toEqual([4, 5, 8, 13]);
  });
});

describe('assembleNames', () => {
  const orig: Record<string, OrigChapter> = {
    'GEN/17': chapter('GEN', 17, 'hbo', [
      w('אַבְרָהָם', 'H0085', 'Np', 'Abraham', 23),
      w('בֵּית', 'H1004', 'Ncmsc', 'house', 23),
      w('אַבְרָהָם', 'H0085', 'Np', 'Abraham’s', 23),
    ]),
  };
  const res = assembleNames(FIXTURE, (b, c) => orig[`${b}/${c}`] ?? null);
  const abraham = res.entities.find((e) => e.name === 'Abraham')!;

  it('writes chapter maps, refs (explicit + mapped), family and index rows', () => {
    expect(res.chapters.find((c) => c.book === 'GEN' && c.chapter === 17)!.words).toEqual({ '0': abraham.id, '2': abraham.id });
    expect(abraham.refs).toEqual([packRef(1, 11, 26), packRef(1, 17, 23), packRef(40, 1, 1)]); // LXX-only ref skipped
    const lord = res.entities.find((e) => e.name === 'LORD')!;
    expect(lord.kind).toBe('other');
    const famRow = res.family.find((r) => r[0] === abraham.id)!;
    expect(famRow.slice(1, 3)).toEqual(['Abraham', 'Patriarch, father of Isaac']);
    expect(res.family.every((r) => r[0].startsWith('p'))).toBe(true);
    // Family rows only link to people (the Bethel place founded by Abraham is left out).
    expect(famRow[4].every((x) => x.startsWith('p'))).toBe(true);
    expect(res.index.find((r) => r[0] === abraham.id)).toEqual([abraham.id, 'Abraham', 'person', 'Patriarch, father of Isaac', 3]);
    expect(res.index).toHaveLength(res.entities.length);
  });
});

/* ------------------------------------------------------------------------ */
/* src/lib/names.ts: lineage helpers                                          */
/* ------------------------------------------------------------------------ */

/*
 *   A ═ A2          G (unrelated)
 *   ├── B (A, A2) ── D ──┐
 *   └── C (A) ────── E ──┴── F (D, E): cousin marriage, so A appears twice above F
 */
const FAM: FamilyGraph = [
  ['p0001', 'A', 'root', [], ['p0002', 'p0003'], ['p0008'], []],
  ['p0002', 'B', 'son of A', ['p0001', 'p0008'], ['p0004'], [], ['p0009']],
  ['p0003', 'C', 'son of A', ['p0001'], ['p0005'], [], []],
  ['p0004', 'D', 'son of B', ['p0002'], ['p0006'], ['p0005'], []],
  ['p0005', 'E', 'daughter of C', ['p0003'], ['p0006'], ['p0004'], []],
  ['p0006', 'F', 'child of D and E', ['p0004', 'p0005'], [], [], []],
  ['p0007', 'G', 'unrelated', [], [], [], []],
  ['p0008', 'A2', 'wife of A', [], ['p0002'], ['p0001'], []],
  ['p0009', 'X', 'listed sibling of B', [], [], [], ['p0002']],
];
const names = (list: { id: string }[]) => list.map((r) => FAM.find((f) => f[0] === r.id)![1]);

describe('lineage helpers', () => {
  it('ancestors / descendants by generation, each person once', () => {
    expect(ancestors(FAM, 'p0006').map((a) => `${names([a])[0]}${a.gen}`)).toEqual(['D1', 'E1', 'B2', 'C2', 'A3', 'A23']);
    expect(names(ancestors(FAM, 'p0006', 1))).toEqual(['D', 'E']);
    expect(descendants(FAM, 'p0001', 2).map((a) => `${names([a])[0]}${a.gen}`)).toEqual(['B1', 'C1', 'D2', 'E2']);
    expect(ancestors(FAM, 'nobody')).toEqual([]);
  });

  it('siblingsOf includes listed siblings and half-siblings; partnersOf', () => {
    expect(siblingsOf(FAM, 'p0002')).toEqual(['p0009', 'p0003']);
    expect(siblingsOf(FAM, 'p0003')).toEqual(['p0002']);
    expect(partnersOf(FAM, 'p0001')).toEqual(['p0008']);
    expect(partnersOf(FAM, 'nobody')).toEqual([]);
  });

  it('lineageTree expands up and down, marks repeats and cut-offs', () => {
    const t = lineageTree(FAM, 'p0006', { up: 3, down: 1 })!;
    const show = (n: LineageNode): unknown => ({
      n: n.name,
      g: n.gen,
      ...(n.parents.length ? { p: n.parents.map(show) } : {}),
      ...(n.repeat ? { repeat: true } : {}),
    });
    expect(show(t)).toEqual({
      n: 'F',
      g: 0,
      p: [
        { n: 'D', g: -1, p: [{ n: 'B', g: -2, p: [{ n: 'A', g: -3 }, { n: 'A2', g: -3 }] }] },
        { n: 'E', g: -1, p: [{ n: 'C', g: -2, p: [{ n: 'A', g: -3, repeat: true }] }] },
      ],
    });
    const top = lineageTree(FAM, 'p0001', { up: 1, down: 1 })!;
    expect(top.partners).toEqual([{ id: 'p0008', name: 'A2' }]);
    expect(top.children.map((c) => [c.name, c.moreChildren])).toEqual([
      ['B', true],
      ['C', true],
    ]);
    expect(top.moreParents).toBe(false);
    expect(lineageTree(FAM, 'p0002', { up: 0, down: 0 })!.moreParents).toBe(true);
    expect(lineageTree(FAM, 'p0002')!.siblings).toEqual([
      { id: 'p0009', name: 'X' },
      { id: 'p0003', name: 'C' },
    ]);
    expect(lineageTree(FAM, 'nobody')).toBeNull();
  });

  it('findPath: descent, ascent, any direction, none', () => {
    const steps = (p: ReturnType<typeof findPath>) => p && p.map((s) => `${s.name}:${s.rel}`).join(' ');
    expect(steps(findPath(FAM, 'p0001', 'p0006'))).toBe('A:self B:child D:child F:child');
    expect(steps(findPath(FAM, 'p0006', 'p0001', { direction: 'down' }))).toBeNull();
    expect(steps(findPath(FAM, 'p0006', 'p0001'))).toBe('F:self D:parent B:parent A:parent'); // auto -> up
    expect(steps(findPath(FAM, 'p0004', 'p0003'))).toBe('D:self B:parent A:parent C:child'); // auto -> any
    expect(steps(findPath(FAM, 'p0004', 'p0003', { direction: 'any', maxSteps: 2 }))).toBeNull();
    expect(findPath(FAM, 'p0001', 'p0007')).toBeNull();
    expect(findPath(FAM, 'p0001', 'nobody')).toBeNull();
    expect(steps(findPath(FAM, 'p0001', 'p0001'))).toBe('A:self');
  });
});

/* ------------------------------------------------------------------------ */
/* src/lib/names.ts: loaders                                                  */
/* ------------------------------------------------------------------------ */

const ISRAEL: NameEntity = {
  id: 'p0001',
  name: 'Israel',
  kind: 'person',
  uniqueName: 'Israel@Gen.25.26-Rev',
  brief: 'Patriarch, son of Isaac',
  summary: '',
  forms: [
    ['H3478', 'יִשְׂרָאֵל', 'Israel'],
    ['H3290', 'יַעֲקֹב', 'Jacob'],
  ],
  refs: [1025026],
};
const JOSEPH: NameEntity = { ...ISRAEL, id: 'p0002', name: 'Joseph', uniqueName: 'Joseph@Gen.30.24-Rev', forms: [['H3130', 'יוֹסֵף', 'Joseph']] };
const FILES: Record<string, unknown> = {
  'names/chapters/GEN/30.json': { book: 'GEN', chapter: 30, words: { '3': 'p0001', '9': 'p0002' } } satisfies NameChapter,
  'names/entities/p/000.json': { p0001: ISRAEL, p0002: JOSEPH } satisfies NameEntityChunk,
  'names/family.json': FAM,
  'names/index.json': [
    ['p0001', 'Israel', 'person', 'Patriarch, son of Isaac', 2600],
    ['p0002', 'Joseph', 'person', 'Son of Jacob', 200],
    ['p0003', 'Joseph', 'person', 'Husband of Mary', 16],
    ['l0001', 'Jordan', 'place', 'River', 180],
    ['p0004', 'Barjoseph', 'person', 'test', 1],
  ] satisfies NameIndex,
};

describe('names loaders', () => {
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
    if (path === 'names/entities/l/005.json') return new Response('boom', { status: 500 });
    if (!(path in FILES)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(FILES[path]), { status: 200 });
  });
  beforeEach(() => {
    fetchMock.mockClear();
    configureData({ base: '/data/' });
    configureNames({ fetch: fetchMock });
  });

  it('loads a chapter map; a missing chapter is an empty map', async () => {
    const ch = await loadNameChapter('GEN', 30);
    expect(entityForWord(ch, 9)).toBe('p0002');
    expect(entityForWord(ch, 4)).toBeUndefined();
    expect(entityForToken(ch, ['Jacob', [2, 3]])).toBe('p0001');
    expect(entityForToken(null, ['x', [3]])).toBeUndefined();
    expect(await loadNameChapter('GEN', 31)).toEqual({ book: 'GEN', chapter: 31, words: {} });
    await loadNameChapter('GEN', 30);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('GEN/30')).length).toBe(1); // cached
  });

  it('loads entities from shared chunks, in order, skipping unknown ids', async () => {
    const list = await loadEntities(['p0002', 'p0001', 'p0099', 'nonsense']);
    expect(list.map((e) => e.id)).toEqual(['p0002', 'p0001']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/data/names/entities/p/000.json');
    expect(await loadEntity('l0100')).toBeUndefined(); // 404 chunk
    expect(isEntityId('p0001')).toBe(true);
    expect(isEntityId('x1')).toBe(false);
  });

  it('does not cache failures', async () => {
    await expect(loadEntity('l0500')).rejects.toThrow(/HTTP 500/);
    await expect(loadEntity('l0500')).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('nameForWord shows the name used in the text', () => {
    expect(nameForWord(ISRAEL, 'H3290')).toBe('Jacob');
    expect(nameForWord(ISRAEL, 'H3478')).toBe('Israel');
    expect(nameForWord(ISRAEL, 'H9999')).toBe('Israel');
    expect(nameForWord(ISRAEL, '')).toBe('Israel');
  });

  it('loads family and index once; searchNames ranks prefix matches by mentions', async () => {
    const [fam, fam2] = await Promise.all([loadFamily(), loadFamily()]);
    expect(fam).toBe(fam2);
    const index = await loadNameIndex();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(searchNames(index, 'jo').map((e) => e.brief)).toEqual(['Son of Jacob', 'River', 'Husband of Mary', 'test']);
    expect(searchNames(index, 'JOSEPH', { kind: 'person', limit: 2 }).map((e) => e.id)).toEqual(['p0002', 'p0003']);
    expect(searchNames(index, '  ')).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Generated data (skipped until `npm run data:build` has produced it)        */
/* ------------------------------------------------------------------------ */

const NAMES_DIR = join(process.cwd(), 'public', 'data', 'names');
const haveData = existsSync(join(NAMES_DIR, 'index.json')) && existsSync(join(process.cwd(), 'public', 'data', 'orig', 'MAT', '1.json'));

describe.skipIf(!haveData)('generated names data', () => {
  const read = <T>(...p: string[]): T => JSON.parse(readFileSync(join(NAMES_DIR, ...p), 'utf8')) as T;
  const index = haveData ? read<NameIndex>('index.json') : [];
  const family = haveData ? read<FamilyGraph>('family.json') : [];
  const ids = new Set(index.map((r) => r[0]));
  const entity = (id: string): NameEntity => read<NameEntityChunk>(...entityChunkPath(id).replace(/^names\//, '').split('/'))[id];
  const mapped = (book: string, c: number, v: number) => {
    const orig = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'orig', book, `${c}.json`), 'utf8')) as OrigChapter;
    const ch = read<NameChapter>('chapters', book, `${c}.json`);
    return orig.words.flatMap((wd, i) => (wd[5] === v && ch.words[i] ? [[wd[4], entity(ch.words[i]).uniqueName]] : []));
  };

  it('every chapter map points at known entities', () => {
    for (const book of readdirSync(join(NAMES_DIR, 'chapters'))) {
      for (const f of readdirSync(join(NAMES_DIR, 'chapters', book))) {
        for (const id of Object.values(read<NameChapter>('chapters', book, f).words)) expect(ids.has(id)).toBe(true);
      }
    }
  });

  it('family rows only link to people in the graph', () => {
    const people = new Set(family.map((r) => r[0]));
    for (const r of family) for (const list of r.slice(3) as string[][]) for (const x of list) expect(people.has(x)).toBe(true);
  });

  it('tells the Josephs, Marys and Herods apart', () => {
    expect(mapped('MAT', 1, 16)).toEqual([
      ['Jacob', 'Jacob@Mat.1.15-'],
      ['Joseph', 'Joseph@Mat.1.16-Jhn'],
      ['Mary', 'Mary@Mat.1.16-Act'],
      ['Jesus', 'Jesus@Isa.7.14-Rev'],
      ['Christ', 'Jesus@Isa.7.14-Rev'],
    ]);
    expect(mapped('MAT', 27, 57).find((m) => m[0] === 'Joseph')?.[1]).toBe('Joseph@Mat.27.57-Jhn');
    expect(mapped('GEN', 39, 1).find((m) => m[0] === 'Joseph')?.[1]).toBe('Joseph@Gen.30.24-Rev');
    expect(mapped('LUK', 10, 39).find((m) => m[0] === 'Mary')?.[1]).toBe('Mary@Luk.10.39-Jhn');
    expect(mapped('MAT', 2, 1).find((m) => m[0] === 'Herod')?.[1]).toBe('Herod@Mat.2.1-Act');
    expect(mapped('LUK', 3, 19).find((m) => m[0] === 'Herod')?.[1]).toBe('Herod@Mat.14.1-Act');
    expect(mapped('ACT', 12, 1).find((m) => m[0] === 'Herod')?.[1]).toBe('Herod@Act.12.1-');
  });

  it('maps the name, not common nouns or prefixes sharing its number (verifier cases)', () => {
    const at = (book: string, c: number, v: number, gloss: string) => mapped(book, c, v).filter((m) => m[0] === gloss).map((m) => m[1]);
    // Ben-hinnom is tagged H1516 throughout by Macula: "sons" / "people" are not its "Ben".
    expect(at('2CH', 28, 3, 'sons')).toEqual([]);
    expect(at('2CH', 28, 3, 'people')).toEqual([]);
    expect(at('JER', 7, 31, 'sons')).toEqual([]);
    expect(at('2CH', 33, 6, 'sons')).toEqual([]);
    // "the rest of the acts of …" vs "the Book of the Chronicles".
    expect(at('1KI', 14, 19, 'acts')).toEqual([]);
    expect(at('1KI', 14, 19, 'events')).toEqual(['Chronicles@1Ki.14.19-Est']);
    expect(at('2SA', 10, 6, 'men')).toEqual(['Tob@Jdg.11.3-2Sa']); // Ish-tob, not "1,000 men", "12,000 men"
    expect(at('JOS', 1, 4, 'great')).toEqual(['Great_Sea@Exo.23.31-Ezk']); // not the "great river"
    expect(at('ISA', 13, 4, 'army')).toEqual([]);
    expect(at('ISA', 13, 4, 'hosts')).toEqual(['LORD@Gen.1.1-Rev']);
    expect(at('JER', 36, 26, 'king')).toEqual([]);
    expect(at('JER', 36, 26, 'king’s')).toEqual(['Hammelech@Jer.36.26-']);
    expect(at('1CH', 24, 26, 'sons')).toEqual([]);
    expect(at('1CH', 24, 26, 'beno')).toEqual(['Beno@1Ch.24.26-']);
    // Lettered morphemes: the article הָ (H1886a) is not Dothan (H1886); the real second Dothan is.
    expect(mapped('GEN', 37, 17).filter((m) => m[1].startsWith('Dothan')).map((m) => m[0])).toEqual(['Dothan', 'Dothan']);
    expect(at('NUM', 21, 1, 'against')).toEqual([]);
    expect(at('AMO', 6, 2, 'yours')).toEqual([]);
    // TIPNR's a/b counted a word Macula tags differently.
    expect(mapped('1KI', 4, 13).filter((m) => m[0] === 'Gilead').map((m) => m[1])).toEqual(['Ramoth@Gen.31.47-Hos', 'Gilead@Gen.31.21-Zec']);
    expect(at('ROM', 16, 14, 'Hermas')).toEqual(['Hermas@Rom.16.14b']);
    expect(at('ROM', 16, 14, 'Hermes')).toEqual(['Hermes@Rom.16.14a']);
  });

  it('hovers with the name the English Bibles use', () => {
    const all: NameEntity[] = [];
    for (const k of ['p', 'l', 'g']) {
      for (const f of readdirSync(join(NAMES_DIR, 'entities', k))) all.push(...Object.values(read<NameEntityChunk>('entities', k, f)));
    }
    expect(all).toHaveLength(index.length);
    const byUnique = (u: string) => all.find((e) => e.uniqueName === u)!;
    const lord = byUnique('LORD@Gen.1.1-Rev');
    expect(nameForWord(lord, 'H0410')).toBe('God'); // not "God Most High"
    expect(nameForWord(byUnique('Jonathan@1Sa.13.2-1Ch'), 'H3083')).toBe('Jonathan'); // not "Jehonathan"
    expect(nameForWord(byUnique('Hezekiah@2Ki.16.20-Mat'), 'H3169')).toBe('Hezekiah'); // not "Jehezekiah"
    expect(nameForWord(byUnique('Jerusalem@Gen.14.18-Rev'), 'H6726')).toBe('Zion'); // not "Mount Zion"
    for (const e of all) {
      for (const f of e.forms) {
        expect(f[2]).not.toMatch(/[\/()[\]]|\p{Ll}\p{Lu}/u); // no "PharaohNeco", "Valley of/ Achor"
        if (f[0].startsWith('G')) expect(f[1]).not.toMatch(/[A-Za-z]/); // no Latin "a" in Κολaσσαεύς
      }
    }
  });

  it('connects Adam to Jesus and Abraham to David by descent', () => {
    const find = (u: string) => index.find((r) => r[0] === index.find((x) => x[1] === u.split('@')[0] && entity(x[0]).uniqueName === u)?.[0])![0];
    const path = findPath(family, find('Adam@Gen.2.19-Jud'), find('Jesus@Isa.7.14-Rev'), { direction: 'down' });
    expect(path).not.toBeNull();
    expect(path!.map((s) => s.name)).toEqual(expect.arrayContaining(['Seth', 'Noah', 'Abraham', 'David']));
    expect(path!.map((s) => s.name)).not.toContain('Cain');
    const ad = findPath(family, find('Abraham@Gen.11.26-1Pe'), find('David@Rut.4.17-Rev'), { direction: 'down' });
    expect(ad!.map((s) => s.name).join(' > ')).toBe(
      'Abraham > Isaac > Israel > Judah > Perez > Hezron > Ram > Amminadab > Nahshon > Salmon > Boaz > Obed > Jesse > David',
    );
  });
});
