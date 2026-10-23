/* Rootword — concept "Scholar". Vanilla ES module; renders design/sample.json (+ data.js extras). */

const D = window.SCHOLAR_DATA;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const params = new URLSearchParams(location.search);
const demos = new Set((params.get('demo') || '').split(/[,+ ]/).filter(Boolean));
const mqSheet = matchMedia('(max-width: 640px)');

const state = {
  passage: params.get('passage') === 'ot' || demos.has('hover-ot') || /^o/.test(params.get('word') || '') ? 'ot' : 'nt',
  mode: demos.has('interlinear') || params.get('mode') === 'interlinear' ? 'interlinear' : 'read',
  il: { orig: true, translit: true, gloss: false, parse: false, strongs: false },
};

/* ------------------------------------------------------------------ helpers */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Escape English text and set the divine name (LORD / GOD for YHWH) in small capitals, as printed Bibles do. */
const typo = (s) => esc(s).replace(/\b(L)(ORD)\b|\b(G)(OD)\b/g, (m, a, b, c, d) => `<span class="lord">${a || c}<span class="sc">${b || d}</span></span>`);
const bookById = Object.fromEntries(D.books.map((b, i) => [b[0], { id: b[0], name: b[1], short: b[2], t: b[3], chapters: b[4], num: i + 1 }]));
const bookByNum = (n) => bookById[D.books[n - 1][0]];
const stripCant = (s) => String(s || '').replace(/[֑-ֽ֯׀׃׆]/g, '');
const showSid = (s) => String(s || '').replace(/^([GH])0+(?=\d)/, '$1');
const baseSid = (s) => String(s || '').replace(/[a-z]$/, '');
const cleanGloss = (g) => String(g || '').replace(/\*/g, '').replace(/[[\]]/g, '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
/** Dictionary gloss for compact lists: STEPBible writes "base: sense" ("land: soil"); keep the base. */
const dictGloss = (g) => cleanGloss(String(g || '').split(':')[0]);
const cleanTranslit = (t) => String(t || '').replace(/[:]/g, '').replace(/-$/, '');
const ord = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd' })[n] || n;
const fmt = (n) => n.toLocaleString('en-US');
const isHeb = (o) => /^H/.test(o.strongs || '') || /[֐-׿]/.test(o.text);

/** SBL-style transliteration of a Greek word. */
function translitGreek(s) {
  const n = String(s).normalize('NFD');
  const rough = /̔/.test(n);
  const base = n.replace(/[̀-ͯ]/g, '').toLowerCase();
  const M = { α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'ē', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'ō' };
  let out = '';
  for (let i = 0; i < base.length; i++) {
    const c = base[i], prev = base[i - 1], next = base[i + 1] || '';
    if (c === 'γ' && 'γκξχ'.includes(next) && next) { out += 'n'; continue; }
    if (c === 'υ' && prev && 'αεηο'.includes(prev)) { out += 'u'; continue; }
    out += M[c] ?? c;
  }
  if (rough) out = out[0] === 'r' ? 'rh' + out.slice(1) : 'h' + out;
  return out;
}

/* ------------------------------------------------------- morphology → prose */
const G_CASE = { N: 'nominative', G: 'genitive', D: 'dative', A: 'accusative', V: 'vocative' };
const G_NUM = { S: 'singular', P: 'plural' };
const G_GEN = { M: 'masculine', F: 'feminine', N: 'neuter' };
const G_TENSE = { P: 'present', I: 'imperfect', F: 'future', A: 'aorist', R: 'perfect', L: 'pluperfect' };
const G_VOICE = { A: 'active', M: 'middle', P: 'passive', E: 'middle or passive', D: 'middle', O: 'passive', N: 'middle or passive' };
const G_MOOD = { I: 'indicative', S: 'subjunctive', O: 'optative', M: 'imperative', N: 'infinitive', P: 'participle' };
const G_POS = { N: 'Noun', A: 'Adjective', T: 'Article', P: 'Personal pronoun', R: 'Relative pronoun', D: 'Demonstrative pronoun', C: 'Reciprocal pronoun', F: 'Reflexive pronoun', I: 'Interrogative pronoun', X: 'Indefinite pronoun', Q: 'Correlative pronoun', K: 'Correlative pronoun', S: 'Possessive pronoun', V: 'Verb' };
const G_CLASS = { ADV: 'Adverb', CONJ: 'Conjunction', PREP: 'Preposition', PRT: 'Particle', INJ: 'Interjection', COND: 'Conditional particle', ARAM: 'Aramaic word', HEB: 'Hebrew word' };

function parseGreek(code) {
  const parts = String(code || '').split('-');
  const head = parts[0];
  if (G_CLASS[head]) {
    const pos = G_CLASS[head];
    if (parts[1] === 'N') return { pos: `${pos} · negative`, short: pos.toLowerCase() };
    return { pos, short: pos.toLowerCase() };
  }
  if (head === 'V') {
    let tvm = parts[1] || '';
    let second = '';
    if (tvm[0] === '2') { second = '2nd '; tvm = tvm.slice(1); }
    const bits = [second + (G_TENSE[tvm[0]] || ''), G_VOICE[tvm[1]], G_MOOD[tvm[2]]].filter(Boolean).join(' ');
    const pn = parts[2] || '';
    let tail = '';
    if (/^[123]/.test(pn)) tail = `${ord(pn[0])} person ${G_NUM[pn[1]] || ''}`;
    else if (pn) tail = [G_CASE[pn[0]], G_GEN[pn[2]], G_NUM[pn[1]]].filter(Boolean).join(' ');
    return { pos: 'Verb', detail: [bits, tail].filter(Boolean).join(' · '), short: 'verb' };
  }
  const c = parts[1] || '';
  const detail = /^[123]/.test(c)
    ? `${ord(c[0])} person ${G_CASE[c[1]] || ''} ${G_NUM[c[2]] || ''}`.trim()
    : [G_CASE[c[0]], G_GEN[c[2]], G_NUM[c[1]]].filter(Boolean).join(' ');
  const pos = G_POS[head] || head;
  return { pos, detail, short: pos.toLowerCase() };
}

const H_STEM = { q: 'Qal', N: 'Niphal', p: 'Piel', P: 'Pual', h: 'Hiphil', H: 'Hophal', t: 'Hithpael', o: 'Polel', O: 'Polal', r: 'Hithpolel', m: 'Poel', M: 'Poal', k: 'Palel', K: 'Pulal', Q: 'Qal passive', l: 'Pilpel', L: 'Polpal', f: 'Hithpalpel', D: 'Nithpael', j: 'Pealal', i: 'Pilel', u: 'Hothpaal', c: 'Tiphil', v: 'Hishtaphel', w: 'Nithpalel', y: 'Nithpoel', z: 'Hithpoel' };
const H_CONJ = { p: 'perfect', q: 'sequential perfect', i: 'imperfect', w: 'wayyiqtol (narrative past)', h: 'cohortative', j: 'jussive', v: 'imperative', r: 'participle', s: 'passive participle', a: 'infinitive absolute', c: 'infinitive construct' };
const H_GEN = { m: 'masculine', f: 'feminine', c: 'common', b: 'common' };
const H_NUM = { s: 'singular', p: 'plural', d: 'dual' };
const H_STATE = { a: 'absolute', c: 'construct', d: 'determined' };
const pgn = (s) => /^[123]/.test(s)
  ? `${ord(s[0])} person ${H_GEN[s[1]] || ''} ${H_NUM[s[2]] || ''}`.replace(/\s+/g, ' ').trim()
  : [H_GEN[s[0]], H_NUM[s[1]], H_STATE[s[2]]].filter(Boolean).join(' ');

function parseHebrew(code) {
  const k = (code || '')[0], r = (code || '').slice(1);
  switch (k) {
    case 'N':
      if (r[0] === 'p') return { pos: 'Proper noun', detail: '', short: 'name' };
      return { pos: r[0] === 'g' ? 'Noun · gentilic' : 'Noun', detail: pgn(r.slice(1)), short: 'noun' };
    case 'V':
      return { pos: 'Verb', detail: [`${H_STEM[r[0]] || ''} ${H_CONJ[r[1]] || ''}`.trim(), pgn(r.slice(2))].filter(Boolean).join(' · '), short: 'verb' };
    case 'A':
      return { pos: { a: 'Adjective', c: 'Cardinal number', g: 'Gentilic adjective', o: 'Ordinal number' }[r[0]] || 'Adjective', detail: pgn(r.slice(1)), short: 'adj.' };
    case 'P':
      return { pos: `${{ d: 'Demonstrative', f: 'Indefinite', i: 'Interrogative', p: 'Personal', r: 'Relative' }[r[0]] || ''} pronoun`.trim(), detail: pgn(r.slice(1)), short: 'pron.' };
    case 'R': return { pos: 'Preposition', detail: r === 'd' ? 'with article' : 'prefixed', short: 'prep.' };
    case 'C': return { pos: 'Conjunction', detail: 'prefixed', short: 'conj.' };
    case 'D': return { pos: 'Adverb', detail: '', short: 'adv.' };
    case 'T': {
      const p = { a: 'Affirmation particle', d: 'Definite article', e: 'Exhortation particle', i: 'Interrogative particle', j: 'Interjection', m: 'Demonstrative particle', n: 'Negative particle', o: 'Direct-object marker', r: 'Relative particle' }[r[0]] || 'Particle';
      return { pos: p, detail: r[0] === 'd' ? 'prefixed' : '', short: r[0] === 'd' ? 'article' : 'particle' };
    }
    case 'S': {
      const p = { d: 'Directional ending', h: 'Paragogic he', n: 'Paragogic nun', p: 'Pronominal suffix' }[r[0]] || 'Suffix';
      return { pos: p, detail: pgn(r.slice(1)), short: 'suffix' };
    }
    default: return { pos: code || '—', detail: '', short: '' };
  }
}
const parseMorph = (o) => (isHeb(o) ? parseHebrew(o.morph) : parseGreek(o.morph));
const FUNCTION_G = /^(T-|CONJ|PREP|PRT|P-|R-|D-|ADV|COND|INJ)/;
const FUNCTION_H = /^(R|C|Td|To|Tn|S|Pp)/;
const isFunctionWord = (o) => (isHeb(o) ? FUNCTION_H.test(o.morph) : FUNCTION_G.test(o.morph)) || (o.strongs || '').startsWith('G2258') || o.lemma === 'εἰμί' || o.lemma === 'הָיָה';

/* ---------------------------------------------------------------- the model */
const sample = await fetch('../../sample.json').then((r) => r.json());
const ORIG = {};
for (const [id, o] of Object.entries(sample.orig)) {
  ORIG[id] = { ...o, id, w: id.startsWith('o') ? id.slice(0, -1) : id, ord: Number(id.slice(1)) };
}
for (const [id, o] of Object.entries(D.orig)) ORIG[id] = { ...o, id, ord: Number(id.split(':')[1]) };
const WORDS_BY_W = {};
for (const o of Object.values(ORIG)) (WORDS_BY_W[o.w] ||= []).push(o);
for (const list of Object.values(WORDS_BY_W)) list.sort((a, b) => a.ord - b.ord);

const sampleById = Object.fromEntries(sample.verses.map((v) => [v.id, v]));
function sampleTokens(v) {
  const out = [];
  for (const t of v.tokens) {
    if (t.punct || !t.orig.length) out.push(t.text + (t.space_after ? ' ' : ''));
    else { out.push([t.text, t.orig]); if (t.space_after) out.push(' '); }
  }
  return out;
}
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

let GID = 0;
const GROUPS = new Map();
/** Merge consecutive words that share exactly the same original word(s) into one group ("the beginning" → ἀρχῇ). */
function groupTokens(tokens, ref) {
  const out = [];
  for (const t of tokens) {
    if (typeof t === 'string') { out.push({ kind: 'text', text: t }); continue; }
    const [text, ids, info] = t;
    if ((info && info.i) || !ids || !ids.length) { out.push({ kind: 'sup', text }); continue; }
    const prev = out[out.length - 1], prev2 = out[out.length - 2];
    if (prev && prev.kind === 'w' && sameIds(prev.ids, ids)) { prev.words.push(text); prev.text += text; continue; }
    if (prev && prev.kind === 'text' && /^\s+$/.test(prev.text) && prev2 && prev2.kind === 'w' && sameIds(prev2.ids, ids)) {
      out.pop(); prev2.words.push(text); prev2.text += prev.text + text; continue;
    }
    const g = { kind: 'w', gid: ++GID, ids, words: [text], text, ref };
    GROUPS.set(g.gid, g);
    out.push(g);
  }
  for (const g of out) if (g.kind === 'w') enrich(g);
  return out;
}

/** Work out what the card needs for a group: primary word, display form, translit, etc. */
function enrich(g) {
  const linked = g.ids.map((id) => ORIG[id]).filter(Boolean);
  g.heb = linked.some(isHeb);
  const content = linked.filter((o) => !(g.heb ? FUNCTION_H.test(o.morph) && !/^Tn/.test(o.morph) : false));
  g.primary = g.heb ? (content.length ? content[content.length - 1] : linked[linked.length - 1])
    : (linked.find((o) => /^(N|V|A)-/.test(o.morph)) || linked[linked.length - 1]);
  if (g.heb) {
    const ws = [...new Set(linked.map((o) => o.w))];
    g.written = ws.map((w) => WORDS_BY_W[w]);
    g.display = g.written.map((ms) => stripCant(ms.map((m) => m.text).join(''))).join(' ');
    g.translit = g.written.map((ms) => ms.map((m) => cleanTranslit(m.translit)).join('')).join(' ').trim();
    if (!g.translit) g.translit = (D.lex[g.primary?.strongs] || D.lex[baseSid(g.primary?.strongs)] || {}).translit || '';
    g.gloss = cleanGloss(linked.map((o) => o.gloss).join(' '));
  } else {
    const ordered = [...linked].sort((a, b) => a.ord - b.ord);
    g.display = ordered.map((o) => o.text).join(' ');
    g.translit = ordered.map((o) => translitGreek(o.text)).join(' ');
    g.gloss = cleanGloss(ordered.map((o) => o.gloss).join(' '));
  }
  g.sids = [...new Set(linked.map((o) => baseSid(o.strongs)).filter(Boolean))];
  g.mainSid = baseSid(g.primary?.strongs);
}

/* ------------------------------------------------------------------ render */
const textEl = $('#text');
const PASSAGE_SETS = { nt: ['john1'], ot: ['gen1', 'ps23'] };
const EYEBROW = { JHN: 'New Testament · Gospel', GEN: 'Old Testament · Torah', PSA: 'Old Testament · Writings' };

function passageModel(pid) {
  const P = D.passages[pid];
  const book = bookById[P.book];
  const verses = P.verses.map((v) => {
    const toks = v.sample ? sampleTokens(sampleById[v.sample]) : v.t;
    return { v: v.v, items: groupTokens(toks, `${book.name === 'Psalms' ? 'Psalm' : book.name} ${P.chapter}:${v.v}`) };
  });
  const sup = P.superscription ? groupTokens(P.superscription, `${book.name === 'Psalms' ? 'Psalm' : book.name} ${P.chapter}:title`) : null;
  return { ...P, pid, bookInfo: book, verses, sup };
}

let MODELS = {};
function buildModels() {
  GID = 0; GROUPS.clear(); MODELS = {};
  for (const pid of Object.keys(D.passages)) MODELS[pid] = passageModel(pid);
}

function wordHTML(g) {
  const attrs = `class="w" data-gid="${g.gid}" tabindex="0" role="button" aria-haspopup="dialog"`;
  if (state.mode === 'read') return `<span ${attrs}>${typo(g.text)}</span>`;
  const lang = g.heb ? 'hbo' : 'grc';
  const lines = [`<span class="u__en">${typo(g.text)}</span>`];
  if (state.il.orig) lines.push(`<span class="u__or ${lang}" lang="${lang}"${g.heb ? ' dir="rtl"' : ''}>${esc(g.display)}</span>`);
  if (state.il.translit) lines.push(`<span class="u__tr">${esc(g.translit)}</span>`);
  if (state.il.gloss) lines.push(`<span class="u__gl">${esc(g.gloss || '—')}</span>`);
  if (state.il.parse) lines.push(`<span class="u__pa">${esc(g.primary?.morph || '')}</span>`);
  if (state.il.strongs) lines.push(`<span class="u__sn">${esc(showSid(g.primary?.strongs))}</span>`);
  return `<span ${attrs.replace('class="w"', `class="w u${g.words.length > 1 ? ' is-multi' : ''}"`)}>${lines.join('')}</span>`;
}

/** Interlinear: punctuation sticks to the English line of the neighbouring unit. */
function itemsHTML(items) {
  if (state.mode === 'read') {
    return items.map((it) => it.kind === 'w' ? wordHTML(it) : it.kind === 'sup' ? `<span class="supplied">${typo(it.text)}</span>` : typo(it.text)).join('');
  }
  const units = [];
  let pendingPrefix = '';
  for (const it of items) {
    if (it.kind === 'text') {
      const m = it.text.match(/^(\S*)(\s*)([\s\S]*?)$/);
      const lead = m[1], rest = (m[3] || '').trim();
      if (lead && units.length) units[units.length - 1].suffix += lead;
      else if (lead) pendingPrefix += lead;
      if (rest) pendingPrefix += rest;
      continue;
    }
    units.push({ it, prefix: pendingPrefix, suffix: '' });
    pendingPrefix = '';
  }
  return units.map(({ it, prefix, suffix }) => {
    if (it.kind === 'sup') {
      return `<span class="u supplied"><span class="u__en">${esc(prefix + it.text + suffix)}</span>${state.il.orig ? '<span class="u__or">—</span>' : ''}</span>`;
    }
    const saved = it.text;
    it.text = prefix + saved + suffix;
    const html = wordHTML(it);
    it.text = saved;
    return html;
  }).join('');
}

function headingsInRange(P) {
  return P.headings.filter(([v]) => v >= P.from && v <= P.to);
}

function renderPassage(P) {
  const b = P.bookInfo;
  const title = b.id === 'PSA' ? 'Psalm' : b.name;
  const heads = headingsInRange(P);
  const headAt = Object.fromEntries(heads.map(([v, t]) => [v, t]));
  const nextHead = (v) => { const n = P.headings.find(([hv]) => hv > v); return n ? Math.min(n[0] - 1, P.to) : P.to; };
  const paraSet = new Set(P.paras);
  const poetry = b.id === 'PSA';
  const lang = b.t === 'NT' ? 'Greek' : 'Hebrew';
  const ed = b.t === 'NT' ? 'SBLGNT' : 'WLC';

  let html = `<section class="passage" id="p-${P.pid}" aria-labelledby="t-${P.pid}">
    <header class="ch-head">
      <p class="eyebrow">${esc(EYEBROW[b.id] || '')}</p>
      <h1 class="ch-title" id="t-${P.pid}"><span>${esc(title)}</span><span class="num">${P.chapter}</span></h1>
      <span class="ch-rule" aria-hidden="true"></span>
      <p class="ch-meta"><b>Berean Standard Bible</b><span class="dot"></span><span>${lang} · ${ed}</span><span class="dot"></span><span>Hand-aligned</span><span class="dot"></span><span class="tnum">Verses ${P.from}–${P.to} of ${P.verseCount}</span></p>
      ${P === firstModel() ? `<div class="ch-tools">${modeSwitchHTML()}</div>` : ''}
    </header>`;
  if (P === firstModel()) html += ilBarHTML();
  html += '<div class="prose">';
  const supHTML = P.sup ? `<p class="superscription">${itemsHTML(P.sup)}</p>` : '';
  if (supHTML && !headAt[P.from]) html += supHTML;

  let open = false;
  let firstInPara = true;
  for (const V of P.verses) {
    const h = headAt[V.v];
    const newPara = V.v === P.from || paraSet.has(V.v) || h || poetry;
    if (newPara) {
      if (open) html += '</p>';
      if (h) html += `<h2 class="sec" id="s-${P.pid}-${V.v}"><span class="sec__title">${esc(h)}</span><span class="sec__ref">${P.chapter}:${V.v}–${nextHead(V.v)}</span></h2>`;
      if (h && V.v === P.from) html += supHTML;
      firstInPara = Boolean(h) || V.v === P.from;
      html += `<p class="${firstInPara ? 'first' : ''}${poetry ? ' verse-line' : ''}">`;
      open = true;
    } else {
      html += state.mode === 'read' ? ' ' : '';
    }
    html += `<span class="vnum" id="v-${P.pid}-${V.v}" aria-label="Verse ${V.v}">${V.v}</span>`;
    if (poetry && state.mode === 'read') {
      // break psalm verses into cola at the semicolon
      const parts = [[]];
      for (const it of V.items) {
        parts[parts.length - 1].push(it);
        if (it.kind === 'text' && /;\s*$/.test(it.text)) parts.push([]);
      }
      html += parts.filter((p) => p.length).map((p, i) => `<span class="colon${i ? ' cont' : ''}">${itemsHTML(p).trim()}</span>`).join('');
    } else {
      html += itemsHTML(V.items).replace(/\s+$/, '');
    }
  }
  if (open) html += '</p>';
  html += '</div></section>';
  return html;
}

const firstModel = () => MODELS[PASSAGE_SETS[state.passage][0]];

function modeSwitchHTML() {
  return `<div class="seg" role="group" aria-label="Reading mode">
    <button type="button" data-mode="read" aria-pressed="${state.mode === 'read'}"><svg class="icon"><use href="#i-text"/></svg>Reading</button>
    <button type="button" data-mode="interlinear" aria-pressed="${state.mode === 'interlinear'}"><svg class="icon"><use href="#i-inter"/></svg>Interlinear</button>
  </div>`;
}

function ilBarHTML() {
  const opt = (k, label) => `<label class="chk"><input type="checkbox" data-il="${k}"${state.il[k] ? ' checked' : ''}>${label}</label>`;
  const lang = state.passage === 'nt' ? 'Greek' : 'Hebrew';
  return `<div class="il-bar" role="group" aria-label="Interlinear lines">
    <span class="lbl">Show</span>${opt('orig', lang)}${opt('translit', 'Transliteration')}${opt('gloss', 'Gloss')}${opt('parse', 'Parsing')}${opt('strongs', 'Strong’s')}
    <span class="note">in English word order</span>
  </div>`;
}

function apparatusHTML(models) {
  const counts = new Map();
  for (const P of models) {
    for (const V of P.verses) for (const it of V.items) {
      if (it.kind !== 'w' || !it.primary || isFunctionWord(it.primary)) continue;
      const sid = it.mainSid;
      if (!sid) continue;
      const c = counts.get(sid) || { n: 0, first: it.gid, o: it.primary };
      c.n++;
      counts.set(sid, c);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).slice(0, 9);
  const label = models.map((P) => `${P.bookInfo.id === 'PSA' ? 'Psalm' : P.bookInfo.name} ${P.chapter}:${P.from}–${P.to}`).join(' · ');
  return `<section class="apparatus" aria-labelledby="app-h">
    <div class="apparatus__head"><p class="eyebrow" id="app-h">Key words in this passage</p><span>${esc(label)}</span></div>
    <ul class="lexlist">${top.map(([sid, c]) => {
      const L = D.lex[sid] || D.lex[sid + 'a'] || {};
      const heb = sid.startsWith('H');
      const lemma = heb ? stripCant(L.lemma || c.o.lemma) : (L.lemma || c.o.lemma);
      return `<li><button type="button" data-sid="${sid}" aria-label="${esc(`${lemma}, ${L.gloss || ''}: highlight ${c.n} occurrences`)}">
        <span class="lm ${heb ? 'hbo' : 'grc'}" lang="${heb ? 'hbo' : 'grc'}"${heb ? ' dir="rtl"' : ''}>${esc(lemma)}</span>
        <span class="ct">×${c.n}</span>
        <span class="gl"><i>${esc(L.translit || '')}</i>${esc(dictGloss(L.gloss || c.o.gloss))}</span>
      </button></li>`;
    }).join('')}</ul>
  </section>`;
}

function chNavHTML() {
  return state.passage === 'nt'
    ? `<nav class="ch-nav" aria-label="Chapters"><a href="#"><small>Previous</small><span>Luke 24</span></a><a href="#"><small>Next</small><span>John 2</span></a></nav>`
    : `<nav class="ch-nav" aria-label="Chapters"><a href="#"><small>Previous</small><span>Psalm 22</span></a><a href="#"><small>Next</small><span>Psalm 24</span></a></nav>`;
}

function render() {
  closeCard();
  buildModels();
  const models = PASSAGE_SETS[state.passage].map((pid) => MODELS[pid]);
  document.body.classList.toggle('is-interlinear', state.mode === 'interlinear');
  textEl.innerHTML = models.map(renderPassage).join('') + apparatusHTML(models) + chNavHTML();
  // multi-word bracket width = English line width
  renderChrome(models);
  syncModeButtons();
}

/* --------------------------------------------------- chrome: toc, rails, header */
function renderChrome(models) {
  const toc = $('#toc');
  const parts = [];
  for (const P of models) {
    const title = `${P.bookInfo.id === 'PSA' ? 'Psalm' : P.bookInfo.name} ${P.chapter}`;
    if (models.length > 1) parts.push(`<li><a href="#p-${P.pid}" class="toc-book"><span class="n"></span><span><b>${esc(title)}</b></span></a></li>`);
    for (const [v, t] of P.headings) {
      const inRange = v >= P.from && v <= P.to;
      parts.push(`<li><a href="${inRange ? `#s-${P.pid}-${v}` : '#'}" data-v="${v}" data-pid="${P.pid}" class="${inRange ? '' : 'is-out'}"><span class="n">${v}</span><span>${esc(t)}</span></a></li>`);
    }
  }
  toc.innerHTML = parts.join('');
  $('#toc-title').textContent = state.passage === 'nt' ? 'John 1 · Contents' : 'Contents';
  $$('#passage-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.passage === state.passage)));
  $('#ref-book').textContent = state.passage === 'nt' ? 'John' : 'Genesis';
  $('#ref-ch').textContent = '1';
  $('#key-lang').textContent = state.passage === 'nt' ? 'Greek' : 'Hebrew';
  $('#edition').innerHTML = state.passage === 'nt'
    ? '<dt>Text</dt><dd>Berean Standard Bible, 2022</dd><dt>Greek</dt><dd>SBL Greek New Testament</dd><dt>Links</dt><dd>Hand-aligned by Clear Bible</dd><dt>Lexicon</dt><dd>Abbott-Smith · Strong’s</dd>'
    : '<dt>Text</dt><dd>Berean Standard Bible, 2022</dd><dt>Hebrew</dt><dd>Westminster Leningrad Codex</dd><dt>Greek</dt><dd>Septuagint, via Macula Hebrew</dd><dt>Lexicon</dt><dd>BDB (abridged) · Strong’s</dd>';
  document.title = state.passage === 'nt' ? 'Rootword — John 1 · BSB' : 'Rootword — Genesis 1 & Psalm 23 · BSB';
  observeSections();
}

let io;
function observeSections() {
  io?.disconnect();
  const links = $$('#toc a[data-v]');
  const setCurrent = (pid, v) => links.forEach((a) => a.setAttribute('aria-current', String(a.dataset.pid === pid && Number(a.dataset.v) === v)));
  const first = firstModel();
  const h0 = headingsInRange(first)[0];
  if (h0) setCurrent(first.pid, h0[0]);
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const [, pid, v] = e.target.id.match(/^s-(.+)-(\d+)$/);
        setCurrent(pid, Number(v));
      }
    }
  }, { rootMargin: '-80px 0px -70% 0px' });
  $$('.sec', textEl).forEach((s) => io.observe(s));
}

