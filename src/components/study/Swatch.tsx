/**
 * A highlight colour sample: the tint plus a short line in the colour's own underline style
 * (solid / double / dashed / dotted / wavy — the same styles the reader uses for highlighted
 * verses), so the swatch teaches the pattern and colour is never the only cue. Decorative: the
 * colour's name is always visible beside it.
 */
import type { JSX } from 'preact';
import type { HighlightColor } from '../../app/study';
import { HIGHLIGHT_PATTERNS } from '../../app/study';

/** Fresh elements per render (a vnode must not be mounted in two places at once). */
const LINES: Record<(typeof HIGHLIGHT_PATTERNS)[HighlightColor], () => JSX.Element> = {
  solid: () => <path d="M1 3H23" stroke-width="1.7" />,
  double: () => <path d="M1 1.4H23M1 4.6H23" stroke-width="1.2" />,
  dashed: () => <path d="M1 3H23" stroke-width="1.7" stroke-dasharray="4.4 2.6" />,
  dotted: () => <path d="M2 3H23" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="0 3.8" />,
  wavy: () => <path d="M1 3q1.5-2.6 3 0t3 0 3 0 3 0 3 0 3 0 3 0" stroke-width="1.3" />,
};

export function Swatch({ color, size = 'md' }: { color: HighlightColor; size?: 'sm' | 'md' }) {
  return (
    <span class={`ms-sw ms-sw--${size} ms-c`} data-c={color} aria-hidden="true">
      <svg class="ms-sw__pat" viewBox="0 0 24 6" focusable="false">
        {LINES[HIGHLIGHT_PATTERNS[color]]()}
      </svg>
    </span>
  );
}
