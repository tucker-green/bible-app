/**
 * #/word/{strongsId} — word study page. STUB: the word-study agent replaces this file.
 *
 * Contract (keep it): default export, props `WordStudyPageProps`.
 *   id — normalised Strong's id from the route ("G3056", "H0430", "H0871a"); the router has already
 *        validated it with normalizeStrongs(). Load with loadLexEntry(id) (src/lib/data.ts),
 *        loadWordStudy(id) (src/lib/wordstudy.ts) and loadConcordance(id).
 * Use <PageLayout> (src/components/layout/PageLayout.tsx) for the page frame (one <h1>, back link,
 * document title). Links back into the reader: refToHash(passage.value.tr, ref).
 */
import { ComingSoon, PageLayout } from '../components/layout/PageLayout';
import { displayStrongs } from '../components/word/cardModel';

export interface WordStudyPageProps {
  id: string;
}

export default function WordStudyPage({ id }: WordStudyPageProps) {
  const label = displayStrongs(id);
  return (
    <PageLayout eyebrow={`Word study · ${id.startsWith('G') ? 'Greek' : 'Hebrew'}`} title={label} docTitle={`Word study ${label}`}>
      <ComingSoon>The full word study for {label} — every form, where it occurs, and its Septuagint bridge — is on its way.</ComingSoon>
    </PageLayout>
  );
}
