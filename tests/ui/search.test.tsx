/**
 * The search panel with a mocked search client (src/lib/search/client.ts), a mocked name index and
 * a fake data fetch for lexicon entries / verse previews.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit, SearchOptions, SearchResponse } from '../../src/lib/search/client';
import type { NameIndex } from '../../src/lib/types';

/* ---- mocks ------------------------------------------------------------------ */

const client = vi.hoisted(() => ({
  search: vi.fn(),
  highlightLinked: vi.fn(),
  warmSearch: vi.fn(),
}));
vi.mock('../../src/lib/search/client', () => ({
  search: client.search,
  highlightLinked: client.highlightLinked,
  warmSearch: client.warmSearch,
  isAbortError: (e: unknown) => e instanceof Error && e.name === 'AbortError',
}));

const NAME_INDEX: NameIndex = [
  ['p0057', 'Abraham', 'person', 'Patriarch, chosen by God to father His people', 275],
  ['p0058', 'Abram', 'person', 'Earlier name of Abraham', 61],
  ['l0541', 'Jerusalem', 'place', 'The capital of Israel', 888],
  ['p1613', 'John', 'person', 'The Baptist', 89],
];
vi.mock('../../src/lib/names', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/names')>();
  return { ...real, loadNameIndex: vi.fn(async () => NAME_INDEX) };
});

const fb = vi.hoisted(() => ({ feedback: vi.fn() }));
vi.mock('../../src/lib/feedback', () => ({ feedback: fb.feedback, primeFeedback: vi.fn() }));

import { SEARCH_LISTBOX_ID, searchCombo } from '../../src/components/search/combobox';
import { SearchPanel } from '../../src/components/search/SearchPanel';
import {
  closeSearch,
  openSearch,
  passage,
  registerRemoteTranslation,
  route,
  SEARCH_INPUT_ID,
  searchKeys,
  searchOpen,
  searchQuery,
  unregisterRemoteTranslation,
} from '../../src/app/state';
import { configureData, resetDataCache } from '../../src/lib/data';

/* ---- fake corpus ------------------------------------------------------------ */

const BOOK_NUM: Record<string, number> = { GEN: 1, PSA: 19, MAT: 40, JHN: 43, ROM: 45, '1JN': 62 };

function hit(book: string, chapter: number, verse: number, text: string, word?: string): SearchHit {
  const at = word ? text.indexOf(word) : -1;
  return { bookNum: BOOK_NUM[book], book, chapter, verse, text, highlights: at >= 0 ? [[at, at + word!.length]] : [] };
}

// 61 verses with "love": 3 in Genesis, 50 in Psalms, 4 in John, 4 in 1 John.
const LOVE: SearchHit[] = [
  hit('GEN', 27, 4, 'And make me savoury meat, such as I love, and bring it to me', 'love'),
  hit('GEN', 29, 20, 'for the love he had to her.', 'love'),
  hit('GEN', 29, 32, 'now therefore my husband will love me.', 'love'),
  ...Array.from({ length: 50 }, (_, i) => hit('PSA', 5 + i, 1, `Psalm verse ${i + 1}: I love the LORD <b>because</b>`, 'love')),
  hit('JHN', 3, 16, 'For God so loved the world', 'loved'),
  hit('JHN', 13, 34, 'That ye love one another', 'love'),
  hit('JHN', 14, 15, 'If ye love me, keep my commandments.', 'love'),
  hit('JHN', 15, 13, 'Greater love hath no man than this', 'love'),
  hit('1JN', 4, 8, 'for God is love.', 'love'),
  hit('1JN', 4, 16, 'God is love', 'love'),
  hit('1JN', 4, 19, 'We love him, because he first loved us.', 'love'),
  hit('1JN', 5, 3, 'For this is the love of God', 'love'),
];
const LOGOS: SearchHit[] = [
  { ...hit('MAT', 5, 37, 'But let your communication be, Yea, yea'), highlights: [] },
  { ...hit('JHN', 1, 1, 'In the beginning was the Word'), highlights: [] },
];
const ABRAHAM: SearchHit[] = [hit('GEN', 17, 5, 'but thy name shall be Abraham', 'Abraham')];

