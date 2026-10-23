/**
 * #/lineage/{id} — family tree explorer centred on a person. STUB: the names agent replaces this file.
 *
 * Contract (keep it): default export, props `LineagePageProps`.
 *   id — person entity id, lower-case ("p0685"); data from loadFamily() + lineageTree() /
 *        findPath() in src/lib/names.ts. Use <PageLayout wide> for the frame.
 */
import { ComingSoon, PageLayout } from '../components/layout/PageLayout';

export interface LineagePageProps {
  id: string;
}

export default function LineagePage({ id }: LineagePageProps) {
  return (
    <PageLayout eyebrow="Lineage" title="Family tree" docTitle={`Lineage ${id}`} wide>
      <ComingSoon>The family tree explorer ({id}) is on its way.</ComingSoon>
    </PageLayout>
  );
}
