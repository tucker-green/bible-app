/**
 * Cross references UI — the verse-sheet section (src/components/verse/XrefSection.tsx), following a
 * reference (navigate.ts: feedback, history, focus, trail) and the "Back to John 3:16" chip.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({ feedback: vi.fn(), primeFeedback: vi.fn() }));
vi.mock('../../src/lib/feedback', () => fb);

import { passage, route, verseSheet } from '../../src/app/state';
import { XrefSection } from '../../src/components/verse/XrefSection';
import { goBackXref, xrefTrail } from '../../src/components/xrefs/navigate';
import { resetPreviewCache } from '../../src/components/xrefs/previews';
import { resetXrefState } from '../../src/components/xrefs/useXrefs';
import { XrefBack } from '../../src/components/xrefs/XrefBack';
import { configureData, registerTextSource, unregisterTextSource } from '../../src/lib/data';
import type { TextChapter, XrefChapter } from '../../src/lib/types';
import { configureXrefs } from '../../src/lib/xrefs';

/* ---- fixtures ------------------------------------------------------------- */

const JHN3_XREF: XrefChapter = {
  book: 'JHN',
  chapter: 3,
  verses: {
    '16': [
      [45005008, 0, 70], // Rom 5:8
      [62004009, 62004010, 40], // 1 John 4:9–10 (range)
      [43003015, 0, 30], // John 3:15
      [45008032, 0, 25], // Rom 8:32
      [43011025, 43011026, 20], // John 11:25–26
      [43006040, 0, 15], // John 6:40 (missing from the fixture chapter)
      [43003036, 0, 12], // John 3:36
      [62004019, 0, 6], // 1 John 4:19 (moderate)
      [23009006, 0, 5], // Isa 9:6 (OT, hidden until "Show more")
      [1022002, 0, 2], // Gen 22:2 (OT, weak)
    ],
    '5': [[26036025, 26036027, 92]],
  },
};

const ch = (tr: string, book: string, chapter: number, verses: [number, string][]): TextChapter => ({
  tr,
  book,
  chapter,
  verses: verses.map(([v, s]) => ({ v, t: [s] })),
});

const FILES: Record<string, unknown> = {
  'xref/JHN/3.json': JHN3_XREF,
  'text/KJV/ROM/5.json': ch('KJV', 'ROM', 5, [[8, 'But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us.']]),
  'text/KJV/1JN/4.json': ch('KJV', '1JN', 4, [
    [9, 'In this was manifested the love of God toward us.'],
    [19, 'We love him, because he first loved us.'],
  ]),
  'text/KJV/JHN/3.json': ch('KJV', 'JHN', 3, [
    [15, 'That whosoever believeth in him should not perish.'],
    [16, 'For God so loved the world.'],
    [36, 'He that believeth on the Son hath everlasting life.'],
  ]),
  'text/KJV/ROM/8.json': ch('KJV', 'ROM', 8, [[32, 'He that spared not his own Son.']]),
  'text/KJV/JHN/11.json': ch('KJV', 'JHN', 11, [[25, 'Jesus said unto her, I am the resurrection, and the life.']]),
  'text/KJV/JHN/6.json': ch('KJV', 'JHN', 6, [[39, 'And this is the Father’s will.']]),
  'text/KJV/ISA/9.json': ch('KJV', 'ISA', 9, [[6, 'For unto us a child is born.']]),
  'text/KJV/GEN/22.json': ch('KJV', 'GEN', 22, [[2, 'Take now thy son, thine only son Isaac.']]),
};

let fetched: string[] = [];
let failXrefs = 0;
const fetchMock = async (url: string) => {
  const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
  fetched.push(path);
  if (path.startsWith('xref/') && failXrefs > 0) {
    failXrefs--;
    return new Response('boom', { status: 500 });
  }
  const body = FILES[path];
  return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nope', { status: 404 });
};

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0)));
};

