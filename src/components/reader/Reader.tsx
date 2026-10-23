/**
 * The reading page: left rail (contents), the chapter (head, prose, chapter navigation), right rail
 * (reading key, keyboard, this edition), and the word card. The prose is rendered as one HTML
 * string (see render.ts) and wired to a single delegated controller (see interaction.ts).
 */
import { effect } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { resolveTranslation } from '../../app/router';
import {
  activeWord,
  closeWord,
  meta,
  metaError,
  navigate,
  passage,
  pinnedWord,
  readingMode,
  settings,
  showToast,
  translations,
  updateSettings,
} from '../../app/state';
import { getBook } from '../../lib/books';
import { loadChapter, loadText, nextChapter, prefetchChapter, prevChapter } from '../../lib/data';
import { APIBIBLE_ATTRIBUTION, apiBibleMeta, createFumsIds, reportFums } from '../../lib/providers/apibible';
import type { FumsIds } from '../../lib/providers/apibible';
import { formatChapter, refToHash } from '../../lib/reference';
import type { TranslationMeta } from '../../lib/types';
import { alignmentOf } from '../common/alignment';
import { Icon } from '../common/Icon';
import { Typeset } from '../common/Typeset';
import { ModeToggle } from '../header/Header';
import { bookEyebrow } from '../word/cardModel';
import { WordCard } from '../word/WordCard';
import { ReaderController } from './interaction';
import type { ChapterModel } from './model';
import { buildChapterModel, chapterKey } from './model';
import { chooseLayout, renderChapterHtml } from './render';
import './reader.css';

/** Timing of the last chapter render (also exposed as <html data-render-ms>). */
export interface RenderStats {
  key: string;
  mode: string;
  tokens: number;
  units: number;
  buildMs: number;
  domMs: number;
  layoutMs: number;
  totalMs: number;
}
export let lastRender: RenderStats | null = null;

let fumsIds: FumsIds | null = null;
/** API.Bible usage reporting ids (device id in localStorage, session id in sessionStorage). */
function getFumsIds(): FumsIds {
  if (!fumsIds) {
    let local: Storage | null = null;
    let session: Storage | null = null;
    try {
      local = localStorage;
      session = sessionStorage;
    } catch {
      /* storage blocked: ids live for this page only */
    }
    fumsIds = createFumsIds(local, session);
  }
  return fumsIds;
}

type LoadState =
  | { key: string; status: 'loading'; model: null }
  | { key: string; status: 'ready'; model: ChapterModel }
  | { key: string; status: 'error'; model: null; error: unknown };

function origLabel(model: ChapterModel | null, testament: 'OT' | 'NT'): string {
  if (testament === 'NT') return `Greek · ${model?.orig?.edition ?? 'SBLGNT'}`;
  const orig = model?.orig;
  const edition = orig?.edition ?? 'WLC';
  const aram = orig?.aramaic?.length ?? 0;
  if (orig && aram && aram >= orig.words.length * 0.95) return `Aramaic · ${edition}`;
  if (aram) return `Hebrew & Aramaic · ${edition}`;
  return `Hebrew · ${edition}`;
}

