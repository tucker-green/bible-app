/**
 * Stage "kjv": the King James Version with its own Strong's tagging -> public/data/text/KJV/{BOOK}/{C}.json
 *
 * Source: CrossWire's KJV module as JSON (npm @metaxia/scriptures-source-crosswire-kjv, packed in
 * .cache/sources/kjv-crosswire.tgz and extracted to .cache/kjv/). Each verse lists its words with
 *   lemma  "strong:G3588 strong:G2316 lemma.TR:ο lemma.TR:θεος"  (Strong's + Textus Receptus form)
 *   morph  "robinson:T-NSM robinson:N-NSM" (NT)  /  "strongMorph:TH8804" (OT, not decodable)
 *   metadata.src   TR word positions (NT, most verses), metadata.type "added" (italics) or
 *                  "x-split-N" (one original word rendered by separated English words).
 * Words are linked to the original word of the SAME English verse (OrigChapter, SBLGNT / WLC)
 * with the same base Strong's number. When a number occurs more than once, occurrences are matched
 * to candidates monotonically by relative position (TR positions when known); an article+noun tag
 * ("God" = ὁ θεός) links both words, the article being the one next to the noun. In the OT, where
 * the KJV tags a whole Hebrew word ("And the earth" = וְהָאָרֶץ), the English function words go to
 * the prefix / suffix morpheme they translate when the BSB-trained table says so ("And" -> וְ).
 * Numbers that cannot be linked (TR-only words, other lexical choices) stay on the token as
 * TokenInfo.s (+ m morphology, o TR form) so the word card can still show a lexicon entry.
 * Italic (translator-supplied) words get TokenInfo.i = 1. "Lord"/"God" tagged as the divine name
 * (H3068/H3069/H3050) are printed "LORD"/"GOD" as in printed KJVs. Pauline subscriptions
 * (colophons) are left out of the verse text.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isFunctionWord, lemmas } from '../../src/lib/align/normalize';
import { TableBuilder, type TranslationTable } from '../../src/lib/align/table';
import { segment } from '../../src/lib/tokenize';
import type { BookId, OrigChapter, OrigWord, TextChapter, TextVerse, Token, TokenInfo, WordToken } from '../../src/lib/types';
import { OW } from '../../src/lib/types';
import { allChapters, baseStrongs, cleanOut, log, normStrongs, outPath, readJson, ROOT, srcPath, writeJson } from './common';

/* ------------------------------------------------------------------------ */
/* Source                                                                    */
/* ------------------------------------------------------------------------ */

/** CrossWire / OSIS book directory -> USFM id. */
export const KJV_BOOK_DIRS: Record<string, BookId> = {
  Gen: 'GEN', Exod: 'EXO', Lev: 'LEV', Num: 'NUM', Deut: 'DEU', Josh: 'JOS', Judg: 'JDG', Ruth: 'RUT',
  '1Sam': '1SA', '2Sam': '2SA', '1Kgs': '1KI', '2Kgs': '2KI', '1Chr': '1CH', '2Chr': '2CH', Ezra: 'EZR',
  Neh: 'NEH', Esth: 'EST', Job: 'JOB', Ps: 'PSA', Prov: 'PRO', Eccl: 'ECC', Song: 'SNG', Isa: 'ISA',
  Jer: 'JER', Lam: 'LAM', Ezek: 'EZK', Dan: 'DAN', Hos: 'HOS', Joel: 'JOL', Amos: 'AMO', Obad: 'OBA',
  Jonah: 'JON', Mic: 'MIC', Nah: 'NAM', Hab: 'HAB', Zeph: 'ZEP', Hag: 'HAG', Zech: 'ZEC', Mal: 'MAL',
  Matt: 'MAT', Mark: 'MRK', Luke: 'LUK', John: 'JHN', Acts: 'ACT', Rom: 'ROM', '1Cor': '1CO', '2Cor': '2CO',
  Gal: 'GAL', Eph: 'EPH', Phil: 'PHP', Col: 'COL', '1Thess': '1TH', '2Thess': '2TH', '1Tim': '1TI',
  '2Tim': '2TI', Titus: 'TIT', Phlm: 'PHM', Heb: 'HEB', Jas: 'JAS', '1Pet': '1PE', '2Pet': '2PE',
  '1John': '1JN', '2John': '2JN', '3John': '3JN', Jude: 'JUD', Rev: 'REV',
};

