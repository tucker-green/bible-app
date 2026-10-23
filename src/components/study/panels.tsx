/**
 * The three lists of the My study page — highlights (filter by colour), notes (search, edit in
 * place) and bookmarks — each grouped by book in Bible order, every item with a jump link and the
 * verse text in the translation on screen. Empty states teach how to make one.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { announce, showToast } from '../../app/state';
import {
  bookmarks,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_NAMES,
  HIGHLIGHT_PATTERNS,
  highlights,
  notes,
  setHighlight,
  setNote,
  toggleBookmark,
} from '../../app/study';
import type { Bookmark, HighlightColor, Note } from '../../app/study';
import { feedback } from '../../lib/feedback';
import { refToHash } from '../../lib/reference';
import { useImporter } from './DataTools';
import { EmptyState } from './EmptyState';
import { StudyIcon } from './icons';
import { NoteEditor } from './NoteEditor';
import type { BookGroup, StudyItem } from './model';
import { colorCounts, friendlyDate, groupByBook, markPieces, matchesQuery, plural, queryTerms, studyItems } from './model';
import { Swatch } from './Swatch';
import { VersePreview } from './VersePreview';

export interface PanelProps {
  /** Translation for the verse text and the jump links. */
  tr: string;
  abbr: string;
}

/** After an item disappears, keep keyboard focus nearby: the next item, else the previous, else the panel. */
function focusNear(li: HTMLElement | null): void {
  if (!li) return;
  const all = [...(li.closest('[role="tabpanel"]')?.querySelectorAll<HTMLElement>('.ms-item') ?? [])];
  const i = all.indexOf(li);
  const next = all[i + 1] ?? all[i - 1];
  const panel = li.closest<HTMLElement>('[role="tabpanel"]');
  requestAnimationFrame(() => {
    const target = next?.isConnected ? next.querySelector<HTMLElement>('.ms-item__ref') : null;
    (target ?? panel)?.focus();
  });
}

function Groups<T>({ groups, kind, children }: { groups: BookGroup<T>[]; kind: string; children: (it: StudyItem<T>) => ComponentChildren }) {
  return (
    <div class="ms-groups">
      {groups.map((g) => (
        <section key={g.book} class="ms-book" aria-labelledby={`ms-${kind}-${g.book}`}>
          <h2 class="ms-book__h" id={`ms-${kind}-${g.book}`}>
            <span>{g.name}</span>
            <span class="ms-book__n tnum">{plural(g.items.length, 'verse')}</span>
          </h2>
          <ul class="ms-items">{g.items.map((it) => children(it))}</ul>
        </section>
      ))}
    </div>
  );
}

function ImportLink() {
  const imp = useImporter();
  return (
    <>
      <button type="button" class="ms-btn" onClick={imp.choose}>
        <StudyIcon name="upload" />
        <span>Import a backup</span>
      </button>
      {imp.fileInput}
      {imp.dialog}
      {imp.error && (
        <span class="ms-data__err" role="alert">
          {imp.error}
        </span>
      )}
    </>
  );
}

/* ---- Highlights ------------------------------------------------------------------------------ */

