/**
 * Verse sheet → Highlight: five named colours (each with its own underline pattern, so colour is
 * never the only cue) and "Remove". Pressing the current colour again also removes it.
 * Writes through setHighlight() in src/app/study.ts (persisted in this browser); the reader's
 * decorations follow the signal.
 */
import { HIGHLIGHT_COLORS, HIGHLIGHT_NAMES, HIGHLIGHT_PATTERNS, highlights, setHighlight, verseKey } from '../../app/study';
import type { HighlightColor } from '../../app/study';
import { showToast } from '../../app/state';
import { feedback } from '../../lib/feedback';
import { formatReference } from '../../lib/reference';
import { StudyIcon } from '../study/icons';
import { Swatch } from '../study/Swatch';
import '../study/study.css';
import type { VerseSectionProps } from './types';

export function HighlightSection({ book, chapter, verse }: VerseSectionProps) {
  const key = verseKey(book, chapter, verse);
  const cur = highlights.value[key];
  const ref = formatReference({ book, chapter, verse });
  const set = (c: HighlightColor | null) => {
    if (!setHighlight(key, c)) return;
    feedback('select');
    showToast(c ? `${ref} highlighted ${HIGHLIGHT_NAMES[c].toLowerCase()}` : 'Highlight removed');
  };
  return (
    <section class="vs-sec ms-hl" aria-labelledby="vs-hl-title">
      <div class="ms-hl__head">
        <h3 class="vs-sec__title" id="vs-hl-title">
          Highlight
        </h3>
        {cur && (
          <button type="button" class="ms-hl__remove" onClick={() => set(null)}>
            <StudyIcon name="erase" />
            <span>Remove</span>
          </button>
        )}
      </div>
      <div class="ms-hl__row" role="group" aria-label="Highlight colour">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            class="ms-hl__opt"
            data-c={c}
            aria-pressed={cur === c}
            aria-describedby={`ms-hl-pat-${c}`}
            onClick={() => set(cur === c ? null : c)}
          >
            <span class="ms-hl__chip">
              <Swatch color={c} />
              {cur === c && <StudyIcon name="check" class="ms-hl__tick" />}
            </span>
            <span class="ms-hl__name">{HIGHLIGHT_NAMES[c]}</span>
          </button>
        ))}
      </div>
      <div hidden>
        {HIGHLIGHT_COLORS.map((c) => (
          <span key={c} id={`ms-hl-pat-${c}`}>
            {HIGHLIGHT_PATTERNS[c]} underline
          </span>
        ))}
      </div>
    </section>
  );
}