function syncModeButtons() {
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
}

/* ------------------------------------------------------------------ word card */
const layer = $('#layer');
const live = $('#live');
let card = null;
let active = null; // { el, g, pinned }
let openT = 0, closeT = 0;

/** Per-book distribution for one testament; the current book in the accent colour. */
function distSVG(dist, here, testament, w = 156, h = 18) {
  const [from, to] = testament === 'OT' ? [0, 39] : [39, 66];
  const slice = dist.slice(from, to);
  const max = Math.max(1, ...slice);
  const bw = w / slice.length;
  let s = `<rect class="base" x="0" y="${h - 1}" width="${w}" height="1"/>`;
  slice.forEach((c, i) => {
    if (!c) return;
    const bh = Math.max(2, Math.round((Math.sqrt(c) / Math.sqrt(max)) * h));
    const cls = from + i + 1 === here ? 'bar here' : 'bar on';
    s += `<rect class="${cls}" x="${(i * bw + 0.5).toFixed(2)}" y="${h - bh}" width="${Math.max(1, bw - 1.2).toFixed(2)}" height="${bh}"/>`;
  });
  const b0 = bookByNum(from + 1).short, b1 = bookByNum(to).short;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${s}</svg><span class="axis" aria-hidden="true"><span>${b0}</span><span>${b1}</span></span>`;
}

function lemmaLine(L, o) {
  if (L.line) return L.line.split(' (')[0].replace(/[,;\s]+$/, '');
  return L.lemma || o.lemma;
}

function rendersHTML(sid) {
  const R = D.rend[sid];
  if (!R) return '';
  const top = R.top.filter((r, i) => i === 0 || (r[1] / R.total >= 0.025 && !/^(he|him|and|the|it|she|they)$/i.test(r[0]))).slice(0, 4);
  return top.map(([t, n]) => `<span class="r"><b>${esc(t)}</b>&nbsp;<span class="n">${fmt(n)}</span></span>`).join('<span class="sep" aria-hidden="true"> · </span>');
}

function cardHTML(g) {
  const o = g.primary;
  const sid = g.mainSid;
  const L = D.lex[o.strongs] || D.lex[sid] || {};
  const lang = g.heb ? 'hbo' : 'grc';
  const parse = parseMorph(o);
  const C = D.conc[sid] || { n: 0, d: new Array(66).fill(0) };
  const bookNum = g.heb ? (g.ref.startsWith('Psalm') ? 19 : 1) : 43;
  const phrase = g.text.replace(/\s+/g, ' ');

  let hero;
  if (g.heb) {
    const [lform, lsid] = (o.lxx || '').split('|');
    const LX = D.lex[(lsid || '').replace(/^G(\d+)$/, (m, d) => 'G' + d.padStart(4, '0'))] || null;
    const lxxCol = lform
      ? `<div><div class="col-lbl"><span>Septuagint</span>${LX ? `<span class="card__strongs">${esc(showSid(lsid))}</span>` : ''}</div>
          <div class="lxx-word grc" lang="grc">${esc(lform)}</div>
          <div class="lxx-sub">${esc(translitGreek(lform))}${LX ? ` · ${esc(dictGloss(LX.gloss))}` : ''}</div></div>`
      : `<div><div class="col-lbl"><span>Septuagint</span></div><div class="lxx-none">No Greek equivalent aligned here</div></div>`;
    hero = `<div class="card__duo">
        <div><div class="col-lbl"><span>Hebrew</span><span class="card__strongs">${esc(showSid(o.strongs))}</span></div>
          <div class="card__orig hbo" lang="hbo" dir="rtl" id="card-orig">${esc(g.display)}</div>
          <div class="card__translit">${esc(g.translit)}</div></div>
        <span class="vr" aria-hidden="true"></span>
        ${lxxCol}
      </div>`;
    const ms = g.written.flat();
    if (ms.length > 1) {
      hero += `<div class="morphs" aria-label="Parts of the word">${ms.map((m, i) => {
        const p = parseHebrew(m.morph);
        // affixes: dictionary gloss; the stem: its contextual gloss (unless a suffix shares the word)
        const hasSuffix = ms.some((x) => /^S/.test(x.morph));
        const affix = /^(R|C|Td|To|S)/.test(m.morph);
        const short = !affix && !hasSuffix && m.gloss ? cleanGloss(m.gloss) : dictGloss((D.lex[m.strongs]?.gloss || m.gloss).split(',')[0]);
        return `${i ? '<span class="plus" aria-hidden="true">+</span>' : ''}<span class="morph${m === o ? ' is-main' : ''}"><span class="hbo" lang="hbo">${esc(stripCant(m.text))}</span><span>${esc(short)}</span><span class="pos">${esc(p.short)}</span></span>`;
      }).join('')}</div>`;
    }
  } else {
    hero = `<div class="card__hero">
        <div class="card__orig grc" lang="grc" id="card-orig">${esc(g.display)}</div>
        <div class="card__translit">${esc(g.translit)}</div>
        <span class="card__strongs">${esc(showSid(o.strongs))}</span>
      </div>`;
  }

  const lemmaDisp = g.heb ? stripCant(lemmaLine(L, o)) : lemmaLine(L, o);
  const glossCtx = g.gloss || cleanGloss(o.gloss) || L.gloss;
  const facts = `<dl class="facts">
      <dt>Lemma</dt><dd><span class="${lang}" lang="${lang}">${esc(lemmaDisp)}</span> <span class="lexgl">${esc(L.translit || '')}</span></dd>
      <dt>Parsing</dt><dd>${esc(parse.pos)}${parse.detail ? ` · ${esc(parse.detail)}` : ''}<code>${esc(o.morph)}</code></dd>
      <dt>Gloss</dt><dd><span class="gloss">${esc(glossCtx)}</span>${L.gloss && dictGloss(L.gloss) !== glossCtx ? ` <span class="lexgl">· dictionary: ${esc(dictGloss(L.gloss))}</span>` : ''}</dd>
      ${D.rend[sid] ? `<dt>Rendered</dt><dd class="rend">${rendersHTML(sid)}</dd>` : ''}
    </dl>`;

  const def = L.def ? `<div class="card__def"><p class="txt" style="margin:0">${esc(L.def)}</p><span class="card__src">${esc(L.src)}${L.pos ? ` · ${esc(L.pos)}` : ''}</span></div>` : '';
  const summary = `${g.display}, ${g.translit}. ${parse.pos}${parse.detail ? ', ' + parse.detail : ''}. Gloss: ${glossCtx}. Strong’s ${showSid(o.strongs)}. ${C.n} verses.`;

  return `<div class="card__notch" aria-hidden="true"></div>
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="card__inner">
      <div class="card__top">
        <span class="card__en">“${typo(phrase)}”</span>
        <span class="tnum">${esc(g.ref)}</span>
        <span class="card__lang">${g.heb ? 'Hebrew · WLC' : 'Greek · SBLGNT'}</span>
        <button class="card__close" type="button" aria-label="Close word study"><svg class="icon"><use href="#i-close"/></svg></button>
      </div>
      ${hero}
      ${facts}
      ${def}
      <p class="sr-only" id="card-summary">${esc(summary)}</p>
      <div class="card__foot">
        <div class="dist">
          <span class="lbl"><b>${fmt(C.n)}</b> verses${C.d[bookNum - 1] ? ` · <b>${fmt(C.d[bookNum - 1])}</b> in ${esc(bookByNum(bookNum).name)}` : ''}</span>
          <span class="spark">${distSVG(C.d, bookNum, sid.startsWith('H') ? 'OT' : 'NT')}</span>
        </div>
        <button class="btn-all" type="button">See all occurrences<svg class="icon"><use href="#i-arrow"/></svg></button>
      </div>
    </div>`;
}

function highlight(g) {
  const ids = new Set(g.ids);
  for (const el of $$('.w[data-gid]', textEl)) {
    const other = GROUPS.get(Number(el.dataset.gid));
    const same = other.ids.some((id) => ids.has(id));
    el.classList.toggle('is-active', same);
    el.classList.toggle('is-kin', !same && Boolean(g.mainSid) && other.mainSid === g.mainSid);
  }
}
function clearHighlight() {
  $$('.w.is-active, .w.is-kin', textEl).forEach((el) => el.classList.remove('is-active', 'is-kin'));
}

function placeCard(el, pointer) {
  if (!card) return;
  const sheet = mqSheet.matches;
  card.classList.toggle('is-sheet', sheet);
  if (sheet) {
    card.style.left = ''; card.style.top = '';
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const limit = innerHeight - card.offsetHeight - 16;
      if (r.bottom > limit) scrollBy({ top: r.bottom - limit + 8, behavior: 'auto' });
    });
    return;
  }
  const rects = [...el.getClientRects()];
  let r = rects[0];
  if (pointer) r = rects.find((x) => pointer.y >= x.top - 2 && pointer.y <= x.bottom + 2) || r;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  const gap = 10, margin = 16;
  const headerH = $('#masthead').getBoundingClientRect().bottom;
  const anchorX = r.left + Math.min(r.width / 2, 60);
  let left = Math.round(anchorX - 44);
  left = Math.max(margin, Math.min(left, innerWidth - cw - margin));
  const below = r.bottom + gap;
  const above = r.top - gap - ch;
  const flip = below + ch > innerHeight - margin && above > headerH + 8;
  const top = flip ? above : below;
  card.classList.toggle('is-above', flip);
  card.style.setProperty('--notch-x', `${Math.max(18, Math.min(cw - 18, anchorX - left))}px`);
  card.style.left = `${left + scrollX}px`;
  card.style.top = `${Math.round(top + scrollY)}px`;
}

function openCard(el, { pinned = false, via = 'hover', pointer = null } = {}) {
  const g = GROUPS.get(Number(el.dataset.gid));
  if (!g || !g.primary) return;
  clearTimeout(closeT);
  if (active && active.el !== el) active.el.removeAttribute('aria-describedby');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'word-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-labelledby', 'card-orig');
    card.tabIndex = -1;
    card.addEventListener('pointerenter', () => clearTimeout(closeT));
    card.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !active?.pinned) closeT = setTimeout(closeCard, 240); });
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card__close')) closeCard({ restore: true });
      else if (e.target.closest('.btn-all')) toast(`Concordance: all ${fmt((D.conc[active.g.mainSid] || {}).n || 0)} verses with ${active.g.primary.lemma} — not part of this mockup`);
    });
    card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCard({ restore: true }); } });
    card.addEventListener('focusout', (e) => {
      if (active?.via === 'key' && e.relatedTarget && !card.contains(e.relatedTarget) && e.relatedTarget !== active.el) closeCard();
    });
    layer.appendChild(card);
  }
  const same = active && active.el === el;
  active = { el, g, pinned: pinned || (same && active.pinned), via };
  if (!same || !card.innerHTML) card.innerHTML = cardHTML(g);
  card.classList.toggle('is-pinned', active.pinned);
  card.hidden = false;
  highlight(g);
  el.setAttribute('aria-describedby', 'card-summary');
  el.setAttribute('aria-expanded', 'true');
  placeCard(el, pointer);
  if (!same) live.textContent = $('#card-summary', card)?.textContent || '';
  if (via === 'key') card.focus({ preventScroll: true });
}

function closeCard({ restore = false } = {}) {
  clearTimeout(openT); clearTimeout(closeT);
  if (!active) return;
  const el = active.el;
  el.removeAttribute('aria-describedby');
  el.setAttribute('aria-expanded', 'false');
  active = null;
  if (card) { card.hidden = true; card.innerHTML = ''; }
  clearHighlight();
  if (restore && el.isConnected) el.focus({ preventScroll: true });
}

/* --------------------------------------------------------- word interactions */
textEl.addEventListener('pointerover', (e) => {
  const w = e.target.closest('.w[data-gid]');
  if (!w || e.pointerType !== 'mouse') return;
  if (active?.pinned) return;
  clearTimeout(closeT); clearTimeout(openT);
  const pointer = { x: e.clientX, y: e.clientY };
  openT = setTimeout(() => openCard(w, { via: 'hover', pointer }), active ? 0 : 80);
});
textEl.addEventListener('pointerout', (e) => {
  const w = e.target.closest('.w[data-gid]');
  if (!w || e.pointerType !== 'mouse') return;
  if (e.relatedTarget && (w.contains(e.relatedTarget) || card?.contains(e.relatedTarget))) return;
  clearTimeout(openT);
  if (!active?.pinned) closeT = setTimeout(closeCard, 240);
});
textEl.addEventListener('click', (e) => {
  const w = e.target.closest('.w[data-gid]');
  if (w) {
    if (active?.el === w && active.pinned) closeCard();
    else openCard(w, { pinned: true, via: 'click', pointer: { x: e.clientX, y: e.clientY } });
    return;
  }
  const lex = e.target.closest('.lexlist button');
  if (lex) {
    const on = !lex.classList.contains('is-on');
    $$('.lexlist button.is-on').forEach((b) => b.classList.remove('is-on'));
    $$('.w.is-hot', textEl).forEach((x) => x.classList.remove('is-hot'));
    if (on) {
      lex.classList.add('is-on');
      $$('.w[data-gid]', textEl).forEach((x) => x.classList.toggle('is-hot', GROUPS.get(Number(x.dataset.gid)).mainSid === lex.dataset.sid));
    }
  }
  const il = e.target.closest('input[data-il]');
  if (il) { state.il[il.dataset.il] = il.checked; render(); $(`input[data-il="${il.dataset.il}"]`)?.focus(); }
});
textEl.addEventListener('pointerover', (e) => {
  const lex = e.target.closest('.lexlist button');
  if (!lex || $('.lexlist button.is-on')) return;
  $$('.w[data-gid]', textEl).forEach((x) => x.classList.toggle('is-hot', GROUPS.get(Number(x.dataset.gid)).mainSid === lex.dataset.sid));
});
textEl.addEventListener('pointerout', (e) => {
  const lex = e.target.closest('.lexlist button');
  if (!lex || $('.lexlist button.is-on')) return;
  $$('.w.is-hot', textEl).forEach((x) => x.classList.remove('is-hot'));
});
textEl.addEventListener('keydown', (e) => {
  const w = e.target.closest('.w[data-gid]');
  if (!w) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openCard(w, { pinned: true, via: 'key' });
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const all = $$('.w[data-gid]', textEl);
    const i = all.indexOf(w) + (e.key === 'ArrowRight' ? 1 : -1);
    if (all[i]) { e.preventDefault(); all[i].focus(); }
  }
});
document.addEventListener('click', (e) => {
  const dead = e.target.closest('a[href="#"]');
  if (dead) { e.preventDefault(); if (dead.closest('.toc')) toast('Verses 19–51 are not part of this mockup'); }
  if (active && !e.target.closest('.card') && !e.target.closest('.w[data-gid]')) closeCard();
  if (openPop && !e.target.closest('.pop') && !e.target.closest('[aria-controls]') && !e.target.closest('.search')) closePop();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (openPop) { const t = openPop.trigger; closePop(); t?.focus(); return; }
    if (active) closeCard({ restore: true });
  }
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault();
    searchInput.focus();
  }
});
addEventListener('resize', () => { if (active) placeCard(active.el); if (openPop?.place) openPop.place(); });

/* ----------------------------------------------------------- mode + passages */
document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-mode]');
  if (m && m.dataset.mode !== state.mode) { state.mode = m.dataset.mode; render(); $(`.ch-tools [data-mode="${state.mode}"]`)?.offsetParent && $(`.ch-tools [data-mode="${state.mode}"]`).focus(); }
  const p = e.target.closest('[data-passage]');
  if (p && p.dataset.passage !== state.passage) { state.passage = p.dataset.passage; render(); scrollTo({ top: 0 }); }
});
$('#theme-btn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  syncThemeBtn();
});
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-btn').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

/* ------------------------------------------------------------------ popovers */
let openPop = null;
function openPopover(trigger, html, { cls = '', align = 'left', onOpen } = {}) {
  closePop();
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.innerHTML = html;
  el.setAttribute('role', 'dialog');
  layer.appendChild(el);
  const place = () => {
    const r = trigger.getBoundingClientRect();
    const hdr = $('#masthead').getBoundingClientRect().bottom;
    el.style.position = 'fixed';
    el.style.top = `${Math.round(Math.max(r.bottom, hdr) + 8)}px`;
    const w = el.offsetWidth;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(12, Math.min(left, innerWidth - w - 12));
    el.style.left = `${Math.round(left)}px`;
  };
  place();
  trigger.setAttribute('aria-expanded', 'true');
  openPop = { el, trigger, place };
  onOpen?.(el);
  return el;
}
function closePop() {
  if (!openPop) return;
  openPop.trigger.setAttribute('aria-expanded', 'false');
  openPop.el.remove();
  if (openPop.trigger === searchInput) $('#search').classList.remove('is-open');
  openPop = null;
}

/* book + chapter picker */
const SAMPLE_BOOKS = { GEN: 'ot', PSA: 'ot', JHN: 'nt' };
function booksHTML() {
  const cur = state.passage === 'nt' ? 'JHN' : 'GEN';
  const grid = (t) => D.books.filter((b) => b[3] === t).map((b) =>
    `<button type="button" data-book="${b[0]}" aria-current="${b[0] === cur}" class="${SAMPLE_BOOKS[b[0]] ? 'has-sample' : ''}" title="${esc(b[1])}">${esc(b[2])}</button>`).join('');
  const B = bookById[cur];
  const chs = Array.from({ length: B.chapters }, (_, i) => `<button type="button" aria-current="${i === 0}">${i + 1}</button>`).join('');
  return `<div class="books__col"><p class="eyebrow"><span>Old Testament</span><span>39</span></p><div class="books__grid">${grid('OT')}</div></div>
    <div class="books__col"><p class="eyebrow"><span>New Testament</span><span>27</span></p><div class="books__grid">${grid('NT')}</div></div>
    <div class="books__col"><p class="books__title">${esc(B.name)}</p><p class="books__sub">${B.chapters} chapters</p><div class="chapters">${chs}</div>
      <p class="books__sub" style="margin:14px 0 0">Books marked <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--accent);vertical-align:1px"></span> have sample text in this mockup.</p></div>`;
}
$('#book-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (openPop?.trigger === e.currentTarget) return closePop();
  const el = openPopover(e.currentTarget, booksHTML(), { cls: 'books' });
  el.setAttribute('aria-label', 'Choose a book and chapter');
  el.querySelector('[aria-current="true"]')?.focus();
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-book]');
    if (!b) return;
    const p = SAMPLE_BOOKS[b.dataset.book];
    closePop();
    if (p) {
      if (p !== state.passage) { state.passage = p; render(); }
      const target = b.dataset.book === 'PSA' ? $('#p-ps23') : null;
      (target || document.body).scrollIntoView ? (target ? target.scrollIntoView() : scrollTo({ top: 0 })) : null;
    } else toast('This mockup includes John 1, Genesis 1 and Psalm 23');
  });
});

