/**
 * Global app state (@preact/signals) and the actions that change it. See ./README.md for the API
 * other components rely on (search panel, settings sheet, remote translations).
 *
 * Importing this module has no side effects on the DOM; call initState() once at startup (main.tsx)
 * to apply the theme / font scale to <html> and persist changes.
 */
import { batch, computed, effect, signal } from '@preact/signals';
import { registerTextSource, unregisterTextSource } from '../lib/data';
import type { TextSource } from '../lib/data';
import { refToHash } from '../lib/reference';
import type { DataMeta, TranslationMeta, VerseRef } from '../lib/types';
import type { Route } from './router';
import { readJson, readString, writeJson, writeString } from './storage';

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

export type Theme = 'light' | 'dark' | 'system';
export type ReadingMode = 'reading' | 'interlinear';

/** Where we are reading: translation id + chapter (and optional target verse / range). */
export interface Passage {
  tr: string;
  ref: VerseRef;
}

/**
 * A word (interactive unit) in the chapter on screen. `key` = "TR/BOOK/CHAPTER" of the chapter the
 * unit index belongs to, so a stale reference never opens the wrong word after navigation.
 */
export interface WordRef {
  key: string;
  /** Unit index in the reader's chapter model (data-u attribute). */
  unit: number;
  /** How it was opened: decides card form (tooltip / dialog / bottom sheet) and focus handling. */
  via: 'hover' | 'focus' | 'click' | 'touch' | 'keyboard';
}

/** Reader preferences (persisted as JSON in localStorage "rootword:settings"). */
export interface Settings {
  /** Open the word card on hover (mouse / trackpad). Off: click, tap or Enter only. */
  hoverCards: boolean;
  /** While a word is active, mark other words with the same Strong's number (dotted underline). */
  markRelated: boolean;
  /** Interlinear: transliteration line under the original. */
  ilTranslit: boolean;
  /** Interlinear: short gloss line. */
  ilGloss: boolean;
  /** 'auto': paragraphs when the translation has them (BSB), else one verse per line (KJV). */
  layout: 'auto' | 'paragraphs' | 'verses';
  /** Section headings (translations that have them). */
  headings: boolean;
  /** Raw morphology codes (N-NSM, Ncmpa) beside the plain-English parsing in the word card. */
  morphCodes: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  hoverCards: true,
  markRelated: true,
  ilTranslit: true,
  ilGloss: false,
  layout: 'auto',
  headings: true,
  morphCodes: true,
};

/* ------------------------------------------------------------------------ */
/* Persisted values                                                          */
/* ------------------------------------------------------------------------ */