/** Raw word object of the CrossWire JSON. */
export interface KjvRawWord {
  text: string;
  lemma?: string | null;
  morph?: string | null;
  metadata?: { src?: string; type?: string; colophon?: boolean } | null;
}

/** One Strong's tag of an English word. */
export interface KjvTag {
  /** Normalised Strong's id ("G0025", "H1961"). */
  strongs: string;
  /** Robinson code (NT) or Strong's TVM code "TH8804" (OT); "" if none. */
  morph: string;
  /** Textus Receptus form (NT), "" if none. */
  form: string;
  /** 1-based TR word position in the verse (NT), 0 if unknown. */
  src: number;
}

/** One `words[]` entry: usually one English word, sometimes a phrase ("the name of"), or bare punctuation. */
export interface KjvEntry {
  text: string;
  tags: KjvTag[];
  /** Italics: supplied by the translators. */
  added: boolean;
  /** x-split group id ("x-split-1793") or "". */
  split: string;
  /** The raw lemma attribute (consecutive identical ones are one tagged element). */
  lemmaAttr: string;
}

export interface KjvVerse {
  verse: number;
  entries: KjvEntry[];
}

const DIVINE_NAME = new Set(['H3068', 'H3069', 'H3050']);

/** Parse one raw word. */
export function parseKjvWord(w: KjvRawWord): KjvEntry {
  const lemmaAttr = (w.lemma ?? '').trim();
  const strongs: string[] = [];
  const forms: string[] = [];
  for (const part of lemmaAttr.split(/\s+/)) {
    if (!part) continue;
    const m = /^(?:strong:)?([GH])(\d+[a-z]?)$/i.exec(part);
    if (m) {
      const id = normStrongs(m[1].toUpperCase() as 'G' | 'H', m[2]);
      if (id && !/^[GH]0000$/.test(id)) strongs.push(id);
      continue;
    }
    const tr = /^lemma\.TR:(.+)$/.exec(part);
    if (tr) forms.push(tr[1]);
  }
  const morphs = (w.morph ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((m) => m.replace(/^(?:robinson|strongMorph):/, ''));
  const srcs = (w.metadata?.src ?? '').split(/\s+/).filter(Boolean).map(Number);
  const tags: KjvTag[] = strongs.map((s, i) => ({
    strongs: s,
    morph: morphs.length === strongs.length ? morphs[i] : strongs.length === 1 ? (morphs[0] ?? '') : '',
    form: forms.length === strongs.length ? forms[i] : strongs.length === 1 ? (forms[0] ?? '') : '',
    src: srcs.length === strongs.length ? srcs[i] : (srcs[0] ?? 0),
  }));
  const type = w.metadata?.type ?? '';
  return {
    text: cleanEntryText(w.text, tags),
    tags,
    added: type === 'added',
    split: type.startsWith('x-split') ? type : '',
    lemmaAttr,
  };
}

/** Tidy one entry's text: en dashes inside names become hyphens; the divine name is printed in capitals. */
export function cleanEntryText(text: string, tags: readonly KjvTag[]): string {
  let t = text.trim().replace(/(?<=\p{L})[–‑](?=\p{L})/gu, '-');
  if (tags.length === 1 && DIVINE_NAME.has(tags[0].strongs)) {
    t = t.replace(/^(Lord|God|Jehovah|Jah)(?=$|[^\p{L}])/u, (m) => m.toUpperCase());
  }
  return t;
}

/** Directory with the extracted CrossWire JSON (extracting the tarball on first use). */
export function kjvDataDir(): string {
  const dir = join(ROOT, '.cache', 'kjv');
  const data = join(dir, 'package', 'data', 'crosswire-KJV');
  if (!existsSync(data)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['xzf', srcPath('kjv-crosswire.tgz'), '-C', dir]);
  }
  if (!existsSync(data)) throw new Error(`KJV data not found in ${data}`);
  return data;
}

