import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assembleLexicon,
  classifyMorpheme,
  decodeEntities,
  decodeStepMorph,
  escapeHtml,
  findMorphemeIds,
  isSafeDefHtml,
  morphemeEntry,
  parseStepLexicon,
  parseStepRefs,
  parseStrongsJs,
  renderRefParts,
  sanitizeStepDef,
  stripCantillation,
} from '../scripts/data/lexicon';
import type { MorphemeClass, StepRow, StrongsRaw } from '../scripts/data/lexicon';
import type { LexChunk, LexIndex } from '../src/lib/types';

const span = (ref: string, label: string) => `<span class="ref" data-ref="${ref}">${label}</span>`;

describe('escapeHtml / decodeEntities', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d');
  });
  it('decodes named and numeric entities, rejecting invalid code points', () => {
    expect(decodeEntities('&gt; &amp; &#945; &#x3b2; &bogus; &#0; &#xD800;')).toBe('> & α β &bogus;  ');
  });
  it('strips Hebrew cantillation but keeps vowels', () => {
    expect(stripCantillation('בַּ֫עַל')).toBe('בַּעַל');
  });
});

describe('parseStepRefs / renderRefParts', () => {
  const render = (attr: string, lang: 'G' | 'H' = 'G', visible = '') => {
    const parts = parseStepRefs(attr, lang, visible);
    return parts && renderRefParts(parts);
  };

  it('renders a single reference with a readable label', () => {
    expect(render('Mat.5.43')).toBe(span('MAT.5.43', 'Matt 5:43'));
    expect(render('Jhn.3.16')).toBe(span('JHN.3.16', 'John 3:16'));
  });

  it('splits chapter lists and verse continuations', () => {
    expect(render('Heb.5.4; 7.11; 9.4')).toBe(
      `${span('HEB.5.4', 'Heb 5:4')}; ${span('HEB.7.11', '7:11')}; ${span('HEB.9.4', '9:4')}`,
    );
    expect(render('1Co.14.9, 19')).toBe(`${span('1CO.14.9', '1 Cor 14:9')}, ${span('1CO.14.19', '19')}`);
    expect(render('Jhn.8:7; 20:4, 8')).toBe(
      `${span('JHN.8.7', 'John 8:7')}; ${span('JHN.20.4', '20:4')}, ${span('JHN.20.8', '8')}`,
    );
  });

  it('handles ranges, single-chapter books and chapter-only refs', () => {
    expect(render('Gen.4.2-10')).toBe(span('GEN.4.2', 'Gen 4:2–10'));
    expect(render('Mat.5.1-7.29')).toBe(span('MAT.5.1', 'Matt 5:1–7:29'));
    expect(render('Jude.12')).toBe(span('JUD.1.12', 'Jude 12'));
    expect(render('Psa.23')).toBe(span('PSA.23.1', 'Ps 23'));
    expect(render('Luk.4.34.')).toBe(span('LUK.4.34', 'Luke 4:34'));
    expect(render('Rom.6.27b, 55')).toBe(`${span('ROM.6.27', 'Rom 6:27')}, ${span('ROM.6.55', '55')}`);
  });

  it('maps Septuagint "Kingdoms" names in the Greek lexicon', () => {
    expect(render('1Sa.14.45', 'G', '1Ki.14:45')).toBe(span('1SA.14.45', '1 Sam 14:45'));
    expect(render('1Ki.18.4', 'G', '3Ki.18:4')).toBe(span('1KI.18.4', '1 Kgs 18:4'));
    expect(render('1Ki.23.21', 'G', '1Ki.23:21')).toBe(span('1SA.23.21', '1 Sam 23:21'));
    expect(render('2Ki.18.14', 'G', '2Ki.18:14')).toBe(span('2SA.18.14', '2 Sam 18:14'));
    expect(render('3Ki.8.61', 'G', '3Ki.8:61')).toBe(span('1KI.8.61', '1 Kgs 8:61'));
    expect(render('4Ki.1.13', 'G', '4Ki.1:13')).toBe(span('2KI.1.13', '2 Kgs 1:13'));
    // The Hebrew lexicon uses ordinary book names.
    expect(render('1Ki.7.13', 'H', '1Ki.7.13')).toBe(span('1KI.7.13', '1 Kgs 7:13'));
  });

  it('rejects non-canonical books, out-of-range chapters and junk', () => {
    expect(parseStepRefs('Sir.4.1')).toBeNull();
    expect(parseStepRefs('2Ma.6.18')).toBeNull();
    expect(parseStepRefs('Jas.22.25')).toBeNull();
    expect(parseStepRefs('7].20.4')).toBeNull();
    expect(parseStepRefs('Tim.4.8')).toBeNull();
    expect(parseStepRefs('Jhn.3.16" onmouseover="alert(1)')).toBeNull();
    expect(parseStepRefs('')).toBeNull();
  });
});

