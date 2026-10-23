/**
 * Strict whitelist parser for lexicon definitions (LexEntry.def), which are "sanitised HTML" that
 * may contain only <b>, <i>, <br> and <span class="ref" data-ref="JHN.3.16">. We never assign the
 * string to innerHTML: it is parsed into a small tree of allowed nodes, everything else becomes
 * plain text (rendered by Preact, i.e. escaped), and unknown tags are dropped (their text kept,
 * except for script-like elements whose content is dropped too).
 *
 * Pure and DOM-free (unit-tested with hostile input).
 */
import { getBook } from '../../lib/books';
import type { VerseRef } from '../../lib/types';

export type DefNode =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i'; c: DefNode[] }
  | { t: 'br' }
  | { t: 'ref'; ref: VerseRef; id: string; c: DefNode[] };

type Container = { t: 'root' | 'b' | 'i' | 'span' | 'ref'; c: DefNode[]; node?: DefNode };

const RAW_TEXT_TAGS = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'textarea', 'title', 'xmp', 'svg', 'math']);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

/** Decode the HTML entities that can appear in text. Unknown entities stay literal. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return m;
      return String.fromCodePoint(n);
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** "JHN.3.16" -> { book: 'JHN', chapter: 3, verse: 16 } for real books only. */
export function parseRefId(id: string): VerseRef | null {
  const m = /^([1-3A-Z]{3})\.(\d{1,3})(?:\.(\d{1,3}))?$/.exec(id.trim());
  if (!m) return null;
  const b = getBook(m[1]);
  if (!b) return null;
  const chapter = Number(m[2]);
  if (chapter < 1 || chapter > b.chapters) return null;
  const ref: VerseRef = { book: b.id, chapter };
  if (m[3]) {
    const v = Number(m[3]);
    if (v < 1) return null;
    ref.verse = v;
  }
  return ref;
}

function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i');
  const m = re.exec(attrs);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? '');
}

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;

/** Parse a definition string into allowed nodes. */
export function parseDefinition(html: string): DefNode[] {
  const root: Container = { t: 'root', c: [] };
  const stack: Container[] = [root];
  const top = () => stack[stack.length - 1];
  const pushText = (raw: string) => {
    if (!raw) return;
    const v = decodeEntities(raw);
    const c = top().c;
    const last = c[c.length - 1];
    if (last && last.t === 'text') last.v += v;
    else c.push({ t: 'text', v });
  };

  let pos = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html))) {
    pushText(html.slice(pos, m.index));
    pos = m.index + m[0].length;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = m[3] ?? '';

    if (!closing && RAW_TEXT_TAGS.has(name)) {
      // Drop the element and everything up to its closing tag.
      const end = html.toLowerCase().indexOf(`</${name}`, pos);
      if (end < 0) {
        pos = html.length;
        break;
      }
      const gt = html.indexOf('>', end);
      pos = gt < 0 ? html.length : gt + 1;
      TAG_RE.lastIndex = pos;
      continue;
    }

    if (name === 'br') {
      if (!closing) top().c.push({ t: 'br' });
      continue;
    }
    if (name === 'b' || name === 'strong' || name === 'i' || name === 'em') {
      const t: 'b' | 'i' = name === 'b' || name === 'strong' ? 'b' : 'i';
      if (closing) closeTo(stack, t);
      else {
        const node: DefNode = { t, c: [] };
        top().c.push(node);
        stack.push({ t, c: node.c, node });
      }
      continue;
    }
    if (name === 'span') {
      if (closing) {
        closeTo(stack, 'span', 'ref');
        continue;
      }
      const cls = attr(attrs, 'class') ?? '';
      const id = attr(attrs, 'data-ref') ?? '';
      const ref = /(?:^|\s)ref(?:\s|$)/.test(cls) ? parseRefId(id) : null;
      if (ref) {
        const node: DefNode = { t: 'ref', ref, id, c: [] };
        top().c.push(node);
        stack.push({ t: 'ref', c: node.c, node });
      } else {
        // A plain (or invalid ref) span: transparent, its children go to the parent.
        stack.push({ t: 'span', c: top().c });
      }
      continue;
    }
    // Any other tag: dropped, text content kept.
  }
  pushText(html.slice(pos));
  return prune(root.c);
}

function closeTo(stack: Container[], ...kinds: Container['t'][]): void {
  for (let i = stack.length - 1; i > 0; i--) {
    if (kinds.includes(stack[i].t)) {
      stack.length = i;
      return;
    }
  }
  // Unmatched closing tag: ignored.
}

/** Remove empty formatting nodes and trailing / leading breaks. */
function prune(nodes: DefNode[]): DefNode[] {
  const out: DefNode[] = [];
  for (const n of nodes) {
    if (n.t === 'b' || n.t === 'i' || n.t === 'ref') {
      n.c = prune(n.c);
      if (!n.c.length) continue;
    }
    out.push(n);
  }
  while (out.length && out[0].t === 'br') out.shift();
  while (out.length && out[out.length - 1].t === 'br') out.pop();
  return out;
}

/** Plain text of nodes (for aria labels / announcements). */
export function defToText(nodes: DefNode[]): string {
  return nodes
    .map((n) => (n.t === 'text' ? n.v : n.t === 'br' ? '\n' : defToText(n.c)))
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Abbott-Smith definitions begin with the dictionary heading: "<b>λόγος</b>, -ου, ὁ (λέγω)<br>…".
 * When the first line starts with the lemma in bold, split it off so the card can show it as the
 * dictionary form (LEMMA row) instead of repeating it in the definition.
 */
export function splitDefinitionHead(nodes: DefNode[], lemma: string): { head: DefNode[] | null; body: DefNode[] } {
  const br = nodes.findIndex((n) => n.t === 'br');
  if (br <= 0 || br > 8) return { head: null, body: nodes };
  const first = nodes[0];
  if (first.t !== 'b' || fold(defToText(first.c)) !== fold(lemma)) return { head: null, body: nodes };
  const head = nodes.slice(0, br);
  // Only a compact dictionary heading is lifted out: the lemma plus endings / article / a short
  // parenthesis ("λόγος, -ου, ὁ (λέγω)", "ἀγαπάω, -ῶ"). Anything wordier stays in the text.
  const rest = defToText(head).slice(defToText(first.c).length);
  if (!/^(?:\s*,\s*(?:-\S+|ὁ|ἡ|τό|οἱ|αἱ|τά))*(?:\s*\([^()]{1,24}\))?\s*\.?$/u.test(rest)) return { head: null, body: nodes };
  return { head, body: nodes.slice(br + 1) };
}
