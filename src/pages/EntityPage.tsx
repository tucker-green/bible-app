/**
 * #/person/{id} and #/place/{id} — a person or place from the names data. STUB: the names agent
 * replaces this file.
 *
 * Contract (keep it): default export, props `EntityPageProps`.
 *   kind — 'person' | 'place' (from the route; a group/other entity may still arrive as 'person').
 *   id   — entity id, lower-case ("p0685", "l0123", "g0007"); load with loadEntity(id) from
 *          src/lib/names.ts (may resolve undefined: show a not-found state).
 * Lineage link: `#/lineage/${id}`. Use <PageLayout> for the frame.
 */
import { ComingSoon, PageLayout } from '../components/layout/PageLayout';

export interface EntityPageProps {
  kind: 'person' | 'place';
  id: string;
}

export default function EntityPage({ kind, id }: EntityPageProps) {
  const what = kind === 'person' ? 'Person' : 'Place';
  return (
    <PageLayout eyebrow={kind === 'person' ? 'People of the Bible' : 'Places of the Bible'} title={what} docTitle={`${what} ${id}`}>
      <ComingSoon>This {kind} page ({id}) is on its way.</ComingSoon>
    </PageLayout>
  );
}