/* translation picker */
const TRANSLATIONS = [
  ['KJV', 'King James Version', '1769 · public domain', 2, 'Strong’s-tagged'],
  ['BSB', 'Berean Standard Bible', '2022 · public domain', 3, 'Hand-aligned'],
  ['WEB', 'World English Bible', '2000 · public domain', 1, 'Approximate'],
  ['ASV', 'American Standard Version', '1901 · public domain', 1, 'Approximate'],
  ['YLT', 'Young’s Literal Translation', '1898 · public domain', 1, 'Approximate'],
];
function trHTML(niv = false) {
  const meter = (n) => `<span class="meter" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  return `<div class="tr-menu__head"><p class="eyebrow">Translation</p><span class="eyebrow" style="letter-spacing:.06em">Link to the original</span></div>
    <div role="listbox" aria-label="Translation">${TRANSLATIONS.map(([id, name, sub, q, ql]) => `
      <button type="button" class="tr-item" role="option" aria-checked="${id === 'BSB'}" aria-selected="${id === 'BSB'}" data-tr="${id}">
        <span class="tr-item__abbr">${id}</span>
        <span class="tr-item__name">${esc(name)}<small>${esc(sub)}</small></span>
        <span class="tr-item__align">${meter(q)}${ql}</span>
      </button>`).join('')}
      <hr>
      <div class="tr-item tr-item--remote">
        <span class="tr-item__abbr">NIV</span>
        <span class="tr-item__name">New International Version<small>© Biblica · read with your own API.Bible key</small></span>
        <button type="button" class="connect" data-connect aria-expanded="${niv}">Connect<svg class="icon" style="width:13px;height:13px"><use href="#i-arrow"/></svg></button>
      </div>
      ${niv ? `<div class="niv-panel">
        <p>The NIV is copyrighted, so Rootword never bundles it. Paste a free API.Bible key and the text loads straight into this browser; Greek and Hebrew links are matched automatically.</p>
        <label for="niv-key">API.Bible key</label>
        <div class="row"><input id="niv-key" placeholder="e.g. 3f9c…a21b" autocomplete="off"><button type="button" class="btn-primary">Connect NIV</button></div>
      </div>` : ''}
    </div>`;
}
function openTr(niv = false) {
  const btn = $('#tr-btn');
  const el = openPopover(btn, trHTML(niv), { cls: 'tr-menu' });
  el.setAttribute('aria-label', 'Choose a translation');
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-connect]')) { ev.stopPropagation(); openTr(true); $('#niv-key')?.focus(); return; }
    const t = ev.target.closest('[data-tr]');
    if (t && t.dataset.tr !== 'BSB') { closePop(); toast(`${t.dataset.tr}: not loaded in this mockup — the BSB sample is shown`); }
    else if (t) closePop();
  });
}
$('#tr-btn').addEventListener('click', (e) => { e.stopPropagation(); if (openPop?.trigger === e.currentTarget) return closePop(); openTr(false); });

/* search */
const searchInput = $('#search-input');
const S = D.search;
function searchHTML() {
  const facetSids = new Set(S.facets.map((f) => f[0]));
  const results = S.results.filter((r) => r.t.every((s) => typeof s === 'string' || facetSids.has(s[3]))).slice(0, 8);
  const maxF = S.facets[0][1];
  const maxB = Math.max(...S.perBook);
  const W = 760, H = 46, gap = 10, bw = (W - gap) / 66;
  const peaks = [];
  for (const [n, i] of S.perBook.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0])) {
    if (peaks.length < 4 && peaks.every((j) => Math.abs(j - i) > 4)) peaks.push(i);
  }
  let bars = `<rect class="base" x="0" y="${H - 1}" width="${W}" height="1"/>`;
  let labels = '';
  S.perBook.forEach((n, i) => {
    const x = i * bw + (i >= 39 ? gap : 0);
    if (!n) return;
    const h = Math.max(2, Math.round(Math.sqrt(n / maxB) * (H - 14)));
    bars += `<rect class="bar ${i >= 39 ? 'nt' : 'ot'}" x="${x.toFixed(1)}" y="${H - h}" width="${(bw - 2.4).toFixed(1)}" height="${h}" rx="1"><title>${esc(bookByNum(i + 1).name)}: ${n}</title></rect>`;
    if (peaks.includes(i)) labels += `<span class="peak" style="left:${((x + bw / 2) / W * 100).toFixed(2)}%;bottom:${(h + 4) / H * 100}%">${esc(bookByNum(i + 1).short)} <b>${n}</b></span>`;
  });
  const facets = S.facets.map(([sid, n]) => {
    const L = D.lex[sid] || {};
    const heb = sid.startsWith('H');
    return `<button type="button" class="facet" aria-pressed="false">
      <span class="f-or ${heb ? 'hbo' : 'grc'}" lang="${heb ? 'hbo' : 'grc'}"${heb ? ' dir="rtl"' : ''}>${esc(heb ? stripCant(L.lemma) : L.lemma)}</span>
      <span class="f-n">${fmt(n)}</span>
      <span class="f-gl"><i>${esc(L.translit)}</i>${esc(dictGloss(L.gloss))} · ${showSid(sid)}</span>
      <span class="f-bar"><i style="width:${Math.round((n / maxF) * 100)}%"></i></span>
    </button>`;
  }).join('');
  const hits = results.map((r) => {
    const b = bookByNum(r.b);
    const name = b.id === 'PSA' ? 'Psalm' : b.name;
    const lemmas = new Map();
    const text = r.t.map((s) => {
      if (typeof s === 'string') return typo(s);
      const k = s[3];
      lemmas.set(k, (lemmas.get(k) || 0) + 1);
      return `<mark>${esc(s[0])}</mark>`;
    }).join('');
    const orig = [...lemmas].map(([sid, n]) => {
      const L = D.lex[sid] || {};
      const heb = sid.startsWith('H');
      return `<span class="ho"><span class="${heb ? 'hbo' : 'grc'}" lang="${heb ? 'hbo' : 'grc'}">${esc(heb ? stripCant(L.lemma) : L.lemma)}</span>${n > 1 ? `<span class="x">×${n}</span>` : ''}</span>`;
    }).join('');
    return `<a class="hit" href="#"><span class="hit__ref"><span>${esc(name)} ${r.c}:${r.v}</span><span class="tr">BSB</span><span class="hit__orig">${orig}</span></span><p class="hit__text">${text}</p></a>`;
  }).join('');
  return `<div class="sp__head">
      <div class="sp__row">
        <button type="button" class="btn btn--icon sp__close" aria-label="Close search"><svg class="icon"><use href="#i-close"/></svg></button>
        <div><div class="sp__count"><b>${fmt(S.verses)}</b> verses for <q>${esc(S.query)}</q></div>
        <div class="sp__forms">Matching <span>${S.forms.join(', ')}</span> in the Berean Standard Bible</div></div>
      </div>
      <div class="sp__dist"><div class="sp__chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Distribution of matches across the 66 books">${bars}</svg>${labels}</div>
        <div class="sp__axis" style="position:relative;height:14px"><span style="position:absolute;left:0">Genesis</span><span style="position:absolute;left:${((39 * bw + gap) / W * 100).toFixed(1)}%">Matthew</span><span style="position:absolute;right:0">Revelation</span></div>
      </div>
    </div>
    <div class="sp__body">
      <div class="sp__facets"><p class="eyebrow">Behind the English</p><p class="hint">“Love” translates ${S.facets.length}+ different Greek and Hebrew words.</p><div class="list">${facets}</div></div>
      <div class="sp__results">
        <div class="sp__tabs"><div class="seg" role="group" aria-label="Testament"><button type="button" aria-pressed="true">All <span class="n">${fmt(S.verses)}</span></button><button type="button" aria-pressed="false">OT <span class="n">${fmt(S.ot)}</span></button><button type="button" aria-pressed="false">NT <span class="n">${fmt(S.nt)}</span></button></div>
        <span class="sp__sort">Sorted by <b>relevance</b></span></div>
        ${hits}
      </div>
    </div>
    <div class="sp__foot"><span class="tips"><span>Try <code>λόγος</code></span><span><code>H430</code></span><span><code>Jn 3:16</code></span><span><code>"living water"</code></span></span><a href="#">See all ${fmt(S.verses)} verses →</a></div>`;
}
function openSearch() {
  $('#search').classList.add('is-open');
  if (!searchInput.value) searchInput.value = S.query;
  const el = openPopover(searchInput, searchHTML(), { cls: 'sp', align: 'right' });
  el.id = 'search-pop';
  el.querySelector('.sp__close')?.addEventListener('click', () => closePop());
  el.setAttribute('aria-label', 'Search results');
  searchInput.setAttribute('aria-expanded', 'true');
  const r = $('.search__field').getBoundingClientRect();
  if (!mqSheet.matches) {
    const w = el.offsetWidth;
    el.style.left = `${Math.round(Math.max(12, Math.min(r.right - w, innerWidth - w - 12)))}px`;
  }
}
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') openSearch(); });
searchInput.addEventListener('input', () => { if (/^lov/i.test(searchInput.value.trim())) openSearch(); });
$('#search-open').addEventListener('click', (e) => { e.stopPropagation(); openSearch(); searchInput.focus(); });

/* toast */
let toastT;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), 3200);
}

/* ------------------------------------------------------------------- boot */
render();
syncThemeBtn();
await document.fonts.ready;
requestAnimationFrame(() => {
  const findWord = (id) => $$('.w[data-gid]', textEl).find((el) => GROUPS.get(Number(el.dataset.gid)).ids.includes(id));
  if (demos.has('hover') || demos.has('hover-ot')) {
    const el = findWord(demos.has('hover-ot') ? 'o010010010031' : 'n43001001005');
    if (el) openCard(el, { via: 'demo' });
  }
  if (params.get('word')) {
    const el = findWord(params.get('word'));
    if (el) openCard(el, { via: 'demo' });
  }
  if (demos.has('phrase')) {
    const el = findWord('n43001001002');
    if (el) openCard(el, { via: 'demo' });
  }
  if (demos.has('focus')) {
    const el = findWord('n43001001005');
    if (el) { el.focus(); openCard(el, { pinned: true, via: 'key' }); }
  }
  if (demos.has('search')) openSearch();
  if (demos.has('books')) $('#book-btn').click();
  if (demos.has('translations')) openTr(false);
  if (demos.has('niv')) openTr(true);
  document.body.dataset.ready = '1';
});
