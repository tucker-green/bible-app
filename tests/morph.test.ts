import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeMorph, glossaryFor, MORPH_GLOSSARY } from '../src/lib/morph';
import type { MorphLang } from '../src/lib/morph';
import codes from './fixtures/morph-codes.json';

const fixture = codes as unknown as Record<MorphLang, string[]>;

describe('describeMorph — Greek (Robinson)', () => {
  const cases: [string, string, string][] = [
    ['V-AAI-3S', 'Verb · Aorist Active Indicative · 3rd person singular', 'aor act ind 3sg'],
    ['N-NSM', 'Noun · Nominative singular masculine', 'nom sg masc'],
    ['T-ASM', 'Article · Accusative singular masculine', 'art acc sg masc'],
    ['P-1GS', 'Personal pronoun · 1st person · Genitive singular', 'pers pron 1 gen sg'],
    ['P-AP-', 'Personal pronoun · Accusative plural', 'pers pron acc pl'],
    ['A-NSF', 'Adjective · Nominative singular feminine', 'nom sg fem'],
    ['CONJ', 'Conjunction', 'conj'],
    ['PREP', 'Preposition', 'prep'],
    ['ADV', 'Adverb', 'adv'],
    ['PRT-N', 'Particle · Negative', 'ptcl neg'],
    ['INJ', 'Interjection', 'interj'],
    ['COND', 'Conditional particle', 'cond'],
    ['HEB', 'Hebrew word', 'Heb'],
    ['ARAM', 'Aramaic word', 'Aram'],
    ['V-PAP-NSM', 'Verb · Present Active Participle · Nominative singular masculine', 'pres act ptc nom sg masc'],
    ['V-PAN', 'Verb · Present Active Infinitive', 'pres act inf'],
    ['V-2AAI-3S', 'Verb · 2nd Aorist Active Indicative · 3rd person singular', '2aor act ind 3sg'],
    ['V-ADI-3S', 'Verb · Aorist Middle (deponent) Indicative · 3rd person singular', 'aor mid dep ind 3sg'],
    ['V-AOI-3S', 'Verb · Aorist Passive (deponent) Indicative · 3rd person singular', 'aor pass dep ind 3sg'],
    ['V-PNI-3S', 'Verb · Present Middle or Passive (deponent) Indicative · 3rd person singular', 'pres mid/pass dep ind 3sg'],
    ['V-PEI-3P', 'Verb · Present Middle or Passive Indicative · 3rd person plural', 'pres mid/pass ind 3pl'],
    ['V-RAI-3S-ATT', 'Verb · Perfect Active Indicative · 3rd person singular · Attic form', 'pf act ind 3sg Attic'],
    ['V-2LAI-3S', 'Verb · 2nd Pluperfect Active Indicative · 3rd person singular', '2plpf act ind 3sg'],
    ['V-AAO-3S', 'Verb · Aorist Active Optative · 3rd person singular', 'aor act opt 3sg'],
    ['V-PAM-2P', 'Verb · Present Active Imperative · 2nd person plural', 'pres act impv 2pl'],
    ['A-NSM-C', 'Adjective · Nominative singular masculine · Comparative', 'nom sg masc comp'],
    ['A-APF-S', 'Adjective · Accusative plural feminine · Superlative', 'acc pl fem superl'],
    ['S-1SNSM', 'Possessive pronoun · 1st person singular possessor ("my") · Nominative singular masculine', 'poss pron 1sg nom sg masc'],
    ['F-3ASM', 'Reflexive pronoun · 3rd person · Accusative singular masculine', 'refl pron 3 acc sg masc'],
    ['N-PRI', 'Proper noun (indeclinable)', 'pr noun indecl'],
    ['A-NUI', 'Numeral (indeclinable)', 'num indecl'],
    ['P-1NS-K', 'Personal pronoun · 1st person · Nominative singular · Joined with καί by crasis', 'pers pron 1 nom sg crasis'],
    ['R-GSN-ATT', 'Relative pronoun · Genitive singular neuter · Attic form', 'rel pron gen sg neut Attic'],
    ['robinson:T-NSM', 'Article · Nominative singular masculine', 'art nom sg masc'],
  ];
  for (const [code, long, short] of cases) {
    it(code, () => {
      const d = describeMorph(code, 'grc');
      expect(d.ok).toBe(true);
      expect(d.long).toBe(long);
      expect(d.short).toBe(short);
    });
  }

  it('exposes labelled parts with glossary keys', () => {
    const d = describeMorph('V-AAI-3S', 'grc');
    expect(d.pos).toBe('Verb');
    expect(d.parts).toEqual([
      { label: 'Part of speech', value: 'Verb', key: 'grc.verb' },
      { label: 'Tense', value: 'Aorist', key: 'grc.aorist' },
      { label: 'Voice', value: 'Active', key: 'grc.active' },
      { label: 'Mood', value: 'Indicative', key: 'grc.indicative' },
      { label: 'Person', value: '3rd' },
      { label: 'Number', value: 'Singular' },
    ]);
    expect(glossaryFor(d).map((g) => g.term)).toEqual(['Verb', 'Aorist', 'Active voice', 'Indicative']);
  });

  it('flags undecodable codes instead of throwing', () => {
    for (const bad of ['', 'XYZ', 'V-ZZZ', 'N-QQQ', 'V-AAI-9X']) {
      const d = describeMorph(bad, 'grc');
      expect(d.ok, bad).toBe(false);
    }
  });
});

