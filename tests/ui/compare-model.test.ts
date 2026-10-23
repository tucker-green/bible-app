/**
 * Compare page model (src/components/compare/model.ts): translation choice, the merged unit space
 * that makes words of every column link to the same original words, and the grid HTML adapter
 * over the reader's render.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCompareModel,
  cellHtml,
  compareGridHtml,
  compareKey,
  counterpartUnits,
  headingsOf,
  nextTranslation,
  partnerFor,
  removeColumn,
  resolveCompareTrs,
  setColumn,
  verseText,
} from '../../src/components/compare/model';
import type { CompareInput } from '../../src/components/compare/model';
import { linkedUnits, relatedUnits } from '../../src/components/reader/model';
import type { TextChapter } from '../../src/lib/types';
import { GEN1_ORIG, JHN1_KJV, JHN1_ORIG } from './fixtures';

const TRS = ['KJV', 'BSB', 'WEB', 'ASV', 'YLT'].map((id) => ({ id }));

/** BSB John 1:1 (hand-aligned: "the" and "Word" are separate units) with a section heading; no verse 2. */
const JHN1_BSB: TextChapter = {
  tr: 'BSB',
  book: 'JHN',
  chapter: 1,
  headings: [[1, 'The Beginning']],
  verses: [
    {
      v: 1,
      t: [
        ['In', [0]],
        ' ',
        ['the', [1]],
        ' ',
        ['beginning', [1]],
        ' ',
        ['was', [2]],
        ' ',
        ['the', [3]],
        ' ',
        ['Word', [4]],
        ', ',
        ['and', [5]],
        ' ',
        ['the', [6]],
        ' ',
        ['Word', [7]],
        ' ',
        ['was', [8]],
        ' ',
        ['with', [9]],
        ' ',
        ['God', [11]],
        '.',
      ],
    },
  ],
};

const input = (text: TextChapter | null, tr = text?.tr ?? 'WEB'): CompareInput => ({
  tr,
  abbr: tr,
  name: tr === 'KJV' ? 'King James Version' : tr === 'BSB' ? 'Berean Standard Bible' : 'World English Bible',
  alignment: tr === 'KJV' ? 'strongs' : tr === 'BSB' ? 'manual' : 'bridged',
  text,
});

const model = () => buildCompareModel([input(JHN1_KJV), input(JHN1_BSB)], JHN1_ORIG, 'JHN', 1);
const unitByText = (cm: ReturnType<typeof model>, col: number, text: string, nth = 0) =>
  cm.units.filter((u) => cm.colOfUnit[u.id] === col && u.text === text)[nth];

describe('translation choice', () => {
  it('resolves like the reader: case-insensitive, unknown → KJV, no repeats, two to three', () => {
    expect(resolveCompareTrs(['KJV', 'BSB'], TRS)).toEqual(['KJV', 'BSB']);
    expect(resolveCompareTrs(['kjv', 'web'], TRS)).toEqual(['KJV', 'WEB']);
    expect(resolveCompareTrs(['XYZ', 'BSB'], TRS)).toEqual(['KJV', 'BSB']);
    // an unknown one that resolves to a column already there is topped up (KJV, then BSB, …)
    expect(resolveCompareTrs(['XYZ', 'KJV'], TRS)).toEqual(['KJV', 'BSB']);
    expect(resolveCompareTrs(['NIV', 'KJV', 'BSB'], TRS)).toEqual(['KJV', 'BSB']);
    expect(resolveCompareTrs(['WEB', 'ASV', 'YLT', 'KJV'], TRS)).toEqual(['WEB', 'ASV', 'YLT']);
    // nothing known yet: unchanged
    expect(resolveCompareTrs(['NIV', 'KJV'], [])).toEqual(['NIV', 'KJV']);
  });

  it('switches, swaps, removes and adds columns', () => {
    expect(setColumn(['KJV', 'BSB'], 1, 'WEB')).toEqual(['KJV', 'WEB']);
    expect(setColumn(['KJV', 'BSB'], 0, 'BSB')).toEqual(['BSB', 'KJV']); // already a column: swap
    expect(setColumn(['KJV', 'BSB'], 1, 'BSB')).toEqual(['KJV', 'BSB']);
    expect(removeColumn(['KJV', 'BSB', 'WEB'], 1)).toEqual(['KJV', 'WEB']);
    expect(removeColumn(['KJV', 'BSB'], 0)).toEqual(['KJV', 'BSB']); // never below two
    expect(nextTranslation(['KJV', 'BSB'], TRS)).toBe('WEB');
    expect(nextTranslation(['BSB', 'WEB'], TRS)).toBe('KJV');
    expect(nextTranslation(['KJV', 'BSB', 'WEB'], TRS)).toBeNull();
    expect(partnerFor('KJV', TRS)).toBe('BSB');
    expect(partnerFor('WEB', TRS)).toBe('KJV');
    expect(partnerFor('KJV', [{ id: 'KJV' }, { id: 'ASV' }])).toBe('ASV');
  });
});

