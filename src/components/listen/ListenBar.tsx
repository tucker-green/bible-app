/**
 * Listen mode: reads the current chapter aloud verse by verse, driving `listeningVerse` in
 * src/app/state.ts (the reader highlights and scrolls to that verse).
 * STUB: mounted by the app shell; the implementation is being written by the feedback/speech agent.
 * Exposes startListening(fromVerse?) for the verse sheet's "Listen from here" action.
 */
export function startListening(_fromVerse?: number): void {}
export function stopListening(): void {}

export function ListenBar() {
  return null;
}
