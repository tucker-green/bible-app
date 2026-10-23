// Lumen concept — mock lexicon, parsing and search data.
//
// Everything here stands in for data the real app gets from public/data/ (lex/, conc/, search/)
// and src/lib (greek.ts, morph.ts). Definitions are short plain-language placeholders written
// for this mockup; occurrence counts were computed from SBLGNT.tsv / WLCM.tsv in .cache/sources/.

/* ----------------------------------------------------------------------------------------- */
/* Definitions (keyed by Strong's id as it appears in design/sample.json)                     */
/* ----------------------------------------------------------------------------------------- */

export const DEFS = {
  // ---- Greek ------------------------------------------------------------------------------
  G3056: {
    form: 'λόγος, -ου, ὁ',
    def: 'A word, saying or message: speech as the expression of thought, and so also reason or account. John uses it of the divine Word, God’s self-expression, who was with God, was God, and “became flesh” (1:14).',
  },
  G0746: {
    form: 'ἀρχή, -ῆς, ἡ',
    def: 'A beginning or origin; also the first place of power, hence “ruler” or “authority.” John’s ἐν ἀρχῇ deliberately echoes the opening words of Genesis in the Greek Old Testament.',
  },
  G2316: {
    form: 'θεός, -οῦ, ὁ',
    def: 'God; in the New Testament almost always the one God of Israel. In 1:1c the noun stands first and without the article (θεὸς ἦν ὁ λόγος), telling us what the Word is rather than who.',
  },
  G2258: {
    form: 'εἰμί',
    def: 'To be, exist, be present. The imperfect ἦν (“was”) pictures ongoing existence: when the beginning began, the Word already was.',
  },
  G1096: {
    form: 'γίνομαι',
    def: 'To come into being, be made, happen, become. In the prologue it is set against εἰμί: all things came to be; the Word simply was.',
  },
  G5457: {
    form: 'φῶς, φωτός, τό',
    def: 'Light, whether of sun or lamp; in John the life-giving presence of God revealed in the Word, set against σκοτία, darkness.',
  },
  G2222: {
    form: 'ζωή, -ῆς, ἡ',
    def: 'Life: the state of being alive, and in John especially the life that belongs to God and is given through the Son.',
  },
  G4653: {
    form: 'σκοτία, -ας, ἡ',
    def: 'Darkness, gloom; in John a moral and spiritual realm opposed to the light, which it cannot master.',
  },
  G2638: {
    form: 'καταλαμβάνω',
    def: 'To seize, grasp, overtake; hence both “comprehend” and “overcome.” John 1:5 may play on both senses: the darkness neither understood nor mastered the light.',
  },
  G5316: { form: 'φαίνω', def: 'To shine, give light; to appear or become visible. The present tense: the light goes on shining.' },
  G0444: { form: 'ἄνθρωπος, -ου, ὁ', def: 'A human being, a person; in the plural, people or humankind generally.' },
  G1722: { form: 'ἐν', def: 'In, on, among; also “by means of.” The most common preposition in the New Testament, marking location in place, time or sphere.' },
  G3588: { form: 'ὁ, ἡ, τό', def: 'The definite article, “the.” Greek uses it more freely than English; it can mark a known person or thing, or turn other words into nouns.' },
  G2532: { form: 'καί', def: 'And, also, even. The ordinary connective, joining words, phrases and clauses; John strings his prologue together with it.' },
  G4314: { form: 'πρός', def: 'Toward, with, in the presence of. With the accusative it suggests face-to-face fellowship: the Word was “toward” God.' },
  G3778: { form: 'οὗτος, αὕτη, τοῦτο', def: 'This, this one; often “he” or “she” when pointing back to someone just mentioned.' },
  G3956: { form: 'πᾶς, πᾶσα, πᾶν', def: 'All, every, the whole; with no noun, “all things” or “everyone.”' },
  G1223: { form: 'διά', def: 'Through, by means of (with the genitive); because of (with the accusative).' },
  G0846: { form: 'αὐτός, -ή, -ό', def: 'He, she, it; also “self” or “the same.” The ordinary third-person pronoun.' },
  G5565: { form: 'χωρίς', def: 'Without, apart from, separately.' },
  G3761: { form: 'οὐδέ', def: 'And not, nor, not even. With εἷς: “not even one,” nothing at all.' },
  G1520: { form: 'εἷς, μία, ἕν', def: 'One; the number one, or a single individual.' },
  G3739: { form: 'ὅς, ἥ, ὅ', def: 'Who, which, that: the relative pronoun.' },
  G3756: { form: 'οὐ, οὐκ, οὐχ', def: 'Not, no: the ordinary negative of statements of fact.' },
  G3779: { form: 'οὕτω(ς)', def: 'Thus, so, in this way; pointing to the manner of what follows.' },
  G1063: { form: 'γάρ', def: 'For, because; introduces an explanation or reason. Never the first word of its clause.' },
  G0025: { form: 'ἀγαπάω', def: 'To love, to cherish; to will and act for another’s good. The verb behind “God so loved the world.”' },
  G2889: { form: 'κόσμος, -ου, ὁ', def: 'Order, arrangement; the world or universe, and humanity as a whole, often humanity estranged from God.' },
  G5620: { form: 'ὥστε', def: 'So that, with the result that; introduces a consequence.' },
  G5207: { form: 'υἱός, -οῦ, ὁ', def: 'A son, male offspring; also one who shares the character of another.' },
  G3439: { form: 'μονογενής, -ές', def: 'One and only, unique: the only one of its kind; traditionally “only-begotten.”' },
  G1325: { form: 'δίδωμι', def: 'To give, grant, hand over.' },
  G2443: { form: 'ἵνα', def: 'In order that, so that; introduces purpose or content.' },
  G4100: { form: 'πιστεύω', def: 'To believe, trust, entrust oneself to; with εἰς, to put one’s faith into someone.' },
  G1519: { form: 'εἰς', def: 'Into, to, toward; for. Often marks movement or goal.' },
  G3361: { form: 'μή', def: 'Not: the negative used with wishes, commands and non-indicative verbs.' },
  G0622: { form: 'ἀπόλλυμι', def: 'To destroy; in the middle voice, to perish, be lost, be ruined.' },
  G0235: { form: 'ἀλλά', def: 'But, rather; a strong contrast.' },
  G2192: { form: 'ἔχω', def: 'To have, hold, possess.' },
  G0166: { form: 'αἰώνιος, -ον', def: 'Eternal, age-long: belonging to the age to come, without end.' },

  // ---- Hebrew -----------------------------------------------------------------------------
  H0430: {
    form: 'אֱלֹהִים',
    def: 'God, gods. Plural in form but taking singular verbs when it names the God of Israel, a “plural of majesty” expressing fullness of power. Also used of the gods of the nations and of heavenly beings.',
  },
  H7225: { form: 'רֵאשִׁית', def: 'Beginning, first; the first or best part of something, such as firstfruits. Here, the start of all created things.' },
  H1254: { form: 'בָּרָא', def: 'To create, shape, form. In this stem the subject is always God: a verb reserved for divine creating.' },
  H0871a: { form: 'בְּ', def: 'In, at, with, by: an inseparable preposition written as a prefix on the following word.' },
  H1886a: { form: 'הַ', def: 'The definite article, “the,” written as a prefix; it doubles the next consonant where it can.' },
  H2050b: { form: 'וְ', def: 'And, but, then: the conjunction “waw,” prefixed to words and clauses throughout Hebrew narrative.' },
  H0853: { form: 'אֵת', def: 'Marker of a definite direct object; it has no English equivalent and is normally left untranslated.' },
  H8064: { form: 'שָׁמַיִם', def: 'Heavens, sky: the visible sky and the dwelling place of God. Always plural in form.' },
  H0776: { form: 'אֶרֶץ', def: 'Earth, land: the whole earth, a country or territory, or the ground underfoot.' },
  H1961: { form: 'הָיָה', def: 'To be, become, happen, come to pass.' },
  H8414: { form: 'תֹּהוּ', def: 'Formlessness, emptiness, chaos; a trackless waste.' },
  H0922: { form: 'בֹּהוּ', def: 'Emptiness, void. Found only in the pairing “formless and void.”' },
  H2822: { form: 'חֹשֶׁךְ', def: 'Darkness, obscurity; figuratively distress or death.' },
  H5921: { form: 'עַל', def: 'Upon, over, above; concerning, against.' },
  H6440: { form: 'פָּנִים', def: 'Face; the front or surface of something. Always plural in form.' },
  H8415: { form: 'תְּהוֹם', def: 'The deep: the primeval ocean, the abyss of waters.' },
  H7307: { form: 'רוּחַ', def: 'Breath, wind, spirit; the Spirit of God as the power of life and creation.' },
  H7363: { form: 'רָחַף', def: 'To hover, flutter, like a bird over its young (compare Deut 32:11).' },
  H4325: { form: 'מַיִם', def: 'Water, waters. Always plural in form.' },
  H0559: { form: 'אָמַר', def: 'To say, speak, command.' },
  H0216: { form: 'אוֹר', def: 'Light: daylight, the light of sun and lamp; figuratively life and blessing. The first thing God speaks into being.' },
  H3068: { form: 'יהוה', def: 'Yahweh, the personal name of the God of Israel (Exod 3:14–15). Most English Bibles render it “the Lord” in small capitals.' },
  H7473: { form: 'רֹעֶה', def: 'Shepherd: one who pastures and tends a flock, and so one who leads and cares for a people.' },
  H2967a: { form: 'אֲנִי', def: 'Pronominal suffix, first person singular: “my” or “me.”' },
  H5204a: { form: 'אֲנִי', def: 'Pronominal suffix, first person singular: “me.”' },
  H3808: { form: 'לֹא', def: 'Not, no: the ordinary negative.' },
  H2637: { form: 'חָסֵר', def: 'To lack, be in want, decrease.' },
  H4999: { form: 'נָוָה', def: 'Pasture, meadow; a pleasant place for flocks to rest.' },
  H1877: { form: 'דֶּשֶׁא', def: 'Fresh grass, new green growth.' },
  H7257: { form: 'רָבַץ', def: 'To lie down, stretch out (of animals at rest); causative: to make lie down.' },
  H4496: { form: 'מְנוּחָה', def: 'Rest, resting place; quietness.' },
  H5095: { form: 'נָהַל', def: 'To lead to water, guide gently, refresh.' },
};

