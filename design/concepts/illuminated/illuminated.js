/* Logos — "Illuminated" concept. Self-contained mockup script (no build step).
 *
 * Data: ../../sample.json (BSB tokens with links to SBLGNT / WLC words) and data.js
 * (a snapshot of the generated lexicon, concordance counts and a real "love" search).
 *
 * Demo states (combine freely):  ?theme=dark|light
 *   ?demo=hover | hover-ot | interlinear | search | books | niv   (comma-separated)
 *   ?passage=ot
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const demos = (params.get('demo') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const DATA = window.ILLUM_DATA || { lex: {}, search: null };
  const LEX = DATA.lex;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mobileMQ = matchMedia('(max-width: 640px)');

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /* ------------------------------------------------------------------ passages */

  const PASSAGES = {
    nt: [
      {
        book: 'JHN', num: 43, chapter: 1, lang: 'grc', name: 'John',
        eyebrow: 'The Gospel according to', title: 'John', native: 'Κατὰ Ἰωάννην',
        chapterLabel: 'Chapter 1',
        sections: { 1: { title: 'The Beginning', refs: 'Genesis 1:1–2; Hebrews 11:1–3' } },
        paras: [],
      },
    ],
    ot: [
      {
        book: 'GEN', num: 1, chapter: 1, lang: 'hbo', name: 'Genesis',
        eyebrow: 'The First Book of Moses, called', title: 'Genesis', native: 'בְּרֵאשִׁית',
        chapterLabel: 'Chapter 1',
        sections: {
          1: { title: 'The Creation', refs: 'John 1:1–5; Hebrews 11:1–3' },
          3: { title: 'The First Day', minor: true },
        },
        paras: [2, 3],
      },
      {
        book: 'PSA', num: 19, chapter: 23, lang: 'hbo', name: 'Psalm',
        eyebrow: 'The Book of Psalms', title: 'Psalm 23', native: 'תְּהִלִּים כג',
        sections: { 1: { title: 'The LORD Is My Shepherd', refs: 'Ezekiel 34:11–24; John 10:1–21' } },
        superscription: 'A Psalm of David.',
        poetry: true,
        compact: true,
        paras: [],
      },
    ],
  };

  const NAV = {
    nt: { label: 'John 1', prev: 'Luke 24', next: 'John 2' },
    ot: { label: 'Genesis 1', prev: 'Malachi 4', next: 'Genesis 2' },
  };

  const CREDITS = {
    nt: 'Berean Standard Bible, public domain · Greek: SBL Greek New Testament, CC BY 4.0 · Word alignment: Clear Bible / Biblica, CC BY 4.0 · Lexicon: STEPBible (Abbott-Smith), CC BY 4.0, and Strong’s, public domain',
    ot: 'Berean Standard Bible, public domain · Hebrew: Westminster Leningrad Codex, public domain, with Macula Hebrew, CC BY 4.0 · Word alignment: Clear Bible / Biblica, CC BY 4.0 · Lexicon: STEPBible (BDB), CC BY 4.0, and Strong’s, public domain',
  };

  const TRANSLATIONS = [
    { id: 'BSB', name: 'Berean Standard Bible', note: 'Every word hand-aligned to the Greek & Hebrew', kind: 'exact' },
    { id: 'KJV', name: 'King James Version', note: 'Linked through its own Strong’s numbers', kind: 'strongs' },
    { id: 'WEB', name: 'World English Bible', note: 'Links matched through the BSB · approximate', kind: 'approx' },
    { id: 'ASV', name: 'American Standard Version', note: 'Links matched through the BSB · approximate', kind: 'approx' },
    { id: 'YLT', name: 'Young’s Literal Translation', note: 'Links matched through the BSB · approximate', kind: 'approx' },
    { id: 'NIV', name: 'New International Version', note: 'Copyrighted — connect your API.Bible key', kind: 'remote' },
  ];

  /* Hand-written plain-language definitions for the headline words (placeholders for the
   * curated "short definition" the real lexicon stage could provide). */
  const CURATED = {
    G3056: 'A word as the expression of a thought — a saying, message or account; also the reason behind it. John makes ὁ λόγος a title: the Word, God’s own self-expression, who was with God and was God.',
    G0746: 'Beginning, origin — the first point from which something starts; by extension first place, and so rule or ruler. Ἐν ἀρχῇ deliberately echoes the Greek of Genesis 1:1.',
    G2316: 'God; a god. With the article (ὁ θεός) it normally names the one God of Israel. In 1:1c θεός comes first and without the article, stressing what the Word was rather than who.',
    H0430: 'God; plural in form (“gods”) but, for the God of Israel, used with singular verbs — a plural of majesty. Also used of other gods, of divine beings and, rarely, of human judges.',
    H7225: 'Beginning, first; the first or best part of something (as in first-fruits). Here the absolute starting point of creation.',
    H1254: 'To create, to shape anew. In the Bible its subject is always God; it is never used of human making.',
  };

  const MISSING_TRANSLIT = {
    o190230010041: 'rōʿ', o190230010042: 'î',
    o190230020031: 'yarbîṣē', o190230020032: 'nî',
    o190230020071: 'yənahălē', o190230020072: 'nî',
  };

  /* ------------------------------------------------------------------ language helpers */

  const stripCantillation = (s) => s.replace(/[֑-ֽ֯׀׃]/g, '');
  const cleanHebTranslit = (s) =>
    s.replace(/[:\-–]+$/, '').replace(/iy(?=[^aeiouāēīōūâêîôûəĕăŏ]|$)/g, 'î');
  const cleanGloss = (s) => (s || '').replace(/\./g, ' ').replace(/\s+/g, ' ').replace(/^\*$/, '').trim();

  const GR = { α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'ē', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'ō' };
  function translitGreek(text) {
    return text.split(/(\s+)/).map((w) => {
      if (!w.trim()) return w;
      const d = w.normalize('NFD');
      const rough = d.includes('̔');
      const base = d.replace(/[̀-ͯ]/g, '').toLowerCase();
      let out = '';
      for (let i = 0; i < base.length; i++) {
        const c = base[i], n = base[i + 1], p = base[i - 1];
        if (c === 'γ' && n && 'γκξχ'.includes(n)) { out += 'n'; continue; }
        if (c === 'υ' && ((p && 'αεηο'.includes(p)) || n === 'ι')) { out += 'u'; continue; }
        out += GR[c] ?? c;
      }
      if (rough) out = out[0] === 'r' ? 'rh' + out.slice(1) : 'h' + out;
      return w[0] !== w[0].toLowerCase() ? out[0].toUpperCase() + out.slice(1) : out;
    }).join('');
  }

  const normStrongs = (s) => {
    const m = /^([GH])0*(\d+)([a-z]?)$/.exec(s || '');
    return m ? `${m[1]}${m[2].padStart(4, '0')}${m[3]}` : '';
  };
  const showStrongs = (s) => {
    const m = /^([GH])0*(\d+)([a-z]?)$/.exec(s || '');
    return m ? `${m[1]}${m[2]}${m[3]}` : '';
  };
  const lexFor = (s) => LEX[normStrongs(s)] || LEX[normStrongs(s).slice(0, 5)] || null;

  /* Robinson (Greek) morphology -> plain language */
  const CASE = { N: 'nominative', G: 'genitive', D: 'dative', A: 'accusative', V: 'vocative' };
  const NUM = { S: 'singular', P: 'plural' };
  const GEN = { M: 'masculine', F: 'feminine', N: 'neuter' };
  const TENSE = { P: 'present', I: 'imperfect', F: 'future', A: 'aorist', R: 'perfect', L: 'pluperfect' };
  const VOICE = { A: 'active', M: 'middle', P: 'passive', E: 'middle/passive', D: 'middle', O: 'passive', N: 'middle/passive' };
  const MOOD = { I: 'indicative', S: 'subjunctive', O: 'optative', M: 'imperative', N: 'infinitive', P: 'participle' };
  const GPOS = { N: 'Noun', A: 'Adjective', T: 'Article', P: 'Personal pronoun', D: 'Demonstrative pronoun', R: 'Relative pronoun', C: 'Reciprocal pronoun', F: 'Reflexive pronoun', I: 'Interrogative pronoun', K: 'Correlative pronoun', X: 'Indefinite pronoun', S: 'Possessive adjective' };
  const GFIXED = { PREP: ['Preposition'], CONJ: ['Conjunction'], ADV: ['Adverb'], PRT: ['Particle'], 'PRT-N': ['Particle', 'negative'], 'CONJ-N': ['Conjunction', 'negative'], INJ: ['Interjection'] };
  const ord = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd' })[n] || n;

  function parseGreek(code) {
    if (GFIXED[code]) return GFIXED[code];
    const [p, a, b] = code.split('-');
    if (p === 'V') {
      let t = a || '';
      const second = t[0] === '2';
      if (second) t = t.slice(1);
      const parts = ['Verb', `${second ? '2nd ' : ''}${TENSE[t[0]] || ''} ${VOICE[t[1]] || ''} ${MOOD[t[2]] || ''}`.trim()];
      if (b) parts.push(/^\d/.test(b) ? `${ord(b[0])} person ${NUM[b[1]]}` : `${CASE[b[0]]} ${GEN[b[2]]} ${NUM[b[1]]}`);
      return parts;
    }
    const pos = GPOS[p] || p;
    if (!a) return [pos];
    if (/^\d/.test(a)) return [pos, `${ord(a[0])} person ${CASE[a[1]] || ''} ${NUM[a[2]] || ''}`.trim()];
    return [pos, `${CASE[a[0]] || ''} ${GEN[a[2]] || ''} ${NUM[a[1]] || ''}`.replace(/\s+/g, ' ').trim()];
  }

  /* OSHB-style (Hebrew) morphology -> plain language */
  const HG = { m: 'masculine', f: 'feminine', b: 'common', c: 'common' };
  const HN = { s: 'singular', p: 'plural', d: 'dual' };
  const HS = { a: 'absolute', c: 'construct', d: 'determined' };
  const STEM = { q: 'Qal', N: 'Niphal', p: 'Piel', P: 'Pual', h: 'Hiphil', H: 'Hophal', t: 'Hithpael', o: 'Polel', O: 'Polal', r: 'Hithpolel', m: 'Poel', M: 'Poal', Q: 'Qal passive' };
  const HTYPE = { p: 'perfect', q: 'sequential perfect', i: 'imperfect', w: 'wayyiqtol (narrative past)', h: 'cohortative', j: 'jussive', v: 'imperative', r: 'participle', s: 'passive participle', a: 'infinitive absolute', c: 'infinitive construct' };
  const HT = { a: 'Affirmation', d: 'Definite article', e: 'Exhortation', i: 'Interrogative', j: 'Interjection', m: 'Demonstrative', n: 'Negative particle', o: 'Object marker', r: 'Relative particle' };

  function parseHebrew(c) {
    const pgn = (s) => `${ord(s[0])} ${HG[s[1]] || ''} ${HN[s[2]] || ''}`.replace(/\s+/g, ' ').trim();
    switch (c[0]) {
      case 'N':
        if (c[1] === 'p') return ['Proper noun'];
        return ['Noun', [HG[c[2]], HN[c[3]], HS[c[4]]].filter(Boolean).join(' ')];
      case 'A':
        return ['Adjective', [HG[c[2]], HN[c[3]], HS[c[4]]].filter(Boolean).join(' ')];
      case 'V': {
        const stem = STEM[c[1]] || '', type = HTYPE[c[2]] || '';
        if (c[2] === 'r' || c[2] === 's') return ['Verb', `${stem} ${type}`, [HG[c[3]], HN[c[4]], HS[c[5]]].filter(Boolean).join(' ')];
        if (c[2] === 'a' || c[2] === 'c') return ['Verb', `${stem} ${type}`];
        return ['Verb', `${stem} ${type}`, pgn(c.slice(3))];
      }
      case 'R': return ['Preposition'];
      case 'C': return ['Conjunction'];
      case 'D': return ['Adverb'];
      case 'T': return [HT[c[1]] || 'Particle'];
      case 'S':
        if (c[1] === 'p') return ['Pronoun suffix', pgn(c.slice(2))];
        return [c[1] === 'd' ? 'Directional ending' : 'Suffix'];
      case 'P': return ['Pronoun', c.length > 2 ? pgn(c.slice(2)) : ''].filter(Boolean);
      default: return [c];
    }
  }

  const isFunctionWord = (e, lang) =>
    lang === 'hbo' ? /^(R|C|Td|To|S)/.test(e.morph) : /^(T-|PREP|CONJ|PRT)/.test(e.morph);
  const contentRank = (e, lang) => {
    if (isFunctionWord(e, lang)) return 0;
    if (lang === 'hbo') return /^[NV]/.test(e.morph) ? 3 : /^A/.test(e.morph) ? 2 : 1;
    return /^(N|V)-/.test(e.morph) ? 3 : /^A-/.test(e.morph) ? 2 : 1;
  };

  /* ------------------------------------------------------------------ state */

  const state = {
    passage: params.get('passage') === 'ot' || demos.includes('hover-ot') ? 'ot' : 'nt',
    interlinear: demos.includes('interlinear'),
    glosses: true,
    translation: 'BSB',
    units: [],
    open: null, // index of anchor unit
    sel: 0,
    pinned: false,
    focusIdx: 0,
  };
  let sample = null;
  let openTimer = 0, closeTimer = 0;

  /* ------------------------------------------------------------------ model */

  function buildUnits(passage, verses) {
    const units = [];
    const out = []; // per verse: { v, pieces: [...] }
    for (const verse of verses) {
      const vnum = +verse.id.slice(5);
      const pieces = [];
      let cur = null;
      let lead = '';
      verse.tokens.forEach((tok, i) => {
        const prev = verse.tokens[i - 1];
        if (tok.punct || !tok.orig.length) {
          if (!tok.punct) { // a word with no original behind it (supplied by the translators)
            pieces.push({ type: 'supplied', text: tok.text, space: tok.space_after });
            cur = null;
            return;
          }
          if (/^[“‘(]$/.test(tok.text)) { lead += tok.text; cur = null; return; }
          pieces.push({ type: 'punct', text: tok.text, space: tok.space_after });
          cur = null;
          return;
        }
        const key = tok.orig.slice().sort().join('|');
        if (cur && cur.key === key && prev && !prev.punct) {
          cur.en += (prev.space_after ? ' ' : '') + tok.text;
          cur.space = tok.space_after;
          return;
        }
        const ids = tok.orig.slice().sort();
        cur = {
          key, ids, en: tok.text, lead, space: tok.space_after,
          book: passage.book, chapter: passage.chapter, verse: vnum, lang: passage.lang,
          entries: ids.map((id) => ({ id, ...sample.orig[id] })).filter((e) => e.text),
        };
        lead = '';
        cur.idx = units.length;
        units.push(cur);
        pieces.push({ type: 'unit', u: cur });
      });
      out.push({ v: vnum, pieces });
    }
    return { units, verses: out };
  }

  /** The original-language rendering of a unit: words joined by spaces, Hebrew morphemes joined. */
  function origWords(u) {
    const words = [];
    for (const e of u.entries) {
      const wkey = u.lang === 'hbo' ? e.id.slice(0, 12) : e.id;
      const last = words[words.length - 1];
      if (last && last.key === wkey) last.parts.push(e);
      else words.push({ key: wkey, parts: [e] });
    }
    return words;
  }
  const origText = (u) => origWords(u).map((w) => w.parts.map((e) => (u.lang === 'hbo' ? stripCantillation(e.text) : e.text)).join('')).join(' ');
  const translitOf = (e, lang) => (lang === 'hbo' ? cleanHebTranslit(e.translit || MISSING_TRANSLIT[e.id] || '') : translitGreek(e.text));
  const unitGloss = (u) => {
    const gl = [];
    for (const e of u.entries) {
      const g = cleanGloss(e.gloss);
      if (g && g !== gl[gl.length - 1]) gl.push(g);
    }
    return gl.join(' ');
  };
  function primaryIndex(u) {
    let best = 0, rank = -1;
    u.entries.forEach((e, i) => {
      const r = contentRank(e, u.lang);
      if (r > rank) { rank = r; best = i; }
    });
    return best;
  }
  const bookName = (u) => ({ JHN: 'John', GEN: 'Genesis', PSA: 'Psalm' })[u.book] || u.book;
  const refOf = (u) => `${bookName(u)} ${u.chapter}:${u.verse}`;

  /* ------------------------------------------------------------------ rendering */

  const enHTML = (s) => esc(s).replace(/\bLORD\b/g, '<span class="sc">Lord</span>');

  function unitAttrs(u, extraClass = '') {
    return `class="u${extraClass}" data-u="${u.idx}" tabindex="-1" role="button" aria-haspopup="dialog" aria-expanded="false"`;
  }

  function renderFlowUnit(u, initial) {
    if (initial) {
      const first = u.en[0];
      const rest = u.en.slice(1);
      return `${esc(u.lead)}<span ${unitAttrs(u, ' u--initial')} aria-label="${esc(u.en)}"><span class="initial${initial === 2 ? ' initial--2' : ''}" aria-hidden="true"><span class="initial__letter">${esc(first)}</span></span><span aria-hidden="true">${enHTML(rest)}</span></span>`;
    }
    return `${esc(u.lead)}<span ${unitAttrs(u)}>${enHTML(u.en)}</span>`;
  }

  function renderILUnit(u, trail) {
    const lang = u.lang === 'hbo' ? 'he' : 'grc';
    const dir = u.lang === 'hbo' ? ' dir="rtl"' : '';
    const gloss = unitGloss(u);
    return `<span ${unitAttrs(u, ' il')}><span class="il__en">${esc(u.lead)}<span class="il__word">${enHTML(u.en)}</span>${esc(trail)}</span><span class="il__or" lang="${lang}"${dir}>${esc(origText(u))}</span><span class="il__gl">${esc(gloss) || '&nbsp;'}</span></span>`;
  }

  function vn(v, hidden) {
    if (hidden) return `<span class="sr-only">Verse ${v}. </span>`;
    return `<span class="vn"><span class="sr-only">Verse </span>${v}</span>`;
  }

  /** Flow mode: returns HTML for a sequence of pieces. */
  function piecesFlow(pieces, opts) {
    let html = '';
    pieces.forEach((p) => {
      if (p.type === 'unit') {
        html += renderFlowUnit(p.u, opts.initial && p.u === opts.initialUnit ? opts.initial : 0);
        html += p.u.space ? ' ' : '';
      } else if (p.type === 'supplied') {
        html += `<span class="supplied" title="Supplied by the translators">${esc(p.text)}</span>${p.space ? ' ' : ''}`;
      } else {
        html += esc(p.text) + (p.space ? ' ' : '');
      }
    });
    return html;
  }

  /** Interlinear mode: punctuation folds into the neighbouring stack. */
  function piecesIL(pieces) {
    const stacks = [];
    pieces.forEach((p) => {
      if (p.type === 'unit') stacks.push({ u: p.u, trail: '' });
      else if (p.type === 'supplied') stacks.push({ supplied: p.text, trail: '' });
      else if (stacks.length) stacks[stacks.length - 1].trail += p.text;
    });
    return stacks.map((s) => (s.u ? renderILUnit(s.u, s.trail)
      : `<span class="il il--supplied"><span class="il__en">${esc(s.supplied)}${esc(s.trail)}</span><span class="il__or">—</span><span class="il__gl">&nbsp;</span></span>`)).join(' ');
  }

  /** Split a verse's pieces into poetic lines at semicolons (BSB q1 / q2 lines). */
  function poemLines(pieces) {
    const lines = [[]];
    pieces.forEach((p) => {
      lines[lines.length - 1].push(p);
      if (p.type === 'punct' && /;/.test(p.text)) lines.push([]);
    });
    return lines.filter((l) => l.length);
  }

  function titleBlock(p) {
    const nativeLang = p.lang === 'hbo' ? 'he' : 'grc';
    const dir = p.lang === 'hbo' ? ' dir="rtl"' : '';
    return `<header class="titleblock${p.compact ? ' titleblock--compact' : ''}">
      <p class="titleblock__eyebrow">${esc(p.eyebrow)}</p>
      <h1 class="titleblock__title" id="t-${p.book}">${esc(p.title)}</h1>
      <p class="titleblock__native" lang="${nativeLang}"${dir}>${esc(p.native)}</p>
      ${p.chapterLabel ? `<p class="titleblock__chapter"><span class="titleblock__rule" aria-hidden="true"></span><span>${esc(p.chapterLabel)}</span><span class="titleblock__rule" aria-hidden="true"></span></p>` : '<span class="fleuron" aria-hidden="true"></span>'}
    </header>`;
  }

  function sectionHead(sec) {
    if (sec.minor) return `<h3 class="rubric rubric--minor">${enHTML(sec.title)}</h3>`;
    return `<h2 class="rubric"><span class="rubric__mark" aria-hidden="true">¶</span>${enHTML(sec.title)}</h2>${sec.refs ? `<p class="rubric__refs">(${esc(sec.refs)})</p>` : ''}`;
  }

  function renderPassage(p, model) {
    let html = `<section class="passage passage--${p.book.toLowerCase()}" aria-labelledby="t-${p.book}">${titleBlock(p)}`;
    const IL = state.interlinear;
    const firstUnit = model.verses[0] && model.verses[0].pieces.find((x) => x.type === 'unit');
    if (p.poetry) {
      html += sectionHead(p.sections[1]);
      if (p.superscription) html += `<p class="superscription">${esc(p.superscription)}</p>`;
      html += `<div class="poem${IL ? ' poem--il' : ''}">`;
      model.verses.forEach((v, vi) => {
        poemLines(v.pieces).forEach((line, li) => {
          const num = li === 0 ? vn(v.v, vi === 0 && !IL) : '';
          const body = IL ? piecesIL(line) : piecesFlow(line, { initial: vi === 0 && li === 0 ? 2 : 0, initialUnit: firstUnit && firstUnit.u });
          const numIL = li === 0 && IL ? `<span class="il il--vn">${vn(v.v)}</span> ` : '';
          html += `<p class="line${li ? ' line--indent' : ''}${IL ? ' line--il' : ''}">${IL ? numIL : num}${body}</p>`;
        });
      });
      html += '</div></section>';
      return html;
    }
    let paraOpen = false;
    model.verses.forEach((v, vi) => {
      const sec = p.sections[v.v];
      const newPara = vi === 0 || p.paras.includes(v.v) || sec;
      if (newPara) {
        if (paraOpen) html += '</p>';
        if (sec) html += sectionHead(sec);
        html += `<p class="para${vi === 0 ? ' para--first' : ''}${IL ? ' para--il' : ''}">`;
        paraOpen = true;
      }
      if (IL) {
        html += `<span class="il il--vn">${vn(v.v)}</span> ` + piecesIL(v.pieces) + ' ';
      } else {
        html += (vi === 0 ? vn(v.v, true) : vn(v.v)) +
          piecesFlow(v.pieces, { initial: vi === 0 ? 3 : 0, initialUnit: firstUnit && firstUnit.u }) + ' ';
      }
    });
    if (paraOpen) html += '</p>';
    return html + '</section>';
  }

  function render() {
    closeCard(true);
    const list = PASSAGES[state.passage];
    state.units = [];
    let html = `<div class="reading" id="text" role="group" aria-label="Passage text. Use the arrow keys to move from word to word and Enter to see the ${state.passage === 'nt' ? 'Greek' : 'Hebrew'} behind it.">`;
    if (state.translation !== 'BSB') {
      const tr = TRANSLATIONS.find((t) => t.id === state.translation);
      html += `<p class="notice" role="status"><strong>${esc(tr.name)}</strong> — ${esc(tr.note)}. This mockup only carries the BSB text, so the BSB is shown below.</p>`;
    }
    for (const p of list) {
      const verses = sample.verses.filter((v) => +v.id.slice(0, 2) === p.num && +v.id.slice(2, 5) === p.chapter);
      const model = buildUnits(p, verses);
      // re-index into the global unit list
      model.units.forEach((u) => { u.idx = state.units.length; state.units.push(u); });
      html += renderPassage(p, model);
      if (p !== list[list.length - 1]) html += '<div class="interlude" aria-hidden="true"><span class="fleuron"></span></div>';
    }
    html += '</div>';
    $('#passages').innerHTML = html;
    document.body.classList.toggle('is-interlinear', state.interlinear);
    $('#glossesWrap').hidden = !state.interlinear;
    document.body.classList.toggle('no-glosses', !state.glosses);

    const nav = NAV[state.passage];
    $('#passageLabel').textContent = nav.label;
    $('#prevLabel').textContent = nav.prev;
    $('#nextLabel').textContent = nav.next;
    $('[data-step="prev"]').setAttribute('aria-label', `Previous chapter (${nav.prev})`);
    $('[data-step="next"]').setAttribute('aria-label', `Next chapter (${nav.next})`);
    $('#credits').textContent = CREDITS[state.passage];
    $$('.seg__opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.passage === state.passage)));
    document.title = `${nav.label} · Logos`;

    state.focusIdx = 0;
    const first = unitEl(0);
    if (first) first.tabIndex = 0;
    renderNotes();
  }

  const unitEl = (i) => document.querySelector(`.u[data-u="${i}"]`);
  const unitEls = (i) => $$(`.u[data-u="${i}"]`);

  /* ------------------------------------------------------------------ marginalia */

  function renderNotes() {
    const counts = new Map();
    for (const u of state.units) {
      const seen = new Set();
      for (const e of u.entries) {
        if (contentRank(e, u.lang) < 2) continue;
        const s = normStrongs(e.strongs).slice(0, 5);
        if (!s || seen.has(s) || s === 'G2258' || s === 'G1510' || s === 'H1961') continue;
        seen.add(s);
        const c = counts.get(s) || { s, n: 0, e, u, lang: u.lang };
        c.n++;
        counts.set(s, c);
      }
    }
    const items = [...counts.values()].filter((c) => c.n > 1).sort((a, b) => b.n - a.n || a.u.idx - b.u.idx).slice(0, 7);
    $('#notes').innerHTML = items.map((c) => {
      const lx = lexFor(c.s) || {};
      const lemma = lx.lemma || c.e.lemma;
      const isHeb = c.lang === 'hbo';
      return `<li><button type="button" class="note" data-strongs="${c.s}" data-first="${c.u.idx}">
        <span class="note__lemma" lang="${isHeb ? 'he' : 'grc'}"${isHeb ? ' dir="rtl"' : ''}>${esc(lemma)}</span>
        <span class="note__gloss">${esc(lx.gloss || cleanGloss(c.e.gloss))}</span>
        <span class="note__n" aria-label="${c.n} times">${c.n}×</span>
      </button></li>`;
    }).join('');
  }

  /* ------------------------------------------------------------------ highlighting */

  function clearMarks() {
    $$('.u.is-linked, .u.is-anchor, .u.is-kin, .u.is-preview').forEach((el) => el.classList.remove('is-linked', 'is-anchor', 'is-kin', 'is-preview'));
  }

  function markFor(u, sel) {
    clearMarks();
    const ids = new Set(u.ids);
    const strongs = normStrongs(u.entries[sel] && u.entries[sel].strongs).slice(0, 5);
    for (const v of state.units) {
      const linked = v.ids.some((id) => ids.has(id));
      v.linked = linked;
      const els = unitEls(v.idx);
      if (linked) els.forEach((el) => el.classList.add('is-linked'));
      else if (strongs && v.entries.some((e) => normStrongs(e.strongs).slice(0, 5) === strongs)) els.forEach((el) => el.classList.add('is-kin'));
    }
    unitEls(u.idx).forEach((el) => el.classList.add('is-anchor'));
  }

  function markStrongs(s) {
    clearMarks();
    for (const v of state.units) {
      if (v.entries.some((e) => normStrongs(e.strongs).slice(0, 5) === s)) unitEls(v.idx).forEach((el) => el.classList.add('is-kin'));
    }
  }

  /* ------------------------------------------------------------------ the word card */

  function headwordHTML(u, sel) {
    const lang = u.lang;
    return origWords(u).map((w) => w.parts.map((e) => {
      const i = u.entries.indexOf(e);
      const t = lang === 'hbo' ? stripCantillation(e.text) : e.text;
      return `<span class="${i === sel ? 'hw-sel' : 'hw-aux'}">${esc(t)}</span>`;
    }).join('')).join(' ');
  }

  function translitHTML(u, sel) {
    return origWords(u).map((w) => w.parts.map((e) => {
      const i = u.entries.indexOf(e);
      return `<span class="${i === sel ? 'hw-sel' : 'hw-aux'}">${esc(translitOf(e, u.lang))}</span>`;
    }).join('')).join(' ');
  }

  function glossCardHTML(u, sel) {
    const e = u.entries[sel];
    const isHeb = u.lang === 'hbo';
    const langName = isHeb ? 'Hebrew' : 'Greek';
    const tag = isHeb ? 'he' : 'grc';
    const dir = isHeb ? ' dir="rtl"' : '';
    const lx = lexFor(e.strongs) || {};
    const parse = isHeb ? parseHebrew(e.morph) : parseGreek(e.morph);
    const pos = parse[0];
    const form = parse.slice(1).filter(Boolean).join(' · ');
    const meaning = cleanGloss(e.gloss) || lx.gloss || '';
    const def = CURATED[normStrongs(e.strongs)] || lx.def || '';
    const lemma = isHeb ? stripCantillation(e.lemma) : e.lemma;
    const lemmaTr = isHeb ? (lx.translit || '') : translitGreek(e.lemma);
    const sid = showStrongs(e.strongs);
    const verses = lx.verses;
    const here = state.units.filter((v) => v.entries.some((x) => normStrongs(x.strongs).slice(0, 5) === normStrongs(e.strongs).slice(0, 5))).length;

    let lxx = '';
    if (isHeb && e.lxx) {
      const [form, gs] = e.lxx.split('|');
      const glx = gs && gs.length > 1 ? lexFor(gs) : null;
      const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()[0];
      const lemmaOk = glx && strip(glx.lemma) === strip(form);
      lxx = `<div class="facts__row facts__row--lxx"><dt>Septuagint</dt><dd><span class="lxx" lang="grc">${esc(lemmaOk ? glx.lemma : form)}</span>${lemmaOk ? ` <span class="facts__soft">${esc(translitGreek(glx.lemma))}</span>` : ''}${gs && gs.length > 1 ? ` <span class="strongs">${esc(showStrongs(gs))}</span>` : ''}</dd></div>`;
    }

    const chips = u.entries.length > 1 ? `<div class="morphs" role="tablist" aria-label="${isHeb ? 'Parts of this word' : 'Words in this phrase'}">${u.entries.map((x, i) => {
      const p = (isHeb ? parseHebrew(x.morph) : parseGreek(x.morph))[0];
      return `${i ? '<span class="morphs__plus" aria-hidden="true">+</span>' : ''}<button type="button" role="tab" class="morph" data-sel="${i}" aria-selected="${i === sel}">
        <span class="morph__or" lang="${tag}"${dir}>${esc(isHeb ? stripCantillation(x.text) : x.text)}</span>
        <span class="morph__meta">${esc(cleanGloss(x.gloss) || p)}<span class="morph__pos"> · ${esc(p.toLowerCase())}</span></span>
      </button>`;
    }).join('')}</div>` : '';

    return `
      <div class="gloss__top">
        <p class="gloss__context"><span class="gloss__ref">${esc(refOf(u))}</span><span class="gloss__en">“${enHTML(u.en)}”</span></p>
        <button type="button" class="gloss__close" aria-label="Close word card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button>
      </div>
      <div class="gloss__head">
        <p class="gloss__word" id="glossHead" lang="${tag}"${dir}><span class="sr-only">${langName}: </span>${headwordHTML(u, sel)}</p>
        <p class="gloss__translit"><span class="translit">${translitHTML(u, sel)}</span><span class="gloss__pos">${esc(pos)}</span></p>
      </div>
      ${chips}
      <div class="gloss__rule" aria-hidden="true"><span></span></div>
      <dl class="facts">
        <div class="facts__row facts__row--meaning"><dt>Meaning</dt><dd class="facts__meaning">${esc(meaning)}</dd></div>
        ${form ? `<div class="facts__row"><dt>Form</dt><dd>${esc(pos)} · ${esc(form)}</dd></div>` : ''}
        <div class="facts__row"><dt>Lexicon</dt><dd><span class="facts__lemma" lang="${tag}"${dir}>${esc(lemma)}</span>${lemmaTr ? ` <span class="facts__soft">${esc(lemmaTr)}</span>` : ''} <span class="strongs" title="Strong’s number">${esc(sid)}</span></dd></div>
        ${lxx}
      </dl>
      ${def ? `<p class="gloss__def">${esc(def)}</p>` : ''}
      <div class="gloss__actions">
        <button type="button" class="link-btn gloss__all"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>See all ${verses ? verses.toLocaleString('en-US') + ' verses' : 'occurrences'}<span aria-hidden="true"> ›</span></button>
        <span class="gloss__here">${here > 1 ? `${here}× on this page` : 'Once on this page'}</span>
      </div>`;
  }

  function announce(u, sel) {
    const e = u.entries[sel];
    const lx = lexFor(e.strongs) || {};
    const parse = u.lang === 'hbo' ? parseHebrew(e.morph) : parseGreek(e.morph);
    $('#live').textContent = `${u.en}: ${u.lang === 'hbo' ? 'Hebrew' : 'Greek'} ${stripCantillation(e.text)}, ${translitOf(e, u.lang)}. ${parse.join(', ')}. Means ${cleanGloss(e.gloss) || lx.gloss}. Strong’s ${showStrongs(e.strongs)}.`;
  }

  function openCard(idx, opts = {}) {
    const u = state.units[idx];
    if (!u) return;
    clearTimeout(openTimer); clearTimeout(closeTimer);
    const gloss = $('#gloss');
    const changed = state.open !== idx;
    if (state.open != null && changed) setExpanded(state.open, false);
    state.open = idx;
    if (changed || opts.sel != null) state.sel = opts.sel != null ? opts.sel : primaryIndex(u);
    state.pinned = !!opts.pin || (state.pinned && !changed && !opts.hover);
    if (opts.pin) state.pinned = true;
    $('#glossInner').innerHTML = glossCardHTML(u, state.sel);
    gloss.dataset.lang = u.lang;
    gloss.classList.toggle('is-pinned', state.pinned);
    const wasHidden = gloss.hidden;
    gloss.hidden = false;
    setExpanded(idx, true);
    markFor(u, state.sel);
    positionCard(opts.pointer);
    if (wasHidden && !reducedMotion.matches) {
      gloss.classList.remove('is-entering');
      void gloss.offsetWidth; // restart the entrance animation
      gloss.classList.add('is-entering');
    }
    if (opts.announce) announce(u, state.sel);
  }

  function setExpanded(idx, on) {
    unitEls(idx).forEach((el) => {
      el.setAttribute('aria-expanded', String(on));
      if (on) el.setAttribute('aria-describedby', 'gloss');
      else el.removeAttribute('aria-describedby');
    });
  }

  function closeCard(silent) {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    const gloss = $('#gloss');
    if (!gloss) return;
    if (state.open != null) setExpanded(state.open, false);
    state.open = null;
    state.pinned = false;
    gloss.hidden = true;
    gloss.classList.remove('is-entering');
    clearMarks();
    if (!silent) $('#live').textContent = '';
  }

  function positionCard(pointer) {
    const gloss = $('#gloss');
    if (state.open == null || gloss.hidden) return;
    const sheet = mobileMQ.matches;
    gloss.classList.toggle('gloss--sheet', sheet);
    const el = unitEl(state.open);
    if (!el) return;
    if (sheet) {
      gloss.style.left = gloss.style.top = '';
      gloss.classList.remove('is-above');
      // keep the word visible above the sheet
      requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const sheetTop = innerHeight - gloss.offsetHeight;
        if (r.bottom > sheetTop - 16 || r.top < 120) {
          window.scrollBy({ top: r.top - Math.max(130, (sheetTop - r.height) * 0.42), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
        }
      });
      return;
    }
    const folio = $('#folio').getBoundingClientRect();
    const rects = Array.from(el.getClientRects());
    let r = rects[0] || el.getBoundingClientRect();
    if (pointer && rects.length > 1) r = rects.find((x) => pointer.y >= x.top && pointer.y <= x.bottom) || r;
    const W = gloss.offsetWidth, H = gloss.offsetHeight;
    const gap = 12;
    const center = r.left + r.width / 2;
    const vwLeft = 12, vwRight = document.documentElement.clientWidth - 12;
    let left = Math.min(Math.max(center - 64, vwLeft), vwRight - W);
    const toolbarBottom = $('.toolbar').getBoundingClientRect().bottom;
    const below = r.bottom + gap;
    const fitsBelow = below + H <= innerHeight - 12;
    const fitsAbove = r.top - gap - H >= toolbarBottom + 8;
    const above = !fitsBelow && fitsAbove;
    const top = above ? r.top - gap - H : below;
    gloss.classList.toggle('is-above', above);
    gloss.style.left = `${left - folio.left}px`;
    gloss.style.top = `${top - folio.top}px`;
    gloss.style.setProperty('--caret-x', `${Math.min(Math.max(center - left, 22), W - 22)}px`);
  }

  /* ------------------------------------------------------------------ text interaction */

  function setFocusIdx(i, focus = true) {
    const n = state.units.length;
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    const prev = unitEl(state.focusIdx);
    if (prev) prev.tabIndex = -1;
    state.focusIdx = i;
    const el = unitEl(i);
    el.tabIndex = 0;
    if (focus) el.focus();
  }

  function bindText() {
    const host = $('#passages');
    host.addEventListener('pointerover', (ev) => {
      const el = ev.target.closest('.u');
      if (!el || ev.pointerType !== 'mouse') return;
      const idx = +el.dataset.u;
      clearTimeout(closeTimer);
      if (state.pinned && state.open !== idx) {
        el.classList.add('is-preview');
        return;
      }
      if (state.open === idx) return;
      clearTimeout(openTimer);
      el.classList.add('is-preview');
      const pointer = { x: ev.clientX, y: ev.clientY };
      openTimer = setTimeout(() => openCard(idx, { hover: true, pointer }), state.open == null ? 140 : 60);
    });
    host.addEventListener('pointerout', (ev) => {
      const el = ev.target.closest('.u');
      if (!el || ev.pointerType !== 'mouse') return;
      if (el.contains(ev.relatedTarget)) return;
      el.classList.remove('is-preview');
      clearTimeout(openTimer);
      if (!state.pinned) closeTimer = setTimeout(() => closeCard(), 280);
    });
    host.addEventListener('click', (ev) => {
      const el = ev.target.closest('.u');
      if (!el) return;
      const idx = +el.dataset.u;
      setFocusIdx(idx, false);
      if (state.open === idx && state.pinned) { closeCard(); return; }
      openCard(idx, { pin: true, pointer: { x: ev.clientX, y: ev.clientY }, announce: ev.pointerType !== 'mouse' });
    });
    host.addEventListener('focusin', (ev) => {
      const el = ev.target.closest('.u');
      if (el) {
        const prev = unitEl(state.focusIdx);
        if (prev && prev !== el) prev.tabIndex = -1;
        state.focusIdx = +el.dataset.u;
        el.tabIndex = 0;
      }
    });
    host.addEventListener('keydown', (ev) => {
      const el = ev.target.closest('.u');
      if (!el) return;
      const i = +el.dataset.u;
      const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (move) {
        ev.preventDefault();
        setFocusIdx(i + move);
        if (state.open != null) openCard(state.focusIdx, { pin: true, announce: true });
      } else if (ev.key === 'Home' || ev.key === 'End') {
        ev.preventDefault();
        setFocusIdx(ev.key === 'Home' ? 0 : state.units.length - 1);
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (state.open === i) closeCard();
        else openCard(i, { pin: true, announce: true });
      } else if (ev.key === 'Escape' && state.open != null) {
        ev.preventDefault();
        closeCard();
      }
    });

    const gloss = $('#gloss');
    gloss.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    gloss.addEventListener('pointerleave', (ev) => {
      if (ev.pointerType === 'mouse' && !state.pinned) closeTimer = setTimeout(() => closeCard(), 280);
    });
    gloss.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.morph');
      if (chip && state.open != null) {
        state.pinned = true;
        openCard(state.open, { sel: +chip.dataset.sel, pin: true });
        const again = $(`.morph[data-sel="${chip.dataset.sel}"]`);
        if (again) again.focus();
        return;
      }
      if (ev.target.closest('.gloss__close')) {
        const back = state.open;
        closeCard();
        if (back != null) setFocusIdx(back);
        return;
      }
      if (ev.target.closest('.gloss__all')) flash('The concordance opens here in the full app.');
      if (state.open != null && !state.pinned) { state.pinned = true; gloss.classList.add('is-pinned'); }
    });
    gloss.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        const back = state.open;
        closeCard();
        if (back != null) setFocusIdx(back);
      }
    });

    document.addEventListener('pointerdown', (ev) => {
      if (state.open == null) return;
      if (ev.target.closest('#gloss, .u, .note')) return;
      closeCard();
    });
    window.addEventListener('resize', () => positionCard());
    mobileMQ.addEventListener('change', () => positionCard());

    // marginalia
    const notes = $('#notes');
    notes.addEventListener('pointerover', (ev) => {
      const b = ev.target.closest('.note');
      if (b && state.open == null) markStrongs(b.dataset.strongs);
    });
    notes.addEventListener('pointerout', (ev) => {
      const b = ev.target.closest('.note');
      if (b && state.open == null && !b.contains(ev.relatedTarget)) clearMarks();
    });
    notes.addEventListener('click', (ev) => {
      const b = ev.target.closest('.note');
      if (!b) return;
      const idx = +b.dataset.first;
      const u = state.units[idx];
      const sel = u.entries.findIndex((e) => normStrongs(e.strongs).slice(0, 5) === b.dataset.strongs);
      unitEl(idx).scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      setTimeout(() => openCard(idx, { pin: true, sel: Math.max(0, sel), announce: true }), reducedMotion.matches ? 0 : 250);
    });
  }

  /* ------------------------------------------------------------------ search */

  function searchHTML(query) {
    const S = DATA.search;
    const q = query.trim().toLowerCase();
    if (!q) return '';
    if (!S || !/^lov/.test(q)) {
      const looksRef = /^\d?\s?[a-z]+\.?\s*\d+(:\d+)?/.test(q);
      return `<div class="sp__empty">${looksRef
        ? `<p class="sp__go"><span class="sp__go-label">Go to passage</span> <a href="#">${esc(query)}</a></p>`
        : `<p>This mockup carries one sample search. Try <button type="button" class="link-btn" data-try="love">love</button>.</p>`}</div>`;
    }
    const ot = S.perBook.filter((b) => b[2] === 'OT').reduce((a, b) => a + b[3], 0);
    const nt = S.perBook.filter((b) => b[2] === 'NT').reduce((a, b) => a + b[3], 0);
    const forms = Object.keys(S.formCounts);

    const hits = S.results.map((r) => {
      const tag = r.lang === 'hbo' ? 'he' : 'grc';
      const dir = r.lang === 'hbo' ? ' dir="rtl"' : '';
      const body = r.parts.map((p) => (typeof p === 'string' ? enHTML(p)
        : `<mark class="hit__m"><span class="hit__w">${esc(p.w)}</span><span class="hit__o" lang="${tag}"${dir}>${esc(p.o)}</span></mark>`)).join('');
      return `<li><a class="hit" href="#"><span class="hit__ref">${esc(r.ref)}</span><span class="hit__text">${body}</span></a></li>`;
    }).join('');

    const chips = S.behind.map((b) => {
      const isHeb = b.id[0] === 'H';
      const lx = LEX[b.id] || {};
      return `<li><button type="button" class="lexchip" title="${esc(b.gloss)} · Strong’s ${showStrongs(b.id)}">
        <span class="lexchip__or" lang="${isHeb ? 'he' : 'grc'}"${isHeb ? ' dir="rtl"' : ''}>${esc(b.lemma)}</span>
        <span class="lexchip__tr">${esc(isHeb ? (b.translit || lx.translit || '') : translitGreek(b.lemma))}</span>
        <span class="lexchip__n">${b.n}</span>
      </button></li>`;
    }).join('');

    return `
      <div class="sp__head">
        <p class="sp__count"><strong>${S.forms.toLocaleString('en-US')}</strong> verses <span class="sp__forms">contain ${forms.slice(0, 4).map((f) => `<i>${esc(f)}</i>`).join(', ')} or ${forms.length - 4} more forms</span></p>
        <div class="sp__filters">
          <div class="chips" role="radiogroup" aria-label="Where to search">
            <button type="button" role="radio" class="chip" aria-checked="true">Whole Bible</button>
            <button type="button" role="radio" class="chip" aria-checked="false">Old Testament <span class="chip__n">${ot}</span></button>
            <button type="button" role="radio" class="chip" aria-checked="false">New Testament <span class="chip__n">${nt}</span></button>
          </div>
          <label class="switch switch--small" for="exact">
            <input type="checkbox" id="exact" role="switch" />
            <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
            <span class="switch__label">Exact word <span class="chip__n">${S.exact}</span></span>
          </label>
        </div>
      </div>
      ${ribbonHTML(S)}
      <div class="sp__behind">
        <h3 class="sp__label">Behind the English <span class="sp__label-note">— search the original word instead</span></h3>
        <ul class="lexchips">${chips}</ul>
      </div>
      <h3 class="sp__label sp__label--results">Best matches</h3>
      <ol class="hits">${hits}</ol>
      <div class="sp__foot">
        <a href="#" class="link-btn">Show all ${S.forms.toLocaleString('en-US')} verses <span aria-hidden="true">›</span></a>
        <span class="sp__keys" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close</span>
      </div>`;
  }

  function ribbonHTML(S) {
    const books = S.perBook;
    const max = Math.max(...books.map((b) => b[3]));
    const W = 640, H = 58, base = 46, gapT = 14, bar = (W - gapT) / books.length;
    let x = 0, bars = '', labels = '';
    const top = books.slice().sort((a, b) => b[3] - a[3]).slice(0, 2).map((b) => b[0]);
    books.forEach((b, i) => {
      if (i === 39) x += gapT;
      const h = b[3] ? Math.max(2, (b[3] / max) * (base - 6)) : 0;
      const bx = x + 1;
      bars += `<rect class="ribbon__hit" x="${x.toFixed(1)}" y="0" width="${bar.toFixed(1)}" height="${H}" data-tip="${esc(b[1])} · ${b[3]} verse${b[3] === 1 ? '' : 's'}"/>`;
      if (h) bars += `<rect class="ribbon__bar ribbon__bar--${b[2].toLowerCase()}" x="${bx.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(bar - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.2"/>`;
      else bars += `<rect class="ribbon__zero" x="${bx.toFixed(1)}" y="${base - 1}" width="${(bar - 2).toFixed(1)}" height="1"/>`;
      if (top.includes(b[0])) labels += `<text class="ribbon__val" x="${(bx + (bar - 2) / 2).toFixed(1)}" y="${(base - h - 4).toFixed(1)}" text-anchor="middle">${b[3]}</text>`;
      x += bar;
    });
    const ntStart = 39 * bar + gapT;
    const desc = `Distribution of matching verses across the 66 books. Highest: ${top.map((id) => { const b = books.find((r) => r[0] === id); return `${b[1]} (${b[3]})`; }).join(', ')}.`;
    return `<figure class="ribbon">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}" preserveAspectRatio="none">
        <line class="ribbon__base" x1="0" x2="${W}" y1="${base + 0.5}" y2="${base + 0.5}"/>
        ${bars}${labels}
      </svg>
      <figcaption class="ribbon__axis" aria-hidden="true">
        <span style="left:0">Genesis</span>
        <span class="ribbon__mid" style="left:${((ntStart - gapT / 2) / W) * 100}%"></span>
        <span style="left:${((39 * bar - 2) / W) * 100}%; transform: translateX(-100%)">Malachi</span>
        <span style="left:${(ntStart / W) * 100}%">Matthew</span>
        <span style="right:0">Revelation</span>
      </figcaption>
    </figure>`;
  }

  function openSearch(query) {
    const panel = $('#searchPanel');
    const body = $('#searchBody');
    body.innerHTML = searchHTML(query);
    const has = !!query.trim();
    panel.hidden = !(has || mobileMQ.matches);
    $('#q').setAttribute('aria-expanded', String(!panel.hidden));
    $('#searchOpen').setAttribute('aria-expanded', String(!panel.hidden));
    document.body.classList.toggle('search-open', !panel.hidden);
  }
  function closeSearch() {
    $('#searchPanel').hidden = true;
    $('#q').setAttribute('aria-expanded', 'false');
    $('#searchOpen').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('search-open');
  }

  function bindSearch() {
    const q = $('#q'), q2 = $('#q2');
    const onInput = (ev) => {
      q.value = q2.value = ev.target.value;
      openSearch(ev.target.value);
    };
    q.addEventListener('input', onInput);
    q2.addEventListener('input', onInput);
    q.addEventListener('focus', () => { if (q.value.trim()) openSearch(q.value); });
    $('#searchOpen').addEventListener('click', () => { openSearch(q2.value); q2.focus(); });
    $('[data-close-search]').addEventListener('click', () => { closeSearch(); $('#searchOpen').focus(); });
    $('#searchBody').addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-try]');
      if (t) { q.value = q2.value = t.dataset.try; openSearch(t.dataset.try); }
      const chip = ev.target.closest('.chip');
      if (chip) $$('.chip', chip.parentElement).forEach((c) => c.setAttribute('aria-checked', String(c === chip)));
      if (ev.target.closest('a')) ev.preventDefault();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        ev.preventDefault();
        if (mobileMQ.matches) $('#searchOpen').click(); else q.focus();
      }
      if (ev.key === 'Escape' && !$('#searchPanel').hidden) { closeSearch(); q.blur(); }
    });
    document.addEventListener('pointerdown', (ev) => {
      if ($('#searchPanel').hidden || mobileMQ.matches) return;
      if (ev.target.closest('#searchPanel, .search')) return;
      closeSearch();
    });
    // ribbon tooltips
    const tip = $('#tip');
    $('#searchBody').addEventListener('pointermove', (ev) => {
      const r = ev.target.closest('.ribbon__hit');
      if (!r) { tip.hidden = true; return; }
      tip.textContent = r.dataset.tip;
      tip.hidden = false;
      const box = r.getBoundingClientRect();
      tip.style.left = `${box.left + box.width / 2}px`;
      tip.style.top = `${box.top - 6}px`;
    });
    $('#searchBody').addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  /* ------------------------------------------------------------------ popovers */

  const BOOKS_OT = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal'.split(' ');
  const BOOKS_NT = 'Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1Jn 2Jn 3Jn Jude Rev'.split(' ');

  function bookPanelHTML() {
    const cur = state.passage === 'nt' ? 'John' : 'Gen';
    const chapters = state.passage === 'nt' ? 21 : 50;
    const btn = (b) => {
      const live = b === 'John' || b === 'Gen' || b === 'Ps';
      return `<button type="button" class="book${b === cur ? ' is-current' : ''}${live ? '' : ' is-muted'}" data-book="${b}"${b === cur ? ' aria-current="true"' : ''}>${b.replace(/^(\d)/, '$1 ')}</button>`;
    };
    let ch = '';
    for (let i = 1; i <= chapters; i++) ch += `<button type="button" class="chap${i === 1 ? ' is-current' : ''}"${i === 1 ? ' aria-current="true"' : ''}>${i}</button>`;
    return `<div class="book-panel__cols">
        <section><h2 class="popover__label">Old Testament</h2><div class="books">${BOOKS_OT.map(btn).join('')}</div></section>
        <section><h2 class="popover__label">New Testament</h2><div class="books">${BOOKS_NT.map(btn).join('')}</div></section>
      </div>
      <section class="book-panel__chapters"><h2 class="popover__label">${state.passage === 'nt' ? 'John' : 'Genesis'} · chapters</h2><div class="chaps">${ch}</div></section>
      <p class="book-panel__note">This sample carries John 1, Genesis 1 and Psalm 23.</p>`;
  }

  function placePopover(pop, anchor, align = 'left') {
    const r = anchor.getBoundingClientRect();
    pop.hidden = false;
    if (mobileMQ.matches) { pop.style.left = pop.style.top = ''; return; }
    const W = pop.offsetWidth;
    let left = align === 'center' ? r.left + r.width / 2 - W / 2 : r.left;
    left = Math.max(12, Math.min(left, document.documentElement.clientWidth - W - 12));
    pop.style.left = `${left + scrollX}px`;
    pop.style.top = `${r.bottom + 8 + scrollY}px`;
  }

  function togglePopover(id, anchor, align) {
    const pop = $(id);
    const open = pop.hidden;
    $$('.popover').forEach((p) => { p.hidden = true; });
    $$('[aria-controls][aria-haspopup]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (open) {
      if (id === '#bookPanel') pop.innerHTML = bookPanelHTML();
      placePopover(pop, anchor, align);
      anchor.setAttribute('aria-expanded', 'true');
      const f = pop.querySelector('.is-current, input, button');
      if (f && !demos.length) f.focus();
    }
  }

  function bindChrome() {
    $('#passageBtn').addEventListener('click', (ev) => togglePopover('#bookPanel', ev.currentTarget, 'center'));
    $('#nivBtn').addEventListener('click', (ev) => togglePopover('#nivPanel', ev.currentTarget));
    $('#trCompact').addEventListener('click', (ev) => togglePopover('#trSheet', ev.currentTarget));
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close-popover]')) {
        const pop = ev.target.closest('.popover');
        pop.hidden = true;
        $$(`[aria-controls="${pop.id}"]`).forEach((b) => { b.setAttribute('aria-expanded', 'false'); b.focus(); });
      }
    });
    document.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.popover, [aria-haspopup="dialog"]')) return;
      $$('.popover').forEach((p) => { p.hidden = true; });
      $$('[aria-controls][aria-haspopup]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      const open = $$('.popover').find((p) => !p.hidden);
      if (open) {
        open.hidden = true;
        const opener = $(`[aria-controls="${open.id}"]`);
        if (opener) { opener.setAttribute('aria-expanded', 'false'); opener.focus(); }
      }
    });
    $('#bookPanel').addEventListener('click', (ev) => {
      const b = ev.target.closest('.book');
      if (!b) return;
      const book = b.dataset.book;
      if (book === 'John' || book === 'Gen' || book === 'Ps') {
        $('#bookPanel').hidden = true;
        $('#passageBtn').setAttribute('aria-expanded', 'false');
        setPassage(book === 'John' ? 'nt' : 'ot');
        if (book === 'Ps') document.querySelector('.passage--psa').scrollIntoView({ block: 'start' });
      } else flash('This sample carries John 1, Genesis 1 and Psalm 23.');
    });

    // translations
    const trList = $('#trList');
    trList.innerHTML = TRANSLATIONS.map((t) => `<li><button type="button" class="tr-item${t.id === 'BSB' ? ' is-current' : ''}${t.kind === 'remote' ? ' tr-item--remote' : ''}" data-tr="${t.id}">
      <span class="tr-item__abbr">${t.id}</span><span class="tr-item__name">${esc(t.name)}</span><span class="tr-item__note">${esc(t.note)}</span></button></li>`).join('');
    $('#translations').addEventListener('click', (ev) => {
      const b = ev.target.closest('.tr[data-tr]');
      if (b) setTranslation(b.dataset.tr);
    });
    $('#translations').addEventListener('keydown', (ev) => {
      const radios = $$('.tr[role="radio"]');
      const i = radios.indexOf(document.activeElement);
      if (i < 0) return;
      const d = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
      if (!d) return;
      ev.preventDefault();
      const next = radios[(i + d + radios.length) % radios.length];
      next.focus();
      setTranslation(next.dataset.tr);
    });
    trList.addEventListener('click', (ev) => {
      const b = ev.target.closest('.tr-item');
      if (!b) return;
      $('#trSheet').hidden = true;
      if (b.dataset.tr === 'NIV') { togglePopover('#nivPanel', $('#trCompact')); return; }
      setTranslation(b.dataset.tr);
    });

    // passage + modes
    $$('.seg__opt').forEach((b) => b.addEventListener('click', () => setPassage(b.dataset.passage)));
    $('.seg').addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        const next = state.passage === 'nt' ? 'ot' : 'nt';
        setPassage(next);
        $(`.seg__opt[data-passage="${next}"]`).focus();
      }
    });
    $$('.passage-nav__step').forEach((b) => b.addEventListener('click', () => flash(`${b.dataset.step === 'prev' ? NAV[state.passage].prev : NAV[state.passage].next} is not in this sample.`)));
    $$('.chapter-nav__link').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); flash(`${a.textContent.replace(/[‹›]/g, '').trim()} is not in this sample.`); }));
    const il = $('#interlinear');
    il.checked = state.interlinear;
    il.addEventListener('change', () => { state.interlinear = il.checked; render(); });
    $('#glosses').addEventListener('change', (ev) => { state.glosses = ev.target.checked; document.body.classList.toggle('no-glosses', !state.glosses); });

    // theme
    const themeBtn = $('#themeBtn');
    const syncTheme = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      themeBtn.setAttribute('aria-pressed', String(dark));
      themeBtn.title = dark ? 'Switch to vellum (light)' : 'Switch to candlelight (dark)';
      $('#themeLabel').textContent = 'Candlelight (dark) theme';
    };
    syncTheme();
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('illum-theme', next); } catch (e) { /* storage unavailable */ }
      syncTheme();
    });
  }

  function setPassage(p) {
    if (p === state.passage) return;
    state.passage = p;
    render();
  }

  function setTranslation(id) {
    state.translation = id;
    $$('.tr[role="radio"]').forEach((b) => {
      const on = b.dataset.tr === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $$('.tr-item').forEach((b) => b.classList.toggle('is-current', b.dataset.tr === id));
    $('#trCompactLabel').textContent = id;
    render();
  }

  let flashTimer = 0;
  function flash(msg) {
    let el = $('.flash');
    if (!el) {
      el = document.createElement('div');
      el.className = 'flash';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
  }

  /* ------------------------------------------------------------------ boot */

  async function boot() {
    try {
      const res = await fetch('../../sample.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sample = await res.json();
    } catch (err) {
      $('#passages').innerHTML = `<p class="notice">Could not load <code>design/sample.json</code> (${esc(err.message)}). Serve the repository root over HTTP and open <code>/design/concepts/illuminated/</code>.</p>`;
      return;
    }
    $$('.tr[role="radio"]').forEach((b) => { b.tabIndex = b.dataset.tr === 'BSB' ? 0 : -1; });
    bindChrome();
    bindText();
    bindSearch();
    render();

    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const findUnit = (book, verse, en) => state.units.find((u) => u.book === book && u.verse === verse && u.en === en);
    if (demos.includes('hover')) {
      const u = findUnit('JHN', 1, 'Word');
      if (u) openCard(u.idx, { pin: true });
    }
    if (demos.includes('hover-ot')) {
      const u = findUnit('GEN', 1, 'God');
      if (u) openCard(u.idx, { pin: true });
    }
    if (demos.includes('search')) {
      $('#q').value = $('#q2').value = 'love';
      openSearch('love');
    }
    if (demos.includes('books')) togglePopover('#bookPanel', $('#passageBtn'), 'center');
    if (demos.includes('niv')) togglePopover('#nivPanel', mobileMQ.matches ? $('#trCompact') : $('#nivBtn'));
    if ($('#gloss') && !$('#gloss').hidden) $('#gloss').classList.remove('is-entering');
    document.documentElement.dataset.ready = '1';
  }

  boot();
})();
