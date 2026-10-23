/**
 * Cross references UI — the desktop / laptop rail block (src/components/xrefs/XrefRail.tsx) and the
 * verse it follows (readingVerse.ts): route target, keyboard focus, mouse dwell, tapped word,
 * reading line; one block per window size; "All N" opens the verse panel.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({ feedback: vi.fn(), primeFeedback: vi.fn() }));
vi.mock('../../src/lib/feedback', () => fb);

import { passage, pinnedWord, route, verseSheet } from '../../src/app/state';
import { resetPreviewCache } from '../../src/components/xrefs/previews';
import { DWELL_MS, verseBox } from '../../src/components/xrefs/readingVerse';
import { resetXrefState } from '../../src/components/xrefs/useXrefs';
import { RAIL_LIMIT, XrefRail } from '../../src/components/xrefs/XrefRail';
import { configureData } from '../../src/lib/data';
import type { XrefChapter } from '../../src/lib/types';
import { configureXrefs } from '../../src/lib/xrefs';

const XREF: XrefChapter = {
  book: 'JHN',
  chapter: 3,
  verses: {
    '3': [[47005017, 0, 70]],
    '5': [
      [26036025, 26036027, 92],
      [44002038, 0, 52],
    ],
    '16': [
      [45005008, 0, 70],
      [62004009, 62004010, 40],
      [43003015, 0, 30],
      [45008032, 0, 25],
      [43011025, 43011026, 20],
      [43006040, 0, 15],
      [43003036, 0, 12],
    ],
  },
};
const fetchMock = async (url: string) => {
  const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
  if (path === 'xref/JHN/3.json') return new Response(JSON.stringify(XREF), { status: 200 });
  return new Response('nope', { status: 404 });
};

let media = '(min-width: 1440px)';
function stubMedia() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === media,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }));
}

/** A rendered chapter: verse v sits at top = v * 100 - scrollY (100 px per verse). */
function mountProse(verses: number[]) {
  const html = verses
    .map((v) => `<span class="verse" id="v${v}" data-v="${v}"><span class="vn" data-vn="${v}" tabindex="-1">${v}</span><span class="w" data-u="${v * 10}" tabindex="-1">word${v}</span></span>`)
    .join(' ');
  document.body.insertAdjacentHTML('beforeend', `<article id="text"><div class="prose">${html}</div></article>`);
  for (const el of document.querySelectorAll<HTMLElement>('.verse')) {
    const v = Number(el.dataset.v);
    el.getBoundingClientRect = () => {
      const top = v * 100 - window.scrollY;
      return { top, bottom: top + 90, left: 0, right: 600, width: 600, height: 90, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
  }
}

const verseLabel = () => document.querySelector('.xr-rail__verse')?.textContent ?? '';
const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0))));

