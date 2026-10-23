/**
 * The text of one verse in the translation on screen, loaded when the item comes near the viewport
 * (IntersectionObserver; immediately where that's unavailable). A skeleton line reserves the space
 * while it loads; optional highlight colour draws it the way the reader does.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { HighlightColor } from '../../app/study';
import { knownPreview, loadVersePreview, rememberPreview } from './previews';
import type { PreviewText } from './previews';

export interface VersePreviewProps {
  tr: string;
  /** Translation abbreviation for messages ("KJV"). */
  abbr: string;
  vkey: string;
  color?: HighlightColor;
  /** Smaller, quoted style (under a note). */
  quiet?: boolean;
}

type State = { s: 'idle' | 'loading' } | { s: 'ok'; text: PreviewText } | { s: 'error' };

export function VersePreview({ tr, abbr, vkey, color, quiet }: VersePreviewProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<State>(() => {
    const k = knownPreview(tr, vkey);
    return k === undefined ? { s: 'idle' } : { s: 'ok', text: k };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const k = knownPreview(tr, vkey);
    if (k !== undefined) {
      setState({ s: 'ok', text: k });
      return;
    }
    let off = false;
    const start = () => {
      if (off) return;
      setState({ s: 'loading' });
      loadVersePreview(tr, vkey).then(
        (text) => {
          rememberPreview(tr, vkey, text);
          if (!off) setState({ s: 'ok', text });
        },
        () => !off && setState({ s: 'error' }),
      );
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      start();
      return () => {
        off = true;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => {
      off = true;
      io.disconnect();
    };
  }, [tr, vkey, attempt]);

  const cls = `ms-verse${quiet ? ' ms-verse--quiet' : ''}`;
  if (state.s === 'ok' && state.text) {
    return (
      <p class={cls} ref={ref}>
        {color ? (
          <span class="ms-c ms-hltext" data-c={color}>
            {state.text}
          </span>
        ) : (
          state.text
        )}
      </p>
    );
  }
  if (state.s === 'ok') {
    return (
      <p class={`${cls} ms-verse--missing`} ref={ref}>
        This verse isn’t in the {abbr}.
      </p>
    );
  }
  if (state.s === 'error') {
    return (
      <p class={`${cls} ms-verse--missing`} ref={ref}>
        Couldn’t load the {abbr} text.{' '}
        <button type="button" class="link-btn" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <p class={`${cls} ms-verse--loading`} ref={ref} aria-busy="true">
      <span class="skeleton" />
      <span class="skeleton ms-verse__sk2" />
      <span class="sr-only">Loading the verse text…</span>
    </p>
  );
}
