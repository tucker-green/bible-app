/**
 * #/compare/{TR1},{TR2}[,{TR3}]/{BOOK}/{CHAPTER}[/{VERSE}] — two or three translations of a chapter,
 * verse by verse.
 *
 * Desktop / tablet: side-by-side columns aligned verse by verse under a sticky bar of translation
 * heads (each one is that column's chooser, with its alignment meter). Phones: interleaved — each
 * verse shows each translation stacked, with a small run-in label (compare.css decides from the
 * container width, not the device).
 *
 * The signature trick: every translation links its words to the same original words, so hovering /
 * tapping / pressing Enter on a word in one column lights up the words that render the same Greek or
 * Hebrew word in every other column, and opens the normal word card (components/compare/*: the
 * reader's model, renderer, controller, word card, verse sheet and scrub loupe over a merged model).
 *
 * Contract (kept): default export, props `ComparePageProps`.
 *   trs     — 2–3 distinct translation ids as typed in the URL; resolved against `translations`
 *             (unknown → KJV, duplicates dropped, topped up to two) and the URL is corrected.
 *   book    — USFM book id ("JHN"); chapter — valid for the book (router-checked).
 *   verse   — optional verse to scroll to and highlight.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { compareHash } from '../app/router';
import { goToHash, meta, panel, passage, pinnedWord, searchOpen, settingsOpen, showToast, translations, verseSheet } from '../app/state';
import { Icon } from '../components/common/Icon';
import { PageLayout } from '../components/layout/PageLayout';
import { CompareBar } from '../components/compare/CompareBar';
import type { ColumnStatus } from '../components/compare/CompareBar';
import { CompareView } from '../components/compare/CompareView';
import { captureAnchor, restoreAnchor, scrollToRow } from '../components/compare/controller';
import type { Anchor } from '../components/compare/controller';
import { prefetchCompare, reportRemoteView, useChapterTexts, useOrigChapter } from '../components/compare/data';
import type { TextLoad } from '../components/compare/data';
import { buildCompareModel, headingsOf, nextTranslation, removeColumn, resolveCompareTrs, setColumn } from '../components/compare/model';
import type { CompareInput } from '../components/compare/model';
import { BOOKS, getBook } from '../lib/books';
import { nextChapter, prevChapter } from '../lib/data';
import { APIBIBLE_ATTRIBUTION, apiBibleMeta } from '../lib/providers/apibible';
import { formatChapter } from '../lib/reference';
import type { TranslationMeta } from '../lib/types';
import '../components/compare/compare.css';

export interface ComparePageProps {
  trs: string[];
  book: string;
  chapter: number;
  verse?: number;
}

/** Reading position carried across the re-mount that follows a change of translations. */
let pendingAnchor: (Anchor & { at: string }) | null = null;

/** Navigate to another compare page, optionally keeping the reading position (translation changes). */
async function goCompare(trs: string[], book: string, chapter: number, opts: { keepPlace?: boolean; replace?: boolean } = {}): Promise<void> {
  if (opts.keepPlace) {
    // warm the new column first so the page re-mounts with its text (no flash of the skeleton)
    const warm = trs.includes('BSB') ? trs : [...trs, 'BSB']; // the BSB lends its section titles
    await Promise.race([prefetchCompare(warm, book, chapter), new Promise((r) => setTimeout(r, 700))]);
    const root = document.querySelector<HTMLElement>('.cmp-grid');
    const a = root ? captureAnchor(root) : null;
    pendingAnchor = a ? { ...a, at: `${book}/${chapter}` } : null;
    // The route key changes with the translations, so the page re-mounts: the old one is removed
    // before the new one renders, and the momentarily short document would clamp the scroll to the
    // top. Hold its height until the new page has restored the position (releaseHeight).
    if (a) holdHeight(document.documentElement.scrollHeight);
  }
  goToHash(compareHash(trs, book, chapter), opts.replace ?? false);
}

let heldTimer: ReturnType<typeof setTimeout> | undefined;
function holdHeight(px: number): void {
  document.documentElement.style.minHeight = `${px}px`;
  clearTimeout(heldTimer);
  heldTimer = setTimeout(releaseHeight, 2500);
}
function releaseHeight(): void {
  clearTimeout(heldTimer);
  if (typeof document !== 'undefined') document.documentElement.style.minHeight = '';
}

