import { describe, expect, it } from 'vitest';
import { foldGreek, foldHebrew, hasGreek, hasHebrew, transliterate, translitKey } from '../src/lib/greek';

describe('transliterate', () => {
  const cases: [string, string][] = [
    ['λόγος', 'logos'],
    ['Ἰησοῦς', 'Iēsous'],
    ['ἀγάπη', 'agapē'],
    ['ὁ', 'ho'],
    ['εὐαγγέλιον', 'euangelion'],
    ['ῥῆμα', 'rhēma'],
    ['υἱός', 'huios'],
    ['οὗτος', 'houtos'],
    ['Οὗτος', 'Houtos'],
    ['αἷμα', 'haima'],
    ['Ἀβραάμ', 'Abraam'],
    ['Μωϋσῆς', 'Mōysēs'],
    ['Ἠσαΐας', 'Ēsaias'],
    ['ἐγκράτεια', 'enkrateia'],
    ['ἐλέγξει', 'elenxei'],
    ['συγχέω', 'syncheō'],
    ['ἄγγελος', 'angelos'],
    ['Χριστός', 'Christos'],
    ['ψυχή', 'psychē'],
    ['θεός', 'theos'],
    ['ΘΕΟΣ', 'THEOS'],
    ['Ὑμεῖς', 'Hymeis'],
    ['κἀγώ', 'kagō'],
    ['πνεῦμα', 'pneuma'],
    ['ἡμέρᾳ', 'hēmerą'],
    ['ἀρχῇ', 'archę̄'],
    ['ζωῇ', 'zōę̄'],
    ['τῷ', 'tǭ'],
    ['Ῥώμη', 'Rhōmē'],
    ['ἄρρητα', 'arrēta'],
    ['ηὐχόμην', 'ēuchomēn'],
    ['Ἐν ἀρχῇ ἦν ὁ λόγος,', 'En archę̄ ēn ho logos,'],
    ['τί ἐστιν;', 'ti estin?'],
    ['δι’ αὐτοῦ', 'di’ autou'],
    ['ἀλλʼ', 'all’'],
  ];
  for (const [g, t] of cases) {
    it(`${g} -> ${t}`, () => expect(transliterate(g)).toBe(t.normalize('NFC')));
  }

  it('supports other iota-subscript styles', () => {
    expect(transliterate('ἀρχῇ', { iotaSubscript: 'adscript' })).toBe('archēi');
    expect(transliterate('ἀρχῇ', { iotaSubscript: 'omit' })).toBe('archē');
    expect(transliterate('ᾅδης', { iotaSubscript: 'omit' })).toBe('hadēs');
  });

  it('leaves non-Greek text alone', () => {
    expect(transliterate('café 123 [x]')).toBe('café 123 [x]');
    expect(transliterate('')).toBe('');
  });
});

describe('foldGreek', () => {
  it('strips diacritics, lower-cases and folds final sigma', () => {
    expect(foldGreek('Λόγος')).toBe('λογοσ');
    expect(foldGreek('λόγος')).toBe(foldGreek('ΛΟΓΟΣ'));
    expect(foldGreek('ἀρχῇ')).toBe('αρχη');
    expect(foldGreek('Μωϋσῆς')).toBe('μωυσησ');
    expect(foldGreek('ὁ')).toBe(foldGreek('ο'));
  });
});

describe('foldHebrew', () => {
  it('strips niqqud and cantillation and normalises final letters', () => {
    expect(foldHebrew('בְּרֵאשִׁ֖ית')).toBe('בראשית');
    expect(foldHebrew('אֱלֹהִ֑ים')).toBe('אלהימ');
    expect(foldHebrew('אֱלֹהִים')).toBe(foldHebrew('אלהים'));
    expect(foldHebrew('הָאָֽרֶץ׃')).toBe('הארצ');
    expect(foldHebrew('כָּל־הָעָם')).toBe('כל העמ');
    // presentation forms (e.g. shin with shin dot, alef-lamed ligature)
    expect(foldHebrew('שׁ')).toBe('ש');
  });
});

describe('translitKey', () => {
  it('matches common spelling variants', () => {
    expect(translitKey('kyrios')).toBe(translitKey('kurios'));
    expect(translitKey('agape')).toBe(translitKey('agapē'));
    expect(translitKey('dabar')).toBe(translitKey('davar'));
    expect(translitKey('elohiym')).toBe(translitKey('elohim'));
    expect(translitKey('ʾĕlōhîm')).toBe(translitKey('elohim'));
    expect(translitKey('chesed')).toBe(translitKey('hesed'));
    expect(translitKey('Shabbat')).toBe(translitKey('shabat'));
    expect(translitKey('logos')).not.toBe(translitKey('logia'));
  });
});

describe('script detection', () => {
  it('detects Greek and Hebrew', () => {
    expect(hasGreek('λόγος')).toBe(true);
    expect(hasGreek('logos')).toBe(false);
    expect(hasHebrew('שָׁלוֹם')).toBe(true);
    expect(hasHebrew('shalom')).toBe(false);
  });
});
