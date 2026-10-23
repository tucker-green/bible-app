/**
 * Bridge alignment (shared: pipeline + browser): link the words of any English translation to the
 * original-language words of a verse by going through the BSB, whose words are hand-aligned.
 *
 * Evidence for a (target word, original word) pair:
 *  - lexical bridge: a BSB word of the same verse with the same lemma (normalize.ts) is linked to the
 *    original word; weighted by how close that BSB word sits (relative position) to the target word;
 *  - the translation table P(Strong's | lemma) learned from the BSB and KJV alignments (table.ts);
 *  - the original word's own English gloss;
 *  - a positional prior: the original word's "anchor" (mean relative position of the BSB words
 *    linked to it, interpolated for unlinked words) against the target word's relative position.
 *
 * Linking runs in three phases:
 *  1. content words, by competitive linking (best-scoring pairs first; an original word taken by a
 *     non-adjacent word is not handed out again), copying the BSB word's whole link set when the
 *     evidence is lexical (so phrase alignments like "shall not perish" carry over);
 *  2. function words with direct evidence — the table must back the specific Strong's number, so a
 *     BSB phrase link ("was over" -> עַל) alone never links "was";
 *  3. attachment: an unlinked determiner, possessive, object pronoun, preposition, conjunction or
 *     auxiliary goes to the article / prefix / suffix / pronoun belonging to the neighbouring content
 *     word it goes with (the -> τὸν before κόσμον; "his" -> the suffix of בֵּיתוֹ; "shall" -> the verb),
 *     when the table supports that morpheme.
 * Anything else stays unlinked: a missing link is better than a wrong one. Every link carries a
 * confidence in TokenInfo.c (0.3–1, calibrated against the KJV's own tags by eval-bridge.ts).
 *
 * Pure and synchronous; ~5–10 ms per chapter.
 */
import { segment } from '../tokenize';
import type { OrigChapter, OrigWord, TextChapter, TextVerse, Token, WordToken } from '../types';
import { OW } from '../types';
import { FUNCTION_WORDS, fitsMorpheme, lemmas, wordClass, type WordClass } from './normalize';
import { tokenWords, type TranslationTable } from './table';
import type { BridgeOptions } from './types';

export const DEFAULT_BRIDGE_OPTIONS: BridgeOptions = {
  minContent: 0.3,
  minFunction: 0.4,
  sigma: 0.2,
};

/** Minimum P(Strong's | lemma) for a function word to link directly (phase 2), by class. */
const DIRECT_MIN: Record<WordClass, number> = {
  det: Number.POSITIVE_INFINITY, // never on the table alone; Hebrew only with a lexical bridge
  poss: 0.15,
  obj: 0.15,
  subj: 0.2,
  prep: 0.15,
  conj: 0.2,
  aux: 0.2,
  cop: 0.25,
  other: 0.2,
  content: 0,
};

/**
 * Minimum P(Strong's | lemma) for a pronoun attached to the suffix of its head word. The position is
 * already fixed by the structure; the table only has to confirm the pairing (Macula numbers the
 * same suffix H2050c, H1930a, H1992b… so each id alone gets a small share).
 */
const SUFFIX_MIN = 0.03;

/** Raw score of a link made by gap filling (phase 1b). */
const GAP_SCORE = 0.42;

/** Minimum P(Strong's | lemma) for a function word that a BSB word of the same lemma also links there. */
const LEX_FN_MIN = 0.03;

/** Positional similarity of two relative positions (1 at the same place, 0.5 at `sigma` apart). */
const posSim = (a: number, b: number, sigma: number) => {
  const d = (a - b) / sigma;
  return 1 / (1 + d * d);
};

interface Target {
  text: string;
  lemma: string;
  cls: WordClass;
  /** Relative position 0..1. */
  pos: number;
}

interface BsbWord {
  lemma: string;
  links: number[];
  pos: number;
}

