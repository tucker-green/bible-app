/**
 * Listen mode controller (docs/EXPERIENCE.md §3): reads the current chapter aloud verse by verse
 * with an English voice, driving `listeningVerse` in src/app/state.ts (the reader highlights and
 * scrolls to that verse). The UI is ListenBar.tsx; other components only need:
 *
 *   startListening(fromVerse?)   // from a gesture: "Listen" button, verse sheet "Listen from here"
 *   stopListening()
 *   listenState.value            // { status, tr, book, chapter, verse, verses } for UI
 *
 * How it plays:
 * - The chapter comes from the same loader the reader uses (loadText with the current passage).
 *   Each verse is cleaned for speech (LORD → Lord, brackets dropped) and split into short pieces
 *   (Chrome's remote voices cut off after ~15 s). Starting from the top adds a spoken heading
 *   ("John, chapter 1.") and the Psalm title.
 * - One piece is speaking and the next is already queued in the engine, so verses follow each
 *   other without a gap; every `end` queues the one after. Callbacks carry a generation number so a
 *   pause / skip / stop never acts on stale events.
 * - Pause = cancel + remember the piece (speechSynthesis.pause() is unreliable on Android and with
 *   remote voices); resume restarts that piece. A rate change restarts the current piece.
 * - Another speaker (the word card's pronounce button) cancelling our speech pauses Listen mode.
 * - Stops when the reader navigates to another chapter / translation or leaves the reader (About,
 *   word / person / compare pages…),
 *   or when the page is hidden for good (pagehide). With "Continue into the next chapter" on
 *   (persisted, rootword:listenContinue) it navigates on by itself at the end of a chapter.
 * - Media Session metadata ("John 1 — KJV") and play / pause / previous / next / stop handlers
 *   where supported (browsers usually only surface them while a media element plays, so lock-screen
 *   controls may not appear for speech alone). A screen wake lock is held while playing.
 * - Screen readers: only user-initiated state changes are announced (politely, via announce());
 *   verse changes are not, so we never talk over the reader's own speech or the TTS voice. The
 *   chapter text itself stays readable by the screen reader as usual; Listen mode is an extra.
 */
import { batch, effect, signal } from '@preact/signals';
import { announce, listeningVerse, navigate, passage, route, settings, showToast, translations, updateSettings } from '../../app/state';
import { readString, writeString } from '../../app/storage';
import { getBook } from '../../lib/books';
import { loadText, nextChapter, tokensToText } from '../../lib/data';
import { formatChapter } from '../../lib/reference';
import {
  getVoices,
  loadVoices,
  onPreempt,
  pickVoice,
  speak,
  speechSupported,
  splitForSpeech,
  stop as stopSpeech,
  unlockSpeech,
} from '../../lib/speech';
import type { TextChapter } from '../../lib/types';

export type ListenStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface ListenState {
  status: ListenStatus;
  tr: string;
  book: string;
  chapter: number;
  /** Verse being read / to resume from (0 = Psalm title); null before the first verse is known. */
  verse: number | null;
  /** Verse numbers of the chapter in reading order (0 first when there is a Psalm title). */
  verses: number[];
  /** Human-readable problem (status 'error'). */
  error?: string;
}

const IDLE: ListenState = { status: 'idle', tr: '', book: '', chapter: 0, verse: null, verses: [] };

/** The Listen mode session (read-only for UI; use the actions below to change it). */
export const listenState = signal<ListenState>(IDLE);

/** Continue into the next chapter at the end of one (persisted as rootword:listenContinue). */
export const listenContinue = signal<boolean>(readString('listenContinue') === '1');
export function setListenContinue(on: boolean): void {
  listenContinue.value = on;
  writeString('listenContinue', on ? '1' : '0');
}

/** Speed choices offered by the bar (settings.listenRate may hold any value in 0.75–1.5). */
export const LISTEN_RATES = [0.75, 1, 1.25, 1.5] as const;
export const MIN_RATE = 0.75;
export const MAX_RATE = 1.5;

export function clampRate(r: number): number {
  return Number.isFinite(r) ? Math.min(MAX_RATE, Math.max(MIN_RATE, r)) : 1;
}

/** localStorage key (rootword:listenVoice) of a voiceURI the reader picked in Settings, if any. */
export const LISTEN_VOICE_KEY = 'listenVoice';

/* ------------------------------------------------------------------------ */
/* Text → speakable items                                                    */
/* ------------------------------------------------------------------------ */

