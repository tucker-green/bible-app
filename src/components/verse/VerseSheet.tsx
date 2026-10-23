/**
 * The verse sheet (docs/EXPERIENCE.md §2.5): tap / click / Enter on a verse number opens it.
 * Driven by the `verseSheet` signal ({ key: "TR/BOOK/CHAPTER", verse }) — openVerseSheet() /
 * closeVerseSheet() in src/app/state.ts.
 *
 * Bottom sheet on phones / touch (peek · full · closed, spring, back button closes; shell/sheet.ts),
 * a panel docked at the right on desktop. Either way a labelled modal dialog: focus moves in, Tab is
 * trapped, Esc closes and focus returns to the verse number.
 *
 * Contents: the verse, then actions built here — Copy, Share (navigator.share, else the link is
 * copied), Listen from here (startListening), Bookmark (study.ts), Compare (→ #/compare) — then the
 * section slots (Highlight, Note, Cross references, Compare; see ./types.ts) and "Study this verse":
 * every word with its original as a plain list, the screen-reader-friendly word study.
 */
import { batch } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { compareHash } from '../../app/router';
import { closeVerseSheet, pinnedWord, showToast, translations, verseSheet } from '../../app/state';
import { bookmarks, highlights, verseKey } from '../../app/study';
import { feedback } from '../../lib/feedback';
import { transliterate } from '../../lib/greek';
import { formatReference, refToHash } from '../../lib/reference';
import { tokensToText } from '../../lib/data';
import { OW } from '../../lib/types';
import { trapTab, useMedia, useWindowSize } from '../common/hooks';
import { startListening } from '../listen/ListenBar';
import type { ReaderController } from '../reader/interaction';
import type { ChapterModel, Unit } from '../reader/model';
import { unitOrigWords } from '../reader/model';
import { UiIcon } from '../shell/icons';
import type { UiIconName } from '../shell/icons';
import { useBackClose, useSheet } from '../shell/sheet';
import { displayStrongs } from '../word/cardModel';
import { CompareSection } from './CompareSection';
import { HighlightSection } from './HighlightSection';
import { NoteSection } from './NoteSection';
import { XrefSection } from './XrefSection';
import './verse.css';

/** Copy text to the clipboard (Clipboard API, else a hidden textarea + execCommand). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Absolute URL of an in-app hash. */
function absoluteUrl(hash: string): string {
  return `${location.origin}${location.pathname}${location.search}${hash}`;
}

interface WordRow {
  unit: Unit;
  orig: string;
  lang?: string;
  dir?: 'rtl';
  translit: string;
  gloss: string;
  strongs: string;
}

/** Every word unit of a verse with its original (for "Study this verse"). Pure. */
export function verseWords(model: ChapterModel, verse: number): WordRow[] {
  const vm = model.verses.find((v) => v.v === verse);
  if (!vm) return [];
  const rows: WordRow[] = [];
  for (const p of vm.pieces) {
    if (typeof p === 'string') continue;
    if (p.kind === 'linked' && model.orig) {
      const spans = unitOrigWords(model.orig, p.links);
      const text = spans.map((s) => s.text).join(' ');
      const he = model.orig.lang === 'hbo';
      const prim = p.primary >= 0 ? model.orig.words[p.primary] : undefined;
      rows.push({
        unit: p,
        orig: text,
        lang: he ? 'he' : 'grc',
        dir: he ? 'rtl' : undefined,
        translit: he ? spans.map((s) => s.translit).join(' ') : transliterate(text),
        gloss: spans
          .map((s) => s.gloss)
          .filter(Boolean)
          .join(' '),
        strongs: prim?.[OW.strongs] ?? '',
      });
    } else if (p.kind === 'lexicon') {
      const form = p.forms.join(' ');
      rows.push({ unit: p, orig: form, lang: form ? 'grc' : undefined, translit: form ? transliterate(form) : '', gloss: '', strongs: p.strongs[0] ?? '' });
    } else {
      rows.push({ unit: p, orig: '', translit: '', gloss: '', strongs: '' });
    }
  }
  return rows;
}

