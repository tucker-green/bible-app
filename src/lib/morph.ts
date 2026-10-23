/**
 * Morphology codes -> readable parsing.
 *
 *  - Greek: Robinson codes as used by the SBLGNT (and the CrossWire KJV's `robinson:` tags),
 *    e.g. "V-AAI-3S", "N-NSM", "T-ASM", "P-1GS", "V-2AAP-NSM", "A-NSM-C", "PRT-N".
 *  - Hebrew / Aramaic: OpenScriptures Hebrew Bible (OSHB) codes as found in Macula Hebrew's `morph`
 *    column — one morpheme per code, without the language prefix ("Vqp3ms", "Ncfsa", "R", "Td",
 *    "Sp3ms"). Full OSHB strings with a language prefix and slashes ("HC/Vqw3ms") also work.
 *    The same stem letter means different things in Hebrew and Aramaic, so pass lang 'arc' for
 *    Aramaic words (OrigChapter.aramaic) or use the "A" language prefix.
 *
 * MORPH_GLOSSARY holds short plain-language explanations (what an aorist is, what the Piel
 * does...) keyed by MorphPart.key, for the UI to show on hover.
 *
 * Framework-free and DOM-free.
 */

export type MorphLang = 'grc' | 'hbo' | 'arc';

export interface MorphPart {
  /** "Part of speech", "Tense", "Stem", "Case"... */
  label: string;
  /** "Verb", "Aorist", "Qal", "Genitive"... */
  value: string;
  /** Key into MORPH_GLOSSARY when an explanation exists. */
  key?: string;
}

export interface MorphDescription {
  code: string;
  lang: MorphLang;
  /** Part of speech, e.g. "Verb", "Noun", "Definite article". */
  pos: string;
  /** Compact parsing, e.g. "aor act ind 3sg", "nom sg masc", "Qal perf 3ms", "noun fs abs". */
  short: string;
  /** Readable parsing, e.g. "Verb · Aorist Active Indicative · 3rd person singular". */
  long: string;
  parts: MorphPart[];
  /** False when the code (or some part of it) could not be decoded; `long` then shows the raw code. */
  ok: boolean;
}

/** Decode a morphology code. Empty / unknown codes give ok=false (never throws). */
export function describeMorph(code: string, lang: MorphLang): MorphDescription {
  const raw = (code ?? '').trim();
  if (!raw) return unknown('', lang);
  if (lang === 'grc' || /^robinson:/i.test(raw)) return describeGreek(raw);
  if (/^(?:strongMorph:)?TH?\d{4}$/i.test(raw)) return describeStrongsTvm(raw, lang);
  return describeHebrew(raw, lang);
}

function unknown(code: string, lang: MorphLang, pos = ''): MorphDescription {
  return { code, lang, pos, short: code, long: code, parts: [], ok: false };
}

/* ======================================================================== */
/* Greek (Robinson)                                                          */
/* ======================================================================== */

type Named = [value: string, short: string, key?: string];

const G_CASE: Record<string, Named> = {
  N: ['Nominative', 'nom', 'case.nominative'],
  G: ['Genitive', 'gen', 'case.genitive'],
  D: ['Dative', 'dat', 'case.dative'],
  A: ['Accusative', 'acc', 'case.accusative'],
  V: ['Vocative', 'voc', 'case.vocative'],
};
const G_NUMBER: Record<string, Named> = { S: ['singular', 'sg'], P: ['plural', 'pl'] };
const G_GENDER: Record<string, Named> = { M: ['masculine', 'masc'], F: ['feminine', 'fem'], N: ['neuter', 'neut'] };
const G_PERSON: Record<string, Named> = { '1': ['1st', '1'], '2': ['2nd', '2'], '3': ['3rd', '3'] };

const G_TENSE: Record<string, Named> = {
  P: ['Present', 'pres', 'grc.present'],
  I: ['Imperfect', 'impf', 'grc.imperfect'],
  F: ['Future', 'fut', 'grc.future'],
  A: ['Aorist', 'aor', 'grc.aorist'],
  R: ['Perfect', 'pf', 'grc.perfect'],
  L: ['Pluperfect', 'plpf', 'grc.pluperfect'],
  X: ['(no tense stated)', 'no-tense'],
};
const G_VOICE: Record<string, Named> = {
  A: ['Active', 'act', 'grc.active'],
  M: ['Middle', 'mid', 'grc.middle'],
  P: ['Passive', 'pass', 'grc.passive'],
  E: ['Middle or Passive', 'mid/pass', 'grc.middle-passive'],
  D: ['Middle (deponent)', 'mid dep', 'grc.deponent'],
  O: ['Passive (deponent)', 'pass dep', 'grc.deponent'],
  N: ['Middle or Passive (deponent)', 'mid/pass dep', 'grc.deponent'],
  Q: ['Impersonal Active', 'impers act', 'grc.active'],
  X: ['(no voice stated)', 'no-voice'],
};
const G_MOOD: Record<string, Named> = {
  I: ['Indicative', 'ind', 'grc.indicative'],
  S: ['Subjunctive', 'subj', 'grc.subjunctive'],
  O: ['Optative', 'opt', 'grc.optative'],
  M: ['Imperative', 'impv', 'grc.imperative'],
  N: ['Infinitive', 'inf', 'grc.infinitive'],
  P: ['Participle', 'ptc', 'grc.participle'],
  R: ['Participle (imperatival)', 'impv ptc', 'grc.participle'],
};

/** Declinable parts of speech (first segment). */
const G_POS: Record<string, Named> = {
  N: ['Noun', 'noun', 'grc.noun'],
  A: ['Adjective', 'adj', 'grc.adjective'],
  T: ['Article', 'art', 'grc.article'],
  P: ['Personal pronoun', 'pers pron', 'grc.pronoun'],
  R: ['Relative pronoun', 'rel pron', 'grc.relative-pronoun'],
  C: ['Reciprocal pronoun', 'recip pron', 'grc.pronoun'],
  D: ['Demonstrative pronoun', 'dem pron', 'grc.pronoun'],
  K: ['Correlative pronoun', 'correl pron', 'grc.pronoun'],
  I: ['Interrogative pronoun', 'interr pron', 'grc.pronoun'],
  X: ['Indefinite pronoun', 'indef pron', 'grc.pronoun'],
  Q: ['Correlative or interrogative pronoun', 'correl/interr pron', 'grc.pronoun'],
  F: ['Reflexive pronoun', 'refl pron', 'grc.pronoun'],
  S: ['Possessive pronoun', 'poss pron', 'grc.pronoun'],
};

