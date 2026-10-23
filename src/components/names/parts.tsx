/**
 * Small shared pieces of the people & places UI: the kind glyph (person / place / people group /
 * other name), family chips and the "loaded once" hooks over src/lib/names.ts.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { closeWord } from '../../app/state';
import type { NameIndexEntry } from '../../lib/names';
import { loadNameIndex, nameIndexMap } from '../../lib/names';
import type { EntityKind, NameIndex } from '../../lib/types';
import type { RelativeGroup } from './model';
import { entityHash, lineageHash } from './model';

const GLYPHS: Record<EntityKind, JSX.Element> = {
  person: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 19.5c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" />
    </>
  ),
  place: (
    <>
      <path d="M12 20.5s-6.2-5.6-6.2-10.6a6.2 6.2 0 0 1 12.4 0c0 5-6.2 10.6-6.2 10.6z" />
      <circle cx="12" cy="9.9" r="2.3" />
    </>
  ),
  group: (
    <>
      <circle cx="9" cy="8.6" r="3" />
      <circle cx="16.4" cy="9.6" r="2.4" />
      <path d="M3.6 19c.7-3 2.8-4.7 5.4-4.7s4.7 1.7 5.4 4.7M14.6 14.6c2.6-.4 4.9.9 5.8 3.9" />
    </>
  ),
  other: (
    <>
      <path d="M4.5 12.6V5.2a.7.7 0 0 1 .7-.7h7.4l7 7-8.1 8.1z" />
      <circle cx="8.6" cy="8.6" r="1.3" />
    </>
  ),
};

/** Decorative kind icon (the surrounding text always names the kind). */
export function EntityGlyph({ kind, class: cls = '' }: { kind: EntityKind; class?: string }) {
  return (
    <svg class={`icon ${cls}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {GLYPHS[kind] ?? GLYPHS.other}
    </svg>
  );
}

export const TREE_GLYPH = (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="9" y="3.5" width="6" height="4.5" rx="1" />
    <rect x="3.5" y="16" width="6" height="4.5" rx="1" />
    <rect x="14.5" y="16" width="6" height="4.5" rx="1" />
    <path d="M12 8v4M6.5 16v-2.2a1.8 1.8 0 0 1 1.8-1.8h7.4a1.8 1.8 0 0 1 1.8 1.8V16" />
  </svg>
);

export const ARROW_GLYPH = (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" />
  </svg>
);

/* ------------------------------------------------------------------------ */
/* Data hooks                                                                */
/* ------------------------------------------------------------------------ */

export interface NameIndexData {
  list: NameIndex;
  map: Map<string, NameIndexEntry>;
}

let indexData: NameIndexData | null = null;

/** The name index (raw rows for searchNames + an id -> entry map), loaded once and shared with search; null until loaded. */
export function useNameIndexData(enabled = true): NameIndexData | null {
  const [data, setData] = useState(indexData);
  useEffect(() => {
    if (!enabled || data) return;
    let off = false;
    loadNameIndex().then(
      (list) => {
        indexData = { list, map: nameIndexMap(list) };
        if (!off) setData(indexData);
      },
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [enabled]);
  return data;
}

/** The name index as an id -> entry map; null until loaded. */
export function useNameIndex(enabled = true): Map<string, NameIndexEntry> | null {
  return useNameIndexData(enabled)?.map ?? null;
}

/** Test hook: forget the module-level index cache. */
export function resetNamesUiCache(): void {
  indexData = null;
}

/* ------------------------------------------------------------------------ */
/* Family chips                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Family as labelled chip rows ("Son of [Terah]", "Father of [Ishmael] [Isaac] [+6 more]").
 * `inCard`: links close the word card when followed.
 */
export function FamilyRows({ groups, moreHref, inCard = false, class: cls = '' }: { groups: RelativeGroup[]; moreHref: string; inCard?: boolean; class?: string }) {
  if (!groups.length) return null;
  const onNav = inCard ? () => closeWord() : undefined;
  return (
    <dl class={`ent-fam ${cls}`.trim()}>
      {groups.map((g) => (
        <div class="ent-fam__row" key={g.rel}>
          <dt>{g.label}</dt>
          <dd>
            <ul class="ent-chips">
              {g.people.map((p) => (
                <li key={p.id}>
                  <a class="ent-chip" href={entityHash(p.id, p.kind)} title={p.brief || undefined} onClick={onNav}>
                    {p.name}
                  </a>
                </li>
              ))}
              {g.more > 0 && (
                <li>
                  <a class="ent-chip ent-chip--more" href={moreHref} onClick={onNav}>
                    +{g.more} more
                  </a>
                </li>
              )}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export { entityHash, lineageHash };