/* Occurrences of each Strong's number (SBLGNT for Greek, WLC for Hebrew). */
export const COUNTS = {
  G3056: 330, G0746: 55, G2316: 1307, G1722: 2734, G2258: 427, G3588: 19794, G2532: 8984,
  G4314: 698, G3778: 340, G3956: 1244, G1223: 666, G0846: 5067, G1096: 667, G5565: 42,
  G3761: 143, G1520: 265, G3739: 1408, G2222: 135, G5457: 72, G0444: 550, G4653: 17,
  G5316: 31, G3756: 1623, G2638: 15, G3779: 207, G1063: 1039, G0025: 143, G2889: 185,
  G5620: 83, G5207: 375, G3439: 9, G1325: 415, G2443: 663, G4100: 241, G1519: 1762,
  G3361: 1042, G0622: 90, G0235: 638, G2192: 707, G0166: 69, G0026: 116, G5368: 25,
  H0871a: 15766, H7225: 51, H1254: 54, H0430: 2601, H1886a: 29486, H8064: 421, H2050b: 62954,
  H0853: 10939, H0776: 2504, H1961: 3561, H8414: 20, H0922: 3, H2822: 80, H5921: 5770,
  H6440: 2126, H8415: 36, H7307: 378, H7363: 3, H4325: 581, H0559: 5309, H0216: 120,
  H3068: 6513, H7473: 83, H2967a: 7136, H3808: 5168, H2637: 22, H4999: 13, H1877: 14,
  H7257: 30, H5204a: 1188, H4496: 21, H5095: 10, H0157: 215, H2617: 247,
};

