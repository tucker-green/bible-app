/// <reference types="vite-plugin-pwa/vanillajs" />
/**
 * Installable & offline Rootword (docs/EXPERIENCE.md §6). main.tsx calls initPwa() once.
 *
 *  - Registers the service worker built by vite-plugin-pwa (vite.config.ts): app shell precached,
 *    data chapters / lexicon chunks / fonts cached as they are used (cache names: src/lib/offline.ts).
 *  - Update flow: a waiting new version shows "A new version is ready — Refresh"; Refresh activates
 *    it and reloads. "Later" hides the card until the next visit.
 *  - Offline banner while the browser is offline ("Chapters you've read or saved still open").
 *  - Install: captures `beforeinstallprompt` so Settings → Offline can offer "Install Rootword".
 *  - Downloads: Settings → Offline saves whole books (every chapter's text, original words, cross
 *    references and names) into the runtime cache, with progress and cancel; saved books are listed
 *    in localStorage "rootword:offline" and downloaded again automatically when the data set changes.
 *
 * Importing this module has no side effects (tests import it); everything starts in initPwa().
 * The status UI (update card, offline banner) renders into its own <div id="pwa-ui"> at the end of
 * <body>, inside an <aside> landmark, positioned above the bottom dock / toasts / open sheet.
 */
import { h, render } from 'preact';
import type { ComponentChild, ComponentChildren, VNode } from 'preact';
import { computed, signal } from '@preact/signals';
import { announce, showToast, toastMessage } from './app/state';
import { readJson, readString, writeJson, writeString } from './app/storage';
import { getBook } from './lib/books';
import type { BookId } from './lib/types';
import { dataUrl, loadLexIndex, loadMeta } from './lib/data';
import { feedback } from './lib/feedback';
import {
  bookFiles,
  clearCaches,
  countCached,
  dataStamp,
  DATA_CACHES,
  DownloadAborted,
  downloadFiles,
  filesToRemove,
  lexiconFiles,
  removeFiles,
  upsertSaved,
} from './lib/offline';
import type { DownloadProgress, SavedBook } from './lib/offline';
import './pwa.css';

/* ------------------------------------------------------------------------ */
/* State                                                                     */
/* ------------------------------------------------------------------------ */

/** The `beforeinstallprompt` event (Chromium); not in the DOM typings. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type SwStatus = 'unsupported' | 'starting' | 'ready' | 'error';

/** Service worker state: 'ready' once the app shell is cached (works offline). */
export const swStatus = signal<SwStatus>('starting');
/** A new version is installed and waiting (show the Refresh card). */
export const updateReady = signal(false);
/** The user chose "Later" on the update card. */
export const updateDismissed = signal(false);
/** navigator.onLine, kept live. */
export const online = signal(true);
/** The user closed the offline banner (shown again on the next offline transition). */
export const offlineDismissed = signal(false);
/** A deferred install prompt (Chromium); null when not installable from here or already installed. */
export const installPrompt = signal<InstallPromptEvent | null>(null);
/** Running as an installed app (display-mode standalone, or iOS home-screen). */
export const installed = signal(false);
/** Books saved for offline reading (localStorage "rootword:offline"). */
export const savedBooks = signal<SavedBook[]>([]);
/** The word dictionary (every lexicon chunk) is saved. */
export const lexiconSaved = signal(false);

export interface StorageInfo {
  /** Bytes used by this site (navigator.storage.estimate), when the browser tells. */
  usage?: number;
  quota?: number;
  /** Entries per runtime cache. */
  files: Record<string, number>;
  /** navigator.storage.persisted(). */
  persisted?: boolean;
}
export const storageInfo = signal<StorageInfo | null>(null);

export interface DownloadState {
  book: BookId;
  trs: string[];
  lexicon: boolean;
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: DownloadProgress;
  /** Background refresh after a data update (no toast). */
  quiet?: boolean;
}
/** The current (or last) book download, for Settings → Offline. */
export const download = signal<DownloadState | null>(null);
export const downloading = computed(() => download.value?.status === 'running');

