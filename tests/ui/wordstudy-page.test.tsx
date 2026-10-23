/**
 * The word-study page (#/word/{id}) with mocked data: header and counts, the definition through the
 * card's safe renderer, renderings, the distribution chart filtering the occurrence list (and its
 * table alternative), forms, the Septuagint bridge and related chips, marked English words in the
 * occurrence previews (token links and KJV Strong's tags), paging, phone accordions, the lexicon-only,
 * missing and error states.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LexEntry, LexIndex, OrigChapter, OrigWord, TextChapter, WordStudyChunk } from '../../src/lib/types';
import { packRef } from '../../src/lib/types';

/* ---- fixtures --------------------------------------------------------------- */

const ow = (text: string, strongs: string, verse: number): OrigWord => [text, strongs, text, '', '', verse, '', 0, '', ''];
const byBook = (counts: Record<number, number>) => Array.from({ length: 66 }, (_, i) => counts[i + 1] ?? 0);

const LEX: Record<string, LexEntry> = {
  G0026: {
    id: 'G0026',
    lemma: 'ἀγάπη',
    translit: 'agapē',
    pos: 'Noun, feminine',
    gloss: 'love',
    def: '<b>ἀγάπη</b>, -ης, ἡ<br><b>love, goodwill</b>: <span class="ref" data-ref="JHN.13.35">John 13:35</span><script>alert(1)</script><img src=x onerror=alert(1)>',
    strongsDef: 'love, i.e. affection or benevolence',
    kjv: '(feast of) charity, love',
    deriv: 'from G25 (ἀγαπάω)',
    verses: 3,
    renderings: { KJV: [['love', 2], ['charity', 1]], BSB: [['love', 3]] },
  },
  G0149: {
    id: 'G0149',
    lemma: 'αἰσχρόν',
    translit: 'aischron',
    pos: 'Adjective',
    gloss: 'shameful',
    def: '<b>base, shameful</b>',
    strongsDef: 'a shameful thing',
    deriv: 'neuter of G150 (αἰσχρός)',
  },
};

const STUDY: WordStudyChunk = {
  G0026: {
    id: 'G0026',
    total: 4,
    byBook: byBook({ 43: 2, 46: 1, 62: 1 }),
    forms: [
      ['ἀγάπη', 'N-NSF', 2],
      ['ἀγάπην', 'N-ASF', 2],
    ],
    lxx: [
      ['H0160', 15],
      ['H0001', 1],
    ],
    related: ['G0025'],
  },
};

const CONC: Record<string, number[]> = {
  G0026: [packRef(43, 13, 35), packRef(46, 13, 4), packRef(62, 4, 8)],
};

const ORIG: Record<string, OrigChapter> = {
  'JHN/13': { book: 'JHN', chapter: 13, lang: 'grc', edition: 'SBLGNT', words: [ow('ἐν', 'G1722', 35), ow('ἀγάπην', 'G0026', 35)] },
  '1CO/13': { book: '1CO', chapter: 13, lang: 'grc', edition: 'SBLGNT', words: [ow('ἡ', 'G3588', 4), ow('ἀγάπη', 'G0026', 4)] },
  '1JN/4': { book: '1JN', chapter: 4, lang: 'grc', edition: 'SBLGNT', words: [ow('θεὸς', 'G2316', 8)] },
};

const TEXT: Record<string, TextChapter> = {
  'JHN/13': { tr: 'KJV', book: 'JHN', chapter: 13, verses: [{ v: 35, t: ['By this shall all men know, if ye have ', ['love', [1]], ' one to another.'] }] },
  '1CO/13': { tr: 'KJV', book: '1CO', chapter: 13, verses: [{ v: 4, t: [['Charity', [1]], ' suffereth long'] }] },
  // a KJV word tagged with the Strong's number but not linked to an SBLGNT word
  '1JN/4': { tr: 'KJV', book: '1JN', chapter: 4, verses: [{ v: 8, t: ['for ', ['God', [0]], ' is ', ['love', [], { s: ['G0026'] }], '.'] }] },
};

