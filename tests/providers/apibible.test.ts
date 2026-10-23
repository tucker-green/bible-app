/**
 * API.Bible is not reachable from the build sandbox: these fixtures are modelled on the documented
 * response shapes (docs.api.bible: Bibles, Chapters, Content Output Formats, Fair Use).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  APIBIBLE_BASE_URL,
  ApiBibleError,
  apiBibleMeta,
  createApiBibleTextSource,
  createFumsIds,
  createKeyStore,
  findBible,
  fumsReportUrl,
  getChapterVerses,
  listBibles,
  parseChapterContent,
  parseChapterText,
  reportFums,
  toTextChapter,
} from '../../src/lib/providers/apibible';
import type { ApiBibleSummary, ApiNode, KeyValueStorage } from '../../src/lib/providers/apibible';

const KEY = 'test-key'; // obviously fake (CLAUDE.md: never real keys in tests)
const NIV_ID = '78a9f6124f344018-01';

const lang = { id: 'eng', name: 'English', nameLocal: 'English', script: 'Latin', scriptDirection: 'LTR' as const };
const BIBLES: ApiBibleSummary[] = [
  { id: 'de4e12af7f28f599-02', dblId: 'de4e12af7f28f599', abbreviation: 'engKJV', abbreviationLocal: 'KJV', name: 'King James (Authorised) Version', nameLocal: 'King James Version', language: lang },
  { id: '7142879509583d59-04', abbreviation: 'NIVUK', abbreviationLocal: 'NIVUK', name: 'New International Version (Anglicised) 2011', language: lang },
  { id: NIV_ID, dblId: '78a9f6124f344018', abbreviation: 'NIV', abbreviationLocal: 'NIV', name: 'New International Version 2011', nameLocal: 'New International Version 2011', description: 'Holy Bible, New International Version®, NIV®', language: lang, type: 'text', updatedAt: '2024-02-14T18:53:14.000Z' },
];

const COPYRIGHT =
  'The Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by Permission of Biblica, Inc.® All rights reserved worldwide.';

const t = (text: string, verseId: string): ApiNode => ({ type: 'text', text, attrs: { verseId, verseOrgIds: [verseId] } });
const verse = (n: string, book = 'JHN', ch = 3): ApiNode => ({
  type: 'tag',
  name: 'verse',
  attrs: { number: n, style: 'v', sid: `${book} ${ch}:${n}` },
  items: [{ type: 'text', text: n }],
});
const para = (style: string, items: ApiNode[]): ApiNode => ({ type: 'tag', name: 'para', attrs: { style }, items });

/** John 3:14–18, NIV-like: heading, notes, words of Jesus, a verse split over two paragraphs. */
const JHN3: ApiNode[] = [
  para('p', [
    verse('14'),
    t('Just as Moses lifted up the snake in the wilderness, so the Son of Man must be lifted up,', 'JHN.3.14'),
    { type: 'tag', name: 'note', attrs: { style: 'f', caller: '+' }, items: [{ type: 'tag', name: 'char', attrs: { style: 'ft' }, items: [{ type: 'text', text: 'Or lifted up on the cross' }] }] },
    t(' ', 'JHN.3.14'),
    verse('15'),
    t('that everyone who believes may have eternal life in him.” ', 'JHN.3.15'),
  ]),
  para('s1', [{ type: 'text', text: 'For God So Loved the World' }]),
  para('p', [
    verse('16'),
    { type: 'tag', name: 'char', attrs: { style: 'wj' }, items: [t('For God so loved the world that he gave his one and only Son,', 'JHN.3.16')] },
  ]),
  para('m', [t('that whoever believes in him shall not perish but have eternal life. ', 'JHN.3.16'), verse('17'), t('For God did not send his Son into the world to condemn the world, but to save the world through him. ', 'JHN.3.17')]),
  para('p', [verse('18'), t('Whoever believes in him is not condemned.', 'JHN.3.18')]),
];