/** Indeclinable words (whole first segment). */
const G_INDECL: Record<string, Named> = {
  ADV: ['Adverb', 'adv', 'grc.adverb'],
  CONJ: ['Conjunction', 'conj', 'grc.conjunction'],
  COND: ['Conditional particle', 'cond', 'grc.particle'],
  PRT: ['Particle', 'ptcl', 'grc.particle'],
  PREP: ['Preposition', 'prep', 'grc.preposition'],
  INJ: ['Interjection', 'interj'],
  ARAM: ['Aramaic word', 'Aram', 'grc.foreign'],
  HEB: ['Hebrew word', 'Heb', 'grc.foreign'],
};
/** Indeclinable nouns / adjectives: N-PRI, N-LI, N-OI, A-NUI. */
const G_INDECL_NOMINAL: Record<string, Named> = {
  PRI: ['Proper noun', 'pr noun', 'grc.indeclinable'],
  LI: ['Letter', 'letter', 'grc.indeclinable'],
  OI: ['Noun', 'noun', 'grc.indeclinable'],
  NUI: ['Numeral', 'num', 'grc.indeclinable'],
};

/** Robinson suffixes. Verbs use -C for "contracted" rather than "comparative". */
const G_SUFFIX: Record<string, Named> = {
  C: ['comparative', 'comp', 'grc.comparative'],
  S: ['superlative', 'superl', 'grc.superlative'],
  N: ['negative', 'neg'],
  I: ['interrogative', 'interr'],
  K: ['joined with καί by crasis', 'crasis', 'grc.crasis'],
  ATT: ['Attic form', 'Attic', 'grc.attic'],
  ABB: ['abbreviated form', 'abbr'],
  P: ['with attached particle', '+ptcl'],
  M: ['middle significance', 'mid sense'],
  T: ['transitive', 'trans'],
  A: ['Aeolic form', 'Aeolic'],
  AP: ['apocopated form', 'apoc'],
  IRR: ['irregular form', 'irreg'],
};
const G_VERB_SUFFIX: Record<string, Named> = { ...G_SUFFIX, C: ['contracted form', 'contr'] };

function describeGreek(input: string): MorphDescription {
  const code = input.replace(/^robinson:/i, '').trim().toUpperCase();
  const segs = code.split('-');
  // A trailing "-" (e.g. "P-AP-") marks an unspecified gender: drop empty segments.
  while (segs.length > 1 && segs[segs.length - 1] === '') segs.pop();
  const head = segs[0];
  const parts: MorphPart[] = [];
  let ok = true;

  const addSuffixes = (rest: string[], table: Record<string, Named>, longBits: string[], shortBits: string[]) => {
    for (const s of rest) {
      const n = table[s];
      if (!n) {
        ok = false;
        continue;
      }
      parts.push({ label: 'Form', value: n[0], key: n[2] });
      longBits.push(n[0]);
      shortBits.push(n[1]);
    }
  };

  // Indeclinables: ADV, CONJ, PRT-N, ...
  const indecl = G_INDECL[head];
  if (indecl) {
    parts.push({ label: 'Part of speech', value: indecl[0], key: indecl[2] });
    const longBits: string[] = [];
    const shortBits: string[] = [];
    addSuffixes(segs.slice(1), G_SUFFIX, longBits, shortBits);
    const pos = indecl[0];
    return {
      code,
      lang: 'grc',
      pos,
      short: [indecl[1], ...shortBits].join(' '),
      long: longBits.length ? `${pos} · ${capitalise(longBits.join(', '))}` : pos,
      parts,
      ok,
    };
  }

  // Verbs
  if (head === 'V') {
    const m = /^(2?)([PIFARLX])([AMPEDONQX])([ISOMNPR])$/.exec(segs[1] ?? '');
    if (!m) return unknown(code, 'grc', 'Verb');
    const [, second, t, v, md] = m;
    const tense = G_TENSE[t];
    const voice = G_VOICE[v];
    const mood = G_MOOD[md];
    const tenseValue = second ? `2nd ${tense[0]}` : tense[0];
    const tenseShort = second ? `2${tense[1]}` : tense[1];
    parts.push({ label: 'Part of speech', value: 'Verb', key: 'grc.verb' });
    parts.push({ label: 'Tense', value: tenseValue, key: tense[2] });
    if (second) parts.push({ label: 'Form', value: 'Second (strong) form', key: 'grc.second-tense' });
    parts.push({ label: 'Voice', value: voice[0], key: voice[2] });
    parts.push({ label: 'Mood', value: mood[0], key: mood[2] });
    let rest = segs.slice(2);
    let tail = '';
    let tailShort = '';
    if (md === 'P' || md === 'R') {
      const cng = decodeCaseNumberGender(rest[0] ?? '');
      if (cng) {
        parts.push(...cng.parts);
        tail = cng.long;
        tailShort = cng.short;
        rest = rest.slice(1);
      } else ok = false;
    } else if (md !== 'N') {
      const pn = /^([123])([SP])$/.exec(rest[0] ?? '');
      if (pn) {
        const person = G_PERSON[pn[1]];
        const num = G_NUMBER[pn[2]];
        parts.push({ label: 'Person', value: person[0] }, { label: 'Number', value: capitalise(num[0]) });
        tail = `${person[0]} person ${num[0]}`;
        tailShort = `${person[1]}${num[1]}`;
        rest = rest.slice(1);
      } else ok = false;
    }
    const longBits: string[] = [];
    const shortBits: string[] = [];
    addSuffixes(rest, G_VERB_SUFFIX, longBits, shortBits);
    const core = `${tenseValue} ${voice[0]} ${mood[0]}`;
    const long = ['Verb', core, tail, longBits.length ? capitalise(longBits.join(', ')) : '']
      .filter(Boolean)
      .join(' · ');
    const short = [tenseShort, voice[1], mood[1], tailShort, ...shortBits].filter(Boolean).join(' ');
    return { code, lang: 'grc', pos: 'Verb', short, long, parts, ok };
  }

  // Indeclinable nominals: N-PRI, N-LI, N-OI, A-NUI
  if ((head === 'N' || head === 'A') && G_INDECL_NOMINAL[segs[1] ?? '']) {
    const n = G_INDECL_NOMINAL[segs[1]];
    parts.push({ label: 'Part of speech', value: n[0], key: head === 'N' ? 'grc.noun' : 'grc.adjective' });
    parts.push({ label: 'Form', value: 'indeclinable', key: n[2] });
    const longBits: string[] = [];
    const shortBits: string[] = [];
    addSuffixes(segs.slice(2), G_SUFFIX, longBits, shortBits);
    return {
      code,
      lang: 'grc',
      pos: n[0],
      short: [n[1], 'indecl', ...shortBits].join(' '),
      long: [`${n[0]} (indeclinable)`, longBits.length ? capitalise(longBits.join(', ')) : ''].filter(Boolean).join(' · '),
      parts,
      ok,
    };
  }

  // Declinables
  const pos = G_POS[head];
  if (!pos || segs.length < 2) return unknown(code, 'grc');
  parts.push({ label: 'Part of speech', value: pos[0], key: pos[2] });
  const body = segs[1];
  let person = '';
  let possessor = '';
  let cngCode = body;
  if (head === 'S') {
    // S-1SNSM: person + possessor number, then case-number-gender
    const m = /^([123])([SP])(.+)$/.exec(body);
    if (!m) return unknown(code, 'grc', pos[0]);
    person = m[1];
    possessor = m[2];
    cngCode = m[3];
  } else if (head === 'P' || head === 'F') {
    const m = /^([123]?)(.+)$/.exec(body) as RegExpExecArray;
    person = m[1];
    cngCode = m[2];
  }
  const cng = decodeCaseNumberGender(cngCode);
  if (!cng) return unknown(code, 'grc', pos[0]);
  const longBits: string[] = [];
  const shortBits: string[] = [];
  let personLong = '';
  let personShort = '';
  if (person) {
    const p = G_PERSON[person];
    parts.push({ label: 'Person', value: p[0] });
    if (possessor) {
      const pn = G_NUMBER[possessor];
      parts.push({ label: 'Possessor', value: `${p[0]} person ${pn[0]}` });
      personLong = `${p[0]} person ${pn[0]} possessor ("${possessiveGloss(person, possessor)}")`;
      personShort = `${p[1]}${pn[1]}`;
    } else {
      personLong = `${p[0]} person`;
      personShort = p[1];
    }
  }
  parts.push(...cng.parts);
  addSuffixes(segs.slice(2), G_SUFFIX, longBits, shortBits);
  const long = [pos[0], personLong, cng.long, longBits.length ? capitalise(longBits.join(', ')) : '']
    .filter(Boolean)
    .join(' · ');
  const shortHead = head === 'N' || head === 'A' ? [] : [pos[1]];
  const short = [...shortHead, personShort, cng.short, ...shortBits].filter(Boolean).join(' ');
  return { code, lang: 'grc', pos: pos[0], short, long, parts, ok };
}