const INDEX: LexIndex = [
  ['G0025', 'ἀγαπάω', 'agapaō', 'to love'],
  ['H0001a', 'אָב', 'av', 'father'],
  ['H0160', 'אַהֲבָה', 'ahavah', 'love'],
];

/* ---- mocks ------------------------------------------------------------------ */

const fail = vi.hoisted(() => ({ lex: false }));
vi.mock('../../src/lib/data', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/data')>();
  return {
    ...real,
    loadLexEntry: vi.fn(async (id: string) => {
      if (fail.lex) throw new real.DataError('lex', 500);
      return LEX[real.normalizeStrongs(id) ?? id];
    }),
    loadConcordance: vi.fn(async (id: string) => CONC[real.normalizeStrongs(id) ?? id] ?? []),
    loadOrig: vi.fn(async (b: string, c: number) => ORIG[`${b}/${c}`] ?? { book: b, chapter: c, lang: 'grc', edition: 'SBLGNT', words: [] }),
    loadText: vi.fn(async (_tr: string, b: string, c: number) => TEXT[`${b}/${c}`] ?? { tr: 'KJV', book: b, chapter: c, verses: [] }),
    loadLexIndex: vi.fn(async () => INDEX),
  };
});
vi.mock('../../src/lib/wordstudy', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/wordstudy')>();
  return { ...real, loadWordStudyChunk: vi.fn(async () => STUDY) };
});
const fb = vi.hoisted(() => ({ feedback: vi.fn() }));
vi.mock('../../src/lib/feedback', () => ({ feedback: fb.feedback, primeFeedback: vi.fn() }));

import WordStudyPage from '../../src/pages/WordStudyPage';
import { resetWordChipsCache } from '../../src/components/wordstudy/WordChips';
import { OCC_PAGE } from '../../src/components/wordstudy/Occurrences';
import { liveMessage } from '../../src/app/state';
import * as data from '../../src/lib/data';

function setPhone(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('max-width: 640px'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  resetWordChipsCache();
  fail.lex = false;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  setPhone(false);
  vi.mocked(data.loadText).mockClear();
  fb.feedback.mockClear();
});
afterEach(() => cleanup());