/** Every KJV verse, keyed "BOOK C" (e.g. "JHN 3"), verses in order. Colophon words are dropped. */
export function readKjv(): Map<string, KjvVerse[]> {
  const root = kjvDataDir();
  const out = new Map<string, KjvVerse[]>();
  for (const dir of readdirSync(root)) {
    if (dir.endsWith('.json')) continue;
    const book = KJV_BOOK_DIRS[dir];
    if (!book) throw new Error(`Unknown KJV book directory ${dir}`);
    for (const c of readdirSync(join(root, dir))) {
      const verses: KjvVerse[] = [];
      for (const f of readdirSync(join(root, dir, c))) {
        const raw = JSON.parse(readFileSync(join(root, dir, c, f), 'utf8')) as { words: KjvRawWord[] };
        const entries = raw.words.filter((w) => !w.metadata?.colophon && w.text.trim()).map(parseKjvWord);
        verses.push({ verse: Number(f.replace(/\.json$/, '')), entries });
      }
      verses.sort((a, b) => a.verse - b.verse);
      out.set(`${book} ${Number(c)}`, verses);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Text                                                                      */
/* ------------------------------------------------------------------------ */

/** One English word of a verse and the entry it came from. */
export interface KjvWord {
  text: string;
  entry: number;
}

/**
 * Lay out a verse: each entry's text, separated by a space unless the entry is closing punctuation
 * (",)" ";)") or the previous one opens a bracket. Returns the pieces (in order; joining them gives
 * the verse text) with the entry index of each word piece (-1 for spaces / punctuation).
 */
export function layoutVerse(entries: readonly KjvEntry[]): { text: string; entry: number; word: boolean }[] {
  const out: { text: string; entry: number; word: boolean }[] = [];
  let prev = '';
  entries.forEach((e, k) => {
    if (!e.text) return;
    if (prev && !/^[,.;:?!)\]’”]/.test(e.text) && !/[([‘“]$/.test(prev)) out.push({ text: ' ', entry: -1, word: false });
    for (const s of segment(e.text)) out.push({ text: s.text, entry: s.word ? k : -1, word: s.word });
    prev = e.text;
  });
  return out;
}

/** Plain verse text. */
export const kjvVerseText = (entries: readonly KjvEntry[]) => layoutVerse(entries).map((p) => p.text).join('');

/* ------------------------------------------------------------------------ */
/* Linking                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Monotone assignment of occurrences to candidates (both given as relative positions 0..1 in
 * order), minimising the summed position difference. With at least as many candidates as
 * occurrences each candidate is used at most once; otherwise candidates may be shared (in order).
 * Returns the candidate index for each occurrence.
 */
export function monotoneAssign(occ: readonly number[], cand: readonly number[]): number[] {
  const n = occ.length;
  const m = cand.length;
  if (!n) return [];
  if (!m) return occ.map(() => -1);
  const strict = n <= m;
  // dp[i][j]: best cost with occurrence i assigned to candidate j.
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(INF));
  const back: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-1));
  for (let j = 0; j < m; j++) dp[0][j] = Math.abs(occ[0] - cand[j]);
  for (let i = 1; i < n; i++) {
    let best = INF;
    let bestK = -1;
    for (let j = 0; j < m; j++) {
      // best over k < j (strict) or k <= j (shared)
      const k = strict ? j - 1 : j;
      if (k >= 0 && dp[i - 1][k] < best) {
        best = dp[i - 1][k];
        bestK = k;
      }
      if (best < INF) {
        dp[i][j] = best + Math.abs(occ[i] - cand[j]);
        back[i][j] = bestK;
      }
    }
  }
  let j = 0;
  for (let k = 1; k < m; k++) if (dp[n - 1][k] < dp[n - 1][j]) j = k;
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = j;
    j = back[i][j];
  }
  return out;
}

export interface LinkedWord {
  text: string;
  links: number[];
  info?: TokenInfo;
}

const ARTICLE = 'G3588';
const OBJECT_PRONOUNS = new Set(['him', 'them', 'me', 'us', 'thee', 'it', 'her', 'you']);

