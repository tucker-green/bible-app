// LUMEN — interactive mockup of the Rootword reading experience.
// Plain ES module, no build step. Data: design/sample.json (real BSB tokens + SBLGNT/WLC words).

import {
  DEFS, COUNTS, LXX_FIX, SUPPLIED, NOTES, greekTranslit, parseGreek, parseHebrew,
  LOVE_BY_BOOK, LOVE_WORDS, LOVE_RESULTS, BOOK_GROUPS, TRANSLATIONS,
} from './lexicon.js';

/* ------------------------------------------------------------------------------------------ */
/* Setup                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
const DEMO = (params.get('demo') || '').toLowerCase();
const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => matchMedia('(max-width: 720px)').matches;

if (DEMO) {
  // Deterministic demo states: no entry motion until the viewer interacts.
  root.classList.add('demo-still');
  const wake = () => root.classList.remove('demo-still');
  addEventListener('pointerdown', wake, { once: true, capture: true });
  addEventListener('keydown', wake, { once: true, capture: true });
}

const state = {
  passage: DEMO.endsWith('-ot') || params.get('passage') === 'ot' ? 'ot' : 'nt',
  mode: DEMO.startsWith('interlinear') ? 'interlinear' : 'read',
  il: { gloss: true, translit: false, parsing: false, lxx: DEMO === 'interlinear-ot' },
  open: null, // unit id of the open card
  pinned: false,
  via: '',
  roving: null,
};

const ICON = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

/* ------------------------------------------------------------------------------------------ */
/* Passages shown in the concept                                                               */
/* ------------------------------------------------------------------------------------------ */

const BOOK_BY_NUM = { '01': 'Genesis', '19': 'Psalm', '43': 'John' };

