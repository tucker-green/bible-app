// @vitest-environment node
/**
 * Unit tests for the alignment pipeline stages: scripts/data/kjv.ts (CrossWire KJV parsing and
 * Strong's linking) and scripts/data/bridged.ts (WEB / ASV / YLT parsing and cleaning).
 */
import { describe, expect, it } from 'vitest';
import { TableBuilder } from '../src/lib/align/table';
import type { OrigChapter, OrigWord, Token, WordToken } from '../src/lib/types';
import {
  candidatesByVerse,
  cleanEntryText,
  kjvVerseText,
  layoutVerse,
  learnEquivalences,
  linkKjvVerse,
  monotoneAssign,
  parseKjvWord,
  piecesToTokens,
  type KjvRawWord,
} from '../scripts/data/kjv';
import { bridgeText, cleanText, cleanYlt, parseAsv, parseWebText, parseYlt, parseZefania, splitAsvTrailer, stripBrackets } from '../scripts/data/bridged';

function ow(text: string, strongs: string, morph: string, verse: number, group: number, lemma = text): OrigWord {
  return [text, strongs, lemma, morph, '', verse, '', group, '', ''];
}
const w = (text: string, lemma?: string, extra: Partial<KjvRawWord> = {}): KjvRawWord => ({ text, lemma: lemma ?? null, ...extra });

/* ------------------------------------------------------------------------ */
/* kjv.ts                                                                    */
/* ------------------------------------------------------------------------ */

describe('monotoneAssign', () => {
  it('maps occurrences to distinct candidates in order', () => {
    expect(monotoneAssign([0.1, 0.5, 0.9], [0, 0.45, 0.6, 1])).toEqual([0, 1, 3]);
  });
  it('shares candidates in order when there are fewer', () => {
    expect(monotoneAssign([0.1, 0.2, 0.9], [0.15, 0.95])).toEqual([0, 0, 1]);
  });
  it('handles empty inputs', () => {
    expect(monotoneAssign([], [0.5])).toEqual([]);
    expect(monotoneAssign([0.5], [])).toEqual([-1]);
  });
});

describe('parseKjvWord', () => {
  it('reads Strong’s, TR forms, Robinson codes and TR positions from the attributes', () => {
    const e = parseKjvWord(
      w('God', 'strong:G3588 strong:G2316 lemma.TR:ο lemma.TR:θεος', { morph: 'robinson:T-NSM robinson:N-NSM', metadata: { src: '4 5' } }),
    );
    expect(e.tags).toEqual([
      { strongs: 'G3588', morph: 'T-NSM', form: 'ο', src: 4 },
      { strongs: 'G2316', morph: 'N-NSM', form: 'θεος', src: 5 },
    ]);
  });
  it('normalises numbers without a strongs[] array and Strong’s TVM codes', () => {
    const e = parseKjvWord(w('loved', 'strong:G25 lemma.TR:ηγαπησεν', { morph: 'robinson:V-AAI-3S' }));
    expect(e.tags[0].strongs).toBe('G0025');
    const h = parseKjvWord(w('was', 'strong:H01961', { morph: 'strongMorph:TH8804' }));
    expect(h.tags).toEqual([{ strongs: 'H1961', morph: 'TH8804', form: '', src: 0 }]);
  });
  it('flags italics and split renderings', () => {
    expect(parseKjvWord(w('was', undefined, { metadata: { type: 'added' } })).added).toBe(true);
    expect(parseKjvWord(w('should', 'strong:G622', { metadata: { src: '22', type: 'x-split-1793' } })).split).toBe('x-split-1793');
  });
  it('prints the divine name in capitals and fixes en dashes in names', () => {
    expect(cleanEntryText('Lord’s', [{ strongs: 'H3068', morph: '', form: '', src: 0 }])).toBe('LORD’s');
    expect(cleanEntryText('Lord', [{ strongs: 'H0136', morph: '', form: '', src: 0 }])).toBe('Lord');
    expect(cleanEntryText('Baal–hanan', [])).toBe('Baal-hanan');
  });
});