/* Septuagint forms in the sample with obvious typos (fixed here for display; reported upstream). */
export const LXX_FIX = { 'ἀρξῇ': 'ἀρχῇ', 'ξλόης': 'χλόης' };

/* Words the mockup shows as "supplied by the translators" (KJV-style italics, TokenInfo.i = 1).
   In the BSB sample they are aligned to the neighbouring Hebrew word; the Hebrew clause has no
   verb "to be" (the gloss marks it as "[is]" / "[was]"). Keyed "verseId:tokenIndex". */
export const SUPPLIED = {
  '19023001:2': 'Hebrew has no verb “to be” here: “Yahweh my-shepherd.” The translators supply “is.”',
  '01001002:10': 'Hebrew has no verb here: “and darkness over the face of the deep.” The translators supply “was.”',
};

/* BSB footnotes in the sample passages, keyed "verseId:tokenIndex" (marker goes after that token). */
export const NOTES = {
  '43001005:12': { mark: 'a', text: 'Or comprehended' },
  '19023001:5': { mark: 'a', text: 'See Revelation 7:17.' },
  '01001003:10': { mark: 'b', text: 'Cited in 2 Corinthians 4:6' },
};

/* ----------------------------------------------------------------------------------------- */
/* Greek transliteration (simplified SBL style)                                               */
/* ----------------------------------------------------------------------------------------- */

