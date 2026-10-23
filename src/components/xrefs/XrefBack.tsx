/**
 * "← Back to John 3:16" — shown after following a cross reference, while the target chapter is on
 * screen (bottom centre, above the dock; it steps up while a toast is showing and hides under open
 * bottom sheets). Activating it returns to the verse the reference was followed from; × dismisses it.
 * Following references from the target builds a short trail (./navigate.ts), so "Back" walks it.
 */
import { useEffect } from 'preact/hooks';
import { passage, route } from '../../app/state';
import { formatReference } from '../../lib/reference';
import { UiIcon } from '../shell/icons';
import { clearTrail, goBackXref, pruneTrail, visibleEntry, xrefTrail } from './navigate';
import './xrefs.css';

/** Dismiss the chip; keyboard focus (which was on it) goes back to the text. */
function dismiss(): void {
  clearTrail();
  const v = passage.peek().ref.verse;
  const el = (v ? document.querySelector<HTMLElement>(`#text [data-vn="${v}"]`) : null) ?? document.getElementById('text');
  el?.focus({ preventScroll: true });
}

export function XrefBack() {
  const r = route.value;
  const here = passage.value.ref;
  const trail = xrefTrail.value;

  // Leaving the trail (another chapter that is neither an origin nor a target) clears it.
  useEffect(() => {
    const cur = xrefTrail.peek();
    const next = pruneTrail(cur, here);
    if (next !== cur) xrefTrail.value = [...next];
  }, [here.book, here.chapter]);

  const entry = r.name === 'read' ? visibleEntry(trail, here) : null;
  if (!entry) return null;
  const label = formatReference(entry.from.ref);
  return (
    <nav class="xref-back" aria-label="Cross reference">
      <button type="button" class="xref-back__go" onClick={() => goBackXref(entry)}>
        <UiIcon name="left" />
        <span>Back to {label}</span>
      </button>
      <button type="button" class="xref-back__x" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
        <UiIcon name="close" />
      </button>
    </nav>
  );
}
