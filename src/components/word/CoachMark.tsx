/**
 * One-time coach mark for press-and-slide scrubbing (docs/EXPERIENCE.md §2.3): after the first
 * word tapped on a touch screen, a one-line tip shows at the top of the word sheet (never over the
 * text). It goes away for good when dismissed, after a few seconds, or once the reader has scrubbed
 * (markScrubLearned).
 */
import { useEffect } from 'preact/hooks';
import { pinnedWord } from '../../app/state';
import { UiIcon } from '../shell/icons';
import { coachVisible, markScrubLearned } from './scrub';

export function CoachMark() {
  const show = coachVisible.value && Boolean(pinnedWord.value);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(markScrubLearned, 7000);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return (
    <div class="coach" role="note">
      <span>
        <b>Tip:</b> press and slide across words
      </span>
      <button type="button" class="coach__x" aria-label="Dismiss tip" onClick={markScrubLearned}>
        <UiIcon name="close" />
      </button>
    </div>
  );
}
