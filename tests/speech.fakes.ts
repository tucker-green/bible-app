/**
 * Test doubles for the Web Speech API (jsdom has none), shared by tests/speech*.test.ts and
 * tests/ui/listen*.test.tsx. The fake engine is fully manual: finish() / fail() end the utterance
 * being spoken and start the next one, like a real queue.
 */

type Handler = ((e: { error?: string }) => void) | null;

export class FakeUtterance {
  text: string;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: Handler = null;
  onend: Handler = null;
  onerror: Handler = null;
  onboundary: Handler = null;
  constructor(text = '') {
    this.text = text;
  }
}

export function fakeVoice(name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice {
  return { name, lang, voiceURI: extra.voiceURI ?? name, localService: true, default: false, ...extra } as SpeechSynthesisVoice;
}

export class FakeSynth extends EventTarget {
  voices: SpeechSynthesisVoice[] = [];
  queue: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  /** Every utterance ever passed to speak(), in order. */
  spoken: FakeUtterance[] = [];
  paused = false;
  cancels = 0;
  /** How a cancelled utterance reports: 'error' (spec, Chrome) or 'end' (some engines). */
  cancelReports: 'error' | 'end' = 'error';

  get speaking(): boolean {
    return Boolean(this.current);
  }
  get pending(): boolean {
    return this.queue.length > 0;
  }
  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }
  speak(u: FakeUtterance): void {
    this.spoken.push(u);
    this.queue.push(u);
    if (!this.current) this.startNext();
  }
  cancel(): void {
    this.cancels++;
    const cur = this.current;
    const rest = this.queue;
    this.current = null;
    this.queue = [];
    if (cur) {
      if (this.cancelReports === 'end') cur.onend?.({});
      else cur.onerror?.({ error: 'interrupted' });
    }
    rest.forEach((u) => (this.cancelReports === 'end' ? u.onend?.({}) : u.onerror?.({ error: 'canceled' })));
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  /** The utterance being spoken ends normally; the next one in the queue starts. */
  finish(): void {
    const u = this.current;
    this.current = null;
    u?.onend?.({});
    if (!this.current) this.startNext();
  }
  /** The utterance being spoken fails with `error`. */
  fail(error: string): void {
    const u = this.current;
    this.current = null;
    u?.onerror?.({ error });
    if (!this.current) this.startNext();
  }
  setVoices(v: SpeechSynthesisVoice[]): void {
    this.voices = v;
    this.dispatchEvent(new Event('voiceschanged'));
  }
  private startNext(): void {
    this.current = this.queue.shift() ?? null;
    this.current?.onstart?.({});
  }
}

const g = globalThis as unknown as { SpeechSynthesisUtterance?: unknown; speechSynthesis?: unknown };

export function installSpeech(synth = new FakeSynth()): FakeSynth {
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
  g.SpeechSynthesisUtterance = FakeUtterance;
  return synth;
}

export function uninstallSpeech(): void {
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  delete g.SpeechSynthesisUtterance;
}

/** A Media Session double (jsdom has none). */
export class FakeMediaSession {
  metadata: { title: string; artist?: string; album?: string } | null = null;
  playbackState: MediaSessionPlaybackState = 'none';
  handlers = new Map<string, (() => void) | null>();
  setActionHandler(action: string, fn: (() => void) | null): void {
    this.handlers.set(action, fn);
  }
}

export class FakeMediaMetadata {
  title: string;
  artist?: string;
  album?: string;
  constructor(init: { title: string; artist?: string; album?: string }) {
    this.title = init.title;
    this.artist = init.artist;
    this.album = init.album;
  }
}

export function installMediaSession(): FakeMediaSession {
  const ms = new FakeMediaSession();
  Object.defineProperty(navigator, 'mediaSession', { value: ms, configurable: true });
  (globalThis as unknown as { MediaMetadata: unknown }).MediaMetadata = FakeMediaMetadata;
  return ms;
}

export function uninstallMediaSession(): void {
  delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
  delete (globalThis as unknown as { MediaMetadata?: unknown }).MediaMetadata;
}
