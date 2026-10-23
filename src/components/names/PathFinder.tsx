/**
 * "Path between" two people: pick them by name (an ARIA 1.2 combobox over the name index, people
 * only, with the brief to tell namesakes apart), then findPath() walks the family graph and the
 * chain is shown in order — Adam → Seth → … → Jesus. Runs of "Unnamed" links (gaps in TIPNR)
 * collapse into one marked step. Each person in the chain re-centres the tree on them.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { feedback } from '../../lib/feedback';
import type { NameIndexEntry, PathStep } from '../../lib/names';
import { findPath, searchNames } from '../../lib/names';
import type { FamilyGraph } from '../../lib/types';
import { describePath, lineageHash, pathItems } from './model';
import { useNameIndexData } from './parts';

export interface PathState {
  from: string;
  to: string;
}

export const PATH_EXAMPLES: [string, string, string][] = [
  ['p0077', 'p1529', 'Adam → Jesus'],
  ['p0057', 'p0632', 'Abraham → David'],
  ['p1272', 'p1529', 'Jacob → Jesus'],
];

interface Result {
  from: string;
  to: string;
  path: PathStep[] | null;
}

export function PathFinder({
  graph,
  initial,
  onChange,
  onCentre,
}: {
  graph: FamilyGraph;
  initial: PathState;
  /** Called when a path is run (the page mirrors it in the URL and keeps it across re-centring). */
  onChange?: (s: PathState) => void;
  /** Re-centre the tree on a person of the chain. */
  onCentre?: (id: string) => void;
}) {
  const data = useNameIndexData(true);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [result, setResult] = useState<Result | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const run = (f: string, t: string, announceIt = true) => {
    if (!f || !t) return;
    const path = f === t ? [] : findPath(graph, f, t);
    setResult({ from: f, to: t, path });
    onChange?.({ from: f, to: t });
    if (announceIt) feedback(path && path.length ? 'success' : 'error');
  };
  // a path in the link (?from=…&to=…) or carried over from the previous centre runs at once
  useEffect(() => {
    if (initial.from && initial.to) run(initial.from, initial.to, false);
  }, []);

  const name = (id: string) => data?.map.get(id)?.name ?? id;
  return (
    <div class="lt-path">
      <form
        class="lt-path__form"
        onSubmit={(e) => {
          e.preventDefault();
          run(from, to);
        }}
      >
        <PersonPicker id="lt-from" label="From" value={from} onChange={setFrom} data={data} />
        <PersonPicker id="lt-to" label="To" value={to} onChange={setTo} data={data} />
        <button type="submit" class="btn-primary lt-path__go" disabled={!from || !to}>
          Find the line
        </button>
      </form>
      <p class="lt-path__try">
        <span>Try</span>
        {PATH_EXAMPLES.map(([f, t, label]) => (
          <button
            key={label}
            type="button"
            class="lt-path__ex"
            onClick={() => {
              setFrom(f);
              setTo(t);
              run(f, t);
            }}
          >
            {label}
          </button>
        ))}
      </p>
      <div class="lt-path__out" ref={resultRef} aria-live="polite">
        {result && <PathResult result={result} name={name} onCentre={onCentre} />}
      </div>
    </div>
  );
}

