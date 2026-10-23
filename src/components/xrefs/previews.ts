/**
 * One-line previews of cross-reference targets in the translation being read.
 *
 * Batched and cached: the targets' chapters are grouped, each chapter is loaded once through
 * src/lib/data.ts loadText (itself cached and de-duplicated) with at most PREVIEW_CONCURRENCY
 * requests in flight, and the extracted lines are kept in a small map so a verse seen before costs
 * nothing (and does not keep whole chapters alive).
 *
 * Runtime translations (e.g. the NIV via the reader's own API.Bible key) are never fetched just for
 * previews — that would spend the reader's quota on chapters they did not open — so their previews
 * come from the KJV and say so.
 */
import { useEffect, useState } from 'preact/hooks';
import { hasTextSource, loadText } from '../../lib/data';
import type { BookId, XrefTarget } from '../../lib/types';
import { isXrefRange, xrefKey, xrefStart } from '../../lib/xrefs';
import { previewText, verseText } from './model';

/** Translation used for preview text: the one being read, or the KJV for runtime (remote) ones. */
export function previewTranslation(tr: string): string {
  return hasTextSource(tr) ? 'KJV' : tr;
}

export const PREVIEW_CONCURRENCY = 4;
const MAX_ENTRIES = 4000;

/** `${tr}|${book}|${chapter}|${verse}` -> first-verse text (null = not in this translation). */
const lines = new Map<string, string | null>();

function lineKey(tr: string, book: BookId, chapter: number, verse: number): string {
  return `${tr}|${book}|${chapter}|${verse}`;
}

/** Forget every cached preview line (tests). */
export function resetPreviewCache(): void {
  lines.clear();
}

export type PreviewState =
  /** still loading */
  | undefined
  /** the translation has no such verse */
  | null
  /** the preview text */
  | string;

/** Cached preview of a target in `tr` (already mapped through previewTranslation), if known. */
export function cachedPreview(tr: string, t: XrefTarget): PreviewState {
  const s = xrefStart(t);
  const k = lineKey(tr, s.book, s.chapter, s.verse);
  if (!lines.has(k)) return undefined;
  return previewText(lines.get(k) ?? null, isXrefRange(t));
}

function remember(k: string, v: string | null): void {
  if (lines.size >= MAX_ENTRIES) {
    // Drop the oldest quarter (Map keeps insertion order).
    let n = MAX_ENTRIES >> 2;
    for (const old of lines.keys()) {
      lines.delete(old);
      if (--n <= 0) break;
    }
  }
  lines.set(k, v);
}

/** Run `jobs` with at most `limit` in flight; resolves when all have settled. */
export async function runLimited(jobs: (() => Promise<void>)[], limit = PREVIEW_CONCURRENCY): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await job();
      } catch {
        /* one failed chapter must not stop the others */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

/**
 * Make sure the previews of `targets` in `tr` are cached. Chapters that fail to load are skipped
 * (their previews stay unknown); resolves with the keys (xrefKey) whose chapter failed.
 */
export async function loadPreviews(tr: string, targets: readonly XrefTarget[]): Promise<Set<string>> {
  const byChapter = new Map<string, { book: BookId; chapter: number; items: { t: XrefTarget; verse: number }[] }>();
  for (const t of targets) {
    const s = xrefStart(t);
    if (lines.has(lineKey(tr, s.book, s.chapter, s.verse))) continue;
    const ck = `${s.book}|${s.chapter}`;
    let g = byChapter.get(ck);
    if (!g) byChapter.set(ck, (g = { book: s.book, chapter: s.chapter, items: [] }));
    g.items.push({ t, verse: s.verse });
  }
  const failed = new Set<string>();
  const jobs = [...byChapter.values()].map((g) => async () => {
    try {
      const ch = await loadText(tr, g.book, g.chapter);
      for (const it of g.items) remember(lineKey(tr, g.book, g.chapter, it.verse), verseText(ch, it.verse));
    } catch {
      for (const it of g.items) failed.add(xrefKey(it.t));
    }
  });
  await runLimited(jobs);
  return failed;
}

/** What a list item shows: like PreviewState, plus `false` when its chapter failed to load (no line). */
export type PreviewView = PreviewState | false;

export interface Previews {
  /** Preview of a target: undefined while loading, null when missing, false when it failed, else the text. */
  get(t: XrefTarget): PreviewView;
  /** True while any requested preview is still loading. */
  busy: boolean;
  /** xrefKeys whose chapter failed to load (show no preview line). */
  failed: Set<string>;
  /** The translation the previews are in (differs from the one read for runtime translations). */
  tr: string;
}

/**
 * Previews for the given targets, loading what is missing after `delay` ms (the rail passes a short
 * delay so scrolling through verses does not fetch every chapter it passes).
 */
export function usePreviews(readTr: string, targets: readonly XrefTarget[], delay = 0): Previews {
  const tr = previewTranslation(readTr);
  const sig = targets.map(xrefKey).join(',');
  const [, setTick] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const missing = targets.some((t) => cachedPreview(tr, t) === undefined && !failed.has(xrefKey(t)));

  useEffect(() => {
    setFailed((f) => (f.size ? new Set() : f));
    if (!targets.some((t) => cachedPreview(tr, t) === undefined)) return;
    let off = false;
    const timer = setTimeout(() => {
      loadPreviews(tr, targets).then((f) => {
        if (off) return;
        if (f.size) setFailed(f);
        setTick((n) => n + 1);
      });
    }, delay);
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, [tr, sig]);

  return {
    get: (t) => (failed.has(xrefKey(t)) ? false : cachedPreview(tr, t)),
    busy: missing,
    failed,
    tr,
  };
}