const PASSAGES = {
  nt: {
    label: 'John 1', lang: 'grc', prev: 'Luke 24', next: 'John 2',
    sections: [{
      book: 'JHN', title: 'John', overline: 'The Gospel According to', num: 1, sub: 'Chapter One',
      glass: ['lapis', 'ruby', 'gold'],
      blocks: [
        { type: 'heading', text: 'The Beginning', xref: ['Genesis 1:1–2', 'Hebrews 11:1–3'] },
        { type: 'para', verses: ['43001001', '43001002', '43001003', '43001004', '43001005'] },
      ],
    }],
  },
  ot: {
    label: 'Genesis 1 · Psalm 23', lang: 'hbo', prev: 'Psalm 22', next: 'Psalm 24',
    sections: [
      {
        book: 'GEN', title: 'Genesis', overline: 'The First Book of Moses', num: 1, sub: 'Chapter One',
        glass: ['emerald', 'lapis', 'gold'],
        blocks: [
          { type: 'heading', text: 'The Creation', xref: ['John 1:1–5', 'Hebrews 11:1–3'] },
          { type: 'para', verses: ['01001001'] },
          { type: 'para', verses: ['01001002'] },
          { type: 'heading', text: 'The First Day' },
          { type: 'para', verses: ['01001003'] },
        ],
      },
      {
        book: 'PSA', title: 'Psalms', overline: 'Book One', num: 23, sub: 'The Twenty-Third Psalm',
        glass: ['ruby', 'violet', 'gold'],
        blocks: [
          { type: 'heading', text: 'The Lord Is My Shepherd', xref: ['Ezekiel 34:11–24', 'John 10:1–21'] },
          { type: 'super', text: 'A Psalm of David.' },
          {
            type: 'poetry',
            lines: [
              { v: '19023001', from: 0, to: 5, q: 1 },
              { v: '19023001', from: 6, q: 2 },
              { v: '19023002', from: 0, to: 8, q: 1 },
              { v: '19023002', from: 9, q: 2 },
            ],
          },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------------------------------ */
/* Data helpers                                                                                */
/* ------------------------------------------------------------------------------------------ */

let VERSES = {};
let ORIG = {};
let UNITS = [];
let BY_ORIG = new Map();
let BY_STRONGS = new Map();

const HEB_STRIP = /[֑-ֽ֯׀׃]/g;
const cleanOrig = (t) => t.replace(HEB_STRIP, '');
const isHebId = (id) => id[0] === 'o';
const showStrongs = (s) => (s ? s.replace(/^([GH])0*(\d+)([a-z]?)$/i, '$1$2$3') : '');
const cleanTranslit = (t) => (t || '').replace(/[:\-]+$/, '');

function cleanGloss(g) {
  if (!g) return '';
  if (g === '(et)') return '(object marker)';
  if (g === '*') return '(untranslated)';
  return g.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
}

function refOf(vid) {
  return `${BOOK_BY_NUM[vid.slice(0, 2)] || ''} ${+vid.slice(2, 5)}:${+vid.slice(5, 8)}`;
}

/** Choose the morpheme/word that carries the meaning (noun/verb over prefixes and articles). */
function mainOrig(ids) {
  let best = null;
  let bestScore = -1;
  for (const id of ids) {
    const w = ORIG[id];
    if (!w) continue;
    const m = w.morph || '';
    let s;
    if (isHebId(id)) s = /^[VN]/.test(m) ? 5 : /^A/.test(m) ? 4 : /^S/.test(m) ? 1 : /^(R|C|Td)$/.test(m) ? 0 : m === 'To' ? -1 : 2;
    else s = /^[VN]-/.test(m) ? 5 : /^A-/.test(m) ? 4 : /^(T-|PREP|CONJ)/.test(m) ? 1 : 2;
    if (s > bestScore) { best = id; bestScore = s; }
  }
  return best;
}

/** Group linked ids into written words (Hebrew morphemes of one word are joined). */
function groupWords(ids) {
  const sorted = ids.filter((id) => ORIG[id]).sort();
  const main = mainOrig(sorted);
  const out = [];
  for (const id of sorted) {
    const key = isHebId(id) ? id.slice(0, -1) : id;
    let g = out.find((x) => x.key === key);
    if (!g) { g = { key, ids: [] }; out.push(g); }
    g.ids.push(id);
  }
  for (const g of out) {
    g.text = g.ids.map((id) => cleanOrig(ORIG[id].text)).join('');
    g.html = g.ids.map((id) => {
      const w = ORIG[id];
      const pre = g.ids.length > 1 && id !== main && /^(R|C|Td)$/.test(w.morph);
      return pre ? `<span class="pre">${esc(cleanOrig(w.text))}</span>` : esc(cleanOrig(w.text));
    }).join('');
    g.translit = cleanTranslit(g.ids.map((id) => ORIG[id].translit || '').join(''));
  }
  return out;
}

/** Gloss for a unit: Hebrew words split into morphemes carry pieces of one gloss
    ("he" + "makes.me.lie.down"), so join them; the untranslatable object marker is skipped. */
function unitGloss(u, joinAll) {
  const ids = u.links.filter((id) => ORIG[id]).sort();
  const hasSuffix = ids.some((id) => /^S/.test(ORIG[id].morph));
  if (!joinAll && !hasSuffix) return cleanGloss(ORIG[u.main].gloss);
  const parts = [];
  for (const id of ids) {
    const w = ORIG[id];
    if (w.morph === 'To' && ids.length > 1) continue;
    const g = cleanGloss(w.gloss);
    if (g && !parts.includes(g)) parts.push(g);
  }
  return parts.join(' ');
}

function parseOf(id) {
  const w = ORIG[id];
  return isHebId(id) ? parseHebrew(w.morph) : parseGreek(w.morph);
}

function lxxOf(w) {
  if (!w || !w.lxx) return null;
  const [form, sid] = w.lxx.split('|');
  if (!form) return null;
  const nfc = form.normalize('NFC');
  const fixed = LXX_FIX[nfc] || nfc;
  return { form: fixed, strongs: /\d/.test(sid || '') ? `G${(sid || '').replace(/\D/g, '')}` : '', translit: greekTranslit(fixed) };
}

/* ------------------------------------------------------------------------------------------ */
/* Tokens → units                                                                              */
/* ------------------------------------------------------------------------------------------ */

function buildItems(vid, from = 0, to = Infinity) {
  const toks = VERSES[vid].tokens;
  const items = [];
  for (let i = from; i < toks.length && i <= to; i++) {
    const t = toks[i];
    const sup = SUPPLIED[`${vid}:${i}`];
    if (t.punct || (!t.orig.length && !sup)) {
      items.push({ kind: 'p', text: t.text, space: t.space_after, toks: [i], vid });
      continue;
    }
    if (sup) {
      items.push({ kind: 'sup', text: t.text, space: t.space_after, toks: [i], links: [], note: sup, vid });
      continue;
    }
    const key = t.orig.slice().sort().join(',');
    const prev = items[items.length - 1];
    if (prev && prev.kind === 'w' && prev.key === key) {
      prev.text += (prev.space ? ' ' : '') + t.text;
      prev.toks.push(i);
      prev.space = t.space_after;
      continue;
    }
    items.push({ kind: 'w', text: t.text, space: t.space_after, toks: [i], links: t.orig.slice(), key, vid });
  }
  for (const it of items) {
    if (it.kind === 'p') continue;
    it.id = UNITS.length;
    it.lang = vid.startsWith('43') ? 'grc' : 'hbo';
    it.main = it.kind === 'w' ? mainOrig(it.links) : null;
    it.strongs = it.main ? ORIG[it.main].strongs : '';
    UNITS.push(it);
    for (const id of it.links) {
      if (!BY_ORIG.has(id)) BY_ORIG.set(id, new Set());
      BY_ORIG.get(id).add(it.id);
      const s = ORIG[id]?.strongs;
      if (s) {
        if (!BY_STRONGS.has(s)) BY_STRONGS.set(s, new Set());
        BY_STRONGS.get(s).add(it.id);
      }
    }
  }
  return items;
}

/* ------------------------------------------------------------------------------------------ */
/* Rendering: reading mode                                                                     */
/* ------------------------------------------------------------------------------------------ */

let noteSeq = 0;

function wordHTML(text) {
  return esc(text).replace(/\bLORD\b/g, '<span class="lord">Lord</span>');
}

function fnHTML(vid, toks) {
  let h = '';
  for (const i of toks) {
    const n = NOTES[`${vid}:${i}`];
    if (n) {
      const mark = String.fromCharCode(97 + (noteSeq++ % 26));
      h += `<button class="fn" data-note="${esc(n.text)}" data-vid="${vid}" aria-label="Footnote ${mark}: ${esc(n.text)}">${mark}</button>`;
    }
  }
  return h;
}

function vnHTML(vid) {
  const n = +vid.slice(5);
  return `<span class="vn${n === 1 ? ' first' : ''}" id="v${vid}"><span class="sr-only">Verse </span>${n}</span>`;
}

function readItemsHTML(items) {
  let h = '';
  for (const it of items) {
    if (it.kind === 'p') h += esc(it.text);
    else {
      h += `<span class="w${it.kind === 'sup' ? ' sup' : ''}" data-u="${it.id}" role="button" tabindex="-1" aria-haspopup="dialog" aria-expanded="false">${wordHTML(it.text)}</span>`;
    }
    h += fnHTML(it.vid, it.toks);
    if (it.space) h += ' ';
  }
  return h;
}

/* ------------------------------------------------------------------------------------------ */
/* Rendering: interlinear mode                                                                 */
/* ------------------------------------------------------------------------------------------ */

function ilItemsHTML(items, seen) {
  const cols = [];
  let prefix = '';
  for (const it of items) {
    if (it.kind === 'p') {
      if (cols.length && !/^[“‘(\[]/.test(it.text)) cols[cols.length - 1].suffix += it.text;
      else prefix += it.text;
      continue;
    }
    cols.push({ it, prefix, suffix: '' });
    prefix = '';
  }
  let h = '';
  for (const c of cols) {
    const { it } = c;
    const en = esc(c.prefix) + wordHTML(it.text) + esc(c.suffix);
    if (it.kind === 'sup') {
      h += `<span class="iu sup" data-u="${it.id}" role="button" tabindex="-1" aria-haspopup="dialog" aria-expanded="false"><span class="iu-en">${en}</span><span class="iu-none">supplied</span></span>`;
      continue;
    }
    const groups = groupWords(it.links);
    const heb = it.lang === 'hbo';
    const dup = it.links.every((id) => seen.has(id));
    it.links.forEach((id) => seen.add(id));
    const w = ORIG[it.main];
    const orig = groups.map((g) => g.html).join(' ');
    let lines = `<span class="iu-or${dup ? ' dup' : ''}" lang="${heb ? 'he' : 'grc'}">${orig}</span>`;
    if (heb && state.il.lxx) {
      const l = lxxOf(w);
      lines += l ? `<span class="iu-lxx" lang="grc">${esc(l.form)}</span>` : `<span class="iu-lxx iu-none" aria-label="no Septuagint equivalent">—</span>`;
    }
    if (state.il.translit) {
      const t = heb ? groups.map((g) => g.translit).filter(Boolean).join(' ') : greekTranslit(groups.map((g) => g.text).join(' '));
      if (t) lines += `<span class="iu-tr">${esc(t)}</span>`;
    }
    if (state.il.gloss) lines += `<span class="iu-gl">${esc(unitGloss(it, true))}</span>`;
    if (state.il.parsing) lines += `<span class="iu-pa">${esc(w.morph)}</span>`;
    h += `<span class="iu" data-u="${it.id}" role="button" tabindex="-1" aria-haspopup="dialog" aria-expanded="false"><span class="iu-en">${en}</span>${lines}</span>`;
  }
  return h;
}

/* ------------------------------------------------------------------------------------------ */
/* Chapter heading: a lancet window holding the chapter number                                 */
/* ------------------------------------------------------------------------------------------ */

const GLASS = {
  lapis: ['#1b3594', '#3f6ae6', '#a7c0ff'],
  ruby: ['#7d1027', '#d23a58', '#ffa4b4'],
  gold: ['#a5680c', '#eab045', '#fff0c2'],
  emerald: ['#0b5a45', '#22a07a', '#a6f2d6'],
  violet: ['#2e1f7a', '#6a4ee0', '#cfc2ff'],
};

function lancet(num, glass, uid) {
  const [A, B, C] = glass.map((g) => GLASS[g]);
  const arch = 'M4 166V88A88 88 0 0 1 48 8A88 88 0 0 1 92 88V166Z';
  const inner = 'M9.5 166V89A82 82 0 0 1 48 14.5A82 82 0 0 1 86.5 89V166Z';
  // Quarry glazing: a diamond mosaic of jewel-tone pieces, deterministic per window.
  let seed = num * 131 + uid.charCodeAt(0) * 7 + uid.charCodeAt(1);
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const s = 15;
  let mosaic = '';
  for (let row = -1; row <= Math.ceil(170 / (s / 2)) + 1; row++) {
    for (let col = -1; col <= Math.ceil(96 / s) + 1; col++) {
      const cx = col * s + (row % 2 ? s / 2 : 0);
      const cy = (row * s) / 2;
      const r = rnd();
      const P = cy < 86 ? [B, A] : [A, B];
      const fill = r < 0.42 ? P[0][1] : r < 0.62 ? P[0][0] : r < 0.74 ? P[0][2] : r < 0.86 ? P[1][1] : r < 0.94 ? C[1] : C[2];
      mosaic += `<path d="M${cx} ${cy - s / 2}L${cx + s / 2} ${cy}L${cx} ${cy + s / 2}L${cx - s / 2} ${cy}Z" fill="${fill}"/>`;
    }
  }
  const fs = num > 9 ? 20 : 25;
  return `<svg class="lancet" viewBox="0 0 96 170" role="img" aria-label="Chapter ${num}">
  <defs>
    <clipPath id="ar-${uid}"><path d="${arch}"/></clipPath>
    <radialGradient id="gc-${uid}" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="${C[2]}"/><stop offset=".55" stop-color="${C[1]}"/><stop offset="1" stop-color="${C[0]}"/></radialGradient>
    <radialGradient id="gm-${uid}" cx=".42" cy=".38" r=".72"><stop offset="0" stop-color="#fffbf2"/><stop offset=".55" stop-color="#ffe6a8"/><stop offset="1" stop-color="#e3a43f"/></radialGradient>
    <linearGradient id="gs-${uid}" x1="0" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
  </defs>
  <path class="frame" d="${arch}" stroke-width="7"/>
  <g clip-path="url(#ar-${uid})">
    <g class="mosaic">${mosaic}</g>
    <path d="${arch}" fill="none" stroke="${C[1]}" stroke-width="11"/>
    <circle cx="48" cy="50" r="15" fill="url(#gc-${uid})"/>
    <circle cx="48" cy="123" r="24" fill="url(#gm-${uid})"/>
    <rect width="96" height="170" fill="url(#gs-${uid})"/>
  </g>
  <g class="lead">
    <path d="${inner}" stroke-width="1.6"/>
    <path d="M37.4 39.4L58.6 60.6M58.6 39.4L37.4 60.6" stroke-width="1.4"/>
    <circle cx="48" cy="50" r="15" stroke-width="2.4"/>
    <circle cx="48" cy="123" r="24" stroke-width="2.8"/>
    <path d="${arch}" stroke-width="3"/>
  </g>
  <text x="48" y="${123 + fs * 0.36}" text-anchor="middle" class="lancet-num" font-size="${fs}">${num}</text>
</svg>`;
}

/* ------------------------------------------------------------------------------------------ */
/* Render the passage                                                                          */
/* ------------------------------------------------------------------------------------------ */

function render() {
  closeCard(false);
  UNITS = [];
  BY_ORIG = new Map();
  BY_STRONGS = new Map();
  const P = PASSAGES[state.passage];
  const il = state.mode === 'interlinear';
  let html = '';
  for (const sec of P.sections) {
    noteSeq = 0;
    let body = '';
    for (const b of sec.blocks) {
      if (b.type === 'heading') {
        const xr = b.xref ? `<span class="xref">${b.xref.map((x) => `<a href="#" data-xref>${esc(x)}</a>`).join(' · ')}</span>` : '';
        body += `<div class="sec-head"><h3>${esc(b.text)}</h3>${xr}</div>`;
      } else if (b.type === 'super') {
        body += `<p class="superscription">${esc(b.text)}</p>`;
      } else if (b.type === 'para') {
        if (il) {
          let h = '';
          for (const vid of b.verses) {
            const seen = new Set();
            h += `<span class="iu-vn" aria-label="Verse ${+vid.slice(5)}">${+vid.slice(5)}</span>` + ilItemsHTML(buildItems(vid), seen);
          }
          body += `<div class="para">${h}</div>`;
        } else {
          body += `<p>${b.verses.map((vid) => vnHTML(vid) + readItemsHTML(buildItems(vid))).join('')}</p>`;
        }
      } else if (b.type === 'poetry') {
        let h = '';
        let lastV = '';
        const seen = new Map();
        for (const ln of b.lines) {
          const items = buildItems(ln.v, ln.from, ln.to ?? Infinity);
          const first = ln.v !== lastV;
          lastV = ln.v;
          if (il) {
            if (!seen.has(ln.v)) seen.set(ln.v, new Set());
            if (h) h += '<span class="line-break" aria-hidden="true"></span>';
            h += (first ? `<span class="iu-vn">${+ln.v.slice(5)}</span>` : '') + ilItemsHTML(items, seen.get(ln.v));
          } else {
            h += `<div class="line q${ln.q}">${first ? vnHTML(ln.v) : ''}${readItemsHTML(items)}</div>`;
          }
        }
        body += `<div class="poetry">${h}</div>`;
      }
    }
    html += `<section class="section-block" aria-labelledby="h-${sec.book}">
      <header class="chapter-head">
        ${lancet(sec.num, sec.glass, sec.book)}
        <p class="overline">${esc(sec.overline)}</p>
        <h2 class="chapter-title" id="h-${sec.book}">${esc(sec.title)}</h2>
        <p class="chapter-sub">${esc(sec.sub)}</p>
      </header>
      <div class="${il ? 'il' : 'text'}">${body}</div>
    </section>`;
  }
  const art = $('#passage');
  art.innerHTML = html;
  art.classList.toggle('mode-il', il);
  art.setAttribute('aria-labelledby', state.passage === 'nt' ? 'tab-nt' : 'tab-ot');
  for (const el of $$('[data-u]', art)) UNITS[+el.dataset.u].el = el;
  const first = $('[data-u]', art);
  if (first) setRoving(first);
  syncChrome();
}

function syncChrome() {
  const P = PASSAGES[state.passage];
  $('#passageLabel').textContent = P.label;
  $('#dockLabel').textContent = state.passage === 'nt' ? 'John 1' : 'Gen 1 · Ps 23';
  $('#prevLabel').textContent = P.prev;
  $('#nextLabel').textContent = P.next;
  $('#dockPrev').setAttribute('aria-label', `Previous chapter: ${P.prev}`);
  $('#dockNext').setAttribute('aria-label', `Next chapter: ${P.next}`);
  for (const t of $$('#passageTabs [role=tab]')) t.setAttribute('aria-selected', String(t.dataset.p === state.passage));
  const il = state.mode === 'interlinear';
  for (const b of $$('#modeSeg [role=radio]')) b.setAttribute('aria-checked', String(b.dataset.mode === state.mode));
  $('#dockMode').setAttribute('aria-pressed', String(il));
  $('#ilOpts').hidden = !il;
  $('#origChipLabel').textContent = P.lang === 'grc' ? 'Greek' : 'Hebrew';
  $('#lxxChip').hidden = P.lang !== 'hbo';
  for (const c of $$('#ilOpts [data-il]')) {
    if (c.dataset.il in state.il) c.setAttribute('aria-pressed', String(state.il[c.dataset.il]));
  }
}

function setRoving(el) {
  if (state.roving && state.roving !== el) state.roving.setAttribute('tabindex', '-1');
  el.setAttribute('tabindex', '0');
  state.roving = el;
}

/* ------------------------------------------------------------------------------------------ */
/* The word card                                                                               */
/* ------------------------------------------------------------------------------------------ */

const card = $('#card');

function hereCount(u) {
  if (!u.strongs) return 0;
  return BY_STRONGS.get(u.strongs)?.size || 0;
}

function cardHTML(u) {
  const close = `<button class="card-close" type="button" aria-label="Close">${ICON('i-close')}</button>`;
  if (u.kind === 'sup') {
    return `<div class="card-inner">
      <div class="card-meta"><span class="lang"><i class="gem gem-gold" aria-hidden="true"></i>Supplied word</span><span class="sep">·</span><span>${esc(refOf(u.vid))}</span><span style="margin-left:auto"></span>${close}</div>
      <p class="sup-word" id="cardTitle">${esc(u.text)}</p>
      <p class="sup-text" id="cardSum">${esc(u.note)}</p>
      <p class="align-note">Shown in italics, as the KJV prints supplied words.</p>
    </div>`;
  }
  const heb = u.lang === 'hbo';
  const groups = groupWords(u.links);
  const ids = groups.flatMap((g) => g.ids);
  const w = ORIG[u.main];
  const sid = w.strongs;
  const info = DEFS[sid] || {};
  const p = parseOf(u.main);
  const plain = groups.map((g) => g.text).join(' ');
  const hero = groups.map((g) => g.html).join(' ');
  const translit = heb ? groups.map((g) => g.translit).filter(Boolean).join(' ') : greekTranslit(plain);
  const gloss = unitGloss(u, false);
  const nEn = u.toks.length;
  const count = COUNTS[sid];
  const here = hereCount(u);
  const langName = heb ? 'Hebrew' : 'Greek';
  const lxx = heb ? lxxOf(w) : null;

  const parts = ids.length > 1
    ? `<ul class="parts" aria-label="Parts">${ids.map((id, i) => {
        const o = ORIG[id];
        const pp = parseOf(id);
        return `${i ? '<li class="plus" aria-hidden="true">+</li>' : ''}<li class="${id === u.main ? 'main' : ''}"><span class="pw" lang="${heb ? 'he' : 'grc'}">${esc(cleanOrig(o.text))}</span><span>${esc(cleanGloss(o.gloss))}</span><span aria-hidden="true">·</span><span>${esc(pp.pos.toLowerCase())}</span></li>`;
      }).join('')}</ul>`
    : '';

  const renders = `<span class="renders">as <q>${wordHTML(u.text)}</q>${nEn > 1 ? ` <span class="count">· ${nEn} English words</span>` : ''}</span>`;

  const lxxHTML = lxx
    ? `<div class="lxx">
        <span class="lxx-label">Septuagint<small>Greek Old Testament</small></span>
        <span class="lxx-word" lang="grc">${esc(lxx.form)}</span>
        <span class="lxx-tr">${esc(lxx.translit)}</span>
        ${lxx.strongs ? `<a class="strongs" href="#" aria-label="Strong’s ${lxx.strongs}">${lxx.strongs}</a>` : ''}
      </div>`
    : heb ? `<p class="align-note">No single Septuagint word corresponds here.</p>` : '';

  const summary = `${plain}${translit ? `, ${translit}` : ''}: “${gloss}”. ${p.pos}${p.detail ? `, ${p.detail}` : ''}. Strong’s ${showStrongs(sid)}.`;

  return `<div class="card-inner">
    <div class="card-meta">
      <span class="lang"><i class="gem ${heb ? 'gem-ruby' : 'gem-lapis'}" aria-hidden="true"></i>${langName}</span>
      <span class="sep" aria-hidden="true">·</span><span>${esc(refOf(u.vid))}</span>
      <a class="strongs" href="#" aria-label="Strong’s number ${showStrongs(sid)}">${showStrongs(sid)}</a>
      ${close}
    </div>
    <div class="hero">
      <p class="hero-word" id="cardTitle" lang="${heb ? 'he' : 'grc'}">${hero}</p>
      <div class="hero-side">
        ${translit ? `<span class="translit">${esc(translit)}</span>` : ''}
        ${renders}
      </div>
    </div>
    ${parts}
    <dl class="facts">
      <div><dt>Parsing</dt><dd><b>${esc(p.pos)}</b>${p.detail ? ` · ${esc(p.detail)}` : ''}</dd></div>
      <div class="pair"><dt>Dictionary</dt><dd><span class="lex" lang="${heb ? 'he' : 'grc'}">${esc(info.form || w.lemma)}</span></dd><dt>Gloss</dt><dd><span class="gloss">${esc(gloss)}</span></dd></div>
    </dl>
    ${lxxHTML}
    <p class="def">${greekRuns(esc(info.def || `${gloss.charAt(0).toUpperCase()}${gloss.slice(1)}.`))}</p>
    <p class="sr-only" id="cardSum">${esc(summary)}</p>
    <div class="card-foot">
      <button class="occ" type="button" data-occ="${sid}">See all ${count ? count.toLocaleString('en-US') : ''} occurrences ${ICON('i-arrow')}</button>
      ${here > 1 ? `<span class="here">${here} in this passage</span>` : ''}
    </div>
  </div>`;
}

/** Set Greek / Hebrew runs inside English prose in their own faces. */
function greekRuns(html) {
  return html
    .replace(/[\u0370-\u03FF\u1F00-\u1FFF]+(?:[ ,]+[\u0370-\u03FF\u1F00-\u1FFF]+)*/g, (m) => `<span lang="grc">${m}</span>`)
    .replace(/[\u0590-\u05FF]+(?:\s+[\u0590-\u05FF]+)*/g, (m) => `<span lang="he">${m}</span>`);
}

function noteCardHTML(text, vid) {
  return `<div class="card-inner">
    <div class="card-meta"><span class="lang"><i class="gem gem-gold" aria-hidden="true"></i>Translator’s note</span><span class="sep">·</span><span>${esc(refOf(vid))}</span><span style="margin-left:auto"></span><button class="card-close" type="button" aria-label="Close">${ICON('i-close')}</button></div>
    <p class="sup-text" id="cardTitle" style="margin-top:10px">${esc(text)}</p>
  </div>`;
}

function clearLit() {
  for (const el of $$('.lit, .echo, .active', $('#passage'))) el.classList.remove('lit', 'echo', 'active');
  for (const el of $$('[aria-expanded="true"][data-u]')) {
    el.setAttribute('aria-expanded', 'false');
    el.removeAttribute('aria-describedby');
    el.removeAttribute('aria-controls');
  }
}

function light(u) {
  u.el.classList.add('active');
  if (u.kind === 'sup') return;
  const lit = new Set([u.id]);
  for (const id of u.links) for (const x of BY_ORIG.get(id) || []) lit.add(x);
  for (const x of lit) UNITS[x].el?.classList.add('lit');
  if (u.strongs && (COUNTS[u.strongs] || 0) < 5000) {
    for (const x of BY_STRONGS.get(u.strongs) || []) if (!lit.has(x)) UNITS[x].el?.classList.add('echo');
  }
}

function announce(text) {
  const live = $('#live');
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

function openCard(el, { pinned = false, via = 'hover', animate = true } = {}) {
  const u = UNITS[+el.dataset.u];
  if (!u) return;
  const same = state.open === u.id && !card.hidden;
  state.pinned = pinned || (same && state.pinned);
  state.via = via;
  if (!same) {
    clearLit();
    state.open = u.id;
    card.dataset.lang = u.lang;
    card.dataset.kind = u.kind;
    card.innerHTML = `<span class="card-notch" aria-hidden="true"></span>${cardHTML(u)}`;
    card.hidden = false;
    light(u);
    el.setAttribute('aria-expanded', 'true');
    el.setAttribute('aria-controls', 'card');
    el.setAttribute('aria-describedby', 'cardSum');
    if (via === 'key' || via === 'touch') announce($('#cardSum', card)?.textContent || '');
    card.classList.remove('enter', 'reveal');
    if (animate && !reducedMotion()) {
      void card.offsetWidth;
      card.classList.add('enter', 'reveal');
    }
  }
  setRoving(el);
  placeCard(el);
}

function openNote(btn) {
  clearLit();
  state.open = -1;
  state.pinned = true;
  state.via = 'note';
  card.dataset.lang = '';
  card.dataset.kind = 'note';
  card.innerHTML = `<span class="card-notch" aria-hidden="true"></span>${noteCardHTML(btn.dataset.note, btn.dataset.vid)}`;
  card.hidden = false;
  card.classList.remove('enter', 'reveal');
  placeCard(btn);
}

function closeCard(returnFocus = false) {
  if (card.hidden) return;
  const u = state.open >= 0 ? UNITS[state.open] : null;
  card.hidden = true;
  card.classList.remove('enter', 'reveal', 'sheet');
  clearLit();
  state.open = null;
  state.pinned = false;
  if (returnFocus && u?.el) u.el.focus();
}

function placeCard(el) {
  const bar = $('#bar').getBoundingClientRect();
  if (narrow()) {
    card.classList.add('sheet');
    card.style.left = '';
    card.style.top = '';
    const sh = card.offsetHeight;
    const r = el.getBoundingClientRect();
    const visibleBottom = innerHeight - sh - 12;
    if (r.bottom > visibleBottom || r.top < bar.bottom + 8) {
      const target = scrollY + r.top - Math.max(bar.bottom + 24, visibleBottom - r.height - 40);
      scrollTo({ top: Math.max(0, target), behavior: reducedMotion() || root.classList.contains('demo-still') ? 'auto' : 'smooth' });
    }
    return;
  }
  card.classList.remove('sheet');
  card.style.maxHeight = '';
  card.style.overflowY = '';
  const rects = el.getClientRects();
  const firstR = rects[0];
  const lastR = rects[rects.length - 1];
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const vw = root.clientWidth;
  const gap = el.classList.contains('iu') ? 8 : 12;
  const margin = 16;
  const below = innerHeight - lastR.bottom - gap - margin;
  const above = firstR.top - bar.bottom - gap - margin;
  // Prefer the card directly below the line being read. A card the reader opened on purpose
  // (click, tap, Enter) may scroll the page a little to fit; a hover card flips above instead.
  const deliberate = state.pinned && state.via !== 'hover';
  const room = document.documentElement.scrollHeight - innerHeight - scrollY;
  const scrollNeed = ch - below;
  let placeBelow;
  let scrollBy = 0;
  if (ch <= below) placeBelow = true;
  else if (deliberate && scrollNeed <= Math.min(room, firstR.top - bar.bottom - 24)) { placeBelow = true; scrollBy = scrollNeed; }
  else if (ch <= above) placeBelow = false;
  else {
    placeBelow = below >= above;
    card.style.maxHeight = `${Math.max(180, placeBelow ? below : above)}px`;
    card.style.overflowY = 'auto';
  }
  const chFinal = card.offsetHeight;
  const a = placeBelow ? lastR : firstR;
  const cx = a.left + a.width / 2;
  let left = Math.round(cx - Math.min(64, cw / 2));
  left = Math.max(12, Math.min(left, vw - cw - 12));
  const top = placeBelow ? a.bottom + gap : a.top - chFinal - gap;
  card.style.left = `${left + scrollX}px`;
  card.style.top = `${Math.round(top + scrollY)}px`;
  card.dataset.side = placeBelow ? 'below' : 'above';
  card.style.setProperty('--notch-x', `${Math.max(20, Math.min(cx - left, cw - 20))}px`);
  card.style.setProperty('--enter-y', placeBelow ? '-6px' : '6px');
  if (scrollBy > 0) {
    scrollTo({ top: scrollY + scrollBy, behavior: reducedMotion() || root.classList.contains('demo-still') ? 'auto' : 'smooth' });
  }
}

/* Hover intent (mouse), click/tap to pin, keyboard roving */
let openTimer = 0;
let closeTimer = 0;

document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const w = e.target.closest?.('#passage [data-u]');
  if (w) {
    clearTimeout(closeTimer);
    if (state.pinned) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(() => openCard(w, { via: 'hover' }), card.hidden ? 120 : 40);
  } else if (e.target.closest?.('#card')) {
    clearTimeout(closeTimer);
  }
});
document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return;
  const from = e.target.closest?.('#passage [data-u], #card');
  if (!from) return;
  const to = e.relatedTarget?.closest?.('#passage [data-u], #card');
  if (to === from) return;
  clearTimeout(openTimer);
  if (!state.pinned) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => closeCard(false), 280);
  }
});

$('#passage').addEventListener('click', (e) => {
  const fn = e.target.closest('.fn');
  if (fn) { openNote(fn); return; }
  if (e.target.closest('[data-xref]')) { e.preventDefault(); toast('Cross-references open in a side panel in the full app.'); return; }
  const w = e.target.closest('[data-u]');
  if (!w) return;
  const id = +w.dataset.u;
  if (state.open === id && state.pinned) { closeCard(false); return; }
  openCard(w, { pinned: true, via: e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'click' });
});

$('#passage').addEventListener('keydown', (e) => {
  const w = e.target.closest('[data-u]');
  if (!w) return;
  const all = $$('#passage [data-u]');
  const i = all.indexOf(w);
  let next = null;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': next = all[i + 1]; break;
    case 'ArrowLeft': case 'ArrowUp': next = all[i - 1]; break;
    case 'Home': next = all[0]; break;
    case 'End': next = all[all.length - 1]; break;
    case 'Enter': case ' ':
      e.preventDefault();
      if (state.open === +w.dataset.u && state.pinned) closeCard(false);
      else openCard(w, { pinned: true, via: 'key' });
      return;
    case 'Escape':
      if (!card.hidden) { e.preventDefault(); closeCard(true); }
      return;
    case 'Tab':
      if (!card.hidden && state.open === +w.dataset.u && !e.shiftKey) {
        const f = $('.occ, .strongs, .card-close', card);
        if (f) { e.preventDefault(); f.focus(); }
      }
      return;
    default: return;
  }
  if (next) {
    e.preventDefault();
    setRoving(next);
    next.focus();
    if (!card.hidden && state.pinned) openCard(next, { pinned: true, via: 'key' });
  }
});
$('#passage').addEventListener('focusin', (e) => {
  const w = e.target.closest('[data-u]');
  if (w) setRoving(w);
});

card.addEventListener('click', (e) => {
  if (e.target.closest('.card-close')) { closeCard(true); return; }
  const occ = e.target.closest('[data-occ]');
  if (occ) { e.preventDefault(); toast(`The concordance for ${showStrongs(occ.dataset.occ)} opens here in the full app.`); return; }
  if (e.target.closest('.strongs')) { e.preventDefault(); toast('Opens the full lexicon entry.'); }
});
card.addEventListener('keydown', (e) => {
  const u = state.open >= 0 ? UNITS[state.open] : null;
  if (e.key === 'Escape') { e.preventDefault(); closeCard(true); return; }
  if (e.key === 'Tab' && u?.el) {
    const f = $$('a, button', card);
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); u.el.focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); u.el.focus(); }
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!card.hidden && state.pinned && !e.target.closest('#card, #passage [data-u], .fn')) closeCard(false);
  for (const pop of $$('.pop:not([hidden])')) {
    const owner = pop.dataset.owner ? $(`#${pop.dataset.owner}`) : null;
    if (!pop.contains(e.target) && !(owner && owner.contains(e.target)) && !e.target.closest('#searchBox, #dockPassage, #searchTrigger')) closePop(pop);
  }
});