export function Reader() {
  const { tr, ref } = passage.value;
  const m = meta.value;
  const list = translations.value;
  const trMeta = list.find((t) => t.id === tr) ?? null;
  const mode = readingMode.value;
  const s = settings.value;
  const book = getBook(ref.book)!;
  const key = chapterKey(tr, ref.book, ref.chapter);
  const controller = useMemo(() => new ReaderController(), []);
  const [st, setSt] = useState<LoadState>({ key: '', status: 'loading', model: null });
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const proseRef = useRef<HTMLDivElement>(null);
  const resolved = m ? resolveTranslation(tr, list) : tr;
  const ready = Boolean(m) && resolved === tr;

  // Unknown / unavailable translation: fall back to the KJV (owner's decision).
  useEffect(() => {
    if (!m || resolved === tr) return;
    showToast(`The ${tr} isn’t available here — showing the ${resolved} instead.`);
    navigate(ref, resolved, { replace: true });
  }, [m, tr, resolved]);

  // New chapter: start at the top (unless a verse is targeted).
  useLayoutEffect(() => {
    if (!passage.peek().ref.verse) window.scrollTo(0, 0);
  }, [key]);

  // Load the chapter.
  useEffect(() => {
    if (!ready) return;
    let off = false;
    closeWord();
    setSt((cur) => (cur.key === key && cur.status === 'ready' ? cur : { key, status: 'loading', model: null }));
    setSlow(false);
    const t = setTimeout(() => !off && setSlow(true), 150);
    loadChapter(tr, ref.book, ref.chapter).then(
      ({ text, orig }) => {
        if (off) return;
        setSt({ key, status: 'ready', model: buildChapterModel(text, orig, { alignment: trMeta?.alignment, tr }) });
        const n = nextChapter(ref.book, ref.chapter);
        if (n) setTimeout(() => prefetchChapter(tr, n[0], n[1], { next: false }), 400);
      },
      (error: unknown) => {
        if (!off) setSt({ key, status: 'error', model: null, error });
      },
    );
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [key, attempt, ready]);

  const model = st.status === 'ready' && st.key === key ? st.model : null;
  const layout = model ? chooseLayout(model, s.layout) : 'paragraphs';

  // Render the prose once per (chapter, mode, layout, options) — never on hover.
  useLayoutEffect(() => {
    const el = proseRef.current;
    if (!el) return;
    controller.attach(el);
    closeWord();
    if (!model) {
      el.innerHTML = '';
      controller.index(null);
      return;
    }
    const t0 = performance.now();
    const html = renderChapterHtml(model, { mode, layout, headings: s.headings, ilTranslit: s.ilTranslit, ilGloss: s.ilGloss });
    const t1 = performance.now();
    el.innerHTML = html;
    controller.index(model);
    const t2 = performance.now();
    void el.offsetHeight; // force style + layout so the measurement includes it
    const t3 = performance.now();
    lastRender = {
      key: model.key,
      mode,
      tokens: model.tokenCount,
      units: model.units.length,
      buildMs: +(t1 - t0).toFixed(2),
      domMs: +(t2 - t1).toFixed(2),
      layoutMs: +(t3 - t2).toFixed(2),
      totalMs: +(t3 - t0).toFixed(2),
    };
    document.documentElement.dataset.renderMs = String(lastRender.totalMs);
    (window as unknown as { __rootwordRender?: RenderStats }).__rootwordRender = lastRender;
  }, [model, mode, layout, s.headings, s.ilTranslit, s.ilGloss]);

  useEffect(() => () => controller.detach(), []);

  // Chapters from API.Bible (e.g. the NIV): report the view (FUMS), as API.Bible's terms require.
  useEffect(() => {
    const am = model ? apiBibleMeta(model.text) : undefined;
    if (am) reportFums(am, getFumsIds());
  }, [model]);

  // Word states follow the open word (pinned wins over hover / focus).
  useEffect(
    () =>
      effect(() => {
        const p = pinnedWord.value;
        const a = activeWord.value;
        void settings.value.markRelated;
        controller.highlight(p ?? a, Boolean(p));
      }),
    [],
  );

  // Verse targeting: #/KJV/JHN/3/16 scrolls to the verse and briefly highlights it.
  useEffect(() => {
    const root = proseRef.current;
    if (!model || !root || !ref.verse) return;
    const first = root.querySelector<HTMLElement>(`#v${ref.verse}`);
    if (!first) return;
    const to = ref.verseEnd ?? ref.verse;
    const els: HTMLElement[] = [];
    for (let v = ref.verse; v <= to; v++) {
      const el = root.querySelector<HTMLElement>(`#v${v}`);
      if (el) els.push(el);
    }
    requestAnimationFrame(() => {
      first.scrollIntoView({ block: to > ref.verse! + 3 ? 'start' : 'center' });
      els.forEach((el) => {
        el.classList.remove('is-target');
        void el.offsetWidth;
        el.classList.add('is-target');
      });
    });
    const t = setTimeout(() => els.forEach((el) => el.classList.remove('is-target')), 3200);
    return () => clearTimeout(t);
  }, [model, ref.verse, ref.verseEnd, mode]);

  const testament = book.testament;
  const verseCount = m?.books.find((b) => b.id === book.id)?.verses[ref.chapter - 1] ?? model?.text.verses.length ?? 0;

  return (
    <div class={`page${mode === 'interlinear' ? ' is-interlinear' : ''}`}>
      <LeftRail model={model} tr={tr} bookId={book.id} chapter={ref.chapter} />
      <article class="text" id="text" tabIndex={-1} aria-labelledby="chapter-title">
        <header class="ch-head">
          <p class="eyebrow">{bookEyebrow(book.id)}</p>
          <h1 class={`ch-title${(book.id === 'PSA' ? 'Psalm' : book.name).length >= 12 ? ' ch-title--long' : ''}`} id="chapter-title">
            <span>{book.id === 'PSA' ? 'Psalm' : book.name}</span> <span class="num">{ref.chapter}</span>
          </h1>
          <span class="ch-rule" aria-hidden="true" />
          <p class="ch-meta">
            <b>{trMeta?.name ?? tr}</b>
            <span class="dot" aria-hidden="true" />
            <span>{origLabel(model, testament)}</span>
            <span class="dot" aria-hidden="true" />
            <span>{alignmentOf(trMeta).label}</span>
            {verseCount > 0 && (
              <>
                <span class="dot" aria-hidden="true" />
                <span class="tnum">{verseCount} verses</span>
              </>
            )}
          </p>
          <div class="ch-tools">
            <ModeToggle />
          </div>
        </header>
        {mode === 'interlinear' && <IlBar testament={testament} />}
        {trMeta?.alignment === 'bridged' && (
          <p class="approx-banner">
            <span aria-hidden="true">≈</span> Word links in the {trMeta.abbr} are matched automatically through the BSB and may be
            approximate. <a href="#/about">How links work</a>
          </p>
        )}
        <div
          ref={proseRef}
          class={`prose prose--${layout}${mode === 'interlinear' ? ' prose--il' : ''}`}
          lang="en"
          aria-busy={st.status === 'loading' ? 'true' : undefined}
        />
        {!model && st.status !== 'error' && (slow || !m) && !metaError.value && <Skeleton />}
        {(st.status === 'error' || metaError.value) && (
          <ErrorNotice
            message={metaError.value ? 'Rootword couldn’t load its Bible data.' : `${formatChapter(ref.book, ref.chapter)} didn’t load in the ${trMeta?.abbr ?? tr}.`}
            onRetry={() => (metaError.value ? location.reload() : setAttempt((n) => n + 1))}
            offerKjv={tr !== 'KJV' && !metaError.value}
          />
        )}
        <WordCard model={model} controller={controller} />
        {model && <ChapterNav tr={tr} bookId={book.id} chapter={ref.chapter} />}
        {model && <Colophon trMeta={trMeta} testament={testament} model={model} />}
      </article>
      <RightRail trMeta={trMeta} testament={testament} />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Skeleton() {
  const widths = [96, 100, 92, 98, 70, 0, 94, 99, 88, 97, 60];
  return (
    <div class="prose-skeleton" aria-hidden="true">
      {widths.map((w, i) => (w ? <span key={i} class="skeleton" style={{ width: `${w}%` }} /> : <span key={i} class="skeleton-gap" />))}
    </div>
  );
}

function ErrorNotice({ message, onRetry, offerKjv }: { message: string; onRetry: () => void; offerKjv: boolean }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <div class="notice" role="alert">
      <Icon name="alert" />
      <div>
        <p class="notice__title">{message}</p>
        <p>{offline ? 'You seem to be offline. Chapters you have opened before still work.' : 'Check your connection and try again.'}</p>
        <div class="notice__actions">
          <button type="button" class="btn-primary" onClick={onRetry}>
            <Icon name="retry" /> Try again
          </button>
          {offerKjv && (
            <button type="button" class="btn-quiet" onClick={() => navigate({ ...passage.value.ref, verse: undefined, verseEnd: undefined }, 'KJV')}>
              Read the KJV
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function IlBar({ testament }: { testament: 'OT' | 'NT' }) {
  const s = settings.value;
  return (
    <div class="il-bar" role="group" aria-label="Show beneath each word">
      <span class="lbl">Show</span>
      <label class="chk chk--fixed">
        <input type="checkbox" checked disabled />
        {testament === 'NT' ? 'Greek' : 'Hebrew'}
      </label>
      <label class="chk">
        <input type="checkbox" checked={s.ilTranslit} onChange={(e) => updateSettings({ ilTranslit: (e.target as HTMLInputElement).checked })} />
        Transliteration
      </label>
      <label class="chk">
        <input type="checkbox" checked={s.ilGloss} onChange={(e) => updateSettings({ ilGloss: (e.target as HTMLInputElement).checked })} />
        Gloss
      </label>
      <span class="note">in English word order</span>
    </div>
  );
}

function ChapterNav({ tr, bookId, chapter }: { tr: string; bookId: string; chapter: number }) {
  const prev = prevChapter(bookId, chapter);
  const next = nextChapter(bookId, chapter);
  return (
    <nav class="ch-nav" aria-label="Chapters">
      {prev ? (
        <a href={refToHash(tr, { book: prev[0], chapter: prev[1] })} rel="prev">
          <small>
            <Icon name="left" /> Previous
          </small>
          <span>{formatChapter(prev[0], prev[1])}</span>
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a href={refToHash(tr, { book: next[0], chapter: next[1] })} rel="next" class="ch-nav__next">
          <small>
            Next <Icon name="right" />
          </small>
          <span>{formatChapter(next[0], next[1])}</span>
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}

function Colophon({ trMeta, testament, model }: { trMeta: TranslationMeta | null; testament: 'OT' | 'NT'; model: ChapterModel }) {
  const remote = apiBibleMeta(model.text);
  const parts = [
    trMeta ? `${trMeta.abbr} text: ${trMeta.license.toLowerCase()}` : '',
    testament === 'NT' ? 'Greek: SBLGNT, CC BY 4.0' : 'Hebrew: WLC, public domain · Macula Hebrew, CC BY 4.0',
    trMeta?.alignment === 'manual' || trMeta?.alignment === 'bridged' ? 'Alignment: Clear Bible / Biblica, CC BY 4.0' : '',
    'Lexicons: STEPBible, CC BY 4.0',
  ].filter(Boolean);
  return (
    <footer class="colophon">
      {remote && (
        <p class="colophon__copy">
          {remote.copyright} ·{' '}
          <a href={APIBIBLE_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer">
            {APIBIBLE_ATTRIBUTION.text}
          </a>
        </p>
      )}
      <p>{parts.join(' · ')}</p>
      <p>
        <a href="#/about">About Rootword &amp; full credits</a>
      </p>
    </footer>
  );
}

/* ------------------------------------------------------------------------ */
/* Rails                                                                     */
/* ------------------------------------------------------------------------ */

function LeftRail({ model, tr, bookId, chapter }: { model: ChapterModel | null; tr: string; bookId: string; chapter: number }) {
  const own = model?.text.headings?.length ? model.text.headings : null;
  const [borrowed, setBorrowed] = useState<[number, string][] | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const showHeads = settings.value.headings;

  // Translations without headings (KJV): borrow the BSB's section titles for navigation only.
  useEffect(() => {
    setBorrowed(null);
    if (!model || own || tr === 'BSB') return;
    let off = false;
    loadText('BSB', bookId, chapter).then(
      (t) => !off && setBorrowed(t.headings?.length ? t.headings : null),
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [model]);

  const heads = own ?? borrowed;

  // Scroll spy: the section whose start is above the reading line.
  useEffect(() => {
    if (!heads?.length) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const line = (document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 60) + 120;
        let cur: number | null = heads[0][0];
        for (const [v] of heads) {
          const el = document.getElementById(`v${v}`);
          if (el && el.getBoundingClientRect().top <= line) cur = v;
        }
        setCurrent(cur);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', on);
    };
  }, [heads, model]);

  const verses = model?.text.verses.map((v) => v.v) ?? [];
  return (
    <aside class="rail rail--left" aria-label="In this chapter">
      <section>
        <p class="eyebrow rail__title">In this chapter</p>
        {heads && showHeads ? (
          <>
            <ol class="toc">
              {heads.map(([v, t]) => (
                <li key={`${v}-${t}`}>
                  <a href={refToHash(tr, { book: bookId, chapter, verse: v })} aria-current={current === v ? 'true' : undefined}>
                    <span class="n">{v}</span>
                    <span>
                      <Typeset text={t} />
                    </span>
                  </a>
                </li>
              ))}
            </ol>
            {!own && <p class="rail__note">Section titles from the BSB.</p>}
          </>
        ) : verses.length ? (
          <div class="vgrid" role="list">
            {verses.map((v) => (
              <a key={v} role="listitem" href={refToHash(tr, { book: bookId, chapter, verse: v })} aria-label={`Verse ${v}`}>
                {v}
              </a>
            ))}
          </div>
        ) : null}
      </section>
    </aside>
  );
}

function RightRail({ trMeta, testament }: { trMeta: TranslationMeta | null; testament: 'OT' | 'NT' }) {
  const lang = testament === 'NT' ? 'Greek' : 'Hebrew';
  const align = alignmentOf(trMeta);
  return (
    <aside class="rail rail--right" aria-label="Reading key">
      <section>
        <p class="eyebrow rail__title">Reading key</p>
        <ul class="key">
          <li>
            <span class="sample">
              <span class="w is-active">Word</span>
            </span>
            <span>
              Words link to the {lang}. Hover, tap, or press <span class="kbd">↵</span>.
            </span>
          </li>
          <li>
            <span class="sample">
              <span class="w is-linked">the beginning</span>
            </span>
            <span>A phrase that renders one original word.</span>
          </li>
          <li>
            <span class="sample">
              <span class="w is-kin">Word</span>
            </span>
            <span>The same {lang} word elsewhere in the chapter.</span>
          </li>
          <li>
            <span class="sample">
              <span class="w w--sup">it is</span>
            </span>
            <span>Supplied by the translators (KJV italics); nothing stands behind it.</span>
          </li>
          {trMeta?.alignment === 'bridged' && (
            <li>
              <span class="sample">
                <span class="w w--approx is-active">word</span>
              </span>
              <span>Dashed: an approximate link.</span>
            </li>
          )}
        </ul>
      </section>
      <section>
        <p class="eyebrow rail__title">Keyboard</p>
        <div class="key-keys">
          <span class="kbd">Tab</span>
          <span>Into the text</span>
          <span>
            <span class="kbd">←</span> <span class="kbd">→</span>
          </span>
          <span>Previous / next word</span>
          <span class="kbd">↵</span>
          <span>Pin the word study</span>
          <span class="kbd">Esc</span>
          <span>Close it</span>
          <span class="kbd">/</span>
          <span>Search</span>
          <span>
            <span class="kbd">←</span> <span class="kbd">→</span>
          </span>
          <span>Chapter (outside the text)</span>
        </div>
      </section>
      <section class="edition">
        <p class="eyebrow rail__title">This edition</p>
        <dl>
          <dt>Text</dt>
          <dd>{trMeta ? `${trMeta.name}, ${trMeta.year}` : '—'}</dd>
          <dt>{lang}</dt>
          <dd>{testament === 'NT' ? 'SBL Greek New Testament' : 'Westminster Leningrad Codex'}</dd>
          {testament === 'OT' && (
            <>
              <dt>Greek</dt>
              <dd>Septuagint, via Macula Hebrew</dd>
            </>
          )}
          <dt>Links</dt>
          <dd>{align.long}</dd>
          <dt>Lexicon</dt>
          <dd>{testament === 'NT' ? 'Abbott-Smith · Strong’s' : 'BDB (abridged) · Strong’s'}</dd>
        </dl>
      </section>
    </aside>
  );
}
