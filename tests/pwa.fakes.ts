/**
 * In-memory Cache Storage for the PWA tests (jsdom has none). Keys are the request URLs as given
 * (relative URLs allowed); `ignoreSearch` compares them without their query string.
 */
type Req = RequestInfo | URL;
const urlOf = (r: Req): string => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url);
const noSearch = (u: string) => u.replace(/[?#].*$/, '');

export class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(r: Req, opts?: CacheQueryOptions): Promise<Response | undefined> {
    const u = urlOf(r);
    if (this.entries.has(u)) return this.entries.get(u)!.clone();
    if (opts?.ignoreSearch) for (const [k, v] of this.entries) if (noSearch(k) === noSearch(u)) return v.clone();
    return undefined;
  }
  async put(r: Req, res: Response): Promise<void> {
    await res.clone().arrayBuffer(); // a consumed body would throw, as in browsers
    this.entries.set(urlOf(r), res);
  }
  async delete(r: Req, opts?: CacheQueryOptions): Promise<boolean> {
    const u = urlOf(r);
    let hit = this.entries.delete(u);
    if (opts?.ignoreSearch) for (const k of [...this.entries.keys()]) if (noSearch(k) === noSearch(u)) hit = this.entries.delete(k) || hit;
    return hit;
  }
  async keys(): Promise<{ url: string }[]> {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
}

export class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let c = this.stores.get(name);
    if (!c) this.stores.set(name, (c = new FakeCache()));
    return c;
  }
  async has(name: string): Promise<boolean> {
    return this.stores.has(name);
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
  async match(r: Req, opts?: CacheQueryOptions): Promise<Response | undefined> {
    for (const c of this.stores.values()) {
      const hit = await c.match(r, opts);
      if (hit) return hit;
    }
    return undefined;
  }
  /** Sorted URLs in a cache (test helper). */
  async peek(name: string): Promise<string[]> {
    return [...(this.stores.get(name)?.entries.keys() ?? [])].sort();
  }
}

/** A FakeCaches typed as the browser's CacheStorage. */
export const fakeCaches = (): FakeCaches & CacheStorage => new FakeCaches() as unknown as FakeCaches & CacheStorage;
