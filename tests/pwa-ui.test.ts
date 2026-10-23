/**
 * src/pwa.ts (update card, offline banner, data-set changes, downloads) and Settings → Offline
 * (src/components/settings/OfflineSection.tsx), against an in-memory Cache Storage and a mocked fetch.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/feedback', () => ({ feedback: vi.fn(), primeFeedback: vi.fn() }));

import { meta, passage, toastMessage } from '../src/app/state';
import { OfflineSection } from '../src/components/settings/OfflineSection';
import { configureData, resetDataCache } from '../src/lib/data';
import { CACHE } from '../src/lib/offline';
import type { DataMeta, TranslationMeta } from '../src/lib/types';
import {
  download,
  lexiconSaved,
  offlineDismissed,
  online,
  PwaStatus,
  savedBooks,
  swStatus,
  syncDataStamp,
  updateDismissed,
  updateReady,
} from '../src/pwa';
import { fakeCaches } from './pwa.fakes';
import type { FakeCaches } from './pwa.fakes';

const tr = (id: string): TranslationMeta => ({ id, name: id, abbr: id, year: '', license: 'Public domain', alignment: 'manual', description: '', source: '' });
const META: DataMeta = { version: '1', generated: '2026-10-23', translations: [tr('KJV'), tr('BSB')], books: [], credits: [] };
const LEX_INDEX = [
  ['G0026', 'ἀγάπη', 'agapē', 'love'],
  ['H7225', 'רֵאשִׁית', 'reshit', 'beginning'],
];

let caches: FakeCaches & CacheStorage;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('lex/index.json')) return new Response(JSON.stringify(LEX_INDEX));
  if (url.includes('/data/')) return new Response(JSON.stringify({ url }), { status: 200 });
  return new Response('', { status: 404 });
});

beforeEach(() => {
  localStorage.clear();
  caches = fakeCaches();
  vi.stubGlobal('caches', caches);
  vi.stubGlobal('fetch', fetchMock);
  configureData({ base: './data/', fetch: (u) => fetchMock(u) });
  resetDataCache();
  meta.value = META;
  passage.value = { tr: 'KJV', ref: { book: 'RUT', chapter: 1 } };
  updateReady.value = false;
  updateDismissed.value = false;
  online.value = true;
  offlineDismissed.value = false;
  savedBooks.value = [];
  lexiconSaved.value = false;
  download.value = null;
  swStatus.value = 'ready';
  toastMessage.value = null;
  fetchMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pwa: status cards', () => {
  it('shows nothing normally, the update card when a new version waits, and "Later" hides it', async () => {
    const { container } = render(h(PwaStatus, null));
    expect(container.textContent).toBe('');
    await act(() => {
      updateReady.value = true;
    });
    const aside = screen.getByRole('complementary', { name: 'App status' });
    expect(within(aside).getByText('A new version is ready')).toBeTruthy();
    expect(within(aside).getByRole('button', { name: 'Refresh' })).toBeTruthy();
    fireEvent.click(within(aside).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByText('A new version is ready')).toBeNull());
  });

  it('shows the offline banner while offline until dismissed', async () => {
    render(h(PwaStatus, null));
    await act(() => {
      online.value = false;
    });
    expect(screen.getByText(/Chapters you’ve read or saved still open/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss offline notice' }));
    await waitFor(() => expect(screen.queryByText(/still open/)).toBeNull());
  });
});

describe('pwa: data set changes', () => {
  it('records the first stamp, then clears the data caches and re-downloads saved books on a change', async () => {
    await (await caches.open(CACHE.chapters)).put('./data/text/KJV/JHN/1.json', new Response('old'));
    await (await caches.open('workbox-precache-v2-x')).put('index.html', new Response(''));
    expect(await syncDataStamp('1|2026-10-01')).toBe(false);
    expect(localStorage.getItem('rootword:dataStamp')).toBe('1|2026-10-01');
    expect(await syncDataStamp('1|2026-10-01')).toBe(false);

    savedBooks.value = [{ book: 'JON', trs: ['KJV'], chapters: 4, bytes: 1, at: '' }];
    expect(await syncDataStamp('1|2026-10-23')).toBe(true);
    expect(await caches.keys()).toContain('workbox-precache-v2-x');
    await waitFor(() => expect(download.value?.status).toBe('done'));
    const kept = await caches.peek(CACHE.chapters);
    expect(kept).not.toContain('./data/text/KJV/JHN/1.json');
    expect(kept).toContain('./data/text/KJV/JON/4.json');
    expect(download.value?.quiet).toBe(true);
  });
});

describe('Settings → Offline', () => {
  it('downloads the current book (with the dictionary), lists it, removes it', async () => {
    render(h(OfflineSection, null));
    expect(screen.getByText(/Rootword works offline on this device/)).toBeTruthy();
    const select = screen.getByLabelText('Book') as HTMLSelectElement;
    expect(select.value).toBe('RUT');
    fireEvent.click(screen.getByLabelText('All 2'));
    expect(screen.getByText(/4 chapters · 2 translations · about/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Download Ruth/ }));
    await waitFor(() => expect(screen.getByText(/Ruth is saved for offline reading/)).toBeTruthy());
    expect(screen.getByText(/with word definitions/)).toBeTruthy();
    const chapters = await caches.peek(CACHE.chapters);
    expect(chapters.filter((u) => /text\/(KJV|BSB)\/RUT\//.test(u))).toHaveLength(8);
    expect(await caches.peek(CACHE.study)).toEqual(['./data/lex/G/000.json', './data/lex/H/072.json', './data/lex/index.json']);
    expect(lexiconSaved.value).toBe(true);
    expect(JSON.parse(localStorage.getItem('rootword:offline')!)[0]).toMatchObject({ book: 'RUT', trs: ['KJV', 'BSB'], chapters: 4 });

    const list = screen.getByRole('list', { name: 'Saved on this device' });
    expect(within(list).getByText('Ruth')).toBeTruthy();
    expect(within(list).getByText('Word definitions')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove Ruth' }));
    await waitFor(() => expect(within(list).queryByText('Ruth')).toBeNull());
    expect((await caches.peek(CACHE.chapters)).some((u) => u.includes('/RUT/'))).toBe(false);
  });

  it('shows progress with a cancel button while downloading', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchMock.mockImplementationOnce(async () => {
      await gate;
      return new Response('{}');
    });
    render(h(OfflineSection, null));
    fireEvent.click(screen.getByRole('switch', { name: 'Word definitions too' }));
    fireEvent.click(screen.getByRole('button', { name: /Download Ruth/ }));
    const bar = await screen.findByRole('progressbar', { name: 'Saving Ruth' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Download Ruth/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    release();
    await waitFor(() => expect(screen.getByText(/Download cancelled/)).toBeTruthy());
  });

  it('clears offline data after confirmation, keeping the app shell', async () => {
    await (await caches.open(CACHE.chapters)).put('./data/text/KJV/RUT/1.json', new Response('{}'));
    await (await caches.open('workbox-precache-v2-x')).put('index.html', new Response(''));
    savedBooks.value = [{ book: 'RUT', trs: ['KJV'], chapters: 4, bytes: 1, at: '' }];
    render(h(OfflineSection, null));
    fireEvent.click(screen.getByRole('button', { name: 'Clear offline data' }));
    const confirm = screen.getByRole('group', { name: /Remove the saved books/ });
    expect(document.activeElement?.textContent).toBe('Keep');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Clear offline data' }));
    await waitFor(() => expect(toastMessage.value).toBe('Offline data cleared'));
    expect(await caches.keys()).toEqual(['workbox-precache-v2-x']);
    expect(savedBooks.value).toEqual([]);
  });

  it('cannot download while offline', async () => {
    online.value = false;
    render(h(OfflineSection, null));
    expect((screen.getByRole('button', { name: /Download Ruth/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Connect to the internet to download.')).toBeTruthy();
    expect(screen.getByText(/You’re offline right now/)).toBeTruthy();
  });
});
