import { describe, expect, it } from 'vitest';
import { buildChapterModel } from '../../src/components/reader/model';
import type { Piece, Unit } from '../../src/components/reader/model';
import {
  chooseLayout,
  escapeHtml,
  headingsByVerse,
  interlinearCells,
  renderChapterHtml,
  splitCola,
  typeset,
} from '../../src/components/reader/render';
import type { RenderOptions } from '../../src/components/reader/render';
import type { TextChapter } from '../../src/lib/types';
import { GEN1_BSB, GEN1_ORIG, JHN1_KJV, JHN1_ORIG } from './fixtures';

const opts = (o: Partial<RenderOptions> = {}): RenderOptions => ({
  mode: 'reading',
  layout: 'paragraphs',
  headings: true,
  ilTranslit: true,
  ilGloss: false,
  ...o,
});

function dom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

const fakeUnit = (id: number, text: string): Unit => ({
  id,
  verse: 1,
  text,
  wordCount: text.split(' ').length,
  kind: 'linked',
  links: [id],
  approx: false,
  conf: 1,
  strongs: [],
  morphs: [],
  forms: [],
  primary: id,
  kinKey: '',
});

describe('typesetting', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<img src=x onerror="a">&'`)).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  });

  it('sets the divine name in small capitals', () => {
    expect(typeset('The LORD is my shepherd')).toBe('The L<span class="sc">ORD</span> is my shepherd');
    expect(typeset('Lord GOD')).toBe('Lord G<span class="sc">OD</span>');
    expect(typeset('the LORD’S house')).toBe('the L<span class="sc">ORD’S</span> house');
    expect(typeset('LORDLY GODS')).toBe('LORDLY GODS');
  });
});

describe('chapter HTML', () => {
  it('renders every unit as a plain span with data-u and one tab stop', () => {
    const model = buildChapterModel(JHN1_KJV, JHN1_ORIG, { alignment: 'strongs' });
    const el = dom(renderChapterHtml(model, opts({ layout: 'verses' })));
    const spans = el.querySelectorAll('[data-u]');
    expect(spans.length).toBe(model.units.length);
    expect(el.querySelectorAll('[tabindex="0"]').length).toBe(1);
    expect(el.querySelector('#v1 .vn')?.textContent).toBe('1');
    expect(el.querySelectorAll('p.vl').length).toBe(2);
    // text content of verse 1 is preserved (minus the verse number / sr-only label)
    const v1 = el.querySelector('#v1')!;
    v1.querySelectorAll('.vn, .sr-only').forEach((n) => n.remove());
    expect(v1.textContent).toBe('In the beginning was the Word, and the Word was with God.');
  });

  it('marks supplied, lexicon-only and approximate words', () => {
    const model = buildChapterModel(JHN1_KJV, JHN1_ORIG, { alignment: 'strongs' });
    const el = dom(renderChapterHtml(model, opts()));
    expect(el.querySelector('.w--sup')?.textContent).toBe('It is');
    expect([...el.querySelectorAll('.w--lex')].map((n) => n.textContent)).toEqual(['preferred', 'before me']);
    const bridged = buildChapterModel(JHN1_KJV, JHN1_ORIG, { alignment: 'bridged' });
    expect(dom(renderChapterHtml(bridged, opts())).querySelectorAll('.w--approx').length).toBeGreaterThan(0);
  });

  it('escapes hostile token text', () => {
    const t: TextChapter = {
      tr: 'X',
      book: 'JHN',
      chapter: 1,
      headings: [[1, '<script>alert(1)</script>']],
      verses: [{ v: 1, t: [['<b>bold</b>', [1]], ' "q" <i>', ['x" onmouseover="alert(1)', [2]]] }],
    };
    const html = renderChapterHtml(buildChapterModel(t, JHN1_ORIG), opts());
    expect(html).not.toMatch(/<script|<b>|<i>|onmouseover="/);
    const el = dom(html);
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('[data-u="0"]')!.textContent).toBe('<b>bold</b>');
    expect(el.querySelector('.sec__title')!.textContent).toBe('<script>alert(1)</script>');
  });

  it('adds section headings with verse ranges and starts paragraphs', () => {
    const t: TextChapter = {
      tr: 'BSB',
      book: 'JHN',
      chapter: 1,
      headings: [
        [1, 'The Beginning'],
        [3, 'Witness'],
      ],
      paras: [2],
      verses: [1, 2, 3, 4].map((v) => ({ v, t: [['God', [11]], '.'] })),
    };
    const model = buildChapterModel(t, JHN1_ORIG);
    expect([...headingsByVerse(model).values()].flat().map((h) => h.range)).toEqual(['1:1–2', '1:3–4']);
    const el = dom(renderChapterHtml(model, opts()));
    expect([...el.querySelectorAll('.sec')].map((h) => h.textContent)).toEqual(['The Beginning1:1–2', 'Witness1:3–4']);
    expect(el.querySelectorAll('p.para').length).toBe(3); // 1 | 2 (para) | 3–4 (heading)
    expect(el.querySelectorAll('p.para.first').length).toBe(2);
    // without headings: no h2
    expect(dom(renderChapterHtml(model, opts({ headings: false }))).querySelectorAll('.sec').length).toBe(0);
  });

  it('stacks a major heading (no range) over a section heading at the same verse', () => {
    const t: TextChapter = {
      tr: 'BSB',
      book: 'PSA',
      chapter: 119,
      headings: [
        [1, 'Your Word Is a Lamp to My Feet'],
        [1, 'Aleph'],
        [9, 'Beth'],
      ],
      verses: [1, 2, 9, 10].map((v) => ({ v, t: [['God', [3]], '.'] })),
    };
    const model = buildChapterModel(t, GEN1_ORIG);
    expect(headingsByVerse(model).get(1)).toEqual([
      { text: 'Your Word Is a Lamp to My Feet', range: '', major: true },
      { text: 'Aleph', range: '119:1–8', major: false },
    ]);
    const el = dom(renderChapterHtml(model, opts({ layout: 'poetry' })));
    expect(el.querySelector('.sec--major')?.textContent).toBe('Your Word Is a Lamp to My Feet');
    expect(el.querySelectorAll('.sec:not(.sec--major) .sec__ref').length).toBe(2);
  });

  it('chooses verse-per-line for translations without paragraphs, poetry for Psalms', () => {
    const kjv = buildChapterModel(JHN1_KJV, JHN1_ORIG);
    expect(chooseLayout(kjv, 'auto')).toBe('verses');
    expect(chooseLayout(kjv, 'paragraphs')).toBe('paragraphs');
    const gen = buildChapterModel(GEN1_BSB, GEN1_ORIG);
    expect(chooseLayout(gen, 'auto')).toBe('paragraphs');
    const ps = buildChapterModel({ ...GEN1_BSB, book: 'PSA', chapter: 23 }, GEN1_ORIG);
    expect(chooseLayout(ps, 'auto')).toBe('poetry');
  });

  it('renders the superscription before verse 1 with linked words', () => {
    const t: TextChapter = { ...GEN1_BSB, book: 'PSA', chapter: 23, superscription: [['A', [3]], ' ', 'Psalm', '.'] };
    const el = dom(renderChapterHtml(buildChapterModel(t, GEN1_ORIG), opts({ layout: 'poetry' })));
    const sup = el.querySelector('.superscription')!;
    expect(sup.textContent).toBe('A Psalm.');
    expect(sup.querySelector('[data-u]')?.textContent).toBe('A');
    // heading first, then the superscription, then verse 1
    const order = [...el.children].map((c) => c.className.split(' ')[0]);
    expect(order.slice(0, 3)).toEqual(['sec', 'superscription', 'vl']);
  });

  it('splits poetic verses into cola', () => {
    const pieces: Piece[] = [fakeUnit(0, 'The LORD'), ' is my shepherd; ', fakeUnit(1, 'I'), ' shall not want.'];
    const cola = splitCola(pieces);
    expect(cola.length).toBe(2);
    expect(cola[0].map((p) => (typeof p === 'string' ? p : p.text)).join('')).toBe('The LORD is my shepherd;');
    expect(cola[1].map((p) => (typeof p === 'string' ? p : p.text)).join('')).toBe('I shall not want.');
  });
});

