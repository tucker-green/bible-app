/**
 * Lexicon usage figures (scripts/data/lexicon.ts): morpheme-id keying, the rendering normaliser and
 * unit attribution, the per-verse rendering counter, and LexEntry.verses / renderings assembly.
 * The last block checks the generated public/data/lex (skipped when it has not been built).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attachUsage,
  attributeUnit,
  cleanEnglishWord,
  minRenderingCount,
  morphKind,
  morphemeIdSet,
  normalizeRendering,
  posKind,
  RenderingCounter,
  usageKey,
  verseUnits,
} from '../scripts/data/lexicon';
import type { EnWord, MorphemeUse, WordKind } from '../scripts/data/lexicon';
import type { LexChunk, LexEntry, OrigChapter, OrigWord, Token } from '../src/lib/types';

/** English words, all with meaningful capitalisation. */
const en = (text: string): EnWord[] => text.split(' ').map((t) => ({ text: t, cap: true }));
const norm = (text: string, kind: WordKind, gloss = '') => normalizeRendering(en(text), kind, gloss)?.text ?? null;
const words = (parts: EnWord[][]) => parts.map((p) => p.map((w) => w.text).join(' '));

describe('morpheme ids and usage keys', () => {
  const use = (cls: MorphemeUse['cls']): MorphemeUse => ({ cls, aramaic: false, count: 9, total: 10 });
  const morphemes = morphemeIdSet(
    new Map<string, MorphemeUse>([
      ['H2050b', use('conj')],
      ['H1886a', use('art')],
      ['H0871a', use('prep-b')],
      ['H2050c', use('sfx-3ms')],
      ['H2004', use('sfx-3fp')], // plain Strong's number: never a morpheme key
      ['H1234x', use('other')], // no template
    ]),
  );

  it('selects lettered Hebrew ids with a morpheme entry', () => {
    expect([...morphemes].sort()).toEqual(['H0871a', 'H1886a', 'H2050b', 'H2050c']);
  });

  it('keeps morpheme ids whole and folds every other id to its base number', () => {
    expect(usageKey('H2050b', morphemes)).toBe('H2050b');
    expect(usageKey('H0871a', morphemes)).toBe('H0871a');
    expect(usageKey('H2050', morphemes)).toBe('H2050');
    expect(usageKey('H2050a', morphemes)).toBe('H2050'); // a real variant of the base word
    expect(usageKey('H1121a', morphemes)).toBe('H1121');
    expect(usageKey('G4053b', morphemes)).toBe('G4053');
    expect(usageKey('G3056', morphemes)).toBe('G3056');
  });
});

describe('word classes', () => {
  it('reads Robinson and OSHB morphology codes', () => {
    expect(morphKind('T-NSM', 'grc')).toBe('art');
    expect(morphKind('N-NSM', 'grc')).toBe('noun');
    expect(morphKind('N-PRI', 'grc')).toBe('noun');
    expect(morphKind('V-AAI-3S', 'grc')).toBe('verb');
    expect(morphKind('P-GSM', 'grc')).toBe('pron');
    expect(morphKind('PREP', 'grc')).toBe('prep');
    expect(morphKind('CONJ', 'grc')).toBe('conj');
    expect(morphKind('ADV', 'grc')).toBe('adv');
    expect(morphKind('Ncmsa', 'hbo')).toBe('noun');
    expect(morphKind('Np', 'hbo')).toBe('noun');
    expect(morphKind('Vqp3ms', 'hbo')).toBe('verb');
    expect(morphKind('Td', 'hbo')).toBe('art');
    expect(morphKind('To', 'hbo')).toBe('part');
    expect(morphKind('R', 'hbo')).toBe('prep');
    expect(morphKind('C', 'hbo')).toBe('conj');
    expect(morphKind('Sp3ms', 'hbo')).toBe('pron');
    expect(morphKind('Sd', 'hbo')).toBe('part');
    expect(morphKind('', 'hbo')).toBe('other');
  });

  it('reads lexicon parts of speech', () => {
    expect(posKind('Noun, masculine')).toBe('noun');
    expect(posKind('Proper noun, place')).toBe('noun');
    expect(posKind('Verb')).toBe('verb');
    expect(posKind('Conjunction (prefix)')).toBe('conj');
    expect(posKind('Suffix, pronominal (3rd person masculine singular)')).toBe('pron');
    expect(posKind('Article (prefix)')).toBe('art');
    expect(posKind('')).toBe('other');
  });
});

