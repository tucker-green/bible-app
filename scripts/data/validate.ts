/**
 * Stage "validate": structural checks over everything in public/data/.
 *
 * Errors (the stage throws): missing / unparsable chapter files, verses out of order, link indices
 * outside the chapter's original words, BSB text that does not reproduce the source tokens, orig
 * verse numbers outside the English chapter, meta.json verse counts that disagree with the BSB,
 * concordance ids missing for words in the orig files.
 * Reported only: lexicon coverage of the Strong's ids used, stale search corpora / meta translations.
 */
import { existsSync, readdirSync } from 'node:fs';
import type { ConcChunk, DataMeta, LexChunk, OrigChapter, OrigWord, SearchCorpus, TextChapter, Token } from '../../src/lib/types';
import { OW } from '../../src/lib/types';
import { verseText } from './bsb';
import { allChapters, baseStrongs, chunkOf, log, outPath, readBsbTokens, readJson, type BsbTokenRow } from './common';
import { presentTranslations } from './search';

const MAX_LISTED = 12;

class Report {
  errors: string[] = [];
  warnings: string[] = [];
  private errorCount = new Map<string, number>();
  error(kind: string, msg: string) {
    const n = (this.errorCount.get(kind) ?? 0) + 1;
    this.errorCount.set(kind, n);
    if (n <= MAX_LISTED) this.errors.push(`${kind}: ${msg}`);
    else if (n === MAX_LISTED + 1) this.errors.push(`${kind}: ... (more)`);
  }
  get total() {
    return [...this.errorCount.values()].reduce((a, b) => a + b, 0);
  }
}

function tryRead<T>(path: string, r: Report, kind: string): T | undefined {
  if (!existsSync(path)) {
    r.error(kind, `missing ${path.replace(outPath(), 'public/data')}`);
    return undefined;
  }
  try {
    return readJson<T>(path);
  } catch (e) {
    r.error(kind, `cannot parse ${path}: ${(e as Error).message}`);
    return undefined;
  }
}

/** Check a token list's links against the chapter's original words. Returns the number of linked words. */
function checkTokens(tokens: readonly Token[], origCount: number, where: string, r: Report): number {
  let linked = 0;
  for (const t of tokens) {
    if (typeof t === 'string') continue;
    if (!Array.isArray(t) || typeof t[0] !== 'string' || !Array.isArray(t[1])) {
      r.error('token', `${where}: malformed token ${JSON.stringify(t)}`);
      continue;
    }
    if (t[1].length) linked++;
    for (const i of t[1]) {
      if (!Number.isInteger(i) || i < 0 || i >= origCount) r.error('link', `${where}: "${t[0]}" links to ${i} (orig has ${origCount} words)`);
    }
    const info = t[2];
    if (info?.s && info.m && info.m.length !== info.s.length) r.error('token', `${where}: info.m length differs from info.s`);
    if (info?.s && info.o && info.o.length !== info.s.length) r.error('token', `${where}: info.o length differs from info.s`);
  }
  return linked;
}

const textOf = (tokens: readonly Token[]) => tokens.map((t) => (typeof t === 'string' ? t : t[0])).join('');

