/**
 * Verse sheet → Cross references (OpenBible.info, CC BY; src/lib/xrefs.ts).
 *
 * The verse's cross references grouped Old / New Testament, strongest first, each with a vote-strength
 * meter (spelled out for screen readers) and a one-line preview of the target in the translation being
 * read (ranges: first verse + "…"); "Show N more" after 8. Following one closes the sheet, opens the
 * target verse and offers "Back to John 3:16" (src/components/xrefs/navigate.ts, XrefBack.tsx).
 * Loading (skeleton rows, aria-busy), error (retry) and empty states are part of the section.
 */
import { useMemo } from 'preact/hooks';
import { xrefsForVerse } from '../../lib/xrefs';
import { uniqueTargets } from '../xrefs/model';
import { useXrefChapter } from '../xrefs/useXrefs';
import { XrefList } from '../xrefs/XrefList';
import type { VerseSectionProps } from './types';

/** Shown before "Show more" (docs: the strongest eight). */
export const SHEET_LIMIT = 8;

export const OPENBIBLE_URL = 'https://www.openbible.info/labs/cross-references/';

function SkeletonRows() {
  return (
    <div class="xr-skel" aria-hidden="true">
      {[64, 78, 56].map((w, i) => (
        <div class="xr-skel__row" key={i}>
          <span class="skeleton" style={{ width: '34%' }} />
          <span class="skeleton" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

export function XrefSection({ book, chapter, verse, tr }: VerseSectionProps) {
  const x = useXrefChapter(book, chapter);
  const targets = useMemo(() => (x.ch ? uniqueTargets(xrefsForVerse(x.ch, verse)) : []), [x.ch, verse]);
  const titleId = 'vs-xref-title';
  const n = targets.length;

  return (
    <section class="vs-sec xr-sec" aria-labelledby={titleId} aria-busy={x.status === 'loading' ? 'true' : undefined}>
      <div class="xr-sec__head">
        <h3 class="vs-sec__title" id={titleId}>
          Cross references
        </h3>
        {x.status === 'ready' && n > 0 && (
          <span class="xr-sec__count tnum">
            {n}
            <span class="sr-only"> {n === 1 ? 'reference' : 'references'}, strongest first</span>
          </span>
        )}
      </div>
      {x.status === 'loading' && <SkeletonRows />}
      {x.status === 'error' && (
        <p class="xr-msg" role="alert">
          Cross references didn’t load.{' '}
          <button type="button" class="xr-retry" onClick={x.retry}>
            Try again
          </button>
        </p>
      )}
      {x.status === 'ready' && n === 0 && <p class="xr-msg">No cross references for this verse yet.</p>}
      {x.status === 'ready' && n > 0 && (
        <XrefList
          key={`${book}.${chapter}.${verse}`}
          tr={tr}
          from={{ book, chapter, verse }}
          targets={targets}
          variant="sheet"
          limit={SHEET_LIMIT}
          idPrefix="vs-xref"
        />
      )}
      {x.status === 'ready' && (
        <p class="xr-src">
          Ranked by readers’ votes at{' '}
          <a href={OPENBIBLE_URL} target="_blank" rel="noopener noreferrer">
            OpenBible.info
          </a>{' '}
          (CC BY).
        </p>
      )}
    </section>
  );
}
