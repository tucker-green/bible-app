/**
 * Verse text for the My study lists, in the translation on screen. Chapters load through the normal
 * data layer (cached there too); this module remembers each verse's plain text, de-duplicates
 * requests and runs at most MAX_PARALLEL chapter loads at once, so a long list never floods the
 * network (or a runtime translation's API quota — the page also only asks for items near the screen).
 */
import { loadText, tokensToText } from '../../lib/data';
import { parseVerseKey } from '../../app/study';

/** Resolved text; null when the translation doesn't have that verse. */
export type PreviewText = string | null;

export const MAX_PARALLEL = 4;

const chapterJobs = new Map<string, Promise<Map<number, string>>>();
const queue: (() => void)[] = [];
let running = 0;

function pump(): void {
  while (running < MAX_PARALLEL && queue.length) {
    running++;
    queue.shift()!();
  }
}

function limited<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      task()
        .then(resolve, reject)
        .finally(() => {
          running--;
          pump();
        });
    });
    pump();
  });
}

function chapterVerses(tr: string, book: string, chapter: number): Promise<Map<number, string>> {
  const id = `${tr}/${book}/${chapter}`;
  let job = chapterJobs.get(id);
  if (!job) {
    job = limited(() => loadText(tr, book, chapter)).then((ch) => {
      const m = new Map<number, string>();
      for (const v of ch.verses) m.set(v.v, tokensToText(v.t).replace(/\s+/g, ' ').trim());
      return m;
    });
    chapterJobs.set(id, job);
    // Forget failures so a later visit can retry.
    job.catch(() => {
      if (chapterJobs.get(id) === job) chapterJobs.delete(id);
    });
  }
  return job;
}

/** Plain text of a verse ("JHN.3.16") in `tr`; rejects when the chapter can't be loaded. */
export async function loadVersePreview(tr: string, key: string): Promise<PreviewText> {
  const p = parseVerseKey(key);
  if (!p) return null;
  const verses = await chapterVerses(tr, p.book, p.chapter);
  return verses.get(p.verse) ?? null;
}

/** Synchronously known text (after a load), or undefined. Lets revisits render without a flash. */
const known = new Map<string, PreviewText>();
export function knownPreview(tr: string, key: string): PreviewText | undefined {
  return known.get(`${tr}|${key}`);
}
export function rememberPreview(tr: string, key: string, text: PreviewText): void {
  known.set(`${tr}|${key}`, text);
}

/** Tests: forget everything. */
export function resetPreviews(): void {
  chapterJobs.clear();
  known.clear();
  queue.length = 0;
  running = 0;
}
