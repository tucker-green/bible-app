/**
 * Loading for the compare page and the verse sheet's compare section: chapter texts per
 * translation (bundled JSON or a registered remote source such as the NIV via API.Bible) and the
 * original-language chapter, each with its own status so one failing translation never hides the
 * others. API.Bible's fair-use reporting (FUMS) for remote text that is shown lives here too.
 *
 * Bundled chapters that already arrived are also kept in a small synchronous cache, so a compare
 * page that is re-mounted (the route key changes with the translations) renders its text in the
 * very first frame and keeps the reading position.
 */
import { useEffect, useState } from 'preact/hooks';
import { hasTextSource, loadOrig, loadText } from '../../lib/data';
import { apiBibleMeta, createFumsIds, reportFums } from '../../lib/providers/apibible';
import type { FumsIds } from '../../lib/providers/apibible';
import type { OrigChapter, TextChapter } from '../../lib/types';

export type TextLoad =
  | { tr: string; status: 'loading' }
  | { tr: string; status: 'ready'; text: TextChapter }
  | { tr: string; status: 'error'; error: unknown };

/* ------------------------------------------------------------------------ */
/* Synchronous cache of settled chapters                                     */
/* ------------------------------------------------------------------------ */

const CACHE_SIZE = 24;
const texts = new Map<string, TextChapter>();
const origs = new Map<string, OrigChapter | null>();

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > CACHE_SIZE) map.delete(map.keys().next().value as string);
}

/** Load a chapter text (data.ts caching) and remember bundled ones for synchronous reuse. */
export function loadCompareText(tr: string, book: string, chapter: number): Promise<TextChapter> {
  return loadText(tr, book, chapter).then((t) => {
    // remote sources (API.Bible) can be re-registered with another key: never reuse them synchronously
    if (!hasTextSource(tr)) remember(texts, `${tr}/${book}/${chapter}`, t);
    return t;
  });
}

function settledText(tr: string, book: string, chapter: number): TextChapter | undefined {
  return hasTextSource(tr) ? undefined : texts.get(`${tr}/${book}/${chapter}`);
}

/** Warm every text of a compare page (resolves when all settled, failures included). */
export function prefetchCompare(trs: readonly string[], book: string, chapter: number): Promise<void> {
  const all = [
    ...trs.map((tr) => loadCompareText(tr, book, chapter)),
    loadOrig(book, chapter).then(
      (o) => remember(origs, `${book}/${chapter}`, o),
      () => undefined,
    ),
  ];
  return Promise.allSettled(all).then(() => undefined);
}

/** Drop the synchronous cache (tests). */
export function resetCompareCache(): void {
  texts.clear();
  origs.clear();
}

/* ------------------------------------------------------------------------ */
/* Hooks                                                                     */
/* ------------------------------------------------------------------------ */

function initial(trs: readonly string[], book: string, chapter: number): TextLoad[] {
  return trs.map((tr) => {
    const text = settledText(tr, book, chapter);
    return text ? { tr, status: 'ready', text } : { tr, status: 'loading' };
  });
}

/**
 * The chapter in each translation, loaded in parallel (entries keep the order of `trs`); re-runs
 * when the list, the chapter or `attempt` changes. Chapters already settled are ready at once.
 */
export function useChapterTexts(trs: readonly string[] | null, book: string, chapter: number, attempt = 0): TextLoad[] {
  const key = trs ? `${trs.join(',')}/${book}/${chapter}` : '';
  const [state, setState] = useState<{ key: string; list: TextLoad[] }>(() => ({ key, list: trs ? initial(trs, book, chapter) : [] }));
  const derived = state.key === key ? state.list : trs ? initial(trs, book, chapter) : [];

  useEffect(() => {
    if (!trs) return;
    let off = false;
    setState((s) => (s.key === key && attempt === 0 ? s : { key, list: derived.map((x) => (x.status === 'error' ? { tr: x.tr, status: 'loading' } : x)) }));
    const settle = (tr: string, next: TextLoad) =>
      setState((s) => {
        if (s.key !== key) return s;
        const cur = s.list.find((x) => x.tr === tr);
        if (cur && cur.status === 'ready' && next.status === 'ready' && cur.text === next.text) return s;
        return { key, list: s.list.map((x) => (x.tr === tr ? next : x)) };
      });
    trs.forEach((tr) => {
      loadCompareText(tr, book, chapter).then(
        (text) => !off && settle(tr, { tr, status: 'ready', text }),
        (error: unknown) => !off && settle(tr, { tr, status: 'error', error }),
      );
    });
    return () => {
      off = true;
    };
  }, [key, attempt]);

  return derived;
}

/** The original-language chapter: undefined while loading, null when unavailable (words then have no links). */
export function useOrigChapter(book: string, chapter: number, attempt = 0): OrigChapter | null | undefined {
  const key = `${book}/${chapter}`;
  const [state, setState] = useState<{ key: string; orig: OrigChapter | null } | null>(() =>
    origs.has(key) ? { key, orig: origs.get(key) ?? null } : null,
  );
  useEffect(() => {
    let off = false;
    loadOrig(book, chapter).then(
      (orig) => {
        remember(origs, key, orig);
        if (!off) setState((s) => (s && s.key === key && s.orig === orig ? s : { key, orig }));
      },
      () => !off && setState((s) => (s && s.key === key && s.orig ? s : { key, orig: null })),
    );
    return () => {
      off = true;
    };
  }, [key, attempt]);
  if (state && state.key === key) return state.orig;
  return origs.has(key) ? (origs.get(key) ?? null) : undefined;
}

/* ------------------------------------------------------------------------ */
/* API.Bible fair-use reporting                                              */
/* ------------------------------------------------------------------------ */

let fumsIds: FumsIds | null = null;
function ids(): FumsIds {
  if (!fumsIds) {
    let local: Storage | null = null;
    let session: Storage | null = null;
    try {
      local = localStorage;
      session = sessionStorage;
    } catch {
      /* storage blocked: ids live for this page only */
    }
    fumsIds = createFumsIds(local, session);
  }
  return fumsIds;
}

/**
 * API.Bible text is on screen: report it (FUMS), as API.Bible's terms require. A no-op for bundled
 * translations. Call once per view (an effect keyed on the chapter object).
 */
export function reportRemoteView(text: TextChapter): void {
  const m = apiBibleMeta(text);
  if (m) reportFums(m, ids());
}
