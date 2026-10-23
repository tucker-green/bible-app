/**
 * The word card: the Greek / Hebrew behind an English word, directly below it (or above when there
 * is no room), or as a bottom sheet on narrow / touch screens.
 *
 * Hover / keyboard focus: role="tooltip". Opened by keyboard focus it is inert (no Tab stops inside —
 * Tab moves on past the text; the live region announces a one-line summary). Pinned (click, tap,
 * Enter): role="dialog", its links and buttons reachable; the sheet form traps focus.
 *
 * Sheet form (docs/EXPERIENCE.md §2): opens at peek height (~45%) with a spring, the page scrolls so
 * the tapped word stays above it, drag / fling between peek · full · closed (shell/sheet.ts),
 * back button / Esc / × / tapping the dimmed text close it; tapping another word swaps the content
 * in place (cross-fade), scrubbing updates it live.
 *
 * Extension slots: <SpeakButton> beside each headword, <EntitySection> (people & places) inside
 * every card, and a "Word study →" link to #/word/{id} in the footer.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { preloadPage } from '../../app/pages';
import { activeWord, announce, closeWord, openSearch, pinnedWord, scrollBehavior, settings, translations } from '../../app/state';
import { BOOKS, getBook } from '../../lib/books';
import { loadConcordance, loadLexEntry } from '../../lib/data';
import { refToHash } from '../../lib/reference';
import type { LexEntry, TranslationMeta } from '../../lib/types';
import { unpackRef } from '../../lib/types';
import { Icon } from '../common/Icon';
import { trapTab, useMedia, useWindowSize } from '../common/hooks';
import type { ReaderController } from '../reader/interaction';
import type { ChapterModel } from '../reader/model';
import type { CardModel } from './cardModel';
import { buildCardModel, cardBaseStrongs, cardSummary, htmlLang } from './cardModel';
import { DefText } from './DefText';
import type { DefNode } from './definition';
import { defToText, parseDefinition, splitDefinitionHead } from './definition';
import { computePlacement } from './placement';
import { CoachMark } from './CoachMark';
import { EntitySection } from './EntitySection';
import { SCRUB_SHEET_PEEK, scrub, scrubbing } from './scrub';
import { SpeakButton } from './SpeakButton';
import { useBackClose, useSheet, useSheetClass } from '../shell/sheet';
import { UiIcon } from '../shell/icons';
import './card.css';

type Load<T> = { id: string; status: 'loading' | 'ready' | 'error'; value?: T };

function useLoad<T>(id: string, load: (id: string) => Promise<T>, retry: number): Load<T> | null {
  const [state, setState] = useState<Load<T> | null>(null);
  useEffect(() => {
    if (!id) {
      setState(null);
      return;
    }
    let off = false;
    setState((s) => (s && s.id === id && s.status === 'ready' ? s : { id, status: 'loading' }));
    load(id).then(
      (value) => !off && setState({ id, status: 'ready', value }),
      () => !off && setState({ id, status: 'error' }),
    );
    return () => {
      off = true;
    };
  }, [id, retry]);
  return state && state.id === id ? state : id ? { id, status: 'loading' } : null;
}

export function WordCard({
  model,
  controller,
  onReloadOrig,
}: {
  model: ChapterModel | null;
  controller: ReaderController;
  /** Fetch the chapter's Greek / Hebrew again (offered when it didn't load). */
  onReloadOrig?: () => void;
}) {
  const pinned = pinnedWord.value;
  const active = activeWord.value;
  const ref = pinned ?? active;
  const isPinned = Boolean(pinned);
  const unit = ref && model && ref.key === model.key ? (model.units[ref.unit] ?? null) : null;
  const card = useMemo(() => (unit && model ? buildCardModel(model, unit) : null), [model, unit]);
  const size = useWindowSize();
  const coarse = useMedia('(pointer: coarse)');
  const sheet = Boolean(card) && (size.width < 720 || (isPinned && (pinned?.via === 'touch' || coarse)));
  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const scrolledFor = useRef('');
  const scrollTarget = useRef(0);
  const openedAt = useRef(0);
  const tr = model?.tr ?? '';
  const trMeta = translations.value.find((t) => t.id === tr) ?? null;

  const lexId = card?.strongs ?? '';
  const lex = useLoad<LexEntry | undefined>(lexId, loadLexEntry, retry);
  const lxxLex = useLoad<LexEntry | undefined>(card?.lxx?.strongs ?? '', loadLexEntry, retry);
  const concId = card ? cardBaseStrongs(card) : '';
  const conc = useLoad<number[]>(concId, loadConcordance, retry);

  const wordKey = card ? `${model?.key}:${card.unitId}` : '';
  useEffect(() => {
    setExpanded(false);
    openedAt.current = Date.now();
  }, [wordKey]);

  // While the sheet is open, reserve room below the text so the last lines can scroll above it.
  const sheetOpen = sheet && isPinned;
  // While scrubbing the sheet stays low (the finger needs the text); it rises to peek on lift.
  const isScrubbing = scrubbing.value;
  const sheetApi = useSheet(cardRef, {
    open: sheetOpen,
    enabled: sheet,
    onClose: () => closeWord(),
    peek: isScrubbing ? SCRUB_SHEET_PEEK : 0.45,
  });
  const full = sheet && sheetApi.detent === 'full';
  useBackClose(sheetOpen, () => closeWord());
  useSheetClass(sheetOpen);

  // Keep the tapped word visible above the sheet, also while the sheet grows (content loading).
  const keepVisible = () => {
    const el = cardRef.current;
    if (!el || !unit || scrub.peek() || Date.now() - openedAt.current > 1500) return;
    const anchor = controller.el(unit.id);
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const sheetTop = sheetApi.restingTop();
    const header = Math.max(0, document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0);
    let dy = 0;
    if (r.bottom > sheetTop - 16) dy = r.bottom - (sheetTop - 16);
    else if (r.top < header + 8) dy = r.top - header - 24;
    if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: scrollBehavior() });
  };
  useEffect(() => {
    const el = cardRef.current;
    if (!sheet || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => keepVisible());
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet, wordKey]);

  // Lifting the finger after scrubbing: the sheet rises to peek and the word moves above it.
  const wasScrubbing = useRef(false);
  useEffect(() => {
    if (wasScrubbing.current && !isScrubbing && sheetOpen) {
      openedAt.current = Date.now();
      sheetApi.setDetent('peek');
      requestAnimationFrame(keepVisible);
    }
    wasScrubbing.current = isScrubbing;
  }, [isScrubbing]);

  // Tell the controller where the card is (pointer travel into it keeps a hover card open).
  useEffect(() => {
    controller.cardEl = cardRef.current;
  });

  // Announce keyboard / touch opens to screen readers.
  useEffect(() => {
    if (!card || !ref || ref.via === 'hover') return;
    announce(cardSummary(card));
  }, [wordKey]);

  // Content that arrives later inside the card (the people & places block loads on its own) changes
  // its height without re-rendering WordCard: re-run the placement below when the size changes, so
  // the popover never runs off the bottom of the viewport.
  const [, setMeasured] = useState(0);
  const hasCard = Boolean(card);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || sheet || typeof ResizeObserver === 'undefined') return;
    let last = el.offsetHeight;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (Math.abs(h - last) < 2) return;
      last = h;
      setMeasured((n) => n + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet, hasCard]);

  // Placement (popover form): below the word, flipped above when needed, clamped to the viewport.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !unit) return;
    if (sheet) {
      el.style.left = '';
      el.style.top = '';
      el.style.maxHeight = '';
      if (scrolledFor.current !== wordKey) {
        scrolledFor.current = wordKey;
        requestAnimationFrame(keepVisible);
      }
      return;
    }
    const anchor = controller.el(unit.id);
    const host = (el.offsetParent as HTMLElement | null) ?? document.body;
    if (!anchor) return;
    el.style.maxHeight = '';
    el.classList.remove('is-tight');
    const rects = [...anchor.getClientRects()].map((r) => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    }));
    const header = document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0;
    const place = () =>
      computePlacement({
        rects,
        card: { width: el.offsetWidth, height: el.offsetHeight },
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        topInset: header,
        pinned: isPinned,
      });
    let p = place();
    // A hover card that fits on neither side first tightens (shorter definition) before scrolling.
    if (!isPinned && Number.isFinite(p.maxHeight)) {
      el.classList.add('is-tight');
      p = place();
    }
    const h = host.getBoundingClientRect();
    el.style.left = `${Math.round(p.left - h.left)}px`;
    el.style.top = `${Math.round(p.top - h.top)}px`;
    el.style.setProperty('--notch-x', `${Math.round(p.notchX)}px`);
    if (Number.isFinite(p.maxHeight)) el.style.maxHeight = `${Math.floor(p.maxHeight)}px`;
    el.classList.toggle('is-above', p.side === 'above');
    // A pinned card that does not fit scrolls the page (once per word, and further only if the card
    // grew since: its definition and people block arrive after it opens). The target is absolute,
    // so a re-placement during a smooth scroll does not add up.
    if (p.scrollBy > 0) {
      const target = Math.round(window.scrollY + p.scrollBy);
      if (scrolledFor.current !== wordKey || target > scrollTarget.current + 1) {
        scrolledFor.current = wordKey;
        scrollTarget.current = target;
        window.scrollTo({ top: target, behavior: scrollBehavior() });
      }
    }
  });

  // Sheet / pinned dialog: move focus in, trap it (sheet), restore it on close.
  useEffect(() => {
    if (!card || !isPinned) return;
    const el = cardRef.current;
    const via = pinned?.via;
    if (sheet || via === 'keyboard') {
      if (sheet) requestAnimationFrame(() => el?.focus({ preventScroll: true }));
    }
    return () => {
      if (via === 'keyboard' || (sheet && via !== 'touch')) {
        if (!pinnedWord.value && document.activeElement && el?.contains(document.activeElement)) controller.focusUnit(unit!.id, true);
      }
    };
  }, [wordKey, isPinned, sheet]);

  if (!card || !model) return null;

  const close = (refocus: boolean) => {
    const id = card.unitId;
    const hadFocus = cardRef.current?.contains(document.activeElement);
    if (sheetOpen && !refocus) sheetApi.close();
    else closeWord();
    if (refocus || hadFocus) controller.focusUnit(id, true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (sheet && isPinned && cardRef.current) trapTab(e, cardRef.current);
  };

  const role = isPinned ? 'dialog' : 'tooltip';
  const cls = [
    'word-card',
    sheet ? 'is-sheet' : 'is-pop',
    sheet && full ? 'is-full' : '',
    isPinned ? 'is-pinned' : '',
    card.approx ? 'is-approx' : '',
    `is-${card.kind}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {sheetOpen && <div class="word-scrim" aria-hidden="true" />}
      <div
        ref={cardRef}
        id="word-card"
        class={cls}
        role={role}
        aria-label={isPinned ? `Word study: ${card.headword || card.english}` : undefined}
        aria-modal={sheet && isPinned ? 'true' : undefined}
        // A keyboard-focus tooltip holds no Tab stops (ARIA tooltip pattern): Enter pins it.
        inert={!isPinned && ref?.via === 'focus'}
        tabIndex={-1}
        data-keep-word
        onPointerEnter={() => controller.cardEnter()}
        onPointerLeave={(e) => (e as PointerEvent).pointerType !== 'touch' && controller.cardLeave()}
        onKeyDown={onKeyDown}
      >
        {!sheet && <span class="card__notch" aria-hidden="true" />}
        {sheet && (
          <div class="sheet-handle" aria-hidden="true" {...sheetApi.handleProps}>
            <span />
          </div>
        )}
        {sheet && isPinned && pinned?.via === 'touch' && <CoachMark />}
        <div class="card__inner" key={wordKey}>
          <CardTop card={card} pinned={isPinned || sheet} onClose={() => close(!sheet)} />
          {card.kind === 'supplied' ? (
            <SuppliedBody card={card} />
          ) : card.kind === 'unavailable' ? (
            <UnavailableBody card={card} onRetry={onReloadOrig} />
          ) : (
            <>
              <CardHero card={card} lxxGloss={lxxLex?.value?.gloss ?? ''} />
              {card.morphemes.length > 1 && <Morphemes card={card} />}
              <Facts card={card} lex={lex} trMeta={trMeta} />
              {card.note && <p class="card__note">{card.note}</p>}
              {card.approx && <ApproxNote card={card} trMeta={trMeta} />}
            </>
          )}
          <EntitySection book={model.book} chapter={model.chapter} origIndices={unit?.links ?? []} tr={model.tr} />
          {card.kind !== 'supplied' && (card.kind !== 'unavailable' || Boolean(card.strongs)) && (
            <Definition
              card={card}
              lex={lex}
              expanded={expanded}
              onExpand={() => {
                setExpanded(true);
                if (sheet) sheetApi.setDetent('full');
                if (!isPinned) pinnedWord.value = { ...ref!, via: 'click' };
              }}
              onCollapse={() => setExpanded(false)}
              onRetry={() => setRetry((n) => n + 1)}
              tr={tr}
            />
          )}
        </div>
        {card.kind !== 'supplied' && card.strongs && <CardFoot card={card} conc={conc} book={model.book} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function CardTop({ card, pinned, onClose }: { card: CardModel; pinned: boolean; onClose: () => void }) {
  const tag = card.kind === 'supplied' ? 'Supplied' : `${card.langLabel} · ${card.edition}`;
  return (
    <div class="card__top">
      <span class="card__en">“{card.english}”</span>
      <span class="card__ref">{card.reference}</span>
      <span class="card__lang">{tag}</span>
      {pinned && (
        <button type="button" class="card__close" aria-label="Close word study" onClick={onClose}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}

function StrongsPill({ id, label }: { id: string; label: string }) {
  if (!id) return null;
  return (
    <button
      type="button"
      class="card__strongs"
      title={`Strong’s ${label}: search every occurrence`}
      aria-label={`Strong’s ${label}: search every occurrence`}
      onClick={() => openSearch(label)}
    >
      {label}
    </button>
  );
}

function HebrewWord({ card }: { card: CardModel }) {
  const lang = htmlLang(card.lang === 'arc' ? 'arc' : 'hbo');
  if (card.morphemes.length > 1) {
    return (
      <p class="card__orig hbo" lang={lang} dir="rtl" id="word-card-head">
        {card.morphemes.map((m) => (
          <span key={m.index} class={m.linked ? 'is-linked' : 'is-aux'}>
            {m.text}
          </span>
        ))}
      </p>
    );
  }
  return (
    <p class="card__orig hbo" lang={lang} dir="rtl" id="word-card-head">
      {card.headword}
    </p>
  );
}

function CardHero({ card, lxxGloss }: { card: CardModel; lxxGloss: string }) {
  const hebrew = card.lang !== 'grc' && card.kind === 'linked';
  if (hebrew) {
    return (
      <div class="card__duo">
        <div class="duo__col">
          <div class="col-lbl">
            <span>{card.langLabel}</span>
            <StrongsPill id={card.strongs} label={card.strongsLabel} />
          </div>
          <div class="card__headrow">
            <HebrewWord card={card} />
            <SpeakButton text={card.headword} lang="hbo" translit={card.translit || undefined} size="sm" />
          </div>
          {card.translit && <p class="card__translit">{card.translit}</p>}
        </div>
        <span class="vr" aria-hidden="true" />
        <div class="duo__col">
          <div class="col-lbl">
            <span>Septuagint</span>
            {card.lxx?.strongs && <StrongsPill id={card.lxx.strongs} label={card.lxx.strongsLabel} />}
          </div>
          {card.lxx ? (
            <>
              <div class="card__headrow">
                <p class="lxx-word" lang="grc">
                  {card.lxx.text}
                </p>
                <SpeakButton text={card.lxx.text} lang="grc" translit={card.lxx.translit || undefined} size="sm" />
              </div>
              <p class="card__translit lxx-sub">
                {card.lxx.translit}
                {lxxGloss && <span class="lxx-gloss"> · {lxxGloss}</span>}
              </p>
            </>
          ) : (
            <p class="lxx-none">No Greek equivalent recorded for this word.</p>
          )}
        </div>
      </div>
    );
  }
  const lang = htmlLang(card.lang);
  return (
    <div class="card__hero">
      <p class={`card__orig${lang === 'grc' ? '' : ' hbo'}${card.kind === 'lexicon' ? ' is-tr' : ''}`} lang={lang} dir={lang === 'grc' ? undefined : 'rtl'} id="word-card-head">
        {card.headword || card.strongsLabel || '—'}
      </p>
      {card.translit && <p class="card__translit">{card.translit}</p>}
      {card.headword && (
        <span class="card__speak">
          <SpeakButton text={card.headword} lang={card.lang === 'grc' ? 'grc' : 'hbo'} translit={card.translit || undefined} size="md" />
        </span>
      )}
      <span class="card__hero-pill">
        <StrongsPill id={card.strongs} label={card.strongsLabel} />
      </span>
    </div>
  );
}

function Morphemes({ card }: { card: CardModel }) {
  const lang = htmlLang(card.lang === 'arc' ? 'arc' : 'hbo');
  return (
    <div class="morphs" aria-label="Parts of the written word">
      {card.morphemes.flatMap((m, i) => [
        i > 0 ? (
          <span key={`p${m.index}`} class="plus" aria-hidden="true">
            +
          </span>
        ) : null,
        <span key={m.index} class={`morph${m.linked ? ' is-linked' : ''}${m.primary ? ' is-main' : ''}`}>
          <span class="hbo" lang={lang} dir="rtl">
            {m.text}
          </span>
          {m.gloss && <span class="morph__gl">{m.gloss}</span>}
          {m.pos && <span class="pos">{m.pos.toLowerCase()}</span>}
        </span>,
      ])}
    </div>
  );
}

function renderingsOf(entry: LexEntry | undefined, tr: string): { list: [string, number][]; from: string } | null {
  const r = entry?.renderings;
  if (r) {
    if (r[tr]?.length) return { list: r[tr].slice(0, 4), from: tr };
    if (r.BSB?.length) return { list: r.BSB.slice(0, 4), from: 'BSB' };
    const any = Object.keys(r).find((k) => r[k]?.length);
    if (any) return { list: r[any].slice(0, 4), from: any };
  }
  return null;
}

function Facts({ card, lex, trMeta }: { card: CardModel; lex: Load<LexEntry | undefined> | null; trMeta: TranslationMeta | null }) {
  const entry = lex?.value;
  const showCodes = settings.value.morphCodes;
  const lang = card.lang;
  const head = useMemo(() => {
    if (!entry?.def) return null;
    return splitDefinitionHead(parseDefinition(entry.def), entry.lemma || card.lemma).head;
  }, [entry]);
  const lemma = entry?.lemma || card.lemma;
  const lemmaTranslit = entry?.translit ?? '';
  const rend = renderingsOf(entry, trMeta?.id ?? '');
  const parsing = card.parsing;
  return (
    <dl class="facts">
      {(lemma || head) && (
        <>
          <dt>Lemma</dt>
          <dd>
            <span class={lang === 'grc' ? 'grc' : 'hbo'} lang={htmlLang(lang)} dir={lang === 'grc' ? undefined : 'rtl'}>
              {head ? defToText(head) : lemma}
            </span>
            {lemmaTranslit && <span class="lexgl"> {lemmaTranslit}</span>}
          </dd>
        </>
      )}
      {parsing && (
        <>
          <dt>Parsing</dt>
          <dd title={parsing.parts.map((p) => `${p.label}: ${p.value}`).join('\n') || undefined}>
            {parsing.ok ? parsing.long : '—'}
            {showCodes && card.morph && <code>{card.morph}</code>}
          </dd>
        </>
      )}
      {card.gloss && (
        <>
          <dt>Gloss</dt>
          <dd class="gloss">{card.gloss}</dd>
        </>
      )}
      {(rend || entry?.kjv || lex?.status === 'loading') && (
        <>
          <dt>Rendered</dt>
          <dd class="rend">
            {rend ? (
              <>
                {rend.from !== trMeta?.id && <span class="rend__from">{rend.from} </span>}
                {rend.list.map(([w, n], i) => [
                  i > 0 ? (
                    <span key={`s${i}`} class="sep">
                      {' · '}
                    </span>
                  ) : null,
                  <span class="r" key={w}>
                    <b>{w}</b> <span class="n">{n.toLocaleString('en-US')}</span>
                  </span>,
                ])}
              </>
            ) : entry?.kjv ? (
              <span class="rend__kjv">
                <span class="rend__from">KJV </span>
                {entry.kjv.replace(/\s*\.\s*$/, '')}
              </span>
            ) : (
              <span class="skeleton skeleton--inline" />
            )}
          </dd>
        </>
      )}
      {card.others.length > 0 && (
        <>
          <dt>With</dt>
          <dd class="others">
            {card.others.map((w, i) => (
              <span key={w.index} class="other">
                {i > 0 && <span class="sep">{' · '}</span>}
                <span class={w.lang === 'grc' ? 'grc' : 'hbo'} lang={htmlLang(w.lang)} dir={w.lang === 'grc' ? undefined : 'rtl'}>
                  {w.text}
                </span>{' '}
                <span class="lexgl">{w.gloss.replace(/\./g, ' ')}</span>
              </span>
            ))}
          </dd>
        </>
      )}
    </dl>
  );
}

function ApproxNote({ card, trMeta }: { card: CardModel; trMeta: TranslationMeta | null }) {
  const bridged = trMeta?.alignment === 'bridged';
  const conf = card.conf < 1 ? ` · ${Math.round(card.conf * 100)}% sure` : '';
  return (
    <p class="card__approx" title={bridged ? `The ${trMeta?.abbr ?? 'text'} has no hand-made alignment; its words are matched to the original automatically through the BSB.` : undefined}>
      <span class="approx-mark" aria-hidden="true">
        ≈
      </span>
      <span>
        <b>Approximate link</b> · {bridged ? 'matched via the BSB' : 'uncertain in the alignment'}
        {conf}
      </span>
    </p>
  );
}

function Definition({
  card,
  lex,
  expanded,
  onExpand,
  onCollapse,
  onRetry,
  tr,
}: {
  card: CardModel;
  lex: Load<LexEntry | undefined> | null;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onRetry: () => void;
  tr: string;
}) {
  const txtRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const entry = lex?.value;
  const nodes = useMemo<DefNode[] | null>(() => {
    if (!entry) return null;
    const parsed = entry.def ? parseDefinition(entry.def) : [];
    const body = splitDefinitionHead(parsed, entry.lemma || card.lemma).body;
    if (body.length) return body;
    return entry.strongsDef ? [{ t: 'text', v: entry.strongsDef }] : [];
  }, [entry]);

  useLayoutEffect(() => {
    const el = txtRef.current;
    if (!el) return;
    setOverflow(el.scrollHeight > el.clientHeight + 2);
  }, [nodes, expanded]);

  if (!lex) return null;
  if (lex.status === 'loading') {
    return (
      <div class="card__def" aria-busy="true">
        <span class="skeleton" style={{ width: '96%' }} />
        <span class="skeleton" style={{ width: '88%' }} />
        <span class="skeleton" style={{ width: '64%' }} />
      </div>
    );
  }
  if (lex.status === 'error') {
    return (
      <div class="card__def card__def--error" role="alert">
        <Icon name="alert" />
        <span>The dictionary entry didn’t load.</span>
        <button type="button" class="link-btn" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (!entry || !nodes || !nodes.length) {
    return <div class="card__def card__def--none">No dictionary entry for {card.strongsLabel || 'this word'}.</div>;
  }
  const source = !entry.def
    ? 'Strong’s dictionary'
    : entry.src === 'rootword'
      ? 'Rootword (Hebrew grammar note)'
      : card.strongs.startsWith('G')
        ? 'Abbott-Smith via STEPBible'
        : 'STEPBible';
  return (
    <div class="card__def">
      <div ref={txtRef} class={`card__def-txt${expanded ? ' is-open' : ''}`}>
        <DefText nodes={nodes} hrefFor={(ref) => refToHash(tr, ref)} onRef={() => closeWord()} />
      </div>
      {(overflow || expanded) && (
        <button type="button" class="link-btn card__more" aria-expanded={expanded} onClick={expanded ? onCollapse : onExpand}>
          {expanded ? 'Less' : 'More'}
        </button>
      )}
      <span class="card__src">
        {source}
        {entry.pos ? ` · ${entry.pos}` : ''}
      </span>
    </div>
  );
}

function SuppliedBody({ card }: { card: CardModel }) {
  const lang = card.testament === 'NT' ? 'Greek' : 'Hebrew';
  return (
    <div class="card__supplied">
      <p class="card__supplied-title">Supplied by the translators</p>
      <p>
        No {lang} word stands behind <i>{card.english}</i>. The translators added it so the English reads naturally, and the KJV prints
        such words in italics.
      </p>
    </div>
  );
}

function UnavailableBody({ card, onRetry }: { card: CardModel; onRetry?: () => void }) {
  return (
    <div class="card__supplied card__unavailable" role="status">
      <p class="card__supplied-title">{card.note}</p>
      <p>
        The English reads normally, but its words aren’t linked to the {card.testament === 'NT' ? 'Greek' : 'Hebrew'} until it loads.{' '}
        {onRetry && (
          <button type="button" class="link-btn" onClick={onRetry}>
            Try again
          </button>
        )}
      </p>
    </div>
  );
}

function CardFoot({ card, conc, book }: { card: CardModel; conc: Load<number[]> | null; book: string }) {
  const refs = conc?.value ?? null;
  const b = getBook(book);
  const testament: 'OT' | 'NT' = card.strongs.startsWith('H') ? 'OT' : 'NT';
  const books = BOOKS.filter((x) => x.testament === testament);
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of refs ?? []) {
      const n = unpackRef(p).bookNum;
      m.set(n, (m.get(n) ?? 0) + 1);
    }
    return m;
  }, [refs]);
  const inBook = b ? (counts.get(b.num) ?? 0) : 0;
  const label = card.strongsLabel;
  const max = Math.max(1, ...counts.values());
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  const W = 156;
  const H = 18;
  const bw = W / books.length;
  return (
    <div class="card__foot">
      <div class="dist">
        {conc?.status === 'ready' && refs ? (
          <>
            <span class="lbl">
              <b>{refs.length.toLocaleString('en-US')}</b> {refs.length === 1 ? 'verse' : 'verses'}
              {b && inBook > 0 && (
                <>
                  {' · '}
                  <span class="lbl__in">
                    <b>{inBook.toLocaleString('en-US')}</b> in {b.name}
                  </span>
                </>
              )}
            </span>
            {refs.length > 0 && (
              <span class="spark">
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`Occurrences by book${top ? `; most in ${BOOKS[top[0] - 1]?.name} (${top[1]})` : ''}`}
                >
                  <rect class="base" x="0" y={H - 1} width={W} height="1" />
                  {books.map((bk, i) => {
                    const n = counts.get(bk.num) ?? 0;
                    if (!n) return null;
                    const h = Math.max(2, Math.round((n / max) * (H - 2)));
                    return (
                      <rect key={bk.id} class={`bar${bk.num === b?.num ? ' here' : ''}`} x={i * bw + 0.4} y={H - 1 - h} width={Math.max(1, bw - 0.8)} height={h}>
                        <title>
                          {bk.name}: {n}
                        </title>
                      </rect>
                    );
                  })}
                </svg>
                <span class="axis" aria-hidden="true">
                  <span>{books[0].short}</span>
                  <span>{books[books.length - 1].short}</span>
                </span>
              </span>
            )}
          </>
        ) : conc?.status === 'error' ? (
          <span class="lbl">Occurrences unavailable</span>
        ) : (
          <>
            <span class="skeleton" style={{ width: '120px', margin: '2px 0 6px' }} />
            <span class="skeleton" style={{ width: '156px', height: '18px', margin: 0 }} />
          </>
        )}
      </div>
      <div class="card__actions">
        <a
          class="card__study"
          href={`#/word/${card.strongs}`}
          onPointerEnter={() => preloadPage('word')}
          onFocus={() => preloadPage('word')}
          onClick={() => closeWord()}
        >
          Word study <UiIcon name="arrow" />
        </a>
        <button type="button" class="btn-all" onClick={() => openSearch(label)} title={`Search every verse with ${label}`}>
          See all occurrences <Icon name="arrow" />
        </button>
      </div>
    </div>
  );
}