addEventListener('resize', () => {
  if (!card.hidden && state.open != null) {
    const el = state.open >= 0 ? UNITS[state.open]?.el : $('.fn');
    if (el) placeCard(el);
  }
  for (const pop of $$('.pop:not([hidden])')) positionPop(pop);
});

/* ------------------------------------------------------------------------------------------ */
/* Popovers                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function positionPop(pop) {
  if (narrow()) { pop.style.left = ''; pop.style.top = ''; return; }
  const owner = $(`#${pop.dataset.owner}`);
  if (!owner) return;
  const r = owner.getBoundingClientRect();
  const bar = $('#bar').getBoundingClientRect();
  const vw = root.clientWidth;
  const w = pop.offsetWidth;
  let left = pop.dataset.align === 'right' ? r.right - w : r.left;
  left = Math.max(12, Math.min(left, vw - w - 12));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(bar.bottom + 8)}px`;
}

function openPop(pop, ownerId, html) {
  for (const p of $$('.pop:not([hidden])')) if (p !== pop) closePop(p);
  closeCard(false);
  pop.dataset.owner = ownerId;
  pop.innerHTML = html;
  pop.hidden = false;
  $(`#${ownerId}`)?.setAttribute('aria-expanded', 'true');
  positionPop(pop);
}

function closePop(pop) {
  if (pop.hidden) return;
  pop.hidden = true;
  if (pop.id === 'searchPanel') document.body.classList.remove('searching');
  if (pop.dataset.owner) $(`#${pop.dataset.owner}`)?.setAttribute('aria-expanded', 'false');
  if (pop.id === 'searchPanel') $('#q').setAttribute('aria-expanded', 'false');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = $$('.pop:not([hidden])');
    if (open.length) {
      open.forEach(closePop);
      e.preventDefault();
    } else if (!card.hidden && !e.target.closest('#passage, #card')) {
      closeCard(false);
    }
  }
  if (e.key === '/' && !e.target.closest('input, textarea')) {
    e.preventDefault();
    if (narrow()) openSearch($('#q').value || '', true);
    else $('#q').focus();
  }
});

/* --- passage picker --- */
const HAS = { JHN: [1], GEN: [1], PSA: [23] };
let bookView = { t: state.passage === 'nt' ? 'NT' : 'OT', book: null };

