/**
 * A verse's cross references as a list of links: formatted reference, a vote-strength meter (with a
 * text equivalent) and a one-line preview of the target in the translation being read.
 *
 *   variant "sheet": grouped Old / New Testament, the strongest `limit` first, "Show N more" toggles
 *                    the rest (a disclosure button that keeps focus).
 *   variant "rail":  flat and compact (desktop rails); `onMore` opens the full list elsewhere.
 *
 * Each link's href is the real reading route (new tab / copy link work); a plain click goes through
 * followXref() (feedback, verse-sheet close, back trail).
 */
import { useState } from 'preact/hooks';
import type { VerseRef, XrefTarget } from '../../lib/types';
import { formatXrefTarget, xrefHash, xrefKey } from '../../lib/xrefs';
import { Typeset } from '../common/Typeset';
import { groupXrefs, votesLabel, xrefStrength } from './model';
import { onXrefClick } from './navigate';
import { usePreviews } from './previews';
import type { PreviewView } from './previews';
import './xrefs.css';

/** Three bars, filled up to the level; the words are for screen readers (never colour alone). */
export function StrengthMeter({ votes }: { votes: number }) {
  const s = xrefStrength(votes);
  return (
    <span class={`xr-str xr-str--${s.level}`} title={`${votesLabel(votes)} at OpenBible.info`}>
      <span class="xr-str__bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span class="sr-only">
        , {s.word} link, {votesLabel(votes)}.
      </span>
    </span>
  );
}

function Preview({ p, rail }: { p: PreviewView; rail: boolean }) {
  if (p === undefined) {
    return (
      <span class="xr-link__prev xr-link__prev--loading" aria-hidden="true">
        <span class="skeleton" style={{ width: rail ? '86%' : '72%' }} />
      </span>
    );
  }
  if (p === false) return null;
  if (p === null) return <span class="xr-link__prev xr-link__prev--none">Not in this translation</span>;
  return (
    <span class="xr-link__prev">
      <Typeset text={p} />
    </span>
  );
}

export interface XrefListProps {
  /** Translation the links open in (the one being read). */
  tr: string;
  /** The verse these references belong to (the "Back to …" origin). */
  from: VerseRef;
  /** Targets, strongest first. */
  targets: XrefTarget[];
  variant: 'sheet' | 'rail';
  /** How many to show before "Show more" (sheet) / "All N" (rail). */
  limit: number;
  /** Unique id prefix (list ids for aria-controls). */
  idPrefix: string;
  /** Wait this long before fetching previews (rail: don't fetch every verse scrolled past). */
  previewDelay?: number;
  /** Rail: open the full list (e.g. the verse sheet) instead of expanding in place. */
  onMore?: () => void;
}

export function XrefList({ tr, from, targets, variant, limit, idPrefix, previewDelay = 0, onMore }: XrefListProps) {
  const [expanded, setExpanded] = useState(false);
  const rail = variant === 'rail';
  const shownLimit = expanded ? undefined : limit;
  const display = groupXrefs(targets, rail ? limit : shownLimit);
  const visible = display.groups.flatMap((g) => g.items);
  const previews = usePreviews(tr, visible, previewDelay);
  const style = rail ? 'short' : 'long';
  const listId = `${idPrefix}-list`;

  const item = (t: XrefTarget) => (
    <li key={xrefKey(t)} class="xr-item">
      <a class="xr-link" href={xrefHash(tr, t)} onClick={(e) => onXrefClick(e, { tr, from, target: t })}>
        <span class="xr-link__top">
          <span class="xr-link__ref">{formatXrefTarget(t, style)}</span>
          <StrengthMeter votes={t[2]} />
        </span>
        <Preview p={previews.get(t)} rail={rail} />
      </a>
    </li>
  );

  return (
    <div class={`xr xr--${variant}`}>
      <div id={listId} aria-busy={previews.busy ? 'true' : undefined}>
        {rail ? (
          <ul class="xr-list">{visible.map(item)}</ul>
        ) : (
          display.groups.map((g) => (
            <div class="xr-group" key={g.testament}>
              <h4 class="xr-group__title" id={`${idPrefix}-${g.testament}`}>
                {g.title}
              </h4>
              <ul class="xr-list" aria-labelledby={`${idPrefix}-${g.testament}`}>
                {g.items.map(item)}
              </ul>
            </div>
          ))
        )}
      </div>
      {previews.tr !== tr && <p class="xr-note">Previews from the {previews.tr}.</p>}
      {rail
        ? display.hidden > 0 &&
          onMore && (
            <button type="button" class="xr-more" aria-haspopup="dialog" onClick={onMore}>
              All {display.total} cross references
            </button>
          )
        : targets.length > limit && (
            <button type="button" class="xr-more" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((x) => !x)}>
              {expanded ? 'Show fewer' : `Show ${targets.length - limit} more`}
            </button>
          )}
    </div>
  );
}
