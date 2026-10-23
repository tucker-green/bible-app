/**
 * Stage "search": one plain-text corpus per bundled translation -> public/data/search/{TR}.json
 *
 * Generic: indexes every translation directory present under public/data/text/, so it is re-run
 * after the kjv / bridged stages add theirs.
 *
 * Psalm titles: a chapter's superscription is emitted as its own row with verse 0, just before
 * verse 1 (so "choirmaster" or "Bathsheba" find the Psalm title, while verse 1's text stays
 * exactly the verse). Consumers should display verse 0 as the Psalm's title, not as "51:0".
 */
import { existsSync, readdirSync } from 'node:fs';
import type { SearchCorpus, TextChapter, Token } from '../../src/lib/types';
import { allChapters, cleanOut, log, outPath, readJson, writeJson } from './common';

/** Plain text of a token list, whitespace-normalised. */
export function plainText(tokens: readonly Token[]): string {
  return tokens
    .map((t) => (typeof t === 'string' ? t : t[0]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Corpus rows for one chapter: optional superscription (verse 0), then every verse in order. */
export function chapterRows(bookNum: number, ch: TextChapter): SearchCorpus['verses'] {
  const rows: SearchCorpus['verses'] = [];
  if (ch.superscription?.length) {
    const text = plainText(ch.superscription);
    if (text) rows.push([bookNum, ch.chapter, 0, text]);
  }
  for (const v of ch.verses) rows.push([bookNum, ch.chapter, v.v, plainText(v.t)]);
  return rows;
}

/** Translation ids that have a text directory. */
export function presentTranslations(): string[] {
  const dir = outPath('text');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function buildSearch(): void {
  cleanOut('search');
  const chapters = allChapters();
  for (const tr of presentTranslations()) {
    const corpus: SearchCorpus = { tr, verses: [] };
    let missing = 0;
    for (const { book, chapter } of chapters) {
      const p = outPath('text', tr, book.id, `${chapter}.json`);
      if (!existsSync(p)) {
        missing++;
        continue;
      }
      corpus.verses.push(...chapterRows(book.num, readJson<TextChapter>(p)));
    }
    const bytes = writeJson(outPath('search', `${tr}.json`), corpus);
    log('search', `${tr}: ${corpus.verses.length} rows, ${(bytes / 1e6).toFixed(1)} MB${missing ? `, WARNING: ${missing} chapter files missing` : ''}`);
  }
}
