/**
 * Evaluate the bridge aligner (src/lib/align) against the KJV's own Strong's tagging.
 *
 *   npx tsx scripts/data/eval-bridge.ts                 # all books, held-out tables
 *   npx tsx scripts/data/eval-bridge.ts --sample=4      # every 4th chapter (faster)
 *   npx tsx scripts/data/eval-bridge.ts --table=bsb     # translation table from the BSB only
 *   npx tsx scripts/data/eval-bridge.ts --show=JHN.3.16 # print one verse's predictions
 *
 * The KJV text (public/data/text/KJV, built by the kjv stage) is treated as untagged English and
 * bridged through the BSB; each word's predicted links are compared with the KJV's gold links.
 * So that the score is honest, the translation table never contains the KJV tags of the books being
 * scored: by default it is BSB + the KJV of the other half of the books (2-fold by book number), or
 * the BSB alone with --table=bsb.
 *
 * Metrics (per English word; "evaluable" = the KJV tags it, or marks it as supplied in italics):
 *   precision = correct predictions / predicted links on evaluable words (an italic word that gets a
 *               link counts as wrong)
 *   recall    = correct predictions / words whose gold Strong's is present in the source text
 *   correct   = "strongs": a predicted original word has one of the gold Strong's numbers (Hebrew:
 *               prefixes / suffixes of the same written word count, as the KJV tags whole words);
 *               "exact": a predicted word is the very original word the KJV word is linked to
 *               (same written word in Hebrew).
 */
import { existsSync } from 'node:fs';
import { bridgeVerse } from '../../src/lib/align/bridge';
import { isFunctionWord, wordClass } from '../../src/lib/align/normalize';
import { TableBuilder, tokenWords, type TranslationTable } from '../../src/lib/align/table';
import type { OrigChapter, TextChapter, Token } from '../../src/lib/types';
import { OW } from '../../src/lib/types';
import { allChapters, baseStrongs, outPath, readJson } from './common';

interface Counts {
  words: number;
  /** Wrong by the strict measure, but every predicted word is one the KJV links to nothing in this verse. */
  unverifiable: number;
  predicted: number;
  correct: number;
  exact: number;
  goldLinkable: number;
  recalled: number;
  recalledExact: number;
}

const zero = (): Counts => ({ unverifiable: 0, words: 0, predicted: 0, correct: 0, exact: 0, goldLinkable: 0, recalled: 0, recalledExact: 0 });

function add(a: Counts, b: Partial<Counts>): void {
  for (const k of Object.keys(b) as (keyof Counts)[]) a[k] += b[k] ?? 0;
}

function fmt(name: string, c: Counts): string {
  const p = c.correct / Math.max(1, c.predicted);
  const r = c.recalled / Math.max(1, c.goldLinkable);
  const f = (2 * p * r) / Math.max(1e-9, p + r);
  const pe = c.exact / Math.max(1, c.predicted);
  const re = c.recalledExact / Math.max(1, c.goldLinkable);
  const pv = c.correct / Math.max(1, c.predicted - c.unverifiable);
  return (
    `${name.padEnd(16)} words ${String(c.words).padStart(7)} linked ${String(c.predicted).padStart(7)}  ` +
    `P ${p.toFixed(3)} R ${r.toFixed(3)} F1 ${f.toFixed(3)} | verifiable P ${pv.toFixed(3)} | exact P ${pe.toFixed(3)} R ${re.toFixed(3)}`
  );
}

export interface EvalOptions {
  sample?: number;
  table?: 'heldout' | 'bsb';
  show?: string[];
  quiet?: boolean;
  /** Collect per-word error counts ('content': list content words only). */
  errors?: boolean | 'content';
  /** Print metrics per testament and word class. */
  classes?: boolean;
  /** Print a random sample of verses where this (lower-case) word got a link. */
  word?: string;
  /** Restrict --word / --errors samples to one testament. */
  testament?: 'OT' | 'NT';
}

export interface EvalResult {
  all: Counts;
  content: Counts;
  function: Counts;
  nt: Counts;
  ot: Counts;
  ntContent: Counts;
  otContent: Counts;
  bins: Map<number, Counts>;
  /** "NT det", "OT prep"… (word classes of normalize.ts) */
  byClass: Map<string, Counts>;
  /** Lower-cased word -> [predicted, wrong] (with --errors). */
  byWord: Map<string, [number, number]>;
  /** Lower-cased word -> gold-linkable occurrences not recalled (with --errors). */
  missed: Map<string, number>;
  ms: number;
  chapters: number;
}

