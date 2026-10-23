/**
 * Haptic + audible feedback, fanned out according to the user's settings (docs/EXPERIENCE.md §3).
 *
 *   feedback('tick')      // word changed while scrubbing (throttled to ≤ 1 per 40 ms)
 *   feedback('select')    // a word / item became selected
 *   feedback('engage')    // press-and-slide scrubbing engaged (long-press)
 *   feedback('pin')       // a card / sheet was pinned open
 *   feedback('success')   // copy / bookmark / save succeeded
 *   feedback('error')     // something failed
 *   feedback('page')      // chapter changed
 *
 * Haptics (settings.haptics, default on):
 *  - `navigator.vibrate` with very short patterns where the Vibration API exists (Android browsers).
 *    Chrome ignores (and logs a console intervention for) vibrate() before the first user gesture, so
 *    we skip it until `navigator.userActivation.hasBeenActive`.
 *  - iOS Safari has no Vibration API. Since Safari 17.4 / iOS 18, toggling an
 *    `<input type="checkbox" switch>` plays the system selection haptic, and calling `.click()` on
 *    its `<label>` inside a user gesture toggles it. We keep one hidden label+switch in the document
 *    and click it (several times, spaced, for multi-pulse patterns). Feature-detected via the
 *    `switch` IDL attribute (WebKit only) plus a touch screen. NOTE: iOS 26.5 reportedly stopped
 *    honouring *programmatic* label clicks (only a finger on a real switch still buzzes) — on those
 *    versions this path is a silent no-op. It never throws and never steals focus or clicks
 *    (the label's click is stopped from bubbling and the elements are display:none / aria-hidden).
 *
 * Sound (settings.sound, default off; settings.soundVolume 0–1): tiny sounds synthesized with
 * Web Audio — no audio files. The AudioContext is created lazily (only once sound is wanted) inside
 * a user gesture (primeFeedback() or the first feedback() call), resumed when needed and suspended
 * again after a few idle seconds so it does not keep the audio hardware awake.
 *
 * Everything is exception-safe: feedback() is a no-op when disabled, unsupported, or the page is hidden.
 */
import { settings } from '../app/state';

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

/** Vibration API patterns (ms; arrays alternate vibrate / pause). */
export const VIBRATION: Readonly<Record<FeedbackKind, number | readonly number[]>> = {
  tick: 7,
  select: 10,
  engage: 15,
  pin: 12,
  success: [10, 40, 10],
  error: [30, 60, 30],
  page: 8,
};

/** iOS switch fallback: how many system "selection" taps per kind (the haptic itself is fixed). */
const IOS_PULSES: Readonly<Record<FeedbackKind, number>> = {
  tick: 1,
  select: 1,
  engage: 1,
  pin: 1,
  success: 2,
  error: 3,
  page: 1,
};
/** Gap between iOS pulses (the Taptic Engine merges taps closer than ~80 ms). */
const IOS_PULSE_GAP = 110;

/** Minimum interval between scrub ticks (EXPERIENCE §3: ≤ 1 per 40 ms). */
export const TICK_INTERVAL_MS = 40;
/** Identical non-tick feedback within this window is merged (e.g. pointerup + click double fire). */
const DEDUPE_MS = 30;
/** Suspend the AudioContext after this long without a sound. */
const AUDIO_IDLE_MS = 8000;

/* ------------------------------------------------------------------------ */
/* Environment helpers                                                       */
/* ------------------------------------------------------------------------ */

