/**
 * Optional runtime translations (e.g. the NIV) through the reader's OWN API.Bible key.
 * Copyrighted texts are never bundled with the site; they are fetched chapter by chapter in the
 * browser, kept in memory only (data.ts's bounded chapter cache), and never written to storage.
 *
 * API (https://docs.api.bible, researched Oct 2026 — not reachable from the build sandbox, so the
 * request/response handling below is tested against fixtures modelled on the documentation):
 *   - Base URL: https://rest.api.bible/v1 (the legacy host https://api.scripture.api.bible/v1 is
 *     routed to it; pass `baseUrl` to override).
 *   - Auth: header `api-key: <key>`.
 *   - GET /bibles?language=eng -> { data: Bible[] }  (Bible: id, abbreviation, name, language, …).
 *     NIV is abbreviation "NIV", name "New International Version 2011" (id 78a9f6124f344018-01
 *     at the time of writing, but always look it up).
 *   - GET /bibles/{bibleId}/chapters/{BOOK}.{CHAPTER}?content-type=json&include-notes=false
 *       &include-titles=true&include-chapter-numbers=false&include-verse-numbers=true
 *       &include-verse-spans=false&fums-version=3
 *     -> { data: { id, bibleId, number, bookId, reference, copyright, verseCount, content, next,
 *        previous }, meta: { fumsToken } }   (legacy responses: meta.fumsId / fums / fumsJs…).
 *     With content-type=json, `content` is a tree of { type:'tag', name, attrs, items } and
 *     { type:'text', text, attrs:{ verseId:'JHN.3.16', verseOrgIds:[…] } } nodes; paragraphs are
 *     name 'para' (attrs.style = USFM marker: p, q1, s1, d…), verse numbers are name 'verse'
 *     (attrs.number), footnotes / cross-references are name 'note'. Book ids are USFM, like ours.
 *
 * Terms of use that shape this module (API.Bible Terms & Conditions / Acceptable Use):
 *   1. Copyright: every passage must be shown with the copyright statement returned in
 *      `data.copyright` (returned here as `copyright`) — the UI must render it with the text, and
 *      Starter-plan apps must also show a visible "API.Bible" credit linking to https://api.bible
 *      (APIBIBLE_ATTRIBUTION).
 *   2. FUMS (Fair Use Management System) is mandatory for web apps: each time Scripture from the
 *      API is DISPLAYED, report its FUMS token. v3: request with `fums-version=3`, read
 *      `meta.fumsToken`, then GET https://fums.api.bible/f3?t=<token>[&t=…]&dId=<device id>&sId=<session id>[&uId=<user id>]
 *      (an invisible pixel). dId must be constant for the device and must not identify the
 *      person; sId identifies the reading session. reportFums() implements this (and falls back
 *      to the legacy fumsv2.js `_BAPI.t(fumsId)` call when only a legacy fumsId is returned).
 *   3. Cached text must not be stored long-term / freely copied: we only keep chapters in memory.
 *   4. The key belongs to the reader. This module never stores or logs it; createKeyStore() keeps
 *      it only in a Storage the caller passes in (e.g. localStorage, after the reader opts in).
 */
import type { BookId, TextChapter } from '../types';

export const APIBIBLE_BASE_URL = 'https://rest.api.bible/v1';
export const APIBIBLE_LEGACY_BASE_URL = 'https://api.scripture.api.bible/v1';
export const FUMS_V3_URL = 'https://fums.api.bible/f3';
export const FUMS_V2_SCRIPT = 'https://cdn.scripture.api.bible/fums/fumsv2.min.js';