export interface KjvLinkOptions {
  /** BSB-trained table: redirects English function words inside a tagged Hebrew word to its prefix / suffix. */
  table?: TranslationTable;
  /** Match keys of original word j (default: its base Strong's id). */
  keysOf?: (j: number) => readonly string[];
  /** Learned equivalences: KJV Strong's -> source Strong's used for the same word (H3212 -> H1980). */
  equiv?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Link one KJV verse. `cand` are the indices of the OrigChapter words this English verse may link
 * to (its own words, plus words of adjacent verses the KJV has no verse for). `table` (BSB-trained)
 * redirects English function words inside a tagged Hebrew word to the prefix / suffix they render.
 */
export function linkKjvVerse(
  entries: readonly KjvEntry[],
  words: readonly OrigWord[],
  cand: readonly number[],
  opts: KjvLinkOptions = {},
): { pieces: { text: string; word?: LinkedWord }[]; tags: number; linked: number; unlinked: string[]; free: string[] } {
  const { table, equiv } = opts;
  const keysOf = opts.keysOf ?? ((j: number) => (words[j][OW.strongs] ? [baseStrongs(words[j][OW.strongs])] : []));
  const layout = layoutVerse(entries);
  // Occurrence = one original word the verse refers to (a Strong's number at a TR position, an
  // x-split group, or a run of consecutive entries with the same lemma attribute).
  const maxSrc = Math.max(0, ...entries.flatMap((e) => e.tags.map((t) => t.src)));
  const nE = entries.length;
  const runOf: number[] = [];
  let run = 0;
  entries.forEach((e, k) => {
    const prev = entries[k - 1];
    if (k > 0 && (!e.lemmaAttr || e.lemmaAttr !== prev.lemmaAttr || /[,;:.?!]$/.test(prev.text))) run++;
    runOf.push(run);
  });
  type Occ = { key: string; base: string; pos: number; entries: Set<number> };
  const occs = new Map<string, Occ>();
  const occOfTag = entries.map((e) => e.tags.map(() => ''));
  entries.forEach((e, k) => {
    e.tags.forEach((t, ti) => {
      const base = baseStrongs(t.strongs);
      const key = t.src && maxSrc ? `${base}@${t.src}` : e.split ? `${base}#${e.split}` : `${base}~${runOf[k]}`;
      occOfTag[k][ti] = key;
      let o = occs.get(key);
      if (!o) {
        const pos = t.src && maxSrc > 1 ? (t.src - 1) / (maxSrc - 1) : nE > 1 ? k / (nE - 1) : 0;
        occs.set(key, (o = { key, base, pos, entries: new Set() }));
      }
      o.entries.add(k);
    });
  });
  // Candidates by match key, with relative position in the verse's original words.
  type Cand = { j: number; pos: number };
  const candBy = new Map<string, Cand[]>();
  cand.forEach((j, r) => {
    for (const key of keysOf(j)) {
      let list = candBy.get(key);
      if (!list) candBy.set(key, (list = []));
      list.push({ j, pos: cand.length > 1 ? r / (cand.length - 1) : 0 });
    }
  });
  const assigned = new Map<string, number>();
  const extraLinks = new Map<string, number[]>();
  const byBase = new Map<string, Occ[]>();
  for (const o of occs.values()) {
    const list = byBase.get(o.base);
    if (list) list.push(o);
    else byBase.set(o.base, [o]);
  }
  for (const list of byBase.values()) list.sort((a, b) => a.pos - b.pos);
  const assign = (list: readonly Occ[], cs: readonly Cand[]) => {
    const pick = monotoneAssign(
      list.map((o) => o.pos),
      cs.map((c) => c.pos),
    );
    list.forEach((o, i) => {
      if (pick[i] >= 0) assigned.set(o.key, cs[pick[i]].j);
    });
  };
  // 1. Same Strong's number (or another form-number of the same Greek lemma).
  for (const [base, list] of byBase) {
    const cs = candBy.get(base);
    if (cs) assign(list, cs);
  }
  // 2. Learned equivalences (the KJV's Strong's vs the source's own choice, e.g. H3212 / H1980),
  //    only to words nothing else links.
  if (equiv) {
    const taken = new Set(assigned.values());
    for (const [base, list] of byBase) {
      const rest = list.filter((o) => !assigned.has(o.key));
      const eq = rest.length ? equiv.get(base) : undefined;
      if (!eq) continue;
      const seen = new Set<number>();
      const cs: Cand[] = [];
      for (const s of eq) for (const c of candBy.get(s) ?? []) if (!taken.has(c.j) && !seen.has(c.j)) (seen.add(c.j), cs.push(c));
      if (!cs.length) continue;
      cs.sort((a, b) => a.j - b.j);
      assign(rest, cs);
      for (const o of rest) if (assigned.has(o.key)) taken.add(assigned.get(o.key)!);
    }
  }
  // Article + noun on one English word: the article is the one just before the noun (TR offset).
  entries.forEach((e, k) => {
    if (e.tags.length < 2) return;
    const anchorIdx = e.tags.findIndex((t, ti) => t.strongs !== ARTICLE && assigned.has(occOfTag[k][ti]));
    if (anchorIdx < 0) return;
    const anchor = e.tags[anchorIdx];
    const aj = assigned.get(occOfTag[k][anchorIdx])!;
    e.tags.forEach((t, ti) => {
      if (t.strongs !== ARTICLE) return;
      const offset = t.src && anchor.src ? t.src - anchor.src : -1;
      const want = aj + offset;
      let best = -1;
      for (const c of candBy.get(ARTICLE) ?? []) {
        if (Math.abs(c.j - want) > 3) continue;
        if (best < 0 || Math.abs(c.j - want) < Math.abs(best - want)) best = c.j;
      }
      if (best >= 0) assigned.set(occOfTag[k][ti], best);
    });
  });

  // A name written as two words with one number (בַּעַל חָנָן "Baal-hanan"): take the neighbours too.
  {
    const taken = new Set(assigned.values());
    const extra = new Map<string, number[]>();
    for (const o of occs.values()) {
      const j = assigned.get(o.key);
      if (j === undefined) continue;
      const pos = cand.indexOf(j);
      const more: number[] = [];
      for (const dir of [-1, 1]) {
        for (let r = pos + dir; r >= 0 && r < cand.length; r += dir) {
          const k = cand[r];
          if (taken.has(k) || !words[k][OW.strongs] || baseStrongs(words[k][OW.strongs]) !== baseStrongs(words[j][OW.strongs])) break;
          more.push(k);
        }
      }
      if (more.length) {
        extra.set(o.key, more);
        more.forEach((k) => taken.add(k));
      }
    }
    for (const [key, more] of extra) extraLinks.set(key, more);
  }

  // Per entry: links + unlinked tags.
  const entryLinks: number[][] = entries.map((e, k) => {
    const s = new Set<number>();
    e.tags.forEach((_, ti) => {
      const j = assigned.get(occOfTag[k][ti]);
      if (j !== undefined) s.add(j);
      for (const x of extraLinks.get(occOfTag[k][ti]) ?? []) s.add(x);
    });
    return [...s].sort((a, b) => a - b);
  });

  // Words, with OT prefix/suffix refinement inside runs of English words sharing one tagged element.
  const wordPieces = layout.filter((p) => p.word);
  const lem = lemmas(wordPieces.map((p) => p.text));
  const wordLinks = wordPieces.map((p) => entryLinks[p.entry]);
  if (table) {
    // Group word indices by (run, tagged element) for single-tag entries linked to one Hebrew word.
    const groups = new Map<string, number[]>();
    wordPieces.forEach((p, wi) => {
      const e = entries[p.entry];
      if (e.tags.length !== 1 || entryLinks[p.entry].length !== 1 || !e.tags[0].strongs.startsWith('H')) return;
      const key = `${runOf[p.entry]}|${occOfTag[p.entry][0]}`;
      const list = groups.get(key);
      if (list) list.push(wi);
      else groups.set(key, [wi]);
    });
    for (const list of groups.values()) {
      const root = wordLinks[list[0]][0];
      const g = words[root][OW.group];
      const morphemes: number[] = [];
      for (let j = g; j < words.length && words[j][OW.group] === g; j++) if (j !== root) morphemes.push(j);
      if (!morphemes.length) continue;
      const rootS = words[root][OW.strongs];
      // In a run of several words, the root stays on the content word that best renders it.
      let keep = -1;
      if (list.length > 1) {
        for (const wi of list) {
          if (isFunctionWord(wordPieces[wi].text)) continue;
          if (keep < 0 || table.prob(lem[wi], rootS) > table.prob(lem[keep], rootS)) keep = wi;
        }
      }
      const used = new Set<number>();
      for (const wi of list) {
        // Only function words (and, the, in, his…) move to a prefix / suffix morpheme.
        if (wi === keep || !isFunctionWord(wordPieces[wi].text)) continue;
        let best = -1;
        let bestP = 0;
        for (const j of morphemes) {
          if (used.has(j)) continue;
          const p = table.prob(lem[wi], words[j][OW.strongs]);
          if (p > bestP) {
            bestP = p;
            best = j;
          }
        }
        if (best >= 0 && bestP >= 0.15 && bestP > 2 * table.prob(lem[wi], rootS)) {
          wordLinks[wi] = [best];
          used.add(best);
        }
      }
    }
  }

  // The KJV's OT tagging often starts a tagged element with the object pronoun of the PREVIOUS
  // verb ("number | them, every one that entereth" = H935; "Deliver | me from the workers" = H6466).
  // Such a pronoun is moved to the pronominal suffix of the preceding word (or of the object marker /
  // preposition right after it: אֹתָם, לָהֶם) when the table backs the pairing.
  if (table) {
    const linkedIdx = new Set(wordLinks.flat());
    wordPieces.forEach((p, wi) => {
      if (wi === 0 || !OBJECT_PRONOUNS.has(p.text.toLowerCase())) return;
      const e = entries[p.entry];
      const prev = entries[wordPieces[wi - 1].entry];
      const links = wordLinks[wi];
      if (e.tags.length !== 1 || links.length !== 1 || !e.tags[0].strongs.startsWith('H')) return;
      if (p.entry > 0 && runOf[p.entry] === runOf[wordPieces[wi - 1].entry]) return; // not the first word of its element
      if (wi + 1 >= wordPieces.length || runOf[wordPieces[wi + 1].entry] !== runOf[p.entry]) return; // the element is just the pronoun
      if (words[links[0]][OW.morph].startsWith('S') || !prev.tags.length) return;
      const before = wordLinks[wi - 1];
      if (before.length !== 1) return;
      const g = words[before[0]][OW.group];
      const group = (start: number) => {
        const out: number[] = [];
        for (let k = start; k < words.length && words[k][OW.group] === start; k++) out.push(k);
        return out;
      };
      const own = group(g);
      const after = own[own.length - 1] + 1;
      const pool = [...own, ...(after < words.length ? group(after) : [])].filter((k) => words[k][OW.morph].startsWith('S') && !linkedIdx.has(k));
      let best = -1;
      let bestP = 0;
      for (const k of pool) {
        const pr = table.prob(lem[wi], words[k][OW.strongs]);
        if (pr > bestP) {
          bestP = pr;
          best = k;
        }
      }
      if (best >= 0 && bestP >= 0.03) {
        wordLinks[wi] = [best];
        linkedIdx.add(best);
      }
    });
  }

  let tags = 0;
  let linked = 0;
  let wi = 0;
  const pieces = layout.map((p) => {
    if (!p.word) return { text: p.text };
    const e = entries[p.entry];
    const links = wordLinks[wi++];
    const info: TokenInfo = {};
    if (e.added) info.i = 1;
    const unlinked = e.tags.filter((_, ti) => !assigned.has(occOfTag[p.entry][ti]));
    if (unlinked.length) {
      info.s = unlinked.map((t) => t.strongs);
      if (unlinked.some((t) => t.morph)) info.m = unlinked.map((t) => t.morph);
      if (unlinked.some((t) => t.form)) info.o = unlinked.map((t) => t.form);
    }
    if (e.tags.length) {
      tags++;
      if (links.length) linked++;
    }
    const word: LinkedWord = { text: p.text, links };
    if (Object.keys(info).length) word.info = info;
    return { text: p.text, word };
  });
  const taken = new Set(assigned.values());
  const unlinked = [...occs.values()].filter((o) => !assigned.has(o.key)).map((o) => o.base);
  const free = cand.filter((j) => !taken.has(j) && words[j][OW.strongs]).map((j) => baseStrongs(words[j][OW.strongs]));
  return { pieces, tags, linked, unlinked, free };
}

/** Pieces -> Token[] (unlinked words without info merge into the surrounding text). */
export function piecesToTokens(pieces: readonly { text: string; word?: LinkedWord }[]): Token[] {
  const out: Token[] = [];
  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (typeof last === 'string') out[out.length - 1] = last + s;
    else out.push(s);
  };
  for (const p of pieces) {
    const w = p.word;
    if (!w || (!w.links.length && !w.info)) {
      pushText(p.text);
      continue;
    }
    const tok: WordToken = [w.text, w.links];
    if (w.info) tok.push(w.info);
    out.push(tok);
  }
  return out;
}