const GK = {
  α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'ē', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'ō',
};
const VOWELS = 'αεηιουω';

export function greekTranslit(word) {
  const d = word.normalize('NFD');
  // Split into base letters with their marks.
  const letters = [];
  for (const ch of d) {
    if (/\p{M}/u.test(ch)) {
      if (letters.length) letters[letters.length - 1].marks += ch;
    } else letters.push({ ch, marks: '' });
  }
  let out = '';
  for (let i = 0; i < letters.length; i++) {
    const { ch, marks } = letters[i];
    const lower = ch.toLowerCase();
    const upper = ch !== lower;
    const next = letters[i + 1]?.ch.toLowerCase();
    let rough = marks.includes('̔');
    let t;
    if (!(lower in GK)) { out += ch; continue; }
    // diphthongs with upsilon
    if (next === 'υ' && 'αεηο'.includes(lower)) {
      t = { α: 'au', ε: 'eu', η: 'ēu', ο: 'ou' }[lower];
      rough = rough || letters[i + 1].marks.includes('̔');
      i++;
    } else if (next === 'ι' && 'αεου'.includes(lower) && !letters[i + 1].marks.includes('̈')) {
      t = GK[lower] + 'i';
      rough = rough || letters[i + 1].marks.includes('̔');
      i++;
    } else if (lower === 'γ' && next && 'γκξχ'.includes(next)) {
      t = 'n';
    } else if (lower === 'υ' && (i === 0 || !VOWELS.includes(letters[i - 1].ch.toLowerCase()))) {
      t = 'y';
    } else {
      t = GK[lower];
    }
    if (rough) t = lower === 'ρ' ? 'rh' : 'h' + t;
    if (upper) t = t[0].toUpperCase() + t.slice(1);
    out += t;
  }
  return out;
}

/* ----------------------------------------------------------------------------------------- */
/* Morphology → plain language                                                               */
/* ----------------------------------------------------------------------------------------- */

const CASE = { N: 'nominative', G: 'genitive', D: 'dative', A: 'accusative', V: 'vocative' };
const NUM = { S: 'singular', P: 'plural' };
const GEN = { M: 'masculine', F: 'feminine', N: 'neuter' };
const TENSE = { P: 'present', I: 'imperfect', F: 'future', A: 'aorist', R: 'perfect', L: 'pluperfect' };
const VOICE = { A: 'active', M: 'middle', P: 'passive', D: 'middle', O: 'passive', N: 'middle or passive', E: 'middle or passive' };
const MOOD = { I: 'indicative', S: 'subjunctive', O: 'optative', M: 'imperative', N: 'infinitive', P: 'participle' };
const PERSON = { 1: '1st person', 2: '2nd person', 3: '3rd person' };
const GK_POS = {
  N: 'Noun', T: 'Article', P: 'Personal pronoun', D: 'Demonstrative pronoun', R: 'Relative pronoun',
  A: 'Adjective', C: 'Reciprocal pronoun', F: 'Reflexive pronoun', I: 'Interrogative pronoun', X: 'Indefinite pronoun',
};
const GK_WORD = { PREP: 'Preposition', CONJ: 'Conjunction', ADV: 'Adverb', PRT: 'Particle', COND: 'Conditional', INJ: 'Interjection' };

