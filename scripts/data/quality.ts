/**
 * Data-quality checks run by the validate stage (scripts/data/validate.ts), beyond structure: each
 * one guards a defect found in review, with a threshold the current pipeline must stay under.
 *
 *  lxx-greek       every Septuagint form (OW.lxx) is NFC Greek without CATSS markup
 *  lxx-chi-xi      share of LXX χ/ξ forms the SBLGNT attests only with χ and ξ swapped (Macula's column
 *                  is swapped throughout; the orig stage swaps it back)
 *  greek-nfc       SBLGNT text and lemmas are NFC
 *  groups          the morphemes of each Hebrew written word are contiguous
 *  homonyms        a Hebrew id whose dominant gloss fits none of its resolved lexicon entry's words while
 *                  a sibling entry (other letter, same number) fits (house -> "place")
 *  bsb-shift       BSB verses where 3+ content words match the gloss of a word linked by another token of
 *                  the verse but not their own (shuffled alignment records)
 *  kjv-bound       KJV content words linked only to Hebrew prefix / suffix morphemes ("fathers" -> נוּ)
 *  kjv-pass        KJV "came / come to pass" not linked to היה
 *  kjv-article     KJV NT content words linked only to the Greek article ("Jesus" -> τὴν)
 *  kjv-name        KJV clause words ("when", "came", "that") linked to a proper name only
 *  bridged-bound   WEB / ASV / YLT content words linked only to a Hebrew prefix / suffix ("coat" -> וְ)
 *  titles          every translation has a title in each psalm whose Hebrew has title words
 *  lex-markup      no raw STEP "Also means" markup ('": friend" H0157H') in definitions
 *  names-markup    no escaped markup or underscores in entity summaries
 */
import { existsSync, readdirSync } from 'node:fs';
import { isFunctionWord, wordClass } from '../../src/lib/align/normalize';
import type { LexChunk, NameEntityChunk, OrigChapter, TextChapter, Token } from '../../src/lib/types';
import { OW } from '../../src/lib/types';
import { allChapters, baseStrongs, chunkOf, outPath, readJson, readTsvColumns } from './common';
import { contentWords, stemWord } from './homonyms';
import { greekFold } from './lexicon';
import { isBoundMorpheme } from './kjv';

/** One check's outcome: `bad` items over `of`, failing when `bad > max`. */
export interface QualityResult {
  name: string;
  bad: number;
  of: number;
  max: number;
  samples: string[];
  note?: string;
}

class Check {
  bad = 0;
  of = 0;
  samples: string[] = [];
  constructor(
    readonly name: string,
    readonly max: number,
    readonly note = '',
  ) {}
  count(ok: boolean, sample?: () => string): void {
    this.of++;
    if (ok) return;
    this.bad++;
    if (this.samples.length < 8 && sample) this.samples.push(sample());
  }
  result(): QualityResult {
    return { name: this.name, bad: this.bad, of: this.of, max: this.max, samples: this.samples, note: this.note || undefined };
  }
}

const GREEK_ONLY = /^[\p{Script=Greek}̀-ͯ’ ]+$/u;
const PASS_TARGETS = new Set(['H1961', 'H1934']);
const swapChiXi = (s: string) => s.replace(/[χξ]/g, (c) => (c === 'χ' ? 'ξ' : 'χ'));

