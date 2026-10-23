/**
 * Verse sheet → Compare translations (src/components/verse/CompareSection.tsx): the verse in every
 * translation with its alignment meter, read / compare links, missing verses, per-translation
 * errors with retry, and a remote (API.Bible) translation with its copyright line and FUMS report.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({ feedback: vi.fn(), primeFeedback: vi.fn() }));
vi.mock('../../src/lib/feedback', () => fb);
const fums = vi.hoisted(() => ({ reportFums: vi.fn() }));
vi.mock('../../src/lib/providers/apibible', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/providers/apibible')>();
  return { ...real, reportFums: fums.reportFums };
});

import { meta, registerRemoteTranslation, settingsOpen, unregisterRemoteTranslation, verseSheet } from '../../src/app/state';
import { resetCompareCache } from '../../src/components/compare/data';
import { CompareSection } from '../../src/components/verse/CompareSection';
import { configureData } from '../../src/lib/data';
import { toTextChapter } from '../../src/lib/providers/apibible';
import type { DataMeta, TextChapter, TranslationMeta } from '../../src/lib/types';

const tr = (id: string, name: string, alignment: TranslationMeta['alignment']): TranslationMeta => ({
  id,
  name,
  abbr: id,
  year: '1900',
  license: 'Public domain',
  alignment,
  description: '',
  source: '',
});

const META: DataMeta = {
  version: 'test',
  generated: '2026-01-01',
  translations: [tr('KJV', 'King James Version', 'strongs'), tr('BSB', 'Berean Standard Bible', 'manual'), tr('WEB', 'World English Bible', 'bridged')],
  books: [],
  credits: [],
};

const ch = (t: string, verses: [number, string][]): TextChapter => ({ tr: t, book: 'MAT', chapter: 17, verses: verses.map(([v, s]) => ({ v, t: [s] })) });

let FILES: Record<string, unknown> = {};
const fetchMock = async (url: string) => {
  const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
  const body = FILES[path];
  return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nope', { status: 404 });
};

beforeEach(() => {
  resetCompareCache();
  FILES = {
    'text/KJV/MAT/17.json': ch('KJV', [
      [20, 'And Jesus said unto them, Because of your unbelief.'],
      [21, 'Howbeit this kind goeth not out but by prayer and fasting.'],
    ]),
    'text/BSB/MAT/17.json': ch('BSB', [[20, '“Because you have so little faith,” He answered.']]),
  };
  configureData({ base: '/data/', fetch: fetchMock });
  meta.value = META;
  verseSheet.value = { key: 'KJV/MAT/17', verse: 21 };
  settingsOpen.value = false;
  fums.reportFums.mockClear();
});

afterEach(() => {
  cleanup();
  unregisterRemoteTranslation('NIV');
  meta.value = null;
});

const rows = (c: Element) => [...c.querySelectorAll('.cmpv__row')];

describe('CompareSection', () => {
  it('lists the verse in every translation with its meter and links', async () => {
    const { container } = render(<CompareSection book="MAT" chapter={17} verse={20} tr="BSB" />);
    const sec = container.querySelector('section')!;
    expect(sec.getAttribute('aria-labelledby')).toBe('vs-cmp-title');
    expect(container.querySelector('h3')!.textContent).toBe('Compare translations');
    expect(sec.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(container.querySelectorAll('.cmpv__txt').length).toBe(2));
    // picker order, KJV first; the translation on screen is marked
    expect(rows(container).map((r) => r.querySelector('.cmpv__abbr')!.textContent)).toEqual(['KJV', 'BSB', 'WEB']);
    const [kjv, bsb] = rows(container);
    expect(bsb.getAttribute('aria-current')).toBe('true');
    expect(bsb.querySelector('.cmpv__tag')!.textContent).toBe('Reading');
    expect(bsb.querySelector('a.cmpv__abbr')).toBeNull();
    expect(kjv.querySelector('.cmpv__txt')!.textContent).toBe('And Jesus said unto them, Because of your unbelief.');
    // alignment meters, in words
    expect(rows(container).map((r) => r.querySelector('.meter__label')!.textContent)).toEqual(['Strong’s-tagged', 'Hand-aligned', 'Approximate']);
    // read it there / compare the chapter with it
    const read = kjv.querySelector<HTMLAnchorElement>('a.cmpv__abbr')!;
    expect(read.getAttribute('href')).toBe('#/KJV/MAT/17/20');
    expect(read.getAttribute('aria-label')).toBe('KJV: read Matthew 17:20 in the King James Version');
    const cmp = kjv.querySelector<HTMLAnchorElement>('a.cmpv__cmp')!;
    expect(cmp.getAttribute('href')).toBe('#/compare/BSB,KJV/MAT/17/20');
    expect(cmp.getAttribute('aria-label')).toBe('Compare Matthew 17 in the BSB and KJV');
    // the whole chapter, with the usual partner
    const all = container.querySelector<HTMLAnchorElement>('a.cmpv__all')!;
    expect(all.getAttribute('href')).toBe('#/compare/BSB,KJV/MAT/17/20');
    expect(all.textContent).toContain('Compare chapter');
    fireEvent.click(all);
    expect(verseSheet.value).toBeNull();
  });

  it('says when a translation lacks the verse, and retries one that failed', async () => {
    const { container } = render(<CompareSection book="MAT" chapter={17} verse={21} tr="KJV" />);
    await waitFor(() => expect(container.querySelector('section')!.getAttribute('aria-busy')).toBeNull());
    const [kjv, bsb, web] = rows(container);
    expect(kjv.querySelector('.cmpv__txt')!.textContent).toContain('prayer and fasting');
    expect(bsb.querySelector('.cmpv__msg')!.textContent).toBe('Matthew 17:21 is not in the BSB.');
    expect(web.querySelector('.cmpv__msg')!.textContent).toBe('The WEB didn’t load. Try again');
    FILES['text/WEB/MAT/17.json'] = ch('WEB', [[21, 'But this kind doesn’t go out except by prayer and fasting.']]);
    fireEvent.click(web.querySelector('button')!);
    await waitFor(() => expect(rows(container)[2].querySelector('.cmpv__txt')?.textContent).toContain('doesn’t go out'));
  });

  it('offers the NIV until it is connected, then shows it with its copyright and reports the view', async () => {
    const { container, unmount } = render(<CompareSection book="MAT" chapter={17} verse={20} tr="KJV" />);
    await waitFor(() => expect(container.querySelectorAll('.cmpv__txt').length).toBe(2));
    const offer = container.querySelector<HTMLButtonElement>('.cmpv__more button')!;
    expect(offer.textContent).toBe('Add the NIV');
    fireEvent.click(offer);
    expect(settingsOpen.value).toBe(true);
    expect(verseSheet.value).toBeNull();
    unmount();

    const source = vi.fn(async () =>
      toTextChapter('NIV', {
        bibleId: 'test-bible',
        book: 'MAT',
        chapter: 17,
        reference: 'Matthew 17',
        verses: [{ v: 20, text: 'He replied, “Because you have so little faith.”' }],
        headings: [],
        paras: [],
        copyright: 'Copyright © 2011 by Biblica, Inc.',
        fumsToken: 'tok',
      }),
    );
    registerRemoteTranslation({ ...tr('NIV', 'New International Version', 'bridged'), license: '© Biblica, Inc. · via API.Bible', remote: true }, source);
    const again = render(<CompareSection book="MAT" chapter={17} verse={20} tr="KJV" />);
    await waitFor(() => expect(again.container.querySelectorAll('.cmpv__txt').length).toBe(3));
    const niv = rows(again.container)[3];
    expect(niv.querySelector('.cmpv__abbr')!.textContent).toBe('NIV');
    expect(niv.querySelector('.cmpv__txt')!.textContent).toBe('He replied, “Because you have so little faith.”');
    expect(niv.querySelector('.cmpv__copy')!.textContent).toBe('© Biblica, Inc. · Scripture text provided by API.Bible');
    expect(again.container.querySelector('.cmpv__more')).toBeNull();
    await waitFor(() => expect(fums.reportFums).toHaveBeenCalledTimes(1));
    expect(fums.reportFums.mock.calls[0][0]).toMatchObject({ fumsToken: 'tok' });
  });
});
