import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureData } from '../../src/lib/data';
import {
  createSearchSession,
  highlightLinked,
  isAbortError,
  search,
  searchBackend,
  terminateSearch,
  useMainThreadSearch,
  warmSearch,
} from '../../src/lib/search/client';
import { SearchEngine } from '../../src/lib/search/engine';
import type { WorkerRequest, WorkerResponse } from '../../src/lib/search/engine';
import { CONC, CORPUS, LEX, makeEngine } from './fixture';

/** Serve the fixture through a mocked fetch, as public/data/ would. */
function serveFixture() {
  const files: Record<string, unknown> = {
    'search/TST.json': CORPUS,
    'lex/index.json': LEX,
    'conc/G/000.json': { G0025: CONC.G0025, G0026: CONC.G0026 },
    'conc/G/030.json': { G3056: CONC.G3056 },
  };
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.replace(/^.*?\/data\//, '').replace(/\?.*$/, '');
    return path in files ? new Response(JSON.stringify(files[path])) : new Response('', { status: 404 });
  });
  configureData({ base: 'http://test.local/data/', fetch: fetchMock });
  return fetchMock;
}

afterEach(() => {
  terminateSearch();
  useMainThreadSearch(false);
  vi.unstubAllGlobals();
});

describe('search client (main-thread fallback)', () => {
  beforeEach(() => {
    serveFixture();
  });

  it('falls back to the main thread when Worker is unavailable', async () => {
    expect(typeof Worker).toBe('undefined'); // jsdom
    const r = await search('love', { tr: 'TST' });
    expect(searchBackend()).toBe('local');
    expect(r.total).toBe(6);
    const g = await search('G26', { tr: 'TST' });
    expect(g.total).toBe(3);
    const l = await search('λόγος', { tr: 'TST' });
    expect(l.results.map((h) => h.book)).toEqual(['JHN']);
  });

  it('rejects for translations without a corpus', async () => {
    await expect(search('love', { tr: 'NIV' })).rejects.toMatchObject({ name: 'DataError', status: 404 });
  });

  it('aborts superseded searches in a session', async () => {
    const run = createSearchSession();
    const first = run('love', { tr: 'TST' });
    const second = run('hope', { tr: 'TST' });
    await expect(first).rejects.toSatisfy(isAbortError);
    expect((await second).total).toBe(2);
  });

  it('honours an already-aborted signal', async () => {
    const c = new AbortController();
    c.abort();
    await expect(search('love', { tr: 'TST' }, { signal: c.signal })).rejects.toSatisfy(isAbortError);
  });

  it('warms without throwing, even for unknown translations', async () => {
    warmSearch('TST');
    warmSearch('NOPE');
    expect((await search('wept', { tr: 'TST' })).total).toBe(1);
  });

  it('computes linked highlights for Strong’s results', async () => {
    const r = await search('G26', { tr: 'TST' });
    // No text/orig files are served in this fixture: every hit gets an empty list.
    expect(await highlightLinked('TST', r.results, r.strongs)).toEqual([[], [], []]);
    expect(await highlightLinked('TST', r.results, [])).toEqual([[], [], []]);
  });

  it('accepts an injected engine', async () => {
    const { engine, calls } = makeEngine();
    useMainThreadSearch(engine);
    expect((await search('faith', { tr: 'TST' })).total).toBe(1);
    expect(calls.corpus).toBe(1);
  });
});

/** A Worker stand-in that runs a SearchEngine and speaks the real protocol. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: { preventDefault(): void }) => void) | null = null;
  received: WorkerRequest[] = [];
  terminated = false;
  engine = makeEngine().engine;
  constructor(
    readonly url: URL | string,
    readonly opts?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: WorkerRequest) {
    this.received.push(msg);
    void (async () => {
      let reply: WorkerResponse;
      try {
        const result = msg.type === 'search' ? await this.engine.search(msg.query, msg.opts) : null;
        reply = { id: msg.id, ok: true, result };
      } catch (err) {
        reply = { id: msg.id, ok: false, error: (err as Error).message };
      }
      if (!this.terminated) this.onmessage?.({ data: reply } as MessageEvent<WorkerResponse>);
    })();
  }
  terminate() {
    this.terminated = true;
  }
}

describe('search client (worker)', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    serveFixture();
  });

  it('starts a module worker, sends an absolute data base first, and routes replies by id', async () => {
    const [a, b] = await Promise.all([search('love', { tr: 'TST' }), search('hope', { tr: 'TST' })]);
    expect(searchBackend()).toBe('worker');
    expect(a.total).toBe(6);
    expect(b.total).toBe(2);
    const w = FakeWorker.instances[0];
    expect(FakeWorker.instances).toHaveLength(1);
    expect(w.opts).toMatchObject({ type: 'module' });
    expect(String(w.url)).toMatch(/worker\.ts/);
    expect(w.received[0]).toEqual({ id: 0, type: 'init', dataBase: 'http://test.local/data/' });
    expect(w.received.slice(1).map((m) => m.type)).toEqual(['search', 'search']);
  });

  it('propagates worker errors', async () => {
    await expect(search('love', { tr: 'NIV' })).rejects.toThrow(/no corpus/);
  });

  it('drops replies for aborted searches', async () => {
    const c = new AbortController();
    const p = search('love', { tr: 'TST' }, { signal: c.signal });
    c.abort();
    await expect(p).rejects.toSatisfy(isAbortError);
    expect((await search('wept', { tr: 'TST' })).total).toBe(1);
  });

  it('falls back to the main thread if the worker fails to load', async () => {
    const p = search('love', { tr: 'TST' });
    const w = FakeWorker.instances[0];
    w.terminated = true; // swallow its replies
    w.onerror?.({ preventDefault() {} });
    expect((await p).total).toBe(6);
    expect(searchBackend()).toBe('local');
  });
});

describe('worker module', () => {
  it('answers the protocol over postMessage', async () => {
    serveFixture();
    const replies: WorkerResponse[] = [];
    const post = vi.spyOn(window, 'postMessage').mockImplementation(((msg: WorkerResponse) => {
      replies.push(msg);
    }) as typeof window.postMessage);
    await import('../../src/lib/search/worker');
    const handler = (self as unknown as { onmessage: (e: { data: WorkerRequest }) => Promise<void> }).onmessage;
    await handler({ data: { id: 0, type: 'init', dataBase: 'http://test.local/data/' } });
    await handler({ data: { id: 1, type: 'warm', tr: 'TST' } });
    await handler({ data: { id: 2, type: 'search', query: 'faith', opts: { tr: 'TST' } } });
    await handler({ data: { id: 3, type: 'search', query: 'x', opts: { tr: 'NIV' } } });
    expect(replies[0]).toEqual({ id: 0, ok: true, result: null });
    expect(replies[1]).toEqual({ id: 1, ok: true, result: null });
    expect(replies[2]).toMatchObject({ id: 2, ok: true, result: { total: 1 } });
    expect(replies[3]).toMatchObject({ id: 3, ok: false });
    post.mockRestore();
    expect(SearchEngine).toBeDefined();
  });
});