describe('describeMorph — Hebrew / Aramaic (OSHB)', () => {
  const cases: [string, MorphLang, string, string][] = [
    ['Vqp3ms', 'hbo', 'Verb · Qal · Perfect · 3rd person masculine singular', 'Qal perf 3ms'],
    ['Ncfsa', 'hbo', 'Noun · common · feminine singular absolute', 'noun fs abs'],
    ['Ncmpc', 'hbo', 'Noun · common · masculine plural construct', 'noun mp cstr'],
    ['R', 'hbo', 'Preposition', 'prep'],
    ['Rd', 'hbo', 'Preposition · with definite article', 'prep + art'],
    ['C', 'hbo', 'Conjunction', 'conj'],
    ['Td', 'hbo', 'Definite article', 'art'],
    ['To', 'hbo', 'Particle · direct object marker', 'obj marker'],
    ['Tn', 'hbo', 'Particle · negative', 'neg ptcl'],
    ['Sp3ms', 'hbo', 'Pronominal suffix · 3rd person masculine singular', 'sfx 3ms'],
    ['Sd', 'hbo', 'Directional he', 'dir he'],
    ['Np', 'hbo', 'Noun · proper name', 'noun pr'],
    ['Vqw3ms', 'hbo', 'Verb · Qal · Sequential imperfect (wayyiqtol) · 3rd person masculine singular', 'Qal wayyiqtol 3ms'],
    ['Vqrmsa', 'hbo', 'Verb · Qal · Participle (active) · masculine singular absolute', 'Qal ptc ms abs'],
    ['Vqc', 'hbo', 'Verb · Qal · Infinitive construct', 'Qal inf cstr'],
    ['Vhi3ms', 'hbo', 'Verb · Hiphil · Imperfect · 3rd person masculine singular', 'Hiphil impf 3ms'],
    ['VNp3cp', 'hbo', 'Verb · Niphal · Perfect · 3rd person common plural', 'Niphal perf 3cp'],
    ['Vpv2mp', 'hbo', 'Verb · Piel · Imperative · 2nd person masculine plural', 'Piel impv 2mp'],
    ['Pp3ms', 'hbo', 'Pronoun · personal · 3rd person masculine singular', 'pers pron 3ms'],
    ['Pdxms', 'hbo', 'Pronoun · demonstrative · masculine singular', 'dem pron ms'],
    ['Acbpa', 'hbo', 'Cardinal number · both genders plural absolute', 'card num bp abs'],
    ['Vqp3ms', 'arc', 'Verb · Peal · Perfect · 3rd person masculine singular', 'Peal perf 3ms'],
    ['Vhp3ms', 'arc', 'Verb · Haphel · Perfect · 3rd person masculine singular', 'Haphel perf 3ms'],
    ['Ncmsd', 'arc', 'Noun · common · masculine singular determined', 'noun ms det'],
    ['HC/Vqw3ms', 'hbo', 'Conjunction + Verb · Qal · Sequential imperfect (wayyiqtol) · 3rd person masculine singular', 'conj + Qal wayyiqtol 3ms'],
    ['AVqp3ms', 'hbo', 'Verb · Peal · Perfect · 3rd person masculine singular', 'Peal perf 3ms'],
  ];
  for (const [code, lang, long, short] of cases) {
    it(`${code} (${lang})`, () => {
      const d = describeMorph(code, lang);
      expect(d.ok).toBe(true);
      expect(d.long).toBe(long);
      expect(d.short).toBe(short);
    });
  }

  it('the same stem letter means different stems in Hebrew and Aramaic', () => {
    expect(describeMorph('Vhp3ms', 'hbo').parts.find((p) => p.label === 'Stem')?.value).toBe('Hiphil');
    expect(describeMorph('Vhp3ms', 'arc').parts.find((p) => p.label === 'Stem')?.value).toBe('Haphel');
    expect(describeMorph('VMi3ms', 'hbo').parts.find((p) => p.label === 'Stem')?.value).toBe('Poal');
    expect(describeMorph('VMi3ms', 'arc').parts.find((p) => p.label === 'Stem')?.value).toBe('Hithpaal');
    expect(describeMorph('AVqp3ms', 'hbo').lang).toBe('arc');
  });

  it('links stems and conjugations to the glossary', () => {
    const terms = glossaryFor(describeMorph('Vpi3ms', 'hbo')).map((g) => g.key);
    expect(terms).toEqual(['hbo.verb', 'hbo.piel', 'hbo.imperfect']);
  });

  it('marks Strong’s TVM codes (KJV OT) as not decoded', () => {
    const d = describeMorph('strongMorph:TH8804', 'hbo');
    expect(d.ok).toBe(false);
    expect(d.short).toBe('TVM 8804');
  });

  it('flags malformed codes', () => {
    for (const bad of ['Vz', 'Xabc', 'Ncfzz', 'Sq3ms', 'Tz']) expect(describeMorph(bad, 'hbo').ok, bad).toBe(false);
  });
});