/**
 * Candidate original words for each KJV verse of a chapter: the verse's own words, plus words of
 * verses the KJV does not have (e.g. BSB 3 John 1:15 is the end of KJV 1:14), given to the
 * nearest preceding KJV verse (else the following one).
 */
export function candidatesByVerse(orig: OrigChapter, kjvVerses: readonly number[]): Map<number, number[]> {
  const have = new Set(kjvVerses);
  const sorted = [...kjvVerses].sort((a, b) => a - b);
  const out = new Map<number, number[]>(sorted.map((v) => [v, []]));
  orig.words.forEach((w, j) => {
    const v = w[OW.verse];
    let target = v;
    if (!have.has(v)) {
      if (v === 0) return; // Psalm titles: the KJV text has none
      const prev = [...sorted].reverse().find((x) => x < v);
      target = prev ?? sorted.find((x) => x > v) ?? -1;
    }
    out.get(target)?.push(j);
  });
  return out;
}

/** Translation table from the BSB's hand alignment only (used for the KJV's prefix refinement). */
export function bsbTable(origOf: (book: BookId, chapter: number) => OrigChapter): TranslationTable {
  const tb = new TableBuilder();
  for (const { book, chapter } of allChapters()) {
    const p = outPath('text', 'BSB', book.id, `${chapter}.json`);
    if (!existsSync(p)) throw new Error(`Missing ${p}; run the bsb stage first.`);
    tb.addChapter(readJson<TextChapter>(p), origOf(book.id, chapter));
  }
  return tb.toTable();
}