function booksHTML() {
  const head = `<div class="pop-head"><h2>Go to a passage</h2>
    <div class="t-switch" role="group" aria-label="Testament">
      <button type="button" data-t="OT" aria-pressed="${bookView.t === 'OT'}">Old Testament</button>
      <button type="button" data-t="NT" aria-pressed="${bookView.t === 'NT'}">New Testament</button>
    </div></div>`;
  if (bookView.book) {
    const g = BOOK_GROUPS.flatMap((x) => x.books).find((b) => b[0] === bookView.book);
    const chs = Array.from({ length: g[2] }, (_, i) => i + 1);
    return `${head}
      <div class="pop-head" style="padding-top:0"><button class="back" type="button" data-back>${ICON('i-left')}Books</button><h2>${esc(g[1])}</h2><span class="sub">${g[2]} chapters</span></div>
      <div class="chgrid">${chs.map((c) => `<button class="ch${HAS[g[0]]?.includes(c) ? ' has' : ''}" type="button" data-ch="${c}" data-book="${g[0]}" aria-label="${esc(g[1])} ${c}">${c}</button>`).join('')}</div>
      <p class="pop-note">This concept includes John 1, Genesis 1 and Psalm 23 (marked in gold).</p>`;
  }
  const current = state.passage === 'nt' ? ['JHN'] : ['GEN', 'PSA'];
  return `${head}${BOOK_GROUPS.filter((g) => g.t === bookView.t).map((g) => `
    <div class="bgroup"><h3><i class="gem gem-${g.hue}" aria-hidden="true"></i>${esc(g.name)}</h3>
      <div class="bgrid">${g.books.map(([id, name]) => `<button class="bk${HAS[id] ? ' has' : ''}${current.includes(id) ? ' current' : ''}" type="button" data-book="${id}">${esc(name)}</button>`).join('')}</div>
    </div>`).join('')}`;
}

