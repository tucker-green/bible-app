/**
 * Pure helpers of the people / places / lineage UI: relation words, family groups, summary split
 * and reference linking, refs grouping, path display, script runs, preview marking, layout and
 * camera maths.
 */
import { describe, expect, it } from 'vitest';
import { clampCamera, fitRect, placeAt, revealRect, wheelPx, zoomAt } from '../../src/components/names/camera';
import { markedTokens, nameWords } from '../../src/components/names/EntityRefs';
import { layoutLineage, moveFrom, rowY } from '../../src/components/names/layout';
import {
  chaptersOf,
  describePath,
  entityHash,
  formatCoords,
  generationLabel,
  groupRefsByBook,
  linkifyRefs,
  linkifyText,
  namesakeNote,
  pathItems,
  relationPhrase,
  relationToFocus,
  relativeGroups,
  scriptRuns,
  shortStrongs,
  splitSummary,
} from '../../src/components/names/model';
import { parseDefinition } from '../../src/components/word/definition';
import type { NameIndexEntry, PathStep } from '../../src/lib/names';
import { lineageTree } from '../../src/lib/names';
import type { FamilyGraph, NameChapter, NameEntity, Token } from '../../src/lib/types';
import { packRef } from '../../src/lib/types';

const entry = (id: string, name: string, kind: NameIndexEntry['kind'] = 'person', brief = ''): NameIndexEntry => ({ id, name, kind, brief, refCount: 1 });

const ABRAHAM: NameEntity = {
  id: 'p0057',
  name: 'Abraham',
  kind: 'person',
  uniqueName: 'Abraham@Gen.11.26-1Pe',
  brief: 'Patriarch, chosen by God to father His people',
  summary: '',
  gender: 'male',
  forms: [
    ['H0085', 'אַבְרָהָם', 'Abraham'],
    ['H0087', 'אַבְרָם', 'Abram'],
    ['G0011', 'Ἀβραάμ', 'Abraham'],
  ],
  parents: ['p2739'],
  siblings: ['p2075', 'p1037', 'p2405'],
  partners: ['p2405', 'p0973', 'p1725'],
  children: ['p1263', 'p1245', 'p2990', 'p1622', 'p1917', 'p2011', 'p1250', 'p2660'],
  refs: [packRef(1, 11, 26), packRef(1, 12, 1)],
};

const INDEX = new Map(
  [
    entry('p2739', 'Terah'),
    entry('p2075', 'Nahor'),
    entry('p1037', 'Haran'),
    entry('p2405', 'Sarah'),
    entry('p0973', 'Hagar'),
    entry('p1725', 'Keturah'),
    entry('p1263', 'Ishmael'),
    entry('p1245', 'Isaac'),
    entry('p2990', 'Zimran'),
    entry('p1622', 'Jokshan'),
    entry('p1917', 'Medan'),
    entry('p2011', 'Midian'),
    entry('p1250', 'Ishbak'),
    entry('p2660', 'Shuah'),
  ].map((e) => [e.id, e]),
);

describe('relations and family groups', () => {
  it('words relations from the entity’s own side', () => {
    expect(relationPhrase('parent', 'male')).toBe('Son of');
    expect(relationPhrase('parent', 'female')).toBe('Daughter of');
    expect(relationPhrase('child', 'male')).toBe('Father of');
    expect(relationPhrase('child', 'female')).toBe('Mother of');
    expect(relationPhrase('partner', 'female')).toBe('Wife of');
    expect(relationPhrase('sibling')).toBe('Sibling of');
  });

  it('caps each group and counts the rest', () => {
    const g = relativeGroups(ABRAHAM, (id) => INDEX.get(id), { limit: { parent: 2, partner: 2, child: 3 } });
    expect(g.map((x) => x.label)).toEqual(['Son of', 'Husband of', 'Father of']);
    expect(g[1].people.map((p) => p.name)).toEqual(['Sarah', 'Hagar']);
    expect(g[1].more).toBe(1);
    expect(g[2].people.map((p) => p.name)).toEqual(['Ishmael', 'Isaac', 'Zimran']);
    expect(g[2].more).toBe(5);
  });

  it('includes siblings when asked and skips unknown ids', () => {
    const g = relativeGroups({ ...ABRAHAM, siblings: ['p2075', 'p9999'] }, (id) => INDEX.get(id), { siblings: true });
    expect(g.map((x) => x.rel)).toEqual(['parent', 'sibling', 'partner', 'child']);
    expect(g[1].people.map((p) => p.name)).toEqual(['Nahor']);
  });

  it('calls a place’s TIPNR parents its founders', () => {
    const place: NameEntity = { ...ABRAHAM, id: 'l0195', kind: 'place', name: 'Bethlehem', parents: ['p2739'], children: [], partners: [], siblings: [] };
    expect(relativeGroups(place, (id) => INDEX.get(id))[0].label).toBe('Founded by');
  });

  it('notes namesakes', () => {
    const list = [entry('p1651', 'Joseph'), entry('p1654', 'Joseph'), entry('p1655', 'Joseph'), entry('l0001', 'Joseph', 'place')];
    expect(namesakeNote({ id: 'p1654', name: 'Joseph', kind: 'person' }, list)).toBe('One of 3 people named Joseph');
    expect(namesakeNote({ id: 'p0057', name: 'Abraham', kind: 'person' }, [entry('p0057', 'Abraham')])).toBeNull();
  });

  it('builds entity routes', () => {
    expect(entityHash('l0195')).toBe('#/place/l0195');
    expect(entityHash('p0057')).toBe('#/person/p0057');
    expect(entityHash('g0080', 'other')).toBe('#/person/g0080');
  });
});