beforeEach(() => {
  media = '(min-width: 1440px)';
  stubMedia();
  resetXrefState();
  resetPreviewCache();
  configureData({ base: '/data/', fetch: fetchMock });
  configureXrefs({ fetch: fetchMock });
  verseSheet.value = null;
  pinnedWord.value = null;
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
  window.scrollTo = ((_x: number, y: number) => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  }) as typeof window.scrollTo;
  window.scrollTo(0, 0);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function read(verse?: number) {
  const ref = verse ? { book: 'JHN', chapter: 3, verse } : { book: 'JHN', chapter: 3 };
  passage.value = { tr: 'KJV', ref };
  route.value = { name: 'read', tr: 'KJV', ref };
}

describe('XrefRail', () => {
  it('renders only the block matching the window (right ≥ 1440, left 1024–1439)', () => {
    read(16);
    const { container, rerender } = render(<XrefRail placement="left" />);
    expect(container.innerHTML).toBe('');
    rerender(<XrefRail placement="right" />);
    expect(container.querySelector('.xr-rail')).toBeTruthy();
    cleanup();
    media = '(min-width: 1024px) and (max-width: 1439.98px)';
    stubMedia();
    expect(render(<XrefRail placement="left" />).container.querySelector('.xr-rail')).toBeTruthy();
  });

  it('follows the targeted verse, shows the strongest few and opens the full list in the verse panel', async () => {
    mountProse([1, 2, 3, 4, 5, 16]);
    read(16);
    render(<XrefRail placement="right" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Cross references' })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.xr-rail .xr-link').length).toBe(RAIL_LIMIT));
    expect(verseLabel()).toBe('For John 3:16 · 7 references');
    expect(document.querySelector('.xr-rail .xr-link__ref')!.textContent).toBe('Rom 5:8'); // compact references
    fireEvent.click(screen.getByRole('button', { name: 'All 7 cross references' }));
    expect(verseSheet.value).toEqual({ key: 'KJV/JHN/3', verse: 16 });
  });

  it('follows keyboard focus and a tapped (pinned) word', async () => {
    mountProse([1, 2, 3, 4, 5, 16]);
    read(16);
    render(<XrefRail placement="right" />);
    await waitFor(() => expect(verseLabel()).toContain('John 3:16'));
    act(() => document.querySelector<HTMLElement>('[data-vn="5"]')!.focus());
    await waitFor(() => expect(verseLabel()).toContain('John 3:5'));
    act(() => {
      pinnedWord.value = { key: 'KJV/JHN/3', unit: 30, via: 'touch' };
    });
    await waitFor(() => expect(verseLabel()).toContain('John 3:3'));
  });

  it('follows the mouse only after it rests on a verse', async () => {
    mountProse([1, 2, 3, 4, 5, 16]);
    read(16);
    render(<XrefRail placement="right" />);
    await waitFor(() => expect(verseLabel()).toContain('John 3:16'));
    const over = (v: number) => document.querySelector(`[data-u="${v * 10}"]`)!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    // sweeping across verses 2 and 3 on the way somewhere: no change
    over(2);
    await act(() => new Promise((r) => setTimeout(r, DWELL_MS / 3)));
    over(3);
    await act(() => new Promise((r) => setTimeout(r, DWELL_MS / 3)));
    document.body.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); // left the text
    await act(() => new Promise((r) => setTimeout(r, DWELL_MS + 50)));
    expect(verseLabel()).toContain('John 3:16');
    // resting on verse 5
    over(5);
    await act(() => new Promise((r) => setTimeout(r, DWELL_MS + 50)));
    expect(verseLabel()).toContain('John 3:5');
  });

  it('without a pick, follows the verse at the reading line as the page scrolls', async () => {
    mountProse([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    read();
    render(<XrefRail placement="right" />);
    await frame();
    // header 0 → reading line at 300 px: verse 3 (top 300)
    await waitFor(() => expect(verseLabel()).toContain('John 3:3'));
    await waitFor(() => expect(document.querySelectorAll('.xr-rail .xr-link').length).toBe(1));
    // line 300 + 100 → verse 4, which has none
    window.scrollTo(0, 100);
    window.dispatchEvent(new Event('scroll'));
    await frame();
    await waitFor(() => expect(verseLabel()).toContain('John 3:4'));
    expect(screen.getByText('None for this verse yet.')).toBeTruthy();
    window.scrollTo(0, 220);
    window.dispatchEvent(new Event('scroll'));
    await frame();
    // line 300 + 220 → verse 5 (top 500)
    await waitFor(() => expect(verseLabel()).toContain('John 3:5'));
    expect(document.querySelectorAll('.xr-rail .xr-link').length).toBe(2);
    expect(screen.queryByRole('button', { name: /All \d+ cross references/ })).toBeNull(); // nothing hidden
  });

  it('measures interlinear verses (display: contents, no box) by their first and last cells', () => {
    const el = document.createElement('span');
    el.innerHTML = '<span class="vn">7</span><span class="il">a</span><span class="il">b</span>';
    const rect = (top: number, bottom: number) => () => ({ top, bottom, left: 0, right: 10, width: 10, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    (el.children[0] as HTMLElement).getBoundingClientRect = rect(400, 420);
    (el.children[2] as HTMLElement).getBoundingClientRect = rect(500, 560);
    el.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    expect(verseBox(el)).toEqual({ top: 400, bottom: 560 });
  });
});
