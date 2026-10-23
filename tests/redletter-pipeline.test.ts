import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addVotes,
  alignWords,
  applyRed,
  asSource,
  checkVerse,
  layoutVerse,
  markFromOrig,
  markFromSource,
  mergeStrings,
  origFlags,
  parseOsisRed,
  parseUsfxRed,
  smoothSpeech,
  switchFactor,
  textScores,
  tokenText,
  wordFlagsOf,
  wordMatch,
} from '../scripts/data/redletter';
import type { OrigChapter, OrigWord, TextChapter, TextVerse, Token } from '../src/lib/types';

/** The verse with red tokens in [brackets] (adjacent red tokens joined). */
function show(v: TextVerse): string {
  const red = new Set<number>();
  for (const [a, b] of v.wj ?? []) for (let i = a; i < b; i++) red.add(i);
  return v.t
    .map((t, i) => (red.has(i) ? `[${tokenText(t)}]` : tokenText(t)))
    .join('')
    .replace(/\]\[/g, '');
}

/**
 * Tokens from a compact notation: "word/N" is a word token linked to orig word N, "word/" an unlinked
 * word token; everything else is literal text ("him/4, Suffer/5" -> ["him",[4]], ", ", ["Suffer",[5]]).
 */
function toks(spec: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of spec.matchAll(/([\p{L}’']+)\/(\d*)/gu)) {
    if (m.index! > last) out.push(spec.slice(last, m.index));
    out.push([m[1], m[2] ? [Number(m[2])] : []]);
    last = m.index! + m[0].length;
  }
  if (last < spec.length) out.push(spec.slice(last));
  return out;
}

/** wj covering the tokens from the first token with text `word` to the end. */
const redFrom = (t: Token[], word: string): [number, number][] => [[t.findIndex((x) => tokenText(x) === word), t.length]];

describe('redletter: source parsing', () => {
  it('reads OSIS <q who="Jesus"> milestones per verse, skipping titles and non-canonical books', () => {
    const xml = `<osis><osisText>
      <div type="book" osisID="Tob"><verse osisID="Tob.1.1" sID="a"/><q who="Jesus" sID="x"/>Not canon<q eID="x"/><verse eID="a"/></div>
      <div type="book" osisID="Matt"><chapter osisRef="Matt.3" sID="c3"/>
      <title>Heading</title>
      <verse osisID="Matt.3.14" sID="v14"/>But John forbad him.<verse eID="v14"/>
      <verse osisID="Matt.3.15" sID="v15"/>And Jesus answering said unto him,
      <q who="Jesus" sID="q1" marker=""/>Suffer <transChange type="added">it to be so</transChange> now: for thus it becometh us.
      <q eID="q1"/> Then he suffered him.<verse eID="v15"/></div></osisText></osis>`;
    const bible = parseOsisRed(xml);
    expect([...bible.keys()]).toEqual(['MAT 3']);
    const ch = bible.get('MAT 3')!;
    expect(ch.has(14)).toBe(false); // no red words: not kept
    const v = ch.get(15)!;
    const red = v.words.filter((_, i) => v.red[i]).join(' ');
    expect(red).toBe('Suffer it to be so now for thus it becometh us');
    expect(v.words.slice(0, 6).every((_, i) => !v.red[i])).toBe(true);
    expect(v.red[v.red.length - 1]).toBe(false); // "him"
  });

  it('reads USFX <wj> spans, also across verse boundaries, without footnotes', () => {
    const xml = `<usfx><book id="JHN"><c id="3"/><p><v id="15"/>So <wj>that whoever believes<f caller="+">footnote words</f> has life.</ve><v id="16"/>For God so loved the world.</wj> He went.<ve/></p></book></usfx>`;
    const bible = parseUsfxRed(xml.replace('</ve>', '<ve/>'));
    const ch = bible.get('JHN 3')!;
    expect(ch.get(15)!.words).toEqual(['So', 'that', 'whoever', 'believes', 'has', 'life']);
    expect(ch.get(15)!.red).toEqual([false, true, true, true, true, true]);
    const v16 = ch.get(16)!;
    expect(v16.words.filter((_, i) => v16.red[i])).toEqual(['For', 'God', 'so', 'loved', 'the', 'world']);
    expect(v16.red.slice(-2)).toEqual([false, false]);
  });
});

describe('redletter: word alignment', () => {
  it('matches words exactly or as spelling variants', () => {
    expect(wordMatch('LORD', 'Lord')).toBe(3);
    expect(wordMatch('Saviour', 'Savior')).toBe(2);
    expect(wordMatch('throughly', 'thoroughly')).toBe(2);
    expect(wordMatch('the', 'thy')).toBe(0);
  });

  it('aligns two editions word by word, leaving extra words unmatched', () => {
    const src = ['Suffer', 'it', 'to', 'be', 'so', 'now', 'for', 'thus'];
    const tgt = ['Suffer', 'it', 'now', 'for', 'so', 'thus'];
    expect(alignWords(src, tgt)).toEqual([0, 1, 5, 6, -1, 7]);
  });
});

describe('redletter: speech segmentation', () => {
  it('switches colour where punctuation and quotation marks allow', () => {
    expect(switchFactor(', “')).toBeLessThan(switchFactor(', '));
    expect(switchFactor(', ')).toBeLessThan(switchFactor(' '));
    // said(black) to(black) them(black) , “ I(?) will(red) come(red)
    const gaps = ['', ' ', ' ', ', “', ' ', ' ', '.”'];
    expect(smoothSpeech([-1, -1, -1, 0, 1, 1], gaps)).toEqual([false, false, false, true, true, true]);
    // without a quotation mark the unknown word stays with the narrative
    expect(smoothSpeech([-1, -1, -1, 0, 1, 1], ['', ' ', ' ', ' ', ' ', ' ', '.'])).toEqual([false, false, false, false, true, true]);
  });

  it('flips one mislinked word inside a speech but keeps a narrative interjection', () => {
    const plain = (n: number) => ['', ...new Array(n - 1).fill(' '), ''];
    expect(smoothSpeech([1, 1, -1, 1, 1], plain(5))).toEqual([true, true, true, true, true]);
    // “…,” he said, “…” — two black words between quotation marks stay black
    const gaps = ['“', ' ', ',” ', ' ', ', “', ' ', '”'];
    expect(smoothSpeech([1, 1, -1, -1, 1, 1], gaps)).toEqual([true, true, false, false, true, true]);
  });
});

describe('redletter: tokens and punctuation', () => {
  it('colours closing punctuation and opening quotation marks, splitting narrative strings', () => {
    const t = toks('But/1 Jesus/2 said/3 to/4 him/5, “Allow/6 it/7 now/8.” Then/9 he/10 allowed/11 him/12.');
    const layout = layoutVerse(t);
    const red = layout.words.map((w) => ['Allow', 'it', 'now'].includes(w.text));
    const res = applyRed(t, layout, red);
    const v: TextVerse = { v: 15, t: res.t, wj: res.wj };
    expect(show(v)).toBe('But Jesus said to him, [“Allow it now.”] Then he allowed him.');
    expect(res.t.map(tokenText).join('')).toBe(t.map(tokenText).join(''));
    expect(res.t).toContain(', ');
    expect(res.t).toContain('“');
  });

  it('marks a KJV verse from a slightly different edition and is idempotent', () => {
    const v: TextVerse = { v: 15, t: toks('And/1 Jesus/2 answering/3 said/3 unto/ him/4, Suffer/5 it/ to/ be/ so/ now/6: for/7 thus/8 it/ becometh/9 us/10 to/ fulfil/11 all/12 righteousness/13. Then/14 he/ suffered/15 him/16.') };
    const src = {
      words: 'And Jesus answering said unto him Suffer it to be so now for thus it becometh us to fulfill all righteousness Then he suffered him'.split(' '),
      red: 'n n n n n n y y y y y y y y y y y y y y y n n n n'.split(' ').map((x) => x === 'y'),
    };
    const once = markFromSource(v, src);
    expect(show(once)).toBe('And Jesus answering said unto him, [Suffer it to be so now: for thus it becometh us to fulfil all righteousness.] Then he suffered him.');
    checkVerse(v, once, 'test');
    const twice = markFromSource(once, src);
    expect(twice).toEqual(once);
    // and with no source verse the old ranges are removed and the strings merged back
    expect(markFromSource(once, undefined)).toEqual({ v: 15, t: mergeStrings(once.t) });
  });

  it('reports the red words of a verse', () => {
    const v = markFromSource(
      { v: 1, t: toks('He/1 said/2, Come/3 here/4.') },
      { words: ['He', 'said', 'Come', 'here'], red: [false, false, true, true] },
    );
    expect(wordFlagsOf(layoutVerse(v.t), v.wj)).toEqual([false, false, true, true]);
    expect(asSource(v)).toEqual({ words: ['He', 'said', 'Come', 'here'], red: [false, false, true, true] });
  });
});

describe('redletter: propagation through the original words', () => {
  // orig: 0 ἀπεκρίθη 1 Ἰησοῦς 2 καὶ 3 εἶπεν 4 αὐτῷ 5 ἀμὴν 6 λέγω 7 σοι 8 ἐὰν 9 μή
  const w = (text: string, verse = 3): OrigWord => [text, '', text, '', '', verse, '', 0, '', ''];
  const orig: OrigChapter = {
    book: 'JHN',
    chapter: 3,
    lang: 'grc',
    edition: 'SBLGNT',
    words: ['ἀπεκρίθη', 'Ἰησοῦς', 'καὶ', 'εἶπεν', 'αὐτῷ', 'ἀμὴν', 'λέγω', 'σοι', 'ἐὰν', 'μή'].map((x) => w(x)),
  };
  const kjvTokens = toks('Jesus/1 answered/0 and/2 said/3 unto/4 him/4, Verily/5, I/6 say/6 unto/7 thee/7, Except/8 a/ man/ be/ born/ again/.');
  const marked: TextVerse = { v: 3, t: kjvTokens, wj: redFrom(kjvTokens, 'Verily') };

  it('votes per original word and fills unvoted words between red ones', () => {
    const votes = new Map<number, number>();
    addVotes(votes, [marked]);
    expect(votes.get(1)).toBe(-1);
    expect(votes.get(5)).toBe(1);
    expect(votes.has(9)).toBe(false); // μή has no KJV link
    const flags = origFlags(orig, votes);
    expect(flags).toEqual([-1, -1, -1, -1, -1, 1, 1, 1, 1, 1]); // μή filled (red and the verse edge)
  });

  it('colours a BSB verse through its links, including an unlinked opening word', () => {
    const votes = new Map<number, number>();
    addVotes(votes, [marked]);
    const flags = origFlags(orig, votes);
    const bsb: TextVerse = { v: 3, t: toks('Jesus/1 replied/0, “Truly/5, I/ tell/6 you/7, no/9 one/ can/.”') };
    expect(show(markFromOrig(bsb, flags))).toBe('Jesus replied, [“Truly, I tell you, no one can.”]');
  });

  it('uses a close wording (ASV ~ KJV) as text evidence', () => {
    const src = { words: ['And', 'he', 'said', 'Verily', 'I', 'say'], red: [false, false, false, true, true, true] };
    expect(textScores(src, ['And', 'he', 'said', 'Verily', 'I', 'say', 'unto', 'you'])).toEqual([-2, -2, -2, 2, 2, 2, 0, 0]);
    expect(textScores(src, ['Truly', 'truly', 'I', 'tell', 'you', 'now'])).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* Generated data (CI runs the pipeline before the tests)                    */
/* ------------------------------------------------------------------------ */

const DATA = join(process.cwd(), 'public', 'data', 'text');
const read = (tr: string, book: string, c: number): TextChapter => JSON.parse(readFileSync(join(DATA, tr, book, `${c}.json`), 'utf8')) as TextChapter;
const hasData = existsSync(join(DATA, 'KJV', 'MAT', '5.json')) && read('KJV', 'MAT', 5).verses.some((v) => v.wj);
const TRS = ['KJV', 'WEB', 'BSB', 'ASV', 'YLT'].filter((tr) => existsSync(join(DATA, tr)));
const verse = (tr: string, book: string, c: number, v: number) => read(tr, book, c).verses.find((x) => x.v === v)!;
const share = (v: TextVerse) => {
  const f = wordFlagsOf(layoutVerse(v.t), v.wj);
  return f.filter(Boolean).length / f.length;
};

describe.skipIf(!hasData)('redletter: generated data', () => {
  it('colours the Sermon on the Mount in every translation', () => {
    for (const tr of TRS) {
      for (const c of [5, 6, 7]) {
        const ch = read(tr, 'MAT', c);
        const speech = ch.verses.filter((v) => (c === 5 ? v.v >= 3 : c === 7 ? v.v <= 27 : true));
        const red = speech.filter((v) => share(v) > 0.9).length;
        expect(red / speech.length, `${tr} Matt ${c}`).toBeGreaterThan(0.95);
      }
      expect(share(verse(tr, 'MAT', 5, 1)), `${tr} Matt 5:1`).toBe(0);
      expect(share(verse(tr, 'MAT', 7, 28)), `${tr} Matt 7:28`).toBe(0);
    }
  });

  it('marks John 3:16 and the words spoken from heaven in Acts 9 and Rev 1', () => {
    for (const tr of TRS) expect(share(verse(tr, 'JHN', 3, 16)), `${tr} John 3:16`).toBe(1);
    expect(show(verse('KJV', 'ACT', 9, 4))).toBe('And he fell to the earth, and heard a voice saying unto him, [Saul, Saul, why persecutest thou me?]');
    expect(show(verse('KJV', 'REV', 1, 11))).toMatch(/^Saying, \[I am Alpha and Omega, the first and the last:\] and, \[What thou seest/);
    expect(show(verse('WEB', 'ACT', 9, 4))).toMatch(/saying to him, \[“Saul, Saul, why do you persecute me\?”\]$/);
    expect(show(verse('KJV', '1CO', 11, 24))).toMatch(/and said, \[Take, eat: this is my body/);
  });

  it('leaves narrative black, including the runaway spans of the KJV source', () => {
    for (const tr of TRS) {
      for (const [b, c, v] of [
        ['JHN', 1, 1],
        ['ACT', 9, 7],
        ['MAT', 4, 18],
        ['LUK', 7, 2],
        ['MRK', 8, 23],
        ['GEN', 1, 1],
      ] as const) {
        expect(verse(tr, b, c, v).wj, `${tr} ${b} ${c}:${v}`).toBeUndefined();
      }
    }
  });

  it('keeps every verse text intact with well-formed ranges', () => {
    for (const tr of TRS) {
      for (const [b, c] of [
        ['MAT', 5],
        ['JHN', 14],
        ['REV', 22],
      ] as const) {
        for (const v of read(tr, b, c).verses) {
          let prev = 0;
          for (const [s, e] of v.wj ?? []) {
            expect(s).toBeGreaterThanOrEqual(prev);
            expect(e).toBeGreaterThan(s);
            expect(e).toBeLessThanOrEqual(v.t.length);
            prev = e;
          }
          for (let i = 1; i < v.t.length; i++) {
            const a = v.t[i - 1];
            const z = v.t[i];
            // adjacent strings only where the colour changes
            if (typeof a === 'string' && typeof z === 'string') {
              const inRed = (k: number) => (v.wj ?? []).some(([s, e]) => k >= s && k < e);
              expect(inRed(i - 1)).not.toBe(inRed(i));
            }
          }
        }
      }
    }
  });
});
