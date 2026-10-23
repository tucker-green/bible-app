/**
 * Full-text search over a SearchCorpus (public/data/search/{TR}.json), with Strong's-number and
 * Greek/Hebrew-lemma queries answered through the concordance. Runs inside a Web Worker
 * (worker.ts) but is plain TypeScript with injected loaders, so it is unit-tested directly.
 *
 * Index (built lazily, once per translation, ~0.3 s for 31k verses):
 *   - every verse tokenised like src/lib/tokenize.ts and folded with foldWord
 *     (case-, accent- and possessive-insensitive); hyphenated compounds are also indexed by part;
 *   - term -> sorted Int32Array of verse indices (postings);
 *   - the term-id sequence of every verse (for phrases, term frequency and highlighting).
 * Sets are sorted Int32Arrays; AND = intersection, OR = union, NOT = difference.
 */
import { getBook, getBookByNum } from '../books';
import type { BookId, LexIndex, SearchCorpus } from '../types';
import { packRef } from '../types';
import { foldWord } from '../tokenize';
import { foldGreek, foldHebrew, transliterate, translitKey } from '../greek';
import { allowedBooks, parseQuery, positiveLeaves } from './query';
import type { ParsedQuery, QueryNode } from './query';

/* ------------------------------------------------------------------------ */
/* Public types                                                              */
/* ------------------------------------------------------------------------ */

export interface SearchOptions {
  /** Translation id whose corpus to search, e.g. "BSB". */
  tr: string;
  testament?: 'OT' | 'NT';
  /** Restrict to one book (USFM id or number). */
  book?: BookId | number;
  /** Page size (default 50, max 1000). */
  limit?: number;
  /** Page start (default 0). */
  offset?: number;
  /** 'canonical' (default): Bible order. 'relevance': BM25-style score, ties in Bible order. */
  sort?: 'canonical' | 'relevance';
  /** Treat every plain word as `word~` (all forms). */
  forms?: boolean;
}

export interface SearchHit {
  bookNum: number;
  book: BookId;
  chapter: number;
  verse: number;
  text: string;
  /** [start, end) character offsets in `text` of matched words / phrases, sorted, non-overlapping. */
  highlights: [number, number][];
  /** Relevance score (only with sort: 'relevance'). */
  score?: number;
}

export interface SearchSuggestion {
  /** A query to run instead. */
  query: string;
  /** Why, e.g. "Greek λόγος (logos, “word”) — G3056". */
  label: string;
}

export interface SearchResponse {
  query: string;
  tr: string;
  /** Matches after book / testament filters. */
  total: number;
  /** Matches before book / testament filters (what byBook counts). */
  totalAll: number;
  results: SearchHit[];
  /** bookNum -> number of matching verses, ignoring the book / testament filters (for a book facet). */
  byBook: Record<number, number>;
  /** Plain-language reading of the query, e.g. “love” and (“faith” or “hope”), in John. */
  interpreted: string;
  /** Folded English terms searched (positive only), for client-side highlighting. */
  terms: string[];
  /** Strong's ids searched (from Strong's or lemma queries), for highlighting linked words. */
  strongs: string[];
  suggestions: SearchSuggestion[];
  /** Query problems (unknown book, unclosed parenthesis…); results are still returned. */
  errors: string[];
  elapsedMs: number;
}

export interface EngineDeps {
  loadCorpus(tr: string): Promise<SearchCorpus>;
  /** Packed verse refs (bookNum*1e6 + chapter*1e3 + verse) where a Strong's id occurs. */
  loadConcordance(id: string): Promise<number[]>;
  loadLexIndex(): Promise<LexIndex>;
}

/** Messages between client.ts and worker.ts. */
export type WorkerRequest =
  | { id: number; type: 'init'; dataBase: string }
  | { id: number; type: 'search'; query: string; opts: SearchOptions }
  | { id: number; type: 'warm'; tr: string };

export type WorkerResponse = { id: number; ok: true; result: SearchResponse | null } | { id: number; ok: false; error: string };

/* ------------------------------------------------------------------------ */
/* Tokenising                                                                */
/* ------------------------------------------------------------------------ */

