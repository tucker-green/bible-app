/**
 * English normalisation for the bridge aligner (shared: pipeline + browser).
 *
 * `lemma()` turns a surface word into a matching key so that different translations' forms of the
 * same word meet: case and punctuation are folded, archaic forms are modernised (thee -> you,
 * hath -> have, believeth / believest -> believe, spake -> speak), irregular verbs and plurals are
 * reduced to their base (gave -> give, brethren -> brother), and what is left goes through the
 * inflectional steps of the Porter2 (Snowball English) stemmer (loved / loving / loves -> love).
 * Keys are not dictionary words ("believ", "cri"); they only need to be consistent.
 */
import { foldWord } from '../tokenize';

/* ------------------------------------------------------------------------ */
/* Function words                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Closed-class words (articles, prepositions, conjunctions, pronouns, auxiliaries, negation) as
 * folded surface forms. Their links are only kept on strong evidence, and the evaluation reports
 * them separately from content words.
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  (
    'a an the of to in into on onto at by for from with within without unto upon toward towards ' +
    'through throughout among amongst between before after above below under over about against ' +
    'out up down off along beside besides near unto till until than then so as because since ' +
    'and or nor but yet if though although whether when whenever where wherever while whilst ' +
    'that this these those which who whom whose what whatever whoever whosoever whatsoever ' +
    'it its itself he him his himself she her hers herself they them their theirs themselves ' +
    'we us our ours ourselves you your yours yourself yourselves i me my mine myself ' +
    'thee thou thy thine thyself ye ' +
    'is are was were be been being am art wast wert ' +
    'have has had having hath hast hadst ' +
    'do does did doing doth dost didst done ' +
    'shall will should would may might can could must shalt wilt shouldest wouldest mayest ' +
    'mightest canst couldest ' +
    'not no there here also even very too just now let'
  ).split(/\s+/),
);

/** True for a closed-class word (case-insensitive). */
export function isFunctionWord(word: string): boolean {
  return FUNCTION_WORDS.has(foldWord(word));
}

/**
 * Word classes used by the bridge aligner's linking policy:
 *  det   the / a / an                       -> only the article that belongs to the next content word
 *  poss  his / my / their …                 -> pronoun or suffix of the next content word
 *  obj   him / them / me …                  -> pronoun or suffix of the previous content word
 *  subj  he / they / I …                    -> only on direct evidence
 *  prep  in / of / to …                     -> direct evidence, else the prefix of the next content word
 *  conj  and / but / that …                 -> direct evidence, else the conjunction prefix of the next word
 *  aux   shall / will / may …               -> direct evidence, else the verb that follows
 *  cop   is / was / be …                    -> direct evidence only
 *  other not / there / also …               -> direct evidence only
 *  content                                  -> everything else
 */
export type WordClass = 'det' | 'poss' | 'obj' | 'subj' | 'prep' | 'conj' | 'aux' | 'cop' | 'other' | 'content';

const CLASS_OF = new Map<string, WordClass>();
for (const [cls, list] of [
  ['det', 'the a an'],
  ['poss', 'his her its their my our your thy thine mine'],
  ['obj', 'him them me us thee it'],
  ['subj', 'he she they i we thou ye you'],
  [
    'prep',
    'of to in into on onto at by for from with within without unto upon toward towards through throughout ' +
      'among amongst between before after above below under over about against out up down off along beside besides near',
  ],
  ['conj', 'and or nor but yet if though although whether when whenever where wherever while whilst because since than as so that'],
  ['aux', 'shall will should would may might can could must shalt wilt shouldest wouldest mayest mightest canst couldest let'],
  ['cop', 'is are was were be been being am art wast wert'],
] as [WordClass, string][]) {
  for (const w of list.split(/\s+/)) CLASS_OF.set(w, cls);
}

/** The aligner's class of a word (case-insensitive). */
export function wordClass(word: string): WordClass {
  const f = foldWord(word);
  return CLASS_OF.get(f) ?? (FUNCTION_WORDS.has(f) ? 'other' : 'content');
}

