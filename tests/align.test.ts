// @vitest-environment node
/**
 * Unit tests for the bridge aligner (src/lib/align): English normalisation, the translation table
 * (EM over link units, per-language halves, packed JSON) and bridgeVerse / bridgeChapter on small
 * hand-made Greek and Hebrew fixtures.
 */
import { describe, expect, it } from 'vitest';
import { alignVerse, bridgeChapter, bridgeVerse } from '../src/lib/align/bridge';
import { lemma, lemmas, stem, wordClass, fitsMorpheme } from '../src/lib/align/normalize';
import { TableBuilder, TranslationTable, tokenWords } from '../src/lib/align/table';
import type { OrigChapter, OrigWord, TextChapter, Token, WordToken } from '../src/lib/types';

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                  */
/* ------------------------------------------------------------------------ */

/** [text, strongs, morph, gloss, verse, group?] -> OrigWord */
function ow(text: string, strongs: string, morph: string, gloss: string, verse: number, group: number): OrigWord {
  return [text, strongs, text, morph, gloss, verse, '', group, '', ''];
}

/** John 3:16 (first half), SBLGNT order. */
const GREEK: OrigChapter = {
  book: 'JHN',
  chapter: 3,
  lang: 'grc',
  edition: 'SBLGNT',
  words: [
    ow('Οὕτως', 'G3779', 'ADV', 'so', 16, 0),
    ow('γὰρ', 'G1063', 'CONJ', 'for', 16, 1),
    ow('ἠγάπησεν', 'G0025', 'V-AAI-3S', 'loved', 16, 2),
    ow('ὁ', 'G3588', 'T-NSM', 'the', 16, 3),
    ow('θεὸς', 'G2316', 'N-NSM', 'God', 16, 4),
    ow('τὸν', 'G3588', 'T-ASM', 'the', 16, 5),
    ow('κόσμον', 'G2889', 'N-ASM', 'world', 16, 6),
  ],
};

/** Build tokens from [word, links] pairs and plain separators. */
function toks(...parts: (string | [string, number[]])[]): Token[] {
  return parts.map((p) => (typeof p === 'string' ? p : ([p[0], p[1]] as WordToken)));
}

const BSB_JHN: TextChapter = {
  tr: 'BSB',
  book: 'JHN',
  chapter: 3,
  verses: [
    {
      v: 16,
      t: toks(['For', [1]], ' ', ['God', [4]], ' ', ['so', [0]], ' ', ['loved', [2]], ' ', ['the', [5]], ' ', ['world', [6]], '.'),
    },
  ],
};

/** Gen 1:2-3 (parts), WLC morphemes. */
const HEBREW: OrigChapter = {
  book: 'GEN',
  chapter: 1,
  lang: 'hbo',
  edition: 'WLC',
  words: [
    ow('חֹשֶׁךְ', 'H2822', 'Ncmsa', 'darkness', 2, 0),
    ow('עַל', 'H5921', 'R', 'over', 2, 1),
    ow('פְּנֵי', 'H6440', 'Ncmpc', 'surface', 2, 2),
    ow('וַ', 'H2050b', 'C', 'and', 3, 3),
    ow('יֹּאמֶר', 'H0559', 'Vqw3ms', 'said', 3, 3),
    ow('אֱלֹהִים', 'H0430', 'Ncmpa', 'God', 3, 5),
    ow('יְהִי', 'H1961', 'Vqj3ms', 'let there be', 3, 6),
    ow('אוֹר', 'H0216', 'Ncbsa', 'light', 3, 7),
    ow('לְ', 'H3807a', 'R', 'to', 3, 8),
    ow('וֹ', 'H2050c', 'Sp3ms', 'him', 3, 8),
  ],
};

const BSB_GEN: TextChapter = {
  tr: 'BSB',
  book: 'GEN',
  chapter: 1,
  verses: [
    // The BSB links "was over" as a phrase: "was" alone must not pull עַל into another translation.
    { v: 2, t: toks(['darkness', [0]], ' ', ['was', [1]], ' ', ['over', [1]], ' ', ['the', [2]], ' ', ['surface', [2]], '.') },
    { v: 3, t: toks(['And', [5]], ' ', ['God', [5]], ' ', ['said', [3, 4]], ', “', ['Let', [6]], ' ', ['there', [6]], ' ', ['be', [6]], ' ', ['light', [7]], '.”') },
  ],
};