describe('layoutVerse', () => {
  it('joins entries with spaces, attaching brackets and closing punctuation', () => {
    const entries = ['And', 'Casluhim,', '(', 'of', 'whom', 'came', 'the', 'Philistines', ',)', 'and', 'Caphthorim.'].map((t) => parseKjvWord(w(t)));
    expect(kjvVerseText(entries)).toBe('And Casluhim, (of whom came the Philistines,) and Caphthorim.');
    const words = layoutVerse(entries).filter((p) => p.word);
    expect(words.map((p) => p.text)).toEqual(['And', 'Casluhim', 'of', 'whom', 'came', 'the', 'Philistines', 'and', 'Caphthorim']);
  });
});

describe('linkKjvVerse', () => {
  // John 3:16a: Οὕτως γὰρ ἠγάπησεν ὁ θεὸς τὸν κόσμον (TR: ουτως γαρ ηγαπησεν ο θεος τον κοσμον)
  const words: OrigWord[] = [
    ow('Οὕτως', 'G3779', 'ADV', 16, 0),
    ow('γὰρ', 'G1063', 'CONJ', 16, 1),
    ow('ἠγάπησεν', 'G0025', 'V-AAI-3S', 16, 2),
    ow('ὁ', 'G3588', 'T-NSM', 16, 3),
    ow('θεὸς', 'G2316', 'N-NSM', 16, 4),
    ow('τὸν', 'G3588', 'T-ASM', 16, 5),
    ow('κόσμον', 'G2889', 'N-ASM', 16, 6),
  ];
  const cand = words.map((_, j) => j);
  const entries = [
    w('For', 'strong:G1063 lemma.TR:γαρ', { morph: 'robinson:CONJ', metadata: { src: '2' } }),
    w('God', 'strong:G3588 strong:G2316 lemma.TR:ο lemma.TR:θεος', { morph: 'robinson:T-NSM robinson:N-NSM', metadata: { src: '4 5' } }),
    w('so', 'strong:G3779 lemma.TR:ουτως', { metadata: { src: '1' } }),
    w('loved', 'strong:G25 lemma.TR:ηγαπησεν', { metadata: { src: '3' } }),
    w('the', 'strong:G3588 strong:G2889 lemma.TR:τον lemma.TR:κοσμον', { metadata: { src: '6 7' } }),
    w('world,', 'strong:G3588 strong:G2889 lemma.TR:τον lemma.TR:κοσμον', { metadata: { src: '6 7' } }),
    w('indeed', 'strong:G1161 lemma.TR:δε', { morph: 'robinson:CONJ', metadata: { src: '8' } }),
    w('truly', undefined, { metadata: { type: 'added' } }),
  ].map(parseKjvWord);

  it('links each word to the original word(s) with its Strong’s number', () => {
    const res = linkKjvVerse(entries, words, cand);
    const tokens = piecesToTokens(res.pieces);
    expect(tokens.map((t) => (typeof t === 'string' ? t : t[0])).join('')).toBe('For God so loved the world, indeed truly');
    const byWord = Object.fromEntries(tokens.filter((t): t is WordToken => typeof t !== 'string').map((t) => [t[0], t]));
    expect(byWord.For[1]).toEqual([1]);
    expect(byWord.God[1]).toEqual([3, 4]); // article + noun
    expect(byWord.the[1]).toEqual([5, 6]);
    expect(byWord.world[1]).toEqual([5, 6]);
  });

  it('keeps unlinkable Strong’s for the lexicon and flags italics', () => {
    const tokens = piecesToTokens(linkKjvVerse(entries, words, cand).pieces);
    const byWord = Object.fromEntries(tokens.filter((t): t is WordToken => typeof t !== 'string').map((t) => [t[0], t]));
    expect(byWord.indeed).toEqual(['indeed', [], { s: ['G1161'], m: ['CONJ'], o: ['δε'] }]);
    expect(byWord.truly).toEqual(['truly', [], { i: 1 }]);
  });

  it('chooses among repeated numbers by TR position', () => {
    const ws: OrigWord[] = [ow('ἀμὴν', 'G0281', 'HEB', 1, 0), ow('ἀμὴν', 'G0281', 'HEB', 1, 1), ow('λέγω', 'G3004', 'V-PAI-1S', 1, 2)];
    const es = [
      w('Verily,', 'strong:G281', { metadata: { src: '1' } }),
      w('verily,', 'strong:G281', { metadata: { src: '2' } }),
      w('I', 'strong:G3004', { metadata: { src: '3' } }),
      w('say', 'strong:G3004', { metadata: { src: '3' } }),
    ].map(parseKjvWord);
    const toks = piecesToTokens(linkKjvVerse(es, ws, [0, 1, 2]).pieces).filter((t): t is WordToken => typeof t !== 'string');
    expect(toks.map((t) => t[1])).toEqual([[0], [1], [2], [2]]);
  });

  it('matches other form-numbers of the same lemma and learned equivalences', () => {
    const ws: OrigWord[] = [ow('σε', 'G4571', 'P-2AS', 1, 0, 'σύ'), ow('יֵּלֶךְ', 'H1980', 'Vqw3ms', 1, 1)];
    const es = [w('thee', 'strong:G4771'), w('went', 'strong:H03212')].map(parseKjvWord);
    const keysOf = (j: number) => (j === 0 ? ['G4571', 'G4771'] : ['H1980']);
    const res = linkKjvVerse(es, ws, [0, 1], { keysOf, equiv: new Map([['H3212', ['H1980']]]) });
    expect(res.pieces.filter((p) => p.word).map((p) => p.word!.links)).toEqual([[0], [1]]);
  });

  it('moves function words inside a tagged Hebrew word to its prefixes', () => {
    // "And the earth" all tagged H776 = וְ + הָ + אָרֶץ
    const ws: OrigWord[] = [ow('וְ', 'H2050b', 'C', 2, 0), ow('הָ', 'H1886a', 'Td', 2, 0), ow('אָרֶץ', 'H0776', 'Ncbsa', 2, 0)];
    const es = ['And', 'the', 'earth'].map((t) => parseKjvWord(w(t, 'strong:H0776')));
    const tb = new TableBuilder();
    for (let i = 0; i < 10; i++) {
      tb.add('h', 'and', ['H2050b']);
      tb.add('h', 'the', ['H1886a']);
      tb.add('h', 'earth', ['H0776']);
    }
    const res = linkKjvVerse(es, ws, [0, 1, 2], { table: tb.toTable() });
    expect(res.pieces.filter((p) => p.word).map((p) => p.word!.links)).toEqual([[0], [1], [2]]);
  });

  it('moves an object pronoun tagged with the next word to the previous word’s suffix', () => {
    // "number them, every one that entereth": "them," is tagged H935 (entereth) in the KJV.
    const ws: OrigWord[] = [ow('תִּפְקְדֵ', 'H6485', 'Vqi2ms', 30, 0), ow('ם', 'H3963a', 'Sp3mp', 30, 0), ow('בָּא', 'H0935', 'Vqrmsa', 30, 2)];
    const es = [w('number', 'strong:H06485'), w('them,', 'strong:H0935'), w('every', 'strong:H0935'), w('one', 'strong:H0935')].map(parseKjvWord);
    const tb = new TableBuilder();
    for (let i = 0; i < 10; i++) tb.add('h', 'them', ['H3963a']);
    const res = linkKjvVerse(es, ws, [0, 1, 2], { table: tb.toTable() });
    expect(res.pieces.filter((p) => p.word).map((p) => p.word!.links)).toEqual([[0], [1], [2], [2]]);
  });
});

