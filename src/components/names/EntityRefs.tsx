/**
 * Every verse that mentions a person or place (NameEntity.refs), grouped by book and paged, with a
 * preview of each verse in the translation being read; the words that name the entity are marked
 * (via the chapter's name map, so "Abram" and "Abraham" both light up, and a different Joseph does not).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { announce, translations } from '../../app/state';
import { getBookByNum } from '../../lib/books';
import { isWordToken, loadText } from '../../lib/data';
import { loadNameChapter } from '../../lib/names';
import { formatReference, refToHash } from '../../lib/reference';
import type { NameChapter, NameEntity, TextChapter, Token } from '../../lib/types';
import { unpackRef } from '../../lib/types';
import { chaptersOf, groupRefsByBook } from './model';

export const REFS_PAGE = 25;

type ChapterData = { text: TextChapter; names: NameChapter | null } | 'error';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export function EntityRefs({ entity, tr }: { entity: NameEntity; tr: string }) {
  const groups = useMemo(() => groupRefsByBook(entity.refs), [entity]);
  const words = useMemo(() => nameWords(entity), [entity]);
  const all = useMemo(() => groups.flatMap((g) => g.refs), [groups]);
  const [book, setBook] = useState(0);
  const [shown, setShown] = useState(REFS_PAGE);
  const [data, setData] = useState<Map<string, ChapterData>>(() => new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const refs = book ? (groups.find((g) => g.bookNum === book)?.refs ?? []) : all;
  const visible = refs.slice(0, shown);
  const chapters = useMemo(() => chaptersOf(visible), [refs, shown]);
  const keyOf = (b: string, c: number) => `${tr}/${b}/${c}`;
  const missing = chapters.filter((c) => !data.has(keyOf(c.book, c.chapter)));
  const busy = missing.length > 0;

  useEffect(() => {
    if (!missing.length) return;
    let off = false;
    Promise.all(
      missing.map(async ({ book: b, chapter: c }): Promise<[string, ChapterData]> => {
        try {
          const [text, names] = await Promise.all([loadText(tr, b, c), loadNameChapter(b, c).catch(() => null)]);
          return [keyOf(b, c), { text, names }];
        } catch {
          return [keyOf(b, c), 'error'];
        }
      }),
    ).then((entries) => {
      if (off) return;
      setData((prev) => {
        const next = new Map(prev);
        for (const [k, v] of entries) next.set(k, v);
        return next;
      });
    });
    return () => {
      off = true;
    };
  }, [tr, missing.map((c) => `${c.book}/${c.chapter}`).join(',')]);

  const trName = translations.value.find((t) => t.id === tr)?.name ?? tr;

  // book sections of the visible slice
  const sections: { bookNum: number; name: string; total: number; refs: number[] }[] = [];
  for (const r of visible) {
    const { bookNum } = unpackRef(r);
    let s = sections[sections.length - 1];
    if (!s || s.bookNum !== bookNum) {
      const g = groups.find((x) => x.bookNum === bookNum);
      s = { bookNum, name: g?.name ?? '', total: g?.refs.length ?? 0, refs: [] };
      sections.push(s);
    }
    s.refs.push(r);
  }

  const more = Math.min(REFS_PAGE, refs.length - shown);
  const selectId = `ent-refs-book-${entity.id}`;
  return (
    <div class="ent-refs">
      <div class="ent-refs__bar">
        <label class="ent-refs__filter" for={selectId}>
          <span>Book</span>
          <select
            id={selectId}
            value={String(book)}
            onChange={(e) => {
              setBook(Number((e.currentTarget as HTMLSelectElement).value));
              setShown(REFS_PAGE);
            }}
          >
            <option value="0">All books ({all.length.toLocaleString('en-US')})</option>
            {groups.map((g) => (
              <option key={g.bookNum} value={String(g.bookNum)}>
                {g.name} ({g.refs.length.toLocaleString('en-US')})
              </option>
            ))}
          </select>
        </label>
        <p class="ent-refs__tr">Text: {trName}</p>
      </div>
      <div class="ent-refs__body" ref={listRef} aria-busy={busy ? 'true' : undefined}>
        {sections.map((s) => (
          <section class="ent-refs__sec" key={`${s.bookNum}`} aria-label={`${s.name}, ${plural(s.total, 'verse')}`}>
            <h3 class="ent-refs__book">
              <span>{s.name}</span>
              <span class="ent-refs__n">{plural(s.total, 'verse')}</span>
            </h3>
            <ol class="ent-refs__list">
              {s.refs.map((r) => (
                <RefRow key={r} packed={r} entityId={entity.id} words={words} tr={tr} data={dataFor(data, tr, r)} />
              ))}
            </ol>
          </section>
        ))}
      </div>
      {more > 0 && (
        <p class="ent-refs__more">
          <button
            type="button"
            class="btn-quiet"
            onClick={() => {
              const n = shown + REFS_PAGE;
              setShown(n);
              announce(`Showing ${Math.min(n, refs.length)} of ${plural(refs.length, 'verse')}`);
            }}
          >
            Show {more} more
          </button>
          <span class="ent-refs__count">
            {Math.min(shown, refs.length).toLocaleString('en-US')} of {plural(refs.length, 'verse')}
          </span>
        </p>
      )}
    </div>
  );
}

function dataFor(data: Map<string, ChapterData>, tr: string, packed: number): ChapterData | undefined {
  const { bookNum, chapter } = unpackRef(packed);
  const b = getBookByNumSafe(bookNum);
  return b ? data.get(`${tr}/${b}/${chapter}`) : undefined;
}

function getBookByNumSafe(num: number): string | undefined {
  return getBookByNum(num)?.id;
}

function RefRow({ packed, entityId, words, tr, data }: { packed: number; entityId: string; words: Set<string>; tr: string; data: ChapterData | undefined }) {
  const { bookNum, chapter, verse } = unpackRef(packed);
  const book = getBookByNumSafe(bookNum) ?? '';
  const ref = { book, chapter, verse };
  const label = formatReference(ref, 'short');
  let body: ComponentChildren;
  if (!data) {
    body = <span class="skeleton ent-refs__skel" />;
  } else if (data === 'error') {
    body = <span class="ent-refs__na">Preview unavailable</span>;
  } else {
    const v = data.text.verses.find((x) => x.v === verse);
    body = v ? <Preview tokens={v.t} names={data.names} entityId={entityId} words={words} /> : <span class="ent-refs__na">Not in this translation’s numbering</span>;
  }
  return (
    <li class="ent-ref">
      <a class="ent-ref__at" href={refToHash(tr, ref)}>
        {label}
      </a>
      <span class="ent-ref__text">{body}</span>
    </li>
  );
}

/** Lower-cased English names an entity goes by ("abraham", "abram"), for marking just the name. */
export function nameWords(entity: Pick<NameEntity, 'name' | 'forms'>): Set<string> {
  const out = new Set<string>();
  for (const n of [entity.name, ...entity.forms.map((f) => f[2])]) for (const w of n.toLowerCase().split(/[\s/-]+/)) if (w.length > 1) out.add(w);
  return out;
}

