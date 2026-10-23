/**
 * Pronounce a Greek or Hebrew word with speech synthesis ("Modern pronunciation").
 * STUB: props are fixed; the implementation is being written by the feedback/speech agent.
 * Renders nothing when speech synthesis is unavailable.
 */
export interface SpeakButtonProps {
  /** The word in its original script. */
  text: string;
  lang: 'grc' | 'hbo';
  /** Transliteration, spoken with an English voice when no Greek/Hebrew voice exists. */
  translit?: string;
  /** Visual size. */
  size?: 'sm' | 'md';
}

export function SpeakButton(_props: SpeakButtonProps) {
  return null;
}
