/**
 * src/app/remote.ts — runtime translations through the reader's own API.Bible key.
 *
 * API.Bible is not reachable from the build sandbox: every request goes to a mocked fetch, with
 * response shapes modelled on docs.api.bible (see tests/providers/apibible.test.ts). The key is the
 * obviously fake "test-key" (CLAUDE.md: never real keys in tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APIBIBLE_STORAGE_KEY,
  apiBibleConnection,
  bibleChoices,
  compactCopyright,
  connectApiBible,
  disconnectApiBible,
  displayName,
  explainApiBibleError,
  initRemoteTranslations,
  readSavedConnection,
  remoteMeta,
  remoteProblem,
  removeApiBible,
  saveApiBibles,
  translationIdFor,
  yearOf,
} from '../src/app/remote';
import { passage, remoteTranslations, toastMessage, translations } from '../src/app/state';
import { ALIGN_TABLE_PATH } from '../src/lib/align';
import { hasTextSource, loadText, resetDataCache } from '../src/lib/data';
import { ApiBibleError, apiBibleMeta } from '../src/lib/providers/apibible';
import type { ApiBibleSummary, ApiNode } from '../src/lib/providers/apibible';
import type { OrigChapter, OrigWord, TextChapter, WordToken } from '../src/lib/types';

const KEY = 'test-key';
const NIV_ID = '78a9f6124f344018-01';
const STORAGE = `rootword:${APIBIBLE_STORAGE_KEY}`;
const COPYRIGHT =
  'The Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by Permission of Biblica, Inc.® All rights reserved worldwide.';

const lang = { id: 'eng', name: 'English' };
const BIBLES: ApiBibleSummary[] = [
  { id: 'de4e12af7f28f599-02', abbreviation: 'engKJV', abbreviationLocal: 'KJV', name: 'King James (Authorised) Version', nameLocal: 'King James Version', language: lang },
  { id: '7142879509583d59-04', abbreviation: 'NIVUK', abbreviationLocal: 'NIVUK', name: 'New International Version (Anglicised) 2011', language: lang },
  { id: NIV_ID, abbreviation: 'NIV', abbreviationLocal: 'NIV', name: 'New International Version 2011', nameLocal: 'New International Version 2011', language: lang },
  { id: '9879dbb7cfe39e4d-04', abbreviation: 'engWEBP', name: 'World English Bible', language: lang },
  { id: '01b29f4b342acc35-01', abbreviation: 'LSV', abbreviationLocal: 'LSV', name: 'Literal Standard Version', language: lang },
];

/* ---- data fixtures (John 3:16, hand-made) --------------------------------- */

function ow(text: string, strongs: string, morph: string, gloss: string, verse: number, group: number): OrigWord {
  return [text, strongs, text, morph, gloss, verse, '', group, '', ''];
}
const ORIG: OrigChapter = {
  book: 'JHN',
  chapter: 3,
  lang: 'grc',
  edition: 'SBLGNT',
  words: [
    ow('Οὕτως', 'G3779', 'ADV', 'so', 16, 0),
    ow('γὰρ', 'G1063', 'CONJ', 'for', 16, 1),
    ow('ἠγάπησεν', 'G0025', 'V-AAI-3S', 'loved', 16, 2),
    ow('ὁ', 'G3588', 'T-NSM', 'the', 16, 3),
    ow('θεὸς', 'G2316', 'N-NSM', 'God', 16, 4),
    ow('τὸν', 'G3588', 'T-ASM', 'the', 16, 5),
    ow('κόσμον', 'G2889', 'N-ASM', 'world', 16, 6),
  ],
};
const BSB: TextChapter = {
  tr: 'BSB',
  book: 'JHN',
  chapter: 3,
  verses: [{ v: 16, t: [['For', [1]], ' ', ['God', [4]], ' ', ['so', [0]], ' ', ['loved', [2]], ' ', ['the', [5]], ' ', ['world', [6]], '.'] }],
};
const t = (text: string, verseId: string): ApiNode => ({ type: 'text', text, attrs: { verseId } });
const CONTENT: ApiNode[] = [
  { type: 'tag', name: 'para', attrs: { style: 's1' }, items: [{ type: 'text', text: 'For God So Loved the World' }] },
  {
    type: 'tag',
    name: 'para',
    attrs: { style: 'p' },
    items: [
      { type: 'tag', name: 'verse', attrs: { number: '16', style: 'v' }, items: [{ type: 'text', text: '16' }] },
      t('For God so loved the world that he gave his one and only Son.', 'JHN.3.16'),
    ],
  },
];