const THEMES: Theme[] = ['light', 'dark', 'system'];
function loadTheme(): Theme {
  const t = readString('theme');
  return THEMES.includes(t as Theme) ? (t as Theme) : 'system';
}
function loadMode(): ReadingMode {
  return readString('mode') === 'interlinear' ? 'interlinear' : 'reading';
}
export const FONT_SCALES = [0.9, 1, 1.1, 1.2, 1.32] as const;
function loadFontScale(): number {
  const n = Number(readString('fontScale'));
  return n >= 0.8 && n <= 1.5 ? n : 1;
}
function loadSettings(): Settings {
  const s = readJson<Partial<Settings>>('settings', {});
  return { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
}

/* ------------------------------------------------------------------------ */
/* Signals                                                                   */
/* ------------------------------------------------------------------------ */

/** public/data/meta.json once loaded (null while loading / on error). */
export const meta = signal<DataMeta | null>(null);
export const metaError = signal<Error | null>(null);

/** Translations fetched at runtime (e.g. NIV via API.Bible), registered with registerRemoteTranslation. */
export const remoteTranslations = signal<TranslationMeta[]>([]);

/** Every translation the reader can choose, in picker order: meta.json order (KJV first), then remote ones. */
export const translations = computed<TranslationMeta[]>(() => {
  const bundled = meta.value?.translations ?? [];
  const ids = new Set(bundled.map((t) => t.id));
  return [...bundled, ...remoteTranslations.value.filter((t) => !ids.has(t.id))];
});

/** The parsed location hash (set by the router). */
export const route = signal<Route>({ name: 'read', tr: 'KJV', ref: { book: 'JHN', chapter: 1 } });
/** The chapter being read (also shown under #/search and kept while on #/about). */
export const passage = signal<Passage>({ tr: 'KJV', ref: { book: 'JHN', chapter: 1 } });

export const theme = signal<Theme>(loadTheme());
export const readingMode = signal<ReadingMode>(loadMode());
/** Reading-text size multiplier (0.8–1.5). */
export const fontScale = signal<number>(loadFontScale());
export const settings = signal<Settings>(loadSettings());

/** The word under the pointer / keyboard focus (card shown as a tooltip). */
export const activeWord = signal<WordRef | null>(null);
/** The word whose card is pinned open (dialog / bottom sheet). Takes precedence over activeWord. */
export const pinnedWord = signal<WordRef | null>(null);

export const searchOpen = signal(false);
/** Text of the header search field (two-way: the panel may set it, e.g. when a facet is chosen). */
export const searchQuery = signal('');
/**
 * Keys typed in the header search field (↑ ↓ Enter Esc…) are offered to this handler first, so the
 * search panel can drive its result list. Return true when the key was handled.
 */
export const searchKeys: { handler: ((e: KeyboardEvent) => boolean) | null } = { handler: null };
/** id of the header search <input> (e.g. for aria-controls / focusing). */
export const SEARCH_INPUT_ID = 'search-input';
export const settingsOpen = signal(false);
/** Optional section the settings sheet should scroll to when opened (e.g. "niv"). */
export const settingsSection = signal<string | null>(null);

/** Transient message shown in the toast (role=status). */
export const toastMessage = signal<string | null>(null);
/** Text for the polite live region (screen readers). */
export const liveMessage = signal('');

/* ------------------------------------------------------------------------ */
/* Actions                                                                   */
/* ------------------------------------------------------------------------ */

/** Open a chapter / verse. `tr` defaults to the current translation. */
export function navigate(ref: VerseRef, tr: string = passage.value.tr, opts: { replace?: boolean } = {}): void {
  goToHash(refToHash(tr, ref), opts.replace);
}

/** Switch translation, keeping the chapter. */
export function setTranslation(tr: string): void {
  const { ref } = passage.value;
  navigate({ book: ref.book, chapter: ref.chapter }, tr);
}

export function goToHash(hash: string, replace = false): void {
  if (typeof window === 'undefined') return;
  if (replace) {
    window.history.replaceState(window.history.state, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

/** Open the search panel, optionally with a query (e.g. a Strong's number "G3056"). */
export function openSearch(query?: string): void {
  batch(() => {
    if (query !== undefined) searchQuery.value = query;
    searchOpen.value = true;
    pinnedWord.value = null;
    activeWord.value = null;
  });
}

export function closeSearch(): void {
  searchOpen.value = false;
  if (route.value.name === 'search') {
    const { tr, ref } = passage.value;
    goToHash(refToHash(tr, { book: ref.book, chapter: ref.chapter }), true);
  }
}

export function openSettings(section: string | null = null): void {
  batch(() => {
    settingsSection.value = section;
    settingsOpen.value = true;
    searchOpen.value = false;
  });
}

export function closeSettings(): void {
  settingsOpen.value = false;
}

export function setTheme(t: Theme): void {
  theme.value = t;
}

/** light → dark → system → light … */
export function cycleTheme(): void {
  const order: Theme[] = ['light', 'dark', 'system'];
  theme.value = order[(order.indexOf(theme.value) + 1) % order.length];
}

export function setReadingMode(m: ReadingMode): void {
  readingMode.value = m;
}

export function setFontScale(n: number): void {
  fontScale.value = Math.min(1.5, Math.max(0.8, Math.round(n * 100) / 100));
}

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}

/** Close the word card (both hover and pinned). */
export function closeWord(): void {
  batch(() => {
    pinnedWord.value = null;
    activeWord.value = null;
  });
}

/**
 * Make a runtime translation (e.g. NIV via API.Bible) available: registers its chapter source with
 * the data layer and lists it in the translation picker. Call again to replace it.
 * `meta.remote` should be true and `meta.alignment` usually 'bridged' (or 'none').
 */
export function registerRemoteTranslation(t: TranslationMeta, source?: TextSource): void {
  if (source) registerTextSource(t.id, source);
  const rest = remoteTranslations.value.filter((x) => x.id !== t.id);
  remoteTranslations.value = [...rest, { ...t, remote: true }];
}

export function unregisterRemoteTranslation(id: string): void {
  unregisterTextSource(id);
  remoteTranslations.value = remoteTranslations.value.filter((x) => x.id !== id);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string, ms = 2600): void {
  toastMessage.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMessage.value = null), ms);
}

/** Announce text politely to screen readers. */
export function announce(message: string): void {
  // Clear first so repeating the same message is announced again.
  liveMessage.value = '';
  queueMicrotask(() => (liveMessage.value = message));
}

/* ------------------------------------------------------------------------ */
/* Startup                                                                   */
/* ------------------------------------------------------------------------ */

const THEME_COLORS = { light: '#fafaf7', dark: '#101319' };

/** The theme actually in effect (resolving 'system' through the OS preference). */
export function effectiveTheme(t: Theme = theme.value): 'light' | 'dark' {
  if (t !== 'system') return t;
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  return mq?.matches ? 'dark' : 'light';
}

let initialised = false;
/** Apply persisted preferences to <html> and keep them in sync. Call once from main.tsx. */
export function initState(): void {
  if (initialised || typeof document === 'undefined') return;
  initialised = true;
  const root = document.documentElement;
  effect(() => {
    const t = theme.value;
    writeString('theme', t);
    if (t === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    metas.forEach((m) => {
      const media = m.getAttribute('media') ?? '';
      const fromMedia = media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
      m.setAttribute('content', t === 'system' ? fromMedia : THEME_COLORS[t]);
    });
  });
  effect(() => {
    root.style.setProperty('--font-scale', String(fontScale.value));
    writeString('fontScale', String(fontScale.value));
  });
  effect(() => writeString('mode', readingMode.value));
  effect(() => writeJson('settings', settings.value));
}