describe('summary', () => {
  const html =
    'A man living at the time of the Patriarchs, first mentioned at <span class="ref" data-ref="GEN.11.26">Gen 11:26</span><br>referred to as <b>Abraham</b> (אַבְרָהָם);<br>son of <b>Terah</b>;<br>Abraham, initially named Abram, was born in Ur (<span class="ref" data-ref="GEN.11.26">Gen 11:26–31</span>).<br>He is the friend of God (Jam 2.23).';

  it('splits the record from the narrative', () => {
    const { record, paragraphs } = splitSummary(parseDefinition(html));
    expect(record).toHaveLength(3);
    expect(paragraphs).toHaveLength(2);
  });

  it('links plain references, keeping the book for follow-ons', () => {
    const nodes = linkifyText('the burial place of Rachel (Genesis 35:19; 48:7) and Judges 12:8, 10 and 1 Sam 16:1, 18; 17:12.');
    const refs = nodes.filter((n) => n.t === 'ref').map((n) => (n.t === 'ref' ? `${n.ref.book}.${n.ref.chapter}.${n.ref.verse}` : ''));
    expect(refs).toEqual(['GEN.35.19', 'GEN.48.7', 'JDG.12.8', 'JDG.12.10', '1SA.16.1', '1SA.16.18', '1SA.17.12']);
    // the text is unchanged apart from the links
    const text = nodes.map((n) => (n.t === 'text' ? n.v : n.t === 'ref' ? (n.c[0] as { v: string }).v : '')).join('');
    expect(text).toBe('the burial place of Rachel (Genesis 35:19; 48:7) and Judges 12:8, 10 and 1 Sam 16:1, 18; 17:12.');
  });

  it('reads “Jam 2.23” and ranges, and leaves non-references alone', () => {
    const r = linkifyText('friend of God (Jam 2.23), cited in Matthew 2:5-6, about 5 miles south; Was 3:4 not a book');
    const refs = r.filter((n) => n.t === 'ref');
    expect(refs).toHaveLength(2);
    expect(refs[0].t === 'ref' && refs[0].ref).toEqual({ book: 'JAS', chapter: 2, verse: 23 });
    expect(refs[1].t === 'ref' && refs[1].ref).toEqual({ book: 'MAT', chapter: 2, verse: 5, verseEnd: 6 });
  });

  it('never links inside existing references', () => {
    const nodes = linkifyRefs(parseDefinition('<span class="ref" data-ref="GEN.11.26">Gen 11:26</span> and Gen 12:1'));
    expect(nodes.filter((n) => n.t === 'ref')).toHaveLength(2);
  });

  it('splits Hebrew and Greek runs', () => {
    expect(scriptRuns('Abraham (אַבְרָהָם), or Abraham (Ἀβραάμ)')).toEqual([
      { text: 'Abraham (' },
      { text: 'אַבְרָהָם', lang: 'he' },
      { text: '), or Abraham (' },
      { text: 'Ἀβραάμ', lang: 'grc' },
      { text: ')' },
    ]);
    expect(scriptRuns('בֵּית לֶחֶם')).toEqual([{ text: 'בֵּית לֶחֶם', lang: 'he' }]);
    expect(scriptRuns('plain')).toEqual([{ text: 'plain' }]);
  });

  it('formats Strong’s and coordinates', () => {
    expect(shortStrongs('H0085')).toBe('H85');
    expect(shortStrongs('H5800a')).toBe('H5800a');
    expect(formatCoords([31.70536, 35.21026])).toBe('31.7054° N, 35.2103° E');
    expect(formatCoords([-1.5, -0.25])).toBe('1.5000° S, 0.2500° W');
  });
});

