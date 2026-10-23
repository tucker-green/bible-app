/**
 * The word card: the Greek / Hebrew behind an English word, directly below it (or above when there
 * is no room), or as a bottom sheet on narrow / touch screens.
 *
 * Hover / keyboard focus: role="tooltip" (the word points at it with aria-describedby).
 * Pinned (click, tap, Enter): role="dialog"; the sheet form traps focus.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { activeWord, announce, closeWord, openSearch, pinnedWord, settings, translations } from '../../app/state';
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
import { buildCardModel, cardBaseStrongs, cardSummary } from './cardModel';
import { DefText } from './DefText';
import type { DefNode } from './definition';
import { defToText, parseDefinition, splitDefinitionHead } from './definition';
import { computePlacement } from './placement';
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

export function WordCard({ model, controller }: { model: ChapterModel | null; controller: ReaderController }) {
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
  const tr = model?.tr ?? '';
  const trMeta = translations.value.find((t) => t.id === tr) ?? null;

  const lexId = card?.strongs ?? '';
  const lex = useLoad<LexEntry | undefined>(lexId, loadLexEntry, retry);
  const lxxLex = useLoad<LexEntry | undefined>(card?.lxx?.strongs ?? '', loadLexEntry, retry);
  const concId = card ? cardBaseStrongs(card) : '';
  const conc = useLoad<number[]>(concId, loadConcordance, retry);

  const wordKey = card ? `${model?.key}:${card.unitId}` : '';
  useEffect(() => setExpanded(false), [wordKey]);

  // Tell the controller where the card is (pointer travel into it keeps a hover card open).
  useEffect(() => {
    controller.cardEl = cardRef.current;
  });

  // Announce keyboard / touch opens to screen readers.
  useEffect(() => {
    if (!card || !ref || ref.via === 'hover') return;
    announce(cardSummary(card));
  }, [wordKey]);

  // Placement (popover form): below the word, flipped above when needed, clamped to the viewport.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !unit) return;
    if (sheet) {
      el.style.left = '';
      el.style.top = '';
      el.style.maxHeight = '';
      // Keep the tapped word visible above the sheet.
      if (scrolledFor.current !== wordKey) {
        scrolledFor.current = wordKey;
        const anchor = controller.el(unit.id);
        if (anchor) {
          const r = anchor.getBoundingClientRect();
          const sheetTop = window.innerHeight - el.offsetHeight;
          const header = document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0;
          if (r.bottom > sheetTop - 16) window.scrollBy({ top: r.bottom - (sheetTop - 16), behavior: 'smooth' });
          else if (r.top < header + 8) window.scrollBy({ top: r.top - header - 16, behavior: 'smooth' });
        }
      }
      return;
    }
    const anchor = controller.el(unit.id);
    const host = (el.offsetParent as HTMLElement | null) ?? document.body;
    if (!anchor) return;
    el.style.maxHeight = '';
    const rects = [...anchor.getClientRects()].map((r) => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    }));
    const header = document.getElementById('masthead')?.getBoundingClientRect().bottom ?? 0;
    const p = computePlacement({
      rects,
      card: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      topInset: header,
      pinned: isPinned,
    });
    const h = host.getBoundingClientRect();
    el.style.left = `${Math.round(p.left - h.left)}px`;
    el.style.top = `${Math.round(p.top - h.top)}px`;
    el.style.setProperty('--notch-x', `${Math.round(p.notchX)}px`);
    if (Number.isFinite(p.maxHeight)) el.style.maxHeight = `${Math.floor(p.maxHeight)}px`;
    el.classList.toggle('is-above', p.side === 'above');
    if (p.scrollBy > 0 && scrolledFor.current !== wordKey) {
      scrolledFor.current = wordKey;
      window.scrollBy({ top: p.scrollBy, behavior: 'smooth' });
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
        if (!pinnedWord.value && document.activeElement && el?.contains(document.activeElement)) controller.focusUnit(unit!.id);
      }
    };
  }, [wordKey, isPinned, sheet]);

  if (!card || !model) return null;

  const close = (refocus: boolean) => {
    const id = card.unitId;
    const hadFocus = cardRef.current?.contains(document.activeElement);
    closeWord();
    if (refocus || hadFocus) controller.focusUnit(id);
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
  const headId = 'word-card-head';
  const cls = ['word-card', sheet ? 'is-sheet' : 'is-pop', isPinned ? 'is-pinned' : '', card.approx ? 'is-approx' : '', `is-${card.kind}`]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {sheet && isPinned && <div class="word-scrim" aria-hidden="true" onClick={() => close(false)} />}
      <div
        ref={cardRef}
        id="word-card"
        class={cls}
        role={role}
        aria-label={isPinned ? `Word study: ${card.headword || card.english}` : undefined}
        aria-modal={sheet && isPinned ? 'true' : undefined}
        tabIndex={-1}
        data-keep-word
        onPointerEnter={() => controller.cardEnter()}
        onPointerLeave={(e) => (e as PointerEvent).pointerType !== 'touch' && controller.cardLeave()}
        onKeyDown={onKeyDown}
      >
        {!sheet && <span class="card__notch" aria-hidden="true" />}
        {sheet && <SheetHandle onClose={() => close(false)} cardRef={cardRef} />}
        <div class="card__inner">
          <CardTop card={card} pinned={isPinned || sheet} onClose={() => close(true)} />
          {card.kind === 'supplied' ? (
            <SuppliedBody card={card} />
          ) : (
            <>
              <CardHero card={card} lxxGloss={lxxLex?.value?.gloss ?? ''} />
              {card.morphemes.length > 1 && <Morphemes card={card} />}
              <Facts card={card} lex={lex} trMeta={trMeta} />
              {card.note && <p class="card__note">{card.note}</p>}
              {card.approx && <ApproxNote card={card} trMeta={trMeta} />}
              <Definition
                card={card}
                lex={lex}
                expanded={expanded}
                onExpand={() => {
                  setExpanded(true);
                  if (!isPinned) pinnedWord.value = { ...ref!, via: 'click' };
                }}
                onCollapse={() => setExpanded(false)}
                onRetry={() => setRetry((n) => n + 1)}
                tr={tr}
              />
            </>
          )}
        </div>
        {card.kind !== 'supplied' && card.strongs && <CardFoot card={card} conc={conc} book={model.book} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function SheetHandle({ onClose, cardRef }: { onClose: () => void; cardRef: { current: HTMLDivElement | null } }) {
  const start = useRef<number | null>(null);
  return (
    <div
      class="sheet-handle"
      aria-hidden="true"
      onPointerDown={(e) => {
        start.current = e.clientY;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current === null || !cardRef.current) return;
        const dy = Math.max(0, e.clientY - start.current);
        cardRef.current.style.transform = `translateY(${dy}px)`;
      }}
      onPointerUp={(e) => {
        if (start.current === null) return;
        const dy = e.clientY - start.current;
        start.current = null;
        if (cardRef.current) cardRef.current.style.transform = '';
        if (dy > 70) onClose();
      }}
      onPointerCancel={() => {
        start.current = null;
        if (cardRef.current) cardRef.current.style.transform = '';
      }}
    >
      <span />
    </div>
  );
}

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
  const lang = card.lang === 'arc' ? 'arc' : 'hbo';
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
          <HebrewWord card={card} />
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
              <p class="lxx-word" lang="grc">
                {card.lxx.text}
              </p>
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
  const lang = card.lang === 'grc' ? 'grc' : card.lang;
  return (
    <div class="card__hero">
      <p class={`card__orig${lang === 'grc' ? '' : ' hbo'}${card.kind === 'lexicon' ? ' is-tr' : ''}`} lang={lang} dir={lang === 'grc' ? undefined : 'rtl'} id="word-card-head">
        {card.headword || card.strongsLabel || '—'}
      </p>
      {card.translit && <p class="card__translit">{card.translit}</p>}
      <span class="card__hero-pill">
        <StrongsPill id={card.strongs} label={card.strongsLabel} />
      </span>
    </div>
  );
}

function Morphemes({ card }: { card: CardModel }) {
  const lang = card.lang === 'arc' ? 'arc' : 'hbo';
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
            <span class={lang === 'grc' ? 'grc' : 'hbo'} lang={lang} dir={lang === 'grc' ? undefined : 'rtl'}>
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
                {rend.list.map(([w, n], i) => (
                  <span class="r" key={w}>
                    {i > 0 && <span class="sep"> · </span>}
                    <b>{w}</b> <span class="n">{n.toLocaleString('en-US')}</span>
                  </span>
                ))}
                {rend.from !== trMeta?.id && <span class="rend__from"> in the {rend.from}</span>}
              </>
            ) : entry?.kjv ? (
              <span class="rend__kjv">
                {entry.kjv.replace(/\s*\.\s*$/, '')}
                <span class="rend__from"> (KJV)</span>
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
                {i > 0 && <span class="sep"> · </span>}
                <span class={w.lang === 'grc' ? 'grc' : 'hbo'} lang={w.lang} dir={w.lang === 'grc' ? undefined : 'rtl'}>
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
  const conf = card.conf < 1 ? ` (confidence ${Math.round(card.conf * 100)}%)` : '';
  return (
    <p class="card__approx">
      <span class="approx-mark" aria-hidden="true">≈</span>
      <span>
        <b>Approximate link{conf}.</b>{' '}
        {bridged
          ? `The ${trMeta?.abbr ?? 'text'} has no hand-made alignment; this word was matched automatically through the BSB.`
          : 'The alignment marks this link as uncertain.'}
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
  const source = entry.def
    ? card.strongs.startsWith('G')
      ? 'Abbott-Smith via STEPBible'
      : 'BDB (abridged) via STEPBible'
    : 'Strong’s dictionary';
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
                  <b>{inBook.toLocaleString('en-US')}</b> in {b.name}
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
      <button type="button" class="btn-all" onClick={() => openSearch(label)} title={`Search every verse with ${label}`}>
        See all occurrences <Icon name="arrow" />
      </button>
    </div>
  );
}

