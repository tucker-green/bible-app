/**
 * Word chips linking to other word studies: the Septuagint bridge (with counts and share bars) and
 * related words from Strong's derivation notes. Lemmas / glosses come from the lexicon index
 * (lex/index.json, one shared request) instead of one lexicon chunk per chip.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { preloadPage } from '../../app/pages';
import { loadLexIndex } from '../../lib/data';
import type { WordStudy } from '../../lib/types';
import { lxxBridge } from '../../lib/wordstudy';
import type { LexBrief } from './model';
import { fmt, lexIndexMap, listAnd, lookupBrief, pct, plural, strongsLabel, wordHash } from './model';

let indexMap: Map<string, LexBrief> | null = null;
let indexPromise: Promise<Map<string, LexBrief>> | null = null;

/** Forget the memoised lexicon index (tests). */
export function resetWordChipsCache(): void {
  indexMap = null;
  indexPromise = null;
}

/** The lexicon index as a map, loaded once; null until it arrives (or when it fails). */
export function useLexBriefs(): Map<string, LexBrief> | null {
  const [map, setMap] = useState<Map<string, LexBrief> | null>(indexMap);
  useEffect(() => {
    if (indexMap) return;
    let off = false;
    if (!indexPromise) {
      const p = loadLexIndex().then((ix) => (indexMap = lexIndexMap(ix)));
      indexPromise = p;
      p.catch(() => {
        if (indexPromise === p) indexPromise = null;
      });
    }
    indexPromise.then(
      (m) => !off && setMap(m),
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, []);
  return map;
}

/**
 * Pairings shown up front: at least the top three (and any tied with the third), plus every pairing
 * of 2% or more; the rest are "rare" (often paraphrase or alignment noise) behind a toggle.
 */
export function bridgeCut(counts: number[], sum: number): number {
  if (!counts.length) return 0;
  return Math.min(counts[Math.min(2, counts.length - 1)], Math.ceil(sum * 0.02));
}

const langOf = (id: string) => (id[0] === 'G' ? 'grc' : 'he');

export function WordChip({ id, brief, count, share }: { id: string; brief: LexBrief | undefined; count?: number; share?: number }) {
  const lang = langOf(id);
  return (
    <a class={`ws-chip${count !== undefined ? ' has-count' : ''}`} href={wordHash(id)} onPointerEnter={() => preloadPage('word')} onFocus={() => preloadPage('word')}>
      <span class="ws-chip__top">
        <span class={`ws-chip__lemma ws-${lang}`} lang={lang} dir={lang === 'he' ? 'rtl' : undefined}>
          {brief?.lemma || strongsLabel(id)}
        </span>
        {count !== undefined && (
          <span class="ws-chip__n tnum">
            {fmt(count)}
            <span aria-hidden="true">×</span>
            <span class="sr-only"> times</span>
          </span>
        )}
      </span>
      <span class="ws-chip__sub">
        {brief?.translit && <i class="ws-chip__tl">{brief.translit}</i>}
        {brief?.gloss && <span class="ws-chip__gloss">{brief.gloss}</span>}
        <span class="ws-chip__sn">{strongsLabel(id)}</span>
      </span>
      {share !== undefined && (
        <span class="ws-chip__bar" aria-hidden="true">
          <span style={{ width: `${Math.max(3, share * 100)}%` }} />
        </span>
      )}
    </a>
  );
}

/** Septuagint bridge: the Greek words the LXX uses for a Hebrew word, or the Hebrew words a Greek word renders. */
export function Bridge({ study, word, briefs }: { study: WordStudy; word: ComponentChildren; briefs: Map<string, LexBrief> | null }) {
  const rows = lxxBridge(study);
  const [more, setMore] = useState(false);
  if (!rows.length) return null;
  const sum = rows.reduce((n, r) => n + r.count, 0);
  const main = rows.filter((r) => r.count >= bridgeCut(rows.map((x) => x.count), sum));
  const rare = rows.slice(main.length);
  const hebrew = study.id[0] === 'H';
  const lead = rows[0];
  const leadBrief = lookupBrief(briefs, lead.id);
  const leadWord = (
    <span lang={langOf(lead.id)} dir={langOf(lead.id) === 'he' ? 'rtl' : undefined} class={`ws-${langOf(lead.id)}`}>
      {leadBrief?.lemma ?? strongsLabel(lead.id)}
    </span>
  );
  const listId = `ws-lxx-more-${study.id}`;
  return (
    <div class="ws-bridge">
      <p class="ws-lead">
        {hebrew ? (
          <>
            The Septuagint translators most often rendered {word} with {leadWord}
            {leadBrief?.gloss ? ` (“${leadBrief.gloss}”)` : ''}: {fmt(lead.count)} of {plural(sum, 'aligned place')}, {pct(lead.count, sum)}.
          </>
        ) : (
          <>
            In the Septuagint, {word} renders {leadWord}
            {leadBrief?.gloss ? ` (“${leadBrief.gloss}”)` : ''} {fmt(lead.count)}×
            {rows.length > 1 ? `, and ${plural(rows.length - 1, 'other Hebrew word')}` : ''}.
          </>
        )}
      </p>
      <ul class="ws-chips" aria-label={hebrew ? 'Greek words used for it in the Septuagint' : 'Hebrew words it renders in the Septuagint'}>
        {main.map((r) => (
          <li key={r.id}>
            <WordChip id={r.id} brief={lookupBrief(briefs, r.id)} count={r.count} share={r.share} />
          </li>
        ))}
      </ul>
      {rare.length > 0 && (
        <>
          <button type="button" class="link-btn ws-more" aria-expanded={more} aria-controls={listId} onClick={() => setMore(!more)}>
            {more ? 'Hide the rare pairings' : `${plural(rare.length, 'rare pairing')} (${listAnd([...new Set(rare.map((r) => `${r.count}×`))])})`}
          </button>
          <ul class="ws-chips ws-chips--rare" id={listId} hidden={!more} aria-label="Rare pairings">
            {rare.map((r) => (
              <li key={r.id}>
                <WordChip id={r.id} brief={lookupBrief(briefs, r.id)} count={r.count} />
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="ws-src">
        Septuagint alignment from Macula Hebrew (Clear Bible, CC BY 4.0), counted over the Old Testament. Rare pairings are often paraphrase
        or alignment noise.
      </p>
    </div>
  );
}

export function Related({ ids, briefs }: { ids: string[]; briefs: Map<string, LexBrief> | null }) {
  return (
    <ul class="ws-chips" aria-label="Related words">
      {ids.map((id) => (
        <li key={id}>
          <WordChip id={id} brief={lookupBrief(briefs, id)} />
        </li>
      ))}
    </ul>
  );
}