/* ------------------------------------------------------------------------ */
/* Irregular / archaic forms                                                 */
/* ------------------------------------------------------------------------ */

/** Surface form (folded) -> base form. Applied before stemming. */
const IRREGULAR: Record<string, string> = Object.create(null) as Record<string, string>;

/** "base: form form form; base: ..." */
function addIrregular(spec: string): void {
  for (const group of spec.split(';')) {
    const [base, forms] = group.split(':').map((s) => s.trim());
    if (!base || !forms) continue;
    for (const f of forms.split(/\s+/)) IRREGULAR[f] = base;
  }
}

// Archaic pronouns, verb forms and spellings (KJV / ASV / YLT / Darby style).
addIrregular(`
  you: thee thou ye yourselves yourself thyself;
  your: thy thine yours;
  my: mine;
  be: art wast wert am is are was were been being beest;
  have: hath hast hadst has had having;
  do: doth dost didst does did doest doeth done doing;
  say: saith sayest saidst said;
  shall: shalt;
  will: wilt;
  can: canst;
  could: couldest couldst;
  would: wouldest wouldst;
  should: shouldest shouldst;
  may: mayest mayst;
  might: mightest mightst;
  must: mought;
  to: unto;
  on: upon;
  show: shew shewed shewn sheweth shewest shewing shews showed shown;
  speak: spake spoke spoken spakest;
  break: brake broke broken brakest;
  bear: bare bore borne born barest;
  swear: sware swore sworn swarest;
  get: gat got gotten;
  cleave: clave cleft;
  drive: drave drove driven;
  tear: tare tore torn;
  beget: begat begot begotten;
  forsake: forsook forsaken forsookest;
  slay: slew slain slewest;
  smite: smote smitten smotest;
  bid: bade bidden;
  eat: ate eaten;
  thrust: thrust;
  lord: yahweh jehovah jah yhwh;
  god: elohim;
  holy: hallowed;
  sabbath: sabbaths;
  saint: holy-one;
  ox: oxen;
  man: men;
  woman: women;
  child: children;
  brother: brethren;
  foot: feet;
  tooth: teeth;
  mouse: mice;
  goose: geese;
  louse: lice;
  die: dying died dieth diest;
  lie: lying lay lain lieth liest;
  tie: tying;
`);

// Common irregular verbs: base: past and participle forms.
addIrregular(`
  arise: arose arisen; awake: awoke awaked awoken; be: was; beat: beaten; become: became;
  begin: began begun; behold: beheld; bend: bent; bereave: bereft; beseech: besought;
  bind: bound; bite: bit bitten; bleed: bled; blow: blew blown; breed: bred; bring: brought;
  build: built; burn: burnt; buy: bought; catch: caught; choose: chose chosen; cling: clung;
  come: came; creep: crept; cut: cut; deal: dealt; dig: dug digged; draw: drew drawn;
  dream: dreamt; drink: drank drunk drunken; dwell: dwelt; fall: fell fallen; feed: fed;
  feel: felt; fight: fought; find: found; flee: fled; fling: flung; fly: flew flown;
  forbid: forbade forbidden; forget: forgot forgotten; forgive: forgave forgiven; freeze: froze frozen;
  give: gave given; go: went gone goest goeth; grind: ground; grow: grew grown; hang: hung hanged;
  hear: heard; hew: hewn; hide: hid hidden; hit: hit; hold: held; hurt: hurt; keep: kept;
  kneel: knelt; know: knew known; lade: laden; lay: laid; lead: led; lean: leant; leap: leapt;
  learn: learnt; leave: left; lend: lent; light: lit; lose: lost; make: made; mean: meant;
  meet: met; mistake: mistook mistaken; overcome: overcame; overtake: overtook overtaken;
  overthrow: overthrew overthrown; pay: paid; put: put; read: read; rend: rent; rid: rid;
  ride: rode ridden; ring: rang rung; rise: rose risen; run: ran; see: saw seen seest seeth;
  seek: sought; sell: sold; send: sent; set: set; shake: shook shaken; shine: shone;
  shoot: shot; shrink: shrank shrunk; shut: shut; sing: sang sung; sink: sank sunk; sit: sat;
  sleep: slept; slide: slid; sling: slung; sow: sown; speed: sped; spend: spent; spin: spun;
  spit: spat; spread: spread; spring: sprang sprung; stand: stood; steal: stole stolen;
  stick: stuck; sting: stung; stink: stank; stride: strode; strike: struck stricken;
  strive: strove striven; swim: swam swum; swing: swung; take: took taken; teach: taught;
  tell: told; think: thought; throw: threw thrown; tread: trod trodden; understand: understood;
  undertake: undertook; wake: woke woken; wear: wore worn; weave: wove woven; weep: wept;
  win: won; wind: wound; withdraw: withdrew withdrawn; withhold: withheld; withstand: withstood;
  wring: wrung; write: wrote written; abide: abode; shear: shorn; stride: stridden;
  flee: fleeth fleest; agree: agreeth; foresee: foresaw foreseen;
`);

