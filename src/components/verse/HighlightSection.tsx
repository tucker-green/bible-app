/**
 * Verse sheet → Highlight. MINIMAL STUB: the personal-study agent replaces this file (keep the
 * export name and props). It already toggles the `highlights` signal of src/app/study.ts so the
 * reader's decorations can be seen; persistence belongs to study.ts.
 * Each colour has a name and a distinct underline pattern (never colour alone).
 */
import { highlights, HIGHLIGHT_COLORS, verseKey } from '../../app/study';
import type { HighlightColor } from '../../app/study';
import { showToast } from '../../app/state';
import { feedback } from '../../lib/feedback';
import type { VerseSectionProps } from './types';

const NAMES: Record<HighlightColor, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink', purple: 'Purple' };

export function HighlightSection({ book, chapter, verse }: VerseSectionProps) {
  const key = verseKey(book, chapter, verse);
  const cur = highlights.value[key];
  const set = (c: HighlightColor | null) => {
    const next = { ...highlights.value };
    if (c) next[key] = c;
    else delete next[key];
    highlights.value = next;
    feedback('success');
    showToast(c ? `Highlighted ${NAMES[c].toLowerCase()}` : 'Highlight removed');
  };
  return (
    <section class="vs-sec" aria-labelledby="vs-hl-title">
      <h3 class="vs-sec__title" id="vs-hl-title">
        Highlight
      </h3>
      <div class="vs-swatches" role="group" aria-label="Highlight colour">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            class={`vs-swatch vs-swatch--${c}`}
            aria-pressed={cur === c}
            onClick={() => set(cur === c ? null : c)}
          >
            <span class="vs-swatch__chip" aria-hidden="true" />
            <span class="vs-swatch__name">{NAMES[c]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
