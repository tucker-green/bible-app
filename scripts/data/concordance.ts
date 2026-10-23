/**
 * Stage "concordance": Strong's id -> every English-versification verse it occurs in.
 *   public/data/conc/{G|H}/{NNN}.json (ConcChunk), chunked like the lexicon (floor(n / 100)).
 *
 * Built from the orig stage output, so refs follow English versification (Hebrew Mal 3:19 is
 * listed as Mal 4:1). Keys are base ids (no extension letter: H0871a counts as H0871).
 * Psalm-title words (OW.verse 0) are listed under verse 1.
 */
import type { ConcChunk, OrigChapter } from '../../src/lib/types';
import { OW, packRef } from '../../src/lib/types';
import { allChapters, baseStrongs, chunkOf, cleanOut, log, outPath, readJson, writeJson } from './common';

/** Add every word of one chapter to `index` (base Strong's id -> set of packed refs). */
export function indexChapter(index: Map<string, Set<number>>, bookNum: number, chapter: OrigChapter): void {
  for (const w of chapter.words) {
    const s = w[OW.strongs];
    if (!s) continue;
    const id = baseStrongs(s);
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
  cleanOut('conc');
  const index = new Map<string, Set<number>>();
  for (const { book, chapter } of allChapters()) {
    indexChapter(index, book.num, readJson<OrigChapter>(outPath('orig', book.id, `${chapter}.json`)));
  }
  let bytes = 0;
  let refs = 0;
  const chunks = chunkIndex(index);
  for (const [key, chunk] of chunks) {
    const [lang, n] = key.split('/');
    bytes += writeJson(outPath('conc', lang, `${n}.json`), chunk);
    for (const list of Object.values(chunk)) refs += list.length;
  }
  log('concordance', `${index.size} Strong's ids, ${refs} verse refs in ${chunks.size} chunks, ${(bytes / 1e6).toFixed(1)} MB`);
}
