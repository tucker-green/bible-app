/**
 * A chapter's cross references (src/lib/xrefs.ts loadXrefs) as component state. Chapters already
 * loaded are served synchronously from a small map, so reopening a verse sheet or moving through a
 * chapter never flashes a loading state.
 */
import { useEffect, useState } from 'preact/hooks';
import type { XrefChapter } from '../../lib/types';
import { loadXrefs } from '../../lib/xrefs';

const resolved = new Map<string, XrefChapter>();
const KEEP = 24;

/** Forget the synchronous copies (tests). */
export function resetXrefState(): void {
  resolved.clear();
}

export type XrefStatus = 'loading' | 'ready' | 'error';

export interface XrefChapterState {
  status: XrefStatus;
  ch: XrefChapter | null;
  retry: () => void;
}

export function useXrefChapter(book: string, chapter: number): XrefChapterState {
  const key = `${book}/${chapter}`;
  const [st, setSt] = useState<{ key: string; status: XrefStatus; ch: XrefChapter | null }>(() => {
    const hit = resolved.get(key);
    return hit ? { key, status: 'ready', ch: hit } : { key, status: 'loading', ch: null };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const hit = resolved.get(key);
    if (hit) {
      setSt((s) => (s.key === key && s.ch === hit ? s : { key, status: 'ready', ch: hit }));
      return;
    }
    let off = false;
    setSt({ key, status: 'loading', ch: null });
    loadXrefs(book, chapter).then(
      (ch) => {
        resolved.delete(key);
        resolved.set(key, ch);
        while (resolved.size > KEEP) resolved.delete(resolved.keys().next().value as string);
        if (!off) setSt({ key, status: 'ready', ch });
      },
      () => {
        if (!off) setSt({ key, status: 'error', ch: null });
      },
    );
    return () => {
      off = true;
    };
  }, [key, attempt]);

  const cur = st.key === key ? st : resolved.has(key) ? { key, status: 'ready' as const, ch: resolved.get(key)! } : { key, status: 'loading' as const, ch: null };
  return { status: cur.status, ch: cur.ch, retry: () => setAttempt((n) => n + 1) };
}