describe('sanitizeStepDef', () => {
  it('converts STEP refs, keeping punctuation that was inside the link text', () => {
    expect(sanitizeStepDef("to men, <ref='Rom.5.8'>Rom.5:8;</ref> to Christ")).toBe(
      `to men, ${span('ROM.5.8', 'Rom 5:8')}; to Christ`,
    );
    expect(sanitizeStepDef('(<ref="Pro.30.1-33">Pr 30:1-33</ref>)', 'H')).toBe(`(${span('PRO.30.1', 'Prov 30:1–33')})`);
  });

  it('turns outline markers and STEP line breaks into <br>', () => {
    expect(sanitizeStepDef('<b>love</b> <BR />__1. <b>Of men</b>: <BR /> __(a) to one another')).toBe(
      '<b>love</b><br>1. <b>Of men</b>:<br>(a) to one another',
    );
    expect(sanitizeStepDef('<BR /><br><lb />x<br /><BR>y<BR />')).toBe('x<br>y');
  });

  it('keeps nested/broken refs readable without duplicating text', () => {
    expect(sanitizeStepDef("<ref='2Ti.4.8, 10'>II <ref='Tim.4.8'>Tim 4:8</ref>, 10</ref>, al.")).toBe(
      `${span('2TI.4.8', '2 Tim 4:8')}, ${span('2TI.4.10', '10')}, al.`,
    );
    expect(sanitizeStepDef("cf. <ref='Sir.4.1'>Sir.4:1</ref>")).toBe('cf. Sir.4:1');
    expect(sanitizeStepDef("<ref='7].20.4'>7].20:4</ref> x")).toBe('7].20:4 x');
    expect(sanitizeStepDef("unclosed <ref='Mat.1.1'>Mat.1:1")).toBe('unclosed Mat.1:1');
    expect(sanitizeStepDef('stray </ref> closer')).toBe('stray closer');
  });

  it('removes apparatus that is noise in a popover', () => {
    const raw =
      " <b>ἀγάπη</b>, -ης, ἡ <BR /> [in LXX for אַהֲבָה, which is also rendered by ἀγάπησις ;] <BR /> <b>love</b>. No clear instance (with Deiss., <i>LAE</i>, 18; and MM, <i>VGT</i>, see word). Feasts: <ref='Jude.12'>Ju 12</ref>† <note>Transcriber note</note><BR /> (AS)";
    expect(sanitizeStepDef(raw)).toBe(
      `<b>ἀγάπη</b>, -ης, ἡ<br><b>love</b>. No clear instance. Feasts: ${span('JUD.1.12', 'Jude 12')}`,
    );
  });

  it('drops only the bibliographic clauses of a parenthetical that also cites verses', () => {
    expect(sanitizeStepDef("a word (<ref='Mat.1.1'>Mat.1:1</ref>; Cremer, 18; MM, <i>VGT</i>, see word) here")).toBe(
      `a word (${span('MAT.1.1', 'Matt 1:1')}) here`,
    );
  });

  it('drops Middle Liddell author citations, dates and javascript links', () => {
    const raw =
      '1. <b>to drive back </b>, (Odyssey by Homer) <br>2. <b>praiseworthy</b>, [<a href="javascript:void(0)" title="Aristotle">Refs 4th c.BC</a>, <date><i>variant</i> dates<author>Anthology</author></date> (ML)';
    expect(sanitizeStepDef(raw)).toBe('1. <b>to drive back </b><br>2. <b>praiseworthy</b>');
  });

  it('does not strip author-like parentheticals from Abbott-Smith (non-ML) entries', () => {
    expect(sanitizeStepDef('<b>anointed</b> (Christ) (AS)')).toBe('<b>anointed</b> (Christ)');
  });

  it('cleans Hebrew definitions: sense labels, bare refs and § separators', () => {
    expect(sanitizeStepDef(': beginning<br>1) first, beginning', 'H')).toBe('1) first, beginning');
    expect(sanitizeStepDef(': child/son', 'H')).toBe('child/son');
    expect(sanitizeStepDef('first mentioned at 1Sa.9.1; <br> also at 2Ch.2.13; 4.16; § Abiel = "God is father"', 'H')).toBe(
      `first mentioned at ${span('1SA.9.1', '1 Sam 9:1')};<br>also at ${span('2CH.2.13', '2 Chr 2:13')}; ${span('2CH.4.16', '4:16')};<br>Abiel = "God is father"`,
    );
    expect(sanitizeStepDef('(future<->past)', 'H')).toBe('(future&lt;-&gt;past)');
  });

  it('balances mis-nested and unclosed emphasis', () => {
    expect(sanitizeStepDef('<b><i>x</b>y</i>')).toBe('<b><i>x</i></b><i>y</i>');
    expect(sanitizeStepDef('<b>open')).toBe('<b>open</b>');
    expect(sanitizeStepDef('</i>close')).toBe('close');
    expect(sanitizeStepDef('<b> </b>x<i></i>')).toBe('x');
  });

  it('round-trips entities safely', () => {
    expect(sanitizeStepDef('(&gt; ἁγνός) &amp;lt;b&amp;gt; x')).toBe('(&gt; ἁγνός) &amp;lt;b&amp;gt; x');
    // A trailing entity keeps its ";" through the end-of-line punctuation clean-up.
    expect(sanitizeStepDef('a &gt;')).toBe('a &gt;');
    expect(sanitizeStepDef('a &lt;.<br>b')).toBe('a &lt;.<br>b');
    expect(sanitizeStepDef('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  describe('never lets active content through', () => {
    const attacks = [
      '<script>alert(1)</script>ok',
      '<SCRIPT src="//evil"></SCRIPT>ok',
      '<script>never closed',
      '<img src=x onerror=alert(1)>ok',
      '<img src="x" onerror="alert(1)"/>ok',
      '<a href="javascript:alert(1)">click</a>ok',
      '<a href=javascript:alert(1)>click',
      '<b onclick="alert(1)" style="x">bold</b>',
      '<i onmouseover=alert(1)>it</i>',
      "<ref='Jhn.3.16\" onmouseover=\"alert(1)'>John</ref>",
      '<ref="javascript:alert(1)">x</ref>',
      '<span class="ref" data-ref="JHN.3.16" onclick="alert(1)">x</span>',
      '<scr<script>ipt>alert(1)</scr</script>ipt>',
      '<<b>script>alert(1)<</b>/script>',
      '<svg onload=alert(1)><circle/></svg>ok',
      '<iframe src="https://evil"></iframe>ok',
      '<style>body{display:none}</style>ok',
      '<!-- <script>alert(1)</script> -->ok',
      '<br onload=alert(1)><BR/ onclick=x>',
      '<div style="background:url(javascript:alert(1))">x</div>',
      'javascript:alert(1)',
      '<object data="x"></object><embed src="x">',
      '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
      '<b\nonclick=alert(1)>x</b>',
      '<ref=\'Mat.5.43\' onclick=\'x\'>Mat.5:43</ref>',
      '\u0000<script>alert(1)</script>',
    ];
    it.each(attacks)('%s', (attack) => {
      const out = sanitizeStepDef(attack);
      expect(isSafeDefHtml(out)).toBe(true);
      expect(out).not.toMatch(/<script|<img|<a\b|<svg|<iframe|<style|<object|<embed|<math|<div/i);
      expect(out).not.toMatch(/\son\w+\s*=/i);
      expect(out).not.toMatch(/<[^>]*javascript:/i);
      expect(out).not.toMatch(/style=|href=|src=/i);
      // Same guarantees for the Hebrew path.
      expect(isSafeDefHtml(sanitizeStepDef(attack, 'H'))).toBe(true);
    });

    it('keeps only allowed attributes on generated spans', () => {
      const out = sanitizeStepDef("<ref='Mat.5.43' onclick='x'>Mat.5:43</ref>");
      expect(out).toBe(span('MAT.5.43', 'Matt 5:43'));
    });

    it('survives random fragment soup', () => {
      const frags = ['<', '>', '<b>', '</b>', '<i>', '</i>', "<ref='Mat.1.1'>", '</ref>', '<BR />', '__1.', '(', ')', '[', ']',
        '&amp;', '&lt;', '"', "'", 'javascript:', 'onerror=', '<script>', '</script>', '<a href="x">', '</a>', 'αβγ', 'שָׁלוֹם',
        ' ', '; ', 'MM, ', '<note>', '</note>', '§', '†', '<ref="Gen.1.1">', '<img ', 'src=x', '/>'];
      let seed = 42;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
      for (let n = 0; n < 500; n++) {
        let s = '';
        const len = 1 + Math.floor(rnd() * 30);
        for (let k = 0; k < len; k++) s += frags[Math.floor(rnd() * frags.length)];
        for (const lang of ['G', 'H'] as const) {
          const out = sanitizeStepDef(s, lang);
          if (!isSafeDefHtml(out)) throw new Error(`unsafe output for ${JSON.stringify(s)}: ${out}`);
        }
      }
    });
  });
});

describe('isSafeDefHtml', () => {
  it('accepts the allowed subset and rejects anything else', () => {
    expect(isSafeDefHtml(`<b>a</b><i>b</i><br>${span('JHN.3.16', 'John 3:16')} &amp; &lt;`)).toBe(true);
    expect(isSafeDefHtml('<span class="ref" data-ref="JHN.3.16" onclick="x">a</span>')).toBe(false);
    expect(isSafeDefHtml('<u>a</u>')).toBe(false);
    expect(isSafeDefHtml('a < b')).toBe(false);
    expect(isSafeDefHtml('&quot;')).toBe(false);
  });
});

describe('decodeStepMorph', () => {
  it.each([
    ['G:V', 'G', 'Verb'],
    ['G:N-F', 'G', 'Noun, feminine'],
    ['G:N-M/F', 'G', 'Noun, masculine/feminine'],
    ['H:N-M', 'H', 'Noun, masculine'],
    ['A:V', 'H', 'Verb (Aramaic)'],
    ['A:N-F', 'G', 'Noun, feminine (Aramaic)'],
    ['H:N', 'G', 'Noun (Hebrew)'],
    ['N:N-M-P', 'G', 'Proper noun, person'],
    ['N:N-F-P', 'H', 'Proper noun, person (female)'],
    ['N:N--L', 'H', 'Proper noun, place'],
    ['N:N-F-L', 'H', 'Proper noun, place'],
    ['N:N--LG', 'H', 'Proper noun, gentilic'],
    ['N:N--PG', 'H', 'Proper noun, gentilic'],
    ['N:A--LG', 'G', 'Adjective, gentilic'],
    ['N:N--T', 'H', 'Proper noun, title'],
    ['N:N', 'G', 'Proper noun'],
    ['G:N-PRI', 'G', 'Proper noun, indeclinable'],
    ['G:N-LI', 'G', 'Noun, letter (indeclinable)'],
    ['G:A-NUI', 'G', 'Numeral (indeclinable)'],
    ['G:A', 'G', 'Adjective'],
    ['G:A--C', 'G', 'Adjective, comparative'],
    ['H:A-F', 'H', 'Adjective, feminine'],
    ['G:ADV', 'G', 'Adverb'],
    ['G:ADV-C', 'G', 'Adverb, comparative'],
    ['G:ADV-I', 'G', 'Adverb, interrogative'],
    ['H:Adv', 'H', 'Adverb'],
    ['G:PREP', 'G', 'Preposition'],
    ['H:Prep', 'H', 'Preposition'],
    ['G:CONJ', 'G', 'Conjunction'],
    ['G:COND', 'G', 'Conditional particle'],
    ['G:PRT-N', 'G', 'Particle, negative'],
    ['G:INJ', 'G', 'Interjection'],
    ['H:Intj', 'H', 'Interjection'],
    ['G:T', 'G', 'Article'],
    ['G:P', 'G', 'Personal pronoun'],
    ['G:P-1', 'G', 'Personal pronoun, 1st person'],
    ['G:F-3', 'G', 'Reflexive pronoun, 3rd person'],
    ['G:S-1', 'G', 'Possessive pronoun, 1st person'],
    ['G:D', 'G', 'Demonstrative pronoun'],
    ['G:R', 'G', 'Relative pronoun'],
    ['G:I', 'G', 'Interrogative pronoun'],
    ['G:X', 'G', 'Indefinite pronoun'],
    ['G:K', 'G', 'Correlative pronoun'],
    ['H:PerP-CS', 'H', 'Personal pronoun, common singular'],
    ['H:DemP', 'H', 'Demonstrative pronoun'],
    ['H:IndP', 'H', 'Indefinite pronoun'],
    ['H:Neg', 'H', 'Negative particle'],
    ['H:Part', 'H', 'Particle'],
    ['G:A / G:ADV', 'G', 'Adjective / Adverb'],
    ['G:PRT-N+G:CONJ', 'G', 'Particle, negative + Conjunction'],
    ['H:Prep+H:RelP', 'H', 'Preposition + Relative pronoun'],
    ['', 'G', ''],
    ['G:', 'G', ''],
    ['nonsense', 'G', ''],
  ] as const)('%s -> %s', (code, lang, expected) => {
    expect(decodeStepMorph(code, lang)).toBe(expected);
  });
});

describe('parseStrongsJs', () => {
  const text = [
    '/**',
    " * A Concise Dictionary { with braces } in a comment and a fake var x = {\"no\": 1}",
    ' */',
    'var strongsHebrewDictionary = {"H1":{"lemma":"אָב","xlit":"ʼâb","strongs_def":"father","kjv_def":"chief, father."},',
    '"H2":{"lemma":"אַב","strongs_def":"{father}","kjv_def":"a \\"}\\" inside","derivation":"(Aramaic) corresponding to H1;","n":5},',
    '"bad key":{"lemma":"x"}};',
    'module.exports = strongsHebrewDictionary; globalThis.__pwned = true;',
  ].join('\n');

  it('extracts the object literal without evaluating the file', () => {
    const d = parseStrongsJs(text);
    expect(Object.keys(d)).toEqual(['H1', 'H2']);
    expect(d.H1.lemma).toBe('אָב');
    expect(d.H2.kjv_def).toBe('a "}" inside');
    expect((d.H2 as Record<string, unknown>).n).toBeUndefined();
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('throws on input without an object literal or with broken JSON', () => {
    expect(() => parseStrongsJs('module.exports = 1;')).toThrow();
    expect(() => parseStrongsJs('var x = {"a": ')).toThrow();
    expect(() => parseStrongsJs('var x = {a: alert(1)};')).toThrow();
  });
});

describe('parseStepLexicon', () => {
  const text = [
    'TBESH header line',
    'eStrong#\tdStrong\tuStrong\tHebrew\tTransliteration\tMorph\tGloss\tMeaning',
    'H0001\tH0001G =\tH0001G\tאָב\tav\tH:N-M\tfather\t1) father<br>2) ancestor',
    'H0001\tH0001H = a Part of\tH2438H, \tאָב\tav\tH:N-M\t(Huram)-abi\tCombined with Hiram',
    'H1121a\tH1121A =\tH1121A\tבֵּן\tben\tH:N-M\tson: child\t: child/son',
    '$========== PERSON(s)',
    '- Named\tHerod@Mat.2.1\tG2264G«G2264=Ἡρώδης',
    'H5209\tH5209 = a Form of\tH4771\tx\tx\tG:\tyou\tdef',
  ].join('\n');

  it('reads data rows only, normalising ids and splitting the dStrong relation', () => {
    const rows = parseStepLexicon(text, 'H');
    expect(rows.map((r) => r.eid)).toEqual(['H0001', 'H0001', 'H1121a', 'H5209']);
    expect(rows[0]).toMatchObject({ did: 'H0001G', rel: '', uid: 'H0001G', gloss: 'father', morph: 'H:N-M' });
    expect(rows[1]).toMatchObject({ did: 'H0001H', rel: 'a Part of', uid: 'H2438H' });
    expect(rows[3]).toMatchObject({ rel: 'a Form of', uid: 'H4771' });
  });
});

describe('Hebrew morphemes', () => {
  // Macula writes dagesh before the vowel; NFC puts the vowel first. Both must match.
  const bDageshFirst = 'בְּ';
  const bVowelFirst = 'בְּ';

  it('classifies prefixes and suffixes regardless of mark order', () => {
    expect(classifyMorpheme({ pos: 'preposition', type: '', lemma: bDageshFirst, morph: 'R' })).toBe('prep-b');
    expect(classifyMorpheme({ pos: 'preposition', type: '', lemma: bVowelFirst, morph: 'Rd' })).toBe('prep-b');
    expect(classifyMorpheme({ pos: 'conjunction', type: '', lemma: 'וְ', morph: 'C' })).toBe('conj');
    expect(classifyMorpheme({ pos: 'particle', type: 'definite article', lemma: 'הַ', morph: 'Td' })).toBe('art');
    expect(classifyMorpheme({ pos: 'particle', type: 'interrogative', lemma: 'הֲ', morph: 'Ti' })).toBe('interr');
    expect(classifyMorpheme({ pos: 'suffix', type: 'pronominal', lemma: 'הוּא', morph: 'Sp3ms' })).toBe('sfx-3ms');
    expect(classifyMorpheme({ pos: 'suffix', type: 'pronominal', lemma: 'הוּא', morph: 'Sp2bs' })).toBe('sfx-2cs');
    expect(classifyMorpheme({ pos: 'suffix', type: 'directional he', lemma: 'ה', morph: 'Sd' })).toBe('dir-he');
    expect(classifyMorpheme({ pos: 'noun', type: 'common', lemma: 'בַּיִת', morph: 'Ncmsa' })).toBe('other');
  });

  it('picks ids used mostly as one morpheme, with language and secondary person', () => {
    const rows = [
      ...Array.from({ length: 9 }, () => ({ strong: '0871a', lang: 'H', pos: 'preposition', type: '', lemma: bDageshFirst, morph: 'R' })),
      { strong: '0871a', lang: 'H', pos: 'noun', type: '', lemma: 'בַּעְיָם', morph: 'Np' },
      ...Array.from({ length: 5 }, () => ({ strong: '2050d', lang: 'A', pos: 'conjunction', type: '', lemma: 'וְ', morph: 'C' })),
      ...Array.from({ length: 7 }, () => ({ strong: '5105b', lang: 'H', pos: 'suffix', type: 'pronominal', lemma: 'הוּא', morph: 'Sp3ms' })),
      ...Array.from({ length: 3 }, () => ({ strong: '5105b', lang: 'H', pos: 'suffix', type: 'pronominal', lemma: 'הוּא', morph: 'Sp1cp' })),
      // Mostly a content word: not a morpheme.
      ...Array.from({ length: 3 }, () => ({ strong: '4445a', lang: 'H', pos: 'noun', type: '', lemma: 'מַלְכָּם', morph: 'Np' })),
      { strong: '4445a', lang: 'H', pos: 'suffix', type: 'pronominal', lemma: 'הוּא', morph: 'Sp3mp' },
      { strong: '5921|3963a', lang: 'H', pos: 'suffix', type: 'pronominal', lemma: 'הוּא', morph: 'Sp3mp' },
    ];
    const m = findMorphemeIds(rows);
    expect(m.get('H0871a')).toMatchObject({ cls: 'prep-b', aramaic: false, count: 9, total: 10 });
    expect(m.get('H2050d')).toMatchObject({ cls: 'conj', aramaic: true });
    expect(m.get('H5105b')).toMatchObject({ cls: 'sfx-3ms', alsoPgn: '1cp' });
    expect(m.has('H4445a')).toBe(false);
    expect(m.get('H3963a')).toMatchObject({ cls: 'sfx-3mp' });
  });

  it('produces safe, accurate template entries', () => {
    const classes: MorphemeClass[] = ['conj', 'art', 'interr', 'prep-b', 'prep-k', 'prep-l', 'rel', 'dir-he', 'par-he', 'par-nun',
      'sfx-1cs', 'sfx-1cp', 'sfx-2ms', 'sfx-2fs', 'sfx-2mp', 'sfx-2fp', 'sfx-3ms', 'sfx-3fs', 'sfx-3mp', 'sfx-3fp'];
    for (const cls of classes)
      for (const aramaic of [false, true]) {
        const t = morphemeEntry(cls, aramaic);
        expect(t, `${cls}`).not.toBeNull();
        expect(isSafeDefHtml(t!.def)).toBe(true);
        expect(t!.gloss).not.toBe('');
      }
    expect(morphemeEntry('conj', false)!.gloss).toBe('and');
    expect(morphemeEntry('art', false)!.gloss).toBe('the');
    expect(morphemeEntry('prep-b', false)).toMatchObject({ lemma: 'בְּ', pos: 'Preposition (prefix)' });
    expect(morphemeEntry('prep-k', false)!.gloss).toBe('like, as');
    expect(morphemeEntry('prep-l', true)!.pos).toBe('Preposition (prefix, Aramaic)');
    expect(morphemeEntry('sfx-3ms', false)!.gloss).toBe('his, its, him, it');
    expect(morphemeEntry('sfx-1cs', false)!.pos).toBe('Suffix, pronominal (1st person singular)');
    expect(morphemeEntry('sfx-3ms', false, '1cp')!.def).toContain('1st person plural');
    expect(morphemeEntry('other', false)).toBeNull();
    expect(morphemeEntry('sfx-9xx', false)).toBeNull();
  });
});

describe('assembleLexicon', () => {
  const row = (eid: string, over: Partial<StepRow> = {}): StepRow => ({
    eid, did: eid, rel: '', uid: eid, lemma: 'x', translit: 'x', morph: 'H:N-M', gloss: 'g', def: 'd', ...over,
  });
  const strongs = (lemma: string, def = 'sdef'): StrongsRaw => ({ lemma, xlit: 'xl', strongs_def: ` ${def} `, kjv_def: 'kjv', derivation: 'from H9;' });

  const build = () =>
    assembleLexicon({
      stepG: [
        row('G0026', { lemma: 'ἀγάπη', translit: 'agapē', morph: 'G:N-F', gloss: 'love', def: '<b>love</b> (AS)' }),
        row('G4771', { lemma: 'σύ', morph: 'G:P-2', gloss: 'you', def: '<b>σύ</b>, thou' }),
        row('G5209', { lemma: 'ὑμᾶς', morph: 'G:', gloss: 'you', rel: 'a Form of', uid: 'G4771', def: '<b>αὐτός</b>, wrong word' }),
        row('G6029', { lemma: 'ἐκπερισσῶς', morph: 'G:ADV', gloss: 'overexcessively', def: '<b>more exceedingly</b>' }),
      ],
      stepH: [
        row('H1121a', { lemma: 'בֵּן', gloss: 'son: child', def: ': child/son' }),
        row('H1121a', { lemma: 'בֵּן', gloss: 'son: warrior', rel: 'a Meaning of', def: ': warrior' }),
        row('H1121b', { lemma: 'בְּנוֹ', morph: 'N:N-M-P', gloss: 'Beno', def: 'A man' }),
        row('H3641a', { lemma: 'כַּלְנֵה', morph: 'N:N--L', gloss: 'Calneh', def: 'a city' }),
        row('H3641b', { lemma: 'כַּלְנֶה', morph: 'N:N--L', gloss: 'Calneh', def: 'a city' }),
        row('H2004', { lemma: 'הֵן', morph: 'H:PerP-FP', gloss: 'they(fem.)', def: 'they' }),
      ],
      strongsG: { G26: { lemma: 'ἀγάπη', translit: 'agápē', strongs_def: 'love' }, G4771: { lemma: 'σύ' }, G5209: { lemma: 'ὑμᾶς' } },
      strongsH: { H1121: strongs('בֵּן', 'a son'), H3641: strongs('כַּלְנֵה'), H2004: strongs('הֵן'), H5: strongs('אֲבַגְתָא', 'Abagtha') },
      morphemes: new Map([
        ['H3641b', { cls: 'sfx-2mp', aramaic: false, count: 9, total: 10 }],
        ['H2004', { cls: 'sfx-3fp', aramaic: false, count: 9, total: 10 }],
        ['H2050b', { cls: 'conj', aramaic: false, count: 9, total: 10 }],
      ]),
      greekLemmas: new Map([['G4053b', 'ἐκπερισσῶς'], ['G3461b', 'δισμυριάς']]),
    });

  it('builds STEP entries with Strong\'s fields and readable pos', () => {
    const { entries } = build();
    expect(entries.get('G0026')).toEqual({
      id: 'G0026', lemma: 'ἀγάπη', translit: 'agapē', pos: 'Noun, feminine', gloss: 'love', def: '<b>love</b>',
      strongsDef: 'love',
    });
  });

  it('aliases a base id to its representative lettered variant and folds sub-senses', () => {
    const { entries, canonical } = build();
    const ben = entries.get('H1121')!;
    expect(ben).toBe(entries.get('H1121a'));
    expect(ben.id).toBe('H1121a');
    expect(ben.def).toBe('child/son<br><i>Other uses:</i> son: warrior');
    expect(ben.strongsDef).toBe('a son');
    expect(ben.deriv).toBe('from H9');
    // The proper-name variant does not get Strong's "son" definition.
    expect(entries.get('H1121b')!.strongsDef).toBeUndefined();
    expect(entries.get('H1121b')!.pos).toBe('Proper noun, person');
    expect(canonical.has('H1121')).toBe(false);
    expect(canonical.has('H1121a')).toBe(true);
  });

  it('gives Macula morpheme ids their own entries, never replacing plain Strong\'s numbers', () => {
    const { entries } = build();
    expect(entries.get('H3641b')!.pos).toBe('Suffix, pronominal (2nd person masculine plural)');
    expect(entries.get('H3641')!.id).toBe('H3641a'); // base falls back to the remaining STEP variant
    expect(entries.get('H2004')!.gloss).toBe('they(fem.)');
    expect(entries.get('H2050b')!.gloss).toBe('and');
    expect(entries.has('H2050')).toBe(true);
  });

  it("falls back to Strong's for numbers STEP lacks", () => {
    const { entries } = build();
    expect(entries.get('H0005')).toMatchObject({ id: 'H0005', lemma: 'אֲבַגְתָא', def: 'Abagtha', kjv: 'kjv', gloss: 'kjv' });
    expect(entries.get('H0005')!.strongsDef).toBeUndefined();
  });

  it('notes "Form of" entries and replaces a definition written for another word', () => {
    const { entries } = build();
    const e = entries.get('G5209')!;
    expect(e.def).toBe('<i>Form of</i> σύ (G4771)<br><b>σύ</b>, thou');
    expect(e.pos).toBe('Personal pronoun, 2nd person');
  });

  it('maps extended SBLGNT ids to the STEP entry with the same lemma', () => {
    const { entries } = build();
    expect(entries.get('G4053b')).toMatchObject({ id: 'G4053b', lemma: 'ἐκπερισσῶς', pos: 'Adverb' });
    expect(entries.has('G3461b')).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* Generated data (skipped when public/data/lex has not been built)          */
/* ------------------------------------------------------------------------ */

const LEX_DIR = join(process.cwd(), 'public', 'data', 'lex');

describe.skipIf(!existsSync(join(LEX_DIR, 'index.json')))('generated lexicon', () => {
  const load = (lang: 'G' | 'H'): LexChunk =>
    Object.assign({}, ...readdirSync(join(LEX_DIR, lang)).map((f) => JSON.parse(readFileSync(join(LEX_DIR, lang, f), 'utf8'))));
  const G = load('G');
  const H = load('H');
  const all: LexChunk = { ...G, ...H };

  it('stores every key in the right chunk file with a normalised id', () => {
    for (const lang of ['G', 'H'] as const) {
      for (const f of readdirSync(join(LEX_DIR, lang))) {
        const chunk: LexChunk = JSON.parse(readFileSync(join(LEX_DIR, lang, f), 'utf8'));
        for (const key of Object.keys(chunk)) {
          expect(key).toMatch(/^[GH]\d{4}[a-z]?$/);
          expect(key[0]).toBe(lang);
          expect(`${String(Math.floor(Number(key.slice(1, 5)) / 100)).padStart(3, '0')}.json`).toBe(f);
        }
      }
    }
  });

  it('has a base key for every lettered key and only safe definitions', () => {
    for (const [key, e] of Object.entries(all)) {
      expect(all[key.slice(0, 5)], key).toBeDefined();
      if (!isSafeDefHtml(e.def)) throw new Error(`unsafe def in ${key}`);
      expect(e.lemma, key).not.toBe('');
      expect(e.gloss, key).not.toBe('');
    }
  });

  it('covers every classic Strong\'s number that exists', () => {
    const missingG = [];
    for (let n = 1; n <= 5624; n++) if (!G[`G${String(n).padStart(4, '0')}`]) missingG.push(n);
    // Strong never assigned G2717 or G3203–G3302.
    expect(missingG).toEqual([2717, ...Array.from({ length: 100 }, (_, i) => 3203 + i)]);
    for (let n = 1; n <= 8674; n++) expect(H[`H${String(n).padStart(4, '0')}`], `H${n}`).toBeDefined();
  });

  it('has the expected key entries', () => {
    expect(G.G0026).toMatchObject({ lemma: 'ἀγάπη', gloss: 'love', pos: 'Noun, feminine' });
    expect(G.G3056).toMatchObject({ lemma: 'λόγος', pos: 'Noun, masculine' });
    expect(H.H0430).toMatchObject({ lemma: 'אֱלֹהִים', gloss: 'God' });
    expect(H.H7225.lemma).toBe('רֵאשִׁית');
    expect(H.H2050b).toMatchObject({ gloss: 'and', pos: 'Conjunction (prefix)' });
    expect(H.H1886a.gloss).toBe('the');
    expect(H.H0871a.lemma).toBe('בְּ');
    expect(H.H3807a.gloss).toBe('to, for');
    expect(H.H3509a.gloss).toBe('like, as');
    expect(H.H2050c.pos).toContain('3rd person masculine singular');
    expect(H.H4480.lemma).toContain('מִן');
  });

  it('indexes each canonical entry once', () => {
    const index: LexIndex = JSON.parse(readFileSync(join(LEX_DIR, 'index.json'), 'utf8'));
    const ids = index.map((r) => r[0]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('G0026');
    expect(ids).toContain('H1121a');
    expect(ids).not.toContain('H1121'); // base alias
    for (const [id, lemma, , gloss] of index) {
      expect(all[id].id).toBe(id);
      expect(all[id].lemma).toBe(lemma);
      expect(all[id].gloss).toBe(gloss);
    }
  });
});