const rows = () => document.querySelectorAll('.ws-ref');
/** An element by id, once it exists. */
const byId = (id: string) =>
  waitFor(() => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not rendered`);
    return el;
  });

describe('WordStudyPage', () => {
  it('shows the word, its counts and its meaning', async () => {
    render(<WordStudyPage id="G0026" />);
    const h1 = await screen.findByRole('heading', { level: 1, name: /ἀγάπη/ });
    expect(h1.textContent).toContain('ἀγάπη');
    expect(h1.querySelector('[lang="grc"]')?.textContent).toBe('ἀγάπη');
    expect(screen.getByText('agapē')).toBeTruthy();
    expect(screen.getByText('“love”')).toBeTruthy();
    const facts = document.querySelector('.ws-facts')!;
    expect(facts.textContent).toContain('G26');
    expect(facts.textContent).toContain('4 occurrences');
    expect(facts.textContent).toContain('3 verses');
    expect(facts.textContent).toContain('3 books');
    expect(within(facts as HTMLElement).getByRole('link', { name: 'John 13:35' }).getAttribute('href')).toBe('#/KJV/JHN/13/35');
    await waitFor(() => expect(document.title).toBe('ἀγάπη (G26) · word study — Rootword'));

    // definition: the dictionary head is lifted out, refs are links, script / img never render
    const meaning = document.getElementById('ws-meaning')!;
    expect(meaning.querySelector('.ws-def__head')?.textContent).toContain('ἀγάπη, -ης, ἡ');
    expect(within(meaning).getByRole('link', { name: 'John 13:35' }).getAttribute('href')).toBe('#/KJV/JHN/13/35');
    expect(meaning.querySelector('script, img')).toBeNull();
    expect(meaning.textContent).not.toContain('alert');
    // Strong's numbers in the derivation link to their studies
    expect(within(meaning).getByRole('link', { name: 'G25' }).getAttribute('href')).toBe('#/word/G0025');
    expect(meaning.textContent).toContain('love, i.e. affection or benevolence');
  });

  it('shows how each translation renders it', async () => {
    render(<WordStudyPage id="G0026" />);
    const sec = await byId('ws-translated');
    const figs = sec.querySelectorAll('figure');
    expect([...figs].map((f) => f.querySelector('.ws-rend__abbr')?.textContent)).toEqual(['KJV', 'BSB']);
    expect(within(figs[0] as HTMLElement).getByText('charity')).toBeTruthy();
    expect(figs[0].textContent).toContain('2 times, 50% of occurrences');
  });

  it('marks the English words that translate it in every occurrence', async () => {
    render(<WordStudyPage id="G0026" />);
    await waitFor(() => expect(document.querySelectorAll('.ws-ref mark.ws-hit').length).toBe(3));
    const marks = [...document.querySelectorAll('.ws-ref mark.ws-hit')].map((m) => m.textContent);
    expect(marks).toEqual(['love', 'Charity', 'love']);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.ws-ref__at')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['John 13:35', '#/KJV/JHN/13/35'],
      ['1 Cor 13:4', '#/KJV/1CO/13/4'],
      ['1 John 4:8', '#/KJV/1JN/4/8'],
    ]);
    expect(document.querySelector('.ws-occ__body')?.getAttribute('aria-busy')).toBeNull();
  });

  it('filters the occurrence list by the book chosen in the chart, the table or the select', async () => {
    render(<WordStudyPage id="G0026" />);
    await waitFor(() => expect(rows().length).toBe(3));
    const chart = screen.getByRole('toolbar', { name: /Occurrences by book/ });
    const john = within(chart).getByRole('button', { name: 'John: 2 occurrences in 1 verse' });
    // one Tab stop: the first book with occurrences
    expect(john.getAttribute('tabindex')).toBe('0');
    expect(within(chart).getByRole('button', { name: /1 Corinthians/ }).getAttribute('tabindex')).toBe('-1');
    fireEvent.click(john);
    expect(john.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0].textContent).toContain('John 13:35');
    expect((document.getElementById('ws-occ-book') as HTMLSelectElement).value).toBe('43');
    expect(document.querySelector('.ws-choice')?.textContent).toContain('Listing the 1 verse in John');
    expect(liveMessage.value).toContain('Listing the 1 verse in John');
    expect(fb.feedback).toHaveBeenCalledWith('select');

    // clicking it again shows every book
    fireEvent.click(john);
    await waitFor(() => expect(rows().length).toBe(3));

    // keyboard: arrows move between books
    john.focus();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^1 Corinthians/);
    fireEvent.keyDown(chart, { key: 'End' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^1 John/);

    // table alternative
    const tableBtn = screen.getByRole('button', { name: 'Table view' });
    fireEvent.click(tableBtn);
    expect(tableBtn.getAttribute('aria-expanded')).toBe('true');
    const table = screen.getByRole('table', { name: /Occurrences of ἀγάπη by book/ });
    fireEvent.click(within(table).getByRole('button', { name: '1 Corinthians' }));
    await waitFor(() => expect(rows().length).toBe(1));
    expect(rows()[0].textContent).toContain('1 Cor 13:4');

    // the select
    fireEvent.change(document.getElementById('ws-occ-book')!, { target: { value: '0' } });
    await waitFor(() => expect(rows().length).toBe(3));
  });

  it('lists the forms with readable parsing', async () => {
    render(<WordStudyPage id="G0026" />);
    const table = await screen.findByRole('table', { name: /Forms of ἀγάπη/ });
    const body = [...table.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
    expect(body[0]).toContain('ἀγάπη');
    expect(body[0]).toContain('Nominative singular feminine');
    expect(body[0]).toContain('N-NSF');
    expect(table.querySelector('thead')?.textContent).toContain('every form: noun');
  });

  it('links the Septuagint bridge and related words to their studies', async () => {
    render(<WordStudyPage id="G0026" />);
    const bridge = await byId('ws-lxx');
    await waitFor(() => expect(bridge.textContent).toContain('אַהֲבָה'));
    const chip = within(bridge).getByRole('link', { name: /אַהֲבָה/ });
    expect(chip.getAttribute('href')).toBe('#/word/H0160');
    expect(chip.textContent).toContain('15');
    expect(chip.textContent).toContain('ahavah');
    expect(bridge.querySelector('.ws-lead')?.textContent).toMatch(/In the Septuagint, ἀγάπη renders אַהֲבָה \(“love”\) 15×, and 1 other Hebrew word\./);
    // a base id finds its extended lexicon row (H0001 -> H0001a "father")
    expect(within(bridge).getByRole('link', { name: /אָב/ }).getAttribute('href')).toBe('#/word/H0001');
    const related = document.getElementById('ws-related')!;
    expect(within(related).getByRole('link', { name: /ἀγαπάω/ }).getAttribute('href')).toBe('#/word/G0025');
  });

  it('pages long occurrence lists', async () => {
    const many = Array.from({ length: OCC_PAGE + 5 }, (_, i) => packRef(43, 13, i + 1));
    CONC.G0026 = many;
    try {
      render(<WordStudyPage id="G0026" />);
      await waitFor(() => expect(rows().length).toBe(OCC_PAGE));
      const more = await screen.findByRole('button', { name: 'Show 5 more' });
      await waitFor(() => expect((more as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(more);
      await waitFor(() => expect(rows().length).toBe(OCC_PAGE + 5));
      expect(screen.getByText(`All ${OCC_PAGE + 5} verses shown.`)).toBeTruthy();
      // verses the chapter text lacks say so instead of failing
      expect(rows()[0].textContent).toContain('Not in this translation’s numbering');
      // one request per chapter
      expect(vi.mocked(data.loadText).mock.calls.filter((c) => c[1] === 'JHN' && c[2] === 13).length).toBe(1);
    } finally {
      CONC.G0026 = [packRef(43, 13, 35), packRef(46, 13, 4), packRef(62, 4, 8)];
    }
  });

  it('turns sections into accordions on phones', async () => {
    setPhone(true);
    render(<WordStudyPage id="G0026" />);
    const formsBtn = (await byId('ws-forms-h')).querySelector('button')!;
    expect(formsBtn.getAttribute('aria-controls')).toBe('ws-forms-body');
    expect(formsBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('ws-forms-body')?.hidden).toBe(true);
    fireEvent.click(formsBtn);
    expect(formsBtn.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('ws-forms-body')?.hidden).toBe(false);
    const meaningBtn = document.querySelector('#ws-meaning-h button')!;
    expect(meaningBtn.getAttribute('aria-expanded')).toBe('true');
    // the occurrence list never collapses
    expect(document.querySelector('#ws-occ-h button')).toBeNull();
    // no desktop rail on phones is handled by CSS; the toc still renders for wide screens
    expect(document.querySelector('.ws-toc')).toBeTruthy();
  });

  it('gives a lexicon-only page for ids with no study data', async () => {
    render(<WordStudyPage id="G0149" />);
    await screen.findByText('Dictionary entry only');
    expect(document.querySelector('.ws-notice')?.textContent).toContain('No verses are filed under G149');
    expect(document.getElementById('ws-meaning')).toBeTruthy();
    expect(document.getElementById('ws-where')).toBeNull();
    expect(document.getElementById('ws-occ')).toBeNull();
    // related words come from the derivation note
    const related = document.getElementById('ws-related')!;
    expect(within(related).getByRole('link', { name: /G150/ }).getAttribute('href')).toBe('#/word/G0150');
  });

  it('says when there is no such word, and offers a retry when loading fails', async () => {
    render(<WordStudyPage id="H9000" />);
    await screen.findByText('There is no Hebrew word with Strong’s number H9000.');
    cleanup();

    fail.lex = true;
    render(<WordStudyPage id="G0026" />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail.lex = false;
    await act(async () => {
      fireEvent.click(retry);
    });
    await screen.findByRole('heading', { level: 1, name: /ἀγάπη/ });
  });
});
