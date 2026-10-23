/**
 * Text-to-speech (Web Speech API `speechSynthesis`) for pronunciation and Listen mode
 * (docs/EXPERIENCE.md §3).
 *
 *   speechSupported()                 // false → hide speech UI
 *   speak('λόγος', 'grc', { translit: 'logos' })   // el-GR voice, or the transliteration in English
 *   speak('בְּרֵאשִׁית', 'hbo')       // he-IL voice (pointed text, cantillation stripped)
 *   speak('In the beginning…', 'en', { rate: 1.25, queue: true })
 *   stop()
 *
 * - Voices load asynchronously in most browsers: getVoices() can be [] until `voiceschanged`.
 *   loadVoices() waits for them (with a timeout: some platforms have none and never fire).
 * - pickVoice() scores voices: language (+ region) match, then quality hints (natural / neural /
 *   premium / enhanced), local before remote at equal quality, and penalises robotic / novelty voices.
 *   Old Android ids (`iw` for Hebrew, `he_IL` with an underscore) are normalised.
 * - Greek is sent to the (modern Greek) voice in monotonic form; Hebrew keeps its vowel points but
 *   loses cantillation, meteg, paseq / sof pasuq and morpheme slashes (many engines ignore niqqud
 *   anyway). This is "modern pronunciation": label it so in the UI.
 * - One speaker at a time: speak() cancels whatever is playing unless `queue: true`.
 * - Utterances are kept referenced until they finish (Chrome can garbage-collect them mid-speech
 *   and never fire `end`), and a paused engine is resumed before speaking (a stuck pause otherwise
 *   swallows new utterances).
 *
 * Framework-free; touches `window` only when called.
 */

export type SpeechLang = 'grc' | 'hbo' | 'arc' | 'en' | string;

/** BCP 47 language for each original-language code. */
const BCP47: Record<string, string> = {
  grc: 'el-GR',
  el: 'el-GR',
  hbo: 'he-IL',
  arc: 'he-IL',
  he: 'he-IL',
  iw: 'he-IL',
  en: 'en-US',
};

/** 'grc' → 'el-GR', 'hbo' → 'he-IL', 'en' → the reader's English locale when it is English, else en-US. */
export function speechLang(lang: SpeechLang): string {
  if (lang === 'en') {
    const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
    return /^en[-_]/i.test(nav) ? nav.replace('_', '-') : 'en-US';
  }
  return BCP47[lang] ?? lang;
}

/** Lower-case, hyphenated, with legacy Hebrew "iw" mapped to "he": "he_IL" → "he-il", "iw-IL" → "he-il". */
export function normLang(lang: string): string {
  const l = (lang || '').trim().replace(/_/g, '-').toLowerCase();
  return l === 'iw' || l.startsWith('iw-') ? `he${l.slice(2)}` : l;
}

/* ------------------------------------------------------------------------ */
/* Support + voices                                                          */
/* ------------------------------------------------------------------------ */

function synth(): SpeechSynthesis | null {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    return window.speechSynthesis ?? null;
  } catch {
    return null;
  }
}

/** True when the browser has speechSynthesis + SpeechSynthesisUtterance. */
export function speechSupported(): boolean {
  return Boolean(synth()) && typeof (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === 'function';
}

let voices: SpeechSynthesisVoice[] = [];
let voicesSettled = false;
const voiceListeners = new Set<(v: SpeechSynthesisVoice[]) => void>();
let listening = false;

function readVoices(): SpeechSynthesisVoice[] {
  try {
    return synth()?.getVoices() ?? [];
  } catch {
    return [];
  }
}

function onVoices(): void {
  const v = readVoices();
  if (v.length) voicesSettled = true;
  voices = v;
  voiceListeners.forEach((cb) => cb(v));
}

function listen(): void {
  if (listening) return;
  const s = synth();
  if (!s) return;
  listening = true;
  try {
    if (typeof s.addEventListener === 'function') s.addEventListener('voiceschanged', onVoices);
    else (s as SpeechSynthesis & { onvoiceschanged: unknown }).onvoiceschanged = onVoices;
  } catch {
    /* ignore */
  }
}

/** Voices known right now (may be [] until they load). */
export function getVoices(): SpeechSynthesisVoice[] {
  listen();
  if (!voices.length) {
    voices = readVoices();
    if (voices.length) voicesSettled = true;
  }
  return voices;
}

/** True once a non-empty voice list has been seen, or loadVoices() has timed out. */
export function voicesLoaded(): boolean {
  return voicesSettled;
}

/** Subscribe to voice-list changes. Returns an unsubscribe function. */
export function onVoicesChanged(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  listen();
  voiceListeners.add(cb);
  return () => voiceListeners.delete(cb);
}

/** Resolve with the voice list once it has loaded (or [] after `timeoutMs` when there are none). */
export function loadVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!synth()) return Promise.resolve([]);
  const now = getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: SpeechSynthesisVoice[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      voicesSettled = true;
      resolve(v);
    };
    const off = onVoicesChanged((v) => v.length && finish(v));
    const timer = setTimeout(() => {
      voiceListeners.forEach((cb) => cb(readVoices()));
      finish(readVoices());
    }, timeoutMs);
  });
}