/** How a link was made. */
export type LinkKind = 'lex' | 'table' | 'gloss' | 'gap' | 'attach' | 'aux';

interface Choice {
  /** The original word this choice is about (claimed). */
  j: number;
  /** Links to emit (j, or the whole link set of the matching BSB word). */
  links: number[];
  score: number;
  kind: LinkKind;
}

/** One target word as aligned by `alignVerse`. */
export interface AlignedWord {
  text: string;
  cls: WordClass;
  links: number[];
  /** Raw score (0 when unlinked). */
  score: number;
  /** Calibrated confidence written to TokenInfo.c (0 when unlinked). */
  conf: number;
  kind?: LinkKind;
}

const GLOSS_STOP = new Set(['[direct', 'object]', '*']);

/** Per-chapter lookups, computed once per OrigChapter object. */
interface ChapterIndex {
  /** English verse -> indices of its original words. */
  byVerse: Map<number, number[]>;
  /** Word index -> lemma set of its gloss (filled lazily). */
  gloss: Map<number, Set<string>>;
}
const INDEX = new WeakMap<OrigChapter, ChapterIndex>();
function chapterIndex(orig: OrigChapter): ChapterIndex {
  let ix = INDEX.get(orig);
  if (!ix) {
    const byVerse = new Map<number, number[]>();
    orig.words.forEach((w, j) => {
      const list = byVerse.get(w[OW.verse]);
      if (list) list.push(j);
      else byVerse.set(w[OW.verse], [j]);
    });
    INDEX.set(orig, (ix = { byVerse, gloss: new Map() }));
  }
  return ix;
}

