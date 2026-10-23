/**
 * Types for the bridge aligner (shared: pipeline + browser).
 *
 * public/data/align/table.json is an `AlignTableJson`: a translation table P(Strong's | English
 * lemma) learned from the BSB's hand alignment and the KJV's Strong's tagging over the whole
 * Bible. The browser loads it once to bridge runtime translations (e.g. the NIV); the pipeline uses
 * the same table to bridge the WEB / ASV / YLT.
 */

/** public/data/align/table.json */
export interface AlignTableJson {
  /** Format version (bump on any incompatible change). */
  v: 1;
  /**
   * English lemma (see `lemma()` in normalize.ts) -> packed entry
   *   "N S1 P1 S2 P2 …"
   * N  = how many times the lemma occurs in the training texts (linked or not);
   * Si = a Strong's id exactly as in OrigWord[OW.strongs] ("G0166", "H0871a"), or a base id;
   * Pi = round(1000 · P(Si | lemma)), integers, sorted descending.
   * Pairs with low probability / count are pruned, so the Pi of a lemma may sum to < 1000;
   * the remainder is the chance the word is unlinked or rendered by something rarer.
   */
  t: Record<string, string>;
  /** Build summary (informational). */
  info?: { lemmas: number; pairs: number; sources: string[] };
}

/** One entry of the runtime table: Strong's id -> probability. */
export type LemmaEntry = { n: number; p: Map<string, number> };

/** Tunables of the bridge aligner; defaults in bridge.ts (`DEFAULT_BRIDGE_OPTIONS`). */
export interface BridgeOptions {
  /** Minimum score for linking a content word. */
  minContent: number;
  /** Minimum score for linking a function word (the, of, and, him…). */
  minFunction: number;
  /** Width of the positional prior (relative position difference at which it halves). */
  sigma: number;
}
