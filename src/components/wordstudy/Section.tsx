/**
 * Word-study page sections. On phones (≤ 640px) each section's heading becomes an accordion button
 * (aria-expanded / aria-controls, 44px tall) so the long page can be skimmed; on wider screens the
 * sections are plain Scholar hairline headings and a sticky "On this page" list sits in the rail.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { scrollBehavior } from '../../app/state';
import { useMedia } from '../common/hooks';

export const PHONE_QUERY = '(max-width: 640px)';

export interface SectionProps {
  id: string;
  title: string;
  /** Short note at the right of the heading ("8 forms"). */
  meta?: ComponentChildren;
  /** Starts collapsed on phones. */
  closedOnPhone?: boolean;
  /** Never collapses (the occurrence list). */
  fixed?: boolean;
  /** Ask the section to open (e.g. a link elsewhere on the page jumps here); bump to re-open. */
  openSignal?: number;
  class?: string;
  children: ComponentChildren;
}

export function StudySection({ id, title, meta, closedOnPhone = false, fixed = false, openSignal = 0, class: cls = '', children }: SectionProps) {
  const phone = useMedia(PHONE_QUERY);
  const [open, setOpen] = useState(!closedOnPhone);
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  const accordion = phone && !fixed;
  const shown = !accordion || open;
  const headId = `${id}-h`;
  const bodyId = `${id}-body`;
  return (
    <section id={id} class={`ws-sec ${cls}`.trim()} aria-labelledby={headId} data-ws-sec>
      <h2 class={`sec ws-sec__h${accordion ? ' is-acc' : ''}`} id={headId}>
        {accordion ? (
          <button type="button" class="ws-acc" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
            <span class="ws-acc__t">{title}</span>
            {meta && <span class="sec__ref ws-sec__meta">{meta}</span>}
            <svg class="icon ws-acc__chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M7 10l5 5 5-5" />
            </svg>
          </button>
        ) : (
          <>
            <span>{title}</span>
            {meta && <span class="sec__ref ws-sec__meta">{meta}</span>}
          </>
        )}
      </h2>
      <div class="ws-sec__body" id={bodyId} hidden={!shown}>
        {children}
      </div>
    </section>
  );
}

export interface TocItem {
  id: string;
  title: string;
  n?: string;
}

/** Scroll a section into view below the sticky header and move focus to its heading. */
export function goToSection(id: string): void {
  const sec = document.getElementById(id);
  if (!sec) return;
  sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  const h = document.getElementById(`${id}-h`);
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }
}

/**
 * "On this page" (desktop rail). Hash routing owns the URL fragment, so the entries are buttons that
 * scroll to the section. The section in view is marked aria-current.
 */
export function StudyToc({ items }: { items: TocItem[] }) {
  const [current, setCurrent] = useState(items[0]?.id ?? '');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = items.find((it) => seen.get(it.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: '-80px 0px -55% 0px' },
    );
    for (const it of items) {
      const el = document.getElementById(it.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [items.map((i) => i.id).join(',')]);
  return (
    <nav class="ws-toc" aria-label="Sections of this word study">
      <p class="eyebrow rail__title">On this page</p>
      <ol class="ws-toc__list">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" class="ws-toc__btn" aria-current={current === it.id ? 'true' : undefined} onClick={() => goToSection(it.id)}>
              <span>{it.title}</span>
              {it.n && <span class="ws-toc__n tnum">{it.n}</span>}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
