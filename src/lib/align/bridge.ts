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
  det: Number.POSITIVE_INFINITY,
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

interface Choice {
  /** The original word this choice is about (claimed). */
  j: number;
  /** Links to emit (j, or the whole link set of the matching BSB word). */
  links: number[];
  score: number;
}

const GLOSS_STOP = new Set(['[direct', 'object]', '*']);

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
  const opt = { ...DEFAULT_BRIDGE_OPTIONS, ...options };
  const words = orig.words;
  const hebrew = orig.lang === 'hbo';

  const segs = segment(text);
  const tw = segs.filter((s) => s.word).map((s) => s.text);
  const tl = lemmas(tw);
  const T: Target[] = tw.map((w, i) => ({ text: w, lemma: tl[i], cls: wordClass(w), pos: tw.length > 1 ? i / (tw.length - 1) : 0.5 }));

  // Candidates: this verse's original words, plus anything the BSB verse links to.
  const candSet = new Set<number>();
  words.forEach((w, j) => {
    if (w[OW.verse] === verse) candSet.add(j);
  });
  const bw = tokenWords(bsb ?? []);
  const bl = lemmas(bw.map((w) => w.text));
  const B: BsbWord[] = bw.map((w, k) => ({
    lemma: bl[k],
    links: w.links.filter((j) => j >= 0 && j < words.length),
    pos: bw.length > 1 ? k / (bw.length - 1) : 0.5,
  }));
  for (const b of B) for (const j of b.links) candSet.add(j);
  const cand = [...candSet].sort((a, b) => a - b);
  if (!T.length || !cand.length) return text ? [text] : [];
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
  const glossCache = new Map<number, Set<string>>();
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
      if (fn && tab < Math.min(min, LEX_FN_MIN)) continue;
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
      const pj = posSim(t.pos, anchor.get(j)!, opt.sigma);
      const score = ev * (0.4 + 0.6 * pj);
      if (score < (fn ? opt.minFunction : opt.minContent)) continue;
      // Content words take the matching BSB word's link set, minus the parts the table says this
      // word does not render (the וְ / suffix of "and brought him", the μή of "shall not perish"),
      // which are left for the function words. Function words take only the original word itself.
      const links =
        !fn && lex >= 0.5 && lexLinks
          ? lexLinks.filter((k) => inCand.has(k) && (k === j || prob(i, k) >= (bound.has(k) ? 0.3 : 0.1)))
          : [j];
      list.push({ j, links, score });
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
  compete(T.map((_, i) => i).filter((i) => T[i].cls !== 'content'));

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
    claim(i, { j, links: [j], score: Math.min(chosen[head]!.score, 0.45 + p / 2) });
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
        chosen[i] = { j: root, links: [root], score: chosen[h]!.score * 0.85 };
        return;
      }
      default:
        return;
    }
  });

  // Tokens.
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
    const c = chosen[wi++];
    if (!c || !c.links.length) {
      push(s.text);
      continue;
    }
    const tok: WordToken = [s.text, [...c.links].sort((a, b) => a - b), { c: confidence(c.score) }];
    out.push(tok);
  }
  return out;
}

/** Calibrated confidence from a raw score (see eval-bridge.ts). */
function confidence(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
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