const SAVED_KEY = 'offline';
const LEXICON_KEY = 'offlineLexicon';
const STAMP_KEY = 'dataStamp';

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let controller: AbortController | null = null;
let chain: Promise<unknown> = Promise.resolve();
let started = false;

const hasCaches = () => typeof caches !== 'undefined';

/* ------------------------------------------------------------------------ */
/* Start-up                                                                  */
/* ------------------------------------------------------------------------ */

/** Wire everything up (main.tsx). Safe to call more than once. */
export function initPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  savedBooks.value = readJson<SavedBook[]>(SAVED_KEY, []).filter((s) => s && typeof s.book === 'string' && Array.isArray(s.trs));
  lexiconSaved.value = readString(LEXICON_KEY) === '1';
  online.value = navigator.onLine !== false;
  installed.value = isStandalone();

  window.addEventListener('online', () => {
    online.value = true;
    offlineDismissed.value = false;
    showToast('Back online');
  });
  window.addEventListener('offline', () => {
    online.value = false;
    offlineDismissed.value = false;
    announce('You are offline. Chapters you have read or saved still open.');
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt.value = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt.value = null;
    installed.value = true;
    showToast('Rootword is installed');
  });

  mountUi();

  if (!('serviceWorker' in navigator)) {
    swStatus.value = 'unsupported';
  } else {
    void registerServiceWorker();
  }
  loadMeta().then(
    (m) => void syncDataStamp(dataStamp(m)),
    () => undefined,
  );
}

function isStandalone(): boolean {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    /* old browsers */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function registerServiceWorker(): Promise<void> {
  try {
    const { registerSW } = await import('virtual:pwa-register');
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateReady.value = true;
        updateDismissed.value = false;
        announce('A new version of Rootword is ready. Refresh to update.');
      },
      onOfflineReady() {
        swStatus.value = 'ready';
        showToast('Rootword now works offline');
      },
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        if (reg.active) swStatus.value = 'ready';
        else void navigator.serviceWorker.ready.then(() => (swStatus.value = 'ready'));
        // Long-lived (installed) sessions: look for a new version hourly and when coming back.
        const check = () => {
          if (navigator.onLine !== false) void reg.update().catch(() => undefined);
        };
        setInterval(check, 60 * 60 * 1000);
        let last = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && Date.now() - last > 10 * 60 * 1000) {
            last = Date.now();
            check();
          }
        });
      },
      onRegisterError() {
        swStatus.value = 'error';
      },
    });
  } catch {
    swStatus.value = 'error';
  }
}

/** Activate the waiting version and reload (the update card's Refresh). */
export async function applyUpdate(): Promise<void> {
  feedback('select');
  if (updateSW) await updateSW(true);
  else location.reload();
}

/** Show the browser's install dialog (Chromium). Returns true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = installPrompt.value;
  if (!e) return false;
  installPrompt.value = null;
  await e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  return choice.outcome === 'accepted';
}

/* ------------------------------------------------------------------------ */
/* Data set changes                                                          */
/* ------------------------------------------------------------------------ */

/**
 * When meta.json reports a different data set than the one cached (a rebuild with new content),
 * empty the data caches so chapters are fetched fresh, and download the saved books again.
 * Returns true when the caches were cleared.
 */
export async function syncDataStamp(stamp: string): Promise<boolean> {
  const prev = readString(STAMP_KEY);
  if (prev === stamp) return false;
  if (!prev || !hasCaches()) {
    writeString(STAMP_KEY, stamp);
    return false;
  }
  // Offline (meta.json came from the network just before the connection dropped): keep what is
  // cached and try again on the next start.
  if (navigator.onLine === false) return false;
  writeString(STAMP_KEY, stamp);
  await clearCaches(DATA_CACHES);
  const books = savedBooks.peek();
  const lexicon = lexiconSaved.peek();
  books.forEach((rec, i) => void queueDownload(rec.book, rec.trs, lexicon && i === 0, true));
  if (!books.length && lexicon) void queueDownload(null, [], true, true);
  return true;
}

