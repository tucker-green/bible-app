import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeakButton } from '../../src/components/word/SpeakButton';
import { resetSpeech } from '../../src/lib/speech';
import { fakeVoice, FakeSynth, installSpeech, uninstallSpeech } from '../speech.fakes';

let synth: FakeSynth;

beforeEach(() => {
  resetSpeech();
  synth = installSpeech();
});

afterEach(() => {
  cleanup();
  uninstallSpeech();
  resetSpeech();
  vi.useRealTimers();
});

describe('SpeakButton', () => {
  it('renders nothing without speech synthesis', () => {
    uninstallSpeech();
    const { container } = render(<SpeakButton text="λόγος" lang="grc" translit="logos" />);
    expect(container.innerHTML).toBe('');
  });

  it('is named "Pronounce λόγος (modern pronunciation)" and speaks with a Greek voice', () => {
    synth.voices = [fakeVoice('Samantha', 'en-US'), fakeVoice('Melina', 'el-GR')];
    render(<SpeakButton text="λόγος" lang="grc" translit="logos" />);
    const btn = screen.getByRole('button', { name: 'Pronounce λόγος (modern pronunciation)' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('title')).toBe('Modern pronunciation');
    expect(btn.querySelector('[lang="el"]')?.textContent).toBe('λόγος');

    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(synth.current?.text).toBe('λόγος');
    expect(synth.current?.voice?.name).toBe('Melina');

    act(() => synth.finish());
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('pressing again stops', () => {
    synth.voices = [fakeVoice('Melina', 'el-GR')];
    render(<SpeakButton text="λόγος" lang="grc" />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(synth.speaking).toBe(true);
    fireEvent.click(btn);
    expect(synth.speaking).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('falls back to the transliteration with an English voice', () => {
    synth.voices = [fakeVoice('Samantha', 'en-US')];
    render(<SpeakButton text="אֱלֹהִים" lang="hbo" translit="ʾĕlōhiym" />);
    const btn = screen.getByRole('button', { name: 'Pronounce אֱלֹהִים (transliteration, English voice)' });
    expect(btn.querySelector('[lang="he"]')?.getAttribute('dir')).toBe('rtl');
    fireEvent.click(btn);
    expect(synth.current?.text).toBe('eloheem');
    expect(synth.current?.voice?.name).toBe('Samantha');
  });

  it('passes pointed Hebrew without cantillation to a Hebrew voice', () => {
    synth.voices = [fakeVoice('Carmit', 'he-IL')];
    render(<SpeakButton text={'בְּרֵאשִׁ֖ית'} lang="hbo" />);
    fireEvent.click(screen.getByRole('button'));
    expect(synth.current?.text).toBe('בְּרֵאשִׁית');
    expect(synth.current?.lang).toBe('he-IL');
  });

  it('only one word speaks at a time', () => {
    synth.voices = [fakeVoice('Melina', 'el-GR')];
    render(
      <>
        <SpeakButton text="λόγος" lang="grc" />
        <SpeakButton text="θεός" lang="grc" />
      </>,
    );
    const [a, b] = screen.getAllByRole('button');
    fireEvent.click(a);
    fireEvent.click(b);
    expect(a.getAttribute('aria-pressed')).toBe('false');
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(synth.current?.text).toBe('θεός');
  });

  it('waits for voices to load, and hides when the device turns out to have none', async () => {
    vi.useFakeTimers();
    render(<SpeakButton text="λόγος" lang="grc" translit="logos" />);
    // voices not loaded yet: shown (most browsers load them a moment later)
    expect(screen.queryByRole('button')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });
    expect(screen.queryByRole('button')).toBeNull();
    // …and comes back if voices arrive later
    act(() => synth.setVoices([fakeVoice('Melina', 'el-GR')]));
    expect(screen.getByRole('button', { name: 'Pronounce λόγος (modern pronunciation)' })).toBeTruthy();
  });

  it('switches to the native name once a Greek voice loads', () => {
    synth.voices = [fakeVoice('Samantha', 'en-US')];
    render(<SpeakButton text="λόγος" lang="grc" translit="logos" />);
    expect(screen.getByRole('button', { name: /transliteration/ })).toBeTruthy();
    act(() => synth.setVoices([fakeVoice('Samantha', 'en-US'), fakeVoice('Melina', 'el-GR')]));
    expect(screen.getByRole('button', { name: 'Pronounce λόγος (modern pronunciation)' })).toBeTruthy();
  });
});
