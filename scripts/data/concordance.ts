/**
 * Stage "concordance": Strong's id -> every English-versification verse it occurs in.
 *   public/data/conc/{G|H}/{NNN}.json (ConcChunk), chunked like the lexicon (floor(n / 100)).
 *
 * Built from the orig stage output, so refs follow English versification (Hebrew Mal 3:19 is
 * listed as Mal 4:1). Psalm-title words (OW.verse 0) are listed under verse 1.
 *
 * Keys (see usageKey in ./lexicon): an id normally counts under its base number (H1121a counts as
 * H1121). Macula's Hebrew prefix/suffix morpheme ids are the exception: their base number is an
 * unrelated word (H2050b is the conjunction וְ "and", but H2050 is הָתַת "to break in"), so they keep
 * their full id ("H2050b", "H1886a", "H0871a", "H2050c") and are never merged into the base number.
 * Extended keys land in the same chunk as their base (the chunk is chosen by the 4-digit number).
 */
import type { ConcChunk, OrigChapter } from '../../src/lib/types';
import { OW, packRef } from '../../src/lib/types';
import { allChapters, chunkOf, cleanOut, log, outPath, readJson, writeJson } from './common';
import { loadMorphemeIds, usageKey } from './lexicon';

/**
 * Add every word of one chapter to `index` (concordance key -> set of packed refs). `morphemes` holds
 * the morpheme ids that keep their own key; without it every id is folded to its base number.
 */
export function indexChapter(
  index: Map<string, Set<number>>,
  bookNum: number,
  chapter: OrigChapter,
  morphemes: ReadonlySet<string> = new Set(),
): void {
  for (const w of chapter.words) {
    const s = w[OW.strongs];
    if (!s) continue;
    const id = usageKey(s, morphemes);
    let refs = index.get(id);
    if (!refs) index.set(id, (refs = new Set()));
    refs.add(packRef(bookNum, chapter.chapter, w[OW.verse] || 1));
  }
}

/** Split an index into lexicon-style chunks: "G/000" -> { G0026: [...sorted refs] }. */
export function chunkIndex(index: Map<string, Set<number>>): Map<string, ConcChunk> {
  const chunks = new Map<string, ConcChunk>();
  for (const id of [...index.keys()].sort()) {
    const key = `${id[0]}/${chunkOf(id)}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = {}));
    c[id] = [...index.get(id)!].sort((a, b) => a - b);
  }
  return chunks;
}

export function buildConcordance(): void {
  const morphemes = loadMorphemeIds();
  cleanOut('conc');
  const index = new Map<string, Set<number>>();
  for (const { book, chapter } of allChapters()) {
    indexChapter(index, book.num, readJson<OrigChapter>(outPath('orig', book.id, `${chapter}.json`)), morphemes);
  }
  let bytes = 0;
  let refs = 0;
  const chunks = chunkIndex(index);
  for (const [key, chunk] of chunks) {
    const [lang, n] = key.split('/');
    bytes += writeJson(outPath('conc', lang, `${n}.json`), chunk);
    for (const list of Object.values(chunk)) refs += list.length;
  }
  const morphemeKeys = [...index.keys()].filter((k) => morphemes.has(k)).length;
  log(
    'concordance',
    `${index.size} keys (${morphemeKeys} Hebrew prefix/suffix morpheme ids kept whole), ${refs} verse refs in ${chunks.size} chunks, ${(bytes / 1e6).toFixed(1)} MB`,
  );
}
