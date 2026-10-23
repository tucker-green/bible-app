/**
 * Translation table P(Strong's | English lemma) for the bridge aligner (shared: pipeline + browser).
 *
 * Built by the pipeline (`TableBuilder`) from aligned texts — the BSB's hand alignment and the
 * KJV's Strong's tags — and shipped as public/data/align/table.json (`AlignTableJson`). The
 * browser wraps that JSON in a `TranslationTable`, which parses entries lazily on first use.
 *
 * Training data come as "units": the English words of a verse that share one link set, with the
 * Strong's ids of that set ("to him" -> [לְ, ־וֹ]; "according to their kinds" -> three morphemes).
 * Within a unit, which word renders which id is estimated by a few rounds of EM (IBM Model 1
 * restricted to the unit), so "him" learns ־וֹ and "to" learns לְ instead of both learning both.
 * P(s | e) = expected number of times lemma e renders id s / number of occurrences of e (linked or
 * not), so a word that is usually left unlinked (e.g. "of" before a Hebrew construct noun) gets low
 * probabilities everywhere. Greek (NT) and Hebrew (OT) are kept apart.
 */
import { segment } from '../tokenize';
import type { OrigChapter, TextChapter, Token } from '../types';
import { lemmas } from './normalize';
import type { AlignTableJson, LemmaEntry } from './types';

/** "H0871a" -> "H0871"; ids without an extension letter are returned unchanged. */
export const baseId = (id: string): string => (id.length > 5 ? id.slice(0, 5) : id);

export interface PruneOptions {
  /** Drop lemmas seen fewer times than this. Default 2. */
  minLemmaCount?: number;
  /** Drop pairs whose expected count is below this. Default 1. */
  minPairCount?: number;
  /** Drop pairs with P(s | e) below this. Default 0.01. */
  minProb?: number;
  /** Keep at most this many ids per lemma. Default 12. */
  maxPerLemma?: number;
}

/** Which half of the table a Strong's id / original language belongs to. */
export type TableLang = 'g' | 'h';
const langOfId = (id: string): TableLang => (id.charCodeAt(0) === 72 /* H */ ? 'h' : 'g');

/** English words sharing one link set, and the distinct Strong's ids of that set. */
interface Unit {
  lemmas: string[];
  ids: string[];
  weight: number;
}

/** EM rounds over the units. */
const EM_ROUNDS = 4;

/** Training data and estimates for one original language. */
class Half {
  /** Occurrences of each lemma (linked or not). */
  n = new Map<string, number>();
  units: Unit[] = [];
  private estimate: Map<string, Map<string, number>> | undefined;

  occurrence(lemma: string, weight: number): void {
    this.n.set(lemma, (this.n.get(lemma) ?? 0) + weight);
    this.estimate = undefined;
  }

  unit(u: Unit): void {
    this.units.push(u);
    this.estimate = undefined;
  }

  /** Expected counts c(e, s) after EM. */
  counts(): Map<string, Map<string, number>> {
    if (this.estimate) return this.estimate;
    let t: Map<string, Map<string, number>> | undefined; // t(s | e), normalised over s
    let c = new Map<string, Map<string, number>>();
    for (let round = 0; round <= EM_ROUNDS; round++) {
      c = new Map();
      for (const u of this.units) {
        for (const e of u.lemmas) {
          let row = c.get(e);
          if (!row) c.set(e, (row = new Map()));
          const te = t?.get(e);
          let z = 0;
          for (const s of u.ids) z += te ? (te.get(s) ?? 0) : 1;
          for (const s of u.ids) {
            const share = z > 0 ? (te ? (te.get(s) ?? 0) : 1) / z : 1 / u.ids.length;
            if (share > 0) row.set(s, (row.get(s) ?? 0) + u.weight * share);
          }
        }
      }
      t = new Map();
      for (const [e, row] of c) {
        let sum = 0;
        for (const v of row.values()) sum += v;
        const norm = new Map<string, number>();
        for (const [s, v] of row) norm.set(s, v / sum);
        t.set(e, norm);
      }
    }
    this.estimate = c;
    return c;
  }