/* ------------------------------------------------------------------------ */
/* Downloads                                                                 */
/* ------------------------------------------------------------------------ */

/** Save a book for offline reading (and, optionally, the word dictionary). Queued after a running one. */
export function startDownload(book: BookId, trs: readonly string[], lexicon: boolean): Promise<void> {
  return queueDownload(book, [...trs], lexicon, false);
}

/** Stop the running download (files already saved stay saved). */
export function cancelDownload(): void {
  controller?.abort();
}

function queueDownload(book: BookId | null, trs: string[], lexicon: boolean, quiet: boolean): Promise<void> {
  const run = chain.then(() => runDownload(book, trs, lexicon, quiet));
  chain = run.catch(() => undefined);
  return run;
}

async function runDownload(book: BookId | null, trs: string[], lexicon: boolean, quiet: boolean): Promise<void> {
  const info = book ? getBook(book) : undefined;
  const paths = info ? bookFiles(info.id, info.chapters, trs) : [];
  const state: DownloadState = {
    book: info?.id ?? '',
    trs,
    lexicon,
    status: 'running',
    quiet,
    progress: { done: 0, total: paths.length, failed: 0, bytes: 0 },
  };
  download.value = state;
  if (!hasCaches()) {
    download.value = { ...state, status: 'error', progress: { ...state.progress, failed: Math.max(1, paths.length) } };
    return;
  }
  void navigator.storage?.persist?.().catch(() => false);
  controller = new AbortController();
  const signal = controller.signal;
  try {
    // the book first, then the (shared) dictionary, so each one's size is known
    const lexPaths = lexicon ? lexiconFiles(await loadLexIndex()) : [];
    const total = paths.length + lexPaths.length;
    const report = (p: DownloadProgress) => {
      if (download.peek()?.status === 'running') download.value = { ...state, progress: p };
    };
    const bookResult = await downloadFiles(paths, { url: dataUrl, signal, onProgress: (p) => report({ ...p, total }) });
    const lexResult = await downloadFiles(lexPaths, {
      url: dataUrl,
      signal,
      onProgress: (p) => report({ done: bookResult.done + p.done, total, failed: bookResult.failed + p.failed, bytes: bookResult.bytes + p.bytes }),
    });
    const result: DownloadProgress = {
      done: bookResult.done + lexResult.done,
      total,
      failed: bookResult.failed + lexResult.failed,
      bytes: bookResult.bytes + lexResult.bytes,
      bookBytes: bookResult.bytes,
    };
    const ok = result.failed === 0;
    download.value = { ...state, status: ok ? 'done' : 'error', progress: result };
    if (ok && info) {
      savedBooks.value = upsertSaved(savedBooks.peek(), { book: info.id, trs, chapters: info.chapters, bytes: bookResult.bytes, at: new Date().toISOString() });
      writeJson(SAVED_KEY, savedBooks.value);
    }
    if (ok && lexicon) {
      lexiconSaved.value = true;
      writeString(LEXICON_KEY, '1');
    }
    if (!quiet) {
      if (ok) {
        feedback('success');
        announce(info ? `${info.name} is saved for offline reading.` : 'Word definitions are saved for offline use.');
      } else {
        feedback('error');
        announce(`${result.failed} files could not be saved. Check your connection and try again.`);
      }
    }
  } catch (err) {
    const cancelled = err instanceof DownloadAborted || signal.aborted;
    const cur = download.peek();
    download.value = { ...state, status: cancelled ? 'cancelled' : 'error', progress: cur?.progress ?? state.progress };
    if (!quiet) announce(cancelled ? 'Download cancelled.' : 'The download failed. Check your connection and try again.');
  } finally {
    controller = null;
    void refreshStorage();
  }
}