function openBooks(owner = 'passageBtn') {
  bookView = { t: state.passage === 'nt' ? 'NT' : 'OT', book: null };
  openPop($('#passagePop'), owner, booksHTML());
}
$('#passageBtn').addEventListener('click', () => ($('#passagePop').hidden ? openBooks() : closePop($('#passagePop'))));
$('#dockPassage').addEventListener('click', () => ($('#passagePop').hidden ? openBooks('dockPassage') : closePop($('#passagePop'))));
$('#passagePop').addEventListener('click', (e) => {
  const pop = $('#passagePop');
  const t = e.target.closest('[data-t]');
  if (t) { bookView = { t: t.dataset.t, book: null }; pop.innerHTML = booksHTML(); return; }
  if (e.target.closest('[data-back]')) { bookView.book = null; pop.innerHTML = booksHTML(); return; }
  const ch = e.target.closest('[data-ch]');
  if (ch) {
    const b = ch.dataset.book;
    if (HAS[b]?.includes(+ch.dataset.ch)) {
      closePop(pop);
      goPassage(b === 'JHN' ? 'nt' : 'ot');
      if (b === 'PSA') setTimeout(() => $('#h-PSA')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }), 30);
    } else toast('This concept includes John 1, Genesis 1 and Psalm 23.');
    return;
  }
  const bk = e.target.closest('[data-book]');
  if (bk) { bookView.book = bk.dataset.book; pop.innerHTML = booksHTML(); }
});