/** -eth words that are not verbs (names, ordinals, nouns), folded. */
const ETH_NOT_VERB = new Set(
  (
    'teeth beth teth seth sheth heth japheth jetheth hazarmaveth azmaveth peleth shallecheth zereth ' +
    'alemeth hammoleketh alameth zoheleth ashtoreth hareth meshullemeth topheth tanhumeth ' +
    'jerubbesheth mephibosheth ishbosheth nazareth chinnereth tebeth sophereth pochereth zareth ' +
    'dabbasheth remeth shibboleth sibboleth harosheth elisabeth elizabeth moresheth mispereth ' +
    'twentieth thirtieth fortieth fiftieth sixtieth seventieth eightieth ninetieth bosheth ' +
    'kenath jabneel gath shibboleth meth'
  ).split(/\s+/),
);

/** -est words that are not second-person verbs (nouns, adverbs, superlatives), folded. */
const EST_NOT_VERB = new Set(
  (
    'priest rest lest west harvest manifest forest best greatest request tempest highest nest ' +
    'eldest youngest lowest chiefest earnest honest chest wrest holiest protest fairest smallest ' +
    'goodliest fattest basest dishonest choicest finest mightiest modest poorest hottest straitest ' +
    'detest fewest closest valiantest guest fastest lightest strongest vilest stillest midst ' +
    'interest conquest behest test quest crest jest zest vest arrest contest unrest bequest ' +
    'largest least latest longest nearest oldest richest sweetest wisest worst utmost uttermost ' +
    'innermost highest deepest dearest feeblest hardest humblest meekest purest proudest ' +
    'surest truest weakest widest wildest wickedest holiest loftiest lowliest noblest ' +
    'everest forest priest high-priest chief-priest'
  ).split(/\s+/),
);

/* ------------------------------------------------------------------------ */
/* Porter2 inflectional steps                                                */
/* ------------------------------------------------------------------------ */

const isVowel = (c: string | undefined) => c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u' || c === 'y';

/** Start of R1 / R2 (Porter2 definitions) in a word with 'Y' marking consonantal y. */
function regions(w: string): [number, number] {
  // The region after the first non-vowel that follows a vowel, searching from `from`.
  const after = (from: number) => {
    for (let i = Math.max(1, from + 1); i < w.length; i++) if (!isVowel(w[i]) && isVowel(w[i - 1])) return i + 1;
    return w.length;
  };
  const m = /^(gener|commun|arsen)/.exec(w);
  const r1 = m ? m[0].length : after(0);
  return [r1, after(r1)];
}

/** Ends in a short syllable (Porter2): (non-vowel)(vowel)(non-vowel except w, x, Y), or (vowel)(non-vowel) at the start. */
function endsShortSyllable(w: string): boolean {
  const n = w.length;
  if (n === 2) return isVowel(w[0]) && !isVowel(w[1]);
  if (n < 3) return false;
  const a = w[n - 3];
  const b = w[n - 2];
  const c = w[n - 1];
  return !isVowel(a) && isVowel(b) && !isVowel(c) && c !== 'w' && c !== 'x' && c !== 'Y';
}