function possessiveGloss(person: string, number: string): string {
  return { '1S': 'my', '1P': 'our', '2S': 'your (sg)', '2P': 'your (pl)', '3S': 'his/her/its', '3P': 'their' }[
    person + number
  ] as string;
}

/** "NSM" -> Nominative singular masculine. Gender optional ("AP" in "P-AP-"). */
function decodeCaseNumberGender(s: string): { long: string; short: string; parts: MorphPart[] } | null {
  const m = /^([NGDAV])([SP])([MFN]?)$/.exec(s);
  if (!m) return null;
  const c = G_CASE[m[1]];
  const n = G_NUMBER[m[2]];
  const g = m[3] ? G_GENDER[m[3]] : undefined;
  const parts: MorphPart[] = [
    { label: 'Case', value: c[0], key: c[2] },
    { label: 'Number', value: capitalise(n[0]) },
  ];
  if (g) parts.push({ label: 'Gender', value: capitalise(g[0]) });
  return {
    long: [c[0], n[0], g?.[0]].filter(Boolean).join(' '),
    short: [c[1], n[1], g?.[1]].filter(Boolean).join(' '),
    parts,
  };
}

/* ======================================================================== */
/* Hebrew & Aramaic (OSHB)                                                   */
/* ======================================================================== */

const H_STEMS: Record<string, string> = {
  q: 'Qal', N: 'Niphal', p: 'Piel', P: 'Pual', h: 'Hiphil', H: 'Hophal', t: 'Hithpael', o: 'Polel', O: 'Polal',
  r: 'Hithpolel', m: 'Poel', M: 'Poal', k: 'Palel', K: 'Pulal', Q: 'Qal passive', l: 'Pilpel', L: 'Polpal',
  f: 'Hithpalpel', D: 'Nithpael', j: 'Pealal', i: 'Pilel', u: 'Hothpaal', c: 'Tiphil', v: 'Hishtaphel',
  w: 'Nithpalel', y: 'Nithpoel', z: 'Hithpoel',
};
const A_STEMS: Record<string, string> = {
  q: 'Peal', Q: 'Peil', u: 'Hithpeel', p: 'Pael', P: 'Ithpaal', M: 'Hithpaal', a: 'Aphel', h: 'Haphel', s: 'Saphel',
  e: 'Shaphel', H: 'Hophal', i: 'Ithpeel', t: 'Hishtaphel', v: 'Ishtaphel', w: 'Hithaphel', o: 'Polel', z: 'Ithpoel',
  r: 'Hithpolel', f: 'Hithpalpel', b: 'Hephal', c: 'Tiphel', m: 'Poel', l: 'Palpel', L: 'Ithpalpel', O: 'Ithpolel',
  G: 'Ittaphal',
};
/** Stems with their own glossary entry; the rest point at the family they belong to. */
const H_STEM_KEY: Record<string, string> = {
  Qal: 'hbo.qal', 'Qal passive': 'hbo.qal-passive', Niphal: 'hbo.niphal', Piel: 'hbo.piel', Pual: 'hbo.pual',
  Hiphil: 'hbo.hiphil', Hophal: 'hbo.hophal', Hithpael: 'hbo.hithpael',
  Polel: 'hbo.piel-variant', Pilel: 'hbo.piel-variant', Palel: 'hbo.piel-variant', Pilpel: 'hbo.piel-variant',
  Poel: 'hbo.piel-variant', Pealal: 'hbo.piel-variant', Tiphil: 'hbo.piel-variant',
  Polal: 'hbo.pual-variant', Pulal: 'hbo.pual-variant', Polpal: 'hbo.pual-variant', Poal: 'hbo.pual-variant',
  Hithpolel: 'hbo.hithpael-variant', Hithpalpel: 'hbo.hithpael-variant', Hithpoel: 'hbo.hithpael-variant',
  Nithpael: 'hbo.hithpael-variant', Nithpalel: 'hbo.hithpael-variant', Nithpoel: 'hbo.hithpael-variant',
  Hothpaal: 'hbo.hithpael-variant', Hishtaphel: 'hbo.hishtaphel',
};
const A_STEM_KEY: Record<string, string> = {
  Peal: 'arc.peal', Peil: 'arc.peil', Pael: 'arc.pael', Haphel: 'arc.haphel', Aphel: 'arc.haphel',
  Saphel: 'arc.shaphel', Shaphel: 'arc.shaphel', Hophal: 'arc.hophal', Hephal: 'arc.hophal', Ittaphal: 'arc.hophal',
  Hithpeel: 'arc.hithpeel', Ithpeel: 'arc.hithpeel', Hithpaal: 'arc.hithpaal', Ithpaal: 'arc.hithpaal',
  Hishtaphel: 'arc.hithpaal', Ishtaphel: 'arc.hithpaal', Hithaphel: 'arc.hithpaal', Hithpolel: 'arc.hithpaal',
  Hithpalpel: 'arc.hithpaal', Ithpoel: 'arc.hithpaal', Ithpalpel: 'arc.hithpaal', Ithpolel: 'arc.hithpaal',
  Polel: 'arc.pael', Poel: 'arc.pael', Palpel: 'arc.pael', Tiphel: 'arc.pael',
};

