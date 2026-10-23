import { computeOrigLayout } from './data/orig';
import { readTsvColumns, readAlignment } from './data/common';
const t = (process.argv[2] ?? 'OT') as 'OT' | 'NT';
const L = computeOrigLayout(t);
const raw = readAlignment(t);
const text = new Map(L.bsb.map((x) => [x.id, x.text]));
const rows = readTsvColumns(t === 'NT' ? 'SBLGNT.tsv' : 'WLCM.tsv', ['id', 'text', 'gloss'] as const);
const g = new Map(rows.map((r) => [r.id, `${r.text}/${r.gloss}`]));
const vs = L.shifted!.verses;
let seed = Number(process.argv[3] ?? 7);
const pick = () => { seed = (seed * 9301 + 49297) % 233280; return vs[Math.floor((seed / 233280) * vs.length)]; };
for (let k = 0; k < 6; k++) {
  const v = pick();
  console.log('=======', v);
  for (const r of raw) if (r[1][0]?.startsWith(v)) console.log('  ', r[0].map((s) => g.get(s)).join(' '), '->', r[1].map((x) => text.get(x)).join(' '));
  console.log('  -- repaired:');
  for (const r of L.records) if (r[1][0]?.startsWith(v)) console.log('  ', r[0].map((s) => g.get(s)).join(' '), '->', r[1].map((x) => text.get(x)).join(' '));
}
