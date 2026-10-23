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
import { beforeReflow, flushPlace, readerHooks, savePlace } from './place';
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

  /* docs/EXPERIENCE.md — feedback, accessibility and touch preferences */
  /** Haptic feedback on touch devices (vibration / iOS switch haptic). */
  haptics: boolean;
  /** Synthesized sound effects (tick, chime, page turn). Off by default. */
  sound: boolean;
  /** Sound effects volume 0–1. */
  soundVolume: number;
  /** Reading typeface. */
  readingFont: 'literata' | 'atkinson' | 'opendyslexic';
  /** Line spacing multiplier for the reading text (1 = design default). */
  lineSpacing: number;
  /** Extra letter spacing in em (0 = design default). */
  letterSpacing: number;
  /** Justified reading text. */
  justify: boolean;
  /** In-app override: stronger borders/outlines, no tinted-only highlights (also follows prefers-contrast). */
  highContrast: boolean;
  /** In-app override of prefers-reduced-motion: 'system' follows the OS. */
  motion: 'system' | 'reduce' | 'full';
  /** Swipe left/right on the text to change chapter (touch). */
  swipeChapters: boolean;
  /** Red-letter words of Jesus. */
  redLetter: boolean;
  /** Text-to-speech voice rate for Listen mode (0.75–1.5). */
  listenRate: number;
}

