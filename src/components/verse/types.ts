/**
 * Props every verse-sheet section receives (src/components/verse/VerseSheet.tsx renders them in
 * order: Highlight, Note, Cross references, Compare).
 *   book    — USFM book id ("JHN"); chapter / verse — English versification.
 *   tr      — the translation on screen ("KJV"); use it for links back into the reader
 *             (refToHash(tr, ref)) and as the first column of a compare.
 * Personal-study keys: verseKey(book, chapter, verse) from src/app/study.ts.
 * Sections render their own <section class="vs-sec" aria-labelledby=…> with an <h3 class="vs-sec__title">
 * (the sheet title is the <h2>), or null when they have nothing to show.
 */
export interface VerseSectionProps {
  book: string;
  chapter: number;
  verse: number;
  tr: string;
}