interface Call {
  query: string;
  opts: SearchOptions;
  signal?: AbortSignal;
}
let calls: Call[] = [];
let failNext = false;

function respond(query: string, opts: SearchOptions): SearchResponse {
  let all: SearchHit[] = [];
  let interpreted = `“${query.toLowerCase()}”`;
  let strongs: string[] = [];
  let suggestions: SearchResponse['suggestions'] = [];
  if (query === 'love') {
    all = LOVE;
    suggestions = [{ query: 'love~', label: 'Include other forms: loved, loves' }];
  } else if (query === 'G3056' || query === 'λόγος') {
    all = LOGOS;
    strongs = ['G3056'];
    interpreted = query === 'G3056' ? 'Strong’s G3056 λόγος (logos, “word”)' : 'Greek λόγος (G3056, logos, “word”)';
  } else if (query === 'Abraham') {
    all = ABRAHAM;
  } else if (query === 'xyzzy') {
    suggestions = [{ query: 'xyz', label: 'Did you mean “xyz”?' }];
  }
  const byBook: Record<number, number> = {};
  for (const h of all) byBook[h.bookNum] = (byBook[h.bookNum] ?? 0) + 1;
  const bookNum = typeof opts.book === 'number' ? opts.book : undefined;
  const filtered = all.filter(
    (h) => (!opts.testament || (opts.testament === 'OT' ? h.bookNum <= 39 : h.bookNum >= 40)) && (!bookNum || h.bookNum === bookNum),
  );
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;
  return {
    query,
    tr: opts.tr,
    total: filtered.length,
    totalAll: all.length,
    results: filtered.slice(offset, offset + limit),
    byBook,
    interpreted,
    terms: [],
    strongs,
    suggestions,
    errors: [],
    elapsedMs: 1,
  };
}

function fakeSearch(query: string, opts: SearchOptions, init: { signal?: AbortSignal } = {}): Promise<SearchResponse> {
  calls.push({ query, opts, signal: init.signal });
  return new Promise((resolve, reject) => {
    const abort = () => {
      const e = new Error('Search superseded');
      e.name = 'AbortError';
      reject(e);
    };
    if (init.signal?.aborted) return abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    setTimeout(() => {
      if (failNext) {
        failNext = false;
        reject(new Error('Failed to fetch'));
        return;
      }
      resolve(respond(query, opts));
    }, 5);
  });
}

/* ---- data fetch (lexicon entries, verse previews) -------------------------- */

const FILES: Record<string, unknown> = {
  'lex/G/030.json': {
    G3056: {
      id: 'G3056',
      lemma: 'λόγος',
      translit: 'logos',
      pos: 'Noun, masculine',
      gloss: 'word',
      def: '',
      verses: 318,
      renderings: { KJV: [['word', 168], ['words', 46], ['saying', 34]] },
    },
  },
  'text/KJV/ROM/8.json': {
    tr: 'KJV',
    book: 'ROM',
    chapter: 8,
    verses: [{ v: 28, t: ['And we know that all things work together for good to them that love God.'] }],
  },
};

/* ---- harness ---------------------------------------------------------------- */

/** A stand-in for the header's field: same id, keys go to searchKeys.handler first, combobox attrs. */
function Field() {
  const c = searchCombo.value;
  return (
    <input
      id={SEARCH_INPUT_ID}
      role="combobox"
      aria-expanded={searchOpen.value && c.expanded}
      aria-controls={SEARCH_LISTBOX_ID}
      aria-activedescendant={c.activeId ?? undefined}
      value={searchQuery.value}
      onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
      onKeyDown={(e) => searchKeys.handler?.(e)}
    />
  );
}

function setup(query = '') {
  const utils = render(
    <>
      <Field />
      <SearchPanel />
    </>,
  );
  act(() => openSearch(query));
  return { ...utils, input: () => screen.getByRole('combobox') as HTMLInputElement };
}