/** Forget a saved book and delete the files only it needed. */
export async function removeSaved(book: BookId): Promise<void> {
  const list = savedBooks.peek();
  const rec = list.find((s) => s.book === book);
  if (!rec) return;
  const others = list.filter((s) => s !== rec);
  if (hasCaches()) await removeFiles(filesToRemove(rec, others), { url: dataUrl });
  savedBooks.value = others;
  writeJson(SAVED_KEY, others);
  if (download.peek()?.book === book && download.peek()?.status !== 'running') download.value = null;
  void refreshStorage();
}

/** Empty every data cache (chapters, lexicon, search) and forget the saved books. The app shell stays. */
export async function clearOfflineData(): Promise<void> {
  cancelDownload();
  if (hasCaches()) await clearCaches(DATA_CACHES);
  savedBooks.value = [];
  lexiconSaved.value = false;
  writeJson(SAVED_KEY, []);
  writeString(LEXICON_KEY, null);
  download.value = null;
  await refreshStorage();
  feedback('success');
  showToast('Offline data cleared');
}

/** Update storageInfo from navigator.storage and the runtime caches. */
export async function refreshStorage(): Promise<StorageInfo> {
  const info: StorageInfo = { files: {} };
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      info.usage = est.usage;
      info.quota = est.quota;
    }
    info.persisted = await navigator.storage?.persisted?.();
  } catch {
    /* not available (insecure context, old browser) */
  }
  try {
    if (hasCaches()) info.files = await countCached();
  } catch {
    /* Cache Storage blocked */
  }
  storageInfo.value = info;
  return info;
}

/* ------------------------------------------------------------------------ */
/* Status UI: update card + offline banner                                   */
/* ------------------------------------------------------------------------ */

const svg = (paths: ComponentChildren): VNode =>
  h('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, paths);

const ICONS = {
  refresh: () => svg([h('path', { d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3' }), h('path', { d: 'M19.5 4.5v4h-4' })]),
  offline: () =>
    svg([h('path', { d: 'M7.5 18.5h9.8a3.7 3.7 0 0 0 1-7.3 6 6 0 0 0-9.7-3.5M5.6 9.6a4.5 4.5 0 0 0 1.9 8.9' }), h('path', { d: 'M4 4l16 16' })]),
  close: () => svg(h('path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' })),
};

/** The update card and offline banner (exported for tests). */
export function PwaStatus(): ComponentChild {
  const showUpdate = updateReady.value && !updateDismissed.value;
  const showOffline = !online.value && !offlineDismissed.value;
  if (!showUpdate && !showOffline) return null;
  return h(
    'aside',
    { class: `pwa-stack${toastMessage.value ? ' is-raised' : ''}`, 'aria-label': 'App status' },
    showUpdate &&
      h('div', { class: 'pwa-card pwa-card--update', key: 'update' }, [
        h('span', { class: 'pwa-card__icon' }, ICONS.refresh()),
        h('p', { class: 'pwa-card__text' }, 'A new version is ready'),
        h('button', { type: 'button', class: 'pwa-btn pwa-btn--primary', onClick: () => void applyUpdate() }, 'Refresh'),
        h(
          'button',
          {
            type: 'button',
            class: 'pwa-x',
            'aria-label': 'Later',
            title: 'Later',
            onClick: () => {
              updateDismissed.value = true;
            },
          },
          ICONS.close(),
        ),
      ]),
    showOffline &&
      h('div', { class: 'pwa-card pwa-card--offline', key: 'offline' }, [
        h('span', { class: 'pwa-card__icon' }, ICONS.offline()),
        h('p', { class: 'pwa-card__text' }, [h('strong', null, 'Offline.'), ' Chapters you’ve read or saved still open.']),
        h(
          'button',
          {
            type: 'button',
            class: 'pwa-x',
            'aria-label': 'Dismiss offline notice',
            title: 'Dismiss',
            onClick: () => {
              offlineDismissed.value = true;
            },
          },
          ICONS.close(),
        ),
      ]),
  );
}

function mountUi(): void {
  let host = document.getElementById('pwa-ui');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pwa-ui';
    document.body.appendChild(host);
  }
  render(h(PwaStatus, null), host);
}
