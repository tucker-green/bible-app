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
   * New Testament (Greek) half: English lemma (see `lemma()` in normalize.ts) -> packed entry
   *   "N S1 P1 S2 P2 …"
   * N  = how many times the lemma occurs in the NT training texts (linked or not);
   * Si = a Strong's id exactly as in OrigWord[OW.strongs] ("G0166"), or a base id;
   * Pi = round(1000 · P(Si | lemma)): the share of the lemma's occurrences whose links include an
   *      original word with that id. Integers, sorted descending.
   * Pairs with low probability / count are pruned; what is left of 1000 is the chance that the word
   * is unlinked or rendered by something rarer. Phrase links count fully for every id, so the Pi of
   * a lemma may also sum to more than 1000.
   */
  g: Record<string, string>;
  /** Old Testament (Hebrew / Aramaic) half, same format; ids like "H0871a" keep their extension letter. */
  h: Record<string, string>;
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