function Action({ icon, label, onClick, pressed, href }: { icon: UiIconName; label: string; onClick?: () => void; pressed?: boolean; href?: string }) {
  if (href) {
    return (
      <a class="vs-act" href={href} onClick={onClick}>
        <UiIcon name={icon} />
        <span>{label}</span>
      </a>
    );
  }
  return (
    <button type="button" class="vs-act" onClick={onClick} aria-pressed={pressed}>
      <UiIcon name={icon} />
      <span>{label}</span>
    </button>
  );
}

export function VerseSheet({ model, controller }: { model: ChapterModel | null; controller: ReaderController }) {
  const vs = verseSheet.value;
  const open = Boolean(vs && model && vs.key === model.key && model.verses.some((v) => v.v === vs.verse));
  const size = useWindowSize();
  const coarse = useMedia('(pointer: coarse)');
  const sheet = size.width < 720 || coarse;
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const verse = open ? vs!.verse : 0;
  const returnTo = useRef<number>(0);

  const close = () => closeVerseSheet();
  const api = useSheet(ref, { open: open && sheet, enabled: sheet, onClose: close, peek: 0.6 });
  useBackClose(open && sheet, close);

  // Focus in on open; back to the verse number on close.
  useEffect(() => {
    if (!open) return;
    returnTo.current = verse;
    const el = ref.current;
    requestAnimationFrame(() => el?.focus({ preventScroll: true }));
    return () => {
      const active = document.activeElement;
      const inside = !active || active === document.body || el?.contains(active);
      if (inside && !pinnedWord.value) controller.focusVerse(returnTo.current);
    };
  }, [open, verse]);

  // Desktop panel: a press outside it (other than on a verse number) closes it.
  useEffect(() => {
    if (!open || sheet) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest?.('[data-vn], [data-keep-word], .pop')) return;
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, sheet]);

  // Keep the verse visible above the sheet (phones).
  useEffect(() => {
    if (!open || !sheet) return;
    const t = setTimeout(() => {
      const v = controller.vn(verse)?.closest('.verse') as HTMLElement | null;
      if (!v) return;
      const r = v.getBoundingClientRect();
      const top = api.restingTop();
      const header = Math.max(0, document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0);
      if (r.top < header + 8 || r.top > top - 48) window.scrollBy({ top: r.top - header - 24, behavior: 'auto' });
    }, 60);
    return () => clearTimeout(t);
  }, [open, verse, sheet]);

  const rows = useMemo(() => (open && model ? verseWords(model, verse) : []), [open, model, verse]);
  if (!open || !model || !vs) return null;

  const { book, chapter, tr } = model;
  const trMeta = translations.value.find((t) => t.id === tr);
  const abbr = trMeta?.abbr ?? tr;
  const ref0 = { book, chapter, verse };
  const refLabel = formatReference(ref0);
  const tv = model.text.verses.find((v) => v.v === verse);
  const text = tv ? tokensToText(tv.t).trim() : '';
  const key = verseKey(book, chapter, verse);
  const marked = Boolean(bookmarks.value[key]);
  const hl = highlights.value[key];
  const partner = tr === 'KJV' ? (translations.value.find((t) => t.id === 'BSB')?.id ?? null) : 'KJV';

  const doCopy = async () => {
    const ok = await copyText(`${text}\n— ${refLabel} (${abbr})`);
    feedback(ok ? 'success' : 'error');
    showToast(ok ? `Copied ${refLabel}` : 'Couldn’t copy — select the text instead');
  };
  const doShare = async () => {
    const url = absoluteUrl(refToHash(tr, ref0));
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: `${refLabel} (${abbr})`, text: `${text} — ${refLabel} (${abbr})`, url });
        feedback('success');
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    const ok = await copyText(url);
    feedback(ok ? 'success' : 'error');
    showToast(ok ? 'Link copied' : 'Couldn’t copy the link');
  };
  const doListen = () => {
    feedback('select');
    close();
    startListening(verse);
  };
  const doBookmark = () => {
    const next = { ...bookmarks.value };
    if (marked) delete next[key];
    else next[key] = { tr, created: new Date().toISOString() };
    bookmarks.value = next;
    feedback('success');
    showToast(marked ? 'Bookmark removed' : `Bookmarked ${refLabel}`);
  };
  const openWord = (unit: number) => {
    batch(() => {
      verseSheet.value = null;
      pinnedWord.value = { key: model.key, unit, via: 'keyboard' };
    });
    requestAnimationFrame(() => controller.focusUnit(unit));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (ref.current) trapTab(e, ref.current);
  };

  const props = { book, chapter, verse, tr };
  const cls = ['verse-sheet', sheet ? 'is-sheet' : 'is-panel', sheet && api.detent === 'full' ? 'is-full' : ''].filter(Boolean).join(' ');
  return (
    <>
      {sheet && <div class="vs-scrim" aria-hidden="true" onClick={() => api.close()} />}
      <div
        ref={ref}
        class={cls}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vs-title"
        tabIndex={-1}
        data-keep-word
        onKeyDown={onKeyDown}
      >
        {sheet && (
          <div class="sheet-handle" aria-hidden="true" {...api.handleProps}>
            <span />
          </div>
        )}
        <div class="vs-body" ref={bodyRef}>
          <header class="vs-head">
            <div>
              <p class="eyebrow">Verse · {abbr}</p>
              <h2 class="vs-title" id="vs-title">
                {refLabel}
              </h2>
            </div>
            <button type="button" class="vs-close" aria-label="Close verse actions" onClick={() => (sheet ? api.close() : close())}>
              <UiIcon name="close" />
            </button>
          </header>
          {text && <blockquote class={`vs-quote${hl ? ` has-hl hl-${hl}` : ''}`}>{text}</blockquote>}

          <div class="vs-acts" role="group" aria-label="Verse actions">
            <Action icon="copy" label="Copy" onClick={doCopy} />
            <Action icon="share" label="Share" onClick={doShare} />
            <Action icon="listen" label="Listen from here" onClick={doListen} />
            <Action icon={marked ? 'bookmarkFill' : 'bookmark'} label={marked ? 'Bookmarked' : 'Bookmark'} pressed={marked} onClick={doBookmark} />
            {partner && <Action icon="compare" label="Compare" href={compareHash([tr, partner], book, chapter, verse)} onClick={close} />}
          </div>

          <HighlightSection {...props} />
          <NoteSection {...props} />
          <XrefSection {...props} />
          <CompareSection {...props} />

          <section class="vs-sec vs-study" aria-labelledby="vs-study-title">
            <details>
              <summary>
                <h3 class="vs-sec__title" id="vs-study-title">
                  Study this verse
                </h3>
                <span class="vs-study__hint">
                  {rows.length} {rows.length === 1 ? 'word' : 'words'} with their {model.orig?.lang === 'hbo' ? 'Hebrew' : 'Greek'}
                </span>
              </summary>
              <ol class="vs-words">
                {rows.map((r) => (
                  <li key={r.unit.id}>
                    <button type="button" class="vs-word__en" onClick={() => openWord(r.unit.id)}>
                      {r.unit.text}
                    </button>
                    {r.orig ? (
                      <>
                        <span class="vs-word__or" lang={r.lang} dir={r.dir}>
                          {r.orig}
                        </span>
                        {r.translit && <span class="vs-word__tr">{r.translit}</span>}
                        {r.gloss && <span class="vs-word__gl">“{r.gloss}”</span>}
                        {r.strongs && (
                          <a class="vs-word__sn" href={`#/word/${r.strongs}`} onClick={close} aria-label={`Word study ${displayStrongs(r.strongs)}`}>
                            {displayStrongs(r.strongs)}
                          </a>
                        )}
                      </>
                    ) : (
                      <span class="vs-word__none">{r.unit.kind === 'supplied' ? 'supplied by the translators — no original word' : 'no original word linked'}</span>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          </section>
        </div>
      </div>
    </>
  );
}