/* --- translation picker --- */
function trHTML() {
  const badge = { manual: 'Hand-aligned', strongs: 'Strong’s', bridged: 'Approximate' };
  return `<div class="pop-head"><h2>Translation</h2><span class="sub">Every word linked to the original</span></div>
    <ul class="tr-list" role="radiogroup" aria-label="Translation">
      ${TRANSLATIONS.map((t) => `<li><button class="tr-item" type="button" role="radio" aria-checked="${t.id === 'BSB'}" data-tr="${t.id}">
        <span class="tr-id">${t.id}</span>
        <span class="tr-name"><b>${esc(t.name)}</b><small>${esc(t.year)} · ${esc(t.note)}</small></span>
        ${t.id === 'BSB' ? `<span class="tr-check">${ICON('i-check')}</span>` : `<span class="align-badge ${t.align}">${badge[t.align]}</span>`}
      </button></li>`).join('')}
    </ul>
    <p class="tr-sep">With your own key</p>
    <div class="niv">
      <span class="tr-id">NIV</span>
      <span class="tr-name"><b>New International Version</b><small>Copyrighted · read it with a free API.Bible key</small></span>
      <button class="btn btn-glass" type="button" data-connect>${ICON('i-key')}Connect</button>
    </div>`;
}
$('#trBtn').addEventListener('click', () => {
  const pop = $('#trPop');
  if (!pop.hidden) { closePop(pop); return; }
  openPop(pop, 'trBtn', trHTML());
});
$('#trPop').addEventListener('click', (e) => {
  if (e.target.closest('[data-connect]')) { toast('Paste your API.Bible key in Settings; it stays in this browser.'); return; }
  const b = e.target.closest('[data-tr]');
  if (b && b.dataset.tr !== 'BSB') toast(`The concept uses BSB sample data; ${b.dataset.tr} switches the text in the full app.`);
});

