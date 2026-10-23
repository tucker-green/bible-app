/**
 * #/lineage/{id} — the family tree explorer, centred on a person (STEPBible TIPNR family graph via
 * src/lib/names.ts: loadFamily + lineageTree / findPath).
 *
 * Contract (kept): default export, props `LineagePageProps`.
 *   id — person entity id, lower-case ("p0685").
 * Optional query in the hash: ?from={id}&to={id} pre-fills and runs "Path between".
 *
 * - Tree view (LineageCanvas): ancestors above, descendants below, partners beside, pan & zoom by
 *   mouse, trackpad, touch and keyboard; tapping a person re-centres with a glide (instant under
 *   reduced motion). Outline view (LineageOutline): the same tree as nested lists.
 * - Depth controls (generations up / down) and the view are remembered per browser.
 * - "Path between" (PathFinder): e.g. Adam → Jesus, Abraham → David.
 *
 * Re-centring changes the route, which remounts this page (src/app/pages.tsx keys it by id); the
 * family graph and a "handoff" (where everyone was on screen) live at module level so the new page
 * renders at once and the boxes glide from their old places.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { preloadPage } from '../app/pages';
import { announce, goToHash } from '../app/state';
import { readJson, writeJson } from '../app/storage';
import { PageLayout } from '../components/layout/PageLayout';
import type { Handoff } from '../components/names/LineageCanvas';
import { LineageCanvas } from '../components/names/LineageCanvas';
import { LineageOutline } from '../components/names/LineageOutline';
import type { PathState } from '../components/names/PathFinder';
import { PathFinder } from '../components/names/PathFinder';
import { layoutLineage } from '../components/names/layout';
import { entityHash, lineageHash } from '../components/names/model';
import { ARROW_GLYPH } from '../components/names/parts';
import { feedback } from '../lib/feedback';
import { familyPerson, isEntityId, lineageTree, loadFamily } from '../lib/names';
import type { FamilyGraph } from '../lib/types';
import '../components/names/card.css';
import '../components/names/lineage.css';

export interface LineagePageProps {
  id: string;
}

interface Prefs {
  up: number;
  down: number;
  view: 'tree' | 'outline';
}

export const UP_RANGE = [1, 12] as const;
export const DOWN_RANGE = [1, 6] as const;
const DEFAULT_PREFS: Prefs = { up: 3, down: 2, view: 'tree' };

function loadPrefs(): Prefs {
  const p = readJson<Partial<Prefs>>('lineage', {});
  const clamp = (n: unknown, [lo, hi]: readonly [number, number], d: number) => (typeof n === 'number' && n >= lo && n <= hi ? Math.round(n) : d);
  return {
    up: clamp(p?.up, UP_RANGE, DEFAULT_PREFS.up),
    down: clamp(p?.down, DOWN_RANGE, DEFAULT_PREFS.down),
    view: p?.view === 'outline' ? 'outline' : 'tree',
  };
}

/* module state that survives the remount on re-centring */
let graphCache: FamilyGraph | null = null;
let pending: { handoff: Handoff | null; scrollY: number; path: PathState | null } | null = null;

/** Test hook. */
export function resetLineageCache(): void {
  graphCache = null;
  pending = null;
}

let recentreTimer: ReturnType<typeof setTimeout> | undefined;
function markRecentre(): void {
  const root = document.documentElement;
  root.classList.add('lt-recentre');
  clearTimeout(recentreTimer);
  recentreTimer = setTimeout(() => root.classList.remove('lt-recentre'), 800);
}

function pathFromHash(): PathState | null {
  const q = (typeof location === 'undefined' ? '' : location.hash).split('?')[1];
  if (!q) return null;
  const p = new URLSearchParams(q);
  const from = (p.get('from') ?? '').toLowerCase();
  const to = (p.get('to') ?? '').toLowerCase();
  return isEntityId(from) && isEntityId(to) ? { from, to } : null;
}

