/**
 * Bridge alignment (shared: pipeline + browser). Links the words of any English translation to the
 * Greek / Hebrew words of a verse through the BSB's hand alignment.
 *
 * Browser use (e.g. a chapter fetched from API.Bible):
 *   const table = TranslationTable.fromJson(await (await fetch(`${base}data/${ALIGN_TABLE_PATH}`)).json());
 *   const linked = bridgeChapter(plainChapter, bsbChapter, origChapter, table);
 */
export { alignVerse, bridgeChapter, bridgeVerse, DEFAULT_BRIDGE_OPTIONS, type AlignedWord, type LinkKind } from './bridge';
export { FUNCTION_WORDS, fitsMorpheme, isFunctionWord, lemma, lemmas, stem, wordClass, type WordClass } from './normalize';
export { baseId, TableBuilder, tokenWords, TranslationTable, type PruneOptions, type TableLang } from './table';
export type { AlignTableJson, BridgeOptions, LemmaEntry } from './types';

/** Path of the translation table under the data root (public/data/). */
export const ALIGN_TABLE_PATH = 'align/table.json';