/* --- search --- */
function stripSVG() {
  const W = 584;
  const H = 60;
  const n = LOVE_BY_BOOK.length;
  const slot = W / n;
  const bw = slot - 2;
  const max = Math.max(...LOVE_BY_BOOK);
  const names = BOOK_GROUPS.flatMap((g) => g.books.map((b) => b[1]));
  let bars = '';
  LOVE_BY_BOOK.forEach((v, i) => {
    const x = i * slot + 1;
    const cls = i < 39 ? 'bar-ot' : 'bar-nt';
    if (v > 0) {
      const h = Math.max(2, (v / max) * (H - 4));
      const y = H - h;
      const r = Math.min(2, bw / 2, h / 2);
      bars += `<path class="b ${cls}" d="M${x.toFixed(2)} ${H}V${(y + r).toFixed(2)}Q${x.toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)}H${(x + bw - r).toFixed(2)}Q${(x + bw).toFixed(2)} ${y.toFixed(2)} ${(x + bw).toFixed(2)} ${(y + r).toFixed(2)}V${H}Z"/>`;
    }
    bars += `<rect class="hit" x="${(i * slot).toFixed(2)}" y="0" width="${slot.toFixed(2)}" height="${H}" data-i="${i}"><title>${names[i]}: ${v} verses</title></rect>`;
  });
  const psX = 18 * slot + slot / 2;
  return `<svg viewBox="0 0 ${W} ${H + 1}" role="img" aria-label="Verses containing love, by book: highest in Psalms (160), John (39), Proverbs (33) and 1 John (26).">
    <line class="base" x1="0" x2="${W}" y1="${H + 0.5}" y2="${H + 0.5}"/>
    ${bars}
  </svg><span class="strip-peak" style="left:${((psX / W) * 100).toFixed(2)}%"><b>Psalms 160</b> · mostly <i>ḥesed</i>, “loving devotion”</span>`;
}

function highlight(text) {
  return esc(text)
    .replace(/\[\[(.+?)\]\]/g, '<mark>$1</mark>')
    .replace(/\bLORD\b/g, '<span class="lord">Lord</span>');
}

function searchLoveHTML() {
  const ot = LOVE_BY_BOOK.slice(0, 39).reduce((a, b) => a + b, 0);
  const nt = LOVE_BY_BOOK.slice(39).reduce((a, b) => a + b, 0);
  return `<div class="s-head"><h2>Results for <q>love</q></h2><span class="sub">${(ot + nt).toLocaleString('en-US')} verses · 710 matches · BSB</span></div>
    <div class="s-filters" role="group" aria-label="Filter results">
      <button class="chip" type="button" aria-pressed="true"><span class="chip-tick">${ICON('i-check')}</span>All <span class="n">${ot + nt}</span></button>
      <button class="chip" type="button" aria-pressed="false"><span class="chip-tick">${ICON('i-check')}</span>Old Testament <span class="n">${ot}</span></button>
      <button class="chip" type="button" aria-pressed="false"><span class="chip-tick">${ICON('i-check')}</span>New Testament <span class="n">${nt}</span></button>
    </div>
    <section class="s-sec"><h3>Behind the English<span class="aside">5 original words</span></h3>
      <div class="lemmas">${LOVE_WORDS.map((l) => `<button class="lemma" type="button" data-lang="${l.lang}">
        <span class="lw-row"><span class="lw" lang="${l.lang === 'hbo' ? 'he' : 'grc'}">${esc(l.word)}</span><span class="lt">${esc(l.translit)}</span></span>
        <span class="lg">${esc(l.gloss)}</span>
        <span class="ln"><b>${l.strongs}</b><span>${l.n}× in the ${l.lang === 'hbo' ? 'OT' : 'NT'}</span></span>
      </button>`).join('')}</div>
    </section>
    <section class="s-sec"><h3>Where it appears<span class="aside">verses per book, Genesis → Revelation</span></h3>
      <div class="strip-legend"><span><i style="background:var(--chart-ot)"></i>Old Testament · ${ot}</span><span><i style="background:var(--chart-nt)"></i>New Testament · ${nt}</span></div>
      <div class="strip" id="strip">${stripSVG()}<div class="strip-tip" hidden></div></div>
      <div class="strip-labels"><span>Genesis</span><span class="mid">Matthew</span><span>Revelation</span></div>
    </section>
    <section class="s-sec"><h3>Verses<span class="aside">canonical order · best matches first</span></h3>
      <ul class="results">${LOVE_RESULTS.map((r) => `<li><button class="res" type="button" data-ref="${esc(r.ref)}">
        <span class="res-top"><span class="res-ref">${esc(r.ref)}</span><span class="res-orig" lang="${r.lang === 'hbo' ? 'he' : 'grc'}">${esc(r.orig)}</span><span class="res-s">${esc(r.strongs)}</span>${r.note ? `<span class="res-note">${esc(r.note)}</span>` : ''}</span>
        <span class="res-text">${highlight(r.text)}</span>
      </button></li>`).join('')}</ul>
    </section>
    <div class="s-foot"><button class="occ" type="button">See all 618 verses ${ICON('i-arrow')}</button>
      <span class="tips">Try <code>ἀγάπη</code> <code>G26</code> <code>“steadfast love”</code></span></div>`;
}

function searchGenericHTML(q) {
  const ql = q.toLowerCase().trim();
  const words = [];
  const seenS = new Set();
  for (const [id, w] of Object.entries(ORIG)) {
    if (seenS.has(w.strongs) || !w.strongs) continue;
    const hay = [cleanGloss(w.gloss), w.lemma, cleanOrig(w.text), w.translit || '', isHebId(id) ? '' : greekTranslit(w.lemma), showStrongs(w.strongs)].join(' ').toLowerCase();
    if (hay.includes(ql)) {
      seenS.add(w.strongs);
      words.push({ id, w });
    }
  }
  const verses = [];
  for (const [vid, v] of Object.entries(VERSES)) {
    const text = v.tokens.map((t) => t.text + (t.space_after ? ' ' : '')).join('').trim();
    const re = new RegExp(`\\b(${ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)`, 'gi');
    if (re.test(text)) verses.push({ vid, html: esc(text).replace(re, '<mark>$1</mark>').replace(/\bLORD\b/g, '<span class="lord">Lord</span>') });
  }
  if (!words.length && !verses.length) {
    return `<div class="s-head"><h2>Results for <q>${esc(q)}</q></h2></div><p class="s-empty">Nothing in this concept’s sample passages. Try <b>love</b>, <b>light</b>, <b>God</b> or <b>λόγος</b>.</p>`;
  }
  return `<div class="s-head"><h2>Results for <q>${esc(q)}</q></h2><span class="sub">${verses.length} verses in the sample passages</span></div>
    ${words.length ? `<section class="s-sec"><h3>Original words</h3><div class="lemmas">${words.slice(0, 6).map(({ id, w }) => {
      const heb = isHebId(id);
      return `<button class="lemma" type="button" data-lang="${heb ? 'hbo' : 'grc'}">
        <span class="lw-row"><span class="lw" lang="${heb ? 'he' : 'grc'}">${esc(DEFS[w.strongs]?.form?.split(',')[0] || w.lemma)}</span><span class="lt">${esc(heb ? cleanTranslit(w.translit) : greekTranslit(w.lemma))}</span></span>
        <span class="lg">${esc(cleanGloss(w.gloss))}</span>
        <span class="ln"><b>${showStrongs(w.strongs)}</b>${COUNTS[w.strongs] ? `<span>${COUNTS[w.strongs].toLocaleString('en-US')}×</span>` : ''}</span>
      </button>`;
    }).join('')}</div></section>` : ''}
    ${verses.length ? `<section class="s-sec"><h3>Verses</h3><ul class="results">${verses.map((v) => `<li><button class="res" type="button" data-ref="${refOf(v.vid)}" data-vid="${v.vid}">
      <span class="res-top"><span class="res-ref">${refOf(v.vid)}</span></span><span class="res-text">${v.html}</span></button></li>`).join('')}</ul></section>` : ''}`;
}