describe('every code in the sources decodes', () => {
  for (const lang of ['grc', 'hbo', 'arc'] as const) {
    it(`${lang}: ${fixture[lang].length} distinct codes`, () => {
      expect(fixture[lang].length).toBeGreaterThan(100);
      const failures: string[] = [];
      for (const code of fixture[lang]) {
        const d = describeMorph(code, lang);
        const sensible =
          d.ok &&
          d.long.length > 2 &&
          d.short.length > 1 &&
          d.parts.length > 0 &&
          !/undefined|null|NaN/.test(d.long + d.short + JSON.stringify(d.parts));
        if (!sensible) failures.push(`${code} -> ${d.long}`);
      }
      expect(failures).toEqual([]);
    });
  }

  it('every glossary key used by a part exists', () => {
    const missing = new Set<string>();
    for (const lang of ['grc', 'hbo', 'arc'] as const) {
      for (const code of fixture[lang]) {
        for (const p of describeMorph(code, lang).parts) if (p.key && !MORPH_GLOSSARY[p.key]) missing.add(p.key);
      }
    }
    expect([...missing]).toEqual([]);
  });

  // When the raw sources are present, make sure the fixture is still complete.
  const src = join(process.cwd(), '.cache', 'sources');
  it.skipIf(!existsSync(join(src, 'SBLGNT.tsv')))('fixture covers every SBLGNT code', () => {
    const lines = readFileSync(join(src, 'SBLGNT.tsv'), 'utf8').split(/\r?\n/);
    const col = lines[0].split('\t').indexOf('morph');
    const have = new Set(fixture.grc);
    const missing = new Set<string>();
    for (const l of lines.slice(1)) {
      const m = l.split('\t')[col];
      if (m && !have.has(m)) missing.add(m);
    }
    expect([...missing]).toEqual([]);
  });
  it.skipIf(!existsSync(join(src, 'macula-hebrew.tsv')))('fixture covers every Macula Hebrew code', () => {
    const lines = readFileSync(join(src, 'macula-hebrew.tsv'), 'utf8').split(/\r?\n/);
    const header = lines[0].split('\t');
    const mc = header.indexOf('morph');
    const lc = header.indexOf('lang');
    const have = { H: new Set(fixture.hbo), A: new Set(fixture.arc) } as Record<string, Set<string>>;
    const missing = new Set<string>();
    for (const l of lines.slice(1)) {
      const cells = l.split('\t');
      const m = cells[mc];
      const set = have[cells[lc]];
      if (m && set && !set.has(m)) missing.add(`${cells[lc]}:${m}`);
    }
    expect([...missing]).toEqual([]);
  });
});