/* ------------------------------------------------------------------------ */
/* Build                                                                     */
/* ------------------------------------------------------------------------ */

/** Lemma groups: for each lemma of the original words, the Strong's ids used for it (>= `min` times). */
export function lemmaGroups(chapters: Iterable<OrigChapter>, min = 5): Map<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  for (const oc of chapters) {
    for (const w of oc.words) {
      if (!w[OW.strongs] || !w[OW.lemma]) continue;
      let m = counts.get(w[OW.lemma]);
      if (!m) counts.set(w[OW.lemma], (m = new Map()));
      const b = baseStrongs(w[OW.strongs]);
      m.set(b, (m.get(b) ?? 0) + 1);
    }
  }
  const out = new Map<string, string[]>();
  for (const [lemma, m] of counts) {
    const ids = [...m].filter(([, n]) => n >= min).map(([s]) => s);
    if (ids.length > 1) out.set(lemma, ids);
  }
  return out;
}

/** Match keys for an original word: base Strong's + the other form-numbers of its lemma (Greek). */
export function keysFor(words: readonly OrigWord[], groups: ReadonlyMap<string, readonly string[]>): (j: number) => readonly string[] {
  return (j) => {
    const w = words[j];
    if (!w[OW.strongs]) return [];
    const b = baseStrongs(w[OW.strongs]);
    const g = groups.get(w[OW.lemma]);
    return g && g.includes(b) ? g : [b];
  };
}