function openSearch(q, focusPanelInput = false) {
  const pop = $('#searchPanel');
  const inner = q.trim().toLowerCase().startsWith('lov') ? searchLoveHTML() : q.trim() ? searchGenericHTML(q) : `<div class="s-head"><h2>Search the Bible</h2></div><p class="s-empty">Words, phrases, references (<b>Jn 3:16</b>), Greek or Hebrew (<b>λόγος</b>), or Strong’s numbers (<b>G3056</b>).</p>`;
  const mobileInput = `<div class="s-mobile-input"><div class="search">${ICON('i-search')}<input id="q2" type="search" value="${esc(q)}" placeholder="Search words, verses, Greek…" aria-label="Search the Bible" autocomplete="off"><button class="card-close" type="button" data-close-search aria-label="Close search">${ICON('i-close')}</button></div></div>`;
  if (pop.hidden) openPop(pop, 'searchBox', mobileInput + inner);
  else { pop.innerHTML = mobileInput + inner; positionPop(pop); }
  pop.dataset.align = 'right';
  document.body.classList.add('searching');
  positionPop(pop);
  $('#q').setAttribute('aria-expanded', 'true');
  if (focusPanelInput && narrow()) $('#q2')?.focus();
  wireStrip();
}

function wireStrip() {
  const strip = $('#strip');
  if (!strip) return;
  const tip = $('.strip-tip', strip);
  const names = BOOK_GROUPS.flatMap((g) => g.books.map((b) => b[1]));
  const bars = $$('path.b', strip);
  strip.addEventListener('pointermove', (e) => {
    const hit = e.target.closest('.hit');
    if (!hit) { tip.hidden = true; return; }
    const i = +hit.dataset.i;
    const svgR = strip.querySelector('svg').getBoundingClientRect();
    const sr = strip.getBoundingClientRect();
    tip.innerHTML = `<b>${names[i]}</b> · ${LOVE_BY_BOOK[i]} verses`;
    tip.style.left = `${svgR.left - sr.left + ((i + 0.5) / 66) * svgR.width}px`;
    tip.hidden = false;
    bars.forEach((b) => b.classList.remove('hot'));
  });
  strip.addEventListener('pointerleave', () => { tip.hidden = true; });
}

$('#q').addEventListener('input', (e) => {
  const v = e.target.value;
  if (v.trim()) openSearch(v);
  else closePop($('#searchPanel'));
});
$('#q').addEventListener('focus', (e) => { if (e.target.value.trim()) openSearch(e.target.value); });
$('#searchTrigger').addEventListener('click', () => openSearch($('#q').value || '', true));
$('#searchPanel').addEventListener('input', (e) => {
  if (e.target.id === 'q2') {
    $('#q').value = e.target.value;
    const pos = e.target.selectionStart;
    openSearch(e.target.value);
    const i2 = $('#q2');
    i2.focus();
    i2.setSelectionRange(pos, pos);
  }
});
$('#searchPanel').addEventListener('click', (e) => {
  if (e.target.closest('[data-close-search]')) { closePop($('#searchPanel')); return; }
  const r = e.target.closest('[data-ref]');
  if (r) {
    const vid = r.dataset.vid;
    if (vid && !vid.startsWith('43003')) {
      closePop($('#searchPanel'));
      goPassage(vid.startsWith('43') ? 'nt' : 'ot');
      setTimeout(() => $(`#v${vid}`)?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }), 30);
    } else toast(`${r.dataset.ref} opens in the reader in the full app.`);
    return;
  }
  if (e.target.closest('.lemma')) toast('Opens a word study: every verse, every English rendering.');
  const chip = e.target.closest('.s-filters .chip');
  if (chip) {
    for (const c of $$('.s-filters .chip', $('#searchPanel'))) c.setAttribute('aria-pressed', String(c === chip));
  }
});

/* ------------------------------------------------------------------------------------------ */
/* Chrome: theme, mode, tabs, dock, toast                                                      */
/* ------------------------------------------------------------------------------------------ */

function syncThemeBtn() {
  const dark = root.dataset.theme === 'dark';
  $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to daylight theme' : 'Switch to night theme');
  $('#themeBtn').title = dark ? 'Daylight' : 'Night';
}
$('#themeBtn').addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  syncThemeBtn();
});

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  render();
}
for (const b of $$('#modeSeg [role=radio]')) b.addEventListener('click', () => setMode(b.dataset.mode));
$('#modeSeg').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    setMode(state.mode === 'read' ? 'interlinear' : 'read');
    $(`#modeSeg [data-mode="${state.mode}"]`).focus();
  }
});
$('#dockMode').addEventListener('click', () => setMode(state.mode === 'read' ? 'interlinear' : 'read'));

for (const c of $$('#ilOpts [data-il]')) {
  c.addEventListener('click', () => {
    const k = c.dataset.il;
    if (!(k in state.il)) return;
    state.il[k] = !state.il[k];
    render();
  });
}

function goPassage(p) {
  if (state.passage === p) return;
  state.passage = p;
  render();
  scrollTo({ top: 0 });
}
for (const t of $$('#passageTabs [role=tab]')) t.addEventListener('click', () => goPassage(t.dataset.p));
$('#passageTabs').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    goPassage(state.passage === 'nt' ? 'ot' : 'nt');
    $(`#tab-${state.passage}`).focus();
  }
});

for (const id of ['prevCh', 'nextCh', 'dockPrev', 'dockNext']) {
  $(`#${id}`).addEventListener('click', (e) => {
    e.preventDefault();
    toast('This concept includes John 1, Genesis 1 and Psalm 23.');
  });
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ------------------------------------------------------------------------------------------ */
/* Boot                                                                                        */
/* ------------------------------------------------------------------------------------------ */

async function boot() {
  syncThemeBtn();
  try {
    const res = await fetch('../../sample.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    VERSES = Object.fromEntries(data.verses.map((v) => [v.id, v]));
    ORIG = data.orig;
  } catch (err) {
    $('#passage').innerHTML = `<p class="loading">Could not load design/sample.json (${esc(err.message)}). Serve the repository root over HTTP.</p>`;
    return;
  }
  render();
  await document.fonts.ready;

  if (DEMO === 'hover' || DEMO === 'hover-ot') {
    const [vid, word] = DEMO === 'hover' ? ['43001001', 'Word'] : ['01001001', 'God'];
    const u = UNITS.find((x) => x.vid === vid && x.text === word);
    if (u?.el) openCard(u.el, { pinned: true, via: 'demo', animate: false });
  } else if (DEMO === 'search') {
    $('#q').value = 'love';
    openSearch('love');
  } else if (DEMO === 'books') {
    openBooks();
  } else if (DEMO === 'translations') {
    openPop($('#trPop'), 'trBtn', trHTML());
  } else if (DEMO === 'note') {
    const fn = $('.fn');
    if (fn) openNote(fn);
  } else if (DEMO === 'supplied') {
    const u = UNITS.find((x) => x.kind === 'sup');
    if (u?.el) openCard(u.el, { pinned: true, via: 'demo', animate: false });
  } else if (DEMO === 'phrase' || DEMO === 'phrase-ot') {
    const vid = DEMO === 'phrase' ? '43001001' : '01001001';
    const text = DEMO === 'phrase' ? 'the beginning' : 'In the beginning';
    const u = UNITS.find((x) => x.vid === vid && x.text === text);
    if (u?.el) openCard(u.el, { pinned: true, via: 'demo', animate: false });
  }
  // Layout can shift once fonts settle; keep the card glued to its word.
  if (!card.hidden && state.open != null) {
    const el = state.open >= 0 ? UNITS[state.open]?.el : $('.fn');
    if (el) placeCard(el);
  }
  root.dataset.ready = '1';
}

boot();