/** Lemma set of an original word's gloss, without function words. */
function glossLemmas(gloss: string): Set<string> {
  const ws = gloss
    .toLowerCase()
    .split(/[^\p{L}'’-]+/u)
    .filter((w) => w && !GLOSS_STOP.has(w) && !FUNCTION_WORDS.has(w));
  return new Set(lemmas(ws));
}

const isVerb = (w: OrigWord) => w[OW.morph].startsWith('V');
/** Hebrew morpheme kinds by their (OSHB-style) morphology code. */
const isHebArticle = (w: OrigWord) => /^T[d]/.test(w[OW.morph]) || /^R.*d$/.test(w[OW.morph]);
const isHebPrefix = (w: OrigWord) => /^[RCT]/.test(w[OW.morph]);
const isHebSuffix = (w: OrigWord) => w[OW.morph].startsWith('S');
const GREEK_ARTICLE = 'G3588';

/** Case-number-gender of a Greek nominal / participle code ("T-ASM" -> "ASM", "V-PAP-NSM" -> "NSM"), or "". */
const cng = (morph: string) => /-([NGDAV][SP][MFN])$/.exec(morph)?.[1] ?? '';
/** True unless both codes carry case-number-gender and they differ. */
const agrees = (a: string, b: string) => {
  const x = cng(a);
  const y = cng(b);
  return !x || !y || x === y;
};

/**
 * Link one verse.
 *  text   the target translation's verse text (any English)
 *  bsb    the BSB tokens of the same verse (undefined / [] if the BSB lacks it)
 *  orig   the chapter's original words
 *  verse  English verse number (0 = Psalm title)
 * Returns tokens that reproduce `text` exactly.
 */
export function bridgeVerse(
  text: string,
  bsb: readonly Token[] | undefined,
  orig: OrigChapter,
  verse: number,
  table: TranslationTable,
  options: Partial<BridgeOptions> = {},
): Token[] {
  return alignVerse(text, bsb, orig, verse, table, options).tokens;
}

/** `bridgeVerse` with the per-word details (link kind, raw score) used by the evaluation and tests. */
export function alignVerse(
  text: string,
  bsb: readonly Token[] | undefined,
  orig: OrigChapter,
  verse: number,
  table: TranslationTable,
  options: Partial<BridgeOptions> = {},
): { tokens: Token[]; words: AlignedWord[] } {
  const opt = { ...DEFAULT_BRIDGE_OPTIONS, ...options };
  const words = orig.words;
  const hebrew = orig.lang === 'hbo';

  const segs = segment(text);
  const tw = segs.filter((s) => s.word).map((s) => s.text);
  const tl = lemmas(tw);
  const T: Target[] = tw.map((w, i) => ({ text: w, lemma: tl[i], cls: wordClass(w), pos: tw.length > 1 ? i / (tw.length - 1) : 0.5 }));

  // Candidates: this verse's original words, plus anything the BSB verse links to.
  const candSet = new Set<number>(chapterIndex(orig).byVerse.get(verse) ?? []);
  const bw = tokenWords(bsb ?? []);
  const bl = lemmas(bw.map((w) => w.text));
  const B: BsbWord[] = bw.map((w, k) => ({
    lemma: bl[k],
    links: w.links.filter((j) => j >= 0 && j < words.length),
    pos: bw.length > 1 ? k / (bw.length - 1) : 0.5,
  }));
  for (const b of B) for (const j of b.links) candSet.add(j);
  const cand = [...candSet].sort((a, b) => a - b);
  if (!T.length || !cand.length) {
    return { tokens: text ? [text] : [], words: T.map((t) => ({ text: t.text, cls: t.cls, links: [], score: 0, conf: 0 })) };
  }
  const inCand = new Set(cand);

  const anchor = anchors(cand, B);
  /** Morphemes of the written (Hebrew) word containing j. */
  const morphemesOf = (j: number) => {
    const out: number[] = [];
    const g = words[j][OW.group];
    for (let k = g; k < words.length && words[k][OW.group] === g; k++) out.push(k);
    return out;
  };
  // Hebrew bound morphemes: the prefixes before a written word's root and its suffixes
  // (in מִתַּחַת "from under" only מִ is bound; in לוֹ "to him" only the suffix).
  const bound = new Set<number>();
  if (hebrew) {
    for (const j of cand) {
      if (words[j][OW.group] !== j) continue; // visit each written word once, from its first morpheme
      const ms = morphemesOf(j);
      if (ms.length < 2) continue;
      let root = ms.length - 1;
      while (root > 0 && isHebSuffix(words[ms[root]])) root--;
      ms.forEach((k, r) => {
        if (r < root || (r > root && isHebSuffix(words[k]))) bound.add(k);
      });
    }
  }
  const bsbBy = new Map<string, BsbWord[]>();
  for (const b of B) {
    if (!b.links.length) continue;
    const list = bsbBy.get(b.lemma);
    if (list) list.push(b);
    else bsbBy.set(b.lemma, [b]);
  }
  const glossCache = chapterIndex(orig).gloss;
  const glossOf = (j: number) => {
    let g = glossCache.get(j);
    if (!g) glossCache.set(j, (g = glossLemmas(words[j][OW.gloss])));
    return g;
  };
  const prob = (i: number, j: number) => {
    const s = words[j][OW.strongs];
    return s ? table.prob(T[i].lemma, s) : 0;
  };
  const lang = hebrew ? 'h' : 'g';

  /** Scored candidates of target word i (direct evidence only). */
  const choicesOf = (i: number): Choice[] => {
    const t = T[i];
    const fn = t.cls !== 'content';
    const min = DIRECT_MIN[t.cls];
    const list: Choice[] = [];
    const lexB = bsbBy.get(t.lemma) ?? [];
    for (const j of cand) {
      const tab = prob(i, j);
      // Greek determiners: attachment only (which of a verse's articles is the question). Hebrew
      // "the" may also follow the BSB onto a definite noun without an article ("the LORD").
      if ((t.cls === 'det' && !hebrew) || (fn && tab < Math.min(min, LEX_FN_MIN))) continue;
      // Hebrew prefixes and suffixes are reached only by attachment (phase 3): which of a verse's
      // many וְ / לְ / ־וֹ an "and" / "to" / "him" renders depends on the word it goes with.
      if (fn && hebrew && bound.has(j)) continue;
      let lex = 0;
      let lexLinks: number[] | undefined;
      for (const b of lexB) {
        if (!b.links.includes(j)) continue;
        const p = posSim(t.pos, b.pos, opt.sigma * 1.5);
        if (p > lex) {
          lex = p;
          lexLinks = b.links;
        }
      }
      const gl = !fn && glossOf(j).has(t.lemma) ? 1 : 0;
      // A frequent word the table has (almost) never seen rendering this Strong's number: the BSB
      // link is probably a reordering or phrase artefact ("Jesus" on διδάσκων), so trust it less.
      if (lex && !gl && tab < 0.005 && table.count(lang, t.lemma) >= 50) lex *= 0.3;
      if (!lex && tab < 0.02 && !gl) continue;
      // Function words: the table must back this Strong's number (strongly, or weakly with a BSB
      // word of the same lemma at the same place — not for copulas, which the BSB often folds into
      // a neighbouring phrase).
      if (fn && tab < min && (lex < 0.5 || (hebrew && t.cls === 'cop'))) continue;
      const ev = 1 - (1 - 0.9 * lex) * (1 - Math.min(tab, 0.95)) * (1 - 0.6 * gl);
      // Without a BSB verse the anchors are only the original word order: a weaker prior.
      const pj = cand.length === 1 ? 1 : posSim(t.pos, anchor.get(j)!, B.length ? opt.sigma : opt.sigma * 2);
      const score = ev * (0.4 + 0.6 * pj);
      if (score < (fn ? opt.minFunction : opt.minContent)) continue;
      // A content link resting on a weak lexical bridge alone (far-off position, frequent word the
      // table never pairs with this number) is right only about half the time: leave it.
      if (!fn && lex >= 0.5 && tab < 0.02 && !gl && score < 0.4) continue;
      // Content words take the matching BSB word's link set, minus the parts the table says this
      // word does not render (the וְ / suffix of "and brought him", the μή of "shall not perish"),
      // which are left for the function words. Function words take only the original word itself.
      const links =
        !fn && lex >= 0.5 && lexLinks
          ? lexLinks.filter((k) => inCand.has(k) && (k === j || prob(i, k) >= (bound.has(k) ? 0.3 : 0.1)))
          : [j];
      list.push({ j, links, score, kind: lex >= 0.5 ? 'lex' : gl && tab < 0.3 ? 'gloss' : 'table' });
    }
    return list;
  };

  const chosen: (Choice | undefined)[] = T.map(() => undefined);
  const claimedBy = new Map<number, number[]>();
  const claim = (i: number, c: Choice) => {
    chosen[i] = c;
    claimedBy.set(c.j, [...(claimedBy.get(c.j) ?? []), i]);
  };
  /** Competitive linking over the given target words. */
  const compete = (idx: readonly number[]) => {
    const pairs: { i: number; c: Choice }[] = [];
    for (const i of idx) for (const c of choicesOf(i)) pairs.push({ i, c });
    pairs.sort((a, b) => b.c.score - a.c.score || a.i - b.i);
    for (const { i, c } of pairs) {
      if (chosen[i]) continue;
      // An original word is shared only with an adjacent word ("only begotten", "shall not").
      const others = claimedBy.get(c.j) ?? [];
      if (!others.every((o) => Math.abs(o - i) <= 2)) continue;
      claim(i, c);
    }
  };

  // Phase 1: content words. Phase 2: function words with direct evidence.
  compete(T.map((_, i) => i).filter((i) => T[i].cls === 'content'));
  fillGaps();
  compete(T.map((_, i) => i).filter((i) => T[i].cls !== 'content'));

  /**
   * Phase 1b: an unlinked content word between two linked content words (within 3 words, no other
   * unlinked content word in between) takes the one unclaimed content word lying between their
   * original words, if there is exactly one ("God made the firmament, and divided the waters" —
   * "divided" is the only verb left between אֱלֹהִים… and הַמַּיִם).
   */
  function fillGaps() {
    const isContentOrig = (j: number) => (hebrew ? /^[NVA]/ : /^(?:N-|V-|A-)/).test(words[j][OW.morph]) && !bound.has(j);
    for (let i = 0; i < T.length; i++) {
      if (chosen[i] || T[i].cls !== 'content') continue;
      let l = -1;
      for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
        if (T[k].cls !== 'content') continue;
        if (chosen[k]) l = k;
        break;
      }
      let r = -1;
      for (let k = i + 1; k <= Math.min(T.length - 1, i + 3); k++) {
        if (T[k].cls !== 'content') continue;
        if (chosen[k]) r = k;
        break;
      }
      if (l < 0 || r < 0) continue;
      const lo = Math.min(chosen[l]!.j, chosen[r]!.j);
      const hi = Math.max(chosen[l]!.j, chosen[r]!.j);
      if (hi - lo > 8) continue;
      const between = cand.filter((j) => j > lo && j < hi && isContentOrig(j) && !claimedBy.has(j));
      if (between.length !== 1) continue;
      claim(i, { j: between[0], links: [between[0]], score: GAP_SCORE, kind: 'gap' });
    }
  }

  // Phase 3: attachment of the remaining function words.
  const headAfter = (i: number, contentOnly = true) => {
    for (let k = i + 1; k < Math.min(T.length, i + 4); k++) {
      if (chosen[k] && (!contentOnly || T[k].cls === 'content')) return k;
      if (T[k].cls === 'content' && !chosen[k]) return -1; // an unlinked content word in between: give up
    }
    return -1;
  };
  const headBefore = (i: number) => {
    for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
      if (chosen[k] && T[k].cls === 'content') return k;
      if (T[k].cls === 'content' && !chosen[k]) return -1;
    }
    return -1;
  };
  const free = (j: number) => inCand.has(j) && !claimedBy.has(j);
  const best = (i: number, js: readonly number[], min: number): [number, number] => {
    let bj = -1;
    let bp = 0;
    for (const j of js) {
      if (!free(j)) continue;
      const p = prob(i, j);
      if (p > bp) {
        bp = p;
        bj = j;
      }
    }
    return bp >= min ? [bj, bp] : [-1, 0];
  };
  const attachTo = (i: number, head: number, j: number, p: number) => {
    claim(i, { j, links: [j], score: Math.min(chosen[head]!.score, 0.45 + p / 2), kind: 'attach' });
  };

  T.forEach((t, i) => {
    if (chosen[i] || t.cls === 'content') return;
    switch (t.cls) {
      case 'det': {
        const h = headAfter(i);
        if (h < 0) return;
        const root = chosen[h]!.j;
        let js: number[];
        if (hebrew) {
          js = morphemesOf(root).filter((k) => isHebArticle(words[k]));
          // A preposition with the article fused in (לָ, בַּ): "the" renders its article part.
          const fused = js.find((k) => /^R.*d$/.test(words[k][OW.morph]) && free(k));
          if (fused !== undefined && !js.some((k) => k !== fused && free(k))) {
            attachTo(i, h, fused, 0.3);
            return;
          }
        }
        else {
          // The article of the head's noun phrase: walk back over adjectives / adverbs / postpositive
          // particles only, and require case-number-gender agreement when both are parsed.
          js = [];
          for (let k = root - 1; k >= Math.max(0, root - 4); k--) {
            if (words[k][OW.strongs] === GREEK_ARTICLE) {
              if (agrees(words[k][OW.morph], words[root][OW.morph])) js.push(k);
              break;
            }
            if (!/^(?:A-|ADV|CONJ|PRT|S-)/.test(words[k][OW.morph])) break;
          }
        }
        const [j, p] = best(i, js, 0.1);
        if (j >= 0) attachTo(i, h, j, p);
        return;
      }
      case 'poss': {
        const h = headAfter(i);
        if (h < 0) return;
        const root = chosen[h]!.j;
        const js = hebrew ? morphemesOf(root).filter((k) => isHebSuffix(words[k])) : near(root, 3, words);
        const [j, p] = best(i, js, hebrew ? SUFFIX_MIN : 0.15);
        if (j >= 0) attachTo(i, h, j, p);
        return;
      }
      case 'obj': {
        const h = headBefore(i);
        if (h < 0) return;
        const root = chosen[h]!.j;
        let js: number[];
        if (hebrew) {
          // The verb's own suffix, or the object marker / preposition that follows it (אֹתוֹ, לוֹ).
          js = morphemesOf(root).filter((k) => isHebSuffix(words[k]));
          const next = morphemesOf(root).at(-1)! + 1;
          if (next < words.length) js.push(...morphemesOf(next).filter((k) => isHebSuffix(words[k])));
        } else js = near(root, 3, words);
        const [j, p] = best(i, js, hebrew ? SUFFIX_MIN : 0.15);
        if (j >= 0) attachTo(i, h, j, p);
        return;
      }
      case 'prep': {
        if (!hebrew) return;
        const h = headAfter(i);
        if (h < 0) return;
        const js = morphemesOf(chosen[h]!.j).filter((k) => isHebPrefix(words[k]) && fitsMorpheme('prep', words[k][OW.morph]));
        const [j, p] = best(i, js, 0.15);
        if (j >= 0) attachTo(i, h, j, p);
        return;
      }
      case 'conj': {
        if (!hebrew) return;
        const h = headAfter(i, false);
        if (h < 0) return;
        const fits = (k: number) => isHebPrefix(words[k]) && fitsMorpheme('conj', words[k][OW.morph]);
        let [j, p] = best(i, morphemesOf(chosen[h]!.j).filter(fits), 0.2);
        let at = h;
        if (j < 0) {
          // "And God made" = וַיַּעַשׂ אֱלֹהִים: the וְ is on the verb written just before the subject.
          const h2 = headAfter(h, false);
          const first = words[chosen[h]!.j][OW.group];
          if (h2 >= 0 && h2 <= h + 2) {
            const ms = morphemesOf(chosen[h2]!.j);
            if (ms[ms.length - 1] + 1 === first) {
              [j, p] = best(i, ms.filter(fits), 0.2);
              at = h2;
            }
          }
        }
        if (j >= 0) attachTo(i, at, j, p);
        return;
      }
      case 'aux': {
        const h = headAfter(i);
        if (h < 0 || h > i + 2) return;
        const root = chosen[h]!.j;
        if (!isVerb(words[root])) return;
        chosen[i] = { j: root, links: [root], score: chosen[h]!.score * 0.85, kind: 'aux' };
        return;
      }
      default:
        return;
    }
  });

  // Tokens.
  const aligned: AlignedWord[] = T.map((t, i) => {
    const c = chosen[i];
    if (!c || !c.links.length) return { text: t.text, cls: t.cls, links: [], score: 0, conf: 0 };
    return { text: t.text, cls: t.cls, links: [...c.links].sort((a, b) => a - b), score: c.score, conf: confidence(c.kind, t.cls, c.score), kind: c.kind };
  });
  const out: Token[] = [];
  const push = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (typeof last === 'string') out[out.length - 1] = last + s;
    else out.push(s);
  };
  let wi = 0;
  for (const s of segs) {
    if (!s.word) {
      push(s.text);
      continue;
    }
    const a = aligned[wi++];
    if (!a.links.length) {
      push(s.text);
      continue;
    }
    const tok: WordToken = [s.text, a.links, { c: a.conf }];
    out.push(tok);
  }
  return { tokens: out, words: aligned };
}

