import { describe, expect, it } from 'vitest';
import { buildChapterModel } from '../../src/components/reader/model';
import { bookEyebrow, buildCardModel, cardSummary, displayStrongs, htmlLang, unitReference } from '../../src/components/word/cardModel';
import { GEN1_BSB, GEN1_ORIG, JHN1_KJV, JHN1_ORIG } from './fixtures';

describe('word card model', () => {
  const kjv = buildChapterModel(JHN1_KJV, JHN1_ORIG, { alignment: 'strongs', tr: 'KJV' });
  const unit = (text: string) => kjv.units.find((u) => u.text === text)!;

  it('shows the content word as primary and lists the article with it', () => {
    const c = buildCardModel(kjv, unit('the Word'));
    expect(c).toMatchObject({
      kind: 'linked',
      english: 'the Word',
      reference: 'John 1:1',
      lang: 'grc',
      langLabel: 'Greek',
      edition: 'SBLGNT',
      headword: 'λόγος',
      translit: 'logos',
      strongs: 'G3056',
      strongsLabel: 'G3056',
      gloss: 'word',
      lemma: 'λόγος',
    });
    expect(c.others.map((w) => w.text)).toEqual(['ὁ']);
    expect(c.parsing?.ok).toBe(true);
    expect(cardSummary(c)).toBe('λόγος, logos, noun: word');
  });

  it('builds a Textus Receptus card for lexicon-only KJV words', () => {
    const c = buildCardModel(kjv, unit('preferred'));
    expect(c).toMatchObject({ kind: 'lexicon', strongs: 'G1096', headword: 'γεγονεν', edition: 'Textus Receptus', morph: 'V-2RAI-3S' });
    expect(c.note).toMatch(/Textus Receptus/);
  });

  it('builds a supplied-word card', () => {
    const c = buildCardModel(kjv, unit('It is'));
    expect(c.kind).toBe('supplied');
    expect(c.strongs).toBe('');
    expect(cardSummary(c)).toMatch(/supplied by the translators/);
  });

  it('shows the whole Hebrew word with the linked morphemes, and the Septuagint', () => {
    const bsb = buildChapterModel(GEN1_BSB, GEN1_ORIG, { alignment: 'manual', tr: 'BSB' });
    const c = buildCardModel(bsb, bsb.units[0]); // "In the beginning" -> בְּ + רֵאשִׁית
    expect(c.headword).toBe('בְּרֵאשִׁית');
    expect(c.morphemes.map((m) => [m.text, m.linked, m.primary])).toEqual([
      ['בְּ', true, false],
      ['רֵאשִׁית', true, true],
    ]);
    expect(c).toMatchObject({ lang: 'hbo', langLabel: 'Hebrew', strongs: 'H7225', strongsLabel: 'H7225', gloss: 'in beginning' });
    expect(c.lxx).toMatchObject({ text: 'ἀρχῇ', strongs: 'G0746', strongsLabel: 'G746' });
    const god = buildCardModel(bsb, bsb.units[1]);
    expect(god).toMatchObject({ headword: 'אֱלֹהִים', strongsLabel: 'H430', translit: 'ʾĕlōhiym' });
    expect(god.morphemes).toEqual([]);
  });

  it('emphasises only the linked morpheme of a written word', () => {
    const t = { ...GEN1_BSB, verses: [{ v: 1, t: [['the', [5]], ' ', ['heavens', [6]]] as [string, number[]][] }] };
    const m = buildChapterModel(t, GEN1_ORIG);
    const c = buildCardModel(m, m.units[0]);
    expect(c.headword).toBe('הַשָּׁמַיִם');
    expect(c.morphemes.map((x) => x.linked)).toEqual([true, false]);
  });

  it('formats references, Strong’s numbers, eyebrows and language tags', () => {
    expect(displayStrongs('G0026')).toBe('G26');
    expect(displayStrongs('H0871a')).toBe('H871a');
    expect(bookEyebrow('JHN')).toBe('New Testament · Gospel');
    expect(bookEyebrow('GEN')).toBe('Old Testament · Torah');
    expect(bookEyebrow('PSA')).toBe('Old Testament · Poetry');
    expect(bookEyebrow('ROM')).toBe('New Testament · Letters of Paul');
    expect(htmlLang('hbo')).toBe('he');
    expect(htmlLang('grc')).toBe('grc');
    const ps = buildChapterModel({ ...GEN1_BSB, book: 'PSA', chapter: 23, superscription: [['David', [3]]] }, GEN1_ORIG);
    expect(unitReference(ps, ps.units[0])).toBe('Psalm 23 title');
    expect(unitReference(kjv, unit('the Word'), '3:19')).toBe('John 1:1 (Heb. 3:19)');
  });
});
