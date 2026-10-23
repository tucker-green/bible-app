/**
 * #/compare/{TR1},{TR2}[,{TR3}]/{BOOK}/{CHAPTER}[/{VERSE}] — translations side by side.
 * STUB: the compare agent replaces this file.
 *
 * Contract (keep it): default export, props `ComparePageProps`.
 *   trs     — 2–3 distinct translation ids, upper-cased as typed in the URL (validate against
 *             `translations.value` with resolveTranslation from src/app/router.ts).
 *   book    — USFM book id ("JHN"); chapter — valid for the book (router-checked).
 *   verse   — optional verse to scroll to / highlight.
 * Build links with compareHash(trs, book, chapter, verse) from src/app/router.ts.
 * Load text with loadText(tr, book, chapter) (src/lib/data.ts). Use <PageLayout wide>.
 */
import { ComingSoon, PageLayout } from '../components/layout/PageLayout';
import { formatChapter } from '../lib/reference';

export interface ComparePageProps {
  trs: string[];
  book: string;
  chapter: number;
  verse?: number;
}

export default function ComparePage({ trs, book, chapter }: ComparePageProps) {
  const ref = formatChapter(book, chapter);
  return (
    <PageLayout eyebrow={`Compare · ${trs.join(' · ')}`} title={ref} docTitle={`${ref} — ${trs.join(', ')}`} wide>
      <ComingSoon>Side-by-side reading of {ref} in the {trs.join(', ')} is on its way.</ComingSoon>
    </PageLayout>
  );
}