export default function ComparePage({ trs, book, chapter, verse }: ComparePageProps) {
  const m = meta.value;
  const list = translations.value;
  const b = getBook(book)!;
  const known = Boolean(m);
  const want = useMemo(() => (known ? resolveCompareTrs(trs, list) : trs), [known, list, trs.join(',')]);
  const corrected = known && want.join(',') !== trs.join(',');
  const ready = known && !corrected;
  const [attempt, setAttempt] = useState(0);

  // Unknown / repeated translations: compare what is available instead (the KJV first).
  useEffect(() => {
    if (!corrected) return;
    const missing = trs.filter((t) => !list.some((x) => x.id.toLowerCase() === t.toLowerCase()));
    if (missing.length) showToast(`The ${missing.join(' and ')} isn’t available here — comparing the ${want.join(' and ')} instead.`);
    goToHash(compareHash(want, book, chapter, verse), true);
  }, [corrected]);

  // The header and "Back to reading" follow the chapter being compared.
  useEffect(() => {
    if (!ready) return;
    const p = passage.peek();
    if (p.tr !== want[0] || p.ref.book !== book || p.ref.chapter !== chapter || p.ref.verse) passage.value = { tr: want[0], ref: { book, chapter } };
  }, [ready, want[0], book, chapter]);

  const texts = useChapterTexts(ready ? want : null, book, chapter, attempt);
  const orig = useOrigChapter(book, chapter, attempt);
  const metaOf = (tr: string): TranslationMeta | undefined => list.find((t) => t.id === tr);

  // Section titles: from a column that has them, else borrowed from the BSB (local, cached).
  const borrowBsb = ready && !want.includes('BSB') && list.some((t) => t.id === 'BSB');
  const bsb = useChapterTexts(borrowBsb ? ['BSB'] : null, book, chapter, attempt)[0];
  const own = texts.find((t): t is Extract<TextLoad, { status: 'ready' }> => t.status === 'ready' && Boolean(t.text.headings?.length));
  const headSource = own ? own.text : bsb?.status === 'ready' ? bsb.text : null;
  const headsFrom = own ? own.tr : headSource ? 'BSB' : null;
  const heads = useMemo(() => headingsOf(headSource), [headSource]);

  const anyReady = texts.some((t) => t.status === 'ready');
  const cm = useMemo(() => {
    if (!ready || orig === undefined || !anyReady) return null;
    const inputs: CompareInput[] = texts.map((t) => {
      const tm = metaOf(t.tr);
      return {
        tr: t.tr,
        abbr: tm?.abbr ?? t.tr,
        name: tm?.name ?? t.tr,
        alignment: tm?.alignment ?? 'none',
        text: t.status === 'ready' ? t.text : null,
      };
    });
    return buildCompareModel(inputs, orig, book, chapter);
  }, [ready, orig, texts, list]);

  // API.Bible text on screen: report the view (FUMS), as API.Bible's terms require.
  const remoteTexts = texts.filter((t): t is Extract<TextLoad, { status: 'ready' }> => t.status === 'ready' && Boolean(apiBibleMeta(t.text)));
  useEffect(() => {
    for (const t of remoteTexts) reportRemoteView(t.text);
  }, [remoteTexts.map((t) => t.tr).join(',')]);

  // Reading position: carried over from the previous translations, or the verse in the URL. Applied
  // before the first paint (layout effect) and again after PageLayout's scroll-to-top (effects run
  // children first, so this one comes last in the same flush: no frame at the top).
  const placed = useRef<string | null>(null);
  const place = (final: boolean) => {
    const root = document.querySelector<HTMLElement>('.cmp-grid');
    const a = pendingAnchor;
    if (root && a && a.at === `${book}/${chapter}`) restoreAnchor(root, a);
    else if (root && verse && final) scrollToRow(root, verse, true);
    if (!final) return;
    pendingAnchor = null;
    requestAnimationFrame(() => requestAnimationFrame(releaseHeight));
  };
  useLayoutEffect(() => {
    if (cm && placed.current !== `${verse ?? ''}`) place(false);
  }, [cm, verse]);
  useEffect(() => {
    const sig = `${verse ?? ''}`;
    if (!cm || placed.current === sig) return;
    placed.current = sig;
    place(true);
  }, [cm, verse]);

  // ← / → outside the text: previous / next chapter (as in the reader).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (t instanceof Element && t.closest('[data-u], [data-vn], [role="dialog"], [role="radiogroup"]')) return;
      if (pinnedWord.peek() || verseSheet.peek() || searchOpen.peek() || settingsOpen.peek() || panel.peek()) return;
      const to = e.key === 'ArrowLeft' ? prevChapter(book, chapter) : nextChapter(book, chapter);
      if (!to) return;
      e.preventDefault();
      void goCompare(want, to[0], to[1]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [want.join(','), book, chapter]);

  const status: ColumnStatus[] = want.map((tr) => texts.find((t) => t.tr === tr)?.status ?? 'loading');
  const failed = texts.filter((t) => t.status === 'error');
  const allFailed = texts.length > 0 && failed.length === texts.length;

  const change = (next: string[]) => void goCompare(next, book, chapter, { keepPlace: true, replace: true });
  const prev = prevChapter(book, chapter);
  const next = nextChapter(book, chapter);
  const swipe = {
    label: (dir: 'next' | 'prev') => {
      const t = dir === 'next' ? next : prev;
      return t ? formatChapter(t[0], t[1], 'short') : null;
    },
    go: (dir: 'next' | 'prev') => {
      const t = dir === 'next' ? next : prev;
      if (t) void goCompare(want, t[0], t[1]);
    },
  };

  const chapterLabel = formatChapter(book, chapter);
  const bookLabel = b.id === 'PSA' ? 'Psalm' : b.name;
  const abbrs = want.map((tr) => metaOf(tr)?.abbr ?? tr);
  const lang = b.testament === 'NT' ? 'Greek' : 'Hebrew';

  return (
    <PageLayout
      eyebrow={`Compare translations · ${b.testament === 'NT' ? 'New Testament' : 'Old Testament'}`}
      title={
        <>
          <span>{bookLabel}</span>
          {b.chapters > 1 || b.id === 'PSA' ? <span class="num">{chapter}</span> : null}
        </>
      }
      docTitle={`${chapterLabel} · ${abbrs.join(' / ')} compared`}
      lede={
        <p class="cmp-lede">
          The {abbrs.slice(0, -1).join(', ')} and {abbrs[abbrs.length - 1]}, verse by verse. Hover, tap or press <span class="kbd">↵</span> on a
          word: the words that render the same {lang} word light up in every column.
        </p>
      }
      wide
      class="page--compare"
      busy={!cm && !allFailed}
    >
      <CompareTools trs={want} book={book} chapter={chapter} />
      <div class="cmp" data-n={want.length} style={{ '--n': String(want.length) }}>
        <CompareBar
          trs={want}
          status={status}
          list={list}
          onSet={(i, id) => change(setColumn(want, i, id))}
          onRemove={(i) => change(removeColumn(want, i))}
          onAdd={() => {
            const id = nextTranslation(want, list);
            if (id) change([...want, id]);
          }}
          onRetry={() => setAttempt((n) => n + 1)}
        />
        {allFailed && (
          <div class="notice cmp-notice" role="alert">
            <Icon name="alert" />
            <div>
              <p class="notice__title">{chapterLabel} didn’t load.</p>
              <p>{navigator.onLine === false ? 'You seem to be offline. Chapters you have opened before still work.' : 'Check your connection and try again.'}</p>
              <div class="notice__actions">
                <button type="button" class="btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                  <Icon name="retry" /> Try again
                </button>
              </div>
            </div>
          </div>
        )}
        {cm ? <CompareView cm={cm} heads={heads} swipe={swipe} /> : !allFailed && <CompareSkeleton n={want.length} />}
        {cm && headsFrom === 'BSB' && !want.includes('BSB') && heads.size > 0 && <p class="cmp-note">Section titles from the BSB.</p>}
      </div>
      {cm && <ChapterNav trs={want} prev={prev} next={next} />}
      {cm && <Colophon texts={texts} metaOf={metaOf} testament={b.testament} />}
    </PageLayout>
  );
}