/** Robinson code → { pos, detail } e.g. N-NSM → Noun · nominative masculine singular. */
export function parseGreek(code) {
  if (!code) return { pos: '', detail: '' };
  const parts = code.split('-');
  const head = parts[0];
  if (GK_WORD[head]) {
    const neg = parts[1] === 'N' ? 'negative' : '';
    return { pos: GK_WORD[head], detail: neg };
  }
  if (head === 'V') {
    let tvm = parts[1] || '';
    if (/^\d/.test(tvm)) tvm = tvm.slice(1); // "2A" second aorist etc.
    const tense = TENSE[tvm[0]] || '';
    const voice = VOICE[tvm[1]] || '';
    const mood = MOOD[tvm[2]] || '';
    let rest = '';
    const p = parts[2] || '';
    if (/^[123][SP]$/.test(p)) rest = `${PERSON[p[0]]} ${NUM[p[1]]}`;
    else if (/^[NGDAV][SP][MFN]$/.test(p)) rest = `${CASE[p[0]]} ${GEN[p[2]]} ${NUM[p[1]]}`;
    return { pos: 'Verb', detail: [`${tense} ${voice} ${mood}`.trim(), rest].filter(Boolean).join(', ') };
  }
  const pos = GK_POS[head] || head;
  const cng = parts[1] || '';
  if (/^[NGDAV][SP][MFN]$/.test(cng)) {
    return { pos, detail: `${CASE[cng[0]]} ${GEN[cng[2]]} ${NUM[cng[1]]}` };
  }
  return { pos, detail: '' };
}

const HSTEM = { q: 'Qal', N: 'Niphal', p: 'Piel', P: 'Pual', h: 'Hiphil', H: 'Hophal', t: 'Hithpael' };
const HTYPE = {
  p: 'perfect', q: 'sequential perfect', i: 'imperfect', w: 'sequential imperfect (wayyiqtol)',
  h: 'cohortative', j: 'jussive', v: 'imperative', r: 'participle', s: 'passive participle',
  a: 'infinitive absolute', c: 'infinitive construct',
};
const HPER = { 1: '1st', 2: '2nd', 3: '3rd' };
const HGEN = { m: 'masculine', f: 'feminine', c: 'common', b: 'common' };
const HNUM = { s: 'singular', p: 'plural', d: 'dual' };
const HSTATE = { a: 'absolute', c: 'construct', d: 'determined' };

/** OSHB-style code (no language letter) → { pos, detail }. */
export function parseHebrew(code) {
  if (!code) return { pos: '', detail: '' };
  const c = code[0];
  if (c === 'R') return { pos: 'Preposition', detail: 'prefixed' };
  if (c === 'C') return { pos: 'Conjunction', detail: '' };
  if (c === 'D') return { pos: 'Adverb', detail: '' };
  if (c === 'T') {
    const t = { d: 'Definite article', o: 'Object marker', n: 'Negative particle', i: 'Interrogative particle' }[code[1]];
    return { pos: t || 'Particle', detail: '' };
  }
  if (c === 'S') {
    const p = code.slice(2);
    return { pos: 'Pronominal suffix', detail: `${HPER[p[0]] || ''} ${HGEN[p[1]] || ''} ${HNUM[p[2]] || ''}`.replace(/\s+/g, ' ').trim() };
  }
  if (c === 'N') {
    if (code[1] === 'p') return { pos: 'Proper noun', detail: 'divine name' };
    const g = HGEN[code[2]] || '';
    const gender = code[2] === 'b' ? 'either gender' : g;
    return { pos: 'Noun', detail: [gender, HNUM[code[3]], HSTATE[code[4]]].filter(Boolean).join(' ') };
  }
  if (c === 'A') return { pos: 'Adjective', detail: [HGEN[code[2]], HNUM[code[3]], HSTATE[code[4]]].filter(Boolean).join(' ') };
  if (c === 'V') {
    const stem = HSTEM[code[1]] || '';
    const type = HTYPE[code[2]] || '';
    const rest = code.slice(3);
    let tail = '';
    if (/^[123]/.test(rest)) tail = `${HPER[rest[0]]} ${HGEN[rest[1]]} ${HNUM[rest[2]]}`;
    else if (rest) tail = [HGEN[rest[0]], HNUM[rest[1]], HSTATE[rest[2]]].filter(Boolean).join(' ');
    return { pos: 'Verb', detail: [`${stem} ${type}`.trim(), tail].filter(Boolean).join(', ') };
  }
  return { pos: code, detail: '' };
}