describe('merged model', () => {
  it('numbers units column after column, keyed for the word card and per column for the verse sheet', () => {
    const cm = model();
    expect(cm.key).toBe(compareKey(['KJV', 'BSB'], 'JHN', 1));
    expect(cm.key).toBe('compare:KJV,BSB/JHN/1');
    cm.units.forEach((u, i) => expect(u.id).toBe(i));
    const [kjv, bsb] = cm.columns;
    expect(kjv.firstUnit).toBe(0);
    expect(bsb.firstUnit).toBe(kjv.unitCount);
    expect(kjv.unitCount + bsb.unitCount).toBe(cm.units.length);
    expect(cm.colOfUnit.slice(0, kjv.unitCount).every((c) => c === 0)).toBe(true);
    expect(cm.colOfUnit.slice(kjv.unitCount).every((c) => c === 1)).toBe(true);
    // the word card sees the compare key and the column's own translation
    expect(kjv.model.key).toBe(cm.key);
    expect(bsb.model.key).toBe(cm.key);
    expect(bsb.model.tr).toBe('BSB');
    expect(bsb.model.alignment).toBe('manual');
    expect(bsb.model.units).toBe(cm.units);
    // the verse sheets see "TR/BOOK/CHAPTER"
    expect(kjv.sheetModel.key).toBe('KJV/JHN/1');
    expect(bsb.sheetModel.key).toBe('BSB/JHN/1');
    // the pieces of each column's verses point at the merged units
    for (const c of cm.columns)
      for (const v of c.model.verses) for (const p of v.pieces) if (typeof p !== 'string') expect(cm.units[p.id]).toBe(p);
    // rows: union of the verses (verse 2 is only in the KJV)
    expect(cm.rows).toEqual([1, 2]);
    expect(cm.merged).toBe(kjv.model);
  });

  it('links a word to the words of every other column that render the same original word', () => {
    const cm = model();
    const kjvWord = unitByText(cm, 0, 'the Word'); // KJV "the Word" → ὁ λόγος [3, 4]
    const bsbThe = unitByText(cm, 1, 'the'); // BSB "the" → ὁ [3] ("the beginning" is one unit)
    const bsbWord = unitByText(cm, 1, 'Word'); // BSB "Word" → λόγος [4]
    expect(kjvWord.links).toEqual([3, 4]);
    expect(counterpartUnits(cm, kjvWord.id)).toEqual([bsbThe.id, bsbWord.id]);
    // (the fixture's invented KJV verse 2 links "the Word" to the same ὁ λόγος again)
    const kjvWord2 = unitByText(cm, 0, 'the Word', 2);
    expect(kjvWord2.verse).toBe(2);
    expect(counterpartUnits(cm, bsbWord.id)).toEqual([kjvWord.id, kjvWord2.id]);
    // the reader's own linkedUnits() on the merged model does the cross-highlight
    expect(linkedUnits(cm.merged, bsbWord.id)).toEqual([kjvWord.id, kjvWord2.id, bsbWord.id].sort((a, b) => a - b));
    // related words (same Strong's elsewhere) span the columns too: λόγος at [7] in both
    const related = relatedUnits(cm.merged, bsbWord.id);
    expect(related.some((id) => cm.colOfUnit[id] === 0)).toBe(true);
    expect(related.some((id) => cm.colOfUnit[id] === 1)).toBe(true);
    // supplied / lexicon-only words have no counterparts
    const supplied = unitByText(cm, 0, 'It is');
    expect(supplied.kind).toBe('supplied');
    expect(counterpartUnits(cm, supplied.id)).toEqual([]);
  });

  it('keeps a column that is loading or failed in place, empty', () => {
    const cm = buildCompareModel([input(JHN1_KJV), input(null, 'WEB')], JHN1_ORIG, 'JHN', 1);
    expect(cm.columns[1].available).toBe(false);
    expect(cm.columns[1].unitCount).toBe(0);
    expect(cm.rows).toEqual([1, 2]);
    const html = compareGridHtml(cm);
    expect(html.match(/class="cmp-cell is-empty" data-col="1"><\/div>/g)?.length).toBe(2);
  });
});