describe('candidatesByVerse', () => {
  it('gives the words of a verse the KJV lacks to the previous KJV verse', () => {
    const oc: OrigChapter = { book: '3JN', chapter: 1, lang: 'grc', edition: 'SBLGNT', words: [ow('a', 'G1', 'X', 14, 0), ow('b', 'G2', 'X', 15, 1), ow('c', 'G3', 'X', 0, 2)] };
    expect([...candidatesByVerse(oc, [13, 14])]).toEqual([
      [13, []],
      [14, [0, 1]],
    ]);
  });
});

describe('learnEquivalences', () => {
  it('pairs an unlinked number with a specific free one', () => {
    const stats = [
      ...Array.from({ length: 10 }, () => ({ unlinked: ['H3212'], free: ['H1980', 'H2050'] })),
      ...Array.from({ length: 90 }, () => ({ unlinked: [], free: ['H2050'] })),
    ];
    expect(learnEquivalences(stats)).toEqual(new Map([['H3212', ['H1980']]]));
  });
});

/* ------------------------------------------------------------------------ */
/* bridged.ts                                                                */
/* ------------------------------------------------------------------------ */

describe('text cleaning', () => {
  it('collapses whitespace and tidies punctuation', () => {
    expect(cleanText('  serve       thy brother ,  and ( so ) ')).toBe('serve thy brother, and (so)');
  });
  it('turns ASV [brackets] into supplied-word ranges', () => {
    expect(stripBrackets('herbs yielding seed, [and] fruit-trees')).toEqual({ text: 'herbs yielding seed, and fruit-trees', supplied: [[21, 24]] });
    expect(stripBrackets('no brackets')).toEqual({ text: 'no brackets' });
  });
  it('typesets YLT quotes and dashes', () => {
    expect(cleanYlt("and God saith, `Let light be;' and light is.")).toBe('and God saith, ‘Let light be;’ and light is.');
    expect(cleanYlt('the heavens and the earth--')).toBe('the heavens and the earth—');
    expect(cleanYlt("God's preparing")).toBe('God’s preparing');
  });
  it('finds the next Psalm’s number, title and book division at the end of an ASV verse', () => {
    expect(splitAsvTrailer('shall perish.           Psalm 2')).toEqual({ text: 'shall perish.', psalm: 2 });
    expect(splitAsvTrailer('in him.           Psalm 3  A Psalm of David.')).toEqual({ text: 'in him.', psalm: 3, title: 'A Psalm of David.' });
    expect(splitAsvTrailer('full of days.                      Book I  Psalm 1')).toEqual({ text: 'full of days.', psalm: 1, book: 'Book I' });
    expect(splitAsvTrailer('forsake me not utterly.          BETH.')).toEqual({ text: 'forsake me not utterly.', letter: 'BETH' });
    expect(splitAsvTrailer('upon thy people.     Selah')).toEqual({ text: 'upon thy people.     Selah' });
  });
});