export function buildValidate(): void {
  const r = new Report();
  const chapters = allChapters();
  const lines: string[] = [];

  /* ---- BSB source tokens, for verse-text checks ---- */
  const bsbVerses = new Map<string, Map<number, BsbTokenRow[]>>(); // chapter key -> verse -> tokens
  for (const t of ['OT', 'NT'] as const) {
    for (const tok of readBsbTokens(t)) {
      const ck = tok.id.slice(0, 5);
      const v = Number(tok.id.slice(5, 8));
      let vm = bsbVerses.get(ck);
      if (!vm) bsbVerses.set(ck, (vm = new Map()));
      const list = vm.get(v);
      if (list) list.push(tok);
      else vm.set(v, [tok]);
    }
  }

  /* ---- orig ---- */
  const orig = new Map<string, OrigChapter>();
  let origWords = 0;
  for (const { book, chapter, key } of chapters) {
    const oc = tryRead<OrigChapter>(outPath('orig', book.id, `${chapter}.json`), r, 'orig');
    if (!oc) continue;
    if (oc.book !== book.id || oc.chapter !== chapter) r.error('orig', `${book.id} ${chapter}: header says ${oc.book} ${oc.chapter}`);
    if (oc.lang !== (book.testament === 'NT' ? 'grc' : 'hbo')) r.error('orig', `${book.id} ${chapter}: lang ${oc.lang}`);
    if (!oc.words.length) r.error('orig', `${book.id} ${chapter}: no words`);
    orig.set(key, oc);
    origWords += oc.words.length;
    oc.words.forEach((w: OrigWord, i) => {
      if (!Array.isArray(w) || w.length !== 10) return r.error('orig', `${book.id} ${chapter}#${i}: not a 10-tuple`);
      const g = w[OW.group];
      if (!Number.isInteger(g) || g < 0 || g > i) r.error('orig', `${book.id} ${chapter}#${i}: bad group ${g}`);
      if (w[OW.strongs] && !/^[GH]\d{4}[A-Za-z]?$/.test(w[OW.strongs])) r.error('orig', `${book.id} ${chapter}#${i}: bad Strong's "${w[OW.strongs]}"`);
    });
    for (const a of oc.aramaic ?? []) if (a < 0 || a >= oc.words.length) r.error('orig', `${book.id} ${chapter}: aramaic index ${a} out of range`);
  }
  lines.push(`orig: ${orig.size}/${chapters.length} chapters, ${origWords} words`);

  /* ---- translations ---- */
  const translations = presentTranslations();
  const bsbMax = new Map<string, number>(); // chapter key -> highest BSB verse
  for (const tr of translations) {
    let files = 0;
    let verses = 0;
    let words = 0;
    let linked = 0;
    for (const { book, chapter, key } of chapters) {
      const where = `${tr} ${book.id} ${chapter}`;
      const tc = tryRead<TextChapter>(outPath('text', tr, book.id, `${chapter}.json`), r, 'text');
      if (!tc) continue;
      files++;
      if (tc.tr !== tr || tc.book !== book.id || tc.chapter !== chapter) r.error('text', `${where}: header says ${tc.tr} ${tc.book} ${tc.chapter}`);
      const origCount = orig.get(key)?.words.length ?? 0;
      let prev = 0;
      for (const v of tc.verses) {
        if (!Number.isInteger(v.v) || v.v <= prev) r.error('verse-order', `${where}: verse ${v.v} after ${prev}`);
        prev = v.v;
        verses++;
        words += v.t.filter((t) => typeof t !== 'string').length;
        linked += checkTokens(v.t, origCount, `${where}:${v.v}`, r);
      }
      if (tc.superscription) checkTokens(tc.superscription, origCount, `${where}:title`, r);
      const present = new Set(tc.verses.map((v) => v.v));
      for (const [v] of tc.headings ?? []) if (!present.has(v)) r.warnings.push(`${where}: heading before missing verse ${v}`);
      if (tr === 'BSB') {
        bsbMax.set(key, prev);
        // Verse text must reproduce the source tokens (same text, our spacing rules).
        const expected = new Map(bsbVerses.get(key) ?? []);
        for (const v of tc.verses) {
          const toks = expected.get(v.v);
          if (!toks) {
            r.error('bsb-text', `${where}:${v.v} not in the source TSV`);
            continue;
          }
          const got = textOf(v.t);
          if (got !== verseText(toks)) r.error('bsb-text', `${where}:${v.v}: "${got.slice(0, 60)}" != source`);
          if (got.replace(/\s+/g, '') !== toks.map((t) => t.text).join('').replace(/\s+/g, '')) r.error('bsb-text', `${where}:${v.v}: characters differ from the source tokens`);
          expected.delete(v.v);
        }
        const title = expected.get(0);
        if (title) {
          if (!tc.superscription || textOf(tc.superscription) !== verseText(title)) r.error('bsb-text', `${where}: superscription does not match the source title`);
          expected.delete(0);
        }
        for (const v of expected.keys()) r.error('bsb-text', `${where}: source verse ${v} missing`);
      }
    }
    lines.push(`text/${tr}: ${files}/${chapters.length} chapters, ${verses} verses, ${linked}/${words} word tokens linked`);
  }
  if (!translations.includes('BSB')) r.error('text', 'no BSB text');

  /* ---- orig verse numbers within the English chapter ---- */
  for (const { book, chapter, key } of chapters) {
    const oc = orig.get(key);
    const max = bsbMax.get(key);
    if (!oc || max === undefined) continue;
    for (const w of oc.words) {
      const v = w[OW.verse];
      if (!Number.isInteger(v) || v < 0 || v > max) {
        r.error('orig-verse', `${book.id} ${chapter}: word "${w[OW.text]}" has verse ${v} (chapter has ${max})`);
      }
    }
  }

  /* ---- concordance ---- */
  if (existsSync(outPath('conc'))) {
    const chunks = new Map<string, ConcChunk>();
    let missing = 0;
    for (const oc of orig.values()) {
      for (const w of oc.words) {
        if (!w[OW.strongs]) continue;
        const id = baseStrongs(w[OW.strongs]);
        const ck = `${id[0]}/${chunkOf(id)}`;
        if (!chunks.has(ck)) chunks.set(ck, existsSync(outPath('conc', id[0], `${chunkOf(id)}.json`)) ? readJson<ConcChunk>(outPath('conc', id[0], `${chunkOf(id)}.json`)) : {});
        if (!chunks.get(ck)![id]?.length) {
          missing++;
          r.error('conc', `${id} missing from conc/${ck}.json`);
        }
      }
    }
    lines.push(`conc: ${chunks.size} chunks${missing ? `, ${missing} words without an entry` : ', every Strong’s id present'}`);
  }

  /* ---- lexicon coverage (reported, never fatal) ---- */
  if (existsSync(outPath('lex'))) {
    const chunks = new Map<string, LexChunk | null>();
    const lex = (id: string) => {
      const ck = `${id[0]}/${chunkOf(id)}`;
      if (!chunks.has(ck)) {
        const p = outPath('lex', id[0], `${chunkOf(id)}.json`);
        let c: LexChunk | null = null;
        try {
          c = existsSync(p) ? readJson<LexChunk>(p) : null;
        } catch {
          c = null;
        }
        chunks.set(ck, c);
      }
      return chunks.get(ck);
    };
    let total = 0;
    let hit = 0;
    const missingIds = new Map<string, number>();
    for (const oc of orig.values()) {
      for (const w of oc.words) {
        const s = w[OW.strongs];
        if (!s) continue;
        total++;
        const c = lex(s);
        if (c && (c[s] || c[baseStrongs(s)])) hit++;
        else missingIds.set(s, (missingIds.get(s) ?? 0) + 1);
      }
    }
    const top = [...missingIds].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => `${id}×${n}`);
    lines.push(
      `lex: ${((100 * hit) / Math.max(1, total)).toFixed(2)}% of ${total} word occurrences resolve; ${missingIds.size} ids unresolved` +
        (top.length ? ` (top: ${top.join(', ')})` : ''),
    );
  } else lines.push('lex: not built yet (skipped)');

  /* ---- search corpora ---- */
  for (const tr of translations) {
    const p = outPath('search', `${tr}.json`);
    if (!existsSync(p)) {
      r.warnings.push(`search/${tr}.json missing — re-run the search stage`);
      continue;
    }
    const corpus = readJson<SearchCorpus>(p);
    let expected = 0;
    for (const { book, chapter } of chapters) {
      const f = outPath('text', tr, book.id, `${chapter}.json`);
      if (!existsSync(f)) continue;
      const tc = readJson<TextChapter>(f);
      expected += tc.verses.length + (tc.superscription?.length ? 1 : 0);
    }
    if (corpus.verses.length !== expected) r.warnings.push(`search/${tr}.json has ${corpus.verses.length} rows, text has ${expected} — re-run the search stage`);
    let last = 0;
    for (const [b, c, v] of corpus.verses) {
      const k = b * 1_000_000 + c * 1_000 + v;
      if (k <= last) {
        r.error('search', `${tr}: rows out of canonical order at ${b}/${c}/${v}`);
        break;
      }
      last = k;
    }
  }
  if (existsSync(outPath('search'))) {
    const extra = readdirSync(outPath('search')).filter((f) => !translations.includes(f.replace(/\.json$/, '')));
    if (extra.length) r.warnings.push(`search/ has corpora for missing translations: ${extra.join(', ')}`);
  }

  /* ---- meta ---- */
  const meta = tryRead<DataMeta>(outPath('meta.json'), r, 'meta');
  if (meta) {
    for (const b of meta.books) {
      b.verses.forEach((n, i) => {
        const max = bsbMax.get(String(b.num).padStart(2, '0') + String(i + 1).padStart(3, '0'));
        if (max !== undefined && max !== n) r.error('meta', `${b.id} ${i + 1}: meta says ${n} verses, BSB has ${max}`);
      });
    }
    const listed = meta.translations.map((t) => t.id).sort().join(',');
    const known = translations.filter((t) => ['BSB', 'KJV', 'WEB', 'ASV', 'YLT'].includes(t)).join(',');
    if (listed !== known) r.warnings.push(`meta.json lists translations [${listed}] but text/ has [${known}] — re-run the meta stage`);
    lines.push(`meta: ${meta.books.length} books, translations ${listed}, ${meta.credits.length} credits`);
  }

  for (const l of lines) log('validate', l);
  for (const w of r.warnings.slice(0, MAX_LISTED)) log('validate', `warning: ${w}`);
  if (r.warnings.length > MAX_LISTED) log('validate', `warning: ... ${r.warnings.length - MAX_LISTED} more`);
  if (r.total) {
    for (const e of r.errors) log('validate', `ERROR ${e}`);
    throw new Error(`validate: ${r.total} structural error(s)`);
  }
  log('validate', `OK — no structural errors${r.warnings.length ? `, ${r.warnings.length} warning(s)` : ''}`);
}
