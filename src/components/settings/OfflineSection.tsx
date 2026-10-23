/**
 * Settings → Offline (rendered inside SettingsSheet's <section id="st-offline">, under its <h3>):
 *
 *  - whether Rootword works offline here (service worker state) and whether you are online;
 *  - Install: the browser's install prompt when it offers one (Chromium), otherwise how to add
 *    Rootword to the home screen (iOS: Share → Add to Home Screen);
 *  - "Download a book for offline reading": every chapter's text (this translation or all bundled
 *    ones), original words, cross references and names — optionally the word dictionary — into the
 *    runtime cache, with a progress bar and Cancel (src/pwa.ts does the work);
 *  - the books saved on this device (Remove), storage used (navigator.storage.estimate) and
 *    "Clear offline data" behind a confirmation.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { meta, passage } from '../../app/state';
import { BOOKS, getBook } from '../../lib/books';
import type { BookId } from '../../lib/types';
import { CACHE, estimateBookBytes, formatBytes, LEXICON_BYTES } from '../../lib/offline';
import {
  cancelDownload,
  clearOfflineData,
  download,
  installed,
  installPrompt,
  lexiconSaved,
  online,
  promptInstall,
  refreshStorage,
  removeSaved,
  savedBooks,
  startDownload,
  storageInfo,
  swStatus,
} from '../../pwa';
import { Segmented, SwitchRow } from './controls';
import './offline.css';

/* Icons on the shared 24 px / 1.6 stroke grid (decorative). */
const Svg = ({ children }: { children: ComponentChildren }) => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);
const IconCheck = () => (
  <Svg>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </Svg>
);
const IconDownload = () => (
  <Svg>
    <path d="M12 4.5v10.5M7.5 10.5l4.5 4.5 4.5-4.5" />
    <path d="M5 19.5h14" />
  </Svg>
);
const IconInfo = () => (
  <Svg>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);
const IconInstall = () => (
  <Svg>
    <rect x="6.5" y="3.5" width="11" height="17" rx="2" />
    <path d="M12 7.5v6M9.5 11l2.5 2.5 2.5-2.5M10.5 17.5h3" />
  </Svg>
);

/** "1 chapter", "4 chapters" */
const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;

const isIos = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

function StatusLine() {
  const st = swStatus.value;
  const off = !online.value;
  let text: ComponentChildren;
  if (st === 'ready') text = 'Rootword works offline on this device. Every chapter you open is kept, so it opens again without a connection.';
  else if (st === 'starting') text = 'Getting Rootword ready to work offline…';
  else if (st === 'unsupported') text = 'This browser can’t keep Rootword for offline use, so reading needs a connection.';
  else text = 'Offline use couldn’t be set up in this browser (private browsing can block it). Reading still works online.';
  return (
    <div class={`st-off-status${st === 'ready' ? ' is-ready' : ''}`}>
      {st === 'ready' ? <IconCheck /> : <IconInfo />}
      <p>
        {text}
        {off && <strong class="st-off-status__now"> You’re offline right now.</strong>}
      </p>
    </div>
  );
}

function InstallBlock() {
  const [busy, setBusy] = useState(false);
  if (installed.value) {
    return (
      <p class="st-ok st-off-installed">
        <IconCheck /> Installed — Rootword opens in its own window.
      </p>
    );
  }
  const prompt = installPrompt.value;
  return (
    <div class="st-off-install">
      <p class="st-field__lbl">Install</p>
      {prompt ? (
        <div class="st-off-row">
          <button
            type="button"
            class="st-btn st-btn--quiet"
            disabled={busy}
            aria-describedby="st-off-install-hint"
            onClick={async () => {
              setBusy(true);
              await promptInstall();
              setBusy(false);
            }}
          >
            <IconInstall /> Install Rootword
          </button>
          <p class="st-field__hint" id="st-off-install-hint">
            Adds Rootword to your home screen or app list. It opens in its own window and starts without a connection.
          </p>
        </div>
      ) : (
        <p class="st-field__hint st-off-hint">
          {isIos()
            ? 'On iPhone or iPad: tap Share, then “Add to Home Screen”. Rootword then opens like an app and starts without a connection.'
            : 'Use your browser’s menu — “Install app” or “Add to Home Screen” — to keep Rootword as an app that starts without a connection.'}
        </p>
      )}
    </div>
  );
}