type Win = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function win(): Win | null {
  return typeof window === 'undefined' ? null : (window as Win);
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Has the page had a user gesture yet? (true when the browser can't tell us). */
function hasBeenActive(): boolean {
  const ua = (typeof navigator !== 'undefined' ? navigator : null) as (Navigator & { userActivation?: { hasBeenActive: boolean } }) | null;
  return ua?.userActivation ? ua.userActivation.hasBeenActive : true;
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

let iosSwitchSupport: boolean | null = null;
/** WebKit's `<input switch>` (Safari 17.4+) on a touch screen, and no Vibration API. */
function canSwitchHaptic(): boolean {
  if (iosSwitchSupport !== null) return iosSwitchSupport;
  iosSwitchSupport = false;
  try {
    const w = win();
    if (!w || typeof document === 'undefined' || canVibrate()) return false;
    const probe = document.createElement('input');
    const touch = (navigator.maxTouchPoints ?? 0) > 0 || (typeof w.matchMedia === 'function' && w.matchMedia('(pointer: coarse)').matches);
    iosSwitchSupport = 'switch' in probe && touch;
  } catch {
    iosSwitchSupport = false;
  }
  return iosSwitchSupport;
}

/** Which haptic mechanism this device offers ('none' on desktops and most non-touch browsers). */
export function hapticsSupport(): 'vibrate' | 'ios-switch' | 'none' {
  if (canVibrate()) return 'vibrate';
  return canSwitchHaptic() ? 'ios-switch' : 'none';
}

/** Web Audio is available (sound effects can be offered in Settings). */
export function soundSupported(): boolean {
  const w = win();
  return Boolean(w && (w.AudioContext || w.webkitAudioContext));
}

/* ------------------------------------------------------------------------ */
/* Haptics                                                                   */
/* ------------------------------------------------------------------------ */

let switchLabel: HTMLLabelElement | null = null;
let switchTimers: ReturnType<typeof setTimeout>[] = [];

function ensureSwitch(): HTMLLabelElement | null {
  if (switchLabel?.isConnected) return switchLabel;
  if (typeof document === 'undefined' || !document.body) return null;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.setAttribute('data-feedback-switch', '');
  // Never let the synthetic click reach app-level handlers (outside-click closers etc.).
  label.setAttribute('data-keep-word', '');
  label.setAttribute('data-search-keep', '');
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  label.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(label);
  switchLabel = label;
  return label;
}

function switchTap(): void {
  try {
    ensureSwitch()?.click();
  } catch {
    /* never throw from feedback */
  }
}

function hapticFor(kind: FeedbackKind): boolean {
  try {
    if (canVibrate()) {
      if (!hasBeenActive()) return false;
      const p = VIBRATION[kind];
      return navigator.vibrate(typeof p === 'number' ? p : [...p]);
    }
    if (canSwitchHaptic()) {
      switchTap(); // synchronously, while we are (probably) still inside the user gesture
      for (let i = 1; i < IOS_PULSES[kind]; i++) switchTimers.push(setTimeout(switchTap, i * IOS_PULSE_GAP));
      if (switchTimers.length > 8) switchTimers = switchTimers.slice(-8);
      return true;
    }
  } catch {
    /* blocked or unsupported */
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* Sound (Web Audio synthesis)                                               */
/* ------------------------------------------------------------------------ */

interface Audio {
  ctx: AudioContext;
  out: GainNode;
  noise: AudioBuffer;
}

let audio: Audio | null = null;
let audioFailed = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function getAudio(create: boolean): Audio | null {
  if (audio) return audio;
  if (!create || audioFailed) return null;
  const w = win();
  const AC = w?.AudioContext ?? w?.webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC({ latencyHint: 'interactive' });
    const out = ctx.createGain();
    out.connect(ctx.destination);
    // One second of white noise, shared by every noisy sound.
    const len = Math.max(1, Math.floor(ctx.sampleRate));
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 0x2f6b_1a3d;
    for (let i = 0; i < len; i++) {
      // xorshift: deterministic, cheap
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    }
    audio = { ctx, out, noise };
    // iOS unlock: play a silent buffer inside the creating gesture.
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    return audio;
  } catch {
    audioFailed = true;
    return null;
  }
}

/** settings.soundVolume (0–1) → output gain, on a gentle curve so low settings stay audible. */
export function volumeToGain(v: number): number {
  const x = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.6));
  return Math.pow(x, 1.6);
}

function scheduleIdle(a: Audio): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (a.ctx.state === 'running') a.ctx.suspend().catch(() => undefined);
  }, AUDIO_IDLE_MS);
}