/** Words of a token's text (letters only, lower case). */
const lowerWord = (t: string) => t.toLowerCase().replace(/[^\p{L}’']/gu, '');

/** Does an English word fit a gloss? (stems compared; "garments" ~ "garment") */
function fitsGloss(word: string, gloss: string): boolean {
  const w = stemWord(lowerWord(word));
  if (!w) return false;
  return contentWords(gloss.replace(/\./g, ' ')).some((g) => g === w || (g.length >= 5 && w.length >= 5 && (g.startsWith(w) || w.startsWith(g))));
}

/** Content words of a lexicon entry (gloss, definition, KJV usage, Strong's definition). */
function entryWords(e: { gloss?: string; def?: string; kjv?: string; strongsDef?: string } | undefined): Set<string> {
  return new Set(contentWords([e?.gloss, e?.def, e?.kjv, e?.strongsDef].filter(Boolean).join(' ')));
}

const tokensOf = (tc: TextChapter): { v: number; t: Token[] }[] => [...(tc.superscription ? [{ v: 0, t: tc.superscription }] : []), ...tc.verses];

export function runQualityChecks(translations: readonly string[], morphemes: ReadonlySet<string>): QualityResult[] {
  const lxxGreek = new Check('lxx-greek', 0, 'Septuagint forms that are not NFC Greek');
  const lxxSwap = new Check('lxx-chi-xi', 0, 'LXX χ/ξ forms attested in the SBLGNT only with χ and ξ swapped (max = 2% of those attested)');
  const greekNfc = new Check('greek-nfc', 0, 'non-NFC SBLGNT text / lemmas');
  const groups = new Check('groups', 0, 'Hebrew written words whose morphemes are not contiguous');
  const bsbShift = new Check('bsb-shift', 150, 'BSB verses with 3+ content words matching a neighbour’s gloss but not their own');
  const kjvBound = new Check('kjv-bound', 400, 'KJV OT content words linked only to a prefix / suffix morpheme');
  const kjvPass = new Check('kjv-pass', 30, 'KJV “came / come to pass” not linked to היה');
  const kjvArticle = new Check('kjv-article', 200, 'KJV NT content words linked only to the Greek article');
  const kjvName = new Check('kjv-name', 600, 'KJV clause words (that, when, came, so…) linked only to a proper name');
  const bridgedBound = new Check('bridged-bound', 300, 'WEB / ASV / YLT content words linked only to a Hebrew prefix / suffix (per translation, max shown is for each)');
  const titles = new Check('titles', 0, 'psalms with Hebrew title words but no title in a translation');

  // SBLGNT surface forms (folded), for the χ/ξ check.
  const sblgnt = new Set<string>();
  for (const r of readTsvColumns('SBLGNT.tsv', ['text'] as const)) if (r.text) sblgnt.add(greekFold(r.text));

  const bridgedCounts = new Map<string, number>();
  const usage = new Map<string, Map<string, number>>(); // Hebrew id -> gloss content word -> count
  let lxxAttested = 0;

  for (const { book, chapter } of allChapters()) {
    const p = outPath('orig', book.id, `${chapter}.json`);
    if (!existsSync(p)) continue;
    const oc = readJson<OrigChapter>(p);
    const words = oc.words;
    const where = `${book.id} ${chapter}`;
    // orig
    const lastOfGroup = new Map<number, number>();
    words.forEach((w, i) => {
      if (oc.lang === 'grc') greekNfc.count(w[OW.text] === w[OW.text].normalize('NFC') && w[OW.lemma] === w[OW.lemma].normalize('NFC'), () => `${where}#${i} ${w[OW.text]}`);
      else {
        const g = w[OW.group];
        groups.count(g === i || lastOfGroup.get(g) === i - 1, () => `${where}#${i} ${w[OW.text]} (group ${g})`);
        lastOfGroup.set(g, i);
        if (w[OW.lxx]) {
          const form = w[OW.lxx].split('|')[0];
          lxxGreek.count(form === form.normalize('NFC') && GREEK_ONLY.test(form), () => `${where}#${i} "${form}"`);
          for (const f of form.split(' ')) {
            if (!/[χξ]/.test(f)) continue;
            const k = greekFold(f);
            const as = sblgnt.has(k);
            const sw = sblgnt.has(greekFold(swapChiXi(f)));
            if (as || sw) lxxAttested++;
            if (sw && !as) lxxSwap.count(false, () => `${where}#${i} ${f}`);
          }
        }
        const s = w[OW.strongs];
        if (s && !morphemes.has(s) && !/^[CRST]/.test(w[OW.morph])) {
          let m = usage.get(s);
          if (!m) usage.set(s, (m = new Map()));
          for (const c of new Set(contentWords(w[OW.gloss].replace(/\./g, ' ')))) m.set(c, (m.get(c) ?? 0) + 1);
        }
      }
    });
    const hasTitle = words.some((w) => w[OW.verse] === 0);

    for (const tr of translations) {
      const tp = outPath('text', tr, book.id, `${chapter}.json`);
      if (!existsSync(tp)) continue;
      const tc = readJson<TextChapter>(tp);
      if (book.id === 'PSA' && hasTitle) titles.count(!!tc.superscription?.length, () => `${tr} PSA ${chapter}`);
      for (const { v, t } of tokensOf(tc)) {
        const wordToks = t.filter((x): x is Exclude<Token, string> => typeof x !== 'string');
        // BSB: shifted records
        if (tr === 'BSB' && v > 0) {
          let shifted = 0;
          for (const tok of wordToks) {
            if (!tok[1].length || isFunctionWord(tok[0]) || wordClass(tok[0]) !== 'content') continue;
            if (tok[1].some((j) => fitsGloss(tok[0], words[j]?.[OW.gloss] ?? ''))) continue;
            const others = wordToks.filter((o) => o !== tok).flatMap((o) => o[1]).filter((j) => !tok[1].includes(j));
            if (others.some((j) => fitsGloss(tok[0], words[j]?.[OW.gloss] ?? ''))) shifted++;
          }
          bsbShift.count(shifted < 3, () => `${book.id} ${chapter}:${v} (${shifted})`);
        }
        const content = (tok: Exclude<Token, string>) => wordClass(tok[0]) === 'content' && !isFunctionWord(tok[0]) && /^\p{Ll}/u.test(tok[0]);
        if (tr === 'KJV') {
          for (let k = 0; k < wordToks.length; k++) {
            const tok = wordToks[k];
            const links = tok[1];
            if (!links.length) continue;
            if (oc.lang === 'hbo') {
              if (content(tok)) kjvBound.count(!links.every((j) => isBoundMorpheme(words, j)), () => `${where}:${v} "${tok[0]}"`);
              if (lowerWord(tok[0]) === 'pass' && k > 0 && /^(?:to)$/i.test(wordToks[k - 1][0])) {
                kjvPass.count(links.some((j) => PASS_TARGETS.has(baseStrongs(words[j]?.[OW.strongs] ?? ''))), () => `${where}:${v}`);
              }
              if (/^(?:that|when|then|so|came|pass|it|was|behold|and)$/i.test(tok[0]) && /^\p{Ll}/u.test(tok[0])) {
                kjvName.count(!links.every((j) => /^Np/.test(words[j]?.[OW.morph] ?? '')), () => `${where}:${v} "${tok[0]}"`);
              }
            } else if (content(tok) && !/^(?:things?|ones?|some|those|these|others?)$/i.test(tok[0])) {
              kjvArticle.count(!links.every((j) => words[j]?.[OW.strongs] === 'G3588'), () => `${where}:${v} "${tok[0]}"`);
            }
          }
        }
        if ((tr === 'WEB' || tr === 'ASV' || tr === 'YLT') && oc.lang === 'hbo') {
          for (const tok of wordToks) {
            if (!tok[1].length || !content(tok)) continue;
            if (tok[1].every((j) => isBoundMorpheme(words, j))) {
              bridgedCounts.set(tr, (bridgedCounts.get(tr) ?? 0) + 1);
              if (bridgedBound.samples.length < 8) bridgedBound.samples.push(`${tr} ${where}:${v} "${tok[0]}"`);
            }
          }
        }
      }
    }
  }

  // bridged-bound: the worst translation's count.
  bridgedBound.of = translations.length;
  bridgedBound.bad = Math.max(0, ...bridgedCounts.values());
  bridgedBound.samples.unshift([...bridgedCounts].map(([t, n]) => `${t} ${n}`).join(', ') || 'none');

  // lxx-chi-xi: fail above 2% of attested forms.
  const swapResult = lxxSwap.result();
  swapResult.of = lxxAttested;
  swapResult.max = Math.floor(lxxAttested * 0.02);

  // homonyms: the dominant gloss word of each id against its resolved entry and its siblings.
  const homonyms = new Check('homonyms', 20, 'Hebrew ids (10+ uses) whose resolved lexicon entry fits none of their dominant gloss while a sibling entry does');
  const lex = new Map<string, LexChunk>();
  const chunk = (id: string): LexChunk => {
    const k = `${id[0]}/${chunkOf(id)}`;
    if (!lex.has(k)) {
      const p = outPath('lex', id[0], `${chunkOf(id)}.json`);
      lex.set(k, existsSync(p) ? readJson<LexChunk>(p) : {});
    }
    return lex.get(k)!;
  };
  for (const [id, m] of usage) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    if (total < 10) continue;
    const dominant = [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!dominant) continue;
    const c = chunk(id);
    const resolved = c[id] ?? c[baseStrongs(id)];
    if (!resolved) continue;
    const fits = (e: (typeof c)[string] | undefined) => {
      const ws = entryWords(e);
      return ws.has(dominant) || [...ws].some((w) => w.length >= 5 && dominant.length >= 5 && (w.startsWith(dominant) || dominant.startsWith(w)));
    };
    const siblings = Object.keys(c).filter((k) => k !== resolved.id && baseStrongs(k) === baseStrongs(id) && /[a-z]$/.test(k) && !morphemes.has(k));
    homonyms.count(fits(resolved) || !siblings.some((k) => fits(c[k])), () => `${id} "${dominant}" -> ${resolved.id} "${resolved.gloss}" (sibling ${siblings.find((k) => fits(c[k]))})`);
  }

  // lexicon markup
  const lexMarkup = new Check('lex-markup', 0, 'definitions with raw STEP “Also means” markup');
  for (const lang of ['G', 'H']) {
    const dir = outPath('lex', lang);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      for (const [id, e] of Object.entries(readJson<LexChunk>(`${dir}/${f}`))) lexMarkup.count(!/": [^"]*" [GH]\d{3,4}/.test(e.def), () => id);
    }
  }

  // entity summaries
  const namesMarkup = new Check('names-markup', 0, 'entity summaries with escaped markup or underscores');
  for (const k of ['p', 'l', 'g']) {
    const dir = outPath('names', 'entities', k);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      for (const [id, e] of Object.entries(readJson<NameEntityChunk>(`${dir}/${f}`))) {
        const plain = e.summary.replace(/<\/?(?:b|i|br)>|<span class="ref"[^>]*>|<\/span>/g, '');
        namesMarkup.count(!/&lt;(?=\S)|(?<=\S)&gt;|(?<=\p{L})_(?=\p{L})/u.test(plain), () => id);
      }
    }
  }

  return [
    lxxGreek.result(),
    swapResult,
    greekNfc.result(),
    groups.result(),
    homonyms.result(),
    bsbShift.result(),
    kjvBound.result(),
    kjvPass.result(),
    kjvArticle.result(),
    kjvName.result(),
    bridgedBound.result(),
    titles.result(),
    lexMarkup.result(),
    namesMarkup.result(),
  ];
}