function Progress() {
  const d = download.value;
  if (!d) return null;
  const name = d.book ? (getBook(d.book)?.name ?? d.book) : 'Word definitions';
  const p = d.progress;
  const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
  if (d.status === 'running') {
    return (
      <div class="st-progress" aria-busy="true">
        <div class="st-progress__head">
          <span>{d.quiet ? `Updating ${name} for offline reading…` : `Saving ${name}…`}</span>
          <span class="tnum">
            {p.done.toLocaleString('en')} of {p.total.toLocaleString('en')} files
          </span>
        </div>
        <div class="st-progress__track" role="progressbar" aria-label={`Saving ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}%, ${p.done} of ${p.total} files`}>
          <span style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <button type="button" class="st-btn st-btn--quiet st-btn--sm" onClick={cancelDownload}>
          Cancel
        </button>
      </div>
    );
  }
  if (d.quiet && d.status === 'done') return null;
  if (d.status === 'done') {
    const book = p.bookBytes ?? p.bytes;
    const lex = p.bytes - book;
    return (
      <p class="st-ok st-off-done" role="status">
        <IconCheck />
        <span>
          {d.book ? `${name} is saved for offline reading` : 'Word definitions are saved'}
          {d.book && book ? ` (${formatBytes(book)})` : ''}
          {d.book && d.lexicon ? `, with word definitions${lex ? ` (${formatBytes(lex)})` : ''}` : ''}.
        </span>
      </p>
    );
  }
  if (d.status === 'cancelled') {
    return (
      <p class="st-fine st-off-done" role="status">
        Download cancelled. The {p.done ? `${p.done.toLocaleString('en')} files` : 'files'} already saved stay available.
      </p>
    );
  }
  return (
    <div class="st-error" role="alert">
      <IconInfo />
      <span>
        {p.failed && p.total ? `${p.failed.toLocaleString('en')} of ${p.total.toLocaleString('en')} files couldn’t be saved.` : 'The download failed.'} Check your connection and try again.
      </span>
    </div>
  );
}