/** A table trained on the fixtures plus generic counts, as the pipeline would learn them over the whole Bible. */
function fixtureTable(): TranslationTable {
  const tb = new TableBuilder();
  tb.addChapter(BSB_JHN, GREEK);
  tb.addChapter(BSB_GEN, HEBREW);
  for (let i = 0; i < 40; i++) {
    tb.add('h', 'and', ['H2050b']);
    tb.add('h', 'be', []); // copulas are mostly unlinked in the OT
    tb.add('h', lemma('upon'), ['H5921']);
    tb.add('h', 'face', ['H6440']);
    tb.add('h', 'light', ['H0216']);
    tb.add('h', 'say', ['H0559']);
    tb.addUnit('h', ['to', 'him'], ['H3807a', 'H2050c']);
    tb.add('h', 'to', ['H3807a']);
    tb.add('h', 'him', ['H2050c']);
    tb.add('g', 'the', ['G3588']);
    tb.add('g', 'god', ['G2316']);
  }
  return tb.toTable();
}

const linksOf = (tokens: readonly Token[]) =>
  Object.fromEntries(tokens.filter((t): t is WordToken => typeof t !== 'string').map((t) => [t[0], t[1]]));
const plain = (tokens: readonly Token[]) => tokens.map((t) => (typeof t === 'string' ? t : t[0])).join('');

/* ------------------------------------------------------------------------ */
/* normalize                                                                 */
/* ------------------------------------------------------------------------ */

describe('lemma', () => {
  it('reduces inflections to one key', () => {
    expect(new Set(['love', 'loves', 'loved', 'loving'].map((w) => lemma(w)))).toEqual(new Set(['love']));
    expect(new Set(['believe', 'believes', 'believed', 'believing'].map((w) => lemma(w))).size).toBe(1);
    expect(lemma('cries')).toBe(lemma('cried'));
  });

  it('modernises archaic forms', () => {
    expect(lemma('believeth')).toBe(lemma('believes'));
    expect(lemma('loveth')).toBe(lemma('love'));
    expect(lemma('goeth')).toBe(lemma('go'));
    expect(lemma('seeth')).toBe(lemma('see'));
    expect(lemma('hath')).toBe(lemma('have'));
    expect(lemma('saith')).toBe(lemma('say'));
    expect(lemma('spake')).toBe(lemma('speak'));
    expect(lemma('begat')).toBe(lemma('beget'));
    expect(lemma('brethren')).toBe(lemma('brother'));
    expect(lemma('thee')).toBe(lemma('you'));
    expect(lemma('unto')).toBe(lemma('to'));
    expect(lemma('Jehovah')).toBe(lemma('LORD'));
  });

  it('keeps names and nouns that only look archaic', () => {
    expect(lemma('Nazareth')).toBe('nazareth');
    expect(lemma('Japheth')).toBe('japheth');
    expect(lemma('teeth')).toBe(lemma('tooth'));
    expect(lemma('priest')).toBe('priest');
  });

  it('reads -est as a verb only next to "thou"', () => {
    expect(lemmas(['thou', 'knowest'])[1]).toBe(lemma('know'));
    expect(lemmas(['Lovest', 'thou', 'me'])[0]).toBe(lemma('love'));
    expect(lemmas(['the', 'greatest'])[1]).toBe('greatest');
    expect(lemmas(['the', 'greatest', 'thou'])[1]).toBe('greatest'); // a superlative, even near thou
  });

  it('folds case, curly apostrophes and possessives', () => {
    expect(lemma('God’s')).toBe('god');
    expect(lemma('LORD')).toBe('lord');
    expect(lemma('seed-bearing')).toBe('seed-bear');
  });

  it('stem() follows Porter2 for the inflectional steps', () => {
    expect(stem('hopping')).toBe('hop');
    expect(stem('hoped')).toBe('hope');
    expect(stem('agreed')).toBe('agre');
    expect(stem('ties')).toBe('tie');
    expect(stem('cats')).toBe('cat');
  });
});