/* ----------------------------------------------------------------------------------------- */
/* Search glimpse: "love" in the BSB                                                          */
/* ----------------------------------------------------------------------------------------- */

/* Verses (BSB) containing love / loved / loves / loving, per book in canonical order —
   computed from .cache/sources/bsb.usfx.xml. 618 verses, 710 occurrences. */
export const LOVE_BY_BOOK = [14, 5, 2, 2, 22, 2, 4, 2, 10, 11, 7, 0, 3, 13, 1, 5, 1, 3, 160, 33, 4, 19, 13, 12, 2, 5, 1, 15, 1, 2, 0, 2, 4, 0, 0, 1, 0, 3, 1, 11, 4, 11, 39, 0, 16, 15, 12, 5, 14, 5, 6, 7, 5, 7, 6, 4, 3, 6, 4, 7, 2, 26, 4, 3, 4, 7];

export const LOVE_WORDS = [
  { lang: 'hbo', word: 'חֶסֶד', translit: 'ḥesed', gloss: 'loving devotion, steadfast love', strongs: 'H2617', n: 247 },
  { lang: 'grc', word: 'ἀγαπάω', translit: 'agapaō', gloss: 'to love', strongs: 'G25', n: 143 },
  { lang: 'grc', word: 'ἀγάπη', translit: 'agapē', gloss: 'love', strongs: 'G26', n: 116 },
  { lang: 'hbo', word: 'אָהַב', translit: 'ʾāhab', gloss: 'to love', strongs: 'H157', n: 215 },
  { lang: 'grc', word: 'φιλέω', translit: 'phileō', gloss: 'to love as a friend', strongs: 'G5368', n: 25 },
];

/* Results: text is BSB; [[...]] marks the match; `orig` is the word behind the match. */
export const LOVE_RESULTS = [
  { ref: 'John 3:16', book: 'JHN', text: 'For God so [[loved]] the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.', orig: 'ἠγάπησεν', lang: 'grc', strongs: 'G25' },
  { ref: '1 Corinthians 13:4', book: '1CO', text: '[[Love]] is patient, [[love]] is kind. It does not envy, it does not boast, it is not proud.', orig: 'ἀγάπη', lang: 'grc', strongs: 'G26' },
  { ref: 'Deuteronomy 6:5', book: 'DEU', text: 'And you shall [[love]] the LORD your God with all your heart and with all your soul and with all your strength.', orig: 'וְאָהַבְתָּ', lang: 'hbo', strongs: 'H157' },
  { ref: 'John 21:15', book: 'JHN', text: '“Simon son of John, do you [[love]] Me more than these?” “Yes, Lord,” he answered, “You know I [[love]] You.”', orig: 'ἀγαπᾷς · φιλῶ', lang: 'grc', strongs: 'G25 · G5368', note: 'Two different verbs behind one English word' },
  { ref: 'Psalm 136:1', book: 'PSA', text: 'Give thanks to the LORD, for He is good. His [[loving]] devotion endures forever.', orig: 'חַסְדּוֹ', lang: 'hbo', strongs: 'H2617' },
  { ref: '1 John 4:8', book: '1JN', text: 'Whoever does not [[love]] does not know God, because God is [[love]].', orig: 'ἀγαπῶν · ἀγάπη', lang: 'grc', strongs: 'G25 · G26' },
];

/* ----------------------------------------------------------------------------------------- */
/* Canon (names + chapter counts) for the passage picker                                     */
/* ----------------------------------------------------------------------------------------- */