/* ---- mocked fetch ------------------------------------------------------------ */

type Mode = { status?: number; network?: boolean; chapterStatus?: number; bibleStatus?: Record<string, number> };
let mode: Mode = {};
const calls: { url: string; key: string | null }[] = [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  calls.push({ url, key: headers.get('api-key') });
  if (url.startsWith('https://rest.api.bible/v1/')) {
    if (mode.network) throw new TypeError('Failed to fetch');
    if (headers.get('api-key') !== KEY) return json({ statusCode: 401, message: 'Invalid API key' }, 401);
    if (mode.status) return json({ message: 'nope' }, mode.status);
    const u = new URL(url);
    if (u.pathname === '/v1/bibles') return json({ data: BIBLES });
    const ch = /^\/v1\/bibles\/([^/]+)\/chapters\/([A-Z0-9]+)\.(\d+)$/.exec(u.pathname);
    if (ch) {
      if (mode.chapterStatus) return json({ message: 'Not found' }, mode.chapterStatus);
      return json({ data: { id: `${ch[2]}.${ch[3]}`, bibleId: ch[1], number: ch[3], bookId: ch[2], reference: 'John 3', copyright: COPYRIGHT, content: CONTENT }, meta: { fumsToken: 'tok-abc' } });
    }
    const b = /^\/v1\/bibles\/([^/]+)$/.exec(u.pathname);
    if (b) {
      const st = mode.bibleStatus?.[b[1]];
      if (st) return json({ message: 'Forbidden' }, st);
      const bible = BIBLES.find((x) => x.id === b[1]);
      return bible ? json({ data: { ...bible, copyright: b[1] === NIV_ID ? COPYRIGHT : 'Public Domain' } }) : json({}, 404);
    }
    return json({}, 404);
  }
  if (url.includes('text/BSB/JHN/3.json')) return json(BSB);
  if (url.includes('orig/JHN/3.json')) return json(ORIG);
  if (url.includes(ALIGN_TABLE_PATH)) return json({ v: 1, g: {}, h: {} });
  return json({}, 404);
});

const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  mode = {};
  calls.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  resetDataCache();
  initRemoteTranslations(); // reset to "not connected"
  remoteProblem.value = null;
  passage.value = { tr: 'KJV', ref: { book: 'JHN', chapter: 3 } };
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) consoleSpies.push(vi.spyOn(console, m));
});

afterEach(() => {
  // The key must never be logged.
  for (const s of consoleSpies) for (const args of s.mock.calls) expect(JSON.stringify(args)).not.toContain(KEY);
  consoleSpies.splice(0).forEach((s) => s.mockRestore());
  vi.unstubAllGlobals();
  window.location.hash = '';
});

/** Every localStorage value other than rootword:apibible must not contain the key. */
function keyOnlyInItsPlace(): void {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k !== STORAGE) expect(localStorage.getItem(k) ?? '').not.toContain(KEY);
  }
}

async function connectNiv() {
  const choices = await connectApiBible(KEY);
  const niv = choices.filter((c) => c.checked);
  return saveApiBibles(KEY, niv);
}

/* ------------------------------------------------------------------------ */