/**
 * Confidence written to TokenInfo.c: the precision measured for links of this kind and raw score by
 * scripts/data/eval-bridge.ts (KJV as held-out test text; midpoint of the strict and the
 * "verifiable" precision, see there), so 0.9 means "about 9 in 10 such links are right".
 */
function confidence(kind: LinkKind, cls: WordClass, score: number): number {
  if (cls === 'content') {
    switch (kind) {
      case 'lex':
        return score < 0.5 ? 0.75 : score < 0.9 ? 0.91 : 0.97;
      case 'table':
        return score < 0.5 ? 0.94 : score < 0.8 ? 0.96 : 0.98;
      case 'gloss':
        return score < 0.4 ? 0.82 : 0.9;
      default:
        return 0.82; // gap
    }
  }
  switch (kind) {
    case 'attach':
      return score >= 0.8 ? 0.97 : 0.92;
    case 'aux':
      return score < 0.5 ? 0.88 : 0.96;
    case 'lex':
      return score < 0.7 ? 0.75 : score < 0.9 ? 0.8 : 0.85;
    default:
      return score < 0.5 ? 0.75 : score < 0.6 ? 0.88 : 0.95; // table
  }
}

/** Greek words within `d` positions of j (pronouns that go with a noun or verb). */
function near(j: number, d: number, words: readonly OrigWord[]): number[] {
  const out: number[] = [];
  for (let k = Math.max(0, j - d); k <= Math.min(words.length - 1, j + d); k++) if (k !== j) out.push(k);
  return out;
}

