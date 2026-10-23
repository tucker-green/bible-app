/**
 * People & places UI with mocked names data: the word-card EntitySection (disambiguation: Joseph in
 * Gen 37 vs Matt 1:16), the person / place page and the lineage explorer (tree, keyboard,
 * re-centring, outline, path between).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamilyGraph, NameChapter, NameEntity, NameIndex, OrigChapter, TextChapter } from '../../src/lib/types';
import { packRef } from '../../src/lib/types';

/* ---- fixtures --------------------------------------------------------------- */

const person = (id: string, name: string, brief: string, extra: Partial<NameEntity> = {}): NameEntity => ({
  id,
  name,
  kind: 'person',
  uniqueName: `${name}@x`,
  brief,
  summary: '',
  gender: 'male',
  forms: [],
  refs: [],
  ...extra,
});

const ENTITIES: Record<string, NameEntity> = {
  p1651: person('p1651', 'Joseph', 'Son of Jacob, ruler in Egypt', {
    forms: [['H3130', 'יוֹסֵף', 'Joseph']],
    parents: ['p1272', 'p2322'],
    partners: ['p0319'],
    children: ['p1869', 'p0848'],
  }),
  p1654: person('p1654', 'Joseph', 'Husband of Mary and earthly father of Jesus', {
    forms: [['G2501', 'Ἰωσήφ', 'Joseph']],
    parents: ['p1315'],
    partners: ['p1880'],
    children: ['p1529', 'p1351', 'p1658', 'p2681', 'p1701'],
  }),
  p0057: person('p0057', 'Abraham', 'Patriarch, chosen by God to father His people', {
    group: 'Early Patriarch',
    forms: [
      ['H0085', 'אַבְרָהָם', 'Abraham'],
      ['H0087', 'אַבְרָם', 'Abram'],
      ['G0011', 'Ἀβραάμ', 'Abraham'],
    ],
    parents: ['p2739'],
    summary:
      'A man living at the time of the Patriarchs, first mentioned at <span class="ref" data-ref="GEN.11.26">Gen 11:26</span><br>son of <b>Terah</b>;<br>Abraham was the friend of God (Jam 2.23).',
    refs: [packRef(1, 11, 26), packRef(1, 12, 1)],
  }),
  l0195: {
    ...person('l0195', 'Bethlehem', "City of David's birth and Jesus' birth"),
    kind: 'place',
    gender: undefined,
    group: 'Tribe of Judah',
    coords: [31.70536, 35.21026],
    refs: [packRef(1, 35, 19)],
  },
};

const INDEX: NameIndex = [
  ['p1651', 'Joseph', 'person', 'Son of Jacob, ruler in Egypt', 197],
  ['p1654', 'Joseph', 'person', 'Husband of Mary and earthly father of Jesus', 16],
  ['p1655', 'Joseph', 'person', 'Of Arimathea', 6],
  ['p1272', 'Israel', 'person', 'Patriarch, son of Isaac', 2578],
  ['p2322', 'Rachel', 'person', 'Wife of Jacob', 47],
  ['p0319', 'Asenath', 'person', 'Egyptian wife of Joseph', 3],
  ['p1869', 'Manasseh', 'person', 'Son of Joseph', 20],
  ['p0848', 'Ephraim', 'person', 'Son of Joseph', 20],
  ['p1315', 'Jacob', 'person', 'Father of Joseph', 2],
  ['p1880', 'Mary', 'person', 'Mother of Jesus', 19],
  ['p1529', 'Jesus', 'person', 'The Son of God', 1161],
  ['p1351', 'James', 'person', 'Brother of Jesus', 3],
  ['p1658', 'Joses', 'person', 'Brother of Jesus', 2],
  ['p2681', 'Simon', 'person', 'Brother of Jesus', 2],
  ['p1701', 'Judas', 'person', 'Brother of Jesus', 2],
  ['p0057', 'Abraham', 'person', 'Patriarch, chosen by God to father His people', 275],
  ['p2739', 'Terah', 'person', "Abraham's father", 13],
  ['p0077', 'Adam', 'person', 'The first man', 27],
  ['p9001', 'Seth', 'person', 'Son of Adam', 9],
  ['l0195', 'Bethlehem', 'place', "City of David's birth", 53],
];

