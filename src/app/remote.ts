/**
 * Runtime translations through the reader's OWN API.Bible key (the NIV and other copyrighted
 * English Bibles on their API.Bible plan). Nothing copyrighted is bundled: each chapter is fetched in
 * the browser (src/lib/providers/apibible.ts), bridged to the Greek / Hebrew through the BSB
 * (src/lib/align, so hovering works with approximate links) and kept in memory only.
 *
 * Persistence: localStorage "rootword:apibible" = { key, bibles: [{ id, abbr, name, copyright?, year? }] }
 * (`id` = the API.Bible Bible id, `abbr` = the translation id used in URLs, e.g. "NIV"). That is the
 * ONLY place the key is written; it is never logged and only ever sent to API.Bible in the `api-key`
 * header. initRemoteTranslations() re-registers the saved Bibles synchronously at startup (main.tsx,
 * before render), so a cold "#/NIV/JHN/3" link opens the NIV instead of falling back to the KJV.
 *
 * The Settings sheet (src/components/settings/TranslationsSection.tsx) drives connect / add / remove /
 * disconnect through the functions below; the pure helpers (bibleChoices, compactCopyright, …) are
 * unit-tested in tests/remote.test.ts with a mocked fetch.
 */
import { signal } from '@preact/signals';
import type { TranslationTable } from '../lib/align/table';
import { dataUrl, loadOrig, loadText } from '../lib/data';
import type { TextSource } from '../lib/data';
import { ApiBibleError, findBible, getBible, getChapterVerses, listBibles, toTextChapter } from '../lib/providers/apibible';
import type { ApiBibleOptions, ApiBibleSummary } from '../lib/providers/apibible';
import { formatChapter } from '../lib/reference';
import type { BookId, TranslationMeta } from '../lib/types';
import { meta, navigate, passage, registerRemoteTranslation, showToast, unregisterRemoteTranslation } from './state';
import { readJson, writeJson, writeString } from './storage';

/* ------------------------------------------------------------------------ */
/* Types & persistence                                                       */
/* ------------------------------------------------------------------------ */

/** localStorage key (without the "rootword:" prefix) of the saved connection. */
export const APIBIBLE_STORAGE_KEY = 'apibible';

/** Where readers get a free key. */
export const APIBIBLE_SIGNUP_URL = 'https://api.bible/sign-up';
export const APIBIBLE_HOME_URL = 'https://api.bible';

/** One Bible the reader added. */
export interface SavedBible {
  /** API.Bible Bible id, e.g. "78a9f6124f344018-01". */
  id: string;
  /** Translation id / abbreviation used in URLs and the picker, e.g. "NIV". */
  abbr: string;
  /** Display name, e.g. "New International Version". */
  name: string;
  /** Full copyright statement (from GET /bibles/{id} or a chapter response). */
  copyright?: string;
  year?: string;
}

export interface SavedConnection {
  key: string;
  bibles: SavedBible[];
}

/** Bundled translation ids used before meta.json has loaded. */
const BUNDLED_FALLBACK = ['KJV', 'BSB', 'WEB', 'ASV', 'YLT'];

/** The saved connection (null when not connected). The settings sheet reads this; never render the key. */
export const apiBibleConnection = signal<SavedConnection | null>(null);

/** The last problem loading a remote chapter (shown in Settings → Translations). */
export const remoteProblem = signal<{ tr: string; book: BookId; chapter: number; message: string } | null>(null);

function isSavedBible(x: unknown): x is SavedBible {
  const b = x as SavedBible | null;
  return Boolean(b && typeof b === 'object' && typeof b.id === 'string' && b.id && typeof b.abbr === 'string' && b.abbr && typeof b.name === 'string');
}

/** The saved connection from localStorage, validated (null if absent or malformed). */
export function readSavedConnection(): SavedConnection | null {
  const raw = readJson<unknown>(APIBIBLE_STORAGE_KEY, null);
  if (!raw || typeof raw !== 'object') return null;
  const { key, bibles } = raw as { key?: unknown; bibles?: unknown };
  if (typeof key !== 'string' || !key.trim()) return null;
  const list = Array.isArray(bibles) ? bibles.filter(isSavedBible) : [];
  // abbr must be a usable, unique translation id
  const seen = new Set<string>();
  const clean = list
    .map((b) => ({ ...b, abbr: sanitizeId(b.abbr) }))
    .filter((b) => b.abbr && !seen.has(b.abbr) && (seen.add(b.abbr), true));
  return { key: key.trim(), bibles: clean };
}

