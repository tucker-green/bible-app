/**
 * Word splitting shared by the data pipeline and the browser (for translations
 * fetched at runtime). Matches the BSB source tokenisation: possessives
 * ("Uriah’s") and hyphenated compounds ("seed-bearing") are single words;
 * dashes, quotes and other punctuation are separate.
 */

export interface Segment {
  text: string;
  /** True for a word (letters/digits with internal apostrophes or hyphens). */
  word: boolean;
}

// A word: letters/marks/digits, optionally joined by an apostrophe or a single hyphen
// to more letters ("Uriah’s", "seed-bearing", "o'clock"). A trailing possessive
// apostrophe ("brothers’") is part of the word too.
const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’‑-][\p{L}\p{M}\p{N}]+)*(?:['’](?=\s|$|[^\p{L}\p{N}]))?/gu;

/** Split text into alternating word / non-word segments; joining every `text` reproduces the input exactly. */
export function segment(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), word: false });
    out.push({ text: m[0], word: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), word: false });
  return out;
}

/** Just the words of `text`, in order. */
export function words(text: string): string[] {
  return segment(text)
    .filter((s) => s.word)
    .map((s) => s.text);
}

/**
 * Case- and accent-insensitive comparison key for an English word:
 * lower-cased, curly apostrophes folded, diacritics stripped, trailing possessive removed.
 * ("Uriah’s" -> "uriah", "brothers’" -> "brothers", "Naïve" -> "naive").
 */
export function foldWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/'s$/, '')
    .replace(/'$/, '');
}