/** An exponential-decay envelope on a fresh gain node: attack to `peak`, decay to silence. */
function env(a: Audio, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(a.out);
  return g;
}

function tone(a: Audio, t: number, type: OscillatorType, freq: number, peak: number, attack: number, decay: number, endFreq?: number): void {
  const o = a.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay);
  o.connect(env(a, t, peak, attack, decay));
  o.start(t);
  o.stop(t + attack + decay + 0.02);
}

function noiseBurst(
  a: Audio,
  t: number,
  dur: number,
  filter: { type: BiquadFilterType; freq: number; endFreq?: number; q?: number },
  gain: GainNode | ((g: GainNode) => void),
): void {
  const src = a.ctx.createBufferSource();
  src.buffer = a.noise;
  const f = a.ctx.createBiquadFilter();
  f.type = filter.type;
  f.frequency.setValueAtTime(filter.freq, t);
  if (filter.endFreq) f.frequency.exponentialRampToValueAtTime(filter.endFreq, t + dur);
  f.Q.value = filter.q ?? 1;
  src.connect(f);
  if (typeof gain === 'function') {
    const g = a.ctx.createGain();
    gain(g);
    g.connect(a.out);
    f.connect(g);
  } else f.connect(gain);
  // Start at a random offset so repeated bursts don't sound identical.
  src.start(t, Math.random() * 0.5, dur + 0.02);
}

/** The sound for each kind. Levels are pre-mixed for a quiet, "paper and wood" palette. */
const SOUNDS: Record<FeedbackKind, (a: Audio, t: number) => void> = {
  // Soft wood tick: a short, slightly hollow knock.
  tick: (a, t) => {
    tone(a, t, 'triangle', 1250, 0.11, 0.002, 0.032, 1150);
    tone(a, t, 'sine', 2900, 0.035, 0.001, 0.016);
    noiseBurst(a, t, 0.008, { type: 'bandpass', freq: 3200, q: 2.5 }, env(a, t, 0.05, 0.001, 0.007));
  },
  select: (a, t) => {
    tone(a, t, 'triangle', 1040, 0.13, 0.002, 0.045, 960);
    tone(a, t, 'sine', 2480, 0.035, 0.001, 0.02);
    noiseBurst(a, t, 0.01, { type: 'bandpass', freq: 2800, q: 2 }, env(a, t, 0.05, 0.001, 0.009));
  },
  // Engage: a lower, rounder "tock".
  engage: (a, t) => {
    tone(a, t, 'sine', 720, 0.2, 0.003, 0.07, 600);
    tone(a, t, 'triangle', 1620, 0.04, 0.002, 0.03);
  },
  // Gentle chime: a soft bell (fundamental + two quiet inharmonic partials).
  pin: (a, t) => {
    tone(a, t, 'sine', 880, 0.11, 0.004, 0.55);
    tone(a, t, 'sine', 2430, 0.025, 0.003, 0.28);
    tone(a, t, 'sine', 1320, 0.03, 0.004, 0.35);
  },
  // Success: two rising chime notes.
  success: (a, t) => {
    tone(a, t, 'sine', 880, 0.1, 0.004, 0.35);
    tone(a, t, 'sine', 2430, 0.02, 0.003, 0.18);
    tone(a, t + 0.09, 'sine', 1318.5, 0.1, 0.004, 0.5);
    tone(a, t + 0.09, 'sine', 3640, 0.015, 0.003, 0.2);
  },
  // Error: a low, muffled thud with a falling pitch.
  error: (a, t) => {
    tone(a, t, 'sine', 160, 0.42, 0.004, 0.2, 70);
    tone(a, t, 'triangle', 320, 0.06, 0.003, 0.08, 180);
    noiseBurst(a, t, 0.05, { type: 'lowpass', freq: 500, q: 0.7 }, env(a, t, 0.12, 0.002, 0.045));
  },
  // Page turn: a band of noise sweeping up, with a rough (papery) envelope and a soft landing flap.
  page: (a, t) => {
    const dur = 0.26;
    noiseBurst(a, t, dur, { type: 'bandpass', freq: 900, endFreq: 4200, q: 0.8 }, (g) => {
      const n = 48;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1);
        const shape = Math.sin(Math.PI * Math.pow(x, 0.7)); // swell, then fall
        curve[i] = Math.max(0.0001, 0.16 * shape * (0.65 + 0.35 * Math.random()));
      }
      curve[n - 1] = 0.0001;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setValueCurveAtTime(curve, t, dur);
    });
    noiseBurst(a, t + dur - 0.03, 0.04, { type: 'lowpass', freq: 1400, q: 0.7 }, env(a, t + dur - 0.03, 0.08, 0.003, 0.035));
  },
};