describe('wordClass / fitsMorpheme', () => {
  it('classifies function words', () => {
    expect(wordClass('The')).toBe('det');
    expect(wordClass('his')).toBe('poss');
    expect(wordClass('them')).toBe('obj');
    expect(wordClass('unto')).toBe('prep');
    expect(wordClass('and')).toBe('conj');
    expect(wordClass('shall')).toBe('aux');
    expect(wordClass('was')).toBe('cop');
    expect(wordClass('not')).toBe('other');
    expect(wordClass('world')).toBe('content');
  });

  it('pairs classes with Hebrew morpheme kinds', () => {
    expect(fitsMorpheme('det', 'Td')).toBe(true);
    expect(fitsMorpheme('det', 'Rd')).toBe(true);
    expect(fitsMorpheme('obj', 'Sp3ms')).toBe(true);
    expect(fitsMorpheme('obj', 'C')).toBe(false);
    expect(fitsMorpheme('conj', 'C')).toBe(true);
    expect(fitsMorpheme('subj', 'C')).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* table                                                                     */
/* ------------------------------------------------------------------------ */

describe('TableBuilder / TranslationTable', () => {
  it('splits a shared link set between its words by EM', () => {
    const tb = new TableBuilder();
    for (let i = 0; i < 10; i++) {
      tb.addUnit('h', ['to', 'him'], ['H3807a', 'H2050c']);
      tb.add('h', 'to', ['H3807a']);
      tb.add('h', 'him', ['H2050c']);
    }
    const t = tb.toTable();
    expect(t.prob('to', 'H3807a')).toBeGreaterThan(0.9);
    expect(t.prob('to', 'H2050c')).toBeLessThan(0.1);
    expect(t.prob('him', 'H2050c')).toBeGreaterThan(0.9);
  });

  it('counts unlinked occurrences in the denominator', () => {
    const tb = new TableBuilder();
    tb.add('h', 'of', ['H4480']);
    tb.add('h', 'of', []);
    tb.add('h', 'of', []);
    tb.add('h', 'of', []);
    expect(tb.toTable().prob('of', 'H4480')).toBeCloseTo(0.25);
  });

  it('keeps Greek and Hebrew apart and falls back to base ids', () => {
    const tb = new TableBuilder();
    for (let i = 0; i < 3; i++) tb.add('g', 'and', ['G2532']);
    for (let i = 0; i < 9; i++) tb.add('h', 'and', ['H2050b']);
    tb.add('h', 'in', ['H0871']);
    const t = tb.toTable();
    expect(t.prob('and', 'G2532')).toBe(1);
    expect(t.prob('and', 'H2050b')).toBe(1);
    expect(t.prob('in', 'H0871a')).toBe(1); // base-id fallback
    expect(t.count('h', 'and')).toBe(9);
  });

  it('round-trips through the packed JSON with pruning', () => {
    const tb = new TableBuilder();
    for (let i = 0; i < 10; i++) tb.add('g', 'love', ['G0025']);
    for (let i = 0; i < 2; i++) tb.add('g', 'love', ['G5368']);
    tb.add('g', 'rare', ['G9999']); // lemma seen once: pruned
    const json = tb.toJson();
    expect(json.v).toBe(1);
    expect(json.g.love).toBe('12 G0025 833 G5368 167');
    expect(json.g.rare).toBeUndefined();
    const t = TranslationTable.fromJson(JSON.parse(JSON.stringify(json)));
    expect(t.prob('love', 'G0025')).toBeCloseTo(0.833);
    expect(t.prob('love', 'G9999')).toBe(0);
    expect(t.prob('unseen', 'G0025')).toBe(0);
  });

  it('tokenWords lists words with their links', () => {
    expect(tokenWords(toks(['In', [0, 1]], ' the beginning, ', ['God', [3]]))).toEqual([
      { text: 'In', links: [0, 1] },
      { text: 'the', links: [] },
      { text: 'beginning', links: [] },
      { text: 'God', links: [3] },
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* bridge                                                                    */
/* ------------------------------------------------------------------------ */

describe('bridgeVerse', () => {
  const table = fixtureTable();

  it('reproduces the text exactly and links through the BSB', () => {
    const text = 'For God so greatly loved the world, that—';
    const out = bridgeVerse(text, BSB_JHN.verses[0].t, GREEK, 16, table);
    expect(plain(out)).toBe(text);
    const l = linksOf(out);
    expect(l.God).toEqual([4]);
    expect(l.loved).toEqual([2]);
    expect(l.world).toEqual([6]);
    expect(l.the).toEqual([5]); // the article that belongs to κόσμον
    expect(l.greatly).toBeUndefined(); // no evidence: left unlinked
    for (const t of out) if (typeof t !== 'string') expect(t[2]?.c).toBeGreaterThan(0.5);
  });

  it('matches archaic forms through their lemma', () => {
    const l = linksOf(bridgeVerse('God so loveth the world', BSB_JHN.verses[0].t, GREEK, 16, table));
    expect(l.loveth).toEqual([2]);
  });

  it('refuses a determiner that has no article of its own', () => {
    const l = linksOf(bridgeVerse('For a God so loved the world', BSB_JHN.verses[0].t, GREEK, 16, table));
    expect(l.a).toBeUndefined();
    expect(l.God).toEqual([4]);
  });

  it('does not let a BSB phrase link pull in a copula', () => {
    const out = bridgeVerse('and darkness was upon the face', BSB_GEN.verses[0].t, HEBREW, 2, table);
    const l = linksOf(out);
    expect(l.was).toBeUndefined();
    expect(l.darkness).toEqual([0]);
    expect(l.upon).toEqual([1]);
    expect(l.face).toEqual([2]);
  });

  it('attaches "and" to the וְ of the verb written before the subject', () => {
    const l = linksOf(bridgeVerse('And God said, Let there be light.', BSB_GEN.verses[1].t, HEBREW, 3, table));
    expect(l.And).toEqual([3]);
    expect(l.God).toEqual([5]);
    expect(l.said).toContain(4);
    expect(l.light).toEqual([7]);
  });

  it('reports per-word details', () => {
    const { words } = alignVerse('For God so loved the world', BSB_JHN.verses[0].t, GREEK, 16, table);
    expect(words.map((w) => w.cls)).toEqual(['prep', 'content', 'conj', 'content', 'det', 'content']);
    expect(words[1].kind).toBe('lex');
    expect(words[4].kind).toBe('attach');
  });

  it('returns the text unlinked when the verse has no original words', () => {
    expect(bridgeVerse('Howbeit this kind goeth not out.', undefined, GREEK, 21, table)).toEqual(['Howbeit this kind goeth not out.']);
    expect(bridgeVerse('', undefined, GREEK, 16, table)).toEqual([]);
  });

  it('works without any BSB verse (table and glosses only)', () => {
    const l = linksOf(bridgeVerse('God loved the world', undefined, GREEK, 16, table));
    expect(l.God).toEqual([4]);
    expect(l.world).toEqual([6]);
  });
});

describe('bridgeChapter', () => {
  it('bridges every verse and the superscription, keeping headings and paragraphs', () => {
    const table = fixtureTable();
    const orig: OrigChapter = { ...GREEK, words: [...GREEK.words, ow('ψαλμός', 'G5568', 'N-NSM', 'psalm', 0, 7)] };
    const target: TextChapter = {
      tr: 'NIV',
      book: 'JHN',
      chapter: 3,
      verses: [{ v: 16, t: ['For God so loved the world'] }],
      headings: [[16, 'God’s love']],
      paras: [16],
      superscription: ['A psalm'],
    };
    const out = bridgeChapter(target, BSB_JHN, orig, table);
    expect(out.headings).toEqual(target.headings);
    expect(out.paras).toEqual([16]);
    expect(linksOf(out.verses[0].t).world).toEqual([6]);
    expect(linksOf(out.superscription!).psalm).toEqual([7]); // via the gloss
    expect(target.verses[0].t).toEqual(['For God so loved the world']); // input untouched
  });

  it('is fast enough for the browser (a 60-verse chapter well under 30 ms)', () => {
    const table = fixtureTable();
    const target: TextChapter = {
      tr: 'NIV',
      book: 'JHN',
      chapter: 3,
      verses: Array.from({ length: 60 }, (_, i) => ({ v: 16 + i, t: ['For God so loved the world, that he gave his only Son.'] })),
    };
    bridgeChapter(target, BSB_JHN, GREEK, table); // warm up
    const t0 = performance.now();
    bridgeChapter(target, BSB_JHN, GREEK, table);
    expect(performance.now() - t0).toBeLessThan(30);
  });
});
