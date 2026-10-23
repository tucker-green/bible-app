/**
 * Translation table P(Strong's | English lemma) for the bridge aligner (shared: pipeline + browser).
 *
 * Built by the pipeline (`TableBuilder`) from aligned texts — the BSB's hand alignment and the
 * KJV's Strong's tags — and shipped as public/data/align/table.json (`AlignTableJson`). The
 * browser wraps that JSON in a `TranslationTable`, which parses entries lazily on first use.
 *
 * P(s | e) is an inclusion probability: the share of occurrences of lemma e (linked or not) whose
 * link set includes an original word with Strong's id s. Phrase links ("according to their kinds"
 * -> three Hebrew morphemes) therefore count fully for each id, and a word that is usually left
 * unlinked (e.g. "of" before a Hebrew construct noun) gets low probabilities everywhere.
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
  /** Drop pairs seen fewer times than this. Default 2. */
  minPairCount?: number;
  /** Drop pairs with P(s | e) below this. Default 0.01. */
  minProb?: number;
  /** Keep at most this many ids per lemma. Default 12. */
  maxPerLemma?: number;
}

/** Accumulates (lemma, Strong's) counts. */
export class TableBuilder {
  private n = new Map<string, number>();
  private c = new Map<string, Map<string, number>>();
  readonly sources: string[] = [];

  /** One occurrence of an English word (by lemma) and the distinct Strong's ids it is linked to (empty = unlinked). */
  add(lemma: string, strongs: Iterable<string>, weight = 1): void {
    if (!lemma) return;
    this.n.set(lemma, (this.n.get(lemma) ?? 0) + weight);
    const ids = new Set(strongs);
    if (!ids.size) return;
    let m = this.c.get(lemma);
    if (!m) this.c.set(lemma, (m = new Map()));
    for (const s of ids) if (s) m.set(s, (m.get(s) ?? 0) + weight);
  }

  /**
   * Add every word of a linked chapter (verses and superscription). Unlinked words count as
   * occurrences without a link; `TokenInfo.s` ids (unlinkable Strong's) count as links.
   */
  addChapter(chapter: TextChapter, orig: OrigChapter, weight = 1): void {
    const lists = chapter.verses.map((v) => v.t);
    if (chapter.superscription) lists.push(chapter.superscription);
    for (const tokens of lists) {
      const ws = tokenWords(tokens);
      const lem = lemmas(ws.map((w) => w.text));
      ws.forEach((w, i) => {
        const ids: string[] = [];
        for (const j of w.links) {
          const s = orig.words[j]?.[1];
          if (s) ids.push(s);
        }
        if (w.extra) ids.push(...w.extra);
        this.add(lem[i], ids, weight);
      });
    }
  }

  get lemmaCount(): number {
    return this.n.size;
  }

  /** Unpruned runtime table (for the pipeline). */
  toTable(): TranslationTable {
    const entries = new Map<string, LemmaEntry>();
    for (const [lemma, n] of this.n) {
      const p = new Map<string, number>();
      for (const [s, c] of this.c.get(lemma) ?? []) p.set(s, c / n);
      entries.set(lemma, { n, p });
    }
    return new TranslationTable(entries);
  }

  /** Pruned, packed JSON for shipping (see AlignTableJson). */
  toJson(opts: PruneOptions = {}): AlignTableJson {
    const { minLemmaCount = 2, minPairCount = 2, minProb = 0.01, maxPerLemma = 12 } = opts;
    const t: Record<string, string> = {};
    let pairs = 0;
    for (const lemma of [...this.n.keys()].sort()) {
      const n = this.n.get(lemma)!;
      if (n < minLemmaCount) continue;
      const kept = [...(this.c.get(lemma) ?? [])]
        .filter(([, c]) => c >= minPairCount && c / n >= minProb)
        .map(([s, c]): [string, number] => [s, Math.round((1000 * c) / n)])
        .filter(([, p]) => p > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, maxPerLemma);
      if (!kept.length) continue;
      pairs += kept.length;
      t[lemma] = [Math.round(n), ...kept.flat()].join(' ');
    }
    return { v: 1, t, info: { lemmas: Object.keys(t).length, pairs, sources: [...this.sources] } };
  }
}

/** Runtime lookup of P(Strong's | lemma). */
export class TranslationTable {
  private parsed: Map<string, LemmaEntry | null>;
  private packed: Record<string, string>;

  constructor(entries: Map<string, LemmaEntry> = new Map(), packed: Record<string, string> = {}) {
    this.parsed = new Map(entries);
    this.packed = packed;
  }

  static fromJson(json: AlignTableJson): TranslationTable {
    if (json.v !== 1) throw new Error(`Unsupported align table version ${String(json.v)}`);
    return new TranslationTable(new Map(), json.t);
  }

  /** The entry for a lemma, or undefined if it never occurred in training. */
  get(lemma: string): LemmaEntry | undefined {
    let e = this.parsed.get(lemma);
    if (e === undefined) {
      const raw = Object.prototype.hasOwnProperty.call(this.packed, lemma) ? this.packed[lemma] : undefined;
      e = raw ? parseEntry(raw) : null;
      this.parsed.set(lemma, e);
    }
    return e ?? undefined;
  }

  /** Occurrences of the lemma in training (0 if unseen). */
  count(lemma: string): number {
    return this.get(lemma)?.n ?? 0;
  }

  /** P(strongs | lemma): exact id first, then its base id ("H0871a" -> "H0871"). */
  prob(lemma: string, strongs: string): number {
    const e = this.get(lemma);
    if (!e || !strongs) return 0;
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