/** Credit API.Bible requires on Starter plans (show with any API.Bible text). */
export const APIBIBLE_ATTRIBUTION = { text: 'Scripture text provided by API.Bible', url: 'https://api.bible' } as const;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ApiBibleOptions {
  /** Default APIBIBLE_BASE_URL. */
  baseUrl?: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

export interface ApiBibleLanguage {
  id: string;
  name: string;
  nameLocal?: string;
  script?: string;
  scriptDirection?: 'LTR' | 'RTL';
}

/** A Bible version from GET /bibles. */
export interface ApiBibleSummary {
  id: string;
  dblId?: string;
  abbreviation: string;
  abbreviationLocal?: string;
  name: string;
  nameLocal?: string;
  description?: string;
  descriptionLocal?: string;
  language: ApiBibleLanguage;
  type?: string;
  updatedAt?: string;
  /** Present on GET /bibles/{id}. */
  copyright?: string;
  info?: string;
}

export type ApiBibleErrorKind = 'auth' | 'forbidden' | 'not-found' | 'rate-limit' | 'server' | 'network' | 'parse';

export class ApiBibleError extends Error {
  constructor(
    message: string,
    readonly kind: ApiBibleErrorKind,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiBibleError';
  }
}

export interface ChapterVerses {
  bibleId: string;
  book: BookId;
  chapter: number;
  /** e.g. "John 3". */
  reference: string;
  verses: { v: number; text: string }[];
  /** Section headings: [verse the heading precedes, text]. */
  headings: [number, string][];
  /** Verses that begin a new paragraph (verse 1 implied). */
  paras: number[];
  /** Psalm title not numbered as a verse in this translation. */
  superscription?: string;
  /** Copyright statement that MUST be displayed with the text. */
  copyright: string;
  /** FUMS v3 token (report with reportFums when the chapter is displayed). */
  fumsToken?: string;
  /** Legacy FUMS id (older API responses). */
  fumsId?: string;
}

/* ------------------------------------------------------------------------ */
/* HTTP                                                                      */
/* ------------------------------------------------------------------------ */

async function apiGet<T>(key: string, path: string, params: Record<string, string>, opts: ApiBibleOptions): Promise<T> {
  if (!key || !key.trim()) throw new ApiBibleError('An API.Bible key is required.', 'auth');
  const base = (opts.baseUrl ?? APIBIBLE_BASE_URL).replace(/\/+$/, '');
  const qs = new URLSearchParams(params).toString();
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;
  const doFetch = opts.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  let res: Response;
  try {
    res = await doFetch(url, { headers: { 'api-key': key.trim(), accept: 'application/json' }, signal: opts.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiBibleError('Could not reach API.Bible. Check your connection.', 'network');
  }
  if (!res.ok) {
    // Never echo the key: messages are fixed strings plus the API's own error text.
    let detail = '';
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      detail = body.message ?? body.error ?? '';
    } catch {
      /* non-JSON error body */
    }
    const s = res.status;
    const [kind, msg]: [ApiBibleErrorKind, string] =
      s === 401
        ? ['auth', 'API.Bible rejected the API key.']
        : s === 403
          ? ['forbidden', 'This API key is not authorised for that Bible (add it to your API.Bible app).']
          : s === 404
            ? ['not-found', 'API.Bible has no such Bible or chapter.']
            : s === 429
              ? ['rate-limit', 'API.Bible usage limit reached. Try again later.']
              : ['server', `API.Bible error (HTTP ${s}).`];
    throw new ApiBibleError(detail && kind !== 'auth' ? `${msg} ${detail}` : msg, kind, s);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiBibleError('API.Bible returned an unreadable response.', 'parse', res.status);
  }
}

/** Bibles available to the key in a language (ISO 639-3, default "eng"). */
export async function listBibles(key: string, language = 'eng', opts: ApiBibleOptions = {}): Promise<ApiBibleSummary[]> {
  const params: Record<string, string> = {};
  if (language) params.language = language;
  const body = await apiGet<{ data?: ApiBibleSummary[] }>(key, '/bibles', params, opts);
  if (!Array.isArray(body.data)) throw new ApiBibleError('API.Bible returned an unexpected Bible list.', 'parse');
  return body.data;
}

/** Full details of one Bible (includes `copyright`). */
export async function getBible(key: string, bibleId: string, opts: ApiBibleOptions = {}): Promise<ApiBibleSummary> {
  const body = await apiGet<{ data?: ApiBibleSummary }>(key, `/bibles/${encodeURIComponent(bibleId)}`, {}, opts);
  if (!body.data?.id) throw new ApiBibleError('API.Bible returned an unexpected Bible.', 'parse');
  return body.data;
}

/**
 * Pick a version from a list: exact abbreviation first ("NIV" — not "NIVUK"), then a name match
 * ("New International Version", preferring one that is not Anglicised / UK).
 */
export function findBible(bibles: ApiBibleSummary[], abbr = 'NIV', name = 'New International Version'): ApiBibleSummary | undefined {
  const a = abbr.toLowerCase();
  const exact = bibles.filter((b) => b.abbreviation?.toLowerCase() === a || b.abbreviationLocal?.toLowerCase() === a);
  if (exact.length) return exact.find((b) => !/anglici[sz]ed|\buk\b/i.test(b.name)) ?? exact[0];
  const n = name.toLowerCase();
  const byName = bibles.filter((b) => b.name?.toLowerCase().startsWith(n) || b.nameLocal?.toLowerCase().startsWith(n));
  return byName.find((b) => !/anglici[sz]ed|\buk\b/i.test(b.name)) ?? byName[0];
}

interface ChapterResponse {
  data?: {
    id?: string;
    bibleId?: string;
    number?: string;
    bookId?: string;
    reference?: string;
    copyright?: string;
    content?: ApiNode[] | string;
  };
  meta?: { fumsToken?: string; fumsId?: string; fums?: string };
}

/** One chapter, as verses. Requests JSON content with FUMS v3. */
export async function getChapterVerses(
  key: string,
  bibleId: string,
  book: BookId,
  chapter: number,
  opts: ApiBibleOptions = {},
): Promise<ChapterVerses> {
  const body = await apiGet<ChapterResponse>(key, `/bibles/${encodeURIComponent(bibleId)}/chapters/${book}.${chapter}`, {
    'content-type': 'json',
    'include-notes': 'false',
    'include-titles': 'true',
    'include-chapter-numbers': 'false',
    'include-verse-numbers': 'true',
    'include-verse-spans': 'false',
    'fums-version': '3',
  }, opts);
  const d = body.data;
  if (!d || d.content === undefined) throw new ApiBibleError('API.Bible returned an unexpected chapter.', 'parse');
  const parsed =
    typeof d.content === 'string' ? { ...emptyParse(), verses: parseChapterText(htmlToMarkedText(d.content)) } : parseChapterContent(d.content);
  if (!parsed.verses.length) throw new ApiBibleError('API.Bible returned a chapter without verses.', 'parse');
  const out: ChapterVerses = {
    bibleId: d.bibleId ?? bibleId,
    book,
    chapter,
    reference: d.reference ?? `${book} ${chapter}`,
    verses: parsed.verses,
    headings: parsed.headings,
    paras: parsed.paras,
    copyright: (d.copyright ?? '').trim(),
  };
  if (parsed.superscription) out.superscription = parsed.superscription;
  const token = body.meta?.fumsToken;
  const fumsId = body.meta?.fumsId ?? fumsIdFromSnippet(body.meta?.fums);
  if (token) out.fumsToken = token;
  if (fumsId) out.fumsId = fumsId;
  return out;
}

function fumsIdFromSnippet(snippet?: string): string | undefined {
  // Legacy meta.fums: '<script>…_BAPI.t('ID');</script>'
  const m = snippet ? /_BAPI\.t\(\s*['"]([^'"]+)['"]/.exec(snippet) : null;
  return m?.[1];
}

/* ------------------------------------------------------------------------ */
/* Content parsing                                                           */
/* ------------------------------------------------------------------------ */

/** A node of API.Bible's JSON content format. */
export type ApiNode =
  | { type: 'tag'; name: string; attrs?: Record<string, unknown>; items?: ApiNode[] }
  | { type: 'text'; text: string; attrs?: { verseId?: string; verseOrgIds?: string[]; [k: string]: unknown } };

export interface ParsedContent {
  verses: { v: number; text: string }[];
  headings: [number, string][];
  paras: number[];
  superscription?: string;
}

const emptyParse = (): ParsedContent => ({ verses: [], headings: [], paras: [] });

/** Paragraph styles that are headings (kept) and that are titles / references (dropped). */
const HEADING_STYLE = /^(?:s\d?|ms\d?|qa|sp)$/;
const DROPPED_STYLE = /^(?:mt\d?|mte\d?|imt\d?|is\d?|ip|r|mr|sr|cl|cd|toc\d?|h|rem|ide|restore)$/;
const PROSE_PARA = /^(?:p|m|pi\d?|mi|nb|pc|pm|pmo|pmc|pmr|po|cls|pr)$/;
/** Character styles rendered in small caps that read as capitals in plain text (LORD). */
const SMALL_CAPS = new Set(['nd']);

/** "JHN.3.16" -> 16; "ROM.16.25-ROM.16.27" -> 25. */
function verseFromId(id: unknown): number | null {
  if (typeof id !== 'string') return null;
  const m = /\.(\d+)$/.exec(id.split(/[-–]/)[0]);
  return m ? Number(m[1]) : null;
}

function hasVerseTag(nodes: ApiNode[] | undefined): boolean {
  return (nodes ?? []).some((n) => n.type === 'tag' && (n.name === 'verse' || hasVerseTag(n.items)));
}

/**
 * Turn API.Bible JSON content into verses. Verse membership comes from each text node's
 * attrs.verseId (robust to verses split across paragraphs and poetry lines), falling back to the
 * last verse marker. Notes are dropped; headings and Psalm titles are collected separately.
 */
export function parseChapterContent(content: ApiNode[]): ParsedContent {
  const parts = new Map<number, string[]>();
  const headings: [number, string][] = [];
  const pendingHeadings: string[] = [];
  const paras = new Set<number>();
  const title: string[] = [];
  let current: number | null = null;
  let lastStyle = '';

  const textOf = (node: ApiNode, upper = false): string => {
    if (node.type === 'text') return upper ? node.text.toUpperCase() : node.text;
    if (node.name === 'note' || node.name === 'verse') return '';
    const style = String(node.attrs?.style ?? '');
    return (node.items ?? []).map((n) => textOf(n, upper || SMALL_CAPS.has(style))).join('');
  };

  const startVerse = (v: number) => {
    current = v;
    if (pendingHeadings.length) {
      for (const h of pendingHeadings) headings.push([v, h]);
      pendingHeadings.length = 0;
    }
  };

  const add = (v: number, text: string) => {
    let list = parts.get(v);
    if (!list) parts.set(v, (list = []));
    list.push(text);
  };

  /** Walk paragraph content: returns the first verse that starts in this paragraph (or null). */
  const walk = (nodes: ApiNode[], upper: boolean, onFirstVerse: (v: number, atStart: boolean) => void, state: { seenText: boolean }) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const v = verseFromId(node.attrs?.verseId) ?? current;
        if (v !== null && v !== current) startVerse(v);
        if (v === null) continue; // text before any verse (shouldn't happen outside titles)
        if (node.text.trim()) state.seenText = true;
        add(v, upper ? node.text.toUpperCase() : node.text);
        continue;
      }
      if (node.name === 'note') continue;
      if (node.name === 'verse') {
        const n = parseInt(String(node.attrs?.number ?? ''), 10);
        if (!Number.isNaN(n)) {
          onFirstVerse(n, !state.seenText);
          startVerse(n);
        }
        continue;
      }
      const style = String(node.attrs?.style ?? '');
      walk(node.items ?? [], upper || SMALL_CAPS.has(style), onFirstVerse, state);
    }
  };

  for (const node of content) {
    if (node.type === 'text') {
      // Bare text at top level: attribute by verseId like any other text.
      walk([node], false, () => undefined, { seenText: true });
      continue;
    }
    const style = String(node.attrs?.style ?? '');
    if (node.name === 'para' && DROPPED_STYLE.test(style)) continue;
    if (node.name === 'para' && HEADING_STYLE.test(style)) {
      const h = textOf(node).replace(/\s+/g, ' ').trim();
      if (h) pendingHeadings.push(h);
      lastStyle = style;
      continue;
    }
    if (node.name === 'para' && style === 'd') {
      // Psalm title: a superscription unless the translation numbers it (a verse marker inside).
      if (!hasVerseTag(node.items)) {
        const t = textOf(node).replace(/\s+/g, ' ').trim();
        if (t) title.push(t);
        lastStyle = style;
        continue;
      }
    }
    if (node.name === 'para' && style === 'b') {
      lastStyle = style;
      continue;
    }
    const isProse = PROSE_PARA.test(style);
    const stanzaBreak = /^q/.test(style) && lastStyle === 'b';
    const state = { seenText: false };
    walk(
      node.items ?? [],
      false,
      (v, atStart) => {
        if (atStart && (isProse || stanzaBreak) && v > 1) paras.add(v);
      },
      state,
    );
    // Separate paragraphs / poetry lines with a space inside a verse that continues.
    if (current !== null) add(current, ' ');
    lastStyle = style;
  }

  const verses = [...parts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([v, list]) => ({ v, text: list.join('').replace(/\s+/g, ' ').trim() }))
    .filter((x) => x.text);
  const out: ParsedContent = { verses, headings, paras: [...paras].sort((a, b) => a - b) };
  if (title.length) out.superscription = title.join(' ');
  return out;
}

