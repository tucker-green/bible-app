/// <reference lib="webworker" />
/**
 * Search Web Worker: owns a SearchEngine (indexes are built here, off the main thread).
 * Spawned by client.ts with `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
 *
 * Protocol (see WorkerRequest / WorkerResponse in engine.ts):
 *   { id, type: 'init', dataBase, dataVersion? }  absolute URL of public/data/ (workers resolve relative
 *                                        URLs against their own script, so the client must send this
 *                                        first) and the page's data version (meta.json) for ?v=
 *   { id, type: 'warm', tr }            build the index for a translation ahead of time
 *   { id, type: 'search', query, opts } -> { id, ok: true, result: SearchResponse }
 *   { id, type: 'highlight', tr, hits, strongs } -> { id, ok: true, result: [start, end][][] }
 * Errors come back as { id, ok: false, error }.
 */
import { configureData, loadConcordance, loadLexIndex, loadOrig, loadSearchCorpus, loadText, setDataVersion } from '../data';
import { SearchEngine } from './engine';
import type { WorkerRequest, WorkerResponse } from './engine';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const engine = new SearchEngine({
  loadCorpus: loadSearchCorpus,
  loadConcordance,
  loadLexIndex,
  loadText,
  loadOrig,
});

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  let reply: WorkerResponse;
  try {
    if (msg.type === 'init') {
      configureData({ base: msg.dataBase });
      // The page's data version, so the worker's requests carry the same ?v= (fresh after a data update).
      if (msg.dataVersion) setDataVersion(msg.dataVersion);
      reply = { id: msg.id, ok: true, result: null };
    } else if (msg.type === 'warm') {
      await engine.warm(msg.tr);
      reply = { id: msg.id, ok: true, result: null };
    } else if (msg.type === 'highlight') {
      reply = { id: msg.id, ok: true, result: await engine.highlightLinked(msg.tr, msg.hits, msg.strongs) };
    } else {
      reply = { id: msg.id, ok: true, result: await engine.search(msg.query, msg.opts) };
    }
  } catch (err) {
    reply = { id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  ctx.postMessage(reply);
};
