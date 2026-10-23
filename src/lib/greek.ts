/**
 * Greek transliteration and Greek / Hebrew / transliteration folding for accent-insensitive search.
 * Framework-free, DOM-free (usable from the pipeline, the app and the search worker).
 */

const ROUGH = '̔';
const IOTA_SUB = 'ͅ';
const DIAERESIS = '̈';

const LETTERS: Record<string, string> = {
  α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'ē', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n',
  ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', ϲ: 's', τ: 't', υ: 'y', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'ō',
  ϝ: 'w', ϛ: 'st', ϙ: 'q', ϟ: 'q', ϡ: 'ss', ϳ: 'j', ϐ: 'b', ϑ: 'th', ϕ: 'ph', ϖ: 'p', ϰ: 'k', ϱ: 'r', ϵ: 'e',
};
const VOWELS = new Set(['α', 'ε', 'η', 'ι', 'ο', 'υ', 'ω']);
/** Vowels that combine with a following υ into a diphthong (αυ, ευ, ηυ, ου). */
const U_DIPHTHONG_FIRST = new Set(['α', 'ε', 'η', 'ο']);
/** Vowels that combine with a following ι into a diphthong (αι, ει, οι, υι). */
const I_DIPHTHONG_FIRST = new Set(['α', 'ε', 'ο', 'υ']);
const NASAL_BEFORE = new Set(['γ', 'κ', 'ξ', 'χ']);

/** How to render iota subscript (ᾳ ῃ ῳ). */
export type IotaSubscriptStyle =
  /** SBL academic style: ą ę̄ ǭ (default). */
  | 'subscript'
  /** Written out: ai ēi ōi. */
  | 'adscript'
  /** Dropped (it was silent in Koine): a ē ō. */
  | 'omit';

export interface TransliterateOptions {
  iotaSubscript?: IotaSubscriptStyle;
}

const SUBSCRIPT: Record<IotaSubscriptStyle, Record<string, string>> = {
  subscript: { α: 'ą', η: 'ę̄', ω: 'ǭ' },
  adscript: { α: 'ai', η: 'ēi', ω: 'ōi' },
  omit: { α: 'a', η: 'ē', ω: 'ō' },
};

interface GLetter {
  /** Lower-case base letter. */
  base: string;
  upper: boolean;
  rough: boolean;
  sub: boolean;
  diaeresis: boolean;
}

const isGreekBase = (ch: string) => /[Ͱ-Ͽἀ-῿]/.test(ch) && /\p{L}/u.test(ch);

/**
 * SBL-style transliteration of Greek text: λόγος -> logos, Ἰησοῦς -> Iēsous, ἀγάπη -> agapē,
 * ὁ -> ho, εὐαγγέλιον -> euangelion, ῥῆμα -> rhēma, υἱός -> huios, ἀρχῇ -> archę̄.
 *
 * θ th, φ ph, χ ch, ψ ps, η ē, ω ō; υ is y except in the diphthongs αυ ευ ηυ ου υι (u);
 * rough breathing -> h (placed before the whole diphthong: οὗτος -> houtos), initial ρ -> rh;
 * γγ ng, γκ nk, γξ nx, γχ nch; capitalisation preserved (all-caps words stay all-caps).
 * Non-Greek characters pass through; Greek ; and · become ? and ;.
 */
export function transliterate(greek: string, opts: TransliterateOptions = {}): string {
  const subMap = SUBSCRIPT[opts.iotaSubscript ?? 'subscript'];
  const chars = Array.from(greek.normalize('NFD'));
  let out = '';
  let word: GLetter[] = [];

  const flush = () => {
    if (word.length) out += transliterateWord(word, subMap);
    word = [];
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\p{M}/u.test(ch)) {
      const last = word[word.length - 1];
      if (last) {
        if (ch === ROUGH) last.rough = true;
        else if (ch === IOTA_SUB) last.sub = true;
        else if (ch === DIAERESIS) last.diaeresis = true;
        continue; // accents, smooth breathing, macron, breve: dropped
      }
      out += ch; // a mark on a non-Greek character (e.g. Latin "é"): keep it
      continue;
    }
    if (isGreekBase(ch)) {
      const lower = ch.toLowerCase();
      if (LETTERS[lower] === undefined) {
        flush();
        out += ch;
        continue;
      }
      word.push({ base: lower, upper: lower !== ch, rough: false, sub: false, diaeresis: false });
      continue;
    }
    flush();
    if (ch === ';') out += '?';
    else if (ch === '·' || ch === '·') out += ';';
    else if (ch === 'ʼ' || ch === '᾽' || ch === '᾿') out += '’';
    else out += ch;
  }
  flush();
  return out.normalize('NFC');
}