const NAME_CHAPTERS: Record<string, NameChapter> = {
  'GEN/37': { book: 'GEN', chapter: 37, words: { '5': 'p1651' } },
  'MAT/1': { book: 'MAT', chapter: 1, words: { '235': 'p1654' } },
  'GEN/17': { book: 'GEN', chapter: 17, words: { '3': 'p0057' } },
  'GEN/11': { book: 'GEN', chapter: 11, words: { '2': 'p0057' } },
};

const ow = (text: string, strongs: string) => [text, strongs, text, '', '', 1, '', 0, '', ''] as OrigChapter['words'][number];
const ORIG: Record<string, OrigChapter> = {
  'GEN/37': { book: 'GEN', chapter: 37, lang: 'hbo', edition: 'WLC', words: Object.assign([], { 5: ow('יוֹסֵף', 'H3130') }) },
  'MAT/1': { book: 'MAT', chapter: 1, lang: 'grc', edition: 'SBLGNT', words: Object.assign([], { 235: ow('Ἰωσὴφ', 'G2501') }) },
  'GEN/17': { book: 'GEN', chapter: 17, lang: 'hbo', edition: 'WLC', words: Object.assign([], { 3: ow('אַבְרָם', 'H0087') }) },
};

const TEXT: TextChapter = {
  tr: 'KJV',
  book: 'GEN',
  chapter: 11,
  verses: [{ v: 26, t: [['And', [1]], ' ', ['Terah', [1]], ' ', ['begat', [4]], ' ', ['Abram', [2]], '.'] }],
};

// Adam -> Seth -> Unnamed -> Unnamed -> Jesus, and a small family around Abraham
const GRAPH: FamilyGraph = [
  ['p0077', 'Adam', 'The first man', [], ['p9001'], [], []],
  ['p9001', 'Seth', 'Son of Adam', ['p0077'], ['p9002'], [], []],
  ['p9002', 'Unnamed', '', ['p9001'], ['p9003'], [], []],
  ['p9003', 'Unnamed', '', ['p9002'], ['p1529'], [], []],
  ['p1529', 'Jesus', 'The Son of God', ['p9003'], [], [], []],
  ['p2739', 'Terah', "Abraham's father", [], ['p0057'], [], []],
  ['p0057', 'Abraham', 'Patriarch', ['p2739'], ['p1245', 'p1263'], ['p2405'], []],
  ['p2405', 'Sarah', 'Wife of Abraham', [], ['p1245'], ['p0057'], []],
  ['p1245', 'Isaac', 'Son of Abraham', ['p0057', 'p2405'], [], [], []],
  ['p1263', 'Ishmael', 'Son of Abraham and Hagar', ['p0057'], [], [], []],
];

/* ---- mocks ------------------------------------------------------------------ */

vi.mock('../../src/lib/names', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/names')>();
  return {
    ...real,
    loadNameChapter: vi.fn(async (b: string, c: number) => NAME_CHAPTERS[`${b}/${c}`] ?? { book: b, chapter: c, words: {} }),
    loadEntity: vi.fn(async (id: string) => ENTITIES[id]),
    loadNameIndex: vi.fn(async () => INDEX),
    loadFamily: vi.fn(async () => GRAPH),
  };
});
vi.mock('../../src/lib/data', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/data')>();
  return {
    ...real,
    loadOrig: vi.fn(async (b: string, c: number) => ORIG[`${b}/${c}`] ?? { book: b, chapter: c, lang: 'hbo', edition: 'WLC', words: [] }),
    loadText: vi.fn(async () => TEXT),
  };
});
const fb = vi.hoisted(() => ({ feedback: vi.fn() }));
vi.mock('../../src/lib/feedback', () => ({ feedback: fb.feedback, primeFeedback: vi.fn() }));

import { EntitySection } from '../../src/components/word/EntitySection';
import { resetNamesUiCache } from '../../src/components/names/parts';
import EntityPage from '../../src/pages/EntityPage';
import LineagePage, { resetLineageCache } from '../../src/pages/LineagePage';
import { pinnedWord } from '../../src/app/state';