/** Verb conjugation types: [name, short, glossary key, kind]. */
const H_CONJ: Record<string, [string, string, string, 'finite' | 'ptc' | 'inf']> = {
  p: ['Perfect', 'perf', 'hbo.perfect', 'finite'],
  q: ['Sequential perfect (weqatal)', 'weqatal', 'hbo.weqatal', 'finite'],
  i: ['Imperfect', 'impf', 'hbo.imperfect', 'finite'],
  w: ['Sequential imperfect (wayyiqtol)', 'wayyiqtol', 'hbo.wayyiqtol', 'finite'],
  h: ['Cohortative', 'coh', 'hbo.cohortative', 'finite'],
  j: ['Jussive', 'juss', 'hbo.jussive', 'finite'],
  v: ['Imperative', 'impv', 'hbo.imperative', 'finite'],
  r: ['Participle (active)', 'ptc', 'hbo.participle', 'ptc'],
  s: ['Participle (passive)', 'pass ptc', 'hbo.passive-participle', 'ptc'],
  a: ['Infinitive absolute', 'inf abs', 'hbo.infinitive-absolute', 'inf'],
  c: ['Infinitive construct', 'inf cstr', 'hbo.infinitive-construct', 'inf'],
};

const H_PERSON: Record<string, string> = { '1': '1st', '2': '2nd', '3': '3rd' };
const H_GENDER: Record<string, [string, string]> = {
  m: ['masculine', 'm'],
  f: ['feminine', 'f'],
  c: ['common', 'c'],
  b: ['both genders', 'b'],
};
const H_NUMBER: Record<string, [string, string, string?]> = {
  s: ['singular', 's'],
  p: ['plural', 'p'],
  d: ['dual', 'd', 'hbo.dual'],
};
const H_STATE: Record<string, [string, string, string]> = {
  a: ['absolute', 'abs', 'hbo.absolute'],
  c: ['construct', 'cstr', 'hbo.construct'],
  d: ['determined', 'det', 'hbo.determined'],
};

const H_ADJ_TYPE: Record<string, [string, string]> = {
  a: ['Adjective', 'adj'],
  c: ['Cardinal number', 'card num'],
  g: ['Gentilic adjective', 'gent adj'],
  o: ['Ordinal number', 'ord num'],
};
const H_NOUN_TYPE: Record<string, [string, string, string?]> = {
  c: ['common', '', 'hbo.noun'],
  g: ['gentilic', 'gent', 'hbo.gentilic'],
  p: ['proper name', 'pr', 'hbo.proper-name'],
  x: ['', ''],
};
const H_PRON_TYPE: Record<string, [string, string]> = {
  d: ['demonstrative', 'dem'],
  f: ['indefinite', 'indef'],
  i: ['interrogative', 'interr'],
  p: ['personal', 'pers'],
  r: ['relative', 'rel'],
};
const H_SUFFIX_TYPE: Record<string, [string, string, string]> = {
  d: ['Directional he', 'dir he', 'hbo.directional-he'],
  h: ['Paragogic he', 'parag he', 'hbo.paragogic'],
  n: ['Paragogic nun', 'parag nun', 'hbo.paragogic'],
  p: ['Pronominal suffix', 'sfx', 'hbo.pronominal-suffix'],
};
/** Particle types: [part of speech, long description, short, glossary key]. */
const H_PARTICLE_TYPE: Record<string, [string, string, string, string?]> = {
  a: ['Particle', 'Particle · affirmation', 'ptcl affirm'],
  d: ['Definite article', 'Definite article', 'art', 'hbo.article'],
  e: ['Particle', 'Particle · exhortation', 'ptcl exhort'],
  i: ['Particle', 'Particle · interrogative', 'interr ptcl'],
  j: ['Interjection', 'Interjection', 'interj'],
  m: ['Particle', 'Particle · demonstrative', 'dem ptcl'],
  n: ['Particle', 'Particle · negative', 'neg ptcl'],
  o: ['Particle', 'Particle · direct object marker', 'obj marker', 'hbo.object-marker'],
  r: ['Particle', 'Particle · relative', 'rel ptcl'],
};

interface HSeg {
  pos: string;
  long: string;
  short: string;
  parts: MorphPart[];
  ok: boolean;
}