/** macOS / iOS novelty voices: never pick these for reading. */
const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|pipe organ)\b/i;

/** Quality score of `voice` for language `want` (BCP 47), or -1 when the language doesn't match. */
export function scoreVoice(voice: Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService' | 'default'>, want: string): number {
  const [wl, wr] = normLang(want).split('-');
  const [vl, vr] = normLang(voice.lang).split('-');
  if (!vl || vl !== wl) return -1;
  const name = voice.name || '';
  let s = 10;
  if (wr && vr === wr) s += 6;
  if (/natural|neural|premium|enhanced|wavenet|studio|siri/i.test(name)) s += 5;
  if (/google/i.test(name)) s += 2;
  if (/online/i.test(name)) s += 1;
  if (/espeak|compact|mbrola/i.test(name)) s -= 4;
  if (NOVELTY.test(name)) s -= 30;
  if (voice.localService) s += 1;
  if (voice.default) s += 1;
  return s;
}

/**
 * Best voice for a language: `lang` is a SpeechLang ('grc', 'hbo', 'en') or BCP 47 ('el-GR').
 * `preferredURI` (a voiceURI the reader chose) wins when it is in the list and speaks the language.
 */
export function pickVoice(list: readonly SpeechSynthesisVoice[], lang: SpeechLang, preferredURI?: string | null): SpeechSynthesisVoice | null {
  const want = lang.includes('-') ? lang : speechLang(lang);
  if (preferredURI) {
    const p = list.find((v) => v.voiceURI === preferredURI);
    if (p && scoreVoice(p, want) >= 0) return p;
  }
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const v of list) {
    const sc = scoreVoice(v, want);
    if (sc > bestScore) {
      best = v;
      bestScore = sc;
    }
  }
  return best;
}

/** Is there a voice for this language right now? */
export function hasVoiceFor(lang: SpeechLang): boolean {
  return Boolean(pickVoice(getVoices(), lang));
}

/* ------------------------------------------------------------------------ */
/* Text preparation                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Hebrew for TTS: keep consonants + vowel points (niqqud, dagesh, shin/sin dots), drop cantillation
 * (U+0591–U+05AF), meteg, paseq, sof pasuq, upper/lower dots, CGJ / joiners and morpheme slashes;
 * maqaf becomes a space.
 */