describe('normalizeRendering', () => {
  it('trims punctuation and possessive endings', () => {
    expect(cleanEnglishWord('“LORD’s')).toBe('LORD');
    expect(cleanEnglishWord('brothers’,')).toBe('brothers');
    expect(cleanEnglishWord('God-ward.')).toBe('God-ward');
    expect(cleanEnglishWord('20,000')).toBe('20,000');
    expect(norm('word,', 'noun')).toBe('word');
    expect(norm('Christ’s sake', 'noun', 'Christ')).toBe('Christ');
    expect(norm('his father’s house', 'noun', 'house')).toBe('house');
    expect(norm('his father’s house', 'noun', 'father')).toBe('father');
  });

  it('strips a leading article unless the word is an article', () => {
    expect(norm('the Word', 'noun', 'word')).toBe('Word');
    expect(norm('a man', 'noun')).toBe('man');
    expect(norm('the', 'art', 'the')).toBe('the');
    expect(norm('the one', 'art')).toBe('the one');
  });

  it('sheds context words around nouns, verbs and adjectives', () => {
    expect(norm('of God', 'noun', 'God')).toBe('God');
    expect(norm('In the beginning', 'noun')).toBe('beginning');
    expect(norm('upon the face', 'noun', 'surface')).toBe('face');
    expect(norm('his own hand', 'noun')).toBe('hand');
    expect(norm('all the gods', 'noun')).toBe('gods');
    expect(norm('this evil', 'noun', 'disaster')).toBe('evil');
    expect(norm('shall never', 'noun', 'forever')).toBe('never');
    expect(norm('O God', 'noun')).toBe('God');
    expect(norm('he called', 'verb')).toBe('called');
    expect(norm('to go', 'verb')).toBe('go');
    expect(norm('smote him', 'verb')).toBe('smote');
    expect(norm('lovest thou', 'verb')).toBe('lovest');
    expect(norm('ram and', 'noun')).toBe('ram');
  });

  it('keeps the gloss-matching span and drops context around it', () => {
    expect(norm('which the LORD', 'noun', 'LORD')).toBe('LORD');
    expect(norm('as surely as the LORD', 'noun', 'LORD')).toBe('LORD');
    expect(norm('am the LORD', 'noun', 'LORD')).toBe('LORD');
    expect(norm('love is', 'noun', 'love')).toBe('love');
    expect(norm('unto him', 'pron', 'him')).toBe('him');
    expect(norm('his father', 'pron', 'his')).toBe('his'); // a suffix's span only
    // A gloss-matching quantifier is never shed.
    expect(norm('all', 'noun', 'all')).toBe('all');
  });

  it('falls back to a preposition when that is all a content word has', () => {
    expect(norm('before', 'noun', '')).toBe('before'); // לִפְנֵי
    expect(norm('every', 'noun', 'every')).toBe('every');
  });

  it('drops renderings that say nothing about the word', () => {
    expect(norm('of', 'noun', 'God')).toBeNull();
    expect(norm('He', 'noun', 'Jesus')).toBeNull();
    expect(norm('O', 'noun', 'God')).toBeNull();
    expect(norm('over all', 'noun', 'earth')).toBeNull();
    expect(norm('to', 'part', '')).toBeNull(); // object marker
    expect(norm('of', 'art', 'the')).toBeNull();
    expect(norm('heart', 'prep', 'to')).toBeNull();
    expect(norm('king', 'art', 'king')).toBeNull();
    // ...but keeps a function word's own rendering.
    expect(norm('not', 'part', 'not')).toBe('not');
    expect(norm('which', 'pron', 'that')).toBe('which');
    expect(norm('then', 'conj', 'and')).toBe('then');
    expect(norm('was', 'verb', 'was')).toBe('was'); // the verb "to be" itself
  });

  it('limits renderings to four words and merges doubled words', () => {
    expect(norm('came to pass', 'verb')).toBe('came to pass');
    expect(norm('one two three four five', 'noun')).toBeNull();
    expect(norm('the the', 'art', 'the')).toBe('the');
  });

  it('reports whether the first kept word has meaningful capitals', () => {
    const r = normalizeRendering([{ text: 'And', cap: false }, { text: 'God', cap: true }], 'noun', 'God');
    expect(r).toEqual({ text: 'God', cap: true });
  });
});