describe('references', () => {
  const refs = [packRef(40, 1, 2), packRef(1, 12, 1), packRef(1, 11, 26), packRef(1, 12, 4), packRef(45, 4, 1)];
  it('groups by book in canonical order', () => {
    const g = groupRefsByBook(refs);
    expect(g.map((x) => [x.book, x.refs.length])).toEqual([
      ['GEN', 3],
      ['MAT', 1],
      ['ROM', 1],
    ]);
  });
  it('lists the chapters to load', () => {
    expect(chaptersOf(groupRefsByBook(refs).flatMap((g) => g.refs))).toEqual([
      { book: 'GEN', chapter: 11 },
      { book: 'GEN', chapter: 12 },
      { book: 'MAT', chapter: 1 },
      { book: 'ROM', chapter: 4 },
    ]);
  });

  it('marks only the name inside a phrase-wide KJV link', () => {
    // KJV Gen 12:14 links "And it came to pass, that, when Abram" all to אַבְרָם
    const tokens: Token[] = [['And', [9]], ' ', ['it', [9]], ' ', ['came', [9]], ', ', ['when', [9]], ' ', ['Abram', [9]], ' ', ['was', [10]]];
    const names: NameChapter = { book: 'GEN', chapter: 12, words: { '9': 'p0057' } };
    expect([...markedTokens(tokens, names, 'p0057', nameWords(ABRAHAM))]).toEqual([8]);
    // possessives count; another person's words never do
    expect([...markedTokens([['Abram’s', [9]]], names, 'p0057', nameWords(ABRAHAM))]).toEqual([0]);
    expect([...markedTokens(tokens, names, 'p1651', nameWords(ABRAHAM))]).toEqual([]);
  });
});

describe('lineage labels and paths', () => {
  it('names generations', () => {
    expect(generationLabel(-1)).toBe('Parents');
    expect(generationLabel(2)).toBe('Grandchildren');
    expect(generationLabel(-3)).toBe('Great-grandparents');
    expect(generationLabel(5)).toBe('5 generations down');
    expect(relationToFocus(-2, 'ancestor')).toBe('grandparent');
    expect(relationToFocus(1, 'descendant')).toBe('child');
    expect(relationToFocus(0, 'partner')).toBe('partner');
  });

  const step = (id: string, name: string, rel: PathStep['rel']): PathStep => ({ id, name, rel });
  it('collapses unnamed runs and flags the common ancestor', () => {
    const path = [step('a', 'Matthan', 'self'), step('u1', 'Unnamed', 'child'), step('u2', 'Unnamed', 'child'), step('j', 'Jacob', 'child')];
    expect(pathItems(path).map((i) => (i.kind === 'gap' ? `gap${i.count}` : i.step.name))).toEqual(['Matthan', 'gap2', 'Jacob']);
    const cousins = [step('x', 'Jacob', 'self'), step('i', 'Isaac', 'parent'), step('e', 'Esau', 'child')];
    const items = pathItems(cousins);
    expect(items[1].kind === 'person' && items[1].turn).toBe(true);
    expect(describePath(cousins)).toBe('Jacob and Esau are related through Isaac (2 links)');
    expect(describePath([step('a', 'Adam', 'self'), step('s', 'Seth', 'child'), step('e', 'Enosh', 'child')])).toBe('Adam is an ancestor of Enosh, 2 generations apart');
    expect(describePath([step('s', 'Seth', 'self'), step('a', 'Adam', 'parent')])).toBe('Seth is a child of Adam');
  });
});

/* ------------------------------------------------------------------------ */

// A small family: G1 + G2 -> P (focus) with sibling S; P + W -> C1 (-> K1, K2), C2 (-> K3)
const GRAPH: FamilyGraph = [
  ['g1', 'G1', 'grandfather', [], ['p', 's'], ['g2'], []],
  ['g2', 'G2', 'grandmother', [], ['p', 's'], ['g1'], []],
  ['p', 'P', 'the focus', ['g1', 'g2'], ['c1', 'c2'], ['w'], ['s']],
  ['s', 'S', 'sibling', ['g1', 'g2'], [], [], ['p']],
  ['w', 'W', 'wife', [], ['c1', 'c2'], ['p'], []],
  ['c1', 'C1', 'child one', ['p', 'w'], ['k1', 'k2'], [], []],
  ['c2', 'C2', 'child two', ['p', 'w'], ['k3'], [], []],
  ['k1', 'K1', '', ['c1'], [], [], []],
  ['k2', 'K2', '', ['c1'], [], [], []],
  ['k3', 'K3', '', ['c2'], [], [], []],
];