const DOUBLES = new Set(['bb', 'dd', 'ff', 'gg', 'mm', 'nn', 'pp', 'rr', 'tt']);
const STEM_EXCEPTIONS: Record<string, string> = {
  skis: 'ski',
  skies: 'sky',
  dying: 'die',
  lying: 'lie',
  tying: 'tie',
  news: 'news',
  only: 'only',
  early: 'early',
  sky: 'sky',
  atlas: 'atlas',
  cosmos: 'cosmos',
  bias: 'bias',
  'one-and-only': 'one-and-only',
};
const INVARIANT_1A = new Set(['inning', 'outing', 'canning', 'herring', 'earring', 'proceed', 'exceed', 'succeed']);

/**
 * Inflectional stemming: Porter2 steps 0, 1a, 1b, 1c and 5 (no derivational steps), so that
 * "love loves loved loving" -> "love", "believe believed believes" -> "believ", "cries cried cry" -> "cri".
 */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 2) return w;
  if (STEM_EXCEPTIONS[w]) return STEM_EXCEPTIONS[w];
  if (w[0] === "'") w = w.slice(1);
  // Mark consonantal y.
  w = w.replace(/^y/, 'Y').replace(/([aeiouy])y/g, '$1Y');
  let [r1, r2] = regions(w);

  // Step 0: possessive.
  w = w.replace(/'s'$|'s$|'$/, '');

  // Step 1a.
  if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ied') || w.endsWith('ies')) w = w.length > 4 ? w.slice(0, -2) : w.slice(0, -1);
  else if (w.endsWith('us') || w.endsWith('ss')) {
    /* unchanged */
  } else if (w.endsWith('s') && w.length > 2 && /[aeiouy]/.test(w.slice(0, -2))) w = w.slice(0, -1);

  if (INVARIANT_1A.has(w)) return w.replace(/Y/g, 'y');
  [r1, r2] = regions(w);

  // Step 1b.
  const m1b = /(eedly|eed|ingly|edly|ing|ed)$/.exec(w);
  if (m1b) {
    const suf = m1b[1];
    const start = w.length - suf.length;
    if (suf === 'eed' || suf === 'eedly') {
      if (start >= r1) w = w.slice(0, start) + 'ee';
    } else {
      const pre = w.slice(0, start);
      if (/[aeiouy]/.test(pre)) {
        w = pre;
        [r1, r2] = regions(w);
        if (/(at|bl|iz)$/.test(w)) w += 'e';
        else if (DOUBLES.has(w.slice(-2))) w = w.slice(0, -1);
        else if (r1 >= w.length && endsShortSyllable(w)) w += 'e';
      }
    }
  }

  // Step 1c.
  if (/[yY]$/.test(w) && w.length > 2 && !isVowel(w[w.length - 2])) w = w.slice(0, -1) + 'i';

  // Step 5.
  [r1, r2] = regions(w);
  if (w.endsWith('e')) {
    const at = w.length - 1;
    if (at >= r2 || (at >= r1 && !endsShortSyllable(w.slice(0, -1)))) w = w.slice(0, -1);
  } else if (w.endsWith('ll') && w.length - 1 >= r2) w = w.slice(0, -1);

  return w.replace(/Y/g, 'y');
}

/* ------------------------------------------------------------------------ */
/* Lemma                                                                     */
/* ------------------------------------------------------------------------ */

/** Context for the -est rule: is "thou" within a couple of words of this one? */
export interface LemmaContext {
  /** Folded previous words (nearest last) and next words (nearest first); only "thou" is looked for. */
  thouNearby?: boolean;
}