function readAt(hash: string, book: string, chapter: number, verse?: number) {
  window.history.replaceState(null, '', hash);
  const ref = verse ? { book, chapter, verse } : { book, chapter };
  passage.value = { tr: 'KJV', ref };
  route.value = { name: 'read', tr: 'KJV', ref };
}

beforeEach(() => {
  fetched = [];
  failXrefs = 0;
  resetPreviewCache();
  resetXrefState();
  configureData({ base: '/data/', fetch: fetchMock });
  configureXrefs({ fetch: fetchMock });
  xrefTrail.value = [];
  verseSheet.value = null;
  readAt('#/KJV/JHN/3', 'JHN', 3);
  fb.feedback.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  unregisterTextSource('NIV');
  vi.useRealTimers();
});

const section = (verse = 16, tr = 'KJV') => render(<XrefSection book="JHN" chapter={3} verse={verse} tr={tr} />);

/* ---- the section ---------------------------------------------------------- */

describe('XrefSection', () => {
  it('shows a busy skeleton, then the strongest 8 grouped by testament with previews', async () => {
    const { container } = section();
    const sec = container.querySelector('section')!;
    expect(sec.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { level: 3, name: 'Cross references' })).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll('.xr-link').length).toBe(8));
    expect(sec.getAttribute('aria-busy')).toBeNull();
    // count, spelled out for screen readers
    expect(container.querySelector('.xr-sec__count')!.textContent).toBe('10 references, strongest first');
    // only NT among the first 8 → one group
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['New Testament']);
    const first = container.querySelector<HTMLAnchorElement>('.xr-link')!;
    expect(first.getAttribute('href')).toBe('#/KJV/ROM/5/8');
    expect(first.querySelector('.xr-link__ref')!.textContent).toBe('Romans 5:8');
    // previews arrive (batched per chapter)
    await waitFor(() => expect(first.textContent).toContain('But God commendeth his love'));
    const range = container.querySelectorAll<HTMLAnchorElement>('.xr-link')[1];
    expect(range.querySelector('.xr-link__ref')!.textContent).toBe('1 John 4:9–10');
    expect(range.querySelector('.xr-link__prev')!.textContent).toBe('In this was manifested the love of God toward us. …');
    // a verse the translation lacks says so instead of a blank
    const missing = [...container.querySelectorAll('.xr-link')].find((a) => a.getAttribute('href') === '#/KJV/JHN/6/40')!;
    expect(missing.textContent).toContain('Not in this translation');
    // 1 John 4 loaded once for two targets
    expect(fetched.filter((p) => p === 'text/KJV/1JN/4.json').length).toBe(1);
    expect(fetched).not.toContain('text/KJV/ISA/9.json'); // hidden targets are not fetched yet
  });

  it('spells out the vote strength (never colour alone)', async () => {
    const { container } = section();
    await waitFor(() => expect(container.querySelectorAll('.xr-link').length).toBe(8));
    const links = [...container.querySelectorAll('.xr-link')];
    expect(links[0].querySelector('.sr-only')!.textContent).toBe(', strong link, 70 votes.');
    expect(links[0].querySelector('.xr-str--3')).toBeTruthy();
    expect(links[7].querySelector('.sr-only')!.textContent).toBe(', moderate link, 6 votes.');
    expect(links[7].querySelector('.xr-str__bars')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('"Show 2 more" expands in place (disclosure keeps focus) and reveals the Old Testament group', async () => {
    const { container } = section();
    await waitFor(() => expect(container.querySelectorAll('.xr-link').length).toBe(8));
    const more = screen.getByRole('button', { name: 'Show 2 more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(more.getAttribute('aria-controls')!)).toBeTruthy();
    more.focus();
    fireEvent.click(more);
    await flush();
    expect(container.querySelectorAll('.xr-link').length).toBe(10);
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['New Testament', 'Old Testament']);
    const fewer = screen.getByRole('button', { name: 'Show fewer' });
    expect(fewer.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(fewer);
    await waitFor(() => expect(container.textContent).toContain('For unto us a child is born.'));
    const weak = [...container.querySelectorAll('.xr-link')].find((a) => a.getAttribute('href') === '#/KJV/GEN/22/2')!;
    expect(weak.querySelector('.xr-str--1')).toBeTruthy();
  });

  it('has an empty state', async () => {
    const { container } = section(17);
    await waitFor(() => expect(screen.getByText('No cross references for this verse yet.')).toBeTruthy());
    expect(container.querySelector('.xr-link')).toBeNull();
    expect(screen.getByRole('link', { name: 'OpenBible.info' }).getAttribute('href')).toContain('openbible.info');
  });

  it('shows an error with a retry', async () => {
    failXrefs = 1;
    section();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('didn’t load');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(document.querySelectorAll('.xr-link').length).toBe(8));
  });

  it('takes previews from the KJV for a runtime translation and says so', async () => {
    const niv = vi.fn(async () => {
      throw new Error('should not fetch NIV chapters for previews');
    });
    registerTextSource('NIV', niv);
    const { container } = section(16, 'NIV');
    await waitFor(() => expect(container.querySelector('.xr-link')!.textContent).toContain('But God commendeth'));
    expect(container.querySelector('.xr-link')!.getAttribute('href')).toBe('#/NIV/ROM/5/8');
    expect(screen.getByText('Previews from the KJV.')).toBeTruthy();
    expect(niv).not.toHaveBeenCalled();
  });
});

/* ---- following a reference and coming back -------------------------------- */

describe('following a cross reference', () => {
  it('navigates, gives feedback, keeps the way back in history and offers "Back to John 3:16"', async () => {
    const { container } = render(
      <>
        <XrefSection book="JHN" chapter={3} verse={16} tr="KJV" />
        <XrefBack />
      </>,
    );
    await waitFor(() => expect(container.querySelectorAll('.xr-link').length).toBe(8));
    const before = window.history.length;
    const link = container.querySelector<HTMLAnchorElement>('.xr-link')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      link.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(fb.feedback).toHaveBeenCalledWith('select');
    expect(location.hash).toBe('#/KJV/ROM/5/8');
    expect(window.history.length).toBe(before + 1);
    expect((window.history.state as { rwXref?: string }).rwXref).toBeTruthy();
    expect(xrefTrail.value).toHaveLength(1);
    expect(xrefTrail.value[0].from.ref).toEqual({ book: 'JHN', chapter: 3, verse: 16 });
    // the router would now show Romans 5:8
    act(() => readAt('#/KJV/ROM/5/8', 'ROM', 5, 8));
    // (readAt replaced the entry: re-mark it as the one we pushed)
    window.history.replaceState({ rwXref: xrefTrail.value[0].token }, '');
    const chip = await screen.findByRole('navigation', { name: 'Cross reference' });
    expect(within(chip).getByRole('button', { name: 'Back to John 3:16' })).toBeTruthy();
    // going back uses history.back() when the target is still the current entry
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    fireEvent.click(within(chip).getByRole('button', { name: 'Back to John 3:16' }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(xrefTrail.value).toHaveLength(0);
    expect(fb.feedback).toHaveBeenCalledTimes(2);
    back.mockRestore();
  });

  it('leaves modified clicks (new tab / window) to the browser', async () => {
    const { container } = section();
    await waitFor(() => expect(container.querySelectorAll('.xr-link').length).toBe(8));
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    // jsdom would follow the hash on default; stop it after our handler ran
    const link = container.querySelector<HTMLAnchorElement>('.xr-link')!;
    link.addEventListener('click', (e) => e.preventDefault());
    const pre = fb.feedback.mock.calls.length;
    link.dispatchEvent(ev);
    expect(fb.feedback.mock.calls.length).toBe(pre);
    expect(xrefTrail.value).toHaveLength(0);
  });

  it('closes the verse sheet first and waits for its back-button history entry to go', async () => {
    // a phone verse sheet: shell/sheet.ts pushed { rwSheet } on open
    window.history.pushState({ rwSheet: 'm1' }, '');
    verseSheet.value = { key: 'KJV/JHN/3', verse: 16 };
    const { container } = section();
    await waitFor(() => expect(container.querySelectorAll('.xr-link').length).toBe(8));
    fireEvent.click(container.querySelector('.xr-link')!);
    expect(verseSheet.value).toBeNull();
    expect(location.hash).toBe('#/KJV/JHN/3'); // not yet: the sheet's entry is still current
    window.history.back(); // what the sheet does on close
    await waitFor(() => expect(location.hash).toBe('#/KJV/ROM/5/8'));
    // the origin entry now names the verse, so the browser's Back lands on it
    const st = window.history.state as { rwSheet?: string; rwXref?: string };
    expect(st.rwSheet).toBeUndefined();
    expect(st.rwXref).toBeTruthy();
  });

  it('moves keyboard focus to the target verse number once its chapter has rendered', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<article id="text"><div class="prose"><span class="verse" id="v8" data-v="8"><span class="vn" data-vn="8" tabindex="-1">8</span>But God</span></div></article>',
    );
    const { container } = section();
    await waitFor(() => expect(container.querySelectorAll('.xr-link').length).toBe(8));
    fireEvent.click(container.querySelector('.xr-link')!);
    window.dispatchEvent(new CustomEvent('rootword:rendered', { detail: { key: 'KJV/ROM/5' } }));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-vn')).toBe('8'), { timeout: 1000 });
  });

  it('goes back by navigating when the history entry is no longer ours (e.g. the translation changed)', () => {
    xrefTrail.value = [
      { from: { tr: 'KJV', ref: { book: 'JHN', chapter: 3, verse: 16 } }, to: { tr: 'KJV', ref: { book: 'ROM', chapter: 5, verse: 8 } }, token: 'tok' },
    ];
    readAt('#/BSB/ROM/5/8', 'ROM', 5, 8);
    passage.value = { tr: 'BSB', ref: { book: 'ROM', chapter: 5, verse: 8 } };
    const back = vi.spyOn(window.history, 'back');
    goBackXref(xrefTrail.value[0]);
    expect(back).not.toHaveBeenCalled();
    expect(location.hash).toBe('#/BSB/JHN/3/16');
    back.mockRestore();
  });

  it('dismissing the chip clears the trail', async () => {
    xrefTrail.value = [
      { from: { tr: 'KJV', ref: { book: 'JHN', chapter: 3, verse: 16 } }, to: { tr: 'KJV', ref: { book: 'ROM', chapter: 5, verse: 8 } }, token: 'tok' },
    ];
    readAt('#/KJV/ROM/5/8', 'ROM', 5, 8);
    render(<XrefBack />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await flush(2);
    expect(xrefTrail.value).toEqual([]);
    expect(screen.queryByRole('navigation', { name: 'Cross reference' })).toBeNull();
  });

  it('hides the chip once the reader leaves the trail', async () => {
    xrefTrail.value = [
      { from: { tr: 'KJV', ref: { book: 'JHN', chapter: 3, verse: 16 } }, to: { tr: 'KJV', ref: { book: 'ROM', chapter: 5, verse: 8 } }, token: 'tok' },
    ];
    readAt('#/KJV/ROM/5/8', 'ROM', 5, 8);
    render(<XrefBack />);
    expect(screen.getByRole('button', { name: 'Back to John 3:16' })).toBeTruthy();
    act(() => readAt('#/KJV/ROM/6', 'ROM', 6));
    await flush(2);
    expect(screen.queryByRole('navigation', { name: 'Cross reference' })).toBeNull();
    expect(xrefTrail.value).toEqual([]);
  });
});