function describeHebrew(input: string, lang: MorphLang): MorphDescription {
  let code = input.replace(/^oshm:|^oshb:/i, '').trim();
  let aramaic = lang === 'arc';
  // Optional OSHB language prefix: "H..." or "A" followed by an upper-case part of speech.
  if (/^H[ACDNPRSTV]/.test(code)) {
    aramaic = false;
    code = code.slice(1);
  } else if (/^A[ACDNPRSTV]/.test(code)) {
    aramaic = true;
    code = code.slice(1);
  }
  const outLang: MorphLang = aramaic ? 'arc' : 'hbo';
  const segs = code.split('/').filter(Boolean).map((s) => describeHebrewSeg(s, aramaic));
  if (!segs.length) return unknown(input, outLang);
  if (segs.length === 1) {
    const s = segs[0];
    return { code: input, lang: outLang, pos: s.pos, short: s.short, long: s.ok ? s.long : input, parts: s.parts, ok: s.ok };
  }
  // A full OSHB word (prefixes / stem / suffixes): the main part is the first verb or noun-like segment.
  const main = segs.find((s) => /^(Verb|Noun|Adjective|Pronoun|Cardinal|Ordinal|Gentilic)/.test(s.pos)) ?? segs[0];
  const ok = segs.every((s) => s.ok);
  return {
    code: input,
    lang: outLang,
    pos: main.pos,
    short: segs.map((s) => s.short).join(' + '),
    long: ok ? segs.map((s) => s.long).join(' + ') : input,
    parts: segs.flatMap((s) => s.parts),
    ok,
  };
}

function describeHebrewSeg(seg: string, aramaic: boolean): HSeg {
  const bad = (pos = ''): HSeg => ({ pos, long: seg, short: seg, parts: [], ok: false });
  const p = seg[0];
  const rest = seg.slice(1);
  const parts: MorphPart[] = [];
  switch (p) {
    case 'C':
      if (rest) return bad('Conjunction');
      parts.push({ label: 'Part of speech', value: 'Conjunction', key: 'hbo.conjunction' });
      return { pos: 'Conjunction', long: 'Conjunction', short: 'conj', parts, ok: true };
    case 'D':
      if (rest) return bad('Adverb');
      parts.push({ label: 'Part of speech', value: 'Adverb' });
      return { pos: 'Adverb', long: 'Adverb', short: 'adv', parts, ok: true };
    case 'R': {
      parts.push({ label: 'Part of speech', value: 'Preposition', key: 'hbo.preposition' });
      if (!rest) return { pos: 'Preposition', long: 'Preposition', short: 'prep', parts, ok: true };
      if (rest === 'd') {
        parts.push({ label: 'With', value: 'definite article', key: 'hbo.article' });
        return { pos: 'Preposition', long: 'Preposition · with definite article', short: 'prep + art', parts, ok: true };
      }
      return bad('Preposition');
    }
    case 'T': {
      if (!rest) {
        parts.push({ label: 'Part of speech', value: 'Particle' });
        return { pos: 'Particle', long: 'Particle', short: 'ptcl', parts, ok: true };
      }
      const t = H_PARTICLE_TYPE[rest];
      if (!t) return bad('Particle');
      parts.push({ label: 'Part of speech', value: t[0], key: t[3] });
      if (t[0] === 'Particle') parts.push({ label: 'Type', value: capitalise(t[1].split(' · ')[1]) });
      return { pos: t[0], long: t[1], short: t[2], parts, ok: true };
    }
    case 'N': {
      if (!rest) {
        parts.push({ label: 'Part of speech', value: 'Noun', key: 'hbo.noun' });
        return { pos: 'Noun', long: 'Noun', short: 'noun', parts, ok: true };
      }
      const type = H_NOUN_TYPE[rest[0]];
      if (!type) return bad('Noun');
      parts.push({ label: 'Part of speech', value: 'Noun', key: 'hbo.noun' });
      if (type[0]) parts.push({ label: 'Type', value: capitalise(type[0]), key: type[2] });
      const gns = decodeGNS(rest.slice(1), parts);
      if (!gns) return bad('Noun');
      const long = ['Noun', type[0], gns.long].filter(Boolean).join(' · ');
      const short = ['noun', type[1], gns.short].filter(Boolean).join(' ');
      return { pos: rest[0] === 'p' ? 'Proper noun' : 'Noun', long, short, parts, ok: true };
    }
    case 'A': {
      const type = H_ADJ_TYPE[rest[0]];
      if (!type) return bad('Adjective');
      parts.push({ label: 'Part of speech', value: type[0], key: rest[0] === 'a' ? 'hbo.adjective' : undefined });
      const gns = decodeGNS(rest.slice(1), parts);
      if (!gns) return bad(type[0]);
      return {
        pos: type[0],
        long: [type[0], gns.long].filter(Boolean).join(' · '),
        short: [type[1], gns.short].filter(Boolean).join(' '),
        parts,
        ok: true,
      };
    }
    case 'P': {
      parts.push({ label: 'Part of speech', value: 'Pronoun', key: 'hbo.pronoun' });
      if (!rest) return { pos: 'Pronoun', long: 'Pronoun', short: 'pron', parts, ok: true };
      const type = H_PRON_TYPE[rest[0]];
      if (!type) return bad('Pronoun');
      parts.push({ label: 'Type', value: capitalise(type[0]) });
      const pgn = decodePGN(rest.slice(1), parts);
      if (!pgn) return bad('Pronoun');
      return {
        pos: 'Pronoun',
        long: ['Pronoun', type[0], pgn.long].filter(Boolean).join(' · '),
        short: [type[1], 'pron', pgn.short].filter(Boolean).join(' '),
        parts,
        ok: true,
      };
    }
    case 'S': {
      const type = H_SUFFIX_TYPE[rest[0]];
      if (!type) return bad('Suffix');
      parts.push({ label: 'Part of speech', value: type[0], key: type[2] });
      const pgn = decodePGN(rest.slice(1), parts);
      if (!pgn) return bad(type[0]);
      return {
        pos: type[0],
        long: [type[0], pgn.long].filter(Boolean).join(' · '),
        short: [type[1], pgn.short].filter(Boolean).join(' '),
        parts,
        ok: true,
      };
    }
    case 'V': {
      const stem = (aramaic ? A_STEMS : H_STEMS)[rest[0]] ?? (aramaic ? H_STEMS : A_STEMS)[rest[0]];
      const conj = H_CONJ[rest[1]];
      if (!stem || !conj) return bad('Verb');
      const stemKey = (aramaic ? A_STEM_KEY : H_STEM_KEY)[stem];
      parts.push({ label: 'Part of speech', value: 'Verb', key: 'hbo.verb' });
      parts.push({ label: 'Stem', value: stem, key: stemKey });
      parts.push({ label: conj[3] === 'finite' ? 'Conjugation' : 'Form', value: conj[0], key: conj[2] });
      const tailCode = rest.slice(2);
      let tail: { long: string; short: string } | null = { long: '', short: '' };
      if (conj[3] === 'finite') tail = decodePGN(tailCode, parts);
      else if (conj[3] === 'ptc') tail = decodeGNS(tailCode, parts);
      else if (tailCode) tail = decodePGN(tailCode, parts); // infinitives normally have nothing more
      if (!tail) return bad('Verb');
      return {
        pos: 'Verb',
        long: ['Verb', stem, conj[0], tail.long].filter(Boolean).join(' · '),
        short: [stem, conj[1], tail.short].filter(Boolean).join(' '),
        parts,
        ok: true,
      };
    }
    default:
      return bad();
  }
}

