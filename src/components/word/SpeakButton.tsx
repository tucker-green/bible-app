/**
 * Pronounce a Greek or Hebrew word with speech synthesis ("Modern pronunciation"; see
 * src/lib/speech.ts). Uses an el-GR / he-IL voice when the device has one, otherwise reads the
 * transliteration with an English voice (the accessible name and tooltip say which).
 *
 * - Accessible name: "Pronounce λόγος (modern pronunciation)" — built from visually hidden text so
 *   the word carries its own `lang` and screen readers switch voice for it.
 * - aria-pressed while speaking; pressing again stops. One word speaks at a time across the page;
 *   pronouncing a word pauses Listen mode.
 * - 32px (sm) / 40px (md) visual, ≥ 44px hit area on touch screens.
 * - Renders nothing when speech synthesis is unavailable, or once it is clear the device has no voices.
 */
import { signal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { getVoices, loadVoices, onVoicesChanged, speak, speechModeFor, speechSupported, stop, voicesLoaded } from '../../lib/speech';
import { MediaIcon } from '../listen/icons';
import './SpeakButton.css';

export interface SpeakButtonProps {
  /** The word in its original script. */
  text: string;
  lang: 'grc' | 'hbo';
  /** Transliteration, spoken with an English voice when no Greek/Hebrew voice exists. */
  translit?: string;
  /** Visual size. */
  size?: 'sm' | 'md';
}

/** Which button is speaking right now (one at a time). */
const speakingId = signal<number | null>(null);
let nextId = 1;

function usable(): boolean {
  return getVoices().length > 0 || !voicesLoaded();
}

export function SpeakButton({ text, lang, translit, size = 'sm' }: SpeakButtonProps) {
  const id = useMemo(() => nextId++, []);
  const supported = speechSupported();
  const [, setVoicesTick] = useState(0);

  useEffect(() => {
    if (!supported) return;
    const off = onVoicesChanged(() => setVoicesTick((n) => n + 1));
    loadVoices().then(() => setVoicesTick((n) => n + 1));
    return () => {
      off();
      if (speakingId.peek() === id) {
        stop();
        speakingId.value = null;
      }
    };
  }, [supported]);

  // A different word in the same card: stop the old one.
  useEffect(() => {
    if (speakingId.peek() === id) {
      stop();
      speakingId.value = null;
    }
  }, [text, lang]);

  if (!supported || !text || !usable()) return null;

  const mode = speechModeFor(lang, Boolean(translit));
  const speaking = speakingId.value === id;
  const how = mode === 'translit' ? 'transliteration, English voice' : 'modern pronunciation';
  const title = mode === 'translit' ? `Pronounce (no ${lang === 'grc' ? 'Greek' : 'Hebrew'} voice on this device: reads the transliteration)` : 'Modern pronunciation';

  const onClick = () => {
    if (speaking) {
      stop();
      speakingId.value = null;
      return;
    }
    speakingId.value = id; // pressed state at once, before the voice starts
    const done = () => {
      if (speakingId.peek() === id) speakingId.value = null;
    };
    const h = speak(text, lang, { translit, onEnd: done, onError: done });
    if (!h) done();
    else setTimeout(done, 8000); // some engines never fire `end`: don't stay pressed forever
  };

  return (
    <button
      type="button"
      class={`speak speak--${size}${speaking ? ' is-speaking' : ''}`}
      aria-pressed={speaking}
      title={title}
      onClick={onClick}
      data-keep-word
    >
      <MediaIcon name="speaker" />
      <span class="sr-only">
        Pronounce{' '}
        <span lang={lang === 'grc' ? 'el' : 'he'} dir={lang === 'grc' ? undefined : 'rtl'}>
          {text}
        </span>{' '}
        ({how})
      </span>
    </button>
  );
}
