import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, listeningVerse, passage, route, settings, updateSettings } from '../../src/app/state';
import { buildListenItems, listenTitle, resetListen, speakable, spokenHeading } from '../../src/components/listen/listen';
import {
  ListenBar,
  listenState,
  pauseListening,
  setListenContinue,
  startListening,
  stopListening,
} from '../../src/components/listen/ListenBar';
import { configureData } from '../../src/lib/data';
import { resetSpeech, speak } from '../../src/lib/speech';
import type { TextChapter } from '../../src/lib/types';
import { fakeVoice, FakeSynth, installMediaSession, installSpeech, uninstallMediaSession, uninstallSpeech } from '../speech.fakes';
import type { FakeMediaSession } from '../speech.fakes';

/* ---- fixtures ------------------------------------------------------------- */

const JHN1: TextChapter = {
  tr: 'KJV',
  book: 'JHN',
  chapter: 1,
  verses: [
    { v: 1, t: [['In', [0]], ' the beginning was the ', ['Word', [1]], '.'] },
    { v: 2, t: ['The same was in the beginning with ', ['God', [2]], '.'] },
    { v: 3, t: ['All things were made by him.'] },
  ],
};
const JHN2: TextChapter = {
  tr: 'KJV',
  book: 'JHN',
  chapter: 2,
  verses: [{ v: 1, t: ['And the third day there was a marriage in Cana of Galilee.'] }],
};
const PSA23: TextChapter = {
  tr: 'KJV',
  book: 'PSA',
  chapter: 23,
  superscription: ['A Psalm of David.'],
  verses: [{ v: 1, t: ['The ', ['LORD', [0]], ' is my shepherd; I shall not want.'] }],
};

const files: Record<string, unknown> = {
  'text/KJV/JHN/1.json': JHN1,
  'text/KJV/JHN/2.json': JHN2,
  'text/KJV/PSA/23.json': PSA23,
};

let synth: FakeSynth;
let media: FakeMediaSession;

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0)));
};

function goTo(book: string, chapter: number, tr = 'KJV') {
  const ref = { book, chapter };
  act(() => {
    passage.value = { tr, ref };
    route.value = { name: 'read', tr, ref };
  });
}

beforeEach(() => {
  resetSpeech();
  synth = installSpeech();
  synth.voices = [fakeVoice('Samantha', 'en-US'), fakeVoice('Melina', 'el-GR')];
  media = installMediaSession();
  configureData({
    base: '/data/',
    fetch: async (url: string) => {
      const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
      const body = files[path];
      return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nope', { status: 404 });
    },
  });
  settings.value = { ...DEFAULT_SETTINGS };
  setListenContinue(false);
  goTo('JHN', 1);
});

afterEach(() => {
  act(() => resetListen());
  cleanup();
  uninstallSpeech();
  uninstallMediaSession();
  resetSpeech();
  vi.restoreAllMocks();
});

/* ---- pure helpers ----------------------------------------------------------- */

describe('listen items', () => {
  it('cleans KJV text for speech', () => {
    expect(speakable('The LORD is my shepherd ¶ [and] GOD')).toBe('The Lord is my shepherd and God');
    expect(speakable('I AM THAT I AM')).toBe('I Am That I Am');
  });

  it('says the chapter heading the way a reader would', () => {
    expect(spokenHeading('JHN', 1)).toBe('John, chapter 1.');
    expect(spokenHeading('PSA', 23)).toBe('Psalm 23.');
    expect(spokenHeading('1CO', 13)).toBe('First Corinthians, chapter 13.');
    expect(spokenHeading('JUD', 1)).toBe('Jude.');
  });

  it('builds heading, Psalm title and verse pieces in order', () => {
    const items = buildListenItems(PSA23, { heading: 'Psalm 23.' });
    expect(items.map((i) => [i.verse, i.text])).toEqual([
      [0, 'Psalm 23.'],
      [0, 'A Psalm of David.'],
      [1, 'The Lord is my shepherd; I shall not want.'],
    ]);
    expect(items[0].intro).toBe(true);
  });

  it('titles the session "John 1 — KJV"', () => {
    expect(listenTitle({ book: 'JHN', chapter: 1, tr: 'KJV' })).toBe('John 1 — KJV');
  });
});

/* ---- the bar ---------------------------------------------------------------- */