function transliterateWord(w: GLetter[], subMap: Record<string, string>): string {
  const allCaps = w.length > 1 && w.every((l) => l.upper);
  const parts: string[] = [];
  // Rough breathing on the first vowel, or on the second vowel of an initial diphthong.
  let initialH = false;
  if (VOWELS.has(w[0].base)) {
    if (w[0].rough) initialH = true;
    else if (w[1] && w[1].rough && isDiphthong(w[0], w[1])) initialH = true;
  }

  for (let i = 0; i < w.length; i++) {
    const l = w[i];
    const prev = w[i - 1];
    const next = w[i + 1];
    let t: string;
    if (l.sub && subMap[l.base] !== undefined) {
      t = subMap[l.base];
    } else if (l.base === 'υ') {
      const inDiphthong =
        (prev && U_DIPHTHONG_FIRST.has(prev.base) && !l.diaeresis && !prev.sub) ||
        (next && next.base === 'ι' && !next.diaeresis);
      t = inDiphthong ? 'u' : 'y';
    } else if (l.base === 'γ' && next && NASAL_BEFORE.has(next.base)) {
      t = 'n';
    } else if (l.base === 'ρ' && (l.rough || i === 0)) {
      t = 'rh';
    } else {
      t = LETTERS[l.base];
    }
    if (i === 0 && initialH) t = 'h' + t;
    if (l.upper && !allCaps) t = t.charAt(0).toUpperCase() + t.slice(1);
    parts.push(t);
  }
  const s = parts.join('');
  return allCaps ? s.toUpperCase() : s;
}

function isDiphthong(a: GLetter, b: GLetter): boolean {
  if (b.diaeresis || a.sub) return false;
  if (b.base === 'υ') return U_DIPHTHONG_FIRST.has(a.base);
  if (b.base === 'ι') return I_DIPHTHONG_FIRST.has(a.base);
  return false;
}

/* ------------------------------------------------------------------------ */
/* Folding for search                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Accent-insensitive Greek comparison key: strips every diacritic (accents, breathings, iota
 * subscript, diaeresis), lower-cases, and folds final / lunate sigma to σ. "Λόγος" -> "λογοσ".
 */
export function foldGreek(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ςϲ]/g, 'σ')
    .replace(/[ʼ᾽᾿’']/g, '')
    .normalize('NFC');
}

const HEBREW_FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

/**
 * Hebrew comparison key: strips niqqud, cantillation and other marks (incl. the CGJ used by the
 * WLC), drops paseq / sof pasuq / geresh, turns maqaf into a space, and normalises final letters
 * to their medial forms. "בְּרֵאשִׁ֖ית" -> "בראשית", "אֱלֹהִים" -> "אלהימ".
 */
export function foldHebrew(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/־/g, ' ')
    .replace(/[׀׃׆׳״‌‍‎‏]/g, '')
    .replace(/[ךםןףץ]/g, (c) => HEBREW_FINALS[c])
    .trim();
}

/**
 * Loose comparison key for transliterations, so that what people type matches the lexicon's
 * spelling: "kyrios" = "kurios", "agape" = "agapē", "dabar" = "davar", "elohiym" = "elohim",
 * "chesed" = "hesed", "Shabbat" = "shabat". Only for equality lookups — it is deliberately lossy.
 */
export function translitKey(s: string): string {
  let k = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ʾʿʼʻ'’‘`´·.\-\s]/g, '');
  k = k
    .replace(/iy/g, 'i')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/[ck]h/g, 'h')
    .replace(/sh/g, 's')
    .replace(/tz/g, 'ts')
    .replace(/ck/g, 'k')
    .replace(/[qc]/g, 'k')
    .replace(/w/g, 'v')
    .replace(/v/g, 'b')
    .replace(/y/g, 'u')
    .replace(/ł/g, 'l')
    .replace(/[^a-z]/g, '');
  return k.replace(/(.)\1+/g, '$1');
}

/** True if the string contains Greek letters. */
export function hasGreek(s: string): boolean {
  return /[Ͱ-Ͽἀ-῿]/.test(s);
}

/** True if the string contains Hebrew letters. */
export function hasHebrew(s: string): boolean {
  return /[֐-׿יִ-ﭏ]/.test(s);
}