function soundFor(kind: FeedbackKind, volume: number): boolean {
  try {
    const a = getAudio(true);
    if (!a) return false;
    a.out.gain.value = volumeToGain(volume);
    const play = () => {
      try {
        SOUNDS[kind](a, a.ctx.currentTime + 0.004);
      } catch {
        /* ignore */
      }
      scheduleIdle(a);
    };
    if (a.ctx.state !== 'running') {
      a.ctx.resume().then(play, () => undefined);
    } else play();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

let lastTick = -Infinity;
let lastKind: FeedbackKind | null = null;
let lastAt = -Infinity;

/** Fire feedback for an interaction. Safe to call anywhere; a no-op when disabled or unsupported. */
export function feedback(kind: FeedbackKind): void {
  try {
    if (!(kind in VIBRATION) || pageHidden()) return;
    const t = now();
    if (kind === 'tick') {
      if (t - lastTick < TICK_INTERVAL_MS) return;
      lastTick = t;
    } else if (kind === lastKind && t - lastAt < DEDUPE_MS) return;
    lastKind = kind;
    lastAt = t;
    const s = settings.peek();
    if (s.haptics) hapticFor(kind);
    if (s.sound) soundFor(kind, s.soundVolume);
  } catch {
    /* never throw from feedback */
  }
}

/**
 * Must be called from a user gesture once, so audio/haptics can initialise (e.g. the first
 * pointerdown / keydown). Creates + resumes the AudioContext only when sound effects are on, and
 * inserts the hidden iOS switch ahead of time. Idempotent and cheap to call on every gesture.
 */
export function primeFeedback(): void {
  try {
    const s = settings.peek();
    if (s.haptics && canSwitchHaptic()) ensureSwitch();
    if (s.sound) {
      const a = getAudio(true);
      if (a && a.ctx.state !== 'running') a.ctx.resume().catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Settings sheet "Try it" for sound effects: plays `kind` (default the pin chime) at the current
 * volume even while sound effects are switched off. Call from the button's click handler.
 * Returns false when Web Audio is unavailable.
 */
export function playTestSound(kind: FeedbackKind = 'pin', volume: number = settings.peek().soundVolume): boolean {
  return soundFor(kind, volume);
}

/**
 * Settings sheet "Try it" for haptics: fires `kind` (default the success double-tap) even while
 * haptics are switched off. Call from the button's click handler. Returns false when this device
 * has no haptics we can drive (desktop browsers, iOS < 18, iOS 26.5+ for programmatic taps).
 */
export function testHaptic(kind: FeedbackKind = 'success'): boolean {
  return hapticFor(kind);
}

/** Tear down audio + the hidden switch and reset throttles (tests; never needed in the app). */
export function resetFeedback(): void {
  clearTimeout(idleTimer);
  switchTimers.forEach(clearTimeout);
  switchTimers = [];
  try {
    audio?.ctx.close().catch(() => undefined);
  } catch {
    /* ignore */
  }
  audio = null;
  audioFailed = false;
  switchLabel?.remove();
  switchLabel = null;
  iosSwitchSupport = null;
  lastTick = -Infinity;
  lastKind = null;
  lastAt = -Infinity;
}
