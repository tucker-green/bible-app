import type { AlignmentKind, TranslationMeta } from '../../lib/types';

export interface AlignmentInfo {
  /** Meter level: ●●● 3, ●●○ 2, ●○○ 1, ○○○ 0. */
  level: 0 | 1 | 2 | 3;
  /** Short label for pickers. */
  label: string;
  /** Edition / rail wording. */
  long: string;
  /** One-sentence explanation for the About page. */
  explain: string;
}

export const ALIGNMENT: Record<AlignmentKind, AlignmentInfo> = {
  manual: {
    level: 3,
    label: 'Hand-aligned',
    long: 'Hand-aligned by Clear Bible',
    explain:
      'Every English word was linked to the exact Greek or Hebrew word(s) it translates by hand, in Clear Bible’s alignment (with Biblica).',
  },
  strongs: {
    level: 2,
    label: 'Strong’s-tagged',
    long: 'Linked through Strong’s numbers',
    explain:
      'The text carries Strong’s numbers on its words; each is linked to the word of the same verse with that number. Words found only in the Greek text the KJV translated (the Textus Receptus) keep their dictionary entry.',
  },
  bridged: {
    level: 1,
    label: 'Approximate',
    long: 'Matched automatically via the BSB',
    explain:
      'Each word is matched automatically to the BSB word(s) of the same verse and inherits their links, so the links are approximate.',
  },
  none: {
    level: 0,
    label: 'No word links',
    long: 'No word-level links',
    explain: 'This text has no word-level links to the original.',
  },
};

export function alignmentOf(t: Pick<TranslationMeta, 'alignment'> | null | undefined): AlignmentInfo {
  return ALIGNMENT[t?.alignment ?? 'none'] ?? ALIGNMENT.none;
}

/** "King James Version" -> "King James", "Young’s Literal Translation" -> "Young’s Literal". */
export function shortName(name: string): string {
  return name.replace(/\s+(Version|Bible|Translation)$/i, '');
}