export const BOOK_GROUPS = [
  { name: 'Law', t: 'OT', hue: 'emerald', books: [['GEN', 'Genesis', 50], ['EXO', 'Exodus', 40], ['LEV', 'Leviticus', 27], ['NUM', 'Numbers', 36], ['DEU', 'Deuteronomy', 34]] },
  { name: 'History', t: 'OT', hue: 'gold', books: [['JOS', 'Joshua', 24], ['JDG', 'Judges', 21], ['RUT', 'Ruth', 4], ['1SA', '1 Samuel', 31], ['2SA', '2 Samuel', 24], ['1KI', '1 Kings', 22], ['2KI', '2 Kings', 25], ['1CH', '1 Chronicles', 29], ['2CH', '2 Chronicles', 36], ['EZR', 'Ezra', 10], ['NEH', 'Nehemiah', 13], ['EST', 'Esther', 10]] },
  { name: 'Wisdom & Poetry', t: 'OT', hue: 'ruby', books: [['JOB', 'Job', 42], ['PSA', 'Psalms', 150], ['PRO', 'Proverbs', 31], ['ECC', 'Ecclesiastes', 12], ['SNG', 'Song of Songs', 8]] },
  { name: 'Prophets', t: 'OT', hue: 'violet', books: [['ISA', 'Isaiah', 66], ['JER', 'Jeremiah', 52], ['LAM', 'Lamentations', 5], ['EZK', 'Ezekiel', 48], ['DAN', 'Daniel', 12], ['HOS', 'Hosea', 14], ['JOL', 'Joel', 3], ['AMO', 'Amos', 9], ['OBA', 'Obadiah', 1], ['JON', 'Jonah', 4], ['MIC', 'Micah', 7], ['NAM', 'Nahum', 3], ['HAB', 'Habakkuk', 3], ['ZEP', 'Zephaniah', 3], ['HAG', 'Haggai', 2], ['ZEC', 'Zechariah', 14], ['MAL', 'Malachi', 4]] },
  { name: 'Gospels & Acts', t: 'NT', hue: 'lapis', books: [['MAT', 'Matthew', 28], ['MRK', 'Mark', 16], ['LUK', 'Luke', 24], ['JHN', 'John', 21], ['ACT', 'Acts', 28]] },
  { name: 'Letters', t: 'NT', hue: 'gold', books: [['ROM', 'Romans', 16], ['1CO', '1 Corinthians', 16], ['2CO', '2 Corinthians', 13], ['GAL', 'Galatians', 6], ['EPH', 'Ephesians', 6], ['PHP', 'Philippians', 4], ['COL', 'Colossians', 4], ['1TH', '1 Thessalonians', 5], ['2TH', '2 Thessalonians', 3], ['1TI', '1 Timothy', 6], ['2TI', '2 Timothy', 4], ['TIT', 'Titus', 3], ['PHM', 'Philemon', 1], ['HEB', 'Hebrews', 13], ['JAS', 'James', 5], ['1PE', '1 Peter', 5], ['2PE', '2 Peter', 3], ['1JN', '1 John', 5], ['2JN', '2 John', 1], ['3JN', '3 John', 1], ['JUD', 'Jude', 1]] },
  { name: 'Apocalypse', t: 'NT', hue: 'ruby', books: [['REV', 'Revelation', 22]] },
];

export const TRANSLATIONS = [
  { id: 'KJV', name: 'King James Version', year: '1611 / 1769', align: 'strongs', note: 'Strong’s-tagged · italics mark supplied words' },
  { id: 'BSB', name: 'Berean Standard Bible', year: '2022', align: 'manual', note: 'Hand-aligned word for word to the Greek & Hebrew' },
  { id: 'WEB', name: 'World English Bible', year: '2020', align: 'bridged', note: 'Modern public-domain English' },
  { id: 'ASV', name: 'American Standard Version', year: '1901', align: 'bridged', note: 'Formal, literal' },
  { id: 'YLT', name: 'Young’s Literal Translation', year: '1898', align: 'bridged', note: 'Hyper-literal, keeps Hebrew tenses' },
];