/** Modernise an archaic verb ending; returns undefined when the word is not one. */
function modernise(w: string, ctx: LemmaContext | undefined): string | undefined {
  // -eth: believeth -> believe(d) form; seeth -> see.
  if (w.length > 4 && w.endsWith('eth') && !ETH_NOT_VERB.has(w) && !w.includes('-')) {
    if (w.endsWith('eeth')) return w.slice(0, -2);
    const base = w.slice(0, -3);
    if (IRREGULAR[base + 'e']) return base + 'e';
    return base + 'ed';
  }
  // -edst: lovedst -> loved
  if (w.length > 5 && w.endsWith('edst')) return w.slice(0, -2);
  // -est (2nd person singular), only next to "thou" and not a known noun / superlative.
  if (w.length > 4 && w.endsWith('est') && !EST_NOT_VERB.has(w) && ctx?.thouNearby) {
    if (w.endsWith('eest')) return w.slice(0, -2);
    const base = w.slice(0, -3);
    for (const cand of [base, base + 'e']) if (IRREGULAR[cand]) return cand;
    return base + 'ed';
  }
  return undefined;
}

/**
 * Matching key for an English word: folded, archaic forms modernised, irregular forms reduced,
 * then inflectionally stemmed. Pure and deterministic; the pipeline and the browser must agree.
 */
export function lemma(word: string, ctx?: LemmaContext): string {
  const key = ctx?.thouNearby ? word + '\u0001' : word;
  let l = LEMMA_CACHE.get(key);
  if (l === undefined) {
    if (LEMMA_CACHE.size >= LEMMA_CACHE_MAX) LEMMA_CACHE.clear();
    LEMMA_CACHE.set(key, (l = computeLemma(word, ctx)));
  }
  return l;
}

/** Memo for `lemma` (pure); bounded so a long browser session cannot grow it without limit. */
const LEMMA_CACHE = new Map<string, string>();
const LEMMA_CACHE_MAX = 100_000;

function computeLemma(word: string, ctx?: LemmaContext): string {
  let w = foldWord(word).replace(/[‑–]/g, '-');
  if (!w) return w;
  const irr = IRREGULAR[w];
  if (irr) return stem(irr);
  const mod = modernise(w, ctx);
  if (mod !== undefined) {
    w = mod;
    const irr2 = IRREGULAR[w];
    if (irr2) return stem(irr2);
  }
  // Hyphenated compounds: stem the last part ("seed-bearing" -> "seed-bear").
  const dash = w.lastIndexOf('-');
  if (dash > 0 && dash < w.length - 1) {
    const last = w.slice(dash + 1);
    return w.slice(0, dash + 1) + stem(IRREGULAR[last] ?? last);
  }
  return stem(w);
}

/** Lemmas for a sequence of words, applying the "thou" context rule for -est verbs. */
export function lemmas(words: readonly string[]): string[] {
  const folded = words.map((w) => foldWord(w));
  return words.map((w, i) => {
    let thou = false;
    for (let k = Math.max(0, i - 3); k <= Math.min(words.length - 1, i + 2) && !thou; k++) thou = k !== i && folded[k] === 'thou';
    return lemma(w, { thouNearby: thou });
  });
}

/**
 * Can an English function word of this class render a Hebrew bound morpheme with this (OSHB-style)
 * morphology code? det: the article (Td) or a preposition with the article fused in (Rd);
 * poss / obj: a pronominal suffix (S…); prep: a prepositional prefix (R…); conj: the conjunction
 * prefix (C) or a prepositional prefix used as one (כְּ "as / when", בְּ "when"). Subject pronouns,
 * copulas and auxiliaries have no morpheme of their own (they are part of the verb).
 */
export function fitsMorpheme(cls: WordClass, morph: string): boolean {
  switch (cls) {
    case 'det':
      return /^Td/.test(morph) || /^R.*d$/.test(morph);
    case 'poss':
    case 'obj':
      return morph.startsWith('S');
    case 'prep':
      return morph.startsWith('R');
    case 'conj':
      return morph.startsWith('C') || morph.startsWith('R');
    default:
      return false;
  }
}