const STOP = new Set(['and', 'so', 'then', 'but', 'for', 'now', 'when', 'it', 'the', 'unto', 'of', 'that', 'this', 'in', 'to', 'a', 'he', 'she', 'they']);
const bare = (t: string) => t.toLowerCase().replace(/[’']s$/, '').replace(/[^\p{L}]/gu, '');

/**
 * Which tokens of a verse to mark: of the words linked to the entity, those that are one of its
 * English names; failing that, the capitalised ones; failing that, all of them. (KJV Strong's tags
 * sometimes cover a whole phrase — "And it came to pass, that, when Abram" — only the name is marked.)
 */
export function markedTokens(tokens: Token[], names: NameChapter | null, entityId: string, words: Set<string>): Set<number> {
  const hits: number[] = [];
  tokens.forEach((t, i) => {
    if (isWordToken(t) && names && t[1].some((x) => names.words[String(x)] === entityId)) hits.push(i);
  });
  const text = (i: number) => (tokens[i] as [string, number[]])[0];
  const named = hits.filter((i) => words.has(bare(text(i))));
  if (named.length) return new Set(named);
  const caps = hits.filter((i) => /^\p{Lu}/u.test(text(i)) && !STOP.has(bare(text(i))));
  return new Set(caps.length ? caps : hits);
}

function Preview({ tokens, names, entityId, words }: { tokens: Token[]; names: NameChapter | null; entityId: string; words: Set<string> }) {
  const marked = markedTokens(tokens, names, entityId, words);
  const out: ComponentChildren[] = [];
  let run: string[] = [];
  let runHit = false;
  const flush = (k: number) => {
    if (!run.length) return;
    const text = run.join('');
    out.push(
      runHit ? (
        <mark key={k} class="ent-hit">
          {text}
        </mark>
      ) : (
        text
      ),
    );
    run = [];
  };
  tokens.forEach((t, i) => {
    const text = typeof t === 'string' ? t : t[0];
    // a space between two marked words stays inside the mark ("Jesus Christ")
    const isHit = marked.has(i) || (runHit && typeof t === 'string' && /^\s+$/.test(t) && marked.has(i + 1));
    if (isHit !== runHit) {
      flush(i);
      runHit = isHit;
    }
    run.push(text);
  });
  flush(tokens.length);
  return <>{out}</>;
}