/* ------------------------------------------------------------------------ */

/** Book / chapter pickers and previous / next chapter, above the columns. */
function CompareTools({ trs, book, chapter }: { trs: string[]; book: string; chapter: number }) {
  const b = getBook(book)!;
  const prev = prevChapter(book, chapter);
  const next = nextChapter(book, chapter);
  return (
    <nav class="cmp-tools" aria-label="Chapter">
      {prev ? (
        <a class="cmp-step" href={compareHash(trs, prev[0], prev[1])} aria-label={`Previous chapter: ${formatChapter(prev[0], prev[1])}`} rel="prev">
          <Icon name="left" />
        </a>
      ) : (
        <span class="cmp-step is-off" aria-hidden="true">
          <Icon name="left" />
        </span>
      )}
      <span class="cmp-sel cmp-sel--book">
        <span class="cmp-sel__face" aria-hidden="true">
          <span class="long">{b.name}</span>
          <span class="short">{b.short}</span>
        </span>
        <select aria-label="Book" value={book} onChange={(e) => void goCompare(trs, (e.currentTarget as HTMLSelectElement).value, 1)}>
          {BOOKS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <Icon name="chev" class="cmp-sel__chev" />
      </span>
      {b.chapters > 1 && (
        <span class="cmp-sel cmp-sel--ch">
          <span class="cmp-sel__face" aria-hidden="true">
            <span class="long">{b.id === 'PSA' ? 'Psalm' : 'Chapter'}&nbsp;</span>
            {chapter}
          </span>
          <select aria-label={b.id === 'PSA' ? 'Psalm' : 'Chapter'} value={String(chapter)} onChange={(e) => void goCompare(trs, book, Number((e.currentTarget as HTMLSelectElement).value))}>
            {Array.from({ length: b.chapters }, (_, i) => (
              <option key={i} value={String(i + 1)}>
                {b.id === 'PSA' ? `Psalm ${i + 1}` : `Chapter ${i + 1}`}
              </option>
            ))}
          </select>
          <Icon name="chev" class="cmp-sel__chev" />
        </span>
      )}
      {next ? (
        <a class="cmp-step" href={compareHash(trs, next[0], next[1])} aria-label={`Next chapter: ${formatChapter(next[0], next[1])}`} rel="next">
          <Icon name="right" />
        </a>
      ) : (
        <span class="cmp-step is-off" aria-hidden="true">
          <Icon name="right" />
        </span>
      )}
    </nav>
  );
}

function ChapterNav({ trs, prev, next }: { trs: string[]; prev: [string, number] | null; next: [string, number] | null }) {
  return (
    <nav class="ch-nav cmp-chnav" aria-label="Chapters">
      {prev ? (
        <a href={compareHash(trs, prev[0], prev[1])} rel="prev">
          <small>
            <Icon name="left" /> Previous
          </small>
          <span>{formatChapter(prev[0], prev[1])}</span>
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a href={compareHash(trs, next[0], next[1])} rel="next" class="ch-nav__next">
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

function Colophon({
  texts,
  metaOf,
  testament,
}: {
  texts: TextLoad[];
  metaOf: (tr: string) => TranslationMeta | undefined;
  testament: 'OT' | 'NT';
}) {
  const lines = texts.map((t) => {
    const tm = metaOf(t.tr);
    const remote = t.status === 'ready' ? apiBibleMeta(t.text) : undefined;
    return { tr: t.tr, abbr: tm?.abbr ?? t.tr, license: tm?.license ?? '', remote };
  });
  const aligned = texts.some((t) => ['manual', 'bridged'].includes(metaOf(t.tr)?.alignment ?? ''));
  return (
    <footer class="colophon cmp-colophon">
      {lines.map((l) =>
        l.remote ? (
          <p key={l.tr} class="colophon__copy">
            {l.abbr}: {l.remote.copyright} ·{' '}
            <a href={APIBIBLE_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer">
              {APIBIBLE_ATTRIBUTION.text}
            </a>
          </p>
        ) : null,
      )}
      <p>
        {[
          ...lines.filter((l) => !l.remote && l.license).map((l) => `${l.abbr} text: ${l.license.toLowerCase()}`),
          testament === 'NT' ? 'Greek: SBLGNT, CC BY 4.0' : 'Hebrew: WLC, public domain · Macula Hebrew, CC BY 4.0',
          aligned ? 'Alignment: Clear Bible / Biblica, CC BY 4.0' : '',
          'Lexicons: STEPBible, CC BY 4.0',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p>
        <a href="#/about">About Rootword &amp; full credits</a>
      </p>
    </footer>
  );
}

function CompareSkeleton({ n }: { n: number }) {
  const widths = [96, 88, 92, 70, 98, 84];
  return (
    <div class="cmp-skel" aria-hidden="true">
      {widths.map((w, i) => (
        <div class="cmp-skel__row" key={i}>
          {Array.from({ length: n }, (_, k) => (
            <div class="cmp-skel__cell" key={k}>
              <span class="skeleton" style={{ width: `${w - k * 6}%` }} />
              <span class="skeleton" style={{ width: `${w - 30 + k * 4}%` }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