export function prepareHebrew(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[֑-ֽ֯׀׃ׅׄ׆͏‌‍‎‏]/g, '')
    .replace(/[־/]/g, (c) => (c === '/' ? '' : ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Polytonic → monotonic Greek, which modern Greek voices read reliably: breathings, iota subscript,
 * macron / breve dropped; grave and circumflex become the acute (tonos); diaeresis kept. Also
 * removes the SBLGNT's text-critical signs (⸀⸁⸂⸃⸄⸅) and brackets.
 */
export function toMonotonic(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̓̔̄̆̓ͅ]/g, '')
    .replace(/[̀͂]/g, '́')
    .replace(/́+/g, '́')
    .replace(/[᾽᾿῾῀῁῍-῏῝-῟῭-`´]/g, '')
    .replace(/[⸀-⸅[\]]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text as it should be sent to a voice for `lang`. */
export function prepareText(text: string, lang: SpeechLang): string {
  if (lang === 'grc' || /^el\b/i.test(lang)) return toMonotonic(text);
  if (lang === 'hbo' || lang === 'arc' || /^(he|iw)\b/i.test(lang)) return prepareHebrew(text);
  return text.replace(/\s+/g, ' ').trim();
}

const TRANSLIT_MAP: [RegExp, string][] = [
  [/[šŠ]/g, 'sh'],
  [/[ṣṢ]/g, 'ts'],
  [/[ḥḤ]/g, 'kh'],
  [/[ḵḴ]/g, 'kh'],
  [/[ṯṮ]/g, 't'],
  [/[ṭṬ]/g, 't'],
  [/[ḇḆ]/g, 'v'],
  [/[ḡḠ]/g, 'g'],
  [/[ḏḎ]/g, 'd'],
  [/p̄/g, 'f'],
  [/[śŚ]/g, 's'],
  [/[əᵊ]/g, 'e'],
  [/[ʾʿʼʻ'’‘`]/g, ''],
];

/**
 * A transliteration (SBL style: "rēʾšîṯ", "ʾĕlōhîm", "archē") made friendlier for an English voice:
 * special consonants spelled out (š → sh, ḥ → kh), glottal marks and diacritics removed,
 * "iy"/"î" → "ee".
 */
export function translitForSpeech(translit: string): string {
  let s = translit;
  for (const [re, to] of TRANSLIT_MAP) s = s.replace(re, to);
  s = s.replace(/[îī]y?|iy/g, 'ee').replace(/[ûū]w?|uw/g, 'oo').replace(/ôw/g, 'o');
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentence / clause pieces (with their punctuation). No look-behind: older Safari can't parse it. */
const SENTENCE = /[^.!?;:]*[.!?;:]+["'’”)\]]*\s*|[^.!?;:]+$/g;
const CLAUSE = /[^,—–]*[,—–]+\s*|[^,—–]+$/g;
const WORDS = /\S+/g;

/**
 * Split long text into pieces a voice will read in one go (Chrome's remote voices stop after
 * ~15 s): sentence / clause boundaries first, then commas and dashes, then spaces. Small
 * neighbours are merged back so the voice doesn't speak in fragments. Pieces are ≤ `max` chars
 * (except a single word longer than that).
 */
export function splitForSpeech(text: string, max = 180): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const levels = [SENTENCE, CLAUSE, WORDS];
  const out: string[] = [];
  const split = (s: string, level: number): void => {
    if (s.length <= max || level >= levels.length) {
      out.push(s);
      return;
    }
    const parts = (s.match(levels[level]) ?? [s]).map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1) {
      split(s, level + 1);
      return;
    }
    let cur = '';
    for (const p of parts) {
      if (!cur) cur = p;
      else if (cur.length + 1 + p.length <= max) cur += ` ${p}`;
      else {
        split(cur, level + 1);
        cur = p;
      }
    }
    if (cur) split(cur, level + 1);
  };
  split(clean, 0);
  return out;
}

/* ------------------------------------------------------------------------ */
/* Speaking                                                                  */
/* ------------------------------------------------------------------------ */

export interface SpeakOptions {
  /** Voice rate (0.1–10; we clamp to 0.5–2). Default 1. */
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Transliteration to read with an English voice when there is no voice for `lang`. */
  translit?: string;
  /** Use this voice (otherwise the best one for the language). */
  voice?: SpeechSynthesisVoice | null;
  /** Add to the engine's queue instead of cancelling what is playing. */
  queue?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  /** `error` is the SpeechSynthesisErrorEvent.error code ('interrupted', 'canceled', 'network'…). */
  onError?: (error: string) => void;
}

export interface SpeakHandle {
  utterance: SpeechSynthesisUtterance;
  /** 'native': spoken by a voice for the language; 'translit': the transliteration in English; 'unknown-voice': no voice found, the engine default was asked to try. */
  mode: 'native' | 'translit' | 'unknown-voice';
  voice: SpeechSynthesisVoice | null;
  /** Resolves when the utterance ends or fails. */
  done: Promise<'end' | 'error'>;
}

/** Utterances in flight (prevents Chrome from garbage-collecting them before `end`). */
const live = new Set<SpeechSynthesisUtterance>();