describe('grid HTML', () => {
  it('renders each verse with the reader renderer, without repeated ids, with a run-in label', () => {
    const cm = model();
    const [kjv, bsb] = cm.columns;
    const a = cellHtml(kjv, 1, 'verses');
    expect(a.startsWith('<p class="vl"><span class="cmp-lbl">')).toBe(true);
    expect(a).toContain('<span class="cmp-lbl__abbr" aria-hidden="true">KJV</span><span class="sr-only">King James Version: </span>');
    expect(a).not.toMatch(/ id="v\d+"/);
    expect(a).toContain('class="verse" data-v="1"');
    expect(a).toContain('data-vn="1"');
    expect(a).toContain('data-u="0" tabindex="0"');
    const b = cellHtml(bsb, 1, 'verses');
    expect(b).toContain(`data-u="${bsb.firstUnit}" tabindex="-1"`);
    expect(b).not.toContain('tabindex="0"');
    // a verse the translation does not have
    expect(cellHtml(bsb, 2, 'verses')).toContain('Verse 2 is not in the BSB');
  });

  it('puts section headings above the rows and makes one tab stop in the whole grid', () => {
    const cm = model();
    const html = compareGridHtml(cm, headingsOf(JHN1_BSB));
    expect(html.indexOf('<h2 class="sec cmp-sec" data-sec="1">')).toBe(0);
    expect(html).toContain('<span class="sec__title">The Beginning</span><span class="sec__ref">1:1</span>');
    expect(html.match(/class="cmp-row" data-row="\d+"/g)).toEqual(['class="cmp-row" data-row="1"', 'class="cmp-row" data-row="2"']);
    expect(html.match(/data-col="0"/g)?.length).toBe(2);
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(headingsOf(JHN1_KJV).size).toBe(0);
  });

  it('gives a Psalm title its own row and keeps Hebrew links', () => {
    const psa: TextChapter = {
      tr: 'KJV',
      book: 'GEN',
      chapter: 1,
      superscription: [['In', [0]], ' ', ['the beginning', [1]]],
      verses: [{ v: 1, t: [['created', [2]], '.'] }],
    };
    const other: TextChapter = { ...psa, tr: 'BSB', superscription: undefined };
    const cm = buildCompareModel([input(psa), input(other)], GEN1_ORIG, 'GEN', 1);
    expect(cm.rows).toEqual([0, 1]);
    const html = compareGridHtml(cm);
    expect(html).toContain('class="cmp-row cmp-row--title" data-row="0"');
    expect(html).toContain('<p class="superscription" data-v="0"><span class="cmp-lbl">');
    expect(html).toContain('No title in the BSB');
    const created = cm.units.filter((u) => u.text === 'created');
    expect(counterpartUnits(cm, created[0].id)).toEqual([created[1].id]);
  });

  it('gives the plain text of a verse', () => {
    expect(verseText(JHN1_BSB, 1)).toBe('In the beginning was the Word, and the Word was with God.');
    expect(verseText(JHN1_BSB, 2)).toBeNull();
  });
});
