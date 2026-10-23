/**
 * People & places inside the word card (docs/ROADMAP.md v1: "people & places cards").
 *
 * When the hovered / tapped unit's original word(s) name a person, place or group (STEPBible TIPNR
 * via src/lib/names.ts: loadNameChapter + entityForWord), a compact block shows which one it is —
 * kind icon, name (with the form actually used: "Abram", "Jacob"), the one-line brief, for people
 * the family as chips (son of · husband of · father of, "+N more"), for places the region and
 * mentions — and links to "About …" (#/person|place/{id}) and "Family tree" (#/lineage/{id}).
 * The point is disambiguation: Joseph in Gen 37 and Joseph in Matt 1:16 are different people.
 * It stays light so the Greek / Hebrew above it remains the card's subject. No map in v1 (v1.1).
 *
 * Props:
 *   book, chapter — the chapter on screen (USFM id, English chapter number).
 *   origIndices   — the indices into OrigChapter.words that the English word links to (Unit.links;
 *                   [] for supplied words and KJV lexicon-only words). Nothing renders when none of
 *                   them names a person or place.
 * Rendered between the facts and the definition, in both the popover and the bottom sheet; links
 * close the card (closeWord()).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { closeWord } from '../../app/state';
import { preloadPage } from '../../app/pages';
import { OW, type NameEntity, type OrigChapter } from '../../lib/types';
import { loadOrig } from '../../lib/data';
import { entityForWord, loadEntity, loadNameChapter, nameForWord } from '../../lib/names';
import { KIND_LABEL, entityHash, lineageHash, namesakeNote, relativeGroups } from '../names/model';
import { useMedia } from '../common/hooks';
import { ARROW_GLYPH, EntityGlyph, FamilyRows, TREE_GLYPH, useNameIndex } from '../names/parts';
import '../names/card.css';

export interface EntitySectionProps {
  book: string;
  chapter: number;
  origIndices: number[];
  /** Translation on screen: a word it reads as a common noun ("accuser") names nobody (NameChapter.except). */
  tr?: string;
}

interface Found {
  id: string;
  /** Strong's of the original word that names it (for the form shown: "Abram" vs "Abraham"). */
  strongs: string;
  entity?: NameEntity;
  status: 'loading' | 'ready' | 'error';
}

/** At most two entities per word (e.g. "Jesus Christ" linked as one unit). */
const MAX = 2;

export function EntitySection({ book, chapter, origIndices, tr }: EntitySectionProps) {
  const key = `${tr ?? ''}/${book}/${chapter}:${origIndices.join(',')}`;
  const [state, setState] = useState<{ key: string; found: Found[] } | null>(null);

  useEffect(() => {
    if (!origIndices.length) {
      setState({ key, found: [] });
      return;
    }
    let off = false;
    (async () => {
      let names;
      try {
        names = await loadNameChapter(book, chapter);
      } catch {
        if (!off) setState({ key, found: [] });
        return;
      }
      const ids: { id: string; index: number }[] = [];
      for (const i of origIndices) {
        const id = entityForWord(names, i, tr);
        if (id && !ids.some((x) => x.id === id)) ids.push({ id, index: i });
      }
      if (off) return;
      if (!ids.length) {
        setState({ key, found: [] });
        return;
      }
      const picked = ids.slice(0, MAX);
      setState({ key, found: picked.map(({ id }) => ({ id, strongs: '', status: 'loading' })) });
      let orig: OrigChapter | null = null;
      try {
        orig = await loadOrig(book, chapter);
      } catch {
        orig = null;
      }
      const found = await Promise.all(
        picked.map(async ({ id, index }): Promise<Found> => {
          const strongs = orig?.words[index]?.[OW.strongs] ?? '';
          try {
            const entity = await loadEntity(id);
            return entity ? { id, strongs, entity, status: 'ready' } : { id, strongs, status: 'error' };
          } catch {
            return { id, strongs, status: 'error' };
          }
        }),
      );
      if (!off) setState({ key, found });
    })();
    return () => {
      off = true;
    };
  }, [key]);

  const found = state && state.key === key ? state.found : [];
  const ready = found.filter((f) => f.status === 'ready' && f.entity);
  const loading = found.some((f) => f.status === 'loading');
  const needIndex = ready.some((f) => f.entity!.kind === 'person' || (f.entity!.parents?.length ?? 0) > 0);
  const index = useNameIndex(ready.length > 0);

  // The popover re-places itself whenever its size changes (WordCard observes it), so this block
  // can grow after loading without the card covering its word or running off the screen.
  const boxRef = useRef<HTMLDivElement>(null);

  if (!found.length) return null;
  if (!ready.length) {
    if (!loading) return null;
    return (
      <div class="ent-card ent-card--loading" ref={boxRef} aria-busy="true">
        <span class="skeleton" style={{ width: '46%' }} />
        <span class="skeleton" style={{ width: '82%' }} />
      </div>
    );
  }
  return (
    <div class="ent-cards" ref={boxRef}>
      {ready.map((f) => (
        <EntityBlock key={f.id} entity={f.entity!} strongs={f.strongs} index={needIndex ? index : null} />
      ))}
    </div>
  );
}

