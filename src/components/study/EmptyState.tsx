/**
 * Empty states that teach the feature: a miniature of the reader (a verse number and a verse, drawn
 * the way the reader draws a highlight / note / bookmark) and one sentence on how to make one.
 * "Tap" on touch screens, "Click" with a mouse.
 */
import type { ComponentChildren } from 'preact';
import { passage, translations } from '../../app/state';
import { formatChapter, refToHash } from '../../lib/reference';
import { useMedia } from '../common/hooks';

export type EmptyKind = 'highlights' | 'notes' | 'bookmarks';

const DEMO = { v: 16, text: 'For God so loved the world, that he gave his only begotten Son…' };

function Demo({ kind }: { kind: EmptyKind }) {
  return (
    <div class="ms-demo" aria-hidden="true">
      <p class="ms-demo__line">
        <span class="ms-demo__gutter">
          {kind !== 'highlights' && (kind === 'bookmarks' ? <i class="ms-vm ms-vm--bm" /> : <i class="ms-vm ms-vm--note" />)}
          <span class="ms-demo__vn">
            {DEMO.v}
            <span class="ms-demo__tap" />
          </span>
        </span>
        {kind === 'highlights' ? (
          <span class="ms-c ms-hltext" data-c="yellow">
            {DEMO.text}
          </span>
        ) : (
          <span>{DEMO.text}</span>
        )}
      </p>
      {kind === 'notes' && <p class="ms-demo__note">Gave — the love is shown in giving.</p>}
    </div>
  );
}

export function EmptyState({ kind, children }: { kind: EmptyKind; children?: ComponentChildren }) {
  const coarse = useMedia('(pointer: coarse)');
  const verb = coarse ? 'Tap' : 'Click';
  const { tr, ref } = passage.value;
  const abbr = translations.value.find((t) => t.id === tr)?.abbr ?? tr;
  const where = formatChapter(ref.book, ref.chapter);
  const title =
    kind === 'highlights'
      ? `${verb} a verse number to highlight it`
      : kind === 'notes'
        ? `${verb} a verse number to write a note`
        : `${verb} a verse number to bookmark it`;
  const how =
    kind === 'highlights'
      ? 'While reading, the small number before each verse opens its actions. Pick one of five colours — each has its own underline, too — and it appears here, grouped by book.'
      : kind === 'notes'
        ? 'The small number before each verse opens its actions; write in Note and it saves as you type. Your notes appear here, searchable.'
        : 'The small number before each verse opens its actions; choose Bookmark to keep your place. Bookmarks appear here in Bible order.';
  return (
    <div class="ms-empty">
      <Demo kind={kind} />
      <h2 class="ms-empty__title">{title}</h2>
      <p class="ms-empty__how">{how}</p>
      <p class="ms-empty__acts">
        <a class="ms-btn ms-btn--primary" href={refToHash(tr, { book: ref.book, chapter: ref.chapter })}>
          Read {where} ({abbr})
        </a>
        {children}
      </p>
    </div>
  );
}