  entries(): Map<string, LemmaEntry> {
    const c = this.counts();
    const out = new Map<string, LemmaEntry>();
    for (const [lemma, n] of this.n) {
      const p = new Map<string, number>();
      for (const [s, v] of c.get(lemma) ?? []) p.set(s, v / n);
      out.set(lemma, { n, p });
    }
    return out;
  }

  pack(opts: Required<PruneOptions>): [Record<string, string>, number] {
    const c = this.counts();
    const t: Record<string, string> = {};
    let pairs = 0;
    for (const lemma of [...this.n.keys()].sort()) {
      const n = this.n.get(lemma)!;
      if (n < opts.minLemmaCount) continue;
      const kept = [...(c.get(lemma) ?? [])]
        .filter(([, v]) => v >= opts.minPairCount && v / n >= opts.minProb)
        .map(([s, v]): [string, number] => [s, Math.round((1000 * v) / n)])
        .filter(([, p]) => p > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, opts.maxPerLemma);
      if (!kept.length) continue;
      pairs += kept.length;
      t[lemma] = [Math.round(n), ...kept.flat()].join(' ');
    }
    return [t, pairs];
  }
}

/**
 * Accumulates training units, separately for Greek (NT) and Hebrew (OT) so that P(G2532 | "and")
 * is learned from the New Testament only, where "and" is not mostly a Hebrew vav.
 */
export class TableBuilder {
  private half: Record<TableLang, Half> = { g: new Half(), h: new Half() };
  readonly sources: string[] = [];

  /**
   * One occurrence of an English word (by lemma) in a text translated from `lang`, linked alone to
   * the given Strong's ids (empty = unlinked).
   */
  add(lang: TableLang, lemma: string, strongs: Iterable<string>, weight = 1): void {
    this.addUnit(lang, [lemma], strongs, weight);
  }

  /** English words (by lemma) that share one link set with the given Strong's ids (empty = unlinked). */
  addUnit(lang: TableLang, lemmaList: readonly string[], strongs: Iterable<string>, weight = 1): void {
    const ls = lemmaList.filter(Boolean);
    if (!ls.length) return;
    const h = this.half[lang];
    for (const l of ls) h.occurrence(l, weight);
    const ids = [...new Set([...strongs].filter(Boolean))];
    if (ids.length) h.unit({ lemmas: ls, ids, weight });
  }

  /**
   * Add every word of a linked chapter (verses and superscription). Words with identical link sets
   * in a verse form one unit; unlinked words count as occurrences without a link; `TokenInfo.s` ids
   * (unlinkable Strong's) count as links.
   */
  addChapter(chapter: TextChapter, orig: OrigChapter, weight = 1): void {
    const lang: TableLang = orig.lang === 'hbo' ? 'h' : 'g';
    const lists = chapter.verses.map((v) => v.t);
    if (chapter.superscription) lists.push(chapter.superscription);
    for (const tokens of lists) {
      const ws = tokenWords(tokens);
      const lem = lemmas(ws.map((w) => w.text));
      const units = new Map<string, { lemmas: string[]; ids: string[] }>();
      ws.forEach((w, i) => {
        if (!w.links.length && !w.extra?.length) {
          this.addUnit(lang, [lem[i]], []);
          return;
        }
        const key = [...w.links].sort((a, b) => a - b).join(',') + '|' + (w.extra ?? []).join(',');
        let u = units.get(key);
        if (!u) {
          const ids: string[] = [];
          for (const j of w.links) {
            const s = orig.words[j]?.[1];
            if (s) ids.push(s);
          }
          if (w.extra) ids.push(...w.extra);
          units.set(key, (u = { lemmas: [], ids }));
        }
        u.lemmas.push(lem[i]);
      });
      for (const u of units.values()) this.addUnit(lang, u.lemmas, u.ids, weight);
    }
  }

