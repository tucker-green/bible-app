/**
 * Search query language (parsed here, executed by engine.ts):
 *
 *   love                 exact word (case-, accent- and possessive-insensitive: "God" finds "God’s")
 *   love faith           both words in the verse (AND is implicit; "AND" is accepted too)
 *   faith OR hope        either word ("|" also works); OR binds tighter than AND
 *   "in the beginning"   exact phrase (curly quotes too); words inside may end in *
 *   -fear  NOT fear      exclude verses containing the word / phrase / group
 *   lov*                 prefix wildcard: love, loved, lovely, loving…
 *   love~                all forms: love, loves, loved, loving, loveth, lovest (irregulars too: go~ -> went, gone…)
 *   (faith OR hope) love grouping
 *   G26  G0026  H430  strongs:G26     every verse where that Strong's number occurs (concordance)
 *   λόγος  שָׁלוֹם                     Greek / Hebrew lemma (accents ignored) -> Strong's -> concordance
 *   greek:logos  hebrew:shalom  lemma:agape   lemma by transliteration
 *   in:John  in:NT  in:OT  book:Rom    restrict to a book or testament
 *
 * Pure functions, no I/O.
 */
import { BOOKS } from '../books';
import { findBook } from '../reference';
import { foldWord, words } from '../tokenize';
import { hasGreek, hasHebrew } from '../greek';

export type WordMode = 'exact' | 'prefix' | 'forms';

export type QueryNode =
  | { kind: 'and'; nodes: QueryNode[] }
  | { kind: 'or'; nodes: QueryNode[] }
  | { kind: 'not'; node: QueryNode }
  /** `term` is the folded word (see foldWord); for prefix mode, the folded prefix. */
  | { kind: 'word'; raw: string; term: string; mode: WordMode }
  | { kind: 'phrase'; raw: string; terms: { term: string; mode: 'exact' | 'prefix' }[] }
  /** Normalised Strong's id, e.g. "G0026". */
  | { kind: 'strongs'; raw: string; id: string }
  /** A Greek / Hebrew lemma, in the original script ('script') or transliterated ('translit'). */
  | { kind: 'lemma'; raw: string; text: string; lang: 'grc' | 'hbo' | 'any'; by: 'script' | 'translit' };

/** A leaf of the query tree (word, phrase, Strong's or lemma). */
export type LeafNode = Exclude<QueryNode, { kind: 'and' | 'or' | 'not' }>;

export interface QueryFilters {
  testament?: 'OT' | 'NT';
  /** Book numbers (1–66). */
  books?: number[];
}

export interface ParsedQuery {
  /** null for an empty query (or one with only filters). */
  root: QueryNode | null;
  filters: QueryFilters;
  /** Human-readable problems ("Unclosed parenthesis"…). Parsing is forgiving and still returns a tree. */
  errors: string[];
}

type Tok =
  | { t: 'word'; v: string }
  | { t: 'phrase'; v: string }
  | { t: 'or' }
  | { t: 'and' }
  | { t: 'not' }
  | { t: 'lp' }
  | { t: 'rp' };

const QUOTES = '"“”„«»';

function lex(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const s = input;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (QUOTES.includes(c)) {
      let j = i + 1;
      while (j < s.length && !QUOTES.includes(s[j])) j++;
      toks.push({ t: 'phrase', v: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === '(') {
      toks.push({ t: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ t: 'rp' });
      i++;
      continue;
    }
    if (c === '|') {
      toks.push({ t: 'or' });
      i++;
      continue;
    }
    if ((c === '-' || c === '!') && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      toks.push({ t: 'not' });
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && !/\s/.test(s[j]) && !'()|'.includes(s[j]) && !QUOTES.includes(s[j])) j++;
    const w = s.slice(i, j);
    // field:"quoted value"
    if (w.endsWith(':') && j < s.length && QUOTES.includes(s[j])) {
      let k = j + 1;
      while (k < s.length && !QUOTES.includes(s[k])) k++;
      toks.push({ t: 'word', v: w + s.slice(j + 1, k) });
      i = k + 1;
      continue;
    }
    if (w === 'OR') toks.push({ t: 'or' });
    else if (w === 'AND' || w === '&&' || w === '+') toks.push({ t: 'and' });
    else if (w === 'NOT') toks.push({ t: 'not' });
    else toks.push({ t: 'word', v: w.startsWith('+') ? w.slice(1) : w });
    i = j;
  }
  return toks;
}

const STRONGS_RE = /^(?:strongs?:)?([GgHh])0*(\d{1,4})([a-z]?)$/;

/** Fold a search word the same way the index folds corpus words. */
export function foldTerm(word: string): string {
  return foldWord(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, ''));
}

