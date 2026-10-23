/**
 * The family tree as nested lists — the accessible (and printable) alternative to the canvas:
 * ancestors (each person's parents nested under them), brothers and sisters, partners, and
 * descendants (children nested). Every name re-centres the tree on that person.
 */
import type { LineageNode } from '../../lib/names';
import { lineageHash, relationToFocus } from './model';

export function LineageOutline({
  tree,
  briefOf,
  onCentre,
}: {
  tree: LineageNode;
  briefOf: (id: string) => string | undefined;
  /** Re-centre on a person (else the links just navigate). */
  onCentre?: (id: string) => void;
}) {
  const sibs = tree.siblings ?? [];
  return (
    <div class="lt-outline">
      <section class="lt-o__sec" aria-labelledby="lt-o-anc">
        <h3 class="lt-o__h" id="lt-o-anc">
          Ancestors
        </h3>
        {tree.parents.length ? <People nodes={tree.parents} dir="up" focus={tree.name} onCentre={onCentre} /> : <p class="lt-o__none">No parents are recorded for {tree.name}.</p>}
        {tree.moreParents && <p class="lt-o__more">More generations above — raise the depth.</p>}
      </section>
      {sibs.length > 0 && (
        <section class="lt-o__sec" aria-labelledby="lt-o-sib">
          <h3 class="lt-o__h" id="lt-o-sib">
            Brothers &amp; sisters
          </h3>
          <ul class="lt-o__list">
            {sibs.map((s) => (
              <li key={s.id}>
                <Person id={s.id} name={s.name} brief={briefOf(s.id) ?? ''} onCentre={onCentre} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {tree.partners.length > 0 && (
        <section class="lt-o__sec" aria-labelledby="lt-o-par">
          <h3 class="lt-o__h" id="lt-o-par">
            {tree.partners.length === 1 ? 'Partner' : 'Partners'}
          </h3>
          <ul class="lt-o__list">
            {tree.partners.map((s) => (
              <li key={s.id}>
                <Person id={s.id} name={s.name} brief={briefOf(s.id) ?? ''} onCentre={onCentre} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section class="lt-o__sec" aria-labelledby="lt-o-desc">
        <h3 class="lt-o__h" id="lt-o-desc">
          Descendants
        </h3>
        {tree.children.length ? <People nodes={tree.children} dir="down" focus={tree.name} onCentre={onCentre} /> : <p class="lt-o__none">No children are recorded for {tree.name}.</p>}
      </section>
    </div>
  );
}

function People({ nodes, dir, focus, onCentre }: { nodes: LineageNode[]; dir: 'up' | 'down'; focus: string; onCentre?: (id: string) => void }) {
  return (
    <ul class="lt-o__list">
      {nodes.map((n, i) => {
        const next = dir === 'up' ? n.parents : n.children;
        const more = dir === 'up' ? n.moreParents : n.moreChildren;
        return (
          <li key={`${n.id}-${i}`}>
            <Person
              onCentre={onCentre}
              id={n.id}
              name={n.name}
              brief={n.brief}
              rel={`${relationToFocus(n.gen, dir === 'up' ? 'ancestor' : 'descendant')} of ${focus}`}
              note={[n.repeat ? 'also listed above' : '', more ? (dir === 'up' ? 'more ancestors' : 'more descendants') : '', n.partners.length && dir === 'down' ? `m. ${n.partners.map((p) => p.name).join(', ')}` : '']
                .filter(Boolean)
                .join(' · ')}
            />
            {next.length > 0 && !n.repeat && <People nodes={next} dir={dir} focus={focus} onCentre={onCentre} />}
          </li>
        );
      })}
    </ul>
  );
}

function Person({ id, name, brief, rel, note, onCentre }: { id: string; name: string; brief: string; rel?: string; note?: string; onCentre?: (id: string) => void }) {
  return (
    <span class="lt-o__p">
      <a
        href={lineageHash(id)}
        class="lt-o__name"
        onClick={(e) => {
          if (!onCentre) return;
          e.preventDefault();
          onCentre(id);
        }}
      >
        {name}
      </a>
      {rel && <span class="lt-o__rel"> · {rel}</span>}
      {brief && <span class="lt-o__brief"> — {brief}</span>}
      {note && <span class="lt-o__note"> ({note})</span>}
    </span>
  );
}