describe('parseZefania / parseAsv', () => {
  const xml = `<XMLBIBLE><BIBLEBOOK bnumber="19" bname="Psalms"><CHAPTER cnumber="2">
    <VERS vnumber="12">Kiss the son, lest he be angry.           Psalm 3  A Psalm of David, when he fled.</VERS>
  </CHAPTER><CHAPTER cnumber="3"><VERS vnumber="1">Jehovah, how are mine adversaries increased! [they are] many &amp; more</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>`;
  it('reads verses', () => {
    expect(parseZefania(xml).map((r) => r.slice(0, 3))).toEqual([
      [19, 2, 12],
      [19, 3, 1],
    ]);
  });
  it('moves the next Psalm’s title to its superscription', () => {
    const bible = parseAsv(xml);
    expect(bible.get('PSA 2')!.verses[0].text).toBe('Kiss the son, lest he be angry.');
    expect(bible.get('PSA 3')!.superscription).toEqual({ text: 'A Psalm of David, when he fled.' });
    const v = bible.get('PSA 3')!.verses[0];
    expect(v.text).toBe('Jehovah, how are mine adversaries increased! they are many & more');
    expect(v.supplied).toEqual([[45, 53]]);
  });
});

describe('parseWebText', () => {
  const xml = `<usfx><book id="PSA"><c id="3"/><d>A Psalm by David.<f caller="+">note</f></d><q><v id="1"/>Yahweh, how my adversaries
  have increased!<ve/></q><q><v id="2"/>Many say, “There is no help.”<f caller="+">A footnote <ref tgt="X">x</ref></f>
<qs>Selah.</qs><ve/></q><c id="119"/><d>ALEPH</d><q><v id="1"/>Blessed are those<x caller="+"><xt>Ps 1</xt></x> who walk.<ve/></q></book>
<book id="TOB"><c id="1"/><p><v id="1"/>Not canon.<ve/></p></book>
<book id="JHN"><c id="3"/><p><v id="16"/><wj>For God so loved the world.</wj><ve/><v id="17"/><ve/></p></book></usfx>`;
  const bible = parseWebText(xml, new Set(['PSA', 'JHN']));
  it('reads verse text without notes and cross references', () => {
    expect(bible.get('PSA 3')!.verses).toEqual([
      { v: 1, text: 'Yahweh, how my adversaries have increased!' },
      { v: 2, text: 'Many say, “There is no help.” Selah.' },
    ]);
    expect(bible.get('PSA 119')!.verses[0].text).toBe('Blessed are those who walk.');
    expect(bible.get('JHN 3')!.verses[0]).toEqual({ v: 16, text: 'For God so loved the world.' });
  });
  it('turns <d> into a Psalm title, or a heading for Ps 119’s letters', () => {
    expect(bible.get('PSA 3')!.superscription).toEqual({ text: 'A Psalm by David.' });
    expect(bible.get('PSA 119')!.superscription).toBeUndefined();
    expect(bible.get('PSA 119')!.headings).toEqual([[1, 'Aleph']]);
  });
  it('skips books outside the canon', () => {
    expect([...bible.keys()]).toEqual(['PSA 3', 'PSA 119', 'JHN 3']);
  });
});