export const DEFAULT_SETTINGS: Settings = {
  hoverCards: true,
  markRelated: true,
  ilTranslit: true,
  ilGloss: false,
  layout: 'auto',
  headings: true,
  morphCodes: true,
  haptics: true,
  sound: false,
  soundVolume: 0.6,
  readingFont: 'literata',
  lineSpacing: 1,
  letterSpacing: 0,
  justify: false,
  highContrast: false,
  motion: 'system',
  swipeChapters: true,
  redLetter: true,
  listenRate: 1,
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
/** The six reading-text sizes offered in the UI (docs/EXPERIENCE.md §4: up to 200%). */
export const FONT_SCALES = [0.9, 1, 1.15, 1.3, 1.6, 2] as const;
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 2;
function loadFontScale(): number {
  const n = Number(readString('fontScale'));
  return n >= FONT_SCALE_MIN && n <= FONT_SCALE_MAX ? n : 1;
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
export const route = signal<Route>({ name: 'read', tr: 'KJV', ref: { book: 'GEN', chapter: 1 } });
/** The chapter being read (also shown under #/search and kept while on #/about). */
export const passage = signal<Passage>({ tr: 'KJV', ref: { book: 'GEN', chapter: 1 } });

export const theme = signal<Theme>(loadTheme());
export const readingMode = signal<ReadingMode>(loadMode());
/** Reading-text size multiplier (FONT_SCALE_MIN–MAX, 0.8–2; the UI steps through FONT_SCALES). */
export const fontScale = signal<number>(loadFontScale());
export const settings = signal<Settings>(loadSettings());

/** Listen mode: the verse currently being read aloud (the reader highlights and scrolls to it), or null. */
export const listeningVerse = signal<number | null>(null);

/**
 * The verse whose action sheet is open (cross references, highlight, note, compare, listen…), or null.
 * `key` is the reader's chapter key "TR/BOOK/CHAPTER" (same as WordRef.key). Use openVerseSheet().
 */
export const verseSheet = signal<{ key: string; verse: number } | null>(null);

/**
 * Header / toolbar panels: the book picker, the translation picker and the "Aa" display panel.
 * Only one is open at a time; open with openPanel(id, triggerElement) so focus returns to it.
 */
export type PanelId = 'books' | 'translations' | 'display';
export const panel = signal<PanelId | null>(null);
/** The element that opened the current panel (desktop popovers anchor to it; focus returns to it). */
export const panelAnchor: { current: HTMLElement | null } = { current: null };

/**
 * Phones / phone landscape: the compact top bar (and in landscape the toolbar) hide while reading
 * down the page and come back on scroll up. Mirrored to <html data-chrome="hidden">.
 */
export const chromeHidden = signal(false);

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

/** Switch translation, keeping the chapter — and the place in it: the verse on screen stays there. */
export function setTranslation(tr: string): void {
  const { tr: from, ref } = passage.value;
  const place = tr !== from ? (readerHooks.capture?.() ?? null) : null;
  navigate({ book: ref.book, chapter: ref.chapter }, tr);
  // The new history entry starts at the same verse (its top just below the header if the reader was
  // part-way through it), restored by the reader once the other translation has rendered.
  if (place && place.verse > 0) savePlace({ key: `${tr}/${ref.book}/${ref.chapter}`, verse: place.verse, offset: Math.max(12, place.offset) });
}

type HistMarks = Record<string, unknown> & { rwSheet?: string; rwXref?: string; rwPos?: unknown };

export function goToHash(hash: string, replace = false): void {
  if (typeof window === 'undefined') return;
  if (!replace && window.location.hash === hash) return;
  // The entry being left remembers the reading position (Back returns to it; see place.ts).
  flushPlace();
  const st = (window.history.state ?? null) as HistMarks | null;
  if (replace) {
    window.history.replaceState(window.history.state, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (st?.rwSheet) {
    // A sheet's Back marker (shell/sheet.ts useBackClose) is the current entry: take its place
    // instead of pushing past it, or Back would land on a dead copy of the page underneath.
    const { rwSheet: _sheet, rwXref: _xref, rwPos: _pos, ...rest } = st;
    window.history.replaceState(rest, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
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
  const next = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(n * 100) / 100));
  if (next === fontScale.peek()) return;
  beforeReflow(); // the reader keeps the first visible words where they are
  fontScale.value = next;
}

/** Step the reading-text size through FONT_SCALES (+1 bigger, -1 smaller). */
export function stepFontScale(dir: 1 | -1): void {
  const cur = fontScale.value;
  const list = [...FONT_SCALES];
  let i = list.findIndex((x) => Math.abs(x - cur) < 0.001);
  if (i < 0) i = list.reduce((best, x, j) => (Math.abs(x - cur) < Math.abs(list[best] - cur) ? j : best), 0);
  setFontScale(list[Math.min(list.length - 1, Math.max(0, i + dir))]);
}

/** Open a header / toolbar panel (closes search and the word card). `from` gets focus back on close. */
export function openPanel(id: PanelId, from?: HTMLElement | null): void {
  panelAnchor.current = from ?? (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  batch(() => {
    searchOpen.value = false;
    pinnedWord.value = null;
    activeWord.value = null;
    verseSheet.value = null;
    panel.value = id;
  });
}

/**
 * Keyboard focus to move once a navigation has landed (chapter rendered): the target verse's number,
 * or the chapter title. Set by the passage and translation pickers (focusOnArrival); consumed by the
 * reader. While it is pending, closing a panel does not send focus back to the panel's trigger.
 */
export const arrival = signal<{ key: string; verse?: number; at: number } | null>(null);

/** Move keyboard focus to `ref` (its verse number, else the chapter title) once it is on screen. */
export function focusOnArrival(tr: string, ref: VerseRef): void {
  arrival.value = { key: `${tr}/${ref.book}/${ref.chapter}`, verse: ref.verse, at: Date.now() };
}

/** Close the open panel; keyboard focus returns to the button that opened it (unless it moved on). */
export function closePanel(): void {
  if (!panel.peek()) return;
  panel.value = null;
  const anchor = panelAnchor.current;
  if (!anchor || typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    if (panel.peek() || arrival.peek()) return;
    const a = document.activeElement;
    const lost = !a || a === document.body || !a.isConnected || Boolean(a.closest('.pop'));
    if (lost && anchor.isConnected && anchor.getClientRects().length) anchor.focus({ preventScroll: true });
  });
}

export function togglePanel(id: PanelId, from?: HTMLElement | null): void {
  if (panel.value === id) closePanel();
  else openPanel(id, from);
}

/** Open the verse action sheet for a verse of the chapter on screen (key = "TR/BOOK/CHAPTER"). */
export function openVerseSheet(key: string, verse: number): void {
  batch(() => {
    pinnedWord.value = null;
    activeWord.value = null;
    panel.value = null;
    verseSheet.value = { key, verse };
  });
}

export function closeVerseSheet(): void {
  verseSheet.value = null;
}

/** Settings that reflow the reading text (the reader keeps its place across them). */
const REFLOW_KEYS: readonly (keyof Settings)[] = ['layout', 'headings', 'readingFont', 'lineSpacing', 'letterSpacing', 'justify', 'ilTranslit', 'ilGloss'];

export function updateSettings(patch: Partial<Settings>): void {
  const cur = settings.peek();
  if (REFLOW_KEYS.some((k) => k in patch && patch[k] !== cur[k])) beforeReflow();
  settings.value = { ...cur, ...patch };
}

/** True when motion should collapse to fades (Settings → Motion, else the OS preference). */
export function reducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.motion === 'reduce';
}

/** Scroll behaviour to use for programmatic scrolling (jumps instead of glides under reduced motion). */
export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? 'auto' : 'smooth';
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
  applyReadingSettings(root);
  effect(() => {
    root.dataset.chrome = chromeHidden.value ? 'hidden' : 'shown';
  });
}

/** Media queries the html data attributes follow (with the in-app overrides). */
function mq(query: string): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(query) : null;
}

/**
 * Mirror the reading / accessibility settings onto <html> (docs/EXPERIENCE.md §4–5):
 *   data-motion="reduce|full"     settings.motion, else prefers-reduced-motion
 *   data-contrast="more|normal"   settings.highContrast, or prefers-contrast: more
 *   data-font="literata|atkinson|opendyslexic"   (fonts other than Literata load on demand)
 *   data-justify="on|off" · data-red-letter="on|off"
 *   --line-spacing (multiplier) · --letter-spacing (em)
 */
function applyReadingSettings(root: HTMLElement): void {
  const reduce = mq('(prefers-reduced-motion: reduce)');
  const contrast = mq('(prefers-contrast: more)');
  const os = signal({ reduce: Boolean(reduce?.matches), contrast: Boolean(contrast?.matches) });
  const sync = () => (os.value = { reduce: Boolean(reduce?.matches), contrast: Boolean(contrast?.matches) });
  reduce?.addEventListener?.('change', sync);
  contrast?.addEventListener?.('change', sync);
  effect(() => {
    const s = settings.value;
    const o = os.value;
    const motion = s.motion === 'system' ? (o.reduce ? 'reduce' : 'full') : s.motion;
    root.dataset.motion = motion;
    root.dataset.contrast = s.highContrast || o.contrast ? 'more' : 'normal';
    root.dataset.font = s.readingFont;
    root.dataset.justify = s.justify ? 'on' : 'off';
    root.dataset.redLetter = s.redLetter ? 'on' : 'off';
    const ls = Number.isFinite(s.lineSpacing) ? Math.min(2, Math.max(0.8, s.lineSpacing)) : 1;
    const lt = Number.isFinite(s.letterSpacing) ? Math.min(0.2, Math.max(-0.05, s.letterSpacing)) : 0;
    root.style.setProperty('--line-spacing', String(ls));
    root.style.setProperty('--letter-spacing', `${lt}em`);
    if (s.readingFont !== 'literata') void loadReadingFont(s.readingFont);
  });
}

const fontLoads: Partial<Record<Settings['readingFont'], Promise<unknown>>> = {};
/** Load a reading font's CSS (fontsource) the first time it is chosen. */
export function loadReadingFont(font: Settings['readingFont']): Promise<unknown> {
  if (font === 'literata') return Promise.resolve();
  fontLoads[font] ??=
    font === 'atkinson'
      ? Promise.all([
          import('@fontsource-variable/atkinson-hyperlegible-next/wght.css'),
          import('@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css'),
        ]).catch(() => undefined)
      : Promise.all([
          import('@fontsource/opendyslexic/400.css'),
          import('@fontsource/opendyslexic/400-italic.css'),
          import('@fontsource/opendyslexic/700.css'),
        ]).catch(() => undefined);
  return fontLoads[font]!;
}