const preemptListeners = new Set<() => void>();
/**
 * Be told when a non-queued speak() is about to cancel whatever is playing (e.g. the pronounce
 * button interrupting Listen mode). Engines disagree on whether a cancelled utterance fires `end`
 * or `error`, so long-running speakers should pause on this instead. Returns an unsubscribe function.
 */
export function onPreempt(cb: () => void): () => void {
  preemptListeners.add(cb);
  return () => preemptListeners.delete(cb);
}

/** How speak() would read `lang` right now: by its own voice, by transliteration, or blind. */
export function speechModeFor(lang: SpeechLang, hasTranslit: boolean): SpeakHandle['mode'] {
  if (lang === 'en' || hasVoiceFor(lang)) return 'native';
  return hasTranslit && getVoices().length ? 'translit' : 'unknown-voice';
}

/**
 * Speak `text` in `lang`. Returns null when speech synthesis is unavailable (or the text is empty).
 * Never throws.
 */
export function speak(text: string, lang: SpeechLang, opts: SpeakOptions = {}): SpeakHandle | null {
  const s = synth();
  if (!s || !speechSupported()) return null;
  try {
    const list = getVoices();
    let mode: SpeakHandle['mode'] = 'native';
    let voice = opts.voice ?? pickVoice(list, lang);
    let say = prepareText(text, lang);
    let bcp = speechLang(lang);
    if (!voice && lang !== 'en' && opts.translit) {
      const en = pickVoice(list, 'en');
      if (en || list.length) {
        mode = 'translit';
        voice = en;
        say = translitForSpeech(opts.translit);
        bcp = en?.lang ?? speechLang('en');
      } else mode = 'unknown-voice';
    } else if (!voice && lang !== 'en') mode = 'unknown-voice';
    if (!say) return null;

    const u = new SpeechSynthesisUtterance(say);
    u.lang = voice?.lang ?? bcp;
    if (voice) u.voice = voice;
    u.rate = Math.min(2, Math.max(0.5, opts.rate ?? 1));
    if (opts.pitch !== undefined) u.pitch = opts.pitch;
    if (opts.volume !== undefined) u.volume = opts.volume;

    let settle: (r: 'end' | 'error') => void = () => undefined;
    const done = new Promise<'end' | 'error'>((r) => (settle = r));
    let finished = false;
    u.onstart = () => opts.onStart?.();
    u.onend = () => {
      if (finished) return;
      finished = true;
      live.delete(u);
      settle('end');
      opts.onEnd?.();
    };
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      if (finished) return;
      finished = true;
      live.delete(u);
      settle('error');
      opts.onError?.(e?.error ?? 'unknown');
    };
    live.add(u);

    if (!opts.queue && (s.speaking || s.pending)) {
      preemptListeners.forEach((cb) => {
        try {
          cb();
        } catch {
          /* a listener's problem is not ours */
        }
      });
      s.cancel();
    }
    if (s.paused) s.resume();
    s.speak(u);
    return { utterance: u, mode, voice: voice ?? null, done };
  } catch {
    return null;
  }
}

/** Stop speaking and clear the queue. */
export function stop(): void {
  try {
    synth()?.cancel();
  } catch {
    /* ignore */
  }
}

/** Something is being spoken (or queued). */
export function isSpeaking(): boolean {
  const s = synth();
  return Boolean(s && (s.speaking || s.pending));
}

let unlocked = false;
/**
 * iOS Safari only lets a page start speech from a user gesture. Call this synchronously in the
 * gesture when the real speech will start after an await (e.g. Listen mode loading a chapter):
 * it speaks a silent, empty utterance once, which unlocks later speak() calls.
 */
export function unlockSpeech(): void {
  if (unlocked) return;
  const s = synth();
  if (!s || !speechSupported()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.rate = 2;
    live.add(u);
    const drop = () => live.delete(u);
    u.onend = drop;
    u.onerror = drop;
    s.speak(u);
    unlocked = true;
  } catch {
    /* ignore */
  }
}

/** Reset module state (tests only). */
export function resetSpeech(): void {
  voices = [];
  voicesSettled = false;
  voiceListeners.clear();
  listening = false;
  unlocked = false;
  live.clear();
  preemptListeners.clear();
}
