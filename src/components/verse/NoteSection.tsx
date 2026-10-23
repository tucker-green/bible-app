/**
 * Verse sheet → Note: a plain-text note on this verse, saved as you type (src/app/study.ts, kept
 * only in this browser), with a character count and Delete. The reader shows a note glyph by the
 * verse number whenever a note exists. Remounts the editor per verse so a pending save always goes
 * to the verse it was typed for.
 */
import { verseKey } from '../../app/study';
import { formatReference } from '../../lib/reference';
import { NoteEditor } from '../study/NoteEditor';
import '../study/study.css';
import type { VerseSectionProps } from './types';

export function NoteSection({ book, chapter, verse }: VerseSectionProps) {
  const key = verseKey(book, chapter, verse);
  const ref = formatReference({ book, chapter, verse });
  return (
    <section class="vs-sec ms-note-sec" aria-labelledby="vs-note-title">
      <h3 class="vs-sec__title" id="vs-note-title">
        Note
      </h3>
      <NoteEditor key={key} vkey={key} refLabel={ref} idBase="vs-note" rows={3} />
    </section>
  );
}
