/**
 * #/person/{id} and #/place/{id} — a person, place or group from STEPBible TIPNR (src/lib/names.ts).
 *
 * Contract (kept): default export, props `EntityPageProps`.
 *   kind — 'person' | 'place' (from the route; a group / other entity arrives as 'person' and is
 *          shown as what it is).
 *   id   — entity id, lower-case ("p0685", "l0123", "g0007"); unknown ids show a not-found state.
 *
 * Sections: the original names (Hebrew / Greek, each with pronunciation and its Strong's word study),
 * family (people) or region and coordinates (places — no map in v1, see docs/ROADMAP.md v1.1),
 * the TIPNR summary with clickable references, and every verse that mentions them, previewed in
 * the translation being read. "Family tree" goes to #/lineage/{id}.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { preloadPage } from '../app/pages';
import { passage } from '../app/state';
import { PageLayout } from '../components/layout/PageLayout';
import { EntityRefs } from '../components/names/EntityRefs';
import type { RelativeGroup } from '../components/names/model';
import { KIND_LABEL, formatCoords, linkifyRefs, lineageHash, relativeGroups, shortStrongs, splitSummary } from '../components/names/model';
import { EntityGlyph, FamilyRows, TREE_GLYPH, useNameIndex } from '../components/names/parts';
import { RichText } from '../components/names/RichText';
import { SpeakButton } from '../components/word/SpeakButton';
import { parseDefinition } from '../components/word/definition';
import { transliterate } from '../lib/greek';
import { loadEntity } from '../lib/names';
import { formatReference, refToHash } from '../lib/reference';
import { getBookByNum } from '../lib/books';
import type { NameEntity } from '../lib/types';
import { unpackRef } from '../lib/types';
import '../components/names/card.css';
import '../components/names/entity.css';

export interface EntityPageProps {
  kind: 'person' | 'place';
  id: string;
}

const EYEBROW: Record<NameEntity['kind'], string> = {
  person: 'People of the Bible',
  place: 'Places of the Bible',
  group: 'Peoples of the Bible',
  other: 'Names in the Bible',
};

type Load = { status: 'loading' } | { status: 'ready'; entity: NameEntity } | { status: 'missing' } | { status: 'error' };

export default function EntityPage({ kind, id }: EntityPageProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let off = false;
    setLoad({ status: 'loading' });
    loadEntity(id).then(
      (entity) => !off && setLoad(entity ? { status: 'ready', entity } : { status: 'missing' }),
      () => !off && setLoad({ status: 'error' }),
    );
    return () => {
      off = true;
    };
  }, [id, attempt]);

  if (load.status === 'loading') {
    return (
      <PageLayout eyebrow={kind === 'place' ? EYEBROW.place : EYEBROW.person} title={<span class="skeleton ent-skel-title" />} docTitle="Loading" busy>
        <div class="ent-skel">
          <span class="skeleton" style={{ width: '70%' }} />
          <span class="skeleton" style={{ width: '90%' }} />
          <span class="skeleton" style={{ width: '60%' }} />
        </div>
      </PageLayout>
    );
  }
  if (load.status === 'missing' || load.status === 'error') {
    const missing = load.status === 'missing';
    return (
      <PageLayout eyebrow={kind === 'place' ? EYEBROW.place : EYEBROW.person} title={missing ? 'Not found' : 'Didn’t load'} docTitle={missing ? 'Not found' : 'Didn’t load'}>
        <div class="notice" role="alert">
          <div>
            <p class="notice__title">{missing ? `There is no ${kind} with the id “${id}”.` : 'This page’s data didn’t load.'}</p>
            <p>{missing ? 'The link may be out of date. Try searching for the name instead.' : navigator.onLine === false ? 'You seem to be offline.' : 'Check your connection and try again.'}</p>
            {!missing && (
              <div class="notice__actions">
                <button type="button" class="btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      </PageLayout>
    );
  }
  return <EntityView entity={load.entity} />;
}

function EntityView({ entity }: { entity: NameEntity }) {
  const tr = passage.value.tr;
  const kind = entity.kind;
  const index = useNameIndex(true);
  const groups: RelativeGroup[] = useMemo(() => (index ? relativeGroups(entity, (x) => index.get(x), { siblings: true }) : []), [entity, index]);
  const summary = useMemo(() => {
    const s = splitSummary(parseDefinition(entity.summary || ''));
    return { record: s.record.map(linkifyRefs), paragraphs: s.paragraphs.map(linkifyRefs) };
  }, [entity]);
  const hasFamily = kind === 'person' && [entity.parents, entity.children, entity.partners, entity.siblings].some((l) => (l?.length ?? 0) > 0);
  const first = entity.refs[0];
  const firstRef = first ? toRef(first) : null;

  return (
    <PageLayout
      eyebrow={
        <>
          {EYEBROW[kind]}
          {entity.group ? ` · ${entity.group}` : ''}
        </>
      }
      title={entity.name}
      docTitle={`${entity.name} (${KIND_LABEL[kind].toLowerCase()})`}
      lede={entity.brief ? <p>{entity.brief}</p> : undefined}
      class="ent-page"
    >
      <div class="ent-facts">
        <span class={`ent-facts__kind is-${kind}`}>
          <EntityGlyph kind={kind} />
          {KIND_LABEL[kind]}
        </span>
        <span>{entity.refs.length.toLocaleString('en-US')} {entity.refs.length === 1 ? 'verse' : 'verses'}</span>
        {firstRef && (
          <span>
            First mentioned <a href={refToHash(tr, firstRef)}>{formatReference(firstRef, 'short')}</a>
          </span>
        )}
        {hasFamily && (
          <a class="ent-link ent-facts__tree" href={lineageHash(entity.id)} onPointerEnter={() => preloadPage('lineage')} onFocus={() => preloadPage('lineage')}>
            {TREE_GLYPH} Family tree
          </a>
        )}
      </div>

      {entity.forms.length > 0 && <Forms entity={entity} />}

      {kind === 'place' && (entity.group || entity.coords) && (
        <section aria-labelledby="ent-where">
          <h2 class="sec" id="ent-where">
            Where
          </h2>
          <dl class="ent-where">
            {entity.group && (
              <>
                <dt>Region</dt>
                <dd>{entity.group}</dd>
              </>
            )}
            {entity.coords && (
              <>
                <dt>Coordinates</dt>
                <dd class="tnum">{formatCoords(entity.coords)}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {groups.length > 0 && (
        <section aria-labelledby="ent-family">
          <h2 class="sec" id="ent-family">
            {kind === 'person' ? 'Family' : 'Founders'}
          </h2>
          <FamilyRows groups={groups} moreHref={lineageHash(entity.id)} class="ent-fam--page" />
        </section>
      )}

      {(summary.record.length > 0 || summary.paragraphs.length > 0) && (
        <section aria-labelledby="ent-about">
          <h2 class="sec" id="ent-about">
            About
          </h2>
          {summary.record.length > 0 && (
            <p class="ent-record">
              {summary.record.map((line, i) => (
                <span key={i} class="ent-record__line">
                  <RichText nodes={line} tr={tr} />
                </span>
              ))}
            </p>
          )}
          <div class="ent-prose">
            {summary.paragraphs.map((p, i) => (
              <p key={i}>
                <RichText nodes={p} tr={tr} />
              </p>
            ))}
          </div>
          <p class="ent-src">Summary from STEPBible TIPNR (CC BY 4.0).</p>
        </section>
      )}

      {entity.refs.length > 0 && (
        <section aria-labelledby="ent-mentions">
          <h2 class="sec" id="ent-mentions">
            <span>Mentions</span>
            <span class="sec__ref">{entity.refs.length.toLocaleString('en-US')} verses</span>
          </h2>
          <EntityRefs entity={entity} tr={tr} />
        </section>
      )}
    </PageLayout>
  );
}

function toRef(packed: number) {
  const { bookNum, chapter, verse } = unpackRef(packed);
  const b = getBookByNum(bookNum);
  return b ? { book: b.id, chapter, verse } : null;
}

function Forms({ entity }: { entity: NameEntity }) {
  const hebrew = entity.forms.filter((f) => f[0].startsWith('H'));
  const greek = entity.forms.filter((f) => f[0].startsWith('G'));
  const cols = [
    { label: 'Hebrew', lang: 'hbo' as const, forms: hebrew },
    { label: 'Greek', lang: 'grc' as const, forms: greek },
  ].filter((c) => c.forms.length);
  return (
    <section aria-labelledby="ent-names">
      <h2 class="sec" id="ent-names">
        Names in the original
      </h2>
      <div class={`ent-forms${cols.length > 1 ? ' is-two' : ''}`}>
        {cols.map((c) => (
          <div class="ent-forms__col" key={c.label}>
            <h3 class="eyebrow ent-forms__lang">{c.label}</h3>
            <ul class="ent-forms__list">
              {c.forms.map(([sn, script, en]) => {
                const first = script.split(/,\s*/)[0];
                const translit = c.lang === 'grc' ? transliterate(first) : en;
                return (
                  <li class="ent-form" key={`${sn}:${script}`}>
                    <span class="ent-form__orig" lang={c.lang === 'grc' ? 'grc' : 'he'} dir={c.lang === 'grc' ? undefined : 'rtl'}>
                      {script}
                    </span>
                    <SpeakButton text={first} lang={c.lang} translit={translit} size="sm" />
                    <span class="ent-form__en">
                      {en}
                      {c.lang === 'grc' && <span class="ent-form__tl"> · {translit}</span>}
                    </span>
                    <a class="ent-form__sn" href={`#/word/${sn}`} onPointerEnter={() => preloadPage('word')} onFocus={() => preloadPage('word')} aria-label={`Word study ${shortStrongs(sn)} (${en})`}>
                      {shortStrongs(sn)}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
