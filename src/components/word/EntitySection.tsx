/**
 * Slot inside every word card for people & places (docs/ROADMAP.md v1: "people & places cards").
 * STUB: the names agent replaces this file — keep the export name and props.
 *
 * Props:
 *   book, chapter — the chapter on screen (USFM id, English chapter number).
 *   origIndices   — the indices into OrigChapter.words that the English word links to (Unit.links;
 *                   [] for supplied words and KJV lexicon-only words). Look them up with
 *                   loadNameChapter(book, chapter) + entityForWord() from src/lib/names.ts and render
 *                   nothing when none of them names a person or place.
 * Rendered between the facts and the definition, in both the popover and the bottom sheet; links
 * should go to #/person/{id}, #/place/{id} or #/lineage/{id} (and call closeWord()).
 */
export interface EntitySectionProps {
  book: string;
  chapter: number;
  origIndices: number[];
}

export function EntitySection(_props: EntitySectionProps) {
  return null;
}