function EntityBlock({ entity, strongs, index }: { entity: NameEntity; strongs: string; index: ReturnType<typeof useNameIndex> }) {
  const shown = nameForWord(entity, strongs);
  const kind = entity.kind;
  const lookup = (id: string) => index?.get(id);
  // phones get fewer names per relation so the family stays a couple of lines under the Greek / Hebrew
  const narrow = useMedia('(max-width: 479.98px)');
  const groups = useMemo(
    () => (index && kind === 'person' ? relativeGroups(entity, lookup, { limit: { parent: 2, partner: 2, child: narrow ? 2 : 3 } }) : []),
    [entity, index, narrow],
  );
  const note = useMemo(() => (index ? namesakeNote(entity, index.values()) : null), [entity, index]);
  const hasFamily = kind === 'person' && [entity.parents, entity.children, entity.partners, entity.siblings].some((l) => (l?.length ?? 0) > 0);
  const label = KIND_LABEL[kind];
  const headId = `ent-${entity.id}`;
  const meta = [kind === 'place' || kind === 'group' ? entity.group : '', note, kind !== 'person' ? `${entity.refs.length.toLocaleString('en-US')} ${entity.refs.length === 1 ? 'verse' : 'verses'}` : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <div class={`ent-card is-${kind}`} role="group" aria-labelledby={headId}>
      <div class="ent-card__head">
        <span class={`ent-card__icon is-${kind}`}>
          <EntityGlyph kind={kind} />
        </span>
        <div class="ent-card__id">
          <p class="ent-card__name" id={headId}>
            <span class="sr-only">{label}: </span>
            <b>{shown}</b>
            {shown !== entity.name && <span class="ent-card__aka"> ({entity.name})</span>}
          </p>
          {entity.brief && <p class="ent-card__brief">{entity.brief}</p>}
        </div>
        <span class="ent-card__kind" aria-hidden="true">
          {label}
        </span>
      </div>
      {meta && <p class="ent-card__meta">{meta}</p>}
      {groups.length > 0 && <FamilyRows groups={groups} moreHref={lineageHash(entity.id)} inCard class="ent-card__fam" />}
      <p class="ent-card__links">
        <a
          class="ent-link"
          href={entityHash(entity.id, kind)}
          onClick={() => closeWord()}
          onPointerEnter={() => preloadPage('entity')}
          onFocus={() => preloadPage('entity')}
        >
          About {entity.name} {ARROW_GLYPH}
        </a>
        {hasFamily && (
          <a
            class="ent-link"
            href={lineageHash(entity.id)}
            onClick={() => closeWord()}
            onPointerEnter={() => preloadPage('lineage')}
            onFocus={() => preloadPage('lineage')}
          >
            {TREE_GLYPH} Family tree
          </a>
        )}
      </p>
    </div>
  );
}