describe('parseYlt', () => {
  it('moves Ps 119’s letters to headings', () => {
    const books = Array.from({ length: 66 }, (_, i) => ({ name: `B${i}`, chapters: [] as { chapter: number; verses: { verse: number; text: string }[] }[] }));
    books[18].chapters = [{ chapter: 119, verses: [{ verse: 9, text: 'Beth. With what doth a young man purify his path?' }] }];
    const bible = parseYlt({ books });
    expect(bible.get('PSA 119')).toEqual({ verses: [{ v: 9, text: 'With what doth a young man purify his path?' }], headings: [[9, 'Beth']] });
  });
});

describe('bridgeText', () => {
  it('marks translator-supplied words as italic and unlinked', () => {
    const oc: OrigChapter = { book: 'GEN', chapter: 1, lang: 'hbo', edition: 'WLC', words: [ow('זֶרַע', 'H2233', 'Ncmsa', 11, 0), ow('עֵץ', 'H6086', 'Ncmsa', 11, 1)] };
    const tb = new TableBuilder();
    for (let i = 0; i < 5; i++) {
      tb.add('h', 'seed', ['H2233']);
      tb.add('h', 'tree', ['H6086']);
      tb.add('h', 'and', ['H6086']); // would link if not supplied
    }
    const tokens: Token[] = bridgeText(stripBrackets('seed, [and] tree'), undefined, oc, 11, tb.toTable());
    expect(tokens.map((t) => (typeof t === 'string' ? t : t[0])).join('')).toBe('seed, and tree');
    expect(tokens.find((t) => typeof t !== 'string' && t[0] === 'and')).toEqual(['and', [], { i: 1 }]);
    expect((tokens.find((t) => typeof t !== 'string' && t[0] === 'tree') as WordToken)[1]).toEqual([1]);
  });
});
