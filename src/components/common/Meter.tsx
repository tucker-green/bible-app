import type { AlignmentKind } from '../../lib/types';
import { ALIGNMENT } from './alignment';

/** Three-dot alignment-strength meter, always paired with a word (never colour alone). */
export function Meter({ kind, label = true }: { kind: AlignmentKind; label?: boolean }) {
  const info = ALIGNMENT[kind] ?? ALIGNMENT.none;
  return (
    <span class="meter-wrap">
      <span class="meter" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <i key={i} class={i <= info.level ? 'on' : ''} />
        ))}
      </span>
      {label ? <span class="meter__label">{info.label}</span> : <span class="sr-only">{info.label}</span>}
    </span>
  );
}
