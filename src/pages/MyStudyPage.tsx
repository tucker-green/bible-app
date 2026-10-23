/**
 * #/study — my highlights, notes and bookmarks. STUB: the personal-study agent replaces this file.
 *
 * Contract (keep it): default export, no props (`MyStudyPageProps` is empty).
 * Data: highlights / notes / bookmarks signals in src/app/study.ts (verse keys "BOOK.CH.V").
 * Use <PageLayout> for the frame.
 */
import { ComingSoon, PageLayout } from '../components/layout/PageLayout';

export type MyStudyPageProps = Record<string, never>;

export default function MyStudyPage(_props: MyStudyPageProps) {
  return (
    <PageLayout eyebrow="My study" title="Highlights, notes & bookmarks" docTitle="My study">
      <ComingSoon>Your highlights, notes and bookmarks will be listed here. They are kept only in this browser.</ComingSoon>
    </PageLayout>
  );
}
