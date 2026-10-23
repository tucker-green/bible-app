/**
 * Promise-based search API for the UI. Runs the engine in a Web Worker (worker.ts) and falls back
 * to the main thread when Workers are unavailable (tests, very old browsers) or the worker fails
 * to start.
 *
 *   import { search, warmSearch, createSearchSession, isAbortError } from './lib/search/client';
 *   const res = await search('faith OR hope', { tr: 'BSB', testament: 'NT', limit: 50 });
 *   res.total, res.results[0].highlights, res.byBook, res.interpreted, res.suggestions
 *
 * Search only covers bundled translations (public/data/search/{TR}.json); runtime translations
 * such as NIV have no corpus and reject with a DataError (HTTP 404).
 */
import { currentDataVersion, dataBaseUrl, loadConcordance, loadLexIndex, loadOrig, loadSearchCorpus, loadText } from '../data';
import { SearchEngine } from './engine';
import type { HitRef, SearchOptions, SearchResponse, WorkerRequest, WorkerResponse } from './engine';

export type { HitRef, SearchHit, SearchOptions, SearchResponse, SearchSuggestion } from './engine';
export { parseQuery } from './query';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Request = DistributiveOmit<WorkerRequest, 'id'>;
type Result = SearchResponse | [number, number][][] | null;

interface Pending {
  msg: Request;
  resolve: (r: Result) => void;
  reject: (e: Error) => void;
}

type Backend = { kind: 'worker'; worker: Worker } | { kind: 'local'; engine: SearchEngine };

let backend: Backend | null = null;
let preferLocal = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function localEngine(): SearchEngine {
  return new SearchEngine({ loadCorpus: loadSearchCorpus, loadConcordance, loadLexIndex, loadText, loadOrig });
}

function getBackend(): Backend {
  if (backend) return backend;
  if (!preferLocal && typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'search' });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const p = pending.get(e.data.id);
        if (!p) return; // aborted or init
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      worker.onerror = (e) => {
        // The worker could not load (e.g. CSP or an old browser): run everything on the main thread.
        e.preventDefault();
        worker.terminate();
        backend = { kind: 'local', engine: localEngine() };
        const waiting = [...pending.values()];
        pending.clear();
        for (const p of waiting) dispatch(p.msg).then(p.resolve, p.reject);
      };
      backend = { kind: 'worker', worker };
      worker.postMessage({ id: 0, type: 'init', dataBase: dataBaseUrl(true), dataVersion: currentDataVersion() } satisfies WorkerRequest);
      return backend;
    } catch {
      /* fall through to local */
    }
  }
  backend = { kind: 'local', engine: localEngine() };
  return backend;
}

function dispatch(msg: Request, signal?: AbortSignal): Promise<Result> {
  if (signal?.aborted) return Promise.reject(abortError());
  const b = getBackend();
  if (b.kind === 'local') {
    const run = async (): Promise<Result> => {
      if (msg.type === 'search') return b.engine.search(msg.query, msg.opts);
      if (msg.type === 'highlight') return b.engine.highlightLinked(msg.tr, msg.hits, msg.strongs);
      if (msg.type === 'warm') await b.engine.warm(msg.tr);
      return null;
    };
    const p = run();
    return signal ? raceAbort(p, signal) : p;
  }
  const id = nextId++;
  return new Promise<Result>((resolve, reject) => {
    pending.set(id, { msg, resolve, reject });
    b.worker.postMessage({ ...msg, id } as WorkerRequest);
    signal?.addEventListener(
      'abort',
      () => {
        if (pending.delete(id)) reject(abortError());
      },
      { once: true },
    );
  });
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function abortError(): Error {
  const e = new Error('Search superseded');
  e.name = 'AbortError';
  return e;
}

/** True for the rejection of an aborted / superseded search (ignore these in the UI). */
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/** Run a query. Rejects with an AbortError if `signal` aborts first. */
export async function search(query: string, opts: SearchOptions, init: { signal?: AbortSignal } = {}): Promise<SearchResponse> {
  const r = await dispatch({ type: 'search', query, opts }, init.signal);
  return r as SearchResponse;
}

/**
 * Highlights for results of Strong's / lemma searches (SearchResponse.strongs non-empty), whose
 * hits come back without highlights: marks the English words linked to those Strong's numbers.
 * Loads each hit's chapter, so call it after showing the results (one span list per hit).
 */
export async function highlightLinked(
  tr: string,
  hits: HitRef[],
  strongs: string[],
  init: { signal?: AbortSignal } = {},
): Promise<[number, number][][]> {
  if (!strongs.length || !hits.length) return hits.map(() => []);
  const plain = hits.map(({ book, chapter, verse, text }) => ({ book, chapter, verse, text }));
  return (await dispatch({ type: 'highlight', tr, hits: plain, strongs }, init.signal)) as [number, number][][];
}

/** Start building a translation's index in the background (e.g. when the search box is focused). */
export function warmSearch(tr: string): void {
  dispatch({ type: 'warm', tr }).catch(() => undefined);
}

/**
 * A "latest wins" search function for search-as-you-type: each call aborts the previous one
 * (its promise rejects with an AbortError — check isAbortError).
 */
export function createSearchSession(): (query: string, opts: SearchOptions) => Promise<SearchResponse> {
  let ctrl: AbortController | null = null;
  return (query, opts) => {
    ctrl?.abort();
    ctrl = new AbortController();
    return search(query, opts, { signal: ctrl.signal });
  };
}

/** Stop the worker and reject everything in flight. The next search starts a fresh backend. */
export function terminateSearch(): void {
  if (backend?.kind === 'worker') backend.worker.terminate();
  backend = null;
  for (const p of pending.values()) p.reject(abortError());
  pending.clear();
}

/**
 * Run searches on the main thread (no Worker). Pass an engine to inject custom loaders (tests).
 * Call with `false` to go back to the Worker on the next search.
 */
export function useMainThreadSearch(engine: SearchEngine | boolean = true): void {
  terminateSearch();
  preferLocal = engine !== false;
  if (engine instanceof SearchEngine) backend = { kind: 'local', engine };
}

/** 'worker' | 'local' | null (not started yet). */
export function searchBackend(): 'worker' | 'local' | null {
  return backend?.kind ?? null;
}