/** Anchor (relative English position) of each candidate: mean position of the BSB words linking it, interpolated otherwise. */
function anchors(cand: readonly number[], B: readonly BsbWord[]): Map<number, number> {
  const sum = new Map<number, [number, number]>();
  for (const b of B) {
    for (const j of b.links) {
      const a = sum.get(j) ?? [0, 0];
      sum.set(j, [a[0] + b.pos, a[1] + 1]);
    }
  }
  const anchor = new Map<number, number>();
  for (const j of cand) {
    const a = sum.get(j);
    if (a) anchor.set(j, a[0] / a[1]);
  }
  cand.forEach((j, r) => {
    if (anchor.has(j)) return;
    let p = r - 1;
    while (p >= 0 && !anchor.has(cand[p])) p--;
    let q = r + 1;
    while (q < cand.length && !anchor.has(cand[q])) q++;
    const rel = cand.length > 1 ? r / (cand.length - 1) : 0.5;
    if (p >= 0 && q < cand.length) {
      const ap = anchor.get(cand[p])!;
      const aq = anchor.get(cand[q])!;
      anchor.set(j, ap + ((aq - ap) * (r - p)) / (q - p));
    } else if (p >= 0) anchor.set(j, Math.max(anchor.get(cand[p])!, rel));
    else if (q < cand.length) anchor.set(j, Math.min(anchor.get(cand[q])!, rel));
    else anchor.set(j, rel);
  });
  return anchor;
}

/** Plain text of a token list. */
const plain = (tokens: readonly Token[]) => tokens.map((t) => (typeof t === 'string' ? t : t[0])).join('');

/**
 * Link a whole chapter whose verses (and optional superscription) are plain text, e.g. a chapter
 * fetched from API.Bible. Headings / paragraphs are kept; tokens are replaced by linked ones.
 */
export function bridgeChapter(
  target: TextChapter,
  bsb: TextChapter | undefined,
  orig: OrigChapter,
  table: TranslationTable,
  options: Partial<BridgeOptions> = {},
): TextChapter {
  const bsbVerse = new Map<number, Token[]>((bsb?.verses ?? []).map((v) => [v.v, v.t]));
  const verses: TextVerse[] = target.verses.map((v) => ({ v: v.v, t: bridgeVerse(plain(v.t), bsbVerse.get(v.v), orig, v.v, table, options) }));
  const out: TextChapter = { ...target, verses };
  if (target.superscription) out.superscription = bridgeVerse(plain(target.superscription), bsb?.superscription, orig, 0, table, options);
  return out;
}