/** HTML content (if the API ignores content-type=json): verse-number spans -> "[n]", tags dropped. */
function htmlToMarkedText(html: string): string {
  if (!/<[a-z]/i.test(html)) return html;
  return html
    .replace(/<span[^>]*class="[^"]*\bv\b[^"]*"[^>]*>\s*(\d+)[^<]*<\/span>/gi, ' [$1] ')
    .replace(/<(?:sup|span)[^>]*class="[^"]*\b(?:f|x|note)\b[^"]*"[^>]*>[\s\S]*?<\/(?:sup|span)>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Parse content-type=text output ("     [1] In the beginning … [2] Now the earth …").
 * Text before the first marker (e.g. a Psalm title) is ignored.
 */
export function parseChapterText(text: string): { v: number; text: string }[] {
  const out: { v: number; text: string }[] = [];
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  let last: { v: number; start: number } | null = null;
  while ((m = re.exec(text))) {
    if (last) out.push({ v: last.v, text: text.slice(last.start, m.index) });
    last = { v: Number(m[1]), start: m.index + m[0].length };
  }
  if (last) out.push({ v: last.v, text: text.slice(last.start) });
  return out.map((x) => ({ v: x.v, text: x.text.replace(/\s+/g, ' ').trim() })).filter((x) => x.text);
}

/* ------------------------------------------------------------------------ */
/* TextChapter adapter                                                       */
/* ------------------------------------------------------------------------ */

/** Copyright / FUMS info for chapters produced by toTextChapter (kept off the shared type). */
export interface ApiBibleChapterMeta {
  bibleId: string;
  copyright: string;
  fumsToken?: string;
  fumsId?: string;
}

const metaOf = new WeakMap<TextChapter, ApiBibleChapterMeta>();

/** Copyright and FUMS info for a chapter that came from API.Bible (undefined otherwise). */
export function apiBibleMeta(ch: TextChapter): ApiBibleChapterMeta | undefined {
  return metaOf.get(ch);
}

/**
 * Convert to the app's TextChapter. Tokens are plain strings (no original-language links); run
 * the bridge alignment (src/lib/align) over it to link words through the BSB.
 */
export function toTextChapter(tr: string, c: ChapterVerses): TextChapter {
  const ch: TextChapter = {
    tr,
    book: c.book,
    chapter: c.chapter,
    verses: c.verses.map((v) => ({ v: v.v, t: [v.text] })),
  };
  if (c.headings.length) ch.headings = c.headings;
  if (c.paras.length) ch.paras = c.paras;
  if (c.superscription) ch.superscription = [c.superscription];
  const meta: ApiBibleChapterMeta = { bibleId: c.bibleId, copyright: c.copyright };
  if (c.fumsToken) meta.fumsToken = c.fumsToken;
  if (c.fumsId) meta.fumsId = c.fumsId;
  metaOf.set(ch, meta);
  return ch;
}

/**
 * A loader for data.ts's registerTextSource:
 *   registerTextSource('NIV', createApiBibleTextSource(key, bibleId, 'NIV'))
 * Remember to display apiBibleMeta(ch).copyright and call reportFums when the chapter is shown.
 */
export function createApiBibleTextSource(
  key: string,
  bibleId: string,
  tr: string,
  opts: ApiBibleOptions = {},
): (book: BookId, chapter: number) => Promise<TextChapter> {
  return async (book, chapter) => toTextChapter(tr, await getChapterVerses(key, bibleId, book, chapter, opts));
}

/* ------------------------------------------------------------------------ */
/* FUMS                                                                      */
/* ------------------------------------------------------------------------ */

export interface FumsIds {
  /** Constant per device; random, not personally identifying. */
  deviceId: string;
  /** Per reading session. */
  sessionId: string;
  /** Optional anonymised user id. */
  userId?: string;
}

/** Minimal Storage interface (localStorage / sessionStorage / a test double). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('-');
}

/**
 * Device / session ids for FUMS. The device id persists in `deviceStorage` (e.g. localStorage) and
 * the session id in `sessionStorage` when given; otherwise they live for this page load only.
 */
export function createFumsIds(deviceStorage?: KeyValueStorage | null, sessionStorage?: KeyValueStorage | null): FumsIds {
  const get = (s: KeyValueStorage | null | undefined, k: string) => {
    try {
      let v = s?.getItem(k) ?? null;
      if (!v) {
        v = randomId();
        s?.setItem(k, v);
      }
      return v;
    } catch {
      return randomId();
    }
  };
  return { deviceId: get(deviceStorage, 'apibible.fums.device'), sessionId: get(sessionStorage, 'apibible.fums.session') };
}

/** FUMS v3 report URL for one or more tokens. */
export function fumsReportUrl(tokens: string[], ids: FumsIds): string {
  const p = new URLSearchParams();
  for (const t of tokens) p.append('t', t);
  p.set('dId', ids.deviceId);
  p.set('sId', ids.sessionId);
  if (ids.userId) p.set('uId', ids.userId);
  return `${FUMS_V3_URL}?${p.toString()}`;
}

let legacyScript: Promise<void> | null = null;

/**
 * Report that API.Bible text is being displayed (call once per chapter view). Uses FUMS v3 when
 * a token is available (an invisible image request, like the documented pixel), otherwise the
 * legacy fumsv2.js `_BAPI.t(fumsId)`. Never throws; a no-op outside the browser unless `send` is given.
 */
export function reportFums(
  meta: { fumsToken?: string; fumsId?: string } | undefined,
  ids: FumsIds,
  opts: { send?: (url: string) => void } = {},
): void {
  if (!meta) return;
  try {
    if (meta.fumsToken) {
      const url = fumsReportUrl([meta.fumsToken], ids);
      if (opts.send) opts.send(url);
      else if (typeof Image !== 'undefined') new Image().src = url;
      else if (typeof fetch !== 'undefined') void fetch(url, { mode: 'no-cors', keepalive: true }).catch(() => undefined);
      return;
    }
    if (meta.fumsId && typeof document !== 'undefined') {
      const id = meta.fumsId;
      legacyScript ??= new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = FUMS_V2_SCRIPT;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
          legacyScript = null;
          reject(new Error('FUMS script failed to load'));
        };
        document.head.appendChild(s);
      });
      legacyScript
        .then(() => {
          const bapi = (window as unknown as { _BAPI?: { t?: (id: string) => void } })._BAPI;
          bapi?.t?.(id);
        })
        .catch(() => undefined);
    }
  } catch {
    /* reporting must never break reading */
  }
}

/* ------------------------------------------------------------------------ */
/* Key storage                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Keep the reader's API key in a storage THEY chose (pass localStorage only after they opt in to
 * "remember my key"; pass null to keep it in memory for this page only).
 */
export function createKeyStore(storage: KeyValueStorage | null, name = 'apibible.key') {
  let memory: string | null = null;
  return {
    get(): string | null {
      if (memory) return memory;
      try {
        return storage?.getItem(name) ?? null;
      } catch {
        return null;
      }
    },
    set(key: string | null): void {
      memory = key?.trim() || null;
      try {
        if (memory) storage?.setItem(name, memory);
        else storage?.removeItem(name);
      } catch {
        /* storage unavailable: memory only */
      }
    },
  };
}