const TESTAMENT_WORDS: Record<string, 'OT' | 'NT'> = {
  ot: 'OT', nt: 'NT', 'old testament': 'OT', 'new testament': 'NT', oldtestament: 'OT', newtestament: 'NT', old: 'OT', new: 'NT',
};
const GROUPS: Record<string, number[]> = {
  law: range(1, 5), torah: range(1, 5), pentateuch: range(1, 5),
  history: range(6, 17), wisdom: range(18, 22), poetry: range(18, 22),
  prophets: range(23, 39), majorprophets: range(23, 27), minorprophets: range(28, 39),
  gospels: range(40, 43), epistles: range(45, 65), letters: range(45, 65), paul: range(45, 57),
};
function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** Longest query parsed (longer input is cut; a search box never needs more). */
export const MAX_QUERY_LENGTH = 500;
/** Deepest bracket nesting parsed; deeper "(" are ignored (with one error). */
export const MAX_QUERY_DEPTH = 32;

export function parseQuery(input: string): ParsedQuery {
  const toks = lex(input.slice(0, MAX_QUERY_LENGTH).normalize('NFC'));
  const errors: string[] = [];
  const filters: QueryFilters = {};
  let pos = 0;
  const peek = () => toks[pos];

  const parseAnd = (depth: number): QueryNode | null => {
    const nodes: QueryNode[] = [];
    while (pos < toks.length) {
      const t = peek();
      if (t.t === 'rp') {
        if (depth > 0) break;
        errors.push('Unmatched “)”');
        pos++;
        continue;
      }
      if (t.t === 'and') {
        pos++;
        continue;
      }
      if (t.t === 'or') {
        // A dangling OR (no left operand): ignore it.
        pos++;
        continue;
      }
      const n = parseOr(depth);
      if (n) nodes.push(n);
    }
    if (!nodes.length) return null;
    return nodes.length === 1 ? nodes[0] : { kind: 'and', nodes };
  };

  const parseOr = (depth: number): QueryNode | null => {
    const first = parseUnary(depth);
    const nodes: QueryNode[] = first ? [first] : [];
    while (peek()?.t === 'or') {
      pos++;
      if (!peek() || peek().t === 'rp') break;
      const n = parseUnary(depth);
      if (n) nodes.push(n);
    }
    if (!nodes.length) return null;
    return nodes.length === 1 ? nodes[0] : { kind: 'or', nodes };
  };

  const parseUnary = (depth: number): QueryNode | null => {
    // NOT NOT … NOT x: counted, not recursed (no stack overflow on pathological input).
    let nots = 0;
    while (peek()?.t === 'not') {
      pos++;
      nots++;
    }
    if (!peek()) return null;
    const n = parsePrimary(depth);
    if (!n) return null;
    return nots % 2 ? { kind: 'not', node: n } : n;
  };

  const parsePrimary = (depth: number): QueryNode | null => {
    let t = toks[pos++];
    // Brackets nested deeper than MAX_QUERY_DEPTH are ignored (iteratively: no recursion).
    while (t?.t === 'lp' && depth >= MAX_QUERY_DEPTH) {
      errors.push('Too many nested brackets');
      t = toks[pos++];
    }
    if (!t) return null;
    if (t.t === 'lp') {
      const n = parseAnd(depth + 1);
      if (peek()?.t === 'rp') pos++;
      else errors.push('Missing “)”');
      return n;
    }
    if (t.t === 'phrase') return phraseNode(t.v);
    if (t.t === 'word') return wordNode(t.v, filters, errors);
    return null;
  };

  const root = parseAnd(0);
  // Each distinct problem is reported once ("Unmatched “)”" may occur many times).
  return { root, filters, errors: [...new Set(errors)] };
}

function phraseNode(text: string): QueryNode | null {
  const pieces = text.split(/\s+/).filter(Boolean);
  const terms: { term: string; mode: 'exact' | 'prefix' }[] = [];
  for (const p of pieces) {
    const prefix = p.endsWith('*');
    const term = foldTerm(prefix ? p.slice(0, -1) : p);
    if (term) terms.push({ term, mode: prefix ? 'prefix' : 'exact' });
  }
  if (!terms.length) return null;
  if (terms.length === 1) return { kind: 'word', raw: text, term: terms[0].term, mode: terms[0].mode };
  return { kind: 'phrase', raw: text.trim(), terms };
}