/**
 * Learn KJV-Strong's -> source-Strong's equivalences from tags left unlinked by direct matching:
 * s -> s' when the unlinked s co-occurs with a free (unlinked) s' in the same verse in >= 30% of its
 * occurrences, at least 5 times, and >= 5x more often than s' is free in an average verse.
 */
export function learnEquivalences(stats: readonly { unlinked: string[]; free: string[] }[]): Map<string, string[]> {
  const n = new Map<string, number>();
  const c = new Map<string, Map<string, number>>();
  const fv = new Map<string, number>();
  for (const st of stats) {
    const free = new Set(st.free);
    for (const f of free) fv.set(f, (fv.get(f) ?? 0) + 1);
    for (const s of st.unlinked) {
      n.set(s, (n.get(s) ?? 0) + 1);
      let m = c.get(s);
      if (!m) c.set(s, (m = new Map()));
      for (const f of free) m.set(f, (m.get(f) ?? 0) + 1);
    }
  }
  const V = stats.length;
  const out = new Map<string, string[]>();
  for (const [s, m] of c) {
    const ns = n.get(s)!;
    const ids = [...m]
      .filter(([f, k]) => f !== s && k >= 5 && k / ns >= 0.3 && k / ns / ((fv.get(f) ?? 0) / V) >= 5 && f[0] === s[0])
      .sort((a, b) => b[1] - a[1])
      .map(([f]) => f);
    if (ids.length) out.set(s, ids);
  }
  return out;
}

