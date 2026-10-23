/**
 * The settings sheet (src/components/settings/): every control writes the app state, the dialog
 * semantics hold, and the API.Bible connect flow works end to end against a mocked fetch
 * (API.Bible is unreachable from the sandbox; "test-key" is an obviously fake key).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({
  feedback: vi.fn(),
  primeFeedback: vi.fn(),
  testHaptic: vi.fn(() => true),
  playTestSound: vi.fn(() => true),
  hapticsSupport: vi.fn(() => 'vibrate' as const),
  soundSupported: vi.fn(() => true),
}));
vi.mock('../../src/lib/feedback', () => fb);

import { SettingsSheet, resolveSection } from '../../src/components/settings/SettingsSheet';
import { apiBibleConnection, initRemoteTranslations } from '../../src/app/remote';
import {
  closeSettings,
  DEFAULT_SETTINGS,
  fontScale,
  openSettings,
  passage,
  remoteTranslations,
  settings,
  settingsOpen,
  theme,
} from '../../src/app/state';
import { resetDataCache } from '../../src/lib/data';

const KEY = 'test-key';
const NIV_ID = '78a9f6124f344018-01';
const lang = { id: 'eng', name: 'English' };
const BIBLES = [
  { id: 'de4e12af7f28f599-02', abbreviation: 'engKJV', abbreviationLocal: 'KJV', name: 'King James (Authorised) Version', language: lang },
  { id: NIV_ID, abbreviation: 'NIV', abbreviationLocal: 'NIV', name: 'New International Version 2011', language: lang },
  { id: '01b29f4b342acc35-01', abbreviation: 'LSV', abbreviationLocal: 'LSV', name: 'Literal Standard Version', language: lang },
];
const COPYRIGHT = 'Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® All rights reserved worldwide.';

let apiMode: 'ok' | 'network' | 'noniv' = 'ok';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const key = new Headers(init?.headers).get('api-key');
  if (!url.startsWith('https://rest.api.bible/')) return json({}, 404);
  if (apiMode === 'network') throw new TypeError('Failed to fetch');
  if (key !== KEY) return json({ message: 'Invalid API key' }, 401);
  const path = new URL(url).pathname;
  if (path === '/v1/bibles') return json({ data: apiMode === 'noniv' ? BIBLES.filter((b) => b.id !== NIV_ID) : BIBLES });
  const id = /^\/v1\/bibles\/([^/]+)$/.exec(path)?.[1];
  const b = BIBLES.find((x) => x.id === id);
  return b ? json({ data: { ...b, copyright: COPYRIGHT } }) : json({}, 404);
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  apiMode = 'ok';
  resetDataCache();
  initRemoteTranslations();
  settings.value = { ...DEFAULT_SETTINGS };
  theme.value = 'system';
  fontScale.value = 1;
  passage.value = { tr: 'KJV', ref: { book: 'JHN', chapter: 3 } };
  Object.values(fb).forEach((f) => f.mockClear());
});

afterEach(() => {
  cleanup();
  closeSettings();
  vi.unstubAllGlobals();
});

const flush = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

async function openSheet(section: string | null = null) {
  render(<SettingsSheet />);
  await act(() => openSettings(section));
  await flush();
  return screen.getByRole('dialog', { name: 'Settings' });
}

describe('settings sheet', () => {
  it('renders nothing while closed and a labelled modal dialog when open', async () => {
    const { container } = render(<SettingsSheet />);
    expect(container.innerHTML).toBe('');
    await act(() => openSettings());
    const dlg = screen.getByRole('dialog', { name: 'Settings' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    for (const name of ['Appearance', 'Reading', 'Word study', 'Feedback', 'Accessibility', 'Translations', 'Offline', 'About & credits']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy();
    }
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getAllByRole('button')).toHaveLength(8);
  });

  it('resolves section aliases (openSettings("niv") → Translations)', () => {
    expect(resolveSection('niv')).toBe('translations');
    expect(resolveSection('Reading')).toBe('reading');
    expect(resolveSection('nope')).toBeNull();
    expect(resolveSection(null)).toBeNull();
  });

  it('Esc and the close button close it', async () => {
    const dlg = await openSheet();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(settingsOpen.value).toBe(false);
    await act(() => openSettings());
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(settingsOpen.value).toBe(false);
  });

  it('theme, text size, font, spacing and layout write the app state', async () => {
    await openSheet();
    const themes = within(screen.getByRole('group', { name: 'Theme' }));
    fireEvent.click(themes.getByRole('radio', { name: 'Dark' }));
    expect(theme.value).toBe('dark');
    fireEvent.click(themes.getByRole('radio', { name: 'Match system' }));
    expect(theme.value).toBe('system');

    const sizes = within(screen.getByRole('group', { name: 'Text size' })).getAllByRole('radio');
    expect(sizes.map((r) => r.parentElement!.textContent)).toEqual(['A90%', 'A100%', 'A115%', 'A130%', 'A160%', 'A200%']);
    fireEvent.click(screen.getByRole('radio', { name: '200%' }));
    expect(fontScale.value).toBe(2);

    fireEvent.click(screen.getByRole('radio', { name: /OpenDyslexic/ }));
    expect(settings.value.readingFont).toBe('opendyslexic');
    fireEvent.click(screen.getByRole('radio', { name: /Airy/ }));
    expect(settings.value.lineSpacing).toBe(1.4);
    fireEvent.click(screen.getByRole('radio', { name: 'Wider' }));
    expect(settings.value.letterSpacing).toBe(0.08);
    fireEvent.click(screen.getByRole('radio', { name: 'Verse per line' }));
    expect(settings.value.layout).toBe('verses');
  });

  it('switches are labelled, described, and write their setting', async () => {
    await openSheet();
    const cases: [string, keyof typeof DEFAULT_SETTINGS][] = [
      ['Justify text', 'justify'],
      ['Section headings', 'headings'],
      ['Words of Jesus in red', 'redLetter'],
      ['Open word cards on hover', 'hoverCards'],
      ['Mark related words', 'markRelated'],
      ['Show morphology codes', 'morphCodes'],
      ['Transliteration', 'ilTranslit'],
      ['Gloss', 'ilGloss'],
      ['Haptics', 'haptics'],
      ['Sound effects', 'sound'],
      ['High contrast', 'highContrast'],
      ['Swipe to change chapter', 'swipeChapters'],
    ];
    for (const [name, key] of cases) {
      const sw = screen.getByRole('switch', { name });
      expect(sw.getAttribute('aria-describedby')).toBeTruthy();
      const before = settings.value[key];
      fireEvent.click(sw);
      expect(settings.value[key]).toBe(!before);
    }
  });

  it('motion, listen speed and volume', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('radio', { name: 'Reduce' }));
    expect(settings.value.motion).toBe('reduce');
    fireEvent.click(screen.getByRole('radio', { name: '1.25×' }));
    expect(settings.value.listenRate).toBe(1.25);
    fireEvent.input(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '30' } });
    expect(settings.value.soundVolume).toBeCloseTo(0.3);
  });

  it('"Try it" fires a test haptic and a test sound even while they are off', async () => {
    settings.value = { ...settings.value, haptics: false, sound: false };
    await openSheet();
    const [hapticTry, soundTry] = screen.getAllByRole('button', { name: 'Try it' });
    fireEvent.click(hapticTry);
    expect(fb.testHaptic).toHaveBeenCalled();
    fireEvent.click(soundTry);
    expect(fb.playTestSound).toHaveBeenCalledWith('pin', 0.6);
    expect(screen.getByText(/Turn sound effects on/)).toBeTruthy();
  });

  it('the About link closes the sheet', async () => {
    await openSheet();
    const link = screen.getByRole('link', { name: /About Rootword & full credits/ });
    expect(link.getAttribute('href')).toBe('#/about');
    fireEvent.click(link);
    expect(settingsOpen.value).toBe(false);
  });

  it('renders the Offline section slot', async () => {
    await openSheet('offline');
    const sec = screen.getByRole('region', { name: 'Offline' });
    expect(sec.textContent).toMatch(/offline/i);
  });
});

describe('Translations: connect API.Bible (mocked)', () => {
  it('openSettings("niv") focuses the key field; show / hide toggles it', async () => {
    await openSheet('niv');
    const input = screen.getByLabelText('API.Bible key') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.type).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Show key' });
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide key' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('asks for a key when the field is empty', async () => {
    await openSheet('niv');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Paste your API\.Bible key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains an invalid key', async () => {
    await openSheet('niv');
    fireEvent.input(screen.getByLabelText('API.Bible key'), { target: { value: 'wrong-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/didn’t accept that key/));
    expect(screen.getByLabelText('API.Bible key').getAttribute('aria-invalid')).toBe('true');
    expect(localStorage.getItem('rootword:apibible')).toBeNull();
  });

  it('explains a network / CORS failure', async () => {
    apiMode = 'network';
    await openSheet('niv');
    fireEvent.input(screen.getByLabelText('API.Bible key'), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/browser couldn’t reach API\.Bible/));
  });

  it('says when the plan has no NIV', async () => {
    apiMode = 'noniv';
    await openSheet('niv');
    fireEvent.input(screen.getByLabelText('API.Bible key'), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(screen.getByText(/The NIV isn’t on your API\.Bible plan/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'check again' })).toBeTruthy();
  });

  it('connect → choose (NIV preselected, bundled KJV disabled) → add → connected → disconnect', async () => {
    await openSheet('niv');
    fireEvent.input(screen.getByLabelText('API.Bible key'), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const niv = (await screen.findByRole('checkbox', { name: /NIV New International Version/ })) as HTMLInputElement;
    expect(niv.checked).toBe(true);
    const kjv = screen.getByRole('checkbox', { name: /KJV King James/ }) as HTMLInputElement;
    expect(kjv.disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: /LSV/ }) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Add 1 Bible' }));
    await screen.findByText(/Connected to API\.Bible/);
    expect(JSON.parse(localStorage.getItem('rootword:apibible')!)).toMatchObject({ key: KEY, bibles: [{ id: NIV_ID, abbr: 'NIV' }] });
    expect(remoteTranslations.value.map((t) => t.id)).toEqual(['NIV']);
    const list = screen.getByRole('list', { name: 'Bibles from API.Bible' });
    expect(list.textContent).toMatch(/New International Version/);
    expect(list.textContent).toMatch(/via API\.Bible/);
    expect(list.textContent).toMatch(/Approximate/);
    expect(screen.getByRole('button', { name: 'Read John 3 in the NIV' })).toBeTruthy();
    // the key itself is never rendered
    expect(document.body.textContent).not.toContain(KEY);

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const confirm = screen.getByRole('group', { name: 'Confirm disconnect' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Disconnect' }));
    expect(localStorage.getItem('rootword:apibible')).toBeNull();
    expect(remoteTranslations.value).toEqual([]);
    expect(apiBibleConnection.value).toBeNull();
    expect(screen.getByLabelText('API.Bible key')).toBeTruthy();
  });

  it('remove one Bible keeps the key', async () => {
    localStorage.setItem('rootword:apibible', JSON.stringify({ key: KEY, bibles: [{ id: NIV_ID, abbr: 'NIV', name: 'New International Version', copyright: COPYRIGHT }] }));
    initRemoteTranslations();
    await openSheet('translations');
    expect(screen.getByRole('list', { name: 'Bibles from API.Bible' }).textContent).toMatch(/© Biblica, Inc\./);
    fireEvent.click(screen.getByRole('button', { name: 'Remove the NIV' }));
    expect(remoteTranslations.value).toEqual([]);
    expect(JSON.parse(localStorage.getItem('rootword:apibible')!)).toEqual({ key: KEY, bibles: [] });
    expect(screen.getByText('No Bibles added yet.')).toBeTruthy();
  });
});
