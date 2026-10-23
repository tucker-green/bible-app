/**
 * Desktop / laptop (≥ 1024 px): a compact "Cross references" block in the reader's rails for the
 * verse being looked at (./readingVerse.ts). Desktop (≥ 1440 px) puts it at the top of the right
 * rail; laptops (1024–1439 px), whose right rail lives in a drawer, put it under the contents in the
 * left rail. Mount one of each (`placement`) — only the one matching the window renders, so there is
 * never a duplicate block. The full list is one click away in the verse panel ("All N").
 */
import { useMemo } from 'preact/hooks';
import { openVerseSheet, passage } from '../../app/state';
import { formatReference } from '../../lib/reference';
import { xrefsForVerse } from '../../lib/xrefs';
import { useMedia } from '../common/hooks';
import { uniqueTargets } from './model';
import { useReadingVerse } from './readingVerse';
import { useXrefChapter } from './useXrefs';
import { XrefList } from './XrefList';
import './xrefs.css';

/** References shown in the rail before "All N cross references". */
export const RAIL_LIMIT = 5;

export const RAIL_MEDIA = {
  right: '(min-width: 1440px)',
  left: '(min-width: 1024px) and (max-width: 1439.98px)',
} as const;

export function XrefRail({ placement }: { placement: 'left' | 'right' }) {
  const on = useMedia(RAIL_MEDIA[placement]);
  return on ? <XrefRailBlock /> : null;
}

function XrefRailBlock() {
  const { tr, ref } = passage.value;
  const { book, chapter } = ref;
  const verse = useReadingVerse(tr, book, chapter);
  const x = useXrefChapter(book, chapter);
  const targets = useMemo(() => (x.ch && verse ? uniqueTargets(xrefsForVerse(x.ch, verse)) : []), [x.ch, verse]);
  const label = verse ? formatReference({ book, chapter, verse }) : null;

  return (
    <section class="xr-rail" aria-labelledby="xr-rail-title">
      <h2 class="eyebrow rail__title" id="xr-rail-title">
        Cross references
      </h2>
      <p class="xr-rail__verse">
        {label ? (
          <>
            <span class="sr-only">For </span>
            {label}
            {x.status === 'ready' && targets.length > 0 && (
              <span class="xr-rail__n tnum">
                {' '}
                · {targets.length}
                <span class="sr-only"> {targets.length === 1 ? 'reference' : 'references'}</span>
              </span>
            )}
          </>
        ) : (
          <span class="xr-rail__wait">Follows the verse you read or point at</span>
        )}
      </p>
      {/* fixed height: the rail must not jump as the verse changes */}
      <div class="xr-rail__body">
        {x.status === 'error' && (
          <p class="xr-msg">
            Couldn’t load them.{' '}
            <button type="button" class="xr-retry" onClick={x.retry}>
              Try again
            </button>
          </p>
        )}
        {x.status === 'ready' && verse !== null && targets.length === 0 && <p class="xr-msg">None for this verse yet.</p>}
        {x.status === 'ready' && verse !== null && targets.length > 0 && (
          <XrefList
            key={`${book}.${chapter}.${verse}`}
            tr={tr}
            from={{ book, chapter, verse }}
            targets={targets}
            variant="rail"
            limit={RAIL_LIMIT}
            idPrefix="xr-rail"
            previewDelay={180}
            onMore={() => openVerseSheet(`${tr}/${book}/${chapter}`, verse)}
          />
        )}
      </div>
      <p class="rail__note">Ranked by votes at OpenBible.info.</p>
    </section>
  );
}
