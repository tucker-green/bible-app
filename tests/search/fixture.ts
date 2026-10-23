import { SearchEngine } from '../../src/lib/search/engine';
import type { LexIndex, SearchCorpus } from '../../src/lib/types';

/** A tiny corpus in canonical order. */
export const CORPUS: SearchCorpus = {
  tr: 'TST',
  verses: [
    [1, 1, 1, 'In the beginning God created the heavens and the earth.'],
    [1, 1, 2, 'Now the earth was formless and void.'],
    [1, 1, 3, 'And God said, “Let there be light,” and there was light.'],
    [1, 1, 11, 'Then God said, “Let the earth bring forth seed-bearing plants.”'],
    [1, 22, 2, '“Take your son,” God said, “your only son Isaac, whom you love, and go to the land of Moriah.”'],
    [19, 23, 1, 'The LORD is my shepherd; I shall not want.'],
    [40, 5, 44, 'But I tell you, love your enemies and pray for those who persecute you,'],
    [43, 1, 1, 'In the beginning was the Word, and the Word was with God, and the Word was God.'],
    [43, 3, 16, 'For God so loved the world that He gave His one and only Son.'],
    [43, 11, 35, 'Jesus wept.'],
    [43, 13, 34, 'A new commandment I give you: Love one another. As I have loved you, so you also must love one another.'],
    [45, 5, 5, 'And hope does not disappoint us, because God’s love has been poured out into our hearts.'],
    [46, 13, 13, 'And now these three remain: faith, hope, and love; but the greatest of these is love.'],
    [62, 4, 8, 'Whoever does not love does not know God, because God is love.'],
  ],
};

export const LEX: LexIndex = [
  ['G0025', 'ἀγαπάω', 'agapaō', 'to love'],
  ['G0026', 'ἀγάπη', 'agapē', 'love'],
  ['G3056', 'λόγος', 'logos', 'word'],
  ['H7225', 'רֵאשִׁית', 'reshit', 'first: beginning'],
  ['H0871a', 'בְּ', 'be', 'in'],
];

export const CONC: Record<string, number[]> = {
  G0025: [40005044, 43003016, 43013034, 62004008],
  G0026: [45005005, 46013013, 62004008],
  G3056: [43001001],
  H7225: [1001001],
  H0871: [1001001],
};

export function makeEngine() {
  const calls = { corpus: 0, lex: 0, conc: [] as string[] };
  const engine = new SearchEngine({
    loadCorpus: async (tr) => {
      calls.corpus++;
      if (tr !== 'TST') throw new Error(`no corpus ${tr}`);
      return CORPUS;
    },
    loadLexIndex: async () => {
      calls.lex++;
      return LEX;
    },
    loadConcordance: async (id) => {
      calls.conc.push(id);
      return CONC[id.slice(0, 5)] ?? [];
    },
  });
  return { engine, calls };
}