export function buildKjv(): void {
  const kjv = readKjv();
  const origCache = new Map<string, OrigChapter>();
  const origOf = (book: BookId, chapter: number) => {
    const k = `${book} ${chapter}`;
    let oc = origCache.get(k);
    if (!oc) {
      const p = outPath('orig', book, `${chapter}.json`);
      if (!existsSync(p)) throw new Error(`Missing ${p}; run the orig stage first.`);
      origCache.set(k, (oc = readJson<OrigChapter>(p)));
    }
    return oc;
  };
  const table = bsbTable(origOf);
  const groups = lemmaGroups(allChapters().map(({ book, chapter }) => origOf(book.id, chapter)));
  const chapters = allChapters().map(({ book, chapter }) => {
    const vs = kjv.get(`${book.id} ${chapter}`);
    if (!vs) throw new Error(`KJV has no ${book.id} ${chapter}`);
    const orig = origOf(book.id, chapter);
    const cand = candidatesByVerse(
      orig,
      vs.map((v) => v.verse),
    );
    return { book, chapter, vs, orig, cand, keysOf: keysFor(orig.words, groups) };
  });

  // Pass 1: direct matching only, to learn where the KJV's numbering differs from the source's.
  const stats: { unlinked: string[]; free: string[] }[] = [];
  for (const ch of chapters) {
    for (const v of ch.vs) stats.push(linkKjvVerse(v.entries, ch.orig.words, ch.cand.get(v.verse) ?? [], { keysOf: ch.keysOf }));
  }
  const equiv = learnEquivalences(stats);
  log('kjv', `learned ${equiv.size} Strong's equivalences, e.g. ${[...equiv].slice(0, 8).map(([s, e]) => `${s}->${e.join('/')}`).join(', ')}`);

  cleanOut('text', 'KJV');
  let files = 0;
  let bytes = 0;
  let verses = 0;
  let words = 0;
  let tagged = 0;
  let linked = 0;
  let italic = 0;
  let unlinkedTags = 0;
  const notInBsb: string[] = [];
  const notInKjv: string[] = [];
  for (const { book, chapter, vs, orig, cand, keysOf } of chapters) {
    const bsb = readJson<TextChapter>(outPath('text', 'BSB', book.id, `${chapter}.json`));
    const bsbVerses = new Set(bsb.verses.map((v) => v.v));
    const kjvVerses = new Set(vs.map((v) => v.verse));
    for (const v of vs) if (!bsbVerses.has(v.verse)) notInBsb.push(`${book.id} ${chapter}:${v.verse}`);
    for (const v of bsbVerses) if (!kjvVerses.has(v)) notInKjv.push(`${book.id} ${chapter}:${v}`);

    const out: TextChapter = { tr: 'KJV', book: book.id, chapter, verses: [] };
    for (const v of vs) {
      const res = linkKjvVerse(v.entries, orig.words, cand.get(v.verse) ?? [], { table, keysOf, equiv });
      const tv: TextVerse = { v: v.verse, t: piecesToTokens(res.pieces) };
      out.verses.push(tv);
      verses++;
      tagged += res.tags;
      linked += res.linked;
      for (const p of res.pieces) {
        if (!p.word) continue;
        words++;
        if (p.word.info?.i) italic++;
        unlinkedTags += p.word.info?.s?.length ?? 0;
      }
    }
    bytes += writeJson(outPath('text', 'KJV', book.id, `${chapter}.json`), out);
    files++;
  }
  log(
    'kjv',
    `${files} chapters, ${verses} verses, ${words} words; ${linked}/${tagged} tagged words linked to an original word ` +
      `(${((100 * linked) / tagged).toFixed(1)}%), ${unlinkedTags} Strong's tags kept as lexicon-only; ${italic} italic words; ${(bytes / 1e6).toFixed(1)} MB`,
  );
  log('kjv', `verses not in the BSB (${notInBsb.length}): ${notInBsb.join(', ')}`);
  log('kjv', `BSB verses not in the KJV (${notInKjv.length}): ${notInKjv.join(', ') || 'none'}`);
}

/** Exposed for the evaluation script: the BSB-only table builder over all chapters. */
export { TableBuilder };