/** Psalm 23:1–2 with an unnumbered title, poetry lines, the divine name (nd) and a stanza break. */
const PSA23: ApiNode[] = [
  para('d', [{ type: 'text', text: 'A psalm of David.', attrs: { verseId: 'PSA.23.1', verseOrgIds: ['PSA.23.0'] } }]),
  para('q1', [verse('1', 'PSA', 23), t('The ', 'PSA.23.1'), { type: 'tag', name: 'char', attrs: { style: 'nd' }, items: [t('Lord', 'PSA.23.1')] }, t(' is my shepherd, I lack nothing.', 'PSA.23.1')]),
  para('q2', [verse('2', 'PSA', 23), t('He makes me lie down in green pastures,', 'PSA.23.2')]),
  para('q2', [t('he leads me beside quiet waters,', 'PSA.23.2')]),
  para('b', []),
  para('q1', [verse('3', 'PSA', 23), t('he refreshes my soul.', 'PSA.23.3')]),
];

function chapterBody(content: ApiNode[] | string, meta: Record<string, string> = { fumsToken: 'tok-abc' }) {
  return {
    data: {
      id: 'JHN.3',
      bibleId: NIV_ID,
      number: '3',
      bookId: 'JHN',
      reference: 'John 3',
      copyright: ` ${COPYRIGHT} `,
      verseCount: 36,
      content,
      next: { id: 'JHN.4', number: '4', bookId: 'JHN' },
      previous: { id: 'JHN.2', number: '2', bookId: 'JHN' },
    },
    meta,
  };
}