function wordNode(raw: string, filters: QueryFilters, errors: string[]): QueryNode | null {
  const field = /^([a-z]+):(.*)$/i.exec(raw);
  if (field) {
    const name = field[1].toLowerCase();
    const value = field[2].trim();
    if (name === 'in' || name === 'book' || name === 'books') {
      applyScope(value, filters, errors);
      return null;
    }
    if (name === 'strongs' || name === 'strong') {
      const m = STRONGS_RE.exec(value);
      if (!m) {
        errors.push(`“${value}” is not a Strong’s number`);
        return null;
      }
      return strongsNode(raw, m);
    }
    if (name === 'greek' || name === 'grc' || name === 'gk') return lemmaNode(raw, value, 'grc');
    if (name === 'hebrew' || name === 'heb' || name === 'hbo' || name === 'aramaic') return lemmaNode(raw, value, 'hbo');
    if (name === 'lemma' || name === 'translit' || name === 'original' || name === 'orig') return lemmaNode(raw, value, 'any');
    // Unknown field: treat the whole thing as text.
  }
  const sm = STRONGS_RE.exec(raw);
  if (sm) return strongsNode(raw, sm);
  if (hasGreek(raw) || hasHebrew(raw)) return lemmaNode(raw, raw, hasGreek(raw) ? 'grc' : 'hbo');

  let mode: WordMode = 'exact';
  let w = raw;
  if (w.endsWith('*')) {
    mode = 'prefix';
    w = w.replace(/\*+$/, '');
  } else if (w.endsWith('~') || w.startsWith('~')) {
    mode = 'forms';
    w = w.replace(/^~+|~+$/g, '');
  }
  // Split like corpus text: "3:16" or "word/deed" are several words (a phrase); "seed-bearing" and "God’s" stay one.
  const pieces = words(w);
  if (pieces.length > 1) {
    const terms = pieces.map((p, i) => ({
      term: foldTerm(p),
      mode: (i === pieces.length - 1 && mode === 'prefix' ? 'prefix' : 'exact') as 'exact' | 'prefix',
    }));
    return { kind: 'phrase', raw, terms: terms.filter((t) => t.term) };
  }
  const term = foldTerm(pieces[0] ?? '');
  if (!term) return null;
  if (mode === 'prefix' && term.length < 2) {
    errors.push(`“${raw}” is too short for a wildcard`);
    return null;
  }
  return { kind: 'word', raw, term, mode };
}

function strongsNode(raw: string, m: RegExpExecArray): QueryNode {
  return { kind: 'strongs', raw, id: `${m[1].toUpperCase()}${m[2].padStart(4, '0')}${m[3]}` };
}

function lemmaNode(raw: string, value: string, lang: 'grc' | 'hbo' | 'any'): QueryNode | null {
  const text = value.trim();
  if (!text) return null;
  const script = hasGreek(text) || hasHebrew(text);
  const l = script ? (hasGreek(text) ? 'grc' : 'hbo') : lang;
  return { kind: 'lemma', raw, text, lang: l, by: script ? 'script' : 'translit' };
}

function applyScope(value: string, filters: QueryFilters, errors: string[]): void {
  const v = value.toLowerCase().replace(/[_-]/g, ' ').trim();
  if (!v) return;
  const t = TESTAMENT_WORDS[v];
  if (t) {
    filters.testament = t;
    return;
  }
  const g = GROUPS[v.replace(/\s/g, '')];
  if (g) {
    filters.books = [...(filters.books ?? []), ...g];
    return;
  }
  // Comma-separated book list: in:John,Rom
  const found: number[] = [];
  for (const part of value.split(',')) {
    const name = part.replace(/[_-]/g, ' ').trim();
    if (!name) continue;
    const b = findBook(name);
    if (b) found.push(b.num);
    else errors.push(`Unknown book “${name}”`);
  }
  if (found.length) filters.books = [...(filters.books ?? []), ...found];
}

/** Book numbers allowed by filters + options (undefined = all). */
export function allowedBooks(filters: QueryFilters, testament?: 'OT' | 'NT', book?: number): Set<number> | undefined {
  let allowed: Set<number> | undefined;
  const intersect = (nums: number[]) => {
    const s = new Set(nums);
    allowed = allowed ? new Set([...allowed].filter((n) => s.has(n))) : s;
  };
  const t = testament ?? filters.testament;
  if (t) intersect(BOOKS.filter((b) => b.testament === t).map((b) => b.num));
  if (filters.books?.length) intersect(filters.books);
  if (book) intersect([book]);
  return allowed;
}

/** All positive (non-negated) leaf nodes, e.g. for highlighting. */
export function positiveLeaves(node: QueryNode | null, negated = false, out: LeafNode[] = []): LeafNode[] {
  if (!node) return out;
  switch (node.kind) {
    case 'and':
    case 'or':
      for (const n of node.nodes) positiveLeaves(n, negated, out);
      break;
    case 'not':
      positiveLeaves(node.node, !negated, out);
      break;
    default:
      if (!negated) out.push(node);
  }
  return out;
}