export interface ListenItem {
  verse: number;
  text: string;
  /** The spoken chapter heading. */
  intro?: boolean;
}

/** Plain verse text made friendlier for a voice: KJV small-caps words in title case, no brackets / pilcrows. */
export function speakable(s: string): string {
  return s
    .replace(/[¶[\]{}⸂⸃⸀⸁]/g, '')
    .replace(/\b([A-Z])([A-Z]{1,})\b/g, (_m, a: string, b: string) => a + b.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
}

const ORDINALS: Record<string, string> = { '1': 'First', '2': 'Second', '3': 'Third' };

/** What the voice says before verse 1: "John, chapter 1." / "Psalm 23." / "First Corinthians, chapter 13." / "Jude." */
export function spokenHeading(bookId: string, chapter: number): string {
  const b = getBook(bookId);
  if (!b) return `${bookId} ${chapter}.`;
  const name = b.name.replace(/^([123]) /, (_m, n: string) => `${ORDINALS[n]} `);
  if (b.id === 'PSA') return `Psalm ${chapter}.`;
  if (b.chapters === 1) return `${name}.`;
  return `${name}, chapter ${chapter}.`;
}

/** The chapter as a list of short pieces to speak, in order. */
export function buildListenItems(text: TextChapter, opts: { heading?: string } = {}): ListenItem[] {
  const out: ListenItem[] = [];
  const firstVerse = text.superscription?.length ? 0 : (text.verses[0]?.v ?? 1);
  if (opts.heading) out.push({ verse: firstVerse, text: opts.heading, intro: true });
  if (text.superscription?.length) {
    for (const piece of splitForSpeech(speakable(tokensToText(text.superscription)))) out.push({ verse: 0, text: piece });
  }
  for (const v of text.verses) {
    for (const piece of splitForSpeech(speakable(tokensToText(v.t)))) out.push({ verse: v.v, text: piece });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Session                                                                   */
/* ------------------------------------------------------------------------ */

let items: ListenItem[] = [];
/** Index of the piece being spoken (or to resume from). */
let pos = 0;
/** Next piece to hand to the engine. */
let queued = 0;
/** Bumped on every (re)start / pause / stop so stale utterance callbacks are ignored. */
let gen = 0;
/** Bumped when a chapter starts loading or the session stops, so a stale load never plays. */
let loadToken = 0;
/** Pieces queued in the engine ahead of the one speaking. */
const LOOKAHEAD = 1;
/** Voices that failed (network / unavailable) this session: try another. */
const badVoices = new Set<string>();
let retried = -1;
let stopWatchers: (() => void) | null = null;
let returnFocus: HTMLElement | null = null;

const keyOf = (tr: string, book: string, chapter: number) => `${tr}/${book}/${chapter}`;
const stateKey = (s: ListenState) => keyOf(s.tr, s.book, s.chapter);
/** Verse group of piece i (the spoken heading belongs to the first verse / the Psalm title). */
const group = (i: number) => items[i]?.verse ?? -2;

function setState(patch: Partial<ListenState>): void {
  listenState.value = { ...listenState.peek(), ...patch };
}

function setVerse(v: number | null): void {
  batch(() => {
    if (listenState.peek().verse !== v) setState({ verse: v });
    listeningVerse.value = v;
  });
}

function rate(): number {
  return clampRate(settings.peek().listenRate);
}

function englishVoice(): SpeechSynthesisVoice | null {
  const list = getVoices().filter((v) => !badVoices.has(v.voiceURI));
  return pickVoice(list, 'en', readString(LISTEN_VOICE_KEY));
}

function trName(tr: string): string {
  return translations.peek().find((t) => t.id === tr)?.name ?? tr;
}

/** "John 1 — KJV" (Media Session title, bar title). */
export function listenTitle(s: Pick<ListenState, 'book' | 'chapter' | 'tr'> = listenState.peek()): string {
  return `${formatChapter(s.book, s.chapter)} — ${s.tr}`;
}

function indexOfVerse(v: number): number {
  return items.findIndex((it) => !it.intro && it.verse === v);
}

/* ---- engine ------------------------------------------------------------- */

function pump(g: number): void {
  while (g === gen && queued < items.length && queued <= pos + LOOKAHEAD) {
    const i = queued++;
    const voice = englishVoice();
    const h = speak(items[i].text, 'en', {
      rate: rate(),
      voice,
      queue: true,
      onStart: () => {
        if (g !== gen) return;
        pos = i;
        setVerse(items[i].verse);
      },
      onEnd: () => {
        if (g !== gen) return;
        pos = i + 1;
        if (pos >= items.length) chapterDone();
        else {
          setVerse(items[pos].verse);
          pump(g);
        }
      },
      onError: (code) => {
        if (g !== gen) return;
        onSpeechError(code, i, voice);
      },
    });
    if (!h) {
      fail('Reading aloud isn’t available right now.');
      return;
    }
  }
}

function onSpeechError(code: string, i: number, voice: SpeechSynthesisVoice | null): void {
  if (code === 'interrupted' || code === 'canceled') {
    // Someone else (e.g. the pronounce button) took the speaker: pause where we were.
    pos = i;
    pauseListening(false);
    return;
  }
  if (code === 'not-allowed') {
    // iOS: speech wasn't started from a tap. Wait for the play button.
    pos = i;
    pauseListening(false);
    announce('Tap play to start reading aloud.');
    return;
  }
  // network / synthesis-failed / voice-unavailable…: try once more with another voice.
  if (voice && retried !== i) {
    retried = i;
    badVoices.add(voice.voiceURI);
    playFrom(i);
    return;
  }
  fail('The voice stopped unexpectedly. Try again, or choose another voice in your device settings.');
}

function fail(message: string): void {
  gen++;
  stopSpeech();
  setState({ status: 'error', error: message });
  holdWakeLock(false);
  updateMediaSession();
  announce(message);
}

function playFrom(index: number): void {
  if (!items.length) return;
  const g = ++gen;
  stopSpeech();
  pos = Math.max(0, Math.min(index, items.length - 1));
  queued = pos;
  batch(() => {
    setState({ status: 'playing', error: undefined });
    setVerse(items[pos].verse);
  });
  pump(g);
  holdWakeLock(true);
  updateMediaSession();
}

function chapterDone(): void {
  const s = listenState.peek();
  const next = nextChapter(s.book, s.chapter);
  if (listenContinue.peek() && next) {
    void goToChapter(s.tr, next[0], next[1]);
    return;
  }
  gen++;
  batch(() => {
    setState({ status: 'ended' });
    listeningVerse.value = null;
  });
  pos = 0;
  holdWakeLock(false);
  updateMediaSession();
  announce(`Finished ${formatChapter(s.book, s.chapter)}.`);
}

/** Navigate the reader to another chapter and keep reading there. */
async function goToChapter(tr: string, book: string, chapter: number): Promise<void> {
  const p = passage.peek();
  // Update our session first so the navigation watcher recognises the new chapter as ours.
  const opened = openChapter(tr, book, chapter, undefined, `Now reading ${formatChapter(book, chapter)}.`);
  if (keyOf(p.tr, p.ref.book, p.ref.chapter) !== keyOf(tr, book, chapter)) navigate({ book, chapter }, tr);
  await opened;
}

async function openChapter(tr: string, book: string, chapter: number, fromVerse: number | undefined, message: string | null): Promise<void> {
  const token = ++loadToken;
  gen++;
  stopSpeech();
  items = [];
  pos = 0;
  queued = 0;
  retried = -1;
  batch(() => {
    listenState.value = { status: 'loading', tr, book, chapter, verse: fromVerse ?? null, verses: [] };
    listeningVerse.value = fromVerse ?? null;
  });
  ensureWatchers();
  updateMediaSession();
  try {
    const [text] = await Promise.all([loadText(tr, book, chapter), loadVoices(1500)]);
    if (token !== loadToken) return;
    const startAtTop = !fromVerse;
    items = buildListenItems(text, { heading: startAtTop ? spokenHeading(book, chapter) : undefined });
    if (!items.length) throw new Error('empty chapter');
    const verses = [...new Set(items.filter((it) => !it.intro).map((it) => it.verse))];
    setState({ verses });
    let start = fromVerse ? indexOfVerse(fromVerse) : 0;
    if (start < 0) start = fromVerse && verses.length && fromVerse > verses[verses.length - 1] ? indexOfVerse(verses[verses.length - 1]) : 0;
    if (listenState.peek().status === 'paused') {
      // Paused while loading: be ready at the start verse, but wait for play.
      pos = start;
      setVerse(items[start].verse);
      return;
    }
    playFrom(start);
    if (message) announce(message);
  } catch {
    if (token !== loadToken) return;
    fail(`Couldn’t load ${formatChapter(book, chapter)} to read aloud.`);
  }
}

/* ---- watchers ----------------------------------------------------------- */

function ensureWatchers(): void {
  if (stopWatchers) return;
  let lastRate = rate();
  const offNav = effect(() => {
    const p = passage.value;
    const r = route.value;
    const s = listenState.peek();
    if (s.status === 'idle') return;
    // Keep reading on the reader (and its search overlay); any other page or chapter stops it.
    const away = (r.name !== 'read' && r.name !== 'search') || keyOf(p.tr, p.ref.book, p.ref.chapter) !== stateKey(s);
    if (away) queueMicrotask(() => stopListening());
  });
  const offRate = effect(() => {
    const r = clampRate(settings.value.listenRate);
    if (r === lastRate) return;
    lastRate = r;
    if (listenState.peek().status === 'playing') playFrom(pos);
  });
  const onHide = (e: PageTransitionEvent) => {
    if (!e.persisted) stopListening();
    else pauseListening(false);
  };
  // Another speaker (the word card's pronounce button) is taking over: pause, don't skip ahead.
  const offPreempt = onPreempt(() => pauseListening(false));
  const onVisible = () => {
    if (document.visibilityState === 'visible' && listenState.peek().status === 'playing') holdWakeLock(true);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisible);
  }
  stopWatchers = () => {
    offNav();
    offRate();
    offPreempt();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

/* ---- wake lock + media session -------------------------------------------- */

type WakeLockLike = { release(): Promise<void>; released?: boolean };
let wake: WakeLockLike | null = null;
let wakeWanted = false;

function holdWakeLock(on: boolean): void {
  wakeWanted = on;
  const nav = (typeof navigator !== 'undefined' ? navigator : null) as (Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockLike> } }) | null;
  try {
    if (!on) {
      const w = wake;
      wake = null;
      w?.release().catch(() => undefined);
      return;
    }
    if ((wake && !wake.released) || !nav?.wakeLock || document.visibilityState !== 'visible') return;
    nav.wakeLock.request('screen').then(
      (w) => {
        if (wakeWanted) wake = w;
        else w.release().catch(() => undefined);
      },
      () => undefined,
    );
  } catch {
    /* unsupported */
  }
}

const MEDIA_ACTIONS: MediaSessionAction[] = ['play', 'pause', 'stop', 'previoustrack', 'nexttrack'];

function mediaSession(): MediaSession | null {
  try {
    return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;
  } catch {
    return null;
  }
}

function updateMediaSession(): void {
  const ms = mediaSession();
  if (!ms) return;
  const s = listenState.peek();
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* action not supported by this browser */
    }
  };
  try {
    if (s.status === 'idle') {
      ms.metadata = null;
      ms.playbackState = 'none';
      MEDIA_ACTIONS.forEach((a) => set(a, null));
      return;
    }
    const title = listenTitle(s);
    if (typeof MediaMetadata === 'function' && ms.metadata?.title !== title) {
      const icon = typeof document !== 'undefined' ? new URL('favicon.svg', document.baseURI).href : 'favicon.svg';
      ms.metadata = new MediaMetadata({
        title,
        artist: trName(s.tr),
        album: 'Rootword',
        artwork: [{ src: icon, sizes: 'any', type: 'image/svg+xml' }],
      });
    }
    ms.playbackState = s.status === 'playing' || s.status === 'loading' ? 'playing' : 'paused';
    set('play', () => resumeListening());
    set('pause', () => pauseListening());
    set('stop', () => stopListening());
    set('previoustrack', () => prevVerse());
    set('nexttrack', () => nextVerse());
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------------ */
/* Actions                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Read the current chapter aloud, from `fromVerse` (default: the top, with a spoken heading).
 * Call from a user gesture (iOS only allows speech that starts from one). If the chapter is
 * already being read, jumps to `fromVerse` (or resumes).
 */
export function startListening(fromVerse?: number): void {
  if (!speechSupported()) {
    showToast('Reading aloud isn’t available in this browser.');
    return;
  }
  unlockSpeech();
  if (typeof document !== 'undefined') {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== document.body && !a.closest('.listen')) returnFocus = a;
  }
  const { tr, ref } = passage.peek();
  const s = listenState.peek();
  const same = s.status !== 'idle' && stateKey(s) === keyOf(tr, ref.book, ref.chapter) && items.length > 0;
  if (same && s.status !== 'error') {
    if (fromVerse !== undefined) {
      const i = indexOfVerse(fromVerse);
      playFrom(i >= 0 ? i : pos);
    } else if (s.status === 'ended') playFrom(0);
    else if (s.status !== 'playing') playFrom(pos);
    announce('Reading aloud.');
    return;
  }
  void openChapter(tr, ref.book, ref.chapter, fromVerse, `Reading ${formatChapter(ref.book, ref.chapter)} aloud, ${trName(tr)}.`);
}

/** Stop reading aloud and close the bar. */
export function stopListening(opts: { announce?: boolean; restoreFocus?: boolean } = {}): void {
  const s = listenState.peek();
  if (s.status === 'idle') return;
  gen++;
  loadToken++;
  if (s.status === 'playing' || s.status === 'loading') stopSpeech();
  items = [];
  pos = 0;
  queued = 0;
  badVoices.clear();
  stopWatchers?.();
  stopWatchers = null;
  batch(() => {
    listenState.value = IDLE;
    listeningVerse.value = null;
  });
  holdWakeLock(false);
  updateMediaSession();
  if (opts.announce) announce('Stopped reading aloud.');
  if (opts.restoreFocus && typeof document !== 'undefined') {
    const target = returnFocus?.isConnected ? returnFocus : document.getElementById('text');
    target?.focus({ preventScroll: true });
  }
  returnFocus = null;
}

/** Pause (keeps the bar and the highlighted verse). */
export function pauseListening(say = true): void {
  const s = listenState.peek();
  if (s.status !== 'playing' && s.status !== 'loading') return;
  gen++;
  stopSpeech();
  setState({ status: 'paused' });
  holdWakeLock(false);
  updateMediaSession();
  if (say) announce('Paused.');
}

/** Resume after a pause; replay after the end; retry after an error. Call from a gesture. */
export function resumeListening(): void {
  const s = listenState.peek();
  if (s.status === 'paused') {
    unlockSpeech();
    playFrom(pos);
    announce('Reading aloud.');
  } else if (s.status === 'ended') {
    unlockSpeech();
    playFrom(0);
    announce('Reading aloud.');
  } else if (s.status === 'error') {
    unlockSpeech();
    if (items.length) playFrom(pos);
    else void openChapter(s.tr, s.book, s.chapter, s.verse ?? undefined, null);
  }
}

export function toggleListening(): void {
  const st = listenState.peek().status;
  if (st === 'playing' || st === 'loading') pauseListening();
  else resumeListening();
}

/** Skip to the start of the next verse (at the last verse: the end of the chapter). */
export function nextVerse(): void {
  const s = listenState.peek();
  if (!items.length) return;
  if (s.status === 'ended') {
    const next = nextChapter(s.book, s.chapter);
    if (next) void goToChapter(s.tr, next[0], next[1]);
    return;
  }
  let j = pos;
  const g0 = group(pos);
  while (j < items.length && group(j) === g0) j++;
  if (j >= items.length) {
    if (s.status === 'playing') {
      gen++;
      stopSpeech();
      chapterDone();
    } else {
      pos = items.length - 1;
      setVerse(items[pos].verse);
    }
    return;
  }
  if (s.status === 'playing') playFrom(j);
  else {
    pos = j;
    setVerse(items[j].verse);
  }
  announceVerse(items[j]);
}

/** Back to the start of this verse when we are past its first piece, else to the previous verse. */
export function prevVerse(): void {
  const s = listenState.peek();
  if (!items.length) return;
  const startOf = (i: number) => {
    const g0 = group(i);
    while (i > 0 && group(i - 1) === g0) i--;
    return i;
  };
  let target: number;
  if (s.status === 'ended') target = startOf(items.length - 1);
  else {
    const start = startOf(pos);
    target = pos > start ? start : start > 0 ? startOf(start - 1) : 0;
  }
  if (s.status === 'playing' || s.status === 'ended') playFrom(target);
  else {
    pos = target;
    setVerse(items[target].verse);
  }
  announceVerse(items[target]);
}

function announceVerse(it: ListenItem | undefined): void {
  if (!it) return;
  announce(it.verse === 0 ? 'Title.' : `Verse ${it.verse}.`);
}

/** Set the reading speed (persisted in settings.listenRate; applies immediately). */
export function setListenRate(r: number): void {
  const v = clampRate(r);
  if (v !== settings.peek().listenRate) updateSettings({ listenRate: v }); // the rate watcher restarts the current piece
}

/** Reset everything (tests). */
export function resetListen(): void {
  stopListening();
  gen = 0;
  loadToken = 0;
  items = [];
  badVoices.clear();
  retried = -1;
  returnFocus = null;
}