describe('pure helpers', () => {
  it('derives translation ids, years and names from API.Bible summaries', () => {
    expect(translationIdFor(BIBLES[2])).toBe('NIV');
    expect(translationIdFor(BIBLES[0])).toBe('KJV');
    expect(translationIdFor({ abbreviation: 'engWEBP' })).toBe('WEBP');
    expect(translationIdFor({ abbreviation: 'n.i.v.' })).toBe('NIV');
    expect(yearOf(BIBLES[2])).toBe('2011');
    expect(yearOf(BIBLES[4])).toBe('');
    expect(displayName(BIBLES[2])).toBe('New International Version');
    expect(displayName(BIBLES[1])).toBe('New International Version (Anglicised)');
  });

  it('shortens copyright statements for the picker', () => {
    expect(compactCopyright(COPYRIGHT)).toBe('© Biblica, Inc.');
    expect(compactCopyright('Scripture quotations are from the ESV® Bible, copyright © 2001 by Crossway, a publishing ministry of Good News Publishers.')).toBe('© Crossway');
    expect(compactCopyright('Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission.')).toBe('© Tyndale House Foundation');
    expect(compactCopyright('Public Domain')).toBe('Public Domain');
    expect(compactCopyright('')).toBe('');
    expect(compactCopyright('x'.repeat(200))).toBe('Copyrighted text');
  });

  it('lists the NIV first and preselected, never the Anglicised one, and marks bundled translations', () => {
    const list = bibleChoices(BIBLES, ['KJV', 'BSB', 'WEB', 'ASV', 'YLT']);
    expect(list[0].tr).toBe('NIV');
    expect(list[0].checked).toBe(true);
    expect(list[0].isNiv).toBe(true);
    expect(list.filter((c) => c.checked).map((c) => c.tr)).toEqual(['NIV']);
    expect(list.find((c) => c.tr === 'KJV')?.bundled).toBe(true);
    expect(list.find((c) => c.tr === 'NIVUK')?.checked).toBe(false);
    // ids stay unique
    const dup = bibleChoices([...BIBLES, { ...BIBLES[4], id: 'other-lsv' }], ['KJV']);
    expect(dup.filter((c) => c.tr.startsWith('LSV')).map((c) => c.tr)).toEqual(['LSV', 'LSV2']);
  });

  it('keeps already-added Bibles checked when the list is shown again', () => {
    const list = bibleChoices(BIBLES, ['KJV'], [{ id: '01b29f4b342acc35-01', abbr: 'LSV', name: 'Literal Standard Version' }]);
    expect(list.filter((c) => c.checked).map((c) => c.tr)).toEqual(['LSV']); // NIV not re-checked once the reader chose
    expect(list.find((c) => c.tr === 'LSV')?.added).toBe(true);
  });

  it('registers remote translations as approximate, via API.Bible, with the copyright', () => {
    const m = remoteMeta({ id: NIV_ID, abbr: 'NIV', name: 'New International Version', year: '2011', copyright: COPYRIGHT });
    expect(m).toMatchObject({ id: 'NIV', abbr: 'NIV', name: 'New International Version', year: '2011', alignment: 'bridged', remote: true });
    expect(m.license).toBe('© Biblica, Inc. · via API.Bible');
    expect(m.description).toContain(COPYRIGHT);
  });

  it('explains failures in plain English', () => {
    expect(explainApiBibleError(new ApiBibleError('x', 'auth', 401))).toMatch(/didn’t accept that key/);
    expect(explainApiBibleError(new ApiBibleError('x', 'network'))).toMatch(/browser couldn’t reach API\.Bible/);
    expect(explainApiBibleError(new ApiBibleError('x', 'not-found', 404), { what: 'John 3', tr: 'the NIV' })).toBe('API.Bible has no John 3 in the NIV.');
    expect(explainApiBibleError(new ApiBibleError('x', 'forbidden', 403), { tr: 'the NIV' })).toMatch(/isn’t allowed to read the NIV/);
  });
});