function mockFetch(routes: (url: URL) => { status?: number; body: unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    expect((init?.headers as Record<string, string>)['api-key']).toBe(KEY);
    const r = routes(u);
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
}

describe('listBibles / findBible', () => {
  it('lists English Bibles with the api-key header', async () => {
    const f = mockFetch((u) => {
      expect(u.origin + u.pathname).toBe(`${APIBIBLE_BASE_URL}/bibles`);
      expect(u.searchParams.get('language')).toBe('eng');
      return { body: { data: BIBLES } };
    });
    const list = await listBibles(KEY, 'eng', { fetch: f });
    expect(list).toHaveLength(3);
    expect(findBible(list)?.id).toBe(NIV_ID);
    expect(findBible(list, 'KJV')?.id).toBe('de4e12af7f28f599-02'); // via abbreviationLocal
    expect(findBible(list.filter((b) => b.abbreviation !== 'NIV'))?.abbreviation).toBe('NIVUK');
    expect(findBible([], 'NIV')).toBeUndefined();
  });

  it('supports a custom base URL', async () => {
    const f = mockFetch((u) => {
      expect(u.href.startsWith('https://api.scripture.api.bible/v1/bibles')).toBe(true);
      return { body: { data: [] } };
    });
    await listBibles(KEY, 'eng', { fetch: f, baseUrl: 'https://api.scripture.api.bible/v1/' });
  });

  it('maps HTTP errors without leaking the key', async () => {
    for (const [status, kind] of [
      [401, 'auth'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [429, 'rate-limit'],
      [500, 'server'],
    ] as const) {
      const f = mockFetch(() => ({ status, body: { statusCode: status, error: 'Unauthorized', message: 'Invalid API key' } }));
      const err = await listBibles(KEY, 'eng', { fetch: f }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiBibleError);
      expect(err).toMatchObject({ kind, status });
      expect(String((err as Error).message)).not.toContain(KEY);
    }
    await expect(listBibles('', 'eng', { fetch: vi.fn() })).rejects.toMatchObject({ kind: 'auth' });
    const offline = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(listBibles(KEY, 'eng', { fetch: offline })).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('getChapterVerses', () => {
  it('requests JSON content with FUMS v3 and parses verses, headings and paragraphs', async () => {
    const f = mockFetch((u) => {
      expect(u.pathname).toBe(`/v1/bibles/${NIV_ID}/chapters/JHN.3`);
      expect(Object.fromEntries(u.searchParams)).toEqual({
        'content-type': 'json',
        'include-notes': 'false',
        'include-titles': 'true',
        'include-chapter-numbers': 'false',
        'include-verse-numbers': 'true',
        'include-verse-spans': 'false',
        'fums-version': '3',
      });
      return { body: chapterBody(JHN3) };
    });
    const c = await getChapterVerses(KEY, NIV_ID, 'JHN', 3, { fetch: f });
    expect(c.reference).toBe('John 3');
    expect(c.copyright).toBe(COPYRIGHT);
    expect(c.fumsToken).toBe('tok-abc');
    expect(c.verses.map((v) => v.v)).toEqual([14, 15, 16, 17, 18]);
    expect(c.verses[0].text).toBe('Just as Moses lifted up the snake in the wilderness, so the Son of Man must be lifted up,'); // note dropped
    expect(c.verses[2].text).toBe(
      'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
    ); // split across two paragraphs
    expect(c.headings).toEqual([[16, 'For God So Loved the World']]);
    expect(c.paras).toEqual([14, 16, 18]); // the excerpt's first paragraph starts at 14
  });

  it('handles Psalm titles, poetry lines, the divine name and stanza breaks', () => {
    const p = parseChapterContent(PSA23);
    expect(p.superscription).toBe('A psalm of David.');
    expect(p.verses).toEqual([
      { v: 1, text: 'The LORD is my shepherd, I lack nothing.' },
      { v: 2, text: 'He makes me lie down in green pastures, he leads me beside quiet waters,' },
      { v: 3, text: 'he refreshes my soul.' },
    ]);
    expect(p.paras).toEqual([3]);
  });

  it('falls back to verse markers when text nodes carry no verseId', () => {
    const p = parseChapterContent([para('p', [verse('1'), { type: 'text', text: 'One. ' }, verse('2-3'), { type: 'text', text: 'Two and three.' }])]);
    expect(p.verses).toEqual([
      { v: 1, text: 'One.' },
      { v: 2, text: 'Two and three.' },
    ]);
  });

  it('reads legacy FUMS ids', async () => {
    const f = mockFetch(() => ({
      body: chapterBody(JHN3, {
        fums: "<script>var _BAPI=_BAPI||{};if(typeof(_BAPI.t)!='undefined'){ _BAPI.t('legacy-id-1'); }</script>",
        fumsJsInclude: 'cdn.scripture.api.bible/fums/fumsv2.min.js',
      }),
    }));
    const c = await getChapterVerses(KEY, NIV_ID, 'JHN', 3, { fetch: f });
    expect(c.fumsToken).toBeUndefined();
    expect(c.fumsId).toBe('legacy-id-1');
  });

  it('accepts text and HTML content as a fallback', async () => {
    const text = '     [14] Just as Moses lifted up the snake, [15] that everyone who believes may have eternal life in him. ';
    const f1 = mockFetch(() => ({ body: chapterBody(text) }));
    expect((await getChapterVerses(KEY, NIV_ID, 'JHN', 3, { fetch: f1 })).verses).toEqual([
      { v: 14, text: 'Just as Moses lifted up the snake,' },
      { v: 15, text: 'that everyone who believes may have eternal life in him.' },
    ]);
    const html =
      '<p class="p"><span data-number="14" class="v">14</span>Just as Moses lifted up the snake,<span data-number="15" class="v">15</span>that everyone who believes may have eternal life&nbsp;in him.</p>';
    const f2 = mockFetch(() => ({ body: chapterBody(html) }));
    expect((await getChapterVerses(KEY, NIV_ID, 'JHN', 3, { fetch: f2 })).verses.map((v) => v.text)).toEqual([
      'Just as Moses lifted up the snake,',
      'that everyone who believes may have eternal life in him.',
    ]);
  });

  it('rejects unexpected responses', async () => {
    const f = mockFetch(() => ({ body: { data: { id: 'JHN.3' } } }));
    await expect(getChapterVerses(KEY, NIV_ID, 'JHN', 3, { fetch: f })).rejects.toMatchObject({ kind: 'parse' });
    const g = mockFetch(() => ({ body: 'not json' }));
    await expect(getChapterVerses(KEY, NIV_ID, 'JHN', 3, { fetch: g })).rejects.toMatchObject({ kind: 'parse' });
  });

  it('parses plain text markers', () => {
    expect(parseChapterText('A title [1] In the beginning. [2] Now   the earth.')).toEqual([
      { v: 1, text: 'In the beginning.' },
      { v: 2, text: 'Now the earth.' },
    ]);
  });
});

describe('TextChapter adapter', () => {
  it('converts verses and keeps copyright / FUMS on the side', async () => {
    const f = mockFetch(() => ({ body: chapterBody(JHN3) }));
    const load = createApiBibleTextSource(KEY, NIV_ID, 'NIV', { fetch: f });
    const ch = await load('JHN', 3);
    expect(ch).toMatchObject({ tr: 'NIV', book: 'JHN', chapter: 3, headings: [[16, 'For God So Loved the World']], paras: [14, 16, 18] });
    expect(ch.verses[0]).toEqual({ v: 14, t: ['Just as Moses lifted up the snake in the wilderness, so the Son of Man must be lifted up,'] });
    expect(apiBibleMeta(ch)).toEqual({ bibleId: NIV_ID, copyright: COPYRIGHT, fumsToken: 'tok-abc' });
    const psa = toTextChapter('NIV', { bibleId: NIV_ID, book: 'PSA', chapter: 23, reference: 'Psalm 23', ...parseChapterContent(PSA23), copyright: 'c' });
    expect(psa.superscription).toEqual(['A psalm of David.']);
    expect(apiBibleMeta({ tr: 'X', book: 'GEN', chapter: 1, verses: [] })).toBeUndefined();
  });
});

describe('FUMS', () => {
  const ids = { deviceId: 'dev-1', sessionId: 'sess-1' };
  it('builds v3 report URLs', () => {
    expect(fumsReportUrl(['a', 'b'], ids)).toBe('https://fums.api.bible/f3?t=a&t=b&dId=dev-1&sId=sess-1');
    expect(fumsReportUrl(['a'], { ...ids, userId: 'u' })).toBe('https://fums.api.bible/f3?t=a&dId=dev-1&sId=sess-1&uId=u');
  });
  it('reports a token through the sender (or an image pixel in the browser)', () => {
    const send = vi.fn();
    reportFums({ fumsToken: 'tok' }, ids, { send });
    expect(send).toHaveBeenCalledWith('https://fums.api.bible/f3?t=tok&dId=dev-1&sId=sess-1');
    reportFums(undefined, ids, { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(() => reportFums({ fumsToken: 'tok' }, ids)).not.toThrow(); // jsdom Image
  });
  it('loads the legacy script for legacy ids', () => {
    reportFums({ fumsId: 'legacy' }, ids);
    expect(document.head.querySelector('script[src*="fumsv2"]')).not.toBeNull();
  });
  it('persists the device id only in the storage it is given', () => {
    const store = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
    const a = createFumsIds(storage);
    const b = createFumsIds(storage);
    expect(a.deviceId).toBe(b.deviceId);
    expect(a.sessionId).not.toBe(b.sessionId); // no session storage given
    const c = createFumsIds();
    expect(c.deviceId).not.toBe(a.deviceId);
  });
});

describe('createKeyStore', () => {
  it('keeps the key in memory or in the storage the caller chose', () => {
    const store = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
    const mem = createKeyStore(null);
    mem.set(' abc ');
    expect(mem.get()).toBe('abc');
    const persisted = createKeyStore(storage);
    persisted.set('xyz');
    expect(store.get('apibible.key')).toBe('xyz');
    expect(createKeyStore(storage).get()).toBe('xyz');
    persisted.set(null);
    expect(store.has('apibible.key')).toBe(false);
    expect(persisted.get()).toBeNull();
  });
});
