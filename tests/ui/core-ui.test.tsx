/**
 * Core UI fixes: malformed URLs never take the app down (safeDecode + RouteBoundary), the search
 * route's translation id is case-insensitive, the word card never blames the Textus Receptus for a
 * Greek layer that didn't load, definitions tag Greek / Hebrew and link Strong's numbers, merged notes
 * survive the next load, places are remembered per history entry, links followed from a sheet replace
 * its Back marker, and the translation picker is a real radio group.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/feedback', () => ({ feedback: vi.fn(), primeFeedback: vi.fn() }));

import { RouteBoundary } from '../../src/app/App';
import { isPlace, keyOfHash, readerHooks, savedPlace, savePlace } from '../../src/app/place';
import { parseRoute, safeDecode } from '../../src/app/router';
import { closePanel, focusOnArrival, arrival, goToHash, openPanel, panel, passage, setFontScale, fontScale, updateSettings, settings } from '../../src/app/state';
import { MAX_NOTE_LENGTH, MAX_STORED_NOTE_LENGTH, mergeStudy, migrateStudy, notes, sanitizeStudy, serializeStudy, setNote } from '../../src/app/study';
import { buildChapterModel } from '../../src/components/reader/model';
import { buildCardModel, cardSummary } from '../../src/components/word/cardModel';
import { DefText } from '../../src/components/word/DefText';
import { defRuns } from '../../src/components/word/defRuns';
import { parseDefinition } from '../../src/components/word/definition';
import { lexSource } from '../../src/components/wordstudy/model';
import { JHN1_KJV, JHN1_ORIG } from './fixtures';

afterEach(() => cleanup());

describe('malformed URLs', () => {
  it('safeDecode keeps a broken escape instead of throwing', () => {
    expect(safeDecode('%E2%82')).toBe('%E2%82');
    expect(safeDecode('100%')).toBe('100%');
    expect(safeDecode('foo%20bar')).toBe('foo bar');
  });

  it('parses such hashes as "not found"', () => {
    expect(parseRoute('#/word/%E2%82')).toMatchObject({ name: 'notfound' });
    expect(parseRoute('#/100%')).toEqual({ name: 'notfound', path: '/100%' });
  });

  it('upper-cases the search translation (tr=web searches the WEB)', () => {
    expect(parseRoute('#/search?q=love&tr=web')).toEqual({ name: 'search', q: 'love', tr: 'WEB' });
    expect(parseRoute('#/search?q=love&tr=')).toEqual({ name: 'search', q: 'love' });
  });
});

describe('RouteBoundary', () => {
  function Boom({ when }: { when: boolean }): null {
    if (when) throw new Error('kaboom');
    return null;
  }
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('shows a notice instead of a blank page, and renders afresh on the next route', () => {
    const { rerender, container } = render(
      <RouteBoundary routeKey="a">
        <Boom when />
      </RouteBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Something went wrong/);
    rerender(
      <RouteBoundary routeKey="b">
        <p>page b</p>
      </RouteBoundary>,
    );
    expect(container.textContent).toBe('page b');
  });
});

describe('word card without its original-language layer', () => {
  it('says the Greek did not load (never "not in the SBLGNT"), with the English kept', () => {
    const noOrig = buildChapterModel(JHN1_KJV, null, { alignment: 'strongs', tr: 'KJV' });
    const linked = noOrig.units.find((u) => u.kind === 'linked')!;
    const c = buildCardModel(noOrig, linked);
    expect(c.kind).toBe('unavailable');
    expect(c.note).toMatch(/Greek for this chapter didn’t load/);
    expect(c.note).not.toMatch(/Textus Receptus|SBL/);
    expect(c.edition).toBe('SBLGNT');
    expect(cardSummary(c)).toMatch(/didn’t load/);
  });

  it('still gives real lexicon-only units the Textus Receptus note', () => {
    const kjv = buildChapterModel(JHN1_KJV, JHN1_ORIG, { alignment: 'strongs', tr: 'KJV' });
    const lex = kjv.units.find((u) => u.kind === 'lexicon');
    if (lex) expect(buildCardModel(kjv, lex).note).toMatch(/Textus Receptus/);
  });
});

describe('definition runs', () => {
  it('splits Greek, Hebrew and Strong’s numbers out of plain text', () => {
    const runs = defRuns(' (יהוה "LORD" H3068G), cf. τ. πλησίον and G25.');
    expect(runs).toEqual([
      { t: 'text', v: ' (' },
      { t: 'orig', v: 'יהוה', lang: 'he' },
      { t: 'text', v: ' "LORD" ' },
      { t: 'strongs', id: 'H3068G', label: 'H3068G' },
      { t: 'text', v: '), cf. ' },
      { t: 'orig', v: 'τ', lang: 'grc' },
      { t: 'text', v: '. ' },
      { t: 'orig', v: 'πλησίον', lang: 'grc' },
      { t: 'text', v: ' and ' },
      { t: 'strongs', id: 'G0025', label: 'G25' },
      { t: 'text', v: '.' },
    ]);
  });

  it('renders lang-tagged spans and word-study links, never a link inside a verse link', () => {
    const nodes = parseDefinition('<b>ἀγαπάω</b> (H157 אָהַב) see <span class="ref" data-ref="JHN.3.16">G26 Jn 3:16</span>');
    const { container } = render(<DefText nodes={nodes} hrefFor={() => '#/KJV/JHN/3/16'} />);
    expect(container.querySelector('b [lang="grc"]')?.textContent).toBe('ἀγαπάω');
    const he = container.querySelector('[lang="he"]')!;
    expect(he.textContent).toBe('אָהַב');
    expect(he.getAttribute('dir')).toBe('rtl');
    const sn = container.querySelector('a.sn')!;
    expect(sn.getAttribute('href')).toBe('#/word/H0157');
    expect(container.querySelectorAll('a.ref a').length).toBe(0);
    expect(container.querySelector('a.ref')!.textContent).toBe('G26 Jn 3:16');
  });

  it('labels entries written for Rootword as such', () => {
    expect(lexSource({ id: 'H2050b', def: 'x', src: 'rootword' })).toMatch(/^Rootword/);
    expect(lexSource({ id: 'H2050', def: 'x' })).toMatch(/Brown-Driver-Briggs/);
  });
});

describe('notes longer than the editor limit', () => {
  const note = (text: string, updated: string) => ({ text, created: updated, updated });

  it('a merged note survives the next load and the next edit', () => {
    const a = `${'A'.repeat(9000)} end-of-mine`;
    const b = `${'B'.repeat(9000)} end-of-imported`;
    const { data } = mergeStudy(
      { highlights: {}, bookmarks: {}, notes: { 'JHN.3.18': note(a, '2026-01-01T00:00:00Z') } },
      { highlights: {}, bookmarks: {}, notes: { 'JHN.3.18': note(b, '2026-02-01T00:00:00Z') } },
    );
    const merged = data.notes['JHN.3.18'].text;
    expect(merged.length).toBeGreaterThan(MAX_NOTE_LENGTH);
    expect(merged.length).toBeLessThanOrEqual(MAX_STORED_NOTE_LENGTH);
    const loaded = migrateStudy(JSON.parse(serializeStudy(data)))!;
    expect(loaded.data.notes['JHN.3.18'].text).toBe(merged);
    expect(sanitizeStudy({ notes: { 'JHN.3.18': note('x'.repeat(30000), '2026-01-01T00:00:00Z') } }).data.notes['JHN.3.18'].text.length).toBe(
      MAX_STORED_NOTE_LENGTH,
    );
    // editing the long note (here: deleting its last character) keeps it whole, not cut to the
    // editor's limit; it cannot grow past what is stored (the editor's maxLength says the same)
    notes.value = { 'JHN.3.18': data.notes['JHN.3.18'] };
    expect(setNote('JHN.3.18', merged.slice(0, -1))!.text).toBe(merged.slice(0, -1));
    expect(setNote('JHN.3.18', `${merged}!!`)!.text.length).toBe(merged.length - 1);
    notes.value = {};
  });
});

describe('reading place per history entry', () => {
  beforeEach(() => {
    history.replaceState(null, '', '#/KJV/PSA/119');
    readerHooks.capture = null;
    readerHooks.beforeReflow = null;
  });

  it('keys reading hashes by chapter', () => {
    expect(keyOfHash('#/KJV/JHN/3/16')).toBe('KJV/JHN/3');
    expect(keyOfHash('#/word/G26')).toBeNull();
    expect(isPlace({ key: 'KJV/JHN/3', verse: 4, offset: -12 })).toBe(true);
    expect(isPlace({ key: 'KJV/JHN/3', verse: 1.5, offset: 0 })).toBe(false);
  });

  it('saves into the current entry only while it shows that chapter', () => {
    savePlace({ key: 'KJV/PSA/119', verse: 99, offset: -20 });
    expect(savedPlace('KJV/PSA/119')).toEqual({ key: 'KJV/PSA/119', verse: 99, offset: -20 });
    expect(savedPlace('BSB/PSA/119')).toBeNull();
    savePlace({ key: 'KJV/PSA/120', verse: 3, offset: 0 }); // not the chapter in the URL
    expect(savedPlace('KJV/PSA/119')?.verse).toBe(99);
  });

  it('flushes the place into the entry being left before navigating', async () => {
    readerHooks.capture = () => ({ key: 'KJV/PSA/119', verse: 50, offset: -30 });
    goToHash('#/KJV/PSA/120');
    // the old entry was written before the hash changed
    history.back();
    await new Promise((r) => setTimeout(r, 30));
    expect(location.hash).toBe('#/KJV/PSA/119');
    expect(savedPlace('KJV/PSA/119')?.verse).toBe(50);
  });

  it('asks the reader to keep its place before text-size and layout changes', () => {
    const before = vi.fn();
    readerHooks.beforeReflow = before;
    const cur = fontScale.value;
    setFontScale(cur === 1.3 ? 1.6 : 1.3);
    updateSettings({ lineSpacing: settings.value.lineSpacing === 1.2 ? 1 : 1.2 });
    updateSettings({ haptics: !settings.value.haptics }); // no reflow
    expect(before).toHaveBeenCalledTimes(2);
  });
});

describe('links followed while a sheet is open', () => {
  it('replace the sheet’s Back marker instead of pushing past it', () => {
    history.replaceState(null, '', '#/KJV/JHN/3');
    history.pushState({ rwSheet: 'sX', rwXref: 'x1' }, '');
    const len = history.length;
    goToHash('#/compare/KJV,BSB/JHN/3/16');
    expect(history.length).toBe(len);
    expect(location.hash).toBe('#/compare/KJV,BSB/JHN/3/16');
    expect(history.state).toEqual({});
  });
});

describe('panels give keyboard focus back', () => {
  it('returns focus to the trigger when it would be lost, but not while an arrival is pending', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0, toJSON: () => '' });
    btn.getClientRects = () => [btn.getBoundingClientRect()] as unknown as DOMRectList;
    openPanel('translations', btn);
    (document.activeElement as HTMLElement | null)?.blur();
    closePanel();
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    expect(document.activeElement).toBe(btn);
    expect(panel.value).toBeNull();

    btn.blur();
    openPanel('books', btn);
    focusOnArrival(passage.value.tr, { book: 'ROM', chapter: 8, verse: 28 });
    closePanel();
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    expect(document.activeElement).not.toBe(btn);
    expect(arrival.value).toMatchObject({ key: `${passage.value.tr}/ROM/8`, verse: 28 });
    arrival.value = null;
    btn.remove();
  });
});

describe('translation picker', () => {
  it('is one Tab stop; arrow keys move between translations without choosing', async () => {
    const { meta } = await import('../../src/app/state');
    const { TranslationPicker } = await import('../../src/components/header/TranslationPicker');
    meta.value = {
      version: 't',
      generated: '',
      translations: ['KJV', 'BSB', 'WEB'].map((id) => ({ id, name: id, abbr: id, year: '', license: 'Public domain', alignment: 'manual', description: '', source: '' })),
      books: [],
      credits: [],
    } as unknown as NonNullable<typeof meta.value>;
    passage.value = { tr: 'KJV', ref: { book: 'JHN', chapter: 3 } };
    const anchor = { current: document.createElement('button') };
    const onClose = vi.fn();
    render(<TranslationPicker open onClose={onClose} anchor={anchor} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[1]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(radios[1], { key: 'End' });
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(radios[2], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[0]);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Compare side by side/ }).getAttribute('href')).toBe('#/compare/KJV,BSB/JHN/3');
    meta.value = null;
  });
});