beforeEach(() => {
  resetNamesUiCache();
  resetLineageCache();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  history.replaceState(null, '', '#/lineage/p0057');
});
afterEach(() => cleanup());

/* ---- word card -------------------------------------------------------------- */

describe('EntitySection (word card)', () => {
  it('tells the two Josephs apart', async () => {
    const { unmount } = render(<EntitySection book="GEN" chapter={37} origIndices={[5]} />);
    await screen.findByText('Son of Jacob, ruler in Egypt');
    expect(screen.getByRole('link', { name: /About Joseph/ }).getAttribute('href')).toBe('#/person/p1651');
    expect(screen.getByRole('link', { name: /Family tree/ }).getAttribute('href')).toBe('#/lineage/p1651');
    await screen.findByText('Rachel');
    expect(screen.getByText('One of 3 people named Joseph')).toBeTruthy();
    unmount();

    render(<EntitySection book="MAT" chapter={1} origIndices={[235]} />);
    await screen.findByText('Husband of Mary and earthly father of Jesus');
    expect(screen.getByRole('link', { name: /About Joseph/ }).getAttribute('href')).toBe('#/person/p1654');
    const group = screen.getByRole('group', { name: /Person: Joseph/ });
    await within(group).findByText('Mary');
    expect(within(group).getByText('Husband of')).toBeTruthy();
    expect(within(group).getByText('Father of')).toBeTruthy();
    // 5 children, 3 shown + "+2 more" (to the family tree)
    expect(within(group).getByRole('link', { name: '+2 more' }).getAttribute('href')).toBe('#/lineage/p1654');
  });

  it('shows the form used ("Abram") with the entity name, and closes the card on a link', async () => {
    pinnedWord.value = { key: 'KJV/GEN/17', unit: 1, via: 'click' };
    render(<EntitySection book="GEN" chapter={17} origIndices={[3]} />);
    await screen.findByText('Abram');
    expect(screen.getByText('(Abraham)')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /About Abraham/ }));
    expect(pinnedWord.value).toBeNull();
  });

  it('renders nothing for words that name no one', async () => {
    const { container } = render(<EntitySection book="GEN" chapter={37} origIndices={[6]} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(container.innerHTML).toBe('');
    const empty = render(<EntitySection book="GEN" chapter={37} origIndices={[]} />);
    expect(empty.container.innerHTML).toBe('');
  });
});

/* ---- person / place page ----------------------------------------------------- */