function save(conn: SavedConnection | null): void {
  if (conn) {
    const bibles = conn.bibles.map((b) => {
      const out: SavedBible = { id: b.id, abbr: b.abbr, name: b.name };
      if (b.copyright) out.copyright = b.copyright;
      if (b.year) out.year = b.year;
      return out;
    });
    writeJson(APIBIBLE_STORAGE_KEY, { key: conn.key, bibles });
  } else writeString(APIBIBLE_STORAGE_KEY, null);
  apiBibleConnection.value = conn;
}

/* ------------------------------------------------------------------------ */
/* Pure helpers                                                              */
/* ------------------------------------------------------------------------ */

/** Upper-case letters and digits only (URL-safe translation id), at most 12 characters. */
export function sanitizeId(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);
}

/** Translation id for an API.Bible Bible: its local abbreviation ("NIV"; "engKJV" → "KJV"). */
export function translationIdFor(b: Pick<ApiBibleSummary, 'abbreviation' | 'abbreviationLocal'>): string {
  const raw = (b.abbreviationLocal || b.abbreviation || '').trim().replace(/^eng(?=[A-Z])/, '');
  return sanitizeId(raw) || 'APIBIBLE';
}

const YEAR = /\b(1[5-9]\d\d|20\d\d)\b/;

/** Publication year mentioned in the Bible's name / description ("New International Version 2011" → "2011"). */
export function yearOf(b: Pick<ApiBibleSummary, 'name' | 'nameLocal' | 'description'>): string {
  for (const s of [b.nameLocal, b.name, b.description]) {
    const m = s ? YEAR.exec(s) : null;
    if (m) return m[1];
  }
  return '';
}

/** Display name without a trailing year: "New International Version 2011" → "New International Version". */
export function displayName(b: Pick<ApiBibleSummary, 'name' | 'nameLocal'>): string {
  const n = (b.nameLocal || b.name || '').replace(/\s+/g, ' ').trim();
  return n.replace(/\s*\(?\b(1[5-9]\d\d|20\d\d)\)?\s*$/, '').trim() || n;
}

/**
 * A short copyright line for pickers from API.Bible's full statement:
 * "… Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by Permission …" → "© Biblica, Inc.".
 * The full statement is still shown with the text (Reader colophon, from apiBibleMeta).
 */