function PathResult({ result, name, onCentre }: { result: Result; name: (id: string) => string; onCentre?: (id: string) => void }) {
  const { path } = result;
  if (!path || path.length < 2) {
    return (
      <p class="lt-path__none">
        {result.from === result.to
          ? 'Pick two different people.'
          : `No line of parents and children links ${name(result.from)} and ${name(result.to)} in the data.`}
      </p>
    );
  }
  const items = pathItems(path);
  const gap = items.some((i) => i.kind === 'gap');
  return (
    <>
      <p class="lt-path__sum">
        <b>{path[0].name}</b> <span aria-hidden="true">→</span>
        <span class="sr-only"> to </span> <b>{path[path.length - 1].name}</b>
        <span class="lt-path__gens">
          {' · '}
          {describePath(path)}
        </span>
      </p>
      <ol class="lt-chain">
        {items.map((it) =>
          it.kind === 'gap' ? (
            <li key={`g${it.from}`} class="lt-chain__gap" value={it.from + 1}>
              <span class="lt-chain__n" aria-hidden="true">
                {it.from + 1}–{it.to + 1}
              </span>
              {it.count} unnamed generations
            </li>
          ) : (
            <li key={it.index} class={`lt-chain__p${it.turn ? ' is-turn' : ''}${it.index === 0 || it.index === path.length - 1 ? ' is-end' : ''}`} value={it.index + 1}>
              <a
                href={lineageHash(it.step.id)}
                onClick={(e) => {
                  if (!onCentre) return;
                  e.preventDefault();
                  onCentre(it.step.id);
                }}
              >
                <span class="lt-chain__n" aria-hidden="true">
                  {it.index + 1}
                </span>
                {it.step.name}
              </a>
              {it.turn && <span class="lt-chain__turn">common ancestor</span>}
            </li>
          ),
        )}
      </ol>
      {gap && <p class="lt-path__note">“Unnamed generations” are links the source (STEPBible TIPNR) records without a name; Matthew 1:15 names Matthan as Jacob’s father.</p>}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Person picker (combobox)                                                  */
/* ------------------------------------------------------------------------ */

function PersonPicker({
  id,
  label,
  value,
  onChange,
  data,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (id: string) => void;
  data: ReturnType<typeof useNameIndexData>;
}) {
  const selected = value ? data?.map.get(value) : undefined;
  const [text, setText] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // follow outside changes (examples, the index arriving)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(selected?.name ?? '');
  }, [value, selected?.name]);

  const options: NameIndexEntry[] = useMemo(() => {
    if (!data || !open) return [];
    const q = text.trim();
    if (!q || (selected && q === selected.name)) return [];
    return searchNames(data.list, q, { kind: 'person', limit: 8 });
  }, [data, text, open]);
  const listId = `${id}-list`;
  const expanded = open && options.length > 0;
  const choose = (e: NameIndexEntry) => {
    onChange(e.id);
    setText(e.name);
    setOpen(false);
  };

  return (
    <div class="lt-pick">
      <label class="lt-pick__label" for={id}>
        {label}
      </label>
      <div class="lt-pick__box">
        <input
          ref={inputRef}
          id={id}
          class="lt-pick__input"
          type="text"
          role="combobox"
          autocomplete="off"
          spellcheck={false}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded ? `${id}-o${active}` : undefined}
          aria-describedby={selected ? `${id}-brief` : undefined}
          placeholder={data ? 'Type a name' : 'Loading names…'}
          value={text}
          onInput={(e) => {
            setText((e.currentTarget as HTMLInputElement).value);
            setOpen(true);
            setActive(0);
            if (value) onChange('');
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            if (!value) setText('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && options.length) {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (a + 1) % options.length);
            } else if (e.key === 'ArrowUp' && options.length) {
              e.preventDefault();
              setActive((a) => (a - 1 + options.length) % options.length);
            } else if (e.key === 'Enter' && expanded) {
              e.preventDefault();
              choose(options[active]);
            } else if (e.key === 'Escape' && expanded) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <ul class="lt-pick__list" id={listId} role="listbox" aria-label={`${label}: people`} hidden={!expanded}>
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === active}
              class={`lt-pick__opt${i === active ? ' is-active' : ''}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onPointerEnter={() => setActive(i)}
            >
              <span class="lt-pick__name">{o.name}</span>
              <span class="lt-pick__brief">{o.brief}</span>
            </li>
          ))}
        </ul>
      </div>
      <p class="lt-pick__sel" id={`${id}-brief`}>
        {selected ? selected.brief : ' '}
      </p>
    </div>
  );
}