  get lemmaCount(): number {
    return new Set([...this.half.g.n.keys(), ...this.half.h.n.keys()]).size;
  }

  /** Unpruned runtime table (for the pipeline). */
  toTable(): TranslationTable {
    return new TranslationTable({ g: this.half.g.entries(), h: this.half.h.entries() });
  }

  /** Pruned, packed JSON for shipping (see AlignTableJson). */
  toJson(opts: PruneOptions = {}): AlignTableJson {
    const o: Required<PruneOptions> = { minLemmaCount: 2, minPairCount: 1, minProb: 0.01, maxPerLemma: 12, ...opts };
    const [g, pg] = this.half.g.pack(o);
    const [h, ph] = this.half.h.pack(o);
    return { v: 1, g, h, info: { lemmas: Object.keys(g).length + Object.keys(h).length, pairs: pg + ph, sources: [...this.sources] } };
  }
}

/** Runtime lookup of P(Strong's | lemma), per original language. */
export class TranslationTable {
  private parsed: Record<TableLang, Map<string, LemmaEntry | null>>;
  private packed: Record<TableLang, Record<string, string>>;

  constructor(
    entries: Partial<Record<TableLang, Map<string, LemmaEntry>>> = {},
    packed: Partial<Record<TableLang, Record<string, string>>> = {},
  ) {
    this.parsed = { g: new Map(entries.g ?? []), h: new Map(entries.h ?? []) };
    this.packed = { g: packed.g ?? {}, h: packed.h ?? {} };
  }

  static fromJson(json: AlignTableJson): TranslationTable {
    if (json.v !== 1) throw new Error(`Unsupported align table version ${String(json.v)}`);
    return new TranslationTable({}, { g: json.g, h: json.h });
  }

  /** The entry for a lemma in one language half, or undefined if it never occurred in training. */
  get(lang: TableLang, lemma: string): LemmaEntry | undefined {
    const cache = this.parsed[lang];
    let e = cache.get(lemma);
    if (e === undefined) {
      const src = this.packed[lang];
      const raw = Object.prototype.hasOwnProperty.call(src, lemma) ? src[lemma] : undefined;
      e = raw ? parseEntry(raw) : null;
      cache.set(lemma, e);
    }
    return e ?? undefined;
  }

  /** Occurrences of the lemma in training texts of that language (0 if unseen). */
  count(lang: TableLang, lemma: string): number {
    return this.get(lang, lemma)?.n ?? 0;
  }

  /** P(strongs | lemma): exact id first, then its base id ("H0871a" -> "H0871"). */
  prob(lemma: string, strongs: string): number {
    if (!strongs) return 0;
    const e = this.get(langOfId(strongs), lemma);
    if (!e) return 0;
    return e.p.get(strongs) ?? e.p.get(baseId(strongs)) ?? 0;
  }
}

function parseEntry(raw: string): LemmaEntry {
  const parts = raw.split(' ');
  const p = new Map<string, number>();
  for (let i = 1; i + 1 < parts.length; i += 2) p.set(parts[i], Number(parts[i + 1]) / 1000);
  return { n: Number(parts[0]), p };
}

/** Words of a token list with their links (string tokens are segmented; their words have none). */
export function tokenWords(tokens: readonly Token[]): { text: string; links: number[]; extra?: string[] }[] {
  const out: { text: string; links: number[]; extra?: string[] }[] = [];
  for (const t of tokens) {
    if (typeof t === 'string') {
      for (const s of segment(t)) if (s.word) out.push({ text: s.text, links: [] });
    } else {
      const info = t[2];
      const w: { text: string; links: number[]; extra?: string[] } = { text: t[0], links: t[1] };
      if (info?.s?.length) w.extra = info.s;
      out.push(w);
    }
  }
  return out;
}