describe('EntityPage', () => {
  it('shows names, family, summary links and mentions with the name marked', async () => {
    render(<EntityPage kind="person" id="p0057" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Abraham' })).toBeTruthy();
    expect(screen.getByText('Patriarch, chosen by God to father His people')).toBeTruthy();
    // original forms, with word-study links
    expect(screen.getByRole('link', { name: /Word study H85/ }).getAttribute('href')).toBe('#/word/H0085');
    expect(screen.getByRole('link', { name: /Word study G11/ }).getAttribute('href')).toBe('#/word/G0011');
    // family
    const fam = await screen.findByRole('link', { name: 'Terah' });
    expect(fam.getAttribute('href')).toBe('#/person/p2739');
    expect(screen.getAllByRole('link', { name: /Family tree/ })[0].getAttribute('href')).toBe('#/lineage/p0057');
    // summary: the span ref and the plain "Jam 2.23" both link into the reader
    const refs = screen.getAllByRole('link', { name: /Gen 11:26|Jam 2\.23/ }).map((a) => a.getAttribute('href'));
    expect(refs).toContain('#/KJV/GEN/11/26');
    expect(refs).toContain('#/KJV/JAS/2/23');
    // mentions: grouped by book, the name marked in the preview
    await waitFor(() => expect(document.querySelector('mark.ent-hit')?.textContent).toBe('Abram'));
    expect(screen.getByRole('heading', { level: 3, name: /Genesis/ })).toBeTruthy();
  });

  it('shows a place with region and coordinates', async () => {
    render(<EntityPage kind="place" id="l0195" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bethlehem' })).toBeTruthy();
    expect(screen.getByText('Tribe of Judah', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('31.7054° N, 35.2103° E')).toBeTruthy();
  });

  it('has a not-found state', async () => {
    render(<EntityPage kind="person" id="p9999" />);
    expect(await screen.findByText(/There is no person with the id/)).toBeTruthy();
  });
});

/* ---- lineage ------------------------------------------------------------------ */

describe('LineagePage', () => {
  it('draws the tree around the person and moves with the arrow keys', async () => {
    render(<LineagePage id="p0057" />);
    const tree = await screen.findByRole('group', { name: 'Family tree of Abraham' });
    const focus = within(tree).getByRole('link', { name: /^Abraham\s?, centred/ });
    expect(focus.getAttribute('href')).toBe('#/person/p0057');
    expect(focus.getAttribute('tabindex')).toBe('0');
    const isaac = within(tree).getByRole('button', { name: /^Isaac\s?, child of Abraham/ });
    expect(isaac.getAttribute('tabindex')).toBe('-1');
    expect(within(tree).getByRole('button', { name: /^Sarah\s?, partner of Abraham/ })).toBeTruthy();

    focus.focus();
    fireEvent.keyDown(focus, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toContain('Terah');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Isaac');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toContain('Ishmael');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(focus);
  });

  it('re-centres on a person (route change) with a select tick', async () => {
    render(<LineagePage id="p0057" />);
    const tree = await screen.findByRole('group', { name: 'Family tree of Abraham' });
    fireEvent.click(within(tree).getByRole('button', { name: /^Isaac/ }));
    expect(location.hash).toBe('#/lineage/p1245');
    expect(fb.feedback).toHaveBeenCalledWith('select');
  });

  it('changes depth, switches to the outline and remembers both', async () => {
    render(<LineagePage id="p0057" />);
    await screen.findByRole('group', { name: 'Family tree of Abraham' });
    fireEvent.click(screen.getByRole('button', { name: 'Fewer generations up' }));
    expect(screen.queryByRole('button', { name: /^Terah/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fewer generations up' }));
    expect(screen.getByRole('button', { name: 'Fewer generations up' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    expect(screen.getByRole('button', { name: 'Outline' }).getAttribute('aria-pressed')).toBe('true');
    const anc = screen.getByRole('heading', { name: 'Ancestors' });
    expect(anc).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Terah' }).getAttribute('href')).toBe('#/lineage/p2739');
    expect(JSON.parse(localStorage.getItem('rootword:lineage') ?? '{}')).toMatchObject({ up: 1, view: 'outline' });
  });

  it('finds the path between two people, collapsing unnamed links', async () => {
    render(<LineagePage id="p0057" />);
    await screen.findByRole('group', { name: 'Family tree of Abraham' });
    await waitFor(() => expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('Abraham'));
    fireEvent.click(screen.getByRole('button', { name: 'Adam → Jesus' }));
    expect(await screen.findByText(/Adam is an ancestor of Jesus, 4 generations apart/)).toBeTruthy();
    expect(screen.getByText('2 unnamed generations')).toBeTruthy();
    const chain = document.querySelector('.lt-chain')!;
    expect([...chain.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['1Adam', '2Seth', '5Jesus']);
    expect(location.hash).toBe('#/lineage/p0057?from=p0077&to=p1529');
  });

  it('picks people with the combobox', async () => {
    render(<LineagePage id="p0057" />);
    await screen.findByRole('group', { name: 'Family tree of Abraham' });
    const to = screen.getByRole('combobox', { name: 'To' });
    to.focus();
    fireEvent.input(to, { target: { value: 'Jes' } });
    const list = await screen.findByRole('listbox', { name: 'To: people' });
    expect(to.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(to, { key: 'Enter' });
    expect((to as HTMLInputElement).value).toBe('Jesus');
    expect(list.hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Find the line' }));
    expect(await screen.findByText(/No line of parents and children links Abraham and Jesus/)).toBeTruthy();
  });

  it('explains when the id is not a person', async () => {
    render(<LineagePage id="l0195" />);
    expect(await screen.findByText(/There is no person with the id/)).toBeTruthy();
  });
});