/** Person-gender-number ("3ms", "xms", "1cs", "3", ""). */
function decodePGN(s: string, parts: MorphPart[]): { long: string; short: string } | null {
  if (!s) return { long: '', short: '' };
  const m = /^([123x])?([mfcbx])?([spdx])?$/.exec(s);
  if (!m) return null;
  const person = m[1] && m[1] !== 'x' ? H_PERSON[m[1]] : '';
  const g = m[2] && m[2] !== 'x' ? H_GENDER[m[2]] : undefined;
  const n = m[3] && m[3] !== 'x' ? H_NUMBER[m[3]] : undefined;
  if (person) parts.push({ label: 'Person', value: person });
  if (g) parts.push({ label: 'Gender', value: capitalise(g[0]) });
  if (n) parts.push({ label: 'Number', value: capitalise(n[0]), key: n[2] });
  const long = [person ? `${person} person` : '', g?.[0], n?.[0]].filter(Boolean).join(' ');
  const short = `${person ? m[1] : ''}${g ? g[1] : ''}${n ? n[1] : ''}`;
  return { long, short };
}

/** Gender-number-state ("msa", "fpc", "bsd", "xxa", ""). */
function decodeGNS(s: string, parts: MorphPart[]): { long: string; short: string } | null {
  if (!s) return { long: '', short: '' };
  const m = /^([mfcbx])?([spdx])?([acdx])?$/.exec(s);
  if (!m) return null;
  const g = m[1] && m[1] !== 'x' ? H_GENDER[m[1]] : undefined;
  const n = m[2] && m[2] !== 'x' ? H_NUMBER[m[2]] : undefined;
  const st = m[3] && m[3] !== 'x' ? H_STATE[m[3]] : undefined;
  if (g) parts.push({ label: 'Gender', value: capitalise(g[0]) });
  if (n) parts.push({ label: 'Number', value: capitalise(n[0]), key: n[2] });
  if (st) parts.push({ label: 'State', value: capitalise(st[0]), key: st[2] });
  const long = [g?.[0], n?.[0], st?.[0]].filter(Boolean).join(' ');
  const short = [`${g ? g[1] : ''}${n ? n[1] : ''}`, st?.[1]].filter(Boolean).join(' ');
  return { long, short };
}