describe('ListenBar', () => {
  it('renders nothing until listening starts', () => {
    const { container } = render(<ListenBar />);
    expect(container.innerHTML).toBe('');
  });

  it('reads the chapter verse by verse, driving listeningVerse', async () => {
    render(<ListenBar />);
    act(() => startListening());
    expect(listenState.value.status).toBe('loading');
    await flush();
    expect(listenState.value.status).toBe('playing');
    expect(synth.current?.text).toBe('John, chapter 1.');
    expect(synth.current?.voice?.name).toBe('Samantha');
    expect(listeningVerse.value).toBe(1);
    // the next piece is already queued (no gap between verses)
    expect(synth.queue.map((u) => u.text)).toEqual(['In the beginning was the Word.']);

    act(() => synth.finish());
    expect(synth.current?.text).toBe('In the beginning was the Word.');
    expect(listeningVerse.value).toBe(1);
    act(() => synth.finish());
    expect(synth.current?.text).toBe('The same was in the beginning with God.');
    expect(listeningVerse.value).toBe(2);

    const region = screen.getByRole('region', { name: 'Listen mode' });
    expect(region.textContent).toContain('John 1');
    expect(region.textContent).toContain('Verse 2 of 3');
    expect(screen.getByRole('button', { name: 'Pause reading aloud' })).toBeTruthy();
  });

  it('sets Media Session metadata and handlers', async () => {
    render(<ListenBar />);
    act(() => startListening());
    await flush();
    expect(media.metadata?.title).toBe('John 1 — KJV');
    expect(media.playbackState).toBe('playing');
    expect(media.handlers.get('pause')).toBeTypeOf('function');
    act(() => media.handlers.get('pause')!());
    expect(listenState.value.status).toBe('paused');
    expect(media.playbackState).toBe('paused');
    act(() => media.handlers.get('nexttrack')!());
    expect(listeningVerse.value).toBe(2);
    act(() => stopListening());
    expect(media.metadata).toBeNull();
    expect(media.handlers.get('play')).toBeNull();
  });

  it('pauses, resumes the same piece, and skips between verses', async () => {
    render(<ListenBar />);
    act(() => startListening(2));
    await flush();
    expect(synth.current?.text).toBe('The same was in the beginning with God.');
    expect(listeningVerse.value).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Pause reading aloud' }));
    expect(listenState.value.status).toBe('paused');
    expect(synth.speaking).toBe(false);
    expect(listeningVerse.value).toBe(2); // the verse stays highlighted while paused

    fireEvent.click(screen.getByRole('button', { name: 'Resume reading aloud' }));
    expect(listenState.value.status).toBe('playing');
    expect(synth.current?.text).toBe('The same was in the beginning with God.');

    fireEvent.click(screen.getByRole('button', { name: 'Next verse' }));
    expect(synth.current?.text).toBe('All things were made by him.');
    expect(listeningVerse.value).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: 'Previous verse' }));
    expect(listeningVerse.value).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Previous verse' }));
    expect(listeningVerse.value).toBe(1);
    expect(synth.current?.text).toBe('In the beginning was the Word.');
  });

  it('ignores stale events after a skip', async () => {
    render(<ListenBar />);
    act(() => startListening());
    await flush();
    const stale = synth.current!;
    act(() => startListening(3));
    expect(listeningVerse.value).toBe(3);
    act(() => stale.onend?.({})); // a late `end` from the cancelled utterance
    expect(listeningVerse.value).toBe(3);
    expect(synth.current?.text).toBe('All things were made by him.');
  });

  it('applies a new speed at once', async () => {
    render(<ListenBar />);
    act(() => startListening(1));
    await flush();
    expect(synth.current?.rate).toBe(1);
    act(() => updateSettings({ listenRate: 1.5 }));
    expect(synth.current?.text).toBe('In the beginning was the Word.');
    expect(synth.current?.rate).toBe(1.5);
  });

  it('offers speed and "continue into the next chapter" in the options popover', async () => {
    render(<ListenBar />);
    act(() => startListening(1));
    await flush();
    const opts = screen.getByRole('button', { name: /Speed 1×/ });
    fireEvent.click(opts);
    expect(opts.getAttribute('aria-expanded')).toBe('true');
    const dialog = screen.getByRole('dialog', { name: 'Listening options' });
    fireEvent.click(screen.getByRole('radio', { name: '1.25×' }));
    expect(settings.value.listenRate).toBe(1.25);
    expect(synth.current?.rate).toBe(1.25);
    const sw = screen.getByRole('switch', { name: /Continue into the next chapter/ }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    expect(sw.checked).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Listening options' })).toBeNull();
  });

  it('finishes the chapter (play again / go on), or continues when asked', async () => {
    render(<ListenBar />);
    act(() => startListening(3));
    await flush();
    act(() => synth.finish());
    expect(listenState.value.status).toBe('ended');
    expect(listeningVerse.value).toBeNull();
    expect(screen.getByRole('button', { name: 'Read John 1 again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Listen to John 2' })).toBeTruthy();

    // with continue on, the end of a chapter moves to the next one and keeps reading
    act(() => setListenContinue(true));
    act(() => startListening(3));
    await flush();
    act(() => synth.finish());
    await flush();
    expect(listenState.value.chapter).toBe(2);
    expect(listenState.value.status).toBe('playing');
    expect(synth.current?.text).toBe('John, chapter 2.');
    expect(window.location.hash).toBe('#/KJV/JHN/2');
    goTo('JHN', 2); // the router follows the hash: listening carries on
    await flush();
    expect(listenState.value.status).toBe('playing');
  });

  it('stops when the reader navigates elsewhere', async () => {
    render(<ListenBar />);
    act(() => startListening());
    await flush();
    goTo('JHN', 3);
    await flush();
    expect(listenState.value.status).toBe('idle');
    expect(listeningVerse.value).toBeNull();
    expect(synth.speaking).toBe(false);
  });

  it('stops when leaving the reader for another page', async () => {
    render(<ListenBar />);
    act(() => startListening());
    await flush();
    act(() => {
      route.value = { name: 'about' };
    });
    await flush();
    expect(listenState.value.status).toBe('idle');
  });

  it('pauses (not skips) when the pronounce button takes the speaker', async () => {
    render(<ListenBar />);
    act(() => startListening(1));
    await flush();
    synth.cancelReports = 'end'; // engines that report a cancel as a normal end
    act(() => {
      speak('λόγος', 'grc');
    });
    expect(listenState.value.status).toBe('paused');
    expect(listeningVerse.value).toBe(1);
    expect(synth.current?.text).toBe('λόγος');
  });

  it('pauses when the engine reports an interruption', async () => {
    render(<ListenBar />);
    act(() => startListening(1));
    await flush();
    act(() => synth.fail('interrupted'));
    expect(listenState.value.status).toBe('paused');
  });

  it('retries once with another voice, then reports the error', async () => {
    synth.voices = [fakeVoice('Remote Natural', 'en-US', { localService: false }), fakeVoice('Local', 'en-US')];
    render(<ListenBar />);
    act(() => startListening(1));
    await flush();
    expect(synth.current?.voice?.name).toBe('Remote Natural');
    act(() => synth.fail('network'));
    expect(listenState.value.status).toBe('playing');
    expect(synth.current?.voice?.name).toBe('Local');
    act(() => synth.fail('synthesis-failed'));
    expect(listenState.value.status).toBe('error');
    expect(screen.getByRole('button', { name: 'Try reading aloud again' })).toBeTruthy();
  });

  it('shows a load error and can retry', async () => {
    goTo('JHN', 9);
    render(<ListenBar />);
    act(() => startListening());
    await flush();
    expect(listenState.value.status).toBe('error');
    expect(screen.getByRole('region', { name: 'Listen mode' }).textContent).toContain('Couldn’t load John 9');
  });

  it('closes and clears the highlight', async () => {
    render(<ListenBar />);
    act(() => startListening());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Stop reading aloud' }));
    expect(listenState.value.status).toBe('idle');
    expect(listeningVerse.value).toBeNull();
    expect(screen.queryByRole('region', { name: 'Listen mode' })).toBeNull();
    expect(document.documentElement.classList.contains('has-listen')).toBe(false);
  });

  it('a pause while loading waits at the start verse', async () => {
    render(<ListenBar />);
    act(() => startListening(2));
    act(() => pauseListening());
    await flush();
    expect(listenState.value.status).toBe('paused');
    expect(listeningVerse.value).toBe(2);
    expect(synth.current?.text ?? null).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume reading aloud' }));
    expect(synth.current?.text).toBe('The same was in the beginning with God.');
  });

  it('tells the reader when speech is unavailable', () => {
    uninstallSpeech();
    render(<ListenBar />);
    act(() => startListening());
    expect(listenState.value.status).toBe('idle');
  });
});