export function HighlightsPanel({ tr, abbr }: PanelProps) {
  const map = highlights.value;
  const [filter, setFilter] = useState<HighlightColor | null>(null);
  const counts = colorCounts(map);
  const total = Object.keys(map).length;
  useEffect(() => {
    if (filter && !counts[filter]) setFilter(null);
  }, [filter, counts[filter ?? 'yellow']]);
  if (!total) return <EmptyState kind="highlights">{<ImportLink />}</EmptyState>;
  const items = studyItems(map, filter ? (_k, c) => c === filter : undefined);
  const pick = (c: HighlightColor | null) => {
    setFilter(c);
    feedback('select');
    announce(c ? `Showing ${plural(counts[c], `${HIGHLIGHT_NAMES[c].toLowerCase()} highlight`)}` : `Showing all ${plural(total, 'highlight')}`);
  };
  const remove = (it: StudyItem<HighlightColor>, e: Event) => {
    const li = (e.currentTarget as HTMLElement).closest<HTMLElement>('.ms-item');
    focusNear(li);
    setHighlight(it.key, null);
    feedback('success');
    showToast(`Highlight removed from ${it.label}`);
  };
  return (
    <>
      <div class="ms-tools">
        <div class="ms-filter" role="group" aria-label="Filter by colour">
          <button type="button" class="ms-chip" aria-pressed={filter === null} onClick={() => pick(null)}>
            <span>All</span>
            <span class="ms-chip__n tnum">{total}</span>
          </button>
          {HIGHLIGHT_COLORS.filter((c) => counts[c] > 0).map((c) => (
            <button key={c} type="button" class="ms-chip" aria-pressed={filter === c} onClick={() => pick(filter === c ? null : c)}>
              <Swatch color={c} size="sm" />
              <span>{HIGHLIGHT_NAMES[c]}</span>
              <span class="ms-chip__n tnum">{counts[c]}</span>
            </button>
          ))}
        </div>
      </div>
      <Groups groups={groupByBook(items)} kind="hl">
        {(it) => (
          <li key={it.key} class="ms-item">
            <div class="ms-item__head">
              <a class="ms-item__ref" href={refToHash(tr, it.ref)}>
                {it.label}
              </a>
              <span class="ms-tag">
                <Swatch color={it.value} size="sm" />
                <span>{HIGHLIGHT_NAMES[it.value]}</span>
                <span class="sr-only">, {HIGHLIGHT_PATTERNS[it.value]} underline</span>
              </span>
              <span class="ms-item__acts">
                <button type="button" class="ms-act" aria-label={`Remove highlight from ${it.label}`} onClick={(e) => remove(it, e)}>
                  <StudyIcon name="erase" />
                  <span>Remove</span>
                </button>
              </span>
            </div>
            <VersePreview tr={tr} abbr={abbr} vkey={it.key} color={it.value} />
          </li>
        )}
      </Groups>
    </>
  );
}

/* ---- Notes ---------------------------------------------------------------------------------- */