export function evaluateBridge(opts: EvalOptions = {}): EvalResult {
  const sample = opts.sample ?? 1;
  const chapters = allChapters().filter((_, i) => i % sample === 0);
  const every = allChapters();
  const data = new Map<string, { orig: OrigChapter; bsb: TextChapter; kjv: TextChapter }>();
  const load = (book: string, chapter: number) => {
    const k = `${book} ${chapter}`;
    let d = data.get(k);
    if (!d) {
      const kp = outPath('text', 'KJV', book, `${chapter}.json`);
      if (!existsSync(kp)) throw new Error('Run the kjv stage first.');
      d = {
        orig: readJson<OrigChapter>(outPath('orig', book, `${chapter}.json`)),
        bsb: readJson<TextChapter>(outPath('text', 'BSB', book, `${chapter}.json`)),
        kjv: readJson<TextChapter>(kp),
      };
      data.set(k, d);
    }
    return d;
  };

  // Tables: fold 0 = odd book numbers, fold 1 = even.
  const tables: TranslationTable[] = [];
  for (const fold of [0, 1]) {
    const tb = new TableBuilder();
    for (const { book, chapter } of every) {
      const d = load(book.id, chapter);
      tb.addChapter(d.bsb, d.orig);
      if (opts.table !== 'bsb' && book.num % 2 !== fold % 2) tb.addChapter(d.kjv, d.orig, 1);
    }
    tables.push(tb.toTable());
  }

  const res: EvalResult = {
    all: zero(),
    content: zero(),
    function: zero(),
    nt: zero(),
    ot: zero(),
    ntContent: zero(),
    otContent: zero(),
    bins: new Map(),
    byClass: new Map(),
    byWord: new Map(),
    missed: new Map(),
    ms: 0,
    chapters: chapters.length,
  };
  let skipped = 0;
  for (const { book, chapter } of chapters) {
    const d = load(book.id, chapter);
    // Score books with table built WITHOUT their KJV tags: odd books use fold 0 (KJV of even books).
    const table = tables[book.num % 2 === 1 ? 0 : 1];
    const bsbVerse = new Map(d.bsb.verses.map((v) => [v.v, v.t]));
    const words = d.orig.words;
    const expand = (idx: Iterable<number>) => {
      const out = new Set<number>();
      for (const j of idx) {
        const g = words[j][OW.group];
        out.add(j);
        for (let k = g; k < words.length && words[k][OW.group] === g; k++) out.add(k);
      }
      return out;
    };
    // Gold ids: exact ids of the linked words (whole written words in Hebrew), base ids of TR-only tags.
    const goldIds = (g: { links: number[]; extra?: string[] }) => {
      const out = new Set<string>();
      for (const j of expand(g.links)) if (words[j][OW.strongs]) out.add(words[j][OW.strongs]);
      for (const s of g.extra ?? []) out.add(`~${baseStrongs(s)}`);
      return out;
    };
    const hit = (gold: ReadonlySet<string>, id: string) => !!id && (gold.has(id) || gold.has(`~${baseStrongs(id)}`));
    const t0 = performance.now();
    const preds = d.kjv.verses.map((v) => bridgeVerse(plainText(v.t), bsbVerse.get(v.v), d.orig, v.v, table));
    res.ms += performance.now() - t0;

    d.kjv.verses.forEach((v, vi) => {
      const gold = tokenWords(v.t);
      const pred = tokenWords(preds[vi]);
      if (gold.length !== pred.length || gold.some((g, i) => g.text !== pred[i].text)) {
        skipped++;
        return;
      }
      const showIt = opts.show?.includes(`${book.id}.${chapter}.${v.v}`) || (opts.word !== undefined && (!opts.testament || opts.testament === book.testament) && gold.some((g, i) => g.text.toLowerCase() === opts.word && pred[i].links.length > 0) && Math.random() < 0.03);
      if (showIt) console.log(`${book.id} ${chapter}:${v.v} ${plainText(v.t)}`);
      // Italic flags by word order (WordTokens only).
      const italic = new Set<number>();
      {
        let wi = 0;
        for (const t of v.t) {
          if (typeof t === 'string') {
            wi += tokenWords([t]).length;
            continue;
          }
          if (t[2]?.i) italic.add(wi);
          wi++;
        }
      }
      const goldAll = expand(gold.flatMap((g) => g.links));
      gold.forEach((g, i) => {
        const isItalic = italic.has(i);
        const goldStrongs = goldIds(g);
        if (!isItalic && !goldStrongs.size) return; // untagged: unknown
        const p = pred[i];
        const pExp = expand(p.links);
        const gExp = expand(g.links);
        const predicted = p.links.length > 0 ? 1 : 0;
        let correct = 0;
        let exact = 0;
        if (predicted && !isItalic) {
          for (const j of pExp) {
            if (hit(goldStrongs, words[j][OW.strongs])) correct = 1;
            if (gExp.has(j)) exact = 1;
          }
        }
        const linkable = g.links.length > 0 ? 1 : 0;
        const unverifiable = predicted && !correct && !isItalic && [...pExp].every((j) => !goldAll.has(j)) ? 1 : 0;
        const c: Partial<Counts> = {
          unverifiable,
          words: 1,
          predicted,
          correct,
          exact,
          goldLinkable: linkable,
          recalled: linkable && correct ? 1 : 0,
          recalledExact: linkable && exact ? 1 : 0,
        };
        const fn = isFunctionWord(g.text);
        add(res.all, c);
        add(fn ? res.function : res.content, c);
        add(book.testament === 'NT' ? res.nt : res.ot, c);
        if (!fn) add(book.testament === 'NT' ? res.ntContent : res.otContent, c);
        const ck = `${book.testament} ${wordClass(g.text)}`;
        const cc = res.byClass.get(ck) ?? zero();
        add(cc, c);
        res.byClass.set(ck, cc);
        if (linkable && !correct && opts.errors && (!opts.testament || opts.testament === book.testament)) {
          const key = g.text.toLowerCase();
          res.missed.set(key, (res.missed.get(key) ?? 0) + 1);
        }
        if (predicted && opts.errors && (!opts.testament || opts.testament === book.testament)) {
          const key = g.text.toLowerCase();
          const e = res.byWord.get(key) ?? [0, 0];
          e[0]++;
          if (!correct && !unverifiable) e[1]++;
          res.byWord.set(key, e);
        }
        if (showIt) {
          const show = (ls: Iterable<number>) => [...ls].map((j) => `${words[j][OW.text]}(${words[j][OW.strongs]})`).join('+') || '∅';
          console.log(`  ${g.text.padEnd(14)} gold ${isItalic ? '[italic]' : show(g.links)}   pred ${show(p.links)} ${correct ? '✓' : predicted ? '✗' : ''}`);
        }
      });
      // Confidence bins (all evaluable predicted words).
      const confs: number[] = [];
      for (const t of preds[vi]) if (typeof t !== 'string') confs.push(t[2]?.c ?? 1);
      let k = 0;
      gold.forEach((g, i) => {
        const p = pred[i];
        if (!p.links.length) return;
        const conf = confs[k++];
        const isItalic = italic.has(i);
        const goldStrongs = goldIds(g);
        if (!isItalic && !goldStrongs.size) return;
        let correct = 0;
        if (!isItalic) for (const j of expand(p.links)) if (hit(goldStrongs, words[j][OW.strongs])) correct = 1;
        const bin = Math.min(9, Math.floor(conf * 10));
        const b = res.bins.get(bin) ?? zero();
        add(b, { words: 1, predicted: 1, correct });
        res.bins.set(bin, b);
      });
    });
  }
  if (!opts.quiet) {
    console.log(`table: ${opts.table === 'bsb' ? 'BSB only' : 'BSB + KJV of the other half of the books (2-fold)'}; ${chapters.length} chapters; ${skipped} verses skipped`);
    console.log(fmt('all', res.all));
    console.log(fmt('content words', res.content));
    console.log(fmt('function words', res.function));
    console.log(fmt('NT', res.nt));
    console.log(fmt('OT', res.ot));
    console.log(fmt('NT content', res.ntContent));
    console.log(fmt('OT content', res.otContent));
    if (opts.classes) for (const [k, c] of [...res.byClass].sort()) console.log(fmt(k, c));
    const bins = [...res.bins].sort((a, b) => a[0] - b[0]);
    console.log('precision by confidence: ' + bins.map(([b, c]) => `${(b / 10).toFixed(1)}:${(c.correct / c.predicted).toFixed(2)}(${c.predicted})`).join('  '));
    if (opts.errors) {
      const top = [...res.byWord].filter(([w]) => opts.errors !== 'content' || !isFunctionWord(w)).sort((a, b) => b[1][1] - a[1][1]).slice(0, 40);
      console.log('most wrong links: ' + top.map(([w, [n, e]]) => `${w} ${e}/${n}`).join(', '));
      const miss = [...res.missed].filter(([w]) => opts.errors !== 'content' || !isFunctionWord(w)).sort((a, b) => b[1] - a[1]).slice(0, 60);
      console.log('most missed: ' + miss.map(([w, n]) => `${w} ${n}`).join(', '));
    }
    console.log(`bridging time: ${(res.ms / chapters.length).toFixed(2)} ms per chapter (Node)`);
  }
  return res;
}

const plainText = (tokens: readonly Token[]) => tokens.map((t) => (typeof t === 'string' ? t : t[0])).join('');

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/data/eval-bridge.ts');
if (isMain) {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  evaluateBridge({
    sample: Number(arg('sample') ?? 1),
    table: arg('table') === 'bsb' ? 'bsb' : 'heldout',
    show: arg('show')?.split(','),
    errors: process.argv.includes('--errors') || (process.argv.includes('--errors=content') ? 'content' : false),
    classes: process.argv.includes('--classes'),
    word: arg('word'),
    testament: arg('testament') === 'NT' ? 'NT' : arg('testament') === 'OT' ? 'OT' : undefined,
  });
}
