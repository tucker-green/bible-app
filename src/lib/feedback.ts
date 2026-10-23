/**
 * Haptic + audible feedback, fanned out according to the user's settings (docs/EXPERIENCE.md §3).
 *
 * STUB: the API is fixed; the implementation (Vibration API, iOS 18 switch haptic, Web Audio
 * synthesized sounds, throttling) is being written by the feedback agent. Call sites can use it now.
 */
export type FeedbackKind =
  /** a word or item became selected */
  | 'select'
  /** press-and-slide scrubbing engaged (long-press) */
  | 'engage'
  /** moved to the next word while scrubbing (throttled) */
  | 'tick'
  /** a card / sheet was pinned open */
  | 'pin'
  /** copy / bookmark / save succeeded */
  | 'success'
  /** something failed */
  | 'error'
  /** chapter changed */
  | 'page';

/** Fire feedback for an interaction. Safe to call anywhere; a no-op when disabled or unsupported. */
export function feedback(kind: FeedbackKind): void {
  void kind;
}

/** Must be called from a user gesture once, so audio/haptics can initialise (e.g. first pointerdown). */
export function primeFeedback(): void {}