export function compactCopyright(full: string | undefined): string {
  const s = (full ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const by = /(?:©|\(c\)|copyright)[^©]*?\bby\s+([A-Z][^®™;]*?)(?:[®™;]|\.(?:\s|$)|$)/i.exec(s);
  let holder = by?.[1]?.trim() ?? '';
  if (!holder) {
    const after = /©\s*(?:\d{4}(?:\s*[,–-]\s*\d{4})*\s*,?\s*)?([A-Z][^®™.;]*)/.exec(s);
    holder = after?.[1]?.trim() ?? '';
  }
  if (holder) {
    holder = holder.replace(/,(?!\s*(?:Inc|Ltd|LLC|Co)\b).*$/, '').replace(/[\s,]+$/, '');
    if (holder.length > 2 && holder.length <= 60) return `© ${holder}`;
  }
  return s.length <= 60 ? s : 'Copyrighted text';
}

/** One row of the "choose your Bibles" list. */
export interface BibleChoice {
  bible: ApiBibleSummary;
  /** Translation id it would get ("NIV"). */
  tr: string;
  name: string;
  year: string;
  /** Already bundled with Rootword (KJV, BSB, WEB, ASV, YLT): not offered. */
  bundled: boolean;
  /** Already added (checked by default). */
  added: boolean;
  /** Checked when the list opens: the NIV (not the Anglicised NIVUK) and anything already added. */
  checked: boolean;
  /** This is the NIV the app looks for. */
  isNiv: boolean;
}

/**
 * Turn GET /bibles?language=eng into the list the reader picks from: the NIV first (preselected),
 * then the rest by name; bundled translations are marked so they aren't added twice.
 */
export function bibleChoices(list: ApiBibleSummary[], bundledIds: readonly string[], existing: readonly SavedBible[] = []): BibleChoice[] {
  const niv = findBible(list);
  const bundled = new Set(bundledIds.map((x) => x.toUpperCase()));
  const addedIds = new Set(existing.map((b) => b.id));
  const used = new Set<string>([...bundled, ...existing.map((b) => b.abbr)]);
  const out: BibleChoice[] = [];
  const ordered = [...list].sort((a, b) => {
    if (a === niv) return -1;
    if (b === niv) return 1;
    return displayName(a).localeCompare(displayName(b));
  });
  for (const bible of ordered) {
    const prior = existing.find((b) => b.id === bible.id);
    let tr = prior?.abbr ?? translationIdFor(bible);
    const isBundled = !prior && bundled.has(tr);
    if (!prior && !isBundled && used.has(tr)) {
      let n = 2;
      while (used.has(`${tr}${n}`)) n++;
      tr = `${tr}${n}`;
    }
    if (!isBundled) used.add(tr);
    const added = addedIds.has(bible.id);
    out.push({
      bible,
      tr,
      name: displayName(bible),
      year: yearOf(bible),
      bundled: isBundled,
      added,
      checked: added || (!existing.length && bible === niv && !isBundled),
      isNiv: bible === niv,
    });
  }
  return out;
}

/** The TranslationMeta a saved Bible is registered with (approximate links, via API.Bible). */
export function remoteMeta(b: SavedBible): TranslationMeta {
  const short = compactCopyright(b.copyright) || 'Copyrighted text';
  return {
    id: b.abbr,
    name: b.name,
    abbr: b.abbr,
    year: b.year ?? '',
    license: `${short} · via API.Bible`,
    alignment: 'bridged',
    description: `Fetched from API.Bible with your own key and kept in this browser’s memory only. Its words are matched to the Greek and Hebrew automatically through the BSB, so the links are approximate.${
      b.copyright ? ` ${b.copyright.replace(/\s+/g, ' ').trim()}` : ''
    }`,
    source: APIBIBLE_HOME_URL,
    remote: true,
  };
}

/** Plain-English explanation of an API.Bible failure, for the connect form or a reading error. */
export function explainApiBibleError(err: unknown, ctx: { what?: string; tr?: string } = {}): string {
  const what = ctx.what ?? 'that';
  const tr = ctx.tr ?? 'this Bible';
  if (err instanceof ApiBibleError) {
    switch (err.kind) {
      case 'auth':
        return 'API.Bible didn’t accept that key. Copy the whole key from your app at api.bible (My apps) and try again.';
      case 'forbidden':
        return `Your API.Bible key isn’t allowed to read ${tr}. Add it to your app at api.bible, then try again.`;
      case 'not-found':
        return `API.Bible has no ${what} in ${tr}.`;
      case 'rate-limit':
        return 'Your API.Bible usage limit has been reached. Try again later.';
      case 'network':
        return 'Your browser couldn’t reach API.Bible (rest.api.bible). Check your connection; if you are online, a content blocker, firewall or network filter may be blocking it.';
      case 'parse':
        return `API.Bible sent something Rootword couldn’t read for ${what}. Try again later.`;
      default:
        return `API.Bible had a problem (${err.status ? `HTTP ${err.status}` : 'server error'}). Try again later.`;
    }
  }
  if (err instanceof Error && err.name === 'AbortError') return 'Cancelled.';
  return 'Something went wrong talking to API.Bible. Try again.';
}

/* ------------------------------------------------------------------------ */
/* Chapter source: API.Bible text + BSB bridge                               */
/* ------------------------------------------------------------------------ */

/** Test hook: a fetch / base URL for every API.Bible request made here. */
let apiOptions: ApiBibleOptions = {};
export function configureRemote(opts: ApiBibleOptions): void {
  apiOptions = { ...opts };
}

let alignPromise: Promise<{ table: TranslationTable; bridge: typeof import('../lib/align/bridge').bridgeChapter }> | null = null;

/** The bridge aligner and its translation table (public/data/align/table.json), loaded once on demand. */
function loadAligner() {
  if (!alignPromise) {
    const p = (async () => {
      // ALIGN_TABLE_PATH (src/lib/align), inlined so the table request starts with the module import
      const [align, res] = await Promise.all([import('../lib/align'), fetch(dataUrl('align/table.json'))]);
      if (!res.ok) throw new Error(`align table: HTTP ${res.status}`);
      return { table: align.TranslationTable.fromJson(await res.json()), bridge: align.bridgeChapter };
    })();
    alignPromise = p;
    p.catch(() => {
      if (alignPromise === p) alignPromise = null;
    });
  }
  return alignPromise;
}

/**
 * The TextSource for a saved Bible: GET the chapter → toTextChapter → bridge it through the BSB to the
 * Greek / Hebrew. The bridged tokens are written back onto the object toTextChapter returned, so
 * apiBibleMeta(chapter) (copyright + FUMS token, kept in a WeakMap keyed by that object) keeps working
 * for the reader's copyright line and FUMS report. Without the original-language data the plain text
 * is returned (reading still works, without word links).
 */
export function createRemoteSource(key: string, bible: SavedBible): TextSource {
  const tr = bible.abbr;
  return async (book: BookId, chapter: number) => {
    try {
      const [cv, bsb, orig, aligner] = await Promise.all([
        getChapterVerses(key, bible.id, book, chapter, apiOptions),
        loadText('BSB', book, chapter).catch(() => undefined),
        loadOrig(book, chapter).catch(() => null),
        loadAligner().catch(() => null),
      ]);
      const text = toTextChapter(tr, cv);
      if (orig && aligner) {
        try {
          const bridged = aligner.bridge(text, bsb, orig, aligner.table);
          text.verses = bridged.verses;
          if (bridged.superscription) text.superscription = bridged.superscription;
        } catch {
          /* keep the plain text: links are a bonus */
        }
      }
      if (cv.copyright) noteCopyright(tr, cv.copyright);
      const p = remoteProblem.peek();
      if (p && p.tr === tr && p.book === book && p.chapter === chapter) remoteProblem.value = null;
      return text;
    } catch (err) {
      reportReadError(err, tr, book, chapter);
      throw err;
    }
  };
}

/** A chapter failed: remember it for Settings, and tell the reader when it is the chapter on screen. */
function reportReadError(err: unknown, tr: string, book: BookId, chapter: number): void {
  if (err instanceof Error && err.name === 'AbortError') return;
  const label = formatChapter(book, chapter);
  const message =
    err instanceof ApiBibleError && err.kind === 'auth'
      ? `API.Bible no longer accepts your key. Update it in Settings → Translations.`
      : explainApiBibleError(err, { what: label, tr: `the ${tr}` });
  remoteProblem.value = { tr, book, chapter, message };
  const { tr: curTr, ref } = passage.peek();
  if (curTr === tr && ref.book === book && ref.chapter === chapter) showToast(message, 6000);
}

/** Store the copyright statement a chapter came with (fills in / refreshes the picker's licence line). */
function noteCopyright(tr: string, copyright: string): void {
  const conn = apiBibleConnection.peek();
  const b = conn?.bibles.find((x) => x.abbr === tr);
  if (!conn || !b || b.copyright === copyright) return;
  const next = { ...b, copyright };
  save({ ...conn, bibles: conn.bibles.map((x) => (x === b ? next : x)) });
  registerRemoteTranslation(remoteMeta(next)); // no source: keeps the registered one
}

/* ------------------------------------------------------------------------ */
/* Actions                                                                   */
/* ------------------------------------------------------------------------ */

/** Translation ids this module registered (so a reload / disconnect removes exactly those). */
const registered = new Set<string>();

function registerSaved(conn: SavedConnection): void {
  const keep = new Set(conn.bibles.map((b) => b.abbr));
  for (const id of [...registered]) {
    if (!keep.has(id)) {
      unregisterRemoteTranslation(id);
      registered.delete(id);
    }
  }
  for (const b of conn.bibles) {
    registerRemoteTranslation(remoteMeta(b), createRemoteSource(conn.key, b));
    registered.add(b.abbr);
  }
}

/**
 * Re-register the saved API.Bible translations. Synchronous (no network): call once from main.tsx
 * before the first render. Safe to call again (re-reads storage).
 */
export function initRemoteTranslations(): void {
  try {
    const conn = readSavedConnection();
    apiBibleConnection.value = conn;
    registerSaved(conn ?? { key: '', bibles: [] });
  } catch {
    /* storage unavailable: no remote translations */
  }
}

/** Ids of the bundled translations (meta.json, or the known list while it loads). */
export function bundledIds(): string[] {
  const list = meta.peek()?.translations.filter((t) => !t.remote).map((t) => t.id);
  return list?.length ? list : BUNDLED_FALLBACK;
}

/** Check a key and list the English Bibles on its plan (GET /bibles?language=eng). */
export async function connectApiBible(key: string, opts: { signal?: AbortSignal } = {}): Promise<BibleChoice[]> {
  const k = key.trim();
  if (!k) throw new ApiBibleError('An API.Bible key is required.', 'auth');
  const list = await listBibles(k, 'eng', { ...apiOptions, ...opts });
  // Bibles already added stay checked (also when the key changes, as long as the new plan has them).
  return bibleChoices(list, bundledIds(), apiBibleConnection.peek()?.bibles ?? []);
}

/**
 * Save the key and exactly the chosen Bibles (adding new ones, removing unchecked ones). Copyright
 * statements are looked up for newly added Bibles (GET /bibles/{id}); a Bible the key may not read
 * (403 / 404) is skipped and reported. Returns the translations now registered and any skipped ones.
 */
export async function saveApiBibles(
  key: string,
  chosen: readonly BibleChoice[],
  opts: { signal?: AbortSignal } = {},
): Promise<{ added: SavedBible[]; kept: SavedBible[]; skipped: { choice: BibleChoice; message: string }[] }> {
  const k = key.trim();
  const prev = apiBibleConnection.peek();
  const prior = new Map((prev?.bibles ?? []).map((b) => [b.id, b]));
  const skipped: { choice: BibleChoice; message: string }[] = [];
  const results = await Promise.all(
    chosen.map(async (c): Promise<SavedBible | null> => {
      const old = prior.get(c.bible.id);
      if (old && prev?.key === k) return old;
      const base: SavedBible = { id: c.bible.id, abbr: c.tr, name: c.name };
      if (c.year) base.year = c.year;
      try {
        const full = await getBible(k, c.bible.id, { ...apiOptions, ...opts });
        if (full.copyright) base.copyright = stripTags(full.copyright);
        else if (old?.copyright) base.copyright = old.copyright;
        return base;
      } catch (err) {
        if (err instanceof ApiBibleError && (err.kind === 'forbidden' || err.kind === 'not-found')) {
          skipped.push({ choice: c, message: explainApiBibleError(err, { tr: `the ${c.tr}` }) });
          return null;
        }
        throw err;
      }
    }),
  );
  const bibles = results.filter((b): b is SavedBible => Boolean(b));
  const conn: SavedConnection = { key: k, bibles };
  const removed = (prev?.bibles ?? []).filter((b) => !bibles.some((x) => x.abbr === b.abbr));
  save(conn);
  registerSaved(conn);
  fallBackIfRemoved(removed.map((b) => b.abbr));
  return { added: bibles.filter((b) => !prior.has(b.id)), kept: bibles.filter((b) => prior.has(b.id)), skipped };
}

/** Remove one added Bible (keeps the key). */
export function removeApiBible(tr: string): void {
  const conn = apiBibleConnection.peek();
  if (!conn) return;
  const next: SavedConnection = { ...conn, bibles: conn.bibles.filter((b) => b.abbr !== tr) };
  save(next);
  registerSaved(next);
  fallBackIfRemoved([tr]);
}

/** Forget the key and every API.Bible translation (falls back to the KJV if one is open). */
export function disconnectApiBible(): void {
  const ids = [...new Set([...registered, ...(apiBibleConnection.peek()?.bibles.map((b) => b.abbr) ?? [])])];
  save(null);
  for (const id of ids) unregisterRemoteTranslation(id);
  registered.clear();
  remoteProblem.value = null;
  fallBackIfRemoved(ids);
}

/** If the chapter on screen is in a translation that just went away, reopen it in the KJV. */
function fallBackIfRemoved(ids: string[]): void {
  const { tr, ref } = passage.peek();
  if (!ids.includes(tr)) return;
  navigate({ book: ref.book, chapter: ref.chapter }, 'KJV', { replace: true });
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&copy;/g, '©')
    .replace(/\s+/g, ' ')
    .trim();
}
