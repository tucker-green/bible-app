/**
 * "Listen" toggle for the chapter header / toolbar: starts Listen mode for the chapter on screen,
 * or stops it when this chapter is already being read. Hidden when the browser can't speak.
 *
 *   <ListenButton />                       // quiet outlined button with a label
 *   <ListenButton variant="icon" />        // 44px icon button (toolbars); the label is its name
 */
import { passage } from '../../app/state';
import { speechSupported } from '../../lib/speech';
import { MediaIcon } from './icons';
import { listenState, startListening, stopListening } from './listen';
import './listen.css';

export function ListenButton({ variant = 'label', class: cls = '' }: { variant?: 'label' | 'icon'; class?: string }) {
  const s = listenState.value;
  const { tr, ref } = passage.value;
  if (!speechSupported()) return null;
  const active = s.status !== 'idle' && s.tr === tr && s.book === ref.book && s.chapter === ref.chapter;
  return (
    <button
      type="button"
      class={`listen-btn listen-btn--${variant}${active ? ' is-active' : ''} ${cls}`.trim()}
      aria-pressed={active}
      aria-label={variant === 'icon' ? 'Listen to this chapter' : undefined}
      title={variant === 'icon' ? (active ? 'Stop reading aloud' : 'Read this chapter aloud') : undefined}
      onClick={() => (active ? stopListening({ announce: true }) : startListening())}
    >
      <MediaIcon name="headphones" />
      {variant === 'label' && <span>Listen</span>}
    </button>
  );
}
