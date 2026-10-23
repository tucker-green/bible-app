/**
 * Full-page routes (word study, people & places, lineage, compare, my study). Each page module is
 * code-split and loaded on first visit; while it loads a skeleton reserves the page head so nothing
 * jumps. Page modules live in src/pages/ and default-export a component taking the parsed route
 * params (see the props interfaces in each file and src/app/README.md).
 */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ComparePageProps } from '../pages/ComparePage';
import type { EntityPageProps } from '../pages/EntityPage';
import type { LineagePageProps } from '../pages/LineagePage';
import type { WordStudyPageProps } from '../pages/WordStudyPage';
import type { Route } from './router';

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

const loaders = {
  word: (() => import('../pages/WordStudyPage')) as Loader<WordStudyPageProps>,
  entity: (() => import('../pages/EntityPage')) as Loader<EntityPageProps>,
  lineage: (() => import('../pages/LineagePage')) as Loader<LineagePageProps>,
  compare: (() => import('../pages/ComparePage')) as Loader<ComparePageProps>,
  study: (() => import('../pages/MyStudyPage')) as Loader<Record<string, never>>,
};

// Loaded modules, so a revisit renders synchronously (no skeleton flash).
const cache = new Map<unknown, ComponentType<never>>();

function Lazy<P>({ load, props }: { load: Loader<P>; props: P }) {
  const [Comp, setComp] = useState<ComponentType<P> | null>(() => (cache.get(load) as ComponentType<P> | undefined) ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (Comp) return;
    let off = false;
    setFailed(false);
    load().then(
      (m) => {
        cache.set(load, m.default as ComponentType<never>);
        if (!off) setComp(() => m.default);
      },
      () => !off && setFailed(true),
    );
    return () => {
      off = true;
    };
  }, [load, attempt]);
  if (Comp) return <Comp {...(props as P & object)} />;
  if (failed) {
    return (
      <div class="page page--doc">
        <div class="notice" role="alert">
          <div>
            <p class="notice__title">This page didn’t load.</p>
            <p>{navigator.onLine === false ? 'You seem to be offline.' : 'Check your connection and try again.'}</p>
            <div class="notice__actions">
              <button type="button" class="btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div class="page page--doc" aria-busy="true">
      <div class="doc">
        <div class="ch-head">
          <span class="skeleton" style={{ width: '120px', height: '11px' }} />
          <span class="skeleton" style={{ width: '60%', height: '46px', margin: '14px 0 20px' }} />
          <span class="skeleton" style={{ width: '90%' }} />
          <span class="skeleton" style={{ width: '70%' }} />
        </div>
      </div>
    </div>
  );
}

/** Render the page for a page route (null for routes the shell renders itself). */
export function PageRoute({ route }: { route: Route }) {
  switch (route.name) {
    case 'word':
      return <Lazy key={`w${route.id}`} load={loaders.word} props={{ id: route.id }} />;
    case 'person':
    case 'place':
      return <Lazy key={`e${route.id}`} load={loaders.entity} props={{ kind: route.name, id: route.id }} />;
    case 'lineage':
      return <Lazy key={`l${route.id}`} load={loaders.lineage} props={{ id: route.id }} />;
    case 'compare':
      return (
        <Lazy
          key={`c${route.trs.join(',')}/${route.book}/${route.chapter}`}
          load={loaders.compare}
          props={{ trs: route.trs, book: route.book, chapter: route.chapter, verse: route.verse }}
        />
      );
    case 'study':
      return <Lazy load={loaders.study} props={{}} />;
    default:
      return null;
  }
}

/** Warm a page module (e.g. on hover over a "Word study →" link). */
export function preloadPage(name: 'word' | 'entity' | 'lineage' | 'compare' | 'study'): void {
  const load = loaders[name] as Loader<unknown>;
  if (cache.has(load)) return;
  load().then(
    (m) => cache.set(load, m.default as ComponentType<never>),
    () => undefined,
  );
}