describe('attributeUnit', () => {
  it('splits a unit by contextual glosses', () => {
    expect(words(attributeUnit(en('the Word'), [{ gloss: 'the', kind: 'art' }, { gloss: 'word', kind: 'noun' }]))).toEqual(['the', 'Word']);
    expect(
      words(attributeUnit(en('In the beginning'), [{ gloss: 'in', kind: 'prep' }, { gloss: 'beginning', kind: 'noun' }])),
    ).toEqual(['In', 'the beginning']);
    expect(
      words(attributeUnit(en('Now the earth'), [{ gloss: 'now', kind: 'conj' }, { gloss: 'the', kind: 'art' }, { gloss: 'earth', kind: 'noun' }])),
    ).toEqual(['Now', 'the', 'earth']);
    expect(words(attributeUnit(en('his disciples'), [{ gloss: 'disciples', kind: 'noun' }, { gloss: 'his', kind: 'pron' }]))).toEqual([
      'disciples',
      'his',
    ]);
  });

  it('gives unmatched words to the unmatched content word', () => {
    // וַ + יֹּאמֶר "said": nothing for the conjunction.
    expect(words(attributeUnit(en('said'), [{ gloss: 'and', kind: 'conj' }, { gloss: 'said', kind: 'verb' }]))).toEqual(['', 'said']);
    // KJV wording that differs from the gloss.
    expect(words(attributeUnit(en('begat'), [{ gloss: 'and', kind: 'conj' }, { gloss: 'fathered', kind: 'verb' }]))).toEqual(['', 'begat']);
    expect(words(attributeUnit(en('the earth'), [{ gloss: 'and', kind: 'conj' }, { gloss: 'land', kind: 'noun' }]))).toEqual(['', 'the earth']);
  });

  it('lets a function-word heir take only words of its class', () => {
    // "He" is no conjunction: it goes to the verb, which then sheds it.
    const parts = attributeUnit(en('He rested'), [{ gloss: 'and', kind: 'conj' }, { gloss: 'rested', kind: 'verb' }]);
    expect(words(parts)).toEqual(['', 'He rested']);
    expect(normalizeRendering(parts[1], 'verb', 'rested')?.text).toBe('rested');
    expect(words(attributeUnit(en('will be'), [{ gloss: 'and', kind: 'conj' }, { gloss: 'be', kind: 'verb' }]))).toEqual(['', 'will be']);
    expect(words(attributeUnit(en('Then he'), [{ gloss: 'and', kind: 'conj' }, { gloss: 'he', kind: 'pron' }]))).toEqual(['Then', 'he']);
  });

  it('gives a single source the whole unit', () => {
    expect(words(attributeUnit(en('in the beginning'), [{ gloss: 'beginning', kind: 'noun' }]))).toEqual(['in the beginning']);
  });
});

describe('verseUnits', () => {
  it('groups consecutive tokens with the same links and marks sentence-initial words', () => {
    const tokens: Token[] = [['In', [0, 1]], ' ', ['the', [0, 1]], ' ', ['beginning', [0, 1]], ' ', ['God', [3]], ', ', ['and', [5]], ' ', ['God', [3]], '.'];
    const units = verseUnits(tokens);
    expect(units.map((u) => [u.words.map((w) => w.text).join(' '), u.links.join(',')])).toEqual([
      ['In the beginning', '0,1'],
      ['God', '3'],
      ['and', '5'],
      ['God', '3'],
    ]);
    expect(units[0].words[0].cap).toBe(false); // verse start
    expect(units[1].words[0].cap).toBe(true);
  });

  it('breaks units at punctuation and unlinked words, and uses KJV tags for unlinked words', () => {
    const tokens: Token[] = [
      '“',
      ['Holy', [2]],
      ', ',
      ['holy', [2]],
      ' ',
      ['was', [], { i: 1 }],
      ' ',
      ['Dishan', [], { s: ['H1789'] }],
      '. ',
      ['The', [4]],
    ];
    const units = verseUnits(tokens);
    expect(units.map((u) => u.words.map((w) => w.text).join(' '))).toEqual(['Holy', 'holy', 'Dishan', 'The']);
    expect(units[0].words[0].cap).toBe(false); // after an opening quote
    expect(units[1].words[0].cap).toBe(true);
    expect(units[2].tags).toEqual(['H1789']);
    expect(units[3].words[0].cap).toBe(false); // after a full stop
  });
});