function DownloadBlock() {
  const m = meta.value;
  const bundled = m?.translations ?? [];
  const cur = passage.value;
  const curTr = bundled.some((t) => t.id === cur.tr) ? cur.tr : bundled[0]?.id ?? 'KJV';
  const [book, setBook] = useState<BookId>(cur.ref.book);
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const [withLex, setWithLex] = useState(true);
  const info = getBook(book) ?? BOOKS[0];
  const trs = scope === 'all' && bundled.length ? bundled.map((t) => t.id) : [curTr];
  const running = download.value?.status === 'running';
  const lex = withLex && !lexiconSaved.value;
  const est = estimateBookBytes(info.chapters, trs.length);
  const off = !online.value;
  const remote = cur.tr !== curTr;

  return (
    <div class="st-off-dl">
      <p class="st-field__lbl" id="st-off-dl-lbl">
        Download a book for offline reading
      </p>
      <div class="st-off-grid" role="group" aria-labelledby="st-off-dl-lbl">
        <div class="st-off-book">
          <label class="st-off-book__lbl" for="st-off-book">
            Book
          </label>
          <select id="st-off-book" class="st-select" value={info.id} onChange={(e) => setBook((e.currentTarget as HTMLSelectElement).value)}>
            <optgroup label="Old Testament">
              {BOOKS.filter((b) => b.testament === 'OT').map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="New Testament">
              {BOOKS.filter((b) => b.testament === 'NT').map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <Segmented
          name="st-off-trs"
          legend="Translations"
          class="st-off-trs"
          options={[
            { value: 'one', label: `${curTr} only` },
            { value: 'all', label: `All ${bundled.length || 5}` },
          ]}
          value={scope}
          onChange={setScope}
        />
      </div>
      {remote && <p class="st-field__hint st-off-hint">{cur.tr} comes from API.Bible and needs a connection; books are saved in the bundled translations.</p>}
      <div class="st-rows st-off-lex">
        <SwitchRow
          id="st-off-lex"
          label="Word definitions too"
          hint={lexiconSaved.value ? 'Already saved — the Greek & Hebrew dictionary for word cards, shared by every book.' : `The Greek & Hebrew dictionary for word cards, about ${formatBytes(LEXICON_BYTES)}, saved once for every book.`}
          checked={withLex || lexiconSaved.value}
          disabled={lexiconSaved.value}
          onChange={setWithLex}
        />
      </div>
      <div class="st-off-row">
        <button
          type="button"
          class="st-btn st-btn--primary"
          disabled={running || off}
          aria-describedby="st-off-est"
          onClick={() => void startDownload(info.id, trs, lex)}
        >
          <IconDownload /> Download {info.name}
        </button>
        <p class="st-field__hint st-off-est" id="st-off-est">
          {off
            ? 'Connect to the internet to download.'
            : `${plural(info.chapters, 'chapter')} · ${trs.length === 1 ? trs[0] : `${trs.length} translations`} · about ${formatBytes(est)}${lex ? ` + ${formatBytes(LEXICON_BYTES)} of word definitions` : ''}`}
        </p>
      </div>
      <Progress />
    </div>
  );
}

function SavedList() {
  const list = savedBooks.value;
  if (!list.length && !lexiconSaved.value) return null;
  const sorted = [...list].sort((a, b) => (getBook(a.book)?.num ?? 0) - (getBook(b.book)?.num ?? 0));
  return (
    <div class="st-off-saved">
      <p class="st-field__lbl" id="st-off-saved-lbl">
        Saved on this device
      </p>
      <ul class="st-saved" aria-labelledby="st-off-saved-lbl">
        {sorted.map((s) => {
          const b = getBook(s.book);
          const name = b?.name ?? s.book;
          return (
            <li key={s.book} class="st-saved__row">
              <span class="st-saved__name">
                {name}
                <small>
                  {s.trs.join(', ')} · {plural(s.chapters, 'chapter')}
                  {s.bytes ? ` · ${formatBytes(s.bytes)}` : ''}
                </small>
              </span>
              <button type="button" class="st-btn st-btn--quiet st-btn--sm" aria-label={`Remove ${name}`} onClick={() => void removeSaved(s.book)}>
                Remove
              </button>
            </li>
          );
        })}
        {lexiconSaved.value && (
          <li class="st-saved__row">
            <span class="st-saved__name">
              Word definitions
              <small>Greek & Hebrew dictionary · every book</small>
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

function StorageBlock() {
  const info = storageInfo.value;
  const [confirm, setConfirm] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) keepRef.current?.focus();
  }, [confirm]);
  const chapters = info?.files[CACHE.chapters] ?? 0;
  const study = info?.files[CACHE.study] ?? 0;
  const search = info?.files[CACHE.search] ?? 0;
  const cached = chapters + study + search;
  const share = info?.usage !== undefined && info.quota ? Math.min(1, info.usage / info.quota) : 0;
  return (
    <div class="st-off-storage">
      <p class="st-field__lbl">Storage</p>
      {info?.usage !== undefined ? (
        <>
          <p class="st-off-usage">
            Using <strong class="tnum">{formatBytes(info.usage)}</strong>
            {info.quota ? (
              <>
                {' '}
                of about <span class="tnum">{formatBytes(info.quota)}</span> this browser allows
              </>
            ) : null}
            .
          </p>
          <div class="st-meter" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.max(share, info.usage ? 0.01 : 0)})` }} />
          </div>
        </>
      ) : (
        <p class="st-off-usage">{info ? 'This browser doesn’t report how much storage Rootword uses.' : 'Checking storage…'}</p>
      )}
      <p class="st-field__hint">
        {cached
          ? `${[chapters ? plural(chapters, 'chapter file') : '', study ? plural(study, 'dictionary file') : '', search ? plural(search, 'search file') : ''].filter(Boolean).join(', ')} kept for offline use.`
          : 'No chapters kept for offline use yet.'}
        {info?.persisted === true ? ' Protected from automatic clean-up.' : info?.persisted === false && cached ? ' The browser may clear them if space runs low.' : ''}
      </p>
      <div class="st-actions">
        {!confirm ? (
          <button type="button" class="st-btn st-btn--quiet st-btn--danger" ref={clearRef} onClick={() => setConfirm(true)}>
            Clear offline data
          </button>
        ) : (
          <div class="st-confirm" role="group" aria-labelledby="st-off-confirm">
            <span id="st-off-confirm">Remove the saved books and every chapter kept for offline use? Rootword itself stays available offline.</span>
            <button
              type="button"
              class="st-btn st-btn--danger-solid"
              onClick={async () => {
                setConfirm(false);
                await clearOfflineData();
                clearRef.current?.focus();
              }}
            >
              Clear offline data
            </button>
            <button
              type="button"
              class="st-btn st-btn--quiet"
              ref={keepRef}
              onClick={() => {
                setConfirm(false);
                requestAnimationFrame(() => clearRef.current?.focus());
              }}
            >
              Keep
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function OfflineSection() {
  useEffect(() => {
    void refreshStorage();
  }, []);
  // keep the storage figures current after a download finishes
  const status = download.value?.status;
  useEffect(() => {
    if (status && status !== 'running') void refreshStorage();
  }, [status]);
  return (
    <div class="st-off">
      <StatusLine />
      <InstallBlock />
      <DownloadBlock />
      <SavedList />
      <StorageBlock />
    </div>
  );
}