describe('connect, save, read, disconnect (mocked API.Bible)', () => {
  it('lists the English Bibles on the plan with the reader’s key', async () => {
    const choices = await connectApiBible(`  ${KEY}  `);
    expect(calls[0].url).toBe('https://rest.api.bible/v1/bibles?language=eng');
    expect(calls[0].key).toBe(KEY);
    expect(choices.map((c) => c.tr)).toContain('NIV');
  });

  it('saves {key, bibles} only in localStorage "rootword:apibible" and registers the NIV', async () => {
    const r = await connectNiv();
    expect(r.added.map((b) => b.abbr)).toEqual(['NIV']);
    expect(JSON.parse(localStorage.getItem(STORAGE)!)).toEqual({
      key: KEY,
      bibles: [{ id: NIV_ID, abbr: 'NIV', name: 'New International Version', copyright: COPYRIGHT, year: '2011' }],
    });
    keyOnlyInItsPlace();
    const niv = translations.value.find((x) => x.id === 'NIV');
    expect(niv).toMatchObject({ alignment: 'bridged', remote: true, license: '© Biblica, Inc. · via API.Bible' });
    expect(hasTextSource('NIV')).toBe(true);
    expect(apiBibleConnection.value?.bibles.map((b) => b.abbr)).toEqual(['NIV']);
  });

  it('loads chapters through API.Bible, bridged to the Greek, keeping copyright + FUMS metadata', async () => {
    await connectNiv();
    const ch = await loadText('NIV', 'JHN', 3);
    expect(calls.some((c) => c.url.startsWith(`https://rest.api.bible/v1/bibles/${NIV_ID}/chapters/JHN.3?`) && c.key === KEY)).toBe(true);
    expect(ch.tr).toBe('NIV');
    expect(ch.headings).toEqual([[16, 'For God So Loved the World']]);
    const words = ch.verses[0].t.filter((x): x is WordToken => typeof x !== 'string');
    expect(words.find((w) => w[0] === 'God')?.[1]).toEqual([4]);
    expect(words.find((w) => w[0] === 'world')?.[1]).toEqual([6]);
    // the reader finds the copyright line and FUMS token on the chapter object it receives
    expect(apiBibleMeta(ch)).toEqual({ bibleId: NIV_ID, copyright: COPYRIGHT, fumsToken: 'tok-abc' });
  });

  it('still reads (without links) when the original-language data is missing', async () => {
    await connectNiv();
    const impl = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => (String(input).includes('orig/JHN/3.json') ? json({}, 404) : impl(input, init)));
    const ch = await loadText('NIV', 'JHN', 3);
    expect(ch.verses[0].t).toEqual(['For God so loved the world that he gave his one and only Son.']);
    expect(apiBibleMeta(ch)?.copyright).toBe(COPYRIGHT);
    fetchMock.mockImplementation(impl);
  });

  it('re-registers the saved Bibles synchronously at startup', () => {
    localStorage.setItem(STORAGE, JSON.stringify({ key: KEY, bibles: [{ id: NIV_ID, abbr: 'NIV', name: 'New International Version' }] }));
    initRemoteTranslations();
    expect(remoteTranslations.value.map((x) => x.id)).toEqual(['NIV']);
    expect(hasTextSource('NIV')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled(); // no network at startup
  });

  it('ignores malformed saved data', () => {
    localStorage.setItem(STORAGE, JSON.stringify({ key: '', bibles: [{ id: NIV_ID, abbr: 'NIV', name: 'x' }] }));
    expect(readSavedConnection()).toBeNull();
    localStorage.setItem(STORAGE, '{not json');
    initRemoteTranslations();
    expect(remoteTranslations.value).toEqual([]);
    localStorage.setItem(STORAGE, JSON.stringify({ key: KEY, bibles: [{ id: NIV_ID }, { id: 'x', abbr: 'N I V!', name: 'Odd' }] }));
    expect(readSavedConnection()?.bibles.map((b) => b.abbr)).toEqual(['NIV']);
  });

  it('reports an invalid key (401)', async () => {
    await expect(connectApiBible('wrong-key')).rejects.toMatchObject({ kind: 'auth', status: 401 });
    expect(localStorage.getItem(STORAGE)).toBeNull();
  });

  it('reports a network / CORS failure', async () => {
    mode.network = true;
    const err = await connectApiBible(KEY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiBibleError);
    expect((err as ApiBibleError).kind).toBe('network');
    expect(explainApiBibleError(err)).toMatch(/couldn’t reach API\.Bible/);
  });

  it('skips a Bible the plan does not include (403 on GET /bibles/{id})', async () => {
    mode.bibleStatus = { [NIV_ID]: 403 };
    const r = await connectNiv();
    expect(r.added).toEqual([]);
    expect(r.skipped[0].message).toMatch(/isn’t allowed to read the NIV/);
    expect(JSON.parse(localStorage.getItem(STORAGE)!).bibles).toEqual([]);
    expect(remoteTranslations.value).toEqual([]);
  });

  it('a missing chapter rejects, is remembered for Settings and toasted when it is on screen', async () => {
    await connectNiv();
    mode.chapterStatus = 404;
    passage.value = { tr: 'NIV', ref: { book: 'JHN', chapter: 3 } };
    await expect(loadText('NIV', 'JHN', 3)).rejects.toMatchObject({ kind: 'not-found' });
    expect(remoteProblem.value).toMatchObject({ tr: 'NIV', book: 'JHN', chapter: 3, message: 'API.Bible has no John 3 in the NIV.' });
    expect(toastMessage.value).toBe('API.Bible has no John 3 in the NIV.');
  });

  it('remove and disconnect drop the translations, the key, and fall back to the KJV', async () => {
    await connectNiv();
    passage.value = { tr: 'NIV', ref: { book: 'JHN', chapter: 3 } };
    removeApiBible('NIV');
    expect(remoteTranslations.value).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE)!)).toEqual({ key: KEY, bibles: [] });
    expect(window.location.hash).toBe('#/KJV/JHN/3');

    await connectNiv();
    passage.value = { tr: 'NIV', ref: { book: 'JHN', chapter: 3 } };
    window.location.hash = '#/NIV/JHN/3';
    disconnectApiBible();
    expect(localStorage.getItem(STORAGE)).toBeNull();
    expect(apiBibleConnection.value).toBeNull();
    expect(remoteTranslations.value).toEqual([]);
    expect(hasTextSource('NIV')).toBe(false);
    expect(window.location.hash).toBe('#/KJV/JHN/3');
  });
});