describe('RenderingCounter', () => {
  const w = (text: string, strongs: string, morph: string, gloss: string): OrigWord => [text, strongs, text, morph, gloss, 1, '', 0, '', ''];
  const orig: OrigChapter = {
    book: 'GEN',
    chapter: 1,
    lang: 'hbo',
    edition: 'WLC',
    words: [
      w('וְ', 'H2050b', 'C', 'and'), // 0
      w('הַ', 'H1886a', 'Td', 'the'), // 1
      w('אָרֶץ', 'H0776', 'Ncbsa', 'earth'), // 2
      w('אֱלֹהִים', 'H0430', 'Ncmpa', 'God'), // 3
      w('אֵת', 'H0853', 'To', '[direct object]'), // 4
      w('רַע', 'H7451b', 'Ncmsa', 'evil'), // 5
    ],
  };
  const morphemes = new Set(['H2050b', 'H1886a']);

  it('counts each rendering once per verse, keyed by usage key and lettered id', () => {
    const c = new RenderingCounter(morphemes);
    // "And the earth ... the earth": the earth twice in one verse counts once.
    c.addVerse('BSB', [['And', [0]], ' ', ['the', [1, 2]], ' ', ['earth', [1, 2]], ' ', ['God', [3]], ' ', ['the', [1, 2]], ' ', ['earth', [1, 2]]], orig);
    c.addVerse('BSB', [['God', [3]], ' ', ['saw', [4]], ' ', ['evil', [5]]], orig);
    c.addVerse('BSB', [['and', [0]], ' ', ['god', [3]], ' ', ['evil', [5]]], orig);
    const r = c.result();
    expect(r.get('H0776')?.BSB).toEqual([['earth', 1]]);
    expect(r.get('H1886a')?.BSB).toEqual([['the', 1]]);
    expect(r.get('H2050b')?.BSB).toEqual([['and', 2]]);
    expect(r.has('H2050')).toBe(false); // never merged into the unrelated base number
    expect(r.get('H0853')).toBeUndefined(); // untranslated object marker
    expect(r.get('H7451')?.BSB).toEqual([['evil', 2]]); // base number
    expect(r.get('H7451b')?.BSB).toEqual([['evil', 2]]); // and the lettered entry's own counts
  });

  it('capitalises only renderings that are consistently capitalised mid-sentence', () => {
    const c = new RenderingCounter(morphemes);
    // "God" mid-sentence 2× and once lower-case "god": 2/3 < 80% -> lower case.
    c.addVerse('KJV', [['and', [0]], ' ', ['God', [3]]], orig);
    c.addVerse('KJV', [['and', [0]], ' ', ['God', [3]]], orig);
    c.addVerse('KJV', [['and', [0]], ' ', ['god', [3]]], orig);
    // Sentence-initial "Earth" says nothing about case.
    c.addVerse('KJV', [['Earth', [2]]], orig);
    c.addVerse('KJV', [['and', [0]], ' ', ['earth', [2]]], orig);
    let r = c.result();
    expect(r.get('H0430')?.KJV).toEqual([['god', 3]]);
    expect(r.get('H0776')?.KJV).toEqual([['earth', 2]]);
    c.addVerse('KJV', [['and', [0]], ' ', ['God', [3]]], orig);
    c.addVerse('KJV', [['and', [0]], ' ', ['God', [3]]], orig);
    c.addVerse('KJV', [['and', [0]], ' ', ['God', [3]]], orig);
    r = c.result();
    expect(r.get('H0430')?.KJV).toEqual([['God', 6]]); // 5/6 capitalised
  });

  it('counts unlinked KJV words under their own Strong’s tags', () => {
    const c = new RenderingCounter(morphemes, () => 'noun');
    c.addVerse('KJV', [['of', [], { s: ['H1789'] }], ' ', ['Dishan', [], { s: ['H1789'] }]], orig);
    expect(c.result(6, () => true).get('H1789')?.KJV).toEqual([['Dishan', 1]]);
  });

  it('keeps the top renderings and drops rare ones for frequent words', () => {
    expect(minRenderingCount(5)).toBe(1);
    expect(minRenderingCount(10)).toBe(2);
    expect(minRenderingCount(5000)).toBe(25);
    const c = new RenderingCounter(morphemes);
    const add = (text: string, n: number) => {
      for (let i = 0; i < n; i++) c.addVerse('BSB', [['and', [0]], ' ', [text, [2]]], orig);
    };
    add('land', 30);
    add('earth', 20);
    add('ground', 3);
    add('country', 2);
    add('soil', 1);
    for (const x of ['field', 'world', 'region', 'territory']) add(x, 2);
    const list = c.result().get('H0776')!.BSB;
    expect(list).toHaveLength(6);
    expect(list.slice(0, 3)).toEqual([['land', 30], ['earth', 20], ['ground', 3]]);
    expect(list.map((x) => x[0])).not.toContain('soil');
  });
});

