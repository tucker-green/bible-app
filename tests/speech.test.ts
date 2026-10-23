import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getVoices,
  hasVoiceFor,
  isSpeaking,
  loadVoices,
  normLang,
  onPreempt,
  onVoicesChanged,
  pickVoice,
  prepareHebrew,
  prepareText,
  resetSpeech,
  scoreVoice,
  speak,
  speechLang,
  speechModeFor,
  speechSupported,
  splitForSpeech,
  stop,
  toMonotonic,
  translitForSpeech,
  unlockSpeech,
} from '../src/lib/speech';
import { fakeVoice, FakeSynth, installSpeech, uninstallSpeech } from './speech.fakes';

let synth: FakeSynth;

beforeEach(() => {
  resetSpeech();
  synth = installSpeech();
});

afterEach(() => {
  uninstallSpeech();
  resetSpeech();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('support', () => {
  it('detects speechSynthesis + SpeechSynthesisUtterance', () => {
    expect(speechSupported()).toBe(true);
    uninstallSpeech();
    expect(speechSupported()).toBe(false);
    expect(speak('λόγος', 'grc')).toBeNull();
    expect(() => stop()).not.toThrow();
    expect(isSpeaking()).toBe(false);
  });
});

describe('languages and voices', () => {
  it('maps original-language codes to BCP 47', () => {
    expect(speechLang('grc')).toBe('el-GR');
    expect(speechLang('hbo')).toBe('he-IL');
    expect(speechLang('arc')).toBe('he-IL');
    expect(speechLang('en')).toMatch(/^en-/);
  });

  it('normalises legacy and underscore language tags', () => {
    expect(normLang('he_IL')).toBe('he-il');
    expect(normLang('iw-IL')).toBe('he-il');
    expect(normLang('iw')).toBe('he');
    expect(normLang('el-GR')).toBe('el-gr');
  });

  it('picks the best voice for a language', () => {
    const list = [
      fakeVoice('Samantha', 'en-US'),
      fakeVoice('eSpeak Greek', 'el'),
      fakeVoice('Melina', 'el-GR'),
      fakeVoice('Carmit', 'he_IL'),
      fakeVoice('Zarvox', 'en-US'),
    ];
    expect(pickVoice(list, 'grc')?.name).toBe('Melina'); // exact region beats a robotic language-only voice
    expect(pickVoice(list, 'hbo')?.name).toBe('Carmit'); // he_IL understood
    expect(pickVoice([fakeVoice('Old Android', 'iw-IL')], 'hbo')?.name).toBe('Old Android');
    expect(pickVoice(list, 'en-US')?.name).toBe('Samantha'); // never a novelty voice
    expect(pickVoice([fakeVoice('Samantha', 'en-US')], 'grc')).toBeNull();
  });

  it('prefers natural / premium voices and honours a chosen voice', () => {
    const list = [
      fakeVoice('Microsoft David', 'en-US'),
      fakeVoice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', { localService: false }),
      fakeVoice('Daniel', 'en-GB'),
    ];
    expect(pickVoice(list, 'en-US')?.name).toContain('Aria');
    expect(pickVoice(list, 'en-US', 'Daniel')?.name).toBe('Daniel'); // the reader's choice wins
    expect(pickVoice(list, 'en-US', 'Missing voice')?.name).toContain('Aria');
    expect(scoreVoice(fakeVoice('x', 'fr-FR'), 'en-US')).toBe(-1);
  });

  it('loads voices asynchronously (voiceschanged)', async () => {
    expect(getVoices()).toEqual([]);
    const seen = vi.fn();
    const off = onVoicesChanged(seen);
    const p = loadVoices(5000);
    synth.setVoices([fakeVoice('Melina', 'el-GR')]);
    const v = await p;
    expect(v.map((x) => x.name)).toEqual(['Melina']);
    expect(seen).toHaveBeenCalled();
    expect(hasVoiceFor('grc')).toBe(true);
    off();
  });

  it('gives up waiting for voices after the timeout (platforms with none)', async () => {
    vi.useFakeTimers();
    const p = loadVoices(1000);
    vi.advanceTimersByTime(1001);
    await expect(p).resolves.toEqual([]);
  });
});

describe('text preparation', () => {
  it('strips Hebrew cantillation but keeps the vowel points', () => {
    // בְּרֵאשִׁ֖ית with tipcha (U+0596), meteg, and a maqaf-joined pair
    const pointed = 'בְּרֵאשִׁ֖ית';
    const out = prepareHebrew(pointed);
    expect(out).not.toMatch(/[֑-֯]/);
    expect(out).toContain('ְ'); // sheva kept
    expect(out).toContain('ִ'); // hiriq kept
    expect(out).toContain('ׁ'); // shin dot kept
    expect(prepareHebrew('כָּל־הָאָרֶץ')).toBe('כָּל הָאָרֶץ');
    expect(prepareHebrew('בְּ/רֵאשִׁית')).toBe('בְּרֵאשִׁית');
    expect(prepareHebrew('אֱלֹהִיםֽ׃')).toBe('אֱלֹהִים');
  });

  it('turns polytonic Greek into monotonic for modern voices', () => {
    expect(toMonotonic('ἀρχῇ')).toBe('αρχή');
    expect(toMonotonic('λόγος')).toBe('λόγος');
    expect(toMonotonic('ὁ')).toBe('ο');
    expect(toMonotonic('καὶ')).toBe('καί');
    expect(toMonotonic('Ἰησοῦς')).toBe('Ιησούς');
    expect(toMonotonic('⸀αὐτοῦ')).toBe('αυτού');
    expect(prepareText('ἐν ἀρχῇ', 'grc')).toBe('εν αρχή');
  });

  it('makes transliterations pronounceable in English', () => {
    expect(translitForSpeech('rēʾšiyṯ')).toBe('resheet');
    expect(translitForSpeech('ʾĕlōhiym')).toBe('eloheem');
    expect(translitForSpeech('ḥesed')).toBe('khesed');
    expect(translitForSpeech('archē')).toBe('arche');
    expect(translitForSpeech('logos')).toBe('logos');
  });

  it('splits long text at sentence, then clause, then word boundaries', () => {
    expect(splitForSpeech('')).toEqual([]);
    expect(splitForSpeech('  In the beginning   was the Word. ')).toEqual(['In the beginning was the Word.']);
    const long =
      'Then were the king’s scribes called at that time in the third month, that is, the month Sivan, on the three and twentieth day thereof; and it was written according to all that Mordecai commanded unto the Jews, and to the lieutenants, and the deputies and rulers of the provinces which are from India unto Ethiopia, an hundred twenty and seven provinces.';
    const parts = splitForSpeech(long, 120);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= 120)).toBe(true);
    expect(parts.join(' ')).toBe(long);
    expect(parts.every((p) => /[,;.]$/.test(p))).toBe(true); // only ever broke at punctuation
    expect(splitForSpeech(long)[0].endsWith('thereof;')).toBe(true); // sentence / clause boundary first
    const words = splitForSpeech('a'.repeat(10) + ' ' + 'b'.repeat(10), 12);
    expect(words).toEqual(['a'.repeat(10), 'b'.repeat(10)]);
  });
});

