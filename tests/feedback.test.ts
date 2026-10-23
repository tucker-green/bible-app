import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, settings } from '../src/app/state';
import {
  feedback,
  hapticsSupport,
  playTestSound,
  primeFeedback,
  resetFeedback,
  testHaptic,
  TICK_INTERVAL_MS,
  VIBRATION,
  volumeToGain,
} from '../src/lib/feedback';

/* ---- Web Audio double ---------------------------------------------------- */

class FakeParam {
  value = 0;
  calls: string[] = [];
  setValueAtTime(v: number) {
    this.calls.push(`set:${v}`);
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.calls.push(`lin:${v}`);
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.calls.push(`exp:${v}`);
    return this;
  }
  setValueCurveAtTime() {
    this.calls.push('curve');
    return this;
  }
}
class FakeNode {
  connected: unknown[] = [];
  connect(n: unknown) {
    this.connected.push(n);
    return n;
  }
  disconnect() {}
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  start = vi.fn();
  stop = vi.fn();
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  start = vi.fn();
}
class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  sampleRate = 8000;
  currentTime = 0;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  oscillators: FakeOsc[] = [];
  sources: FakeSource[] = [];
  filters: FakeFilter[] = [];
  resumes = 0;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    const o = new FakeOsc();
    this.oscillators.push(o);
    return o;
  }
  createBiquadFilter() {
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(_ch: number, len: number) {
    const data = new Float32Array(len);
    return { getChannelData: () => data };
  }
  resume() {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

/* ---- environment helpers ------------------------------------------------- */

let clock = 0;
const flush = () => new Promise((r) => setTimeout(r, 0));

function setNav(name: string, value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}
function clearNav(name: string) {
  delete (navigator as unknown as Record<string, unknown>)[name];
}

function useSettings(patch: Partial<typeof DEFAULT_SETTINGS>) {
  settings.value = { ...DEFAULT_SETTINGS, ...patch };
}

beforeEach(() => {
  resetFeedback();
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  FakeAudioContext.instances = [];
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  useSettings({});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearNav('vibrate');
  clearNav('userActivation');
  clearNav('maxTouchPoints');
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  delete (HTMLInputElement.prototype as unknown as { switch?: unknown }).switch;
  resetFeedback();
});

/* ---- tests --------------------------------------------------------------- */

describe('feedback(): haptics via the Vibration API', () => {
  it('vibrates with the pattern for each kind', () => {
    const vibrate = vi.fn(() => true);
    setNav('vibrate', vibrate);
    const kinds = ['tick', 'select', 'engage', 'pin', 'success', 'error', 'page'] as const;
    for (const k of kinds) {
      clock += 100;
      feedback(k);
    }
    expect(vibrate.mock.calls.map((c) => (c as unknown[])[0])).toEqual([7, 10, 15, 12, [10, 40, 10], [30, 60, 30], 8]);
    expect(VIBRATION.success).toEqual([10, 40, 10]);
    expect(hapticsSupport()).toBe('vibrate');
  });

  it('does nothing when haptics are switched off', () => {
    const vibrate = vi.fn(() => true);
    setNav('vibrate', vibrate);
    useSettings({ haptics: false });
    feedback('select');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('throttles scrub ticks to one per 40 ms', () => {
    const vibrate = vi.fn(() => true);
    setNav('vibrate', vibrate);
    feedback('tick'); // t=1000
    clock += 10;
    feedback('tick'); // dropped
    clock += TICK_INTERVAL_MS - 11;
    feedback('tick'); // 39 ms after the first: dropped
    clock += 2;
    feedback('tick'); // 41 ms: plays
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('merges an identical event fired twice at once (e.g. pointerup + click)', () => {
    const vibrate = vi.fn(() => true);
    setNav('vibrate', vibrate);
    feedback('select');
    clock += 5;
    feedback('select');
    clock += 5;
    feedback('pin'); // a different kind still fires
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('waits for the first user gesture (no Chrome intervention warnings)', () => {
    const vibrate = vi.fn(() => true);
    setNav('vibrate', vibrate);
    setNav('userActivation', { hasBeenActive: false, isActive: false });
    feedback('select');
    expect(vibrate).not.toHaveBeenCalled();
    setNav('userActivation', { hasBeenActive: true, isActive: true });
    clock += 100;
    feedback('select');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when vibrate() does', () => {
    setNav(
      'vibrate',
      vi.fn(() => {
        throw new Error('blocked');
      }),
    );
    expect(() => feedback('error')).not.toThrow();
    expect(() => testHaptic()).not.toThrow();
    expect(testHaptic()).toBe(false);
  });

  it('is silent while the page is hidden', () => {
    const vibrate = vi.fn(() => true);
    setNav('vibrate', vibrate);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    feedback('select');
    expect(vibrate).not.toHaveBeenCalled();
    vis.mockRestore();
  });

  it('ignores unknown kinds', () => {
    const vibrate = vi.fn(() => true);
    setNav('vibrate', vibrate);
    feedback('nope' as never);
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('feedback(): iOS switch haptic', () => {
  function enableSwitch() {
    Object.defineProperty(HTMLInputElement.prototype, 'switch', { get: () => false, set: () => undefined, configurable: true });
    setNav('maxTouchPoints', 5);
  }

  it('toggles a hidden <input switch> through its label', () => {
    enableSwitch();
    expect(hapticsSupport()).toBe('ios-switch');
    const docClicks = vi.fn();
    document.addEventListener('click', docClicks);
    feedback('select');
    const label = document.querySelector<HTMLLabelElement>('label[data-feedback-switch]');
    expect(label).toBeTruthy();
    expect(label!.getAttribute('aria-hidden')).toBe('true');
    expect(label!.style.display).toBe('none');
    const input = label!.querySelector('input')!;
    expect(input.type).toBe('checkbox');
    expect(input.hasAttribute('switch')).toBe(true);
    expect(input.checked).toBe(true); // label.click() toggled it
    expect(docClicks).not.toHaveBeenCalled(); // the synthetic click never reaches app handlers
    document.removeEventListener('click', docClicks);
  });

  it('plays several spaced taps for multi-pulse kinds', () => {
    enableSwitch();
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLLabelElement.prototype, 'click');
    feedback('error');
    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(click).toHaveBeenCalledTimes(3);
  });

  it('reuses one switch element', () => {
    enableSwitch();
    feedback('select');
    clock += 100;
    feedback('pin');
    expect(document.querySelectorAll('[data-feedback-switch]').length).toBe(1);
  });

  it('primeFeedback() inserts the switch ahead of the first gesture', () => {
    enableSwitch();
    primeFeedback();
    expect(document.querySelector('[data-feedback-switch]')).toBeTruthy();
  });

  it('needs a touch screen (Mac Safari has the switch but no haptics for it)', () => {
    Object.defineProperty(HTMLInputElement.prototype, 'switch', { get: () => false, configurable: true });
    setNav('maxTouchPoints', 0);
    expect(hapticsSupport()).toBe('none');
    expect(testHaptic()).toBe(false);
  });
});

describe('feedback(): sound', () => {
  it('creates no AudioContext while sound effects are off (the default)', () => {
    expect(DEFAULT_SETTINGS.sound).toBe(false);
    primeFeedback();
    feedback('pin');
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('lazily creates one context, resumes it and synthesizes the sound', async () => {
    useSettings({ sound: true, soundVolume: 0.5, haptics: false });
    feedback('pin');
    expect(FakeAudioContext.instances).toHaveLength(1);
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.resumes).toBe(1);
    await flush();
    expect(ctx.state).toBe('running');
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(2);
    expect(ctx.oscillators.every((o) => o.start.mock.calls.length === 1 && o.stop.mock.calls.length === 1)).toBe(true);
    // master gain follows the volume setting
    expect(ctx.gains[0].gain.value).toBeCloseTo(volumeToGain(0.5));
    clock += 100;
    feedback('page');
    await flush();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(ctx.sources.some((s) => s.start.mock.calls.length > 0)).toBe(true); // noise burst
  });

  it('every kind produces sound without throwing', async () => {
    useSettings({ sound: true, haptics: false });
    for (const k of Object.keys(VIBRATION) as (keyof typeof VIBRATION)[]) {
      clock += 100;
      expect(() => feedback(k)).not.toThrow();
    }
    await flush();
    expect(FakeAudioContext.instances[0].oscillators.length).toBeGreaterThan(10);
  });

  it('primeFeedback() unlocks audio from the first gesture when sound is on', () => {
    useSettings({ sound: true });
    primeFeedback();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].resumes).toBe(1);
  });

  it('suspends the context after a few idle seconds', async () => {
    vi.useFakeTimers();
    useSettings({ sound: true, haptics: false });
    feedback('select');
    await vi.advanceTimersByTimeAsync(1);
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.state).toBe('running');
    await vi.advanceTimersByTimeAsync(9000);
    expect(ctx.state).toBe('suspended');
  });

  it('is a no-op without Web Audio', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    useSettings({ sound: true });
    expect(() => feedback('pin')).not.toThrow();
    expect(playTestSound()).toBe(false);
  });
});

describe('"Try it" helpers for the settings sheet', () => {
  it('playTestSound() plays even while sound effects are off', async () => {
    useSettings({ sound: false, soundVolume: 0.8 });
    expect(playTestSound()).toBe(true);
    await flush();
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    expect(ctx.gains[0].gain.value).toBeCloseTo(volumeToGain(0.8));
  });

  it('testHaptic() buzzes even while haptics are off', () => {
    const vibrate = vi.fn(() => true);
    setNav('vibrate', vibrate);
    useSettings({ haptics: false });
    expect(testHaptic()).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([10, 40, 10]);
  });
});

describe('volumeToGain', () => {
  it('maps 0–1 onto a gentle curve and clamps', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeGreaterThan(0.25);
    expect(volumeToGain(0.5)).toBeLessThan(0.5);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBeGreaterThan(0);
  });
});