export default function LineagePage({ id }: LineagePageProps) {
  const [graph, setGraph] = useState<FamilyGraph | null>(graphCache);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (graph) return;
    let off = false;
    setFailed(false);
    loadFamily().then(
      (g) => {
        graphCache = g;
        if (!off) setGraph(g);
      },
      () => !off && setFailed(true),
    );
    return () => {
      off = true;
    };
  }, [attempt]);

  if (failed) {
    return (
      <PageLayout eyebrow="Family tree" title="Didn’t load" docTitle="Family tree">
        <div class="notice" role="alert">
          <div>
            <p class="notice__title">The family tree didn’t load.</p>
            <p>{navigator.onLine === false ? 'You seem to be offline.' : 'Check your connection and try again.'}</p>
            <div class="notice__actions">
              <button type="button" class="btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }
  if (!graph) {
    return (
      <PageLayout eyebrow="Family tree" title={<span class="skeleton lt-skel-title" />} docTitle="Family tree" wide busy>
        <div class="lt-skel" />
      </PageLayout>
    );
  }
  const person = familyPerson(graph, id);
  if (!person) {
    return (
      <PageLayout eyebrow="Family tree" title="No family tree" docTitle="Family tree">
        <div class="notice" role="alert">
          <div>
            <p class="notice__title">There is no person with the id “{id}” in the family records.</p>
            <p>
              Family trees exist for people only.{' '}
              {isEntityId(id) && (
                <a href={entityHash(id)}>
                  Open the page for {id} instead
                </a>
              )}
            </p>
          </div>
        </div>
      </PageLayout>
    );
  }
  return <Explorer graph={graph} id={id} />;
}

function Explorer({ graph, id }: { graph: FamilyGraph; id: string }) {
  // what the previous centre left behind (consumed once)
  const [arrival] = useState(() => {
    const p = pending && pending.handoff?.to === id ? pending : pending && !pending.handoff ? pending : null;
    pending = null;
    return p;
  });
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [path, setPath] = useState<PathState>(() => arrival?.path ?? pathFromHash() ?? { from: id, to: '' });
  const person = familyPerson(graph, id)!;
  const briefOf = (x: string) => familyPerson(graph, x)?.brief;

  const tree = useMemo(() => lineageTree(graph, id, { up: prefs.up, down: prefs.down })!, [graph, id, prefs.up, prefs.down]);
  const layout = useMemo(() => layoutLineage(tree, { briefOf }), [tree]);

  useEffect(() => writeJson('lineage', prefs), [prefs]);
  useEffect(() => {
    if (!arrival) return;
    // PageLayout scrolls to the top on mount (its effect ran just before this one): stay where we
    // were, or — coming from the path list — show the tree.
    if (arrival.handoff) window.scrollTo(0, arrival.scrollY);
    else {
      // from the outline or the path list: show the new centre and move focus there
      const h = document.getElementById('lt-tree-h');
      h?.scrollIntoView({ block: 'start' });
      h?.focus({ preventScroll: true });
    }
    announce(`Family tree centred on ${person.name}`);
  }, []);

  const centre = (target: string, handoff: Handoff | null) => {
    feedback('select');
    pending = { handoff, scrollY: window.scrollY, path: path.to ? path : null };
    // the boxes glide to their new places themselves: no page cross-fade on top (lineage.css)
    if (handoff) markRecentre();
    goToHash(lineageHash(target));
  };

  const setDepth = (key: 'up' | 'down', delta: number) => {
    const [lo, hi] = key === 'up' ? UP_RANGE : DOWN_RANGE;
    setPrefs((p) => {
      const v = Math.min(hi, Math.max(lo, p[key] + delta));
      if (v !== p[key]) announce(`${v} ${v === 1 ? 'generation' : 'generations'} ${key === 'up' ? 'up' : 'down'}`);
      return { ...p, [key]: v };
    });
  };

  const counts = useMemo(() => {
    let anc = 0;
    let desc = 0;
    for (const n of layout.nodes) {
      if (n.role === 'ancestor') anc++;
      else if (n.role === 'descendant') desc++;
    }
    return { anc, desc };
  }, [layout]);

  return (
    <PageLayout
      eyebrow="Family tree"
      title={person.name}
      docTitle={`Family tree of ${person.name}`}
      lede={
        <>
          {person.brief && <p>{person.brief}</p>}
          <p class="lt-about">
            <a class="ent-link" href={entityHash(id)} onPointerEnter={() => preloadPage('entity')} onFocus={() => preloadPage('entity')}>
              About {person.name} {ARROW_GLYPH}
            </a>
          </p>
        </>
      }
      wide
      class="lt-page"
    >
      <section aria-labelledby="lt-tree-h">
        <h2 class="sec" id="lt-tree-h" tabIndex={-1}>
          <span>Family of {person.name}</span>
          <span class="sec__ref">
            {counts.anc} {counts.anc === 1 ? 'ancestor' : 'ancestors'} · {counts.desc} {counts.desc === 1 ? 'descendant' : 'descendants'} shown
          </span>
        </h2>
        <div class="lt-bar">
          <div class="lt-seg" role="group" aria-label="View">
            {(['tree', 'outline'] as const).map((v) => (
              <button key={v} type="button" class="lt-seg__btn" aria-pressed={prefs.view === v} onClick={() => setPrefs((p) => ({ ...p, view: v }))}>
                {v === 'tree' ? 'Tree' : 'Outline'}
              </button>
            ))}
          </div>
          <Stepper label="Generations up" short="Up" value={prefs.up} range={UP_RANGE} onStep={(d) => setDepth('up', d)} />
          <Stepper label="Generations down" short="Down" value={prefs.down} range={DOWN_RANGE} onStep={(d) => setDepth('down', d)} />
        </div>
        {prefs.view === 'tree' ? (
          <LineageCanvas layout={layout} title={`Family tree of ${person.name}`} handoff={arrival?.handoff ?? null} onCentre={(n, h) => centre(n.id, h)} />
        ) : (
          <LineageOutline tree={tree} briefOf={briefOf} onCentre={(target) => centre(target, null)} />
        )}
      </section>

      <section aria-labelledby="lt-path-h">
        <h2 class="sec" id="lt-path-h">
          Path between two people
        </h2>
        <p class="lt-path__intro">Follow the line of parents and children that joins two people — from Adam to Jesus, or Abraham to David.</p>
        <PathFinder
          graph={graph}
          initial={path}
          onChange={(s) => {
            setPath(s);
            const hash = `${lineageHash(id)}?from=${s.from}&to=${s.to}`;
            if (location.hash !== hash) history.replaceState(history.state, '', hash);
          }}
          onCentre={(target) => {
            if (target === id) {
              document.getElementById('lt-tree-h')?.scrollIntoView({ block: 'start' });
              return;
            }
            centre(target, null);
          }}
        />
      </section>
    </PageLayout>
  );
}

function Stepper({ label, short, value, range, onStep }: { label: string; short: string; value: number; range: readonly [number, number]; onStep: (d: number) => void }) {
  const id = `lt-step-${short.toLowerCase()}`;
  return (
    <div class="lt-step" role="group" aria-labelledby={id}>
      <span class="lt-step__label" id={id}>
        <span aria-hidden="true">{short}</span>
        <span class="sr-only">{label}</span>
      </span>
      <button type="button" class="lt-step__btn" onClick={() => onStep(-1)} disabled={value <= range[0]} aria-label={`Fewer ${label.toLowerCase()}`}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 12h12" />
        </svg>
      </button>
      <output class="lt-step__val" aria-live="off">
        {value}
      </output>
      <button type="button" class="lt-step__btn" onClick={() => onStep(1)} disabled={value >= range[1]} aria-label={`More ${label.toLowerCase()}`}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 6v12M6 12h12" />
        </svg>
      </button>
    </div>
  );
}
