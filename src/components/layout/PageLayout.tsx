/**
 * Shared layout for full pages (word study, person / place, lineage, compare, my study, about):
 * the Scholar chapter-head (eyebrow, title, rule, optional lede) over one reading column, with a
 * "Back to reading" link, the document title, and scroll-to-top on open.
 *
 *   <PageLayout eyebrow="Word study · Greek" title={<span lang="grc">λόγος</span>} docTitle="λόγος (G3056)"
 *               lede="…" wide aside={<MyRail/>}>
 *     …sections…
 *   </PageLayout>
 *
 * - `title` is the page's only <h1>; sections inside should start at <h2> (class "sec" for the
 *   Scholar hairline heading).
 * - `wide` widens the column (compare view, lineage tree); `aside` adds a right-hand rail on
 *   desktop (it stacks below the content on narrow screens) — an <aside> landmark with `asideLabel`.
 * - `busy` sets aria-busy on the content while data loads.
 */
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { passage } from '../../app/state';
import { refToHash } from '../../lib/reference';
import './layout.css';

export const DEFAULT_DOC_TITLE = 'Rootword — Read the Bible with Greek & Hebrew';

/** Set document.title while mounted ("… — Rootword"); restores the default on unmount. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} — Rootword`;
    return () => {
      document.title = DEFAULT_DOC_TITLE;
    };
  }, [title]);
}

export interface PageLayoutProps {
  eyebrow?: ComponentChildren;
  title: ComponentChildren;
  /** Plain-text title for document.title (defaults to `title` when it is a string). */
  docTitle?: string;
  lede?: ComponentChildren;
  /** Wider content column (compare, lineage). */
  wide?: boolean;
  /** Right-hand rail (desktop) / below the content (narrow). */
  aside?: ComponentChildren;
  asideLabel?: string;
  busy?: boolean;
  /** Extra class on the page root. */
  class?: string;
  /** Hide the "Back to reading" link. */
  noBack?: boolean;
  children?: ComponentChildren;
}

export function BackToReading() {
  const { tr, ref } = passage.value;
  return (
    <p class="page-back">
      <a href={refToHash(tr, { book: ref.book, chapter: ref.chapter })}>← Back to reading</a>
    </p>
  );
}

export function PageLayout(p: PageLayoutProps) {
  useDocumentTitle(p.docTitle ?? (typeof p.title === 'string' ? p.title : null));
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const cls = ['page', 'page--doc', p.wide ? 'page--wide' : '', p.aside ? 'page--aside' : '', p.class ?? ''].filter(Boolean).join(' ');
  return (
    <div class={cls}>
      <article class="doc" aria-labelledby="page-title" aria-busy={p.busy ? 'true' : undefined}>
        <header class="ch-head">
          {p.eyebrow && <p class="eyebrow">{p.eyebrow}</p>}
          <h1 class="ch-title doc__title" id="page-title" tabIndex={-1}>
            {p.title}
          </h1>
          <span class="ch-rule" aria-hidden="true" />
          {p.lede && <div class="doc__lede">{p.lede}</div>}
          {!p.noBack && <BackToReading />}
        </header>
        {p.children}
      </article>
      {p.aside && (
        <aside class="rail doc__aside" aria-label={p.asideLabel ?? 'More'}>
          {p.aside}
        </aside>
      )}
    </div>
  );
}

/** Placeholder body used by stub pages until their feature lands. */
export function ComingSoon({ children }: { children: ComponentChildren }) {
  return (
    <section class="doc__soon">
      <p>{children}</p>
    </section>
  );
}