describe('attachUsage', () => {
  const entry = (id: string): LexEntry => ({ id, lemma: 'x', translit: 'x', pos: 'Noun', gloss: 'g', def: 'd' });

  it('gives morpheme ids their own figures and base aliases the base-number figures', () => {
    const ben = entry('H1121a');
    const entries = new Map<string, LexEntry>([
      ['H1121', ben],
      ['H1121a', ben],
      ['H1121b', entry('H1121b')], // "Beno": never used by the texts
      ['H7451b', entry('H7451b')],
      ['H2050', entry('H2050')],
      ['H2050b', entry('H2050b')],
    ]);
    const canonical = new Set(['H1121a', 'H1121b', 'H7451b', 'H2050', 'H2050b']);
    const verses = new Map([
      ['H1121', 3654],
      ['H7451', 625],
      ['H2050', 1],
      ['H2050b', 19613],
    ]);
    const renderings = new Map<string, Record<string, [string, number][]>>([
      ['H1121', { BSB: [['son', 10]], KJV: [['son', 12]] }],
      ['H1121a', { BSB: [['son', 3]] }],
      ['H7451b', { BSB: [['evil', 7]] }],
      ['H2050b', { BSB: [['and', 99]], KJV: [] }],
    ]);
    attachUsage(entries, canonical, new Set(['H2050b']), verses, renderings, new Set(['H1121', 'H7451b', 'H2050a', 'H2050b']));
    expect(ben.verses).toBe(3654);
    expect(ben.renderings).toEqual({ KJV: [['son', 12]], BSB: [['son', 10]] }); // KJV first, base figures
    expect(Object.keys(ben.renderings!)).toEqual(['KJV', 'BSB']);
    expect(entries.get('H1121b')!.verses).toBeUndefined();
    expect(entries.get('H7451b')).toMatchObject({ verses: 625, renderings: { BSB: [['evil', 7]] } });
    expect(entries.get('H2050')!.verses).toBe(1);
    expect(entries.get('H2050')!.renderings).toBeUndefined();
    expect(entries.get('H2050b')).toMatchObject({ verses: 19613, renderings: { BSB: [['and', 99]] } });
    expect(entries.get('H2050b')!.renderings!.KJV).toBeUndefined(); // empty lists are left out
  });
});

/* ------------------------------------------------------------------------ */
/* Generated data (skipped when public/data/lex or conc has not been built)  */
/* ------------------------------------------------------------------------ */

const DATA = join(process.cwd(), 'public', 'data');
const chunkFile = (dir: 'lex' | 'conc', id: string) =>
  join(DATA, dir, id[0], `${String(Math.floor(Number(id.slice(1, 5)) / 100)).padStart(3, '0')}.json`);
const built = existsSync(chunkFile('lex', 'G3056')) && existsSync(chunkFile('conc', 'G3056'));

describe.skipIf(!built)('generated lexicon usage', () => {
  const lex = (id: string): LexEntry => (JSON.parse(readFileSync(chunkFile('lex', id), 'utf8')) as LexChunk)[id];
  const conc = (id: string): number[] | undefined => JSON.parse(readFileSync(chunkFile('conc', id), 'utf8'))[id];
  const top = (id: string, tr: string) => (lex(id).renderings?.[tr] ?? []).map(([r]) => r);

  it('matches verse counts with the concordance, morphemes under their own key', () => {
    for (const id of ['G3056', 'G0026', 'G2316', 'H0430', 'H3068', 'H2050b', 'H0871a', 'H1886a', 'H2050c']) {
      expect(lex(id).verses, id).toBe(conc(id)!.length);
    }
    // "and" is no longer filed under H2050 "to break in" (which occurs once, Ps 62:3).
    expect(conc('H2050b')!.length).toBeGreaterThan(15000);
    expect(conc('H2050')!.length).toBeLessThan(10);
    expect(lex('H2050').verses).toBeLessThan(10);
  });

  it('has sensible renderings for key words', () => {
    if (lex('G3056').renderings?.BSB) expect(top('G3056', 'BSB').slice(0, 3)).toEqual(['word', 'words', 'message']);
    if (lex('G3056').renderings?.KJV) expect(top('G3056', 'KJV').slice(0, 3)).toEqual(['word', 'words', 'saying']);
    for (const tr of Object.keys(lex('H0430').renderings ?? {})) expect(top('H0430', tr)[0]).toBe('God');
    for (const tr of Object.keys(lex('H3068').renderings ?? {})) expect(top('H3068', tr)[0]).toBe('LORD');
    for (const tr of Object.keys(lex('H2050b').renderings ?? {})) expect(top('H2050b', tr)[0]).toBe('and');
    for (const tr of Object.keys(lex('H0871a').renderings ?? {})) expect(top('H0871a', tr)[0]).toBe('in');
    for (const tr of Object.keys(lex('G0026').renderings ?? {})) expect(top('G0026', tr)[0]).toBe('love');
  });
});