function NoteItem({ it, tr, abbr, terms }: { it: StudyItem<Note>; tr: string; abbr: string; terms: string[] }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const li = useRef<HTMLLIElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const keepBtn = useRef<HTMLButtonElement>(null);
  const delBtn = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editBtn.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  useEffect(() => {
    if (confirming) keepBtn.current?.focus();
    else if (wasConfirming.current) delBtn.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const doDelete = () => {
    focusNear(li.current);
    setNote(it.key, null);
    feedback('success');
    showToast(`Note on ${it.label} deleted`);
  };
  const edited = it.value.updated !== it.value.created;
  return (
    <li class={`ms-item ms-item--note${editing ? ' is-editing' : ''}`} ref={li}>
      <div class="ms-item__head">
        <a class="ms-item__ref" href={refToHash(tr, it.ref)}>
          {it.label}
        </a>
        <span class="ms-item__meta">
          {edited ? 'Edited' : 'Written'} {friendlyDate(it.value.updated)}
        </span>
        {!editing && (
          <span class="ms-item__acts">
            {confirming ? (
              <span class="ms-confirm" role="group" aria-label={`Delete the note on ${it.label}?`}>
                <span class="ms-confirm__q">Delete?</span>
                <button type="button" class="ms-act ms-act--danger" onClick={doDelete}>
                  Delete
                </button>
                <button type="button" class="ms-act" ref={keepBtn} onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <>
                <button type="button" class="ms-act" ref={editBtn} aria-label={`Edit note on ${it.label}`} onClick={() => setEditing(true)}>
                  <StudyIcon name="pencil" />
                  <span>Edit</span>
                </button>
                <button type="button" class="ms-act" ref={delBtn} aria-label={`Delete note on ${it.label}`} onClick={() => setConfirming(true)}>
                  <StudyIcon name="trash" />
                  <span>Delete</span>
                </button>
              </>
            )}
          </span>
        )}
      </div>
      {editing ? (
        <NoteEditor
          vkey={it.key}
          refLabel={it.label}
          idBase={`ms-ne-${it.key.replace(/\./g, '-')}`}
          autoFocus
          rows={4}
          onDone={() => setEditing(false)}
          onDeleted={() => focusNear(li.current)}
        />
      ) : (
        <p class="ms-note-text">
          {markPieces(it.value.text, terms).map((p, i) => (typeof p === 'string' ? p : <mark key={i}>{p.mark}</mark>))}
        </p>
      )}
      <VersePreview tr={tr} abbr={abbr} vkey={it.key} quiet />
    </li>
  );
}

export function NotesPanel({ tr, abbr }: PanelProps) {
  const map = notes.value;
  const [q, setQ] = useState('');
  const all = studyItems(map);
  if (!all.length) return <EmptyState kind="notes">{<ImportLink />}</EmptyState>;
  const terms = queryTerms(q);
  const items = terms.length ? all.filter((it) => matchesQuery(terms, it.value.text, it.label)) : all;
  return (
    <>
      <div class="ms-tools">
        <div class="ms-search" role="search">
          <svg class="icon ms-search__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <input
            type="search"
            class="ms-search__input"
            value={q}
            placeholder="Search your notes"
            aria-label="Search your notes"
            aria-describedby="ms-notes-count"
            enterKeyHint="search"
            onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && q) {
                e.preventDefault();
                e.stopPropagation();
                setQ('');
              }
            }}
          />
          {q && (
            <button type="button" class="ms-search__clear" aria-label="Clear search" onClick={() => setQ('')}>
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7 7l10 10M17 7 7 17" />
              </svg>
            </button>
          )}
        </div>
        <p class="ms-tools__count" id="ms-notes-count" aria-live="polite">
          {terms.length ? `${items.length} of ${plural(all.length, 'note')}` : plural(all.length, 'note')}
        </p>
      </div>
      {items.length ? (
        <Groups groups={groupByBook(items)} kind="nt">
          {(it) => <NoteItem key={it.key} it={it} tr={tr} abbr={abbr} terms={terms} />}
        </Groups>
      ) : (
        <div class="ms-none">
          <p>
            No notes contain “{q.trim()}”.{' '}
            <button type="button" class="link-btn" onClick={() => setQ('')}>
              Clear the search
            </button>
          </p>
        </div>
      )}
    </>
  );
}

/* ---- Bookmarks ------------------------------------------------------------------------------ */

export function BookmarksPanel({ tr, abbr }: PanelProps) {
  const map = bookmarks.value;
  const all = studyItems<Bookmark>(map);
  if (!all.length) return <EmptyState kind="bookmarks">{<ImportLink />}</EmptyState>;
  const remove = (it: StudyItem<Bookmark>, e: Event) => {
    focusNear((e.currentTarget as HTMLElement).closest<HTMLElement>('.ms-item'));
    toggleBookmark(it.key, it.value.tr);
    feedback('success');
    showToast(`Bookmark on ${it.label} removed`);
  };
  return (
    <Groups groups={groupByBook(all)} kind="bm">
      {(it) => (
        <li key={it.key} class="ms-item">
          <div class="ms-item__head">
            <a class="ms-item__ref" href={refToHash(tr, it.ref)}>
              {it.label}
            </a>
            {it.value.label && <span class="ms-item__label">{it.value.label}</span>}
            <span class="ms-item__meta">
              Saved {friendlyDate(it.value.created)}
              {it.value.tr !== tr ? ` in the ${it.value.tr}` : ''}
            </span>
            <span class="ms-item__acts">
              <button type="button" class="ms-act" aria-label={`Remove bookmark on ${it.label}`} onClick={(e) => remove(it, e)}>
                <StudyIcon name="erase" />
                <span>Remove</span>
              </button>
            </span>
          </div>
          <VersePreview tr={tr} abbr={abbr} vkey={it.key} />
        </li>
      )}
    </Groups>
  );
}