/** Strong's "TVM" codes used by the CrossWire KJV's Old Testament (strongMorph:TH8804). Not decoded. */
function describeStrongsTvm(code: string, lang: MorphLang): MorphDescription {
  const n = code.replace(/\D/g, '');
  return {
    code,
    lang,
    pos: 'Verb',
    short: `TVM ${n}`,
    long: `Verb · Strong’s tense/voice/mood code ${n}`,
    parts: [{ label: 'Part of speech', value: 'Verb' }],
    ok: false,
  };
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* ======================================================================== */
/* Glossary                                                                  */
/* ======================================================================== */

export interface GlossaryEntry {
  term: string;
  text: string;
}

/**
 * Plain-language explanations of grammatical terms, keyed by MorphPart.key.
 * "grc.*" Koine Greek, "hbo.*" Biblical Hebrew, "arc.*" Biblical Aramaic, "case.*" Greek cases.
 */
export const MORPH_GLOSSARY: Record<string, GlossaryEntry> = {
  // --- Greek parts of speech
  'grc.verb': { term: 'Verb', text: 'A word for an action or state. Greek verbs pack tense, voice, mood, person and number into their endings.' },
  'grc.noun': { term: 'Noun', text: 'A person, place, thing or idea. Its ending shows its case (role in the sentence), number and gender.' },
  'grc.adjective': { term: 'Adjective', text: 'Describes a noun and matches it in case, number and gender. Often used on its own as a noun ("the good", "the poor").' },
  'grc.article': { term: 'Article', text: 'The Greek word for "the" (ὁ, ἡ, τό). Greek has no word for "a"; the article also turns other words — even whole phrases — into nouns.' },
  'grc.pronoun': { term: 'Pronoun', text: 'Stands in for a noun: I, you, he, this, who, each other, oneself… Greek often leaves subject pronouns out because the verb ending already shows the person, so a written one adds emphasis.' },
  'grc.relative-pronoun': { term: 'Relative pronoun', text: '"Who, which, that" — introduces a clause that describes something already mentioned.' },
  'grc.adverb': { term: 'Adverb', text: 'Modifies a verb, adjective or the whole sentence: how, when, where (e.g. "now", "there", "truly").' },
  'grc.conjunction': { term: 'Conjunction', text: 'Joins words or clauses: and, but, for, therefore. Greek uses them constantly to show how sentences relate.' },
  'grc.particle': { term: 'Particle', text: 'A small word that adds nuance — emphasis, contrast, negation, a question or a condition ("indeed", "not", "if").' },
  'grc.preposition': { term: 'Preposition', text: 'Relates a noun to the rest of the sentence: in, into, from, through. Its meaning often depends on the case of the noun that follows.' },
  'grc.foreign': { term: 'Transliterated word', text: 'A Hebrew or Aramaic word written in Greek letters (e.g. ἀμήν "amen", ἀββά "abba"); it does not decline.' },
  'grc.indeclinable': { term: 'Indeclinable', text: 'A word whose form never changes — mostly foreign names (Ἀβραάμ) and numbers like δώδεκα "twelve".' },
  'grc.comparative': { term: 'Comparative', text: '"More …" or "…-er" (greater, better).' },
  'grc.superlative': { term: 'Superlative', text: '"Most …" or "…-est"; in Koine often just "very …".' },
  'grc.crasis': { term: 'Crasis', text: 'Two words fused into one, usually καί "and" + the next word: κἀγώ = καὶ ἐγώ "and I / I also".' },
  'grc.attic': { term: 'Attic form', text: 'An older, classical (Athenian) spelling of the word, a little more literary than ordinary Koine.' },
  // --- Greek tenses (aspect!)
  'grc.present': { term: 'Present', text: 'Presents the action as ongoing or in progress ("is loving", "keeps loving"). Outside the indicative it is about this ongoing aspect, not about time.' },
  'grc.imperfect': { term: 'Imperfect', text: 'Ongoing or repeated action in the past: "was teaching", "used to go", "kept asking".' },
  'grc.future': { term: 'Future', text: 'Action expected to happen: "will save".' },
  'grc.aorist': { term: 'Aorist', text: 'Views an action as a simple, complete whole without describing its progress — "a snapshot rather than a video". In the indicative it usually narrates the past ("he said"); in other moods it carries no time at all.' },
  'grc.second-tense': { term: 'Second (strong) form', text: 'A form built on a different stem without the usual -σα- (e.g. ἦλθον "I came" rather than *ἐλευσα). Same meaning as the "first" form; only the spelling pattern differs.' },
  'grc.perfect': { term: 'Perfect', text: 'A completed action whose result still stands: γέγραπται "it has been written (and still stands written)".' },
  'grc.pluperfect': { term: 'Pluperfect', text: 'A completed past action whose result stood at some past time: "had known", "had come".' },
  // --- Greek voices
  'grc.active': { term: 'Active voice', text: 'The subject does the action: "God loved the world".' },
  'grc.middle': { term: 'Middle voice', text: 'The subject acts with special involvement — for or on itself ("I wash myself", "I choose for myself").' },
  'grc.passive': { term: 'Passive voice', text: 'The subject receives the action: "was raised", "is being saved".' },
  'grc.middle-passive': { term: 'Middle or passive', text: 'The form is the same for middle and passive here; context decides whether the subject acts on itself or is acted upon.' },
  'grc.deponent': { term: 'Deponent', text: 'A verb with a middle or passive form but an active meaning, e.g. ἔρχομαι "I come". Many grammarians now call these simply middle verbs.' },
  // --- Greek moods
  'grc.indicative': { term: 'Indicative', text: 'The mood of plain statements and questions about reality: "he went", "do you believe?".' },
  'grc.subjunctive': { term: 'Subjunctive', text: 'The mood of possibility, purpose and intention: "so that he might…", "let us…", "whoever would…".' },
  'grc.optative': { term: 'Optative', text: 'A rare mood for wishes and remote possibilities: μὴ γένοιτο "may it never be!".' },
  'grc.imperative': { term: 'Imperative', text: 'A command or request: "repent", "follow me", "let it be done".' },
  'grc.infinitive': { term: 'Infinitive', text: 'The "to …" form of a verb ("to love"); a verbal noun that can be the subject or object of another verb, or express purpose.' },
  'grc.participle': { term: 'Participle', text: 'A verbal adjective, often translated "…-ing" or "the one who …" (ὁ πιστεύων "the one who believes"). It can describe a noun or add a clause about time, cause or manner.' },
  // --- Greek cases
  'case.nominative': { term: 'Nominative', text: 'The case of the subject — who or what does the action — and of words naming the subject.' },
  'case.genitive': { term: 'Genitive', text: 'Usually "of": possession, origin, description ("the love of God"). Also used after some prepositions ("from", "through").' },
  'case.dative': { term: 'Dative', text: 'Usually "to / for / with / by": the indirect object, the means, or the location.' },
  'case.accusative': { term: 'Accusative', text: 'The direct object — who or what receives the action. Also used after prepositions of motion ("into", "toward").' },
  'case.vocative': { term: 'Vocative', text: 'Direct address: "O Lord!", "Brothers, …".' },

  // --- Hebrew parts of speech
  'hbo.verb': { term: 'Verb', text: 'Hebrew verbs are built from (usually) three-letter roots; the stem pattern changes the kind of action and the conjugation its aspect/time.' },
  'hbo.noun': { term: 'Noun', text: 'A person, place, thing or idea. Hebrew nouns are masculine or feminine, singular, plural or dual, and absolute or construct.' },
  'hbo.adjective': { term: 'Adjective', text: 'Describes a noun and usually follows it, matching its gender, number and definiteness.' },
  'hbo.pronoun': { term: 'Pronoun', text: 'An independent pronoun (I, you, he, this, who). Because verbs already show the person, a separate pronoun often adds emphasis.' },
  'hbo.proper-name': { term: 'Proper name', text: 'The name of a person, place or people — or, for יהוה, the personal name of God (rendered "the LORD").' },
  'hbo.gentilic': { term: 'Gentilic', text: 'A word naming a people or someone belonging to it: "Hebrew", "Moabite", "Chaldean".' },
  'hbo.conjunction': { term: 'Conjunction', text: 'Most often the prefix וְ "and", which also marks "but", "then", "so". It is written joined to the next word.' },
  'hbo.preposition': { term: 'Preposition', text: 'In, on, to, from… The common ones בְּ "in", לְ "to", כְּ "like" are written as one-letter prefixes.' },
  'hbo.article': { term: 'Definite article', text: '"The": the prefix הַ attached to the word (with a doubled next letter). After the prefixes בְּ לְ כְּ it merges into their vowel.' },
  'hbo.object-marker': { term: 'Direct object marker', text: 'אֵת / אֶת- has no English equivalent; it points out the definite direct object of the verb.' },
  'hbo.pronominal-suffix': { term: 'Pronominal suffix', text: 'A pronoun attached to the end of a word: on a noun it means "my, your, his…", on a verb or preposition "me, you, him…".' },
  'hbo.directional-he': { term: 'Directional he', text: 'An unstressed ה ending meaning "toward": אַרְצָה "to the land", הַשָּׁמַיְמָה "heavenward".' },
  'hbo.paragogic': { term: 'Paragogic letter', text: 'An extra ה or נ added to a verb ending for emphasis, rhythm or style; it does not change the basic meaning.' },
  'hbo.dual': { term: 'Dual', text: 'A number for pairs: eyes, hands, two days. Ends in ־ַיִם.' },
  'hbo.absolute': { term: 'Absolute state', text: 'The ordinary, stand-alone form of a noun.' },
  'hbo.construct': { term: 'Construct state', text: 'A shortened form that binds a noun to the next word with the sense "X of Y": דְּבַר יְהוָה "the word of the LORD".' },
  'hbo.determined': { term: 'Determined (emphatic) state', text: 'Aramaic way of saying "the": an ending (usually ־א) instead of a prefix — מַלְכָּא "the king".' },
  // --- Hebrew stems
  'hbo.qal': { term: 'Qal', text: 'The basic, "simple" stem: the plain meaning of the root (שָׁבַר "he broke"). About two-thirds of all Hebrew verbs are Qal.' },
  'hbo.qal-passive': { term: 'Qal passive', text: 'An old passive of the simple stem ("was taken"), surviving in a few verbs.' },
  'hbo.niphal': { term: 'Niphal', text: 'Usually the passive or reflexive of the Qal: "was broken", "hid himself". Recognised by a נ prefix.' },
  'hbo.piel': { term: 'Piel', text: 'The "intensive" stem with a doubled middle letter; it often makes the action intensive, repeated or causes a state ("shattered", "made holy").' },
  'hbo.pual': { term: 'Pual', text: 'The passive of the Piel: "was shattered", "was made holy".' },
  'hbo.hiphil': { term: 'Hiphil', text: 'The causative stem: "caused to …" (Qal "he came" → Hiphil "he brought"). Recognised by a ה prefix in the perfect.' },
  'hbo.hophal': { term: 'Hophal', text: 'The passive of the Hiphil: "was caused to …", "was brought".' },
  'hbo.hithpael': { term: 'Hithpael', text: 'Reflexive or reciprocal action of the Piel: "sanctified himself", "walked about", "prayed". Prefix הִתְ־.' },
  'hbo.piel-variant': { term: 'Piel-type stem', text: 'A by-form of the Piel (Polel, Pilel, Pilpel…) used by verbs with hollow or doubled roots; it carries the Piel’s intensive or causative sense.' },
  'hbo.pual-variant': { term: 'Pual-type stem', text: 'A by-form of the Pual (Polal, Pulal, Polpal…): the passive of the corresponding Piel-type stem.' },
  'hbo.hithpael-variant': { term: 'Hithpael-type stem', text: 'A by-form of the Hithpael (Hithpolel, Hithpalpel, Nithpael…): reflexive action, "oneself".' },
  'hbo.hishtaphel': { term: 'Hishtaphel', text: 'A rare reflexive stem, used for הִשְׁתַּחֲוָה "to bow down, worship".' },
  // --- Hebrew conjugations
  'hbo.perfect': { term: 'Perfect (qatal)', text: 'Views an action as a complete whole — usually past ("he created"), but also states and certainties.' },
  'hbo.weqatal': { term: 'Sequential perfect (weqatal)', text: 'A perfect joined to "and" that continues a future, command or habitual sequence: "and you shall…", "and he would…".' },
  'hbo.imperfect': { term: 'Imperfect (yiqtol)', text: 'Incomplete action: future ("he will"), repeated or habitual ("he used to"), or possible ("he may").' },
  'hbo.wayyiqtol': { term: 'Sequential imperfect (wayyiqtol)', text: 'The narrative past tense: "and he said…, and he went…". It carries the storyline of Hebrew narrative.' },
  'hbo.cohortative': { term: 'Cohortative', text: 'A first-person wish or resolve: "let me…", "let us…".' },
  'hbo.jussive': { term: 'Jussive', text: 'A third-person wish or command: "let there be light", "may he…".' },
  'hbo.imperative': { term: 'Imperative', text: 'A direct command: "listen!", "go!".' },
  'hbo.participle': { term: 'Participle', text: 'A verbal adjective: "doing / one who does" — ongoing action, or a noun like "the one who creates".' },
  'hbo.passive-participle': { term: 'Passive participle', text: '"Done to": בָּרוּךְ "blessed", כָּתוּב "written".' },
  'hbo.infinitive-absolute': { term: 'Infinitive absolute', text: 'A verbal noun often placed beside a finite verb of the same root for emphasis: "you shall surely die".' },
  'hbo.infinitive-construct': { term: 'Infinitive construct', text: 'The "to …" form ("to do"), often with a preposition: "when he went", "in order to keep".' },
  // --- Aramaic stems
  'arc.peal': { term: 'Peal', text: 'The basic Aramaic stem — like the Hebrew Qal.' },
  'arc.peil': { term: 'Peil', text: 'A passive of the Peal: "was given", "was written".' },
  'arc.pael': { term: 'Pael', text: 'The doubled ("intensive") stem — like the Hebrew Piel.' },
  'arc.haphel': { term: 'Haphel / Aphel', text: 'The causative stem — like the Hebrew Hiphil: "caused to …".' },
  'arc.shaphel': { term: 'Shaphel', text: 'A causative stem with a שׁ / ס prefix, borrowed from Akkadian ("finished", "delivered").' },
  'arc.hophal': { term: 'Hophal', text: 'The passive of the causative stem: "was caused to …".' },
  'arc.hithpeel': { term: 'Hithpeel / Ithpeel', text: 'Passive or reflexive of the Peal: "was thrown", "was made".' },
  'arc.hithpaal': { term: 'Hithpaal / Ithpaal', text: 'Passive or reflexive of the Pael (and similar reflexive by-forms).' },
};

/** Glossary entries for every part of a description that has one (de-duplicated, in order). */
export function glossaryFor(desc: MorphDescription): (GlossaryEntry & { key: string })[] {
  const seen = new Set<string>();
  const out: (GlossaryEntry & { key: string })[] = [];
  for (const p of desc.parts) {
    if (!p.key || seen.has(p.key)) continue;
    const e = MORPH_GLOSSARY[p.key];
    if (!e) continue;
    seen.add(p.key);
    out.push({ key: p.key, ...e });
  }
  return out;
}