function type(value: string) {
  const input = screen.getByRole('combobox') as HTMLInputElement;
  act(() => {
    fireEvent.input(input, { target: { value } });
  });
}

function key(k: string, init: Partial<KeyboardEventInit> = {}) {
  const input = screen.getByRole('combobox');
  act(() => {
    fireEvent.keyDown(input, { key: k, ...init });
  });
}

beforeEach(() => {
  calls = [];
  failNext = false;
  client.search.mockImplementation(fakeSearch);
  client.highlightLinked.mockImplementation(async (_tr: string, hits: SearchHit[]) =>
    hits.map((h) => (h.text.includes('Word') ? [[h.text.indexOf('Word'), h.text.indexOf('Word') + 4]] : [])),
  );
  client.warmSearch.mockImplementation(() => undefined);
  fb.feedback.mockReset();
  resetDataCache();
  configureData({
    base: '/data/',
    fetch: async (url: string) => {
      const path = url.replace(/^\/data\//, '').replace(/\?.*$/, '');
      const body = FILES[path];
      return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('nope', { status: 404 });
    },
  });
  localStorage.clear();
  window.location.hash = '#/KJV/JHN/1';
  passage.value = { tr: 'KJV', ref: { book: 'JHN', chapter: 1 } };
  route.value = { name: 'read', tr: 'KJV', ref: { book: 'JHN', chapter: 1 } };
});

afterEach(() => {
  act(() => {
    closeSearch();
    searchQuery.value = '';
  });
  cleanup();
  unregisterRemoteTranslation('NIV');
});

/* ---- tests ------------------------------------------------------------------ */

describe('SearchPanel', () => {
  it('renders nothing while closed, and the panel root the header relies on while open', () => {
    const { container } = render(<SearchPanel />);
    expect(container.innerHTML).toBe('');
    act(() => openSearch());
    const panel = document.getElementById('search-panel');
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('data-keep-word')).toBe(true);
  });

  it('shows query hints when empty; choosing one runs it', async () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Search the Bible' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '"in the beginning"' }));
    expect(searchQuery.value).toBe('"in the beginning"');
    await waitFor(() => expect(calls.map((c) => c.query)).toContain('"in the beginning"'));
  });

  it('debounces typing (~150 ms) and aborts superseded searches', async () => {
    setup();
    type('l');
    type('lo');
    type('lov');
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(0);
    type('love');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].query).toBe('love');
    expect(calls[0].opts).toMatchObject({ tr: 'KJV', limit: 40 });

    // a new query aborts the one in flight
    client.search.mockImplementationOnce((q: string, o: SearchOptions, init: { signal?: AbortSignal }) => {
      calls.push({ query: q, opts: o, signal: init.signal });
      return new Promise(() => undefined); // never settles
    });
    type('faith');
    await waitFor(() => expect(calls).toHaveLength(2));
    const slow = calls[1].signal!;
    type('hope');
    expect(slow.aborted).toBe(true);
    await waitFor(() => expect(calls).toHaveLength(3));
  });

  it('lists verses grouped by book with escaped text and highlight marks', async () => {
    setup('love');
    await screen.findByText('Genesis 27:4');
    const list = screen.getByRole('listbox');
    expect(list.id).toBe(SEARCH_LISTBOX_ID);
    const groups = within(list).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby'))).toEqual(['sp-g-GEN', 'sp-g-PSA']);
    expect(document.getElementById('sp-g-GEN')?.textContent).toContain('3 verses');
    // first page: 40 options
    expect(within(list).getAllByRole('option')).toHaveLength(40);
    const first = within(list).getAllByRole('option')[0];
    expect(first.querySelector('mark')?.textContent).toBe('love');
    // markup in verse text stays text
    const psalm = screen.getAllByText((_, el) => el?.classList.contains('sp-hit__text') === true && /Psalm verse 1:/.test(el.textContent ?? ''))[0];
    expect(psalm.textContent).toContain('<b>because</b>');
    expect(psalm.querySelector('b')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('61 verses for “love”');
  });

  it('pages in more results', async () => {
    setup('love');
    await screen.findByText('Genesis 27:4');
    fireEvent.click(screen.getByRole('button', { name: /Show more \(21 more verses\)/ }));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(61));
    expect(calls[calls.length - 1].opts).toMatchObject({ offset: 40, limit: 40 });
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    expect(screen.getByText(/End of results/)).toBeTruthy();
  });

  it('↑/↓ move the active option (aria-activedescendant), Enter opens it with feedback', async () => {
    setup('love');
    await screen.findByText('Genesis 27:4');
    const input = screen.getByRole('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    key('ArrowDown');
    const opt1 = screen.getAllByRole('option')[0];
    expect(opt1.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(opt1.id);
    key('ArrowDown');
    const opt2 = screen.getAllByRole('option')[1];
    expect(input.getAttribute('aria-activedescendant')).toBe(opt2.id);
    expect(opt1.getAttribute('aria-selected')).toBe('false');
    key('ArrowUp');
    key('ArrowUp');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(fb.feedback).toHaveBeenCalledWith('select');
    expect(searchOpen.value).toBe(false);
    expect(window.location.hash).toBe('#/KJV/GEN/29/20');
    // the query is remembered
    expect(JSON.parse(localStorage.getItem('rootword:recentSearches') ?? '[]')).toEqual(['love']);
  });

  it('arrowing to the end of the list loads the next page', async () => {
    setup('love');
    await screen.findByText('Genesis 27:4');
    for (let i = 0; i < 5; i++) key('PageDown');
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[39].id);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(61));
    expect(calls[calls.length - 1].opts).toMatchObject({ offset: 40 });
    key('ArrowDown');
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[40].id);
  });

  it('clicking a verse opens it in the translation being read', async () => {
    setup('love');
    fireEvent.click(await screen.findByText('Genesis 29:32'));
    expect(window.location.hash).toBe('#/KJV/GEN/29/32');
    expect(fb.feedback).toHaveBeenCalledWith('select');
  });

  it('a reference comes first: "Go to Romans 8:28" with the verse, Enter navigates, no text search', async () => {
    setup('Rom 8:28');
    const opt = await screen.findByRole('option', { name: /Go to Romans 8:28/ });
    await waitFor(() => expect(opt.textContent).toContain('all things work together for good'));
    expect(screen.getByRole('option', { name: /Read Romans 8/ })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toHaveLength(0);
    key('Enter');
    expect(window.location.hash).toBe('#/KJV/ROM/8/28');
    expect(searchOpen.value).toBe(false);
    expect(searchQuery.value).toBe('');
  });

  it('offers "Open the book of Job" for a bare book name and still searches the word', async () => {
    setup('Job');
    expect(await screen.findByRole('option', { name: /Open the book of Job/ })).toBeTruthy();
    await waitFor(() => expect(calls.map((c) => c.query)).toContain('Job'));
    key('Enter');
    expect(window.location.hash).toBe('#/KJV/JOB/1');
  });

  it('shows matching people & places linking to their pages', async () => {
    setup('Abraham');
    const person = await screen.findByRole('option', { name: /Abraham\s*Person/ });
    expect(person.textContent).toContain('275 verses');
    expect(screen.queryByRole('option', { name: /Abram\b/ })).toBeNull(); // "Abram" doesn't start with "Abraham"
    fireEvent.click(person);
    expect(window.location.hash).toBe('#/person/p0057');
  });

  it('Strong’s queries get a lexicon card, word-study link and linked-word highlights', async () => {
    setup('G3056');
    const card = await screen.findByRole('region', { name: /λόγος/ });
    expect(card.textContent).toContain('logos');
    expect(card.textContent).toContain('Noun, masculine');
    expect(card.textContent).toContain('“word”');
    expect(card.textContent).toContain('318');
    expect(card.textContent).toMatch(/KJV renders it\s*word\s*168/);
    const link = within(card).getByRole('link', { name: /Open word study/ });
    expect(link.getAttribute('href')).toBe('#/word/G3056');
    expect(card.querySelector('[lang="grc"]')?.textContent).toBe('λόγος');
    await waitFor(() => expect(client.highlightLinked).toHaveBeenCalledWith('KJV', expect.any(Array), ['G3056'], expect.anything()));
    await waitFor(() => expect(document.querySelector('#so-v-JHN-1-1 mark')?.textContent).toBe('Word'));
    fireEvent.click(link);
    expect(searchOpen.value).toBe(false);
  });

  it('the word card’s "See all occurrences" path: openSearch(G3056) shows the occurrences', async () => {
    render(
      <>
        <Field />
        <SearchPanel />
      </>,
    );
    act(() => openSearch('G3056'));
    expect(searchQuery.value).toBe('G3056');
    await screen.findByText('Matthew 5:37');
    expect(calls[0]).toMatchObject({ query: 'G3056', opts: { tr: 'KJV' } });
  });

  it('testament and book filters re-run the search', async () => {
    setup('love');
    await screen.findByText('Genesis 27:4');
    const seg = screen.getByRole('group', { name: 'Testament' });
    fireEvent.click(within(seg).getByRole('button', { name: /NT/ }));
    await waitFor(() => expect(calls[calls.length - 1].opts).toMatchObject({ testament: 'NT' }));
    await screen.findByText('John 3:16');
    expect(screen.queryByText('Genesis 27:4')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('in the New Testament');

    const books = screen.getByRole('toolbar', { name: 'Filter by book' });
    fireEvent.click(within(books).getByRole('button', { name: /1 John/ }));
    await waitFor(() => expect(calls[calls.length - 1].opts).toMatchObject({ book: 62 }));
    await screen.findByText('1 John 4:8');
    expect(screen.queryByText('John 3:16')).toBeNull();
  });

  it('no results: says so and offers suggestions', async () => {
    setup('xyzzy');
    expect(await screen.findByText(/No verses match/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Did you mean “xyz”?' }));
    expect(searchQuery.value).toBe('xyz');
  });

  it('offers the exact phrase for several plain words', async () => {
    setup('love');
    await screen.findByText('Genesis 27:4');
    type('God is love');
    // the fake corpus has no results for this query: the phrase is offered in the no-result state
    fireEvent.click(await screen.findByRole('button', { name: 'Only the exact phrase “God is love”' }));
    expect(searchQuery.value).toBe('"God is love"');
  });

  it('a failed search shows an error with a retry', async () => {
    failNext = true;
    setup('love');
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Genesis 27:4');
  });

  it('a remote translation without a corpus (NIV) searches the KJV and says so', async () => {
    registerRemoteTranslation({
      id: 'NIV',
      name: 'New International Version',
      abbr: 'NIV',
      year: '2011',
      license: '© Biblica',
      alignment: 'bridged',
      description: '',
      source: 'https://api.bible',
      remote: true,
    });
    passage.value = { tr: 'NIV', ref: { book: 'JHN', chapter: 1 } };
    setup('love');
    await screen.findByText('Genesis 27:4');
    expect(calls[0].opts.tr).toBe('KJV');
    expect(screen.getByText(/The NIV can’t be searched here/)).toBeTruthy();
    fireEvent.click(screen.getByText('Genesis 29:20'));
    expect(window.location.hash).toBe('#/NIV/GEN/29/20');
  });

  it('Tab from the field moves into the panel', async () => {
    setup('love');
    await screen.findByText('Genesis 27:4');
    key('Tab');
    expect(document.getElementById('search-panel')?.contains(document.activeElement)).toBe(true);
  });

  it('announces results politely once they settle', async () => {
    setup('love');
    await screen.findByText('Genesis 27:4');
    const status = document.querySelector('#search-panel [role="status"]') as HTMLElement;
    await waitFor(() => expect(status.textContent).toBe('61 verses for love.'), { timeout: 2000 });
  });
});