describe('layoutLineage', () => {
  const tree = lineageTree(GRAPH, 'p', { up: 2, down: 2 })!;
  const L = layoutLineage(tree);
  const byName = (n: string) => L.nodes.find((x) => x.name === n)!;

  it('centres the focus at the origin with ancestors above and descendants below', () => {
    expect(byName('P')).toMatchObject({ x: 0, y: 0, role: 'focus' });
    expect(byName('G1').y).toBe(rowY(-1));
    expect(byName('C1').y).toBe(rowY(1));
    expect(byName('K1').y).toBe(rowY(2));
    expect(rowY(-1)).toBeLessThan(0);
  });

  it('never overlaps boxes on a row', () => {
    const rows = new Map<number, typeof L.nodes>();
    for (const n of L.nodes) rows.set(n.y, [...(rows.get(n.y) ?? []), n]);
    for (const row of rows.values()) {
      const s = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < s.length; i++) expect(s[i].x - s[i].w / 2).toBeGreaterThanOrEqual(s[i - 1].x + s[i - 1].w / 2);
    }
  });

  it('centres parents over their children and keeps family order', () => {
    const c1 = byName('C1');
    expect(c1.x).toBeCloseTo((byName('K1').x + byName('K2').x) / 2);
    expect(byName('C1').x).toBeLessThan(byName('C2').x);
    expect((byName('G1').x + byName('G2').x) / 2).toBeCloseTo(0);
  });

  it('puts siblings left and partners right of the focus', () => {
    expect(byName('S').role).toBe('sibling');
    expect(byName('S').x).toBeLessThan(0);
    expect(byName('W').role).toBe('partner');
    expect(byName('W').x).toBeGreaterThan(0);
    expect(L.ties).toHaveLength(1);
    expect(L.groups.map((g) => g.text)).toEqual(['Brothers & sisters', 'Partner']);
  });

  it('moves with the arrow keys', () => {
    const k = (n: string) => byName(n).key;
    expect(moveFrom(L, k('P'), 'up')).toBe(k('G1'));
    expect(moveFrom(L, k('G1'), 'right')).toBe(k('G2'));
    expect(moveFrom(L, k('G2'), 'down')).toBe(k('P'));
    expect(moveFrom(L, k('P'), 'down')).toBe(k('C1'));
    expect(moveFrom(L, k('C1'), 'down')).toBe(k('K1'));
    expect(moveFrom(L, k('K2'), 'up')).toBe(k('C1'));
    expect(moveFrom(L, k('P'), 'left')).toBe(k('S'));
    expect(moveFrom(L, k('P'), 'right')).toBe(k('W'));
    expect(moveFrom(L, k('K3'), 'home')).toBe(k('P'));
    expect(moveFrom(L, k('K1'), 'down')).toBeUndefined();
  });

  it('draws one connector per family plus the sibling line', () => {
    // G1/G2 -> P, P -> C1/C2, C1 -> K1/K2, C2 -> K3, siblings
    expect(L.links).toHaveLength(5);
    expect(L.bounds.minY).toBeLessThan(rowY(-1));
  });
});

describe('camera', () => {
  it('zooms around a fixed point', () => {
    const c = { x: 100, y: 50, s: 1 };
    const z = zoomAt(c, 2, 300, 200);
    // world point under (300, 200) before and after
    expect((300 - c.x) / c.s).toBeCloseTo((300 - z.x) / z.s);
    expect((200 - c.y) / c.s).toBeCloseTo((200 - z.y) / z.s);
    expect(zoomAt(c, 100, 0, 0).s).toBe(2);
    expect(zoomAt(c, 0.001, 0, 0).s).toBe(0.25);
  });

  it('fits a rectangle and places points', () => {
    const f = fitRect({ minX: -500, minY: -100, maxX: 500, maxY: 100 }, 548, 400, 24);
    expect(f.s).toBeCloseTo(0.5);
    expect(f.x).toBeCloseTo(274);
    expect(placeAt(10, 20, 100, 100, 2)).toEqual({ s: 2, x: 80, y: 60 });
  });

  it('keeps the world in reach and reveals rects', () => {
    const r = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };
    const far = clampCamera({ x: -5000, y: 0, s: 1 }, r, 400, 300);
    expect(far.x + r.maxX).toBeGreaterThanOrEqual(96);
    const c = { x: 0, y: 0, s: 1 };
    expect(revealRect(c, { left: 10, top: 10, right: 50, bottom: 50 }, 400, 300)).toEqual({ s: 1, x: 22, y: 22 });
    expect(revealRect(c, { left: 100, top: 100, right: 150, bottom: 150 }, 400, 300)).toBe(c);
    expect(wheelPx({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({ dx: 0, dy: 48 });
  });
});