describe('interlinear', () => {
  it('attaches punctuation to the neighbouring English', () => {
    const pieces: Piece[] = [fakeUnit(0, 'said'), ', “', fakeUnit(1, 'Let'), ' there ', fakeUnit(2, 'be'), '.” And'];
    const cells = interlinearCells(pieces);
    expect(cells.map((c) => [c.en, c.unit?.id ?? null])).toEqual([
      ['said,', 0],
      ['“Let', 1],
      ['there', null],
      ['be.”', 2],
      ['And', null],
    ]);
  });

  it('keeps a leading mark on the first cell and a dangling one on the last', () => {
    expect(interlinearCells(['“', fakeUnit(0, 'In')]).map((c) => c.en)).toEqual(['“In']);
    expect(interlinearCells([fakeUnit(0, 'end'), ' —']).map((c) => c.en)).toEqual(['end—']);
  });

  it('stacks English over Greek with a transliteration line', () => {
    const model = buildChapterModel(JHN1_KJV, JHN1_ORIG, { alignment: 'strongs' });
    const el = dom(renderChapterHtml(model, opts({ mode: 'interlinear', layout: 'verses' })));
    const word = [...el.querySelectorAll('.il.w')].find((n) => n.querySelector('.il__en')?.textContent === 'the Word,')!;
    expect(word.querySelector('.il__or')?.textContent).toBe('ὁ λόγος');
    expect(word.querySelector('.il__or')?.getAttribute('lang')).toBe('grc');
    expect(word.querySelector('.il__tr')?.textContent).toBe('ho logos');
    expect(word.classList.contains('il--multi')).toBe(true);
    // supplied words: English only with a dash; paragraphs become flex rows
    const sup = el.querySelector('.w--sup')!;
    expect(sup.querySelector('.il__or')?.textContent).toBe('—');
    expect(el.querySelectorAll('.il-para').length).toBe(2);
  });

  it('keeps Hebrew right-to-left inside its stack and joins morphemes', () => {
    const model = buildChapterModel(GEN1_BSB, GEN1_ORIG, { alignment: 'manual' });
    const el = dom(renderChapterHtml(model, opts({ mode: 'interlinear', ilGloss: true })));
    const first = el.querySelector('.il.w')!;
    expect(first.querySelector('.il__en')?.textContent).toBe('In the beginning');
    const or = first.querySelector('.il__or')!;
    expect(or.textContent).toBe('בְּרֵאשִׁית');
    expect(or.getAttribute('lang')).toBe('he');
    expect(or.getAttribute('dir')).toBe('rtl');
    expect(first.querySelector('.il__tr')?.textContent).toBe('bərēʾšiyṯ');
    expect(first.querySelector('.il__gl')?.textContent).toBe('in beginning');
  });
});