describe('speak()', () => {
  it('speaks Greek with a Greek voice, prepared', () => {
    synth.setVoices([fakeVoice('Samantha', 'en-US'), fakeVoice('Melina', 'el-GR')]);
    const h = speak('ἀρχῇ', 'grc', { translit: 'archē' })!;
    expect(h.mode).toBe('native');
    expect(h.voice?.name).toBe('Melina');
    expect(synth.current?.text).toBe('αρχή');
    expect(synth.current?.lang).toBe('el-GR');
  });

  it('falls back to the transliteration with an English voice', () => {
    synth.setVoices([fakeVoice('Samantha', 'en-US')]);
    expect(speechModeFor('hbo', true)).toBe('translit');
    const h = speak('אֱלֹהִים', 'hbo', { translit: 'ʾĕlōhiym' })!;
    expect(h.mode).toBe('translit');
    expect(h.voice?.name).toBe('Samantha');
    expect(synth.current?.text).toBe('eloheem');
    expect(synth.current?.lang).toBe('en-US');
  });

  it('still asks the engine when there are no voices at all', () => {
    expect(speechModeFor('grc', true)).toBe('unknown-voice');
    const h = speak('λόγος', 'grc', { translit: 'logos' })!;
    expect(h.mode).toBe('unknown-voice');
    expect(synth.current?.lang).toBe('el-GR');
  });

  it('reports start / end and resolves done', async () => {
    synth.setVoices([fakeVoice('Melina', 'el-GR')]);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const h = speak('λόγος', 'grc', { onStart, onEnd })!;
    expect(onStart).toHaveBeenCalled();
    synth.finish();
    expect(onEnd).toHaveBeenCalledTimes(1);
    await expect(h.done).resolves.toBe('end');
  });

  it('cancels what is playing unless queued, and tells pre-emption listeners', () => {
    synth.setVoices([fakeVoice('Samantha', 'en-US')]);
    const onError = vi.fn();
    const preempt = vi.fn();
    const off = onPreempt(preempt);
    speak('First', 'en', { onError });
    speak('Second', 'en', { queue: true });
    expect(synth.queue).toHaveLength(1);
    expect(preempt).not.toHaveBeenCalled();
    speak('Third', 'en');
    expect(preempt).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('interrupted');
    expect(synth.current?.text).toBe('Third');
    off();
  });

  it('clamps the rate and resumes a stuck paused engine', () => {
    synth.setVoices([fakeVoice('Samantha', 'en-US')]);
    synth.paused = true;
    speak('Fast', 'en', { rate: 9 });
    expect(synth.current?.rate).toBe(2);
    expect(synth.paused).toBe(false);
  });

  it('stop() cancels everything', () => {
    synth.setVoices([fakeVoice('Samantha', 'en-US')]);
    speak('One', 'en');
    speak('Two', 'en', { queue: true });
    expect(isSpeaking()).toBe(true);
    stop();
    expect(isSpeaking()).toBe(false);
  });

  it('unlockSpeech() speaks one silent utterance, once', () => {
    unlockSpeech();
    unlockSpeech();
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].volume).toBe(0);
  });

  it('returns null for empty text', () => {
    expect(speak('   ', 'en')).toBeNull();
  });
});