/** Same word pattern as src/lib/tokenize.ts (kept in sync; duplicated for speed). */
const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’‑-][\p{L}\p{M}\p{N}]+)*(?:['’](?=\s|$|[^\p{L}\p{N}]))?/gu;

/* ------------------------------------------------------------------------ */
/* Verse sets                                                                */
/* ------------------------------------------------------------------------ */

type VSet = Int32Array;
const EMPTY: VSet = new Int32Array(0);

function intersect(a: VSet, b: VSet): VSet {
  if (a.length > b.length) [a, b] = [b, a];
  const out = new Int32Array(a.length);
  let n = 0;
  let j = 0;
  for (let i = 0; i < a.length && j < b.length; i++) {
    const x = a[i];
    // galloping would help for very skewed sizes; linear is fine at 31k verses
    while (j < b.length && b[j] < x) j++;
    if (j < b.length && b[j] === x) out[n++] = x;
  }
  return out.subarray(0, n);
}

function difference(a: VSet, b: VSet): VSet {
  const out = new Int32Array(a.length);
  let n = 0;
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    while (j < b.length && b[j] < x) j++;
    if (j >= b.length || b[j] !== x) out[n++] = x;
  }
  return out.subarray(0, n);
}

/* ------------------------------------------------------------------------ */
/* Word forms                                                                */
/* ------------------------------------------------------------------------ */

/** Irregular forms (including KJV archaic ones). The first entry is the base. */
const IRREGULAR: string[][] = [
  ['be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'wast', 'wert'],
  ['have', 'has', 'had', 'having', 'hath', 'hast', 'hadst'],
  ['do', 'does', 'did', 'done', 'doing', 'doeth', 'doth', 'dost', 'didst'],
  ['go', 'goes', 'went', 'gone', 'going', 'goeth', 'goest', 'wentest'],
  ['come', 'comes', 'came', 'coming', 'cometh', 'comest', 'camest'],
  ['say', 'says', 'said', 'saying', 'saith', 'sayest', 'sayeth', 'saidst'],
  ['see', 'sees', 'saw', 'seen', 'seeing', 'seeth', 'seest', 'sawest'],
  ['give', 'gives', 'gave', 'given', 'giving', 'giveth', 'givest', 'gavest'],
  ['take', 'takes', 'took', 'taken', 'taking', 'taketh', 'takest', 'tookest'],
  ['know', 'knows', 'knew', 'known', 'knowing', 'knoweth', 'knowest', 'knewest'],
  ['speak', 'speaks', 'spoke', 'spake', 'spoken', 'speaking', 'speaketh', 'speakest'],
  ['eat', 'eats', 'ate', 'eaten', 'eating', 'eateth', 'eatest'],
  ['bring', 'brings', 'brought', 'bringing', 'bringeth', 'bringest', 'broughtest'],
  ['make', 'makes', 'made', 'making', 'maketh', 'makest', 'madest'],
  ['find', 'finds', 'found', 'finding', 'findeth', 'findest'],
  ['tell', 'tells', 'told', 'telling', 'telleth'],
  ['hear', 'hears', 'heard', 'hearing', 'heareth', 'hearest', 'heardest'],
  ['send', 'sends', 'sent', 'sending', 'sendeth', 'sentest'],
  ['stand', 'stands', 'stood', 'standing', 'standeth', 'standest'],
  ['sit', 'sits', 'sat', 'sitting', 'sitteth', 'sittest'],
  ['rise', 'rises', 'rose', 'risen', 'rising', 'riseth'],
  ['arise', 'arises', 'arose', 'arisen', 'arising', 'ariseth'],
  ['fall', 'falls', 'fell', 'fallen', 'falling', 'falleth'],
  ['run', 'runs', 'ran', 'running', 'runneth'],
  ['write', 'writes', 'wrote', 'written', 'writing', 'writeth'],
  ['begin', 'begins', 'began', 'begun', 'beginning'],
  ['bear', 'bears', 'bore', 'bare', 'born', 'borne', 'bearing', 'beareth'],
  ['beget', 'begets', 'begat', 'begot', 'begotten', 'begetting', 'begetteth'],
  ['build', 'builds', 'built', 'building', 'buildeth', 'buildest'],
  ['buy', 'buys', 'bought', 'buying', 'buyeth'],
  ['sell', 'sells', 'sold', 'selling', 'selleth'],
  ['seek', 'seeks', 'sought', 'seeking', 'seeketh', 'seekest'],
  ['teach', 'teaches', 'taught', 'teaching', 'teacheth', 'teachest'],
  ['think', 'thinks', 'thought', 'thinking', 'thinketh', 'thinkest'],
  ['keep', 'keeps', 'kept', 'keeping', 'keepeth', 'keepest'],
  ['leave', 'leaves', 'left', 'leaving', 'leaveth'],
  ['lead', 'leads', 'led', 'leading', 'leadeth'],
  ['hold', 'holds', 'held', 'holding', 'holdeth'],
  ['lie', 'lies', 'lay', 'lain', 'lying', 'lieth', 'liest', 'lied'],
  ['die', 'dies', 'died', 'dying', 'dieth'],
  ['use', 'uses', 'used', 'using', 'useth'],
  ['owe', 'owes', 'owed', 'owing', 'oweth'],
  ['tie', 'ties', 'tied', 'tying'],
  ['hoe', 'hoes', 'hoed'],
  ['fly', 'flies', 'flew', 'flown', 'flying', 'flieth'],
  ['sing', 'sings', 'sang', 'sung', 'singing', 'singeth'],
  ['drink', 'drinks', 'drank', 'drunk', 'drinking', 'drinketh'],
  ['sleep', 'sleeps', 'slept', 'sleeping', 'sleepeth', 'sleepest'],
  ['weep', 'weeps', 'wept', 'weeping', 'weepeth', 'weepest'],
  ['smite', 'smites', 'smote', 'smitten', 'smiting', 'smiteth'],
  ['slay', 'slays', 'slew', 'slain', 'slaying', 'slayeth'],
  ['choose', 'chooses', 'chose', 'chosen', 'choosing', 'chooseth'],
  ['forgive', 'forgives', 'forgave', 'forgiven', 'forgiving', 'forgiveth'],
  ['shine', 'shines', 'shone', 'shined', 'shining', 'shineth'],
  ['draw', 'draws', 'drew', 'drawn', 'drawing', 'draweth'],
  ['grow', 'grows', 'grew', 'grown', 'growing', 'groweth'],
  ['throw', 'throws', 'threw', 'thrown', 'throwing'],
  ['swear', 'swears', 'swore', 'sware', 'sworn', 'swearing', 'sweareth'],
  ['strike', 'strikes', 'struck', 'stricken', 'striking', 'striketh'],
  ['hide', 'hides', 'hid', 'hidden', 'hiding', 'hideth', 'hidest'],
  ['feed', 'feeds', 'fed', 'feeding', 'feedeth'],
  ['flee', 'flees', 'fled', 'fleeing', 'fleeth'],
  ['meet', 'meets', 'met', 'meeting', 'meeteth'],
  ['pay', 'pays', 'paid', 'paying', 'payeth'],
  ['lay', 'lays', 'laid', 'laying', 'layeth', 'laidst'],
  ['fight', 'fights', 'fought', 'fighting', 'fighteth'],
  ['catch', 'catches', 'caught', 'catching', 'catcheth'],
  ['shake', 'shakes', 'shook', 'shaken', 'shaking', 'shaketh'],
  ['forsake', 'forsakes', 'forsook', 'forsaken', 'forsaking', 'forsaketh'],
  ['awake', 'awakes', 'awoke', 'awaked', 'awaking', 'awaketh'],
  ['wake', 'wakes', 'woke', 'woken', 'waking', 'waketh'],
  ['win', 'wins', 'won', 'winning'],
  ['lose', 'loses', 'lost', 'losing', 'loseth'],
  ['spend', 'spends', 'spent', 'spending', 'spendeth'],
  ['dwell', 'dwells', 'dwelt', 'dwelled', 'dwelling', 'dwelleth', 'dwellest'],
  ['man', 'men'],
  ['woman', 'women'],
  ['child', 'children'],
  ['brother', 'brothers', 'brethren'],
  ['ox', 'oxen'],
  ['foot', 'feet'],
  ['tooth', 'teeth'],
  ['mouse', 'mice'],
  ['goose', 'geese'],
  ['life', 'lives'],
  ['wife', 'wives'],
  ['knife', 'knives'],
  ['leaf', 'leaves'],
  ['loaf', 'loaves'],
  ['thief', 'thieves'],
  ['wolf', 'wolves'],
  ['calf', 'calves'],
  ['half', 'halves'],
  ['sheaf', 'sheaves'],
  ['shelf', 'shelves'],
];
const IRREGULAR_OF = new Map<string, string[]>();
for (const g of IRREGULAR) for (const w of g) IRREGULAR_OF.set(w, g);

/** Function words never pulled in as a "form" of something else (forest~ must not find "for"). */
const STOP = new Set(
  'a an and are as at be but by even for from he her him his i in is it its me my no not of on or our she so than that the their them then there they this to us was we were what when which who will with ye you your thee thou thy hast hath'.split(
    ' ',
  ),
);

const VOWEL = /[aeiou]/;

function inflect(base: string, out: Set<string>): void {
  out.add(base);
  const last = base[base.length - 1];
  if (last === 'e') {
    out.add(`${base}s`);
    // Short e-words are too ambiguous for suffix rules (see+d = "seed", th+ing = "thing"); the
    // irregular table covers the real ones (see, die, lie, use…).
    if (base.length < 4) return;
    const stem = base.slice(0, -1);
    for (const s of ['d', 'th', 'st', 'dst']) out.add(base + s);
    for (const s of ['ing', 'eth', 'est', 'ed']) out.add(stem + s);
  } else if (last === 'y' && base.length > 2 && !VOWEL.test(base[base.length - 2])) {
    const stem = base.slice(0, -1);
    for (const s of ['ies', 'ied', 'ieth', 'iest', 'iedst']) out.add(stem + s);
    out.add(`${base}ing`);
  } else {
    for (const s of ['s', 'ing', 'eth', 'est', 'ed']) out.add(base + s);
    if (/(s|x|z|ch|sh)$/.test(base)) out.add(`${base}es`);
    out.add(`${base}edst`);
    // stop -> stopped / stopping (consonant-vowel-consonant ending)
    if (base.length >= 3 && /[^aeiou][aeiou][bdgklmnprt]$/.test(base)) {
      for (const s of ['ed', 'ing', 'eth', 'est']) out.add(base + last + s);
    }
  }
}

/** Possible base words an inflected form may come from (each at least 3 letters, or 4 for -est/-eth). */
function deinflect(w: string): string[] {
  const out: string[] = [];
  const add = (b: string, min = 3) => {
    if (b.length >= min) out.push(b);
  };
  if (/ies$/.test(w)) add(`${w.slice(0, -3)}y`);
  if (/ied$/.test(w)) add(`${w.slice(0, -3)}y`);
  if (/ie(th|st)$/.test(w)) add(`${w.slice(0, -4)}y`);
  if (/ing$/.test(w)) {
    const s = w.slice(0, -3);
    add(s);
    add(`${s}e`, 4);
    if (/(.)\1$/.test(s)) add(s.slice(0, -1));
  }
  if (/edst$/.test(w)) add(w.slice(0, -4));
  if (/ed$/.test(w)) {
    const s = w.slice(0, -2);
    add(s);
    add(`${s}e`, 4);
    if (/(.)\1$/.test(s)) add(s.slice(0, -1));
  }
  if (/(eth|est)$/.test(w)) {
    const s = w.slice(0, -3);
    add(s, 4);
    add(`${s}e`, 4);
    if (/(.)\1$/.test(s)) add(s.slice(0, -1), 4);
  }
  if (/es$/.test(w)) add(w.slice(0, -2));
  if (/[^s]s$/.test(w)) add(w.slice(0, -1));
  return out;
}

/**
 * Forms of a word that occur in the corpus: inflections (-s, -ed, -ing, KJV -eth/-est…) of the
 * word or of the bases it may be inflected from, plus irregular forms (go~ -> went, gone).
 */
export function wordForms(term: string, has: (t: string) => boolean): string[] {
  const cands = new Set<string>();
  const irregular = IRREGULAR_OF.get(term);
  if (irregular) for (const w of irregular) cands.add(w);
  else if (STOP.has(term)) return has(term) ? [term] : [];
  inflect(term, cands);
  const irregularForms = new Set(irregular ?? []);
  for (const b of deinflect(term)) {
    const irr = IRREGULAR_OF.get(b);
    if (irr) for (const w of irr) irregularForms.add(w);
    // A base only counts if it is a corpus word itself or the term really is one of its inflections.
    const forms = new Set<string>();
    inflect(b, forms);
    if (forms.has(term)) for (const f of forms) cands.add(f);
  }
  const out: string[] = [];
  for (const c of irregularForms) cands.add(c);
  for (const c of cands) if ((c === term || irregularForms.has(c) || !STOP.has(c)) && has(c)) out.push(c);
  if (!out.includes(term) && has(term)) out.unshift(term);
  return out.sort((a, b) => (a === term ? -1 : b === term ? 1 : a.length - b.length || a.localeCompare(b)));
}

/* ------------------------------------------------------------------------ */
/* Corpus index                                                              */
/* ------------------------------------------------------------------------ */

export class CorpusIndex {
  readonly tr: string;
  readonly verses: SearchCorpus['verses'];
  readonly size: number;
  /** term -> id */
  readonly termIds = new Map<string, number>();
  /** id -> term */
  readonly terms: string[] = [];
  /** id -> sorted verse indices */
  postings: Int32Array[] = [];
  /** Term ids of every token, verse after verse. */
  tokIds: Int32Array;
  /** tokIds offsets: verse i spans [tokStart[i], tokStart[i+1]). */
  tokStart: Int32Array;
  /** Compound term id -> its part ids ("seed-bearing" -> seed, bearing). */
  readonly partsOf = new Map<number, number[]>();
  /** First verse index of each book (index = book number; [67] = size). Absent books have empty ranges. */
  readonly bookStart = new Int32Array(68);
  readonly avgLen: number;
  readonly buildMs: number;
  private sorted: string[] | null = null;
  private packed: Map<number, number> | null = null;
  /** raw token -> term id (shared by build and highlighting). */
  private rawIds = new Map<string, number>();

  constructor(corpus: SearchCorpus) {
    const t0 = now();
    this.tr = corpus.tr;
    this.verses = corpus.verses;
    this.size = corpus.verses.length;
    const toks: number[] = [];
    this.tokStart = new Int32Array(this.size + 1);
    for (let i = 0; i < this.size; i++) {
      this.tokStart[i] = toks.length;
      const text = this.verses[i][3];
      WORD_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WORD_RE.exec(text))) {
        const id = this.idOfRaw(m[0], true);
        if (id >= 0) toks.push(id);
      }
    }
    this.tokStart[this.size] = toks.length;
    this.tokIds = Int32Array.from(toks);

    // Postings: two passes (document frequency, then fill), de-duplicating per verse.
    const nTerms = this.terms.length;
    const df = new Int32Array(nTerms);
    const last = new Int32Array(nTerms).fill(-1);
    const visit = (i: number, fn: (id: number) => void) => {
      for (let k = this.tokStart[i]; k < this.tokStart[i + 1]; k++) {
        const id = this.tokIds[k];
        fn(id);
        const parts = this.partsOf.get(id);
        if (parts) for (const p of parts) fn(p);
      }
    };
    for (let i = 0; i < this.size; i++) {
      visit(i, (id) => {
        if (last[id] !== i) {
          last[id] = i;
          df[id]++;
        }
      });
    }
    this.postings = new Array<Int32Array>(nTerms);
    for (let t = 0; t < nTerms; t++) this.postings[t] = new Int32Array(df[t]);
    const fill = new Int32Array(nTerms);
    last.fill(-1);
    for (let i = 0; i < this.size; i++) {
      visit(i, (id) => {
        if (last[id] !== i) {
          last[id] = i;
          this.postings[id][fill[id]++] = i;
        }
      });
    }

    // Book ranges (corpus is in canonical order).
    this.bookStart.fill(-1);
    for (let i = this.size - 1; i >= 0; i--) this.bookStart[this.verses[i][0]] = i;
    this.bookStart[67] = this.size;
    for (let b = 66; b >= 1; b--) if (this.bookStart[b] < 0) this.bookStart[b] = this.bookStart[b + 1];
    this.bookStart[0] = 0;

    this.avgLen = this.size ? this.tokIds.length / this.size : 0;
    this.buildMs = now() - t0;
  }

  /** Term id for a raw corpus token (creating it while building). -1 if it folds to nothing. */
  private idOfRaw(raw: string, create: boolean): number {
    const hit = this.rawIds.get(raw);
    if (hit !== undefined) return hit;
    const term = foldWord(raw);
    if (!term) {
      this.rawIds.set(raw, -1);
      return -1;
    }
    let id = this.termIds.get(term);
    if (id === undefined) {
      if (!create) return -1;
      id = this.addTerm(term);
      if (/['’‑-]/.test(term)) {
        const parts = term
          .split(/['’‑-]/)
          .filter((p) => p.length > 1)
          .map((p) => this.termIds.get(p) ?? this.addTerm(p));
        if (parts.length > 1) this.partsOf.set(id, parts);
      }
    }
    this.rawIds.set(raw, id);
    return id;
  }

  private addTerm(term: string): number {
    const id = this.terms.length;
    this.terms.push(term);
    this.termIds.set(term, id);
    return id;
  }

  /** Verse indices containing a folded term. */
  postingsOf(term: string): VSet {
    const id = this.termIds.get(term);
    return id === undefined ? EMPTY : this.postings[id];
  }

  /** Term ids of every corpus term starting with `prefix` (sorted term list + binary search). */
  prefixIds(prefix: string): number[] {
    if (!this.sorted) this.sorted = [...this.terms].sort();
    const s = this.sorted;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    const out: number[] = [];
    for (let i = lo; i < s.length && s[i].startsWith(prefix); i++) out.push(this.termIds.get(s[i]) as number);
    return out;
  }

  /** Union of the postings of several terms. */
  unionOf(ids: Iterable<number>): VSet {
    const lists: Int32Array[] = [];
    for (const id of ids) lists.push(this.postings[id]);
    if (!lists.length) return EMPTY;
    if (lists.length === 1) return lists[0];
    const mark = new Uint8Array(this.size);
    let count = 0;
    for (const l of lists) {
      for (let i = 0; i < l.length; i++) {
        if (!mark[l[i]]) {
          mark[l[i]] = 1;
          count++;
        }
      }
    }
    const out = new Int32Array(count);
    let n = 0;
    for (let i = 0; i < this.size; i++) if (mark[i]) out[n++] = i;
    return out;
  }

  /** Union of verse sets. */
  unionOfSets(sets: VSet[]): VSet {
    const nonEmpty = sets.filter((s) => s.length);
    if (!nonEmpty.length) return EMPTY;
    if (nonEmpty.length === 1) return nonEmpty[0];
    const mark = new Uint8Array(this.size);
    for (const s of nonEmpty) for (let i = 0; i < s.length; i++) mark[s[i]] = 1;
    let count = 0;
    for (let i = 0; i < this.size; i++) count += mark[i];
    const out = new Int32Array(count);
    let n = 0;
    for (let i = 0; i < this.size; i++) if (mark[i]) out[n++] = i;
    return out;
  }

  /** Verse index of a packed ref, or -1. */
  indexOfPacked(packed: number): number {
    if (!this.packed) {
      this.packed = new Map();
      this.verses.forEach((v, i) => this.packed!.set(packRef(v[0], v[1], v[2]), i));
    }
    return this.packed.get(packed) ?? -1;
  }

  /** Term id of a raw word as it appears in a verse (no new terms are created). */
  idOfToken(raw: string): number {
    return this.idOfRaw(raw, false);
  }

  /** All verse indices. */
  universe(): VSet {
    const out = new Int32Array(this.size);
    for (let i = 0; i < this.size; i++) out[i] = i;
    return out;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* ------------------------------------------------------------------------ */
/* Lemma lookup                                                              */
/* ------------------------------------------------------------------------ */

interface LemmaTables {
  rows: Map<string, LexIndex[number]>;
  greek: Map<string, string[]>;
  hebrew: Map<string, string[]>;
  translit: Map<string, string[]>;
}

function buildLemmaTables(index: LexIndex): LemmaTables {
  const t: LemmaTables = { rows: new Map(), greek: new Map(), hebrew: new Map(), translit: new Map() };
  const push = (m: Map<string, string[]>, k: string, id: string) => {
    if (!k) return;
    const list = m.get(k);
    if (!list) m.set(k, [id]);
    else if (!list.includes(id)) list.push(id);
  };
  for (const row of index) {
    const [id, lemma, translit] = row;
    t.rows.set(id, row);
    const isG = id[0] === 'G';
    for (const form of lemma.split(/[,;/]\s*/)) {
      const f = form.trim();
      if (!f) continue;
      if (isG) {
        push(t.greek, foldGreek(f), id);
        push(t.translit, translitKey(transliterate(f, { iotaSubscript: 'omit' })), id);
      } else push(t.hebrew, foldHebrew(f).replace(/\s+/g, ''), id);
    }
    for (const tr of translit.split(/[,;/]\s*/)) push(t.translit, translitKey(tr), id);
  }
  return t;
}

/* ------------------------------------------------------------------------ */
/* Engine                                                                    */
/* ------------------------------------------------------------------------ */

interface Resolved {
  /** Verse set of each leaf node. */
  sets: Map<QueryNode, VSet>;
  /** Term ids matched by each word / phrase-term leaf. */
  ids: Map<QueryNode, Set<number>[]>;
  /** Strong's ids for each strongs / lemma leaf. */
  strongs: Map<QueryNode, string[]>;
  /** Description pieces for leaves. */
  labels: Map<QueryNode, string>;
}

export class SearchEngine {
  private indexes = new Map<string, Promise<CorpusIndex>>();
  private lemmaTables: Promise<LemmaTables> | null = null;
  private concCache = new Map<string, Promise<number[]>>();
  /** How many built indexes to keep (each is ~10–20 MB for a full Bible). */
  maxIndexes = 2;

  constructor(private deps: EngineDeps) {}

  /** Build (or return) the index for a translation. */
  index(tr: string): Promise<CorpusIndex> {
    let p = this.indexes.get(tr);
    if (p) {
      this.indexes.delete(tr);
      this.indexes.set(tr, p);
      return p;
    }
    p = this.deps.loadCorpus(tr).then((c) => new CorpusIndex(c));
    this.indexes.set(tr, p);
    p.catch(() => this.indexes.delete(tr));
    while (this.indexes.size > this.maxIndexes) this.indexes.delete(this.indexes.keys().next().value as string);
    return p;
  }

  /** Pre-build the index for a translation (e.g. when the search box gets focus). */
  async warm(tr: string): Promise<void> {
    await this.index(tr);
  }

  private lemmas(): Promise<LemmaTables> {
    if (!this.lemmaTables) {
      const p = this.deps.loadLexIndex().then(buildLemmaTables);
      this.lemmaTables = p;
      p.catch(() => {
        if (this.lemmaTables === p) this.lemmaTables = null;
      });
    }
    return this.lemmaTables;
  }

  private concordance(id: string): Promise<number[]> {
    let p = this.concCache.get(id);
    if (!p) {
      p = this.deps.loadConcordance(id).catch(() => []);
      this.concCache.set(id, p);
      if (this.concCache.size > 200) this.concCache.delete(this.concCache.keys().next().value as string);
    }
    return p;
  }

  async search(query: string, opts: SearchOptions): Promise<SearchResponse> {
    const t0 = now();
    const parsed = parseQuery(query);
    const idx = await this.index(opts.tr);
    if (opts.forms) applyForms(parsed.root);
    const resolved = await this.resolve(parsed, idx);
    const all = parsed.root ? evaluate(parsed.root, resolved, idx) : EMPTY;

    const bookNum = typeof opts.book === 'string' ? getBook(opts.book)?.num : opts.book;
    const allowed = allowedBooks(parsed.filters, opts.testament, bookNum);
    const byBook: Record<number, number> = {};
    for (let i = 0; i < all.length; i++) {
      const b = idx.verses[all[i]][0];
      byBook[b] = (byBook[b] ?? 0) + 1;
    }
    let matches = all;
    if (allowed) {
      const out = new Int32Array(all.length);
      let n = 0;
      for (let i = 0; i < all.length; i++) if (allowed.has(idx.verses[all[i]][0])) out[n++] = all[i];
      matches = out.subarray(0, n);
    }

    const limit = Math.max(0, Math.min(opts.limit ?? 50, 1000));
    const offset = Math.max(0, opts.offset ?? 0);
    const leaves = positiveLeaves(parsed.root);
    let order: number[];
    let scores: Map<number, number> | null = null;
    if (opts.sort === 'relevance' && matches.length) {
      scores = scoreVerses(matches, leaves, resolved, idx);
      order = Array.from(matches).sort((a, b) => (scores!.get(b) ?? 0) - (scores!.get(a) ?? 0) || a - b);
    } else {
      order = Array.from(matches.subarray(offset, offset + limit));
    }
    const page = scores ? order.slice(offset, offset + limit) : order;

    const results: SearchHit[] = page.map((i) => {
      const [b, c, v, text] = idx.verses[i];
      const hit: SearchHit = {
        bookNum: b,
        book: getBookByNum(b)?.id ?? String(b),
        chapter: c,
        verse: v,
        text,
        highlights: highlight(text, leaves, resolved, idx),
      };
      if (scores) hit.score = Math.round((scores.get(i) ?? 0) * 1000) / 1000;
      return hit;
    });

    const terms = new Set<string>();
    const strongs = new Set<string>();
    for (const l of leaves) {
      for (const set of resolved.ids.get(l) ?? []) for (const id of set) terms.add(idx.terms[id]);
      for (const s of resolved.strongs.get(l) ?? []) strongs.add(s);
    }

    const response: SearchResponse = {
      query,
      tr: opts.tr,
      total: matches.length,
      totalAll: all.length,
      results,
      byBook,
      interpreted: describe(parsed, resolved, opts, bookNum),
      terms: [...terms],
      strongs: [...strongs],
      suggestions: [],
      errors: parsed.errors,
      elapsedMs: 0,
    };
    response.suggestions = await this.suggest(parsed, response, idx);
    response.elapsedMs = Math.round((now() - t0) * 10) / 10;
    return response;
  }

  /** Resolve every leaf to a verse set (async: concordance / lexicon lookups). */
  private async resolve(parsed: ParsedQuery, idx: CorpusIndex): Promise<Resolved> {
    const r: Resolved = { sets: new Map(), ids: new Map(), strongs: new Map(), labels: new Map() };
    const leaves: QueryNode[] = [];
    const walk = (n: QueryNode | null) => {
      if (!n) return;
      if (n.kind === 'and' || n.kind === 'or') n.nodes.forEach(walk);
      else if (n.kind === 'not') walk(n.node);
      else leaves.push(n);
    };
    walk(parsed.root);
    const has = (t: string) => idx.termIds.has(t);

    for (const leaf of leaves) {
      switch (leaf.kind) {
        case 'word': {
          let ids: number[];
          if (leaf.mode === 'prefix') ids = idx.prefixIds(leaf.term);
          else if (leaf.mode === 'forms') ids = wordForms(leaf.term, has).map((t) => idx.termIds.get(t) as number);
          else ids = idx.termIds.has(leaf.term) ? [idx.termIds.get(leaf.term) as number] : [];
          r.ids.set(leaf, [new Set(ids)]);
          r.sets.set(leaf, idx.unionOf(ids));
          r.labels.set(leaf, wordLabel(leaf, ids.map((i) => idx.terms[i])));
          break;
        }
        case 'phrase': {
          const idSets = leaf.terms.map(
            (t) => new Set(t.mode === 'prefix' ? idx.prefixIds(t.term) : idx.termIds.has(t.term) ? [idx.termIds.get(t.term) as number] : []),
          );
          r.ids.set(leaf, idSets);
          r.sets.set(leaf, matchPhrase(idSets, idx));
          r.labels.set(leaf, `the phrase “${leaf.terms.map((t) => t.term + (t.mode === 'prefix' ? '…' : '')).join(' ')}”`);
          break;
        }
        case 'strongs': {
          const refs = await this.concordance(leaf.id);
          r.sets.set(leaf, refsToSet(refs, idx));
          r.strongs.set(leaf, [leaf.id]);
          let label = `Strong’s ${leaf.id}`;
          try {
            const row = (await this.lemmas()).rows.get(leaf.id) ?? (await this.lemmas()).rows.get(leaf.id.slice(0, 5));
            if (row) label += ` ${row[1]} (${row[2]}, “${row[3]}”)`;
          } catch {
            /* lexicon index unavailable: plain label */
          }
          r.labels.set(leaf, label);
          break;
        }
        case 'lemma': {
          let ids: string[] = [];
          try {
            ids = lookupLemma(await this.lemmas(), leaf);
          } catch {
            parsed.errors.push('The lexicon could not be loaded for a Greek/Hebrew search');
          }
          const refLists = await Promise.all(ids.map((id) => this.concordance(id)));
          r.sets.set(leaf, idx.unionOfSets(refLists.map((refs) => refsToSet(refs, idx))));
          r.strongs.set(leaf, ids);
          const tables = this.lemmaTables ? await this.lemmaTables.catch(() => null) : null;
          const langName = leaf.lang === 'grc' ? 'Greek' : leaf.lang === 'hbo' ? 'Hebrew' : 'Greek/Hebrew';
          if (!ids.length) {
            r.labels.set(leaf, `${langName} “${leaf.text}” (no matching lexicon entry)`);
            parsed.errors.push(`No ${langName} word “${leaf.text}” in the lexicon`);
          } else {
            const descs = ids.slice(0, 3).map((id) => {
              const row = tables?.rows.get(id);
              return row ? `${row[1]} (${id}, ${row[2]}, “${row[3]}”)` : id;
            });
            r.labels.set(leaf, `${langName} ${descs.join(' or ')}${ids.length > 3 ? ` +${ids.length - 3} more` : ''}`);
          }
          break;
        }
        default:
          break;
      }
    }
    return r;
  }

  private async suggest(parsed: ParsedQuery, res: SearchResponse, idx: CorpusIndex): Promise<SearchSuggestion[]> {
    const out: SearchSuggestion[] = [];
    const root = parsed.root;
    if (!root || root.kind !== 'word' || root.mode !== 'exact') return out;
    const has = (t: string) => idx.termIds.has(t);
    const forms = wordForms(root.term, has).filter((f) => f !== root.term);
    if (res.total === 0) {
      // A transliterated Greek / Hebrew word?
      try {
        const tables = await this.lemmas();
        const ids = tables.translit.get(translitKey(root.raw)) ?? [];
        for (const id of ids.slice(0, 3)) {
          const row = tables.rows.get(id);
          if (!row) continue;
          const lang = id[0] === 'G' ? 'greek' : 'hebrew';
          out.push({ query: `${lang}:${row[2] || root.raw}`, label: `${lang === 'greek' ? 'Greek' : 'Hebrew'} ${row[1]} (${row[2]}, “${row[3]}”) — ${id}` });
        }
      } catch {
        /* no lexicon */
      }
      if (forms.length) out.push({ query: `${root.raw}~`, label: `Other forms: ${forms.slice(0, 5).join(', ')}` });
      const near = nearestTerm(root.term, idx);
      if (near) out.push({ query: near, label: `Did you mean “${near}”?` });
    } else if (forms.length) {
      out.push({ query: `${root.raw}~`, label: `Include other forms: ${forms.slice(0, 5).join(', ')}${forms.length > 5 ? '…' : ''}` });
    }
    return out;
  }
}

function applyForms(node: QueryNode | null): void {
  if (!node) return;
  if (node.kind === 'and' || node.kind === 'or') node.nodes.forEach(applyForms);
  else if (node.kind === 'not') applyForms(node.node);
  else if (node.kind === 'word' && node.mode === 'exact') node.mode = 'forms';
}

function refsToSet(refs: number[], idx: CorpusIndex): VSet {
  const out: number[] = [];
  for (const r of refs) {
    const i = idx.indexOfPacked(r);
    if (i >= 0) out.push(i);
  }
  out.sort((a, b) => a - b);
  // de-duplicate (refs are unique, but be safe)
  const res = new Int32Array(out.length);
  let n = 0;
  for (let k = 0; k < out.length; k++) if (k === 0 || out[k] !== out[k - 1]) res[n++] = out[k];
  return res.subarray(0, n);
}

function lookupLemma(t: LemmaTables, leaf: Extract<QueryNode, { kind: 'lemma' }>): string[] {
  let ids: string[] = [];
  if (leaf.by === 'script') {
    ids = leaf.lang === 'grc' ? t.greek.get(foldGreek(leaf.text)) ?? [] : t.hebrew.get(foldHebrew(leaf.text).replace(/\s+/g, '')) ?? [];
  } else {
    ids = t.translit.get(translitKey(leaf.text)) ?? [];
    if (leaf.lang !== 'any') ids = ids.filter((id) => (leaf.lang === 'grc') === (id[0] === 'G'));
  }
  // Concordance is keyed by base ids; keep unique base ids, in order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const base = id.slice(0, 5);
    if (!seen.has(base)) {
      seen.add(base);
      out.push(base);
    }
  }
  return out;
}

function matchPhrase(idSets: Set<number>[], idx: CorpusIndex): VSet {
  if (idSets.some((s) => !s.size)) return EMPTY;
  // Candidates: verses containing every phrase word (smallest first).
  const lists = idSets.map((s) => idx.unionOf(s)).sort((a, b) => a.length - b.length);
  let cand = lists[0];
  for (let k = 1; k < lists.length && cand.length; k++) cand = intersect(cand, lists[k]);
  const out = new Int32Array(cand.length);
  let n = 0;
  const len = idSets.length;
  for (let c = 0; c < cand.length; c++) {
    const v = cand[c];
    const start = idx.tokStart[v];
    const end = idx.tokStart[v + 1];
    outer: for (let i = start; i + len <= end; i++) {
      for (let k = 0; k < len; k++) if (!idSets[k].has(idx.tokIds[i + k])) continue outer;
      out[n++] = v;
      break;
    }
  }
  return out.subarray(0, n);
}

function evaluate(node: QueryNode, r: Resolved, idx: CorpusIndex): VSet {
  switch (node.kind) {
    case 'and': {
      const pos: VSet[] = [];
      const neg: VSet[] = [];
      for (const n of node.nodes) {
        if (n.kind === 'not') neg.push(evaluate(n.node, r, idx));
        else pos.push(evaluate(n, r, idx));
      }
      pos.sort((a, b) => a.length - b.length);
      let acc = pos.length ? pos[0] : idx.universe();
      for (let k = 1; k < pos.length && acc.length; k++) acc = intersect(acc, pos[k]);
      for (const s of neg) if (acc.length) acc = difference(acc, s);
      return acc;
    }
    case 'or':
      return idx.unionOfSets(node.nodes.map((n) => evaluate(n, r, idx)));
    case 'not':
      return difference(idx.universe(), evaluate(node.node, r, idx));
    default:
      return r.sets.get(node) ?? EMPTY;
  }
}

/** BM25-ish relevance: term frequency × idf, normalised by verse length; phrases weigh double. */
function scoreVerses(matches: VSet, leaves: QueryNode[], r: Resolved, idx: CorpusIndex): Map<number, number> {
  const k1 = 1.2;
  const b = 0.75;
  const N = idx.size;
  const scores = new Map<number, number>();
  const weights = leaves.map((l) => {
    const set = r.sets.get(l) ?? EMPTY;
    const idf = Math.log(1 + (N - set.length + 0.5) / (set.length + 0.5));
    return { l, idf, set: l.kind === 'word' ? r.ids.get(l)?.[0] : undefined };
  });
  for (let m = 0; m < matches.length; m++) {
    const v = matches[m];
    const start = idx.tokStart[v];
    const end = idx.tokStart[v + 1];
    const len = end - start;
    let score = 0;
    for (const w of weights) {
      let tf = 0;
      if (w.set) {
        for (let i = start; i < end; i++) if (w.set.has(idx.tokIds[i])) tf++;
      } else {
        const s = r.sets.get(w.l);
        tf = s && binaryHas(s, v) ? 1 : 0;
        if (w.l.kind === 'phrase') tf *= 2;
      }
      if (tf) score += (w.idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * len) / (idx.avgLen || 1)));
    }
    scores.set(v, score);
  }
  return scores;
}

function binaryHas(s: VSet, x: number): boolean {
  let lo = 0;
  let hi = s.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] === x) return true;
    if (s[mid] < x) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** Character spans of matched words / phrases in a verse. */
function highlight(text: string, leaves: QueryNode[], r: Resolved, idx: CorpusIndex): [number, number][] {
  const wordIds = new Set<number>();
  const phrases: Set<number>[][] = [];
  for (const l of leaves) {
    if (l.kind === 'word') for (const id of r.ids.get(l)?.[0] ?? []) wordIds.add(id);
    else if (l.kind === 'phrase') phrases.push(r.ids.get(l) ?? []);
  }
  if (!wordIds.size && !phrases.length) return [];
  const toks: { s: number; e: number; id: number; raw: string }[] = [];
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text))) {
    const id = idx.idOfToken(m[0]);
    if (id >= 0) toks.push({ s: m.index, e: m.index + m[0].length, id, raw: m[0] });
  }
  const spans: [number, number][] = [];
  for (const t of toks) {
    if (wordIds.has(t.id)) {
      spans.push([t.s, t.e]);
      continue;
    }
    const parts = idx.partsOf.get(t.id);
    if (parts?.some((p) => wordIds.has(p))) {
      // highlight just the matching part(s) of a hyphenated compound
      let off = t.s;
      for (const piece of t.raw.split(/(['’‑-])/)) {
        const pid = idx.termIds.get(foldWord(piece));
        if (pid !== undefined && wordIds.has(pid)) spans.push([off, off + piece.length]);
        off += piece.length;
      }
    }
  }
  for (const ph of phrases) {
    for (let i = 0; i + ph.length <= toks.length; i++) {
      let ok = true;
      for (let k = 0; k < ph.length && ok; k++) ok = ph[k].has(toks[i + k].id);
      if (ok) spans.push([toks[i].s, toks[i + ph.length - 1].e]);
    }
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

function wordLabel(leaf: Extract<QueryNode, { kind: 'word' }>, matched: string[]): string {
  const list = (xs: string[]) => xs.slice(0, 6).join(', ') + (xs.length > 6 ? '…' : '');
  if (leaf.mode === 'prefix') return matched.length ? `words starting with “${leaf.term}” (${list(matched)})` : `words starting with “${leaf.term}”`;
  if (leaf.mode === 'forms') return matched.length > 1 ? `any form of “${leaf.term}” (${list(matched)})` : `“${leaf.term}”`;
  return `“${leaf.term}”`;
}

function describeNode(n: QueryNode, r: Resolved, top: boolean): string {
  switch (n.kind) {
    case 'and': {
      const s = n.nodes.map((c) => describeNode(c, r, false)).join(' and ');
      return top ? s : `(${s})`;
    }
    case 'or': {
      const s = n.nodes.map((c) => describeNode(c, r, false)).join(' or ');
      return top ? s : `(${s})`;
    }
    case 'not':
      return `not ${describeNode(n.node, r, false)}`;
    default:
      return r.labels.get(n) ?? n.raw;
  }
}

function describe(parsed: ParsedQuery, r: Resolved, opts: SearchOptions, bookNum?: number): string {
  if (!parsed.root) return '';
  let s = describeNode(parsed.root, r, true);
  const scope: string[] = [];
  const t = opts.testament ?? parsed.filters.testament;
  if (t) scope.push(t === 'OT' ? 'the Old Testament' : 'the New Testament');
  const books = [...(parsed.filters.books ?? []), ...(bookNum ? [bookNum] : [])];
  if (books.length) {
    const names = [...new Set(books)].map((b) => getBookByNum(b)?.name ?? String(b));
    scope.push(names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more books` : names.join(', '));
  }
  if (scope.length) s += ` — in ${scope.join(', ')}`;
  return s;
}

/** Closest corpus word by edit distance (1 for short words, 2 for longer), preferring frequent words. */
function nearestTerm(term: string, idx: CorpusIndex): string | null {
  if (term.length < 3) return null;
  const maxD = term.length <= 5 ? 1 : 2;
  let best: string | null = null;
  let bestD = maxD + 1;
  let bestDf = -1;
  for (let id = 0; id < idx.terms.length; id++) {
    const w = idx.terms[id];
    if (Math.abs(w.length - term.length) > maxD) continue;
    const d = editDistance(term, w, maxD);
    const df = idx.postings[id].length;
    if (d <= maxD && (d < bestD || (d === bestD && df > bestDf))) {
      best = w;
      bestD = d;
      bestDf = df;
    }
  }
  return best;
}

function editDistance(a: string, b: string, max: number): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
