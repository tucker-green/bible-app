/**
 * Verse sheet → Compare translations: the tapped verse in every translation — the bundled ones in
 * picker order (KJV first), then the reader's own API.Bible ones such as the NIV — each with its
 * alignment meter (how closely its words are linked to the Greek / Hebrew, spelled out in words),
 * a link to read the verse there and a link to compare the chapter side by side with the
 * translation on screen. "Compare chapter" opens the compare page at this verse.
 *
 * Each translation loads on its own (skeleton line, "Didn’t load · Try again"); a verse a translation
 * does not have (Matthew 17:21 in the BSB) says so. Text from API.Bible carries its copyright line
 * and is reported to API.Bible's fair-use service when shown, as its terms require.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { compareHash } from '../../app/router';
import { closeVerseSheet, openSettings, translations } from '../../app/state';
import { APIBIBLE_ATTRIBUTION, apiBibleMeta } from '../../lib/providers/apibible';
import { formatChapter, formatReference, refToHash } from '../../lib/reference';
import { shortName } from '../common/alignment';
import { Meter } from '../common/Meter';
import { Typeset } from '../common/Typeset';
import { reportRemoteView, useChapterTexts } from '../compare/data';
import { partnerFor, verseText } from '../compare/model';
import { UiIcon } from '../shell/icons';
import type { VerseSectionProps } from './types';
import '../compare/section.css';

export function CompareSection({ book, chapter, verse, tr }: VerseSectionProps) {
  const list = translations.value;
  const ids = useMemo(() => list.map((t) => t.id), [list]);
  const [attempt, setAttempt] = useState(0);
  const texts = useChapterTexts(ids, book, chapter, attempt);
  const ref = { book, chapter, verse };
  const refLabel = formatReference(ref);
  const chLabel = formatChapter(book, chapter);
  const cur = list.find((t) => t.id === tr);
  const curAbbr = cur?.abbr ?? tr;
  const partner = partnerFor(tr, list);
  const hasNiv = list.some((t) => t.id.toUpperCase() === 'NIV');
  const busy = texts.some((t) => t.status === 'loading');

  // API.Bible text on screen: report it (FUMS), once per chapter shown.
  const shownRemote = texts.filter((t) => t.status === 'ready' && apiBibleMeta(t.text));
  useEffect(() => {
    for (const t of shownRemote) if (t.status === 'ready') reportRemoteView(t.text);
  }, [shownRemote.map((t) => t.tr).join(','), book, chapter]);

  return (
    <section class="vs-sec cmpv" aria-labelledby="vs-cmp-title" aria-busy={busy ? 'true' : undefined}>
      <div class="cmpv__top">
        <h3 class="vs-sec__title" id="vs-cmp-title">
          Compare translations
        </h3>
        {partner && (
          <a class="cmpv__all" href={compareHash([tr, partner], book, chapter, verse)} onClick={() => closeVerseSheet()}>
            <UiIcon name="compare" />
            <span>Compare chapter</span>
            <span class="sr-only">
              {' '}
              — {chLabel} in the {curAbbr} and {list.find((t) => t.id === partner)?.abbr ?? partner}, side by side
            </span>
          </a>
        )}
      </div>
      <ul class="cmpv__list">
        {list.map((t) => {
          const st = texts.find((x) => x.tr === t.id);
          const here = t.id === tr;
          const text = st?.status === 'ready' ? verseText(st.text, verse) : null;
          const remote = st?.status === 'ready' ? apiBibleMeta(st.text) : undefined;
          return (
            <li key={t.id} class={`cmpv__row${here ? ' is-here' : ''}`} aria-current={here ? 'true' : undefined}>
              <div class="cmpv__head">
                {here ? (
                  <span class="cmpv__abbr">{t.abbr}</span>
                ) : (
                  <a class="cmpv__abbr" href={refToHash(t.id, ref)} onClick={() => closeVerseSheet()} aria-label={`${t.abbr}: read ${refLabel} in the ${t.name}`}>
                    {t.abbr}
                  </a>
                )}
                <span class="cmpv__name">{shortName(t.name)}</span>
                <span class="cmpv__meter">
                  <Meter kind={t.alignment} />
                </span>
                {here ? (
                  <span class="cmpv__tag">Reading</span>
                ) : (
                  <a
                    class="cmpv__cmp"
                    href={compareHash([tr, t.id], book, chapter, verse)}
                    onClick={() => closeVerseSheet()}
                    aria-label={`Compare ${chLabel} in the ${curAbbr} and ${t.abbr}`}
                    title={`Compare with the ${curAbbr}, side by side`}
                  >
                    <UiIcon name="compare" />
                  </a>
                )}
              </div>
              {!st || st.status === 'loading' ? (
                <div class="cmpv__skel" aria-hidden="true">
                  <span class="skeleton" style={{ width: '92%' }} />
                  <span class="skeleton" style={{ width: '64%' }} />
                </div>
              ) : st.status === 'error' ? (
                <p class="cmpv__msg">
                  The {t.abbr} didn’t load.{' '}
                  <button type="button" class="link-btn" onClick={() => setAttempt((n) => n + 1)}>
                    Try again
                  </button>
                </p>
              ) : text ? (
                <p class="cmpv__txt">
                  <Typeset text={text} />
                </p>
              ) : (
                <p class="cmpv__msg">
                  {refLabel} is not in the {t.abbr}.
                </p>
              )}
              {remote && (
                <p class="cmpv__copy">
                  {t.license.replace(/\s*·\s*via API\.Bible$/, '')} ·{' '}
                  <a href={APIBIBLE_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer">
                    {APIBIBLE_ATTRIBUTION.text}
                  </a>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {!hasNiv && (
        <p class="cmpv__more">
          <button
            type="button"
            class="link-btn"
            onClick={() => {
              closeVerseSheet();
              openSettings('niv');
            }}
          >
            Add the NIV
          </button>{' '}
          with your own API.Bible key.
        </p>
      )}
    </section>
  );
}
