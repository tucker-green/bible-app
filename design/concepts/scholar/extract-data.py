#!/usr/bin/env python3
"""
Snapshot the real generated data (public/data/) that the "scholar" mockup needs beyond
design/sample.json, into design/concepts/scholar/data.js, so the mockup is self-contained.

  python3 design/concepts/scholar/extract-data.py      (run from the repo root)

What it writes (window.SCHOLAR_DATA):
  books     [id, name, short, testament, chapters] for all 66 books (from src/lib/books.ts)
  passages  per demo passage: headings, paragraphs, and the verses that are NOT in sample.json
            (tokens in sample-like form: string = unlinked text, [text, [origIds]] = linked word)
  orig      original-language words for those extra verses (same fields as sample.json + `w` group key)
  lex       lexicon digest for every Strong's id the mockup can show (lemma line, pos, gloss, def excerpt)
  conc      verse count + per-book distribution (66 ints) per Strong's id
  rend      top BSB English renderings per Strong's id
  search    a canned "love" search: totals, per-book distribution, original-word facets, top results
"""
import glob
import html
import json
import math
import os
import re
from collections import Counter, defaultdict

ROOT = os.getcwd()
DATA = os.path.join(ROOT, 'public', 'data')
OUT = os.path.join(ROOT, 'design', 'concepts', 'scholar', 'data.js')

sample = json.load(open(os.path.join(ROOT, 'design', 'sample.json'), encoding='utf8'))

# ---------------------------------------------------------------- books
books_src = open(os.path.join(ROOT, 'src', 'lib', 'books.ts'), encoding='utf8').read()
BOOKS = []
for m in re.finditer(r"\['([0-9A-Z]{3})', '([^']+)', '([^']+)', (\d+), \[", books_src):
    BOOKS.append([m.group(1), m.group(2), m.group(3), 'OT' if len(BOOKS) < 39 else 'NT', int(m.group(4))])
assert len(BOOKS) == 66, len(BOOKS)
BOOK_NUM = {b[0]: i + 1 for i, b in enumerate(BOOKS)}


def norm_sid(s):
    """'G746' -> 'G0746'; 'H0871a' stays; '' / 'G' -> ''."""
    m = re.match(r'^([GH])(\d+)([a-z]?)$', s or '')
    if not m:
        return ''
    return f'{m.group(1)}{int(m.group(2)):04d}{m.group(3)}'


def base_sid(s):
    return re.sub(r'[a-z]$', '', s)


_lex_cache = {}


def lex_entry(sid):
    if not sid:
        return None
    chunk = f'{sid[0]}/{int(sid[1:5]) // 100:03d}'
    if chunk not in _lex_cache:
        p = os.path.join(DATA, 'lex', chunk + '.json')
        _lex_cache[chunk] = json.load(open(p, encoding='utf8')) if os.path.exists(p) else {}
    return _lex_cache[chunk].get(sid) or _lex_cache[chunk].get(base_sid(sid))


_conc_cache = {}


def conc_entry(sid):
    b = base_sid(sid)
    chunk = f'{b[0]}/{int(b[1:5]) // 100:03d}'
    if chunk not in _conc_cache:
        p = os.path.join(DATA, 'conc', chunk + '.json')
        _conc_cache[chunk] = json.load(open(p, encoding='utf8')) if os.path.exists(p) else {}
    return _conc_cache[chunk].get(b) or []


_text_cache = {}


def chapter(book, ch):
    key = (book, ch)
    if key not in _text_cache:
        t = json.load(open(os.path.join(DATA, 'text', 'BSB', book, f'{ch}.json'), encoding='utf8'))
        o = json.load(open(os.path.join(DATA, 'orig', book, f'{ch}.json'), encoding='utf8'))
        _text_cache[key] = (t, o)
    return _text_cache[key]


# ---------------------------------------------------------------- passages
PASSAGES = {
    # passage id: (book, chapter, first verse, last verse)
    'john1': ('JHN', 1, 1, 18),
    'gen1': ('GEN', 1, 1, 5),
    'ps23': ('PSA', 23, 1, 6),
}
sample_verses = {v['id'] for v in sample['verses']}
extra_orig = {}
passages = {}


def oid(book, ch, idx):
    return f'{book}{ch}:{idx}'


def add_orig(book, ch, o, idx):
    w = o['words'][idx]
    key = oid(book, ch, idx)
    if key not in extra_orig:
        extra_orig[key] = {
            'text': w[0], 'strongs': w[1], 'lemma': w[2], 'morph': w[3], 'gloss': w[4],
            'translit': w[8], 'lxx': w[9], 'w': f'{book}{ch}:g{w[7]}',
        }
    return key


def convert_tokens(book, ch, o, toks):
    out = []
    for tk in toks:
        if isinstance(tk, str):
            out.append(tk)
        else:
            ids = [add_orig(book, ch, o, i) for i in tk[1]]
            item = [tk[0], ids]
            if len(tk) > 2 and tk[2].get('i'):
                item.append({'i': 1})
            out.append(item)
    return out


for pid, (book, ch, v1, v2) in PASSAGES.items():
    t, o = chapter(book, ch)
    bn = BOOK_NUM[book]
    verses = []
    for vv in t['verses']:
        if not (v1 <= vv['v'] <= v2):
            continue
        vid = f'{bn:02d}{ch:03d}{vv["v"]:03d}'
        if vid in sample_verses:
            verses.append({'v': vv['v'], 'sample': vid})
        else:
            verses.append({'v': vv['v'], 't': convert_tokens(book, ch, o, vv['t'])})
    passages[pid] = {
        'book': book, 'chapter': ch, 'from': v1, 'to': v2,
        'verseCount': len(t['verses']),
        'headings': t.get('headings', []),
        'paras': t.get('paras', []),
        'superscription': convert_tokens(book, ch, o, t['superscription']) if t.get('superscription') else None,
        'verses': verses,
    }

# ---------------------------------------------------------------- strongs in play
sids = set()
for w in sample['orig'].values():
    sids.add(norm_sid(w['strongs']))
    if w.get('lxx'):
        sids.add(norm_sid(w['lxx'].split('|')[1]))
for w in extra_orig.values():
    sids.add(norm_sid(w['strongs']))
    if w.get('lxx'):
        sids.add(norm_sid(w['lxx'].split('|')[1]))

# ---------------------------------------------------------------- search: "love"
LOVE = re.compile(r"\b(love|loves|loved|loving)\b", re.I)
corpus = json.load(open(os.path.join(DATA, 'search', 'BSB.json'), encoding='utf8'))['verses']
hits = [v for v in corpus if LOVE.search(v[3])]
per_book = [0] * 66
for v in hits:
    per_book[v[0] - 1] += 1

# Hebrew prefixes / suffixes / particles (OSHB-style codes): preposition, conjunction, article, suffix.
PREFIX_MORPH = re.compile(r'^(R|C|Td|To|S[a-z])')


def primary_word(o, idxs):
    """The content word behind a token: skip Hebrew prefixes/suffixes/articles when there is a better one."""
    words = [o['words'][i] for i in idxs]
    content = [w for w in words if not (w[1].startswith('H') and PREFIX_MORPH.match(w[3] or ''))]
    return (content or words)[-1] if words else None


facet = Counter()
facet_form = {}
results = []
for bnum, ch, vs, text in hits:
    book = BOOKS[bnum - 1][0]
    t, o = chapter(book, ch)
    vv = next((x for x in t['verses'] if x['v'] == vs), None)
    if vv is None:
        continue
    segs = []
    matches = 0
    for tk in vv['t']:
        if isinstance(tk, str):
            segs.append(tk)
            continue
        if LOVE.fullmatch(tk[0]) and tk[1]:
            w = primary_word(o, tk[1])
            sid = norm_sid(w[1])
            facet[sid] += 1
            facet_form.setdefault(sid, (w[2]))
            # the full written word (all morphemes of the same group) for display
            grp = w[7]
            written = ''.join(x[0] for x in o['words'] if x[7] == grp and x[5] == w[5])
            segs.append([tk[0], written, w[2], sid])
            sids.add(sid)
            matches += 1
        else:
            segs.append(tk[0])
    # merge adjacent plain strings
    merged = []
    for s in segs:
        if isinstance(s, str) and merged and isinstance(merged[-1], str):
            merged[-1] += s
        else:
            merged.append(s)
    nwords = len(text.split())
    score = matches / math.sqrt(max(nwords, 4))
    results.append({'b': bnum, 'c': ch, 'v': vs, 's': round(score, 4), 't': merged})

results.sort(key=lambda r: (-r['s'], r['b'], r['c'], r['v']))
top = results[:14]
# Make sure the best-known verse is in the glimpse.
if not any(r['b'] == 43 and r['c'] == 3 and r['v'] == 16 for r in top):
    j316 = next(r for r in results if r['b'] == 43 and r['c'] == 3 and r['v'] == 16)
    top.insert(3, j316)
ot_hits = sum(per_book[:39])
search = {
    'query': 'love',
    'forms': ['love', 'loves', 'loved', 'loving'],
    'verses': len(hits),
    'ot': ot_hits,
    'nt': len(hits) - ot_hits,
    'perBook': per_book,
    'facets': [[sid, n] for sid, n in facet.most_common(8)],
    'results': top,
}

# ---------------------------------------------------------------- renderings (whole BSB)
# Normalise a rendering to its head words: "of the Word's" -> "Word", "your God" -> "God".
FUNCTION_WORDS = {'the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'for', 'from', 'with', 'by', 'at',
                  'o', 'your', 'my', 'his', 'her', 'our', 'their', 'its', 'is', 'are', 'was', 'were',
                  'be', 'will', 'shall', 'has', 'have', 'had', 'then', 'now', 'but', 'so', 'as', 'that',
                  'this', 'these', 'those', 'he', 'she', 'it', 'they', 'we', 'you', 'i', 'not', 'does',
                  'do', 'did', 'into', 'upon', 'all'}


def head_phrase(words):
    ws = [re.sub(r"[’']s$", '', w) for w in words]
    while len(ws) > 1 and ws[0].lower() in FUNCTION_WORDS:
        ws = ws[1:]
    return ' '.join(ws)


rend = defaultdict(Counter)
rend_case = defaultdict(Counter)
want = {base_sid(s) for s in sids if s}
for path in glob.glob(os.path.join(DATA, 'text', 'BSB', '*', '*.json')):
    book = os.path.basename(os.path.dirname(path))
    ch = int(os.path.basename(path)[:-5])
    t, o = chapter(book, ch)
    for vv in t['verses']:
        # consecutive words with identical links form one rendering ("the beginning" -> ἀρχῇ)
        prev = None
        group = []
        flush_groups = []
        for tk in vv['t']:
            if isinstance(tk, str):
                if tk.strip() and group:
                    flush_groups.append((group, prev))
                    group = []
                    prev = None
                continue
            if prev is not None and tk[1] == prev:
                group.append(tk[0])
            else:
                if group:
                    flush_groups.append((group, prev))
                group = [tk[0]]
                prev = tk[1]
        if group and prev is not None:
            flush_groups.append((group, prev))
        for words, links in flush_groups:
            if not links:
                continue
            phrase = head_phrase(words)
            if not phrase:
                continue
            seen = set()
            for i in links:
                if i >= len(o['words']):
                    continue
                b = base_sid(norm_sid(o['words'][i][1]))
                if b in want and b not in seen:
                    seen.add(b)
                    rend[b][phrase.lower()] += 1
                    rend_case[(b, phrase.lower())][phrase] += 1
    _text_cache.clear()

rend_out = {}
for b, cnt in rend.items():
    total = sum(cnt.values())
    top4 = []
    for p, n in cnt.most_common(5):
        disp = rend_case[(b, p)].most_common(1)[0][0]
        top4.append([disp, n])
    rend_out[b] = {'total': total, 'top': top4}

# ---------------------------------------------------------------- lexicon digest
CURATED = {
    'G3056': ("A word as the expression of thought — a saying, message or account; also reason. "
              "In John’s prologue, the eternal and personal self-expression of God.", 'Abbott-Smith, abridged'),
    'G0746': ("Beginning, origin, first cause; also rule or authority, and in the plural, rulers. "
              "Ἐν ἀρχῇ echoes the first words of Genesis in the Greek Bible.", 'Abbott-Smith, abridged'),
    'G2316': ("A god or deity; in the New Testament chiefly the one true God. Without the article, "
              "as in John 1:1c, it can describe what the Word is in nature.", 'Abbott-Smith, abridged'),
    'H0430': ("Plural in form (“gods”), yet with singular verbs the ordinary name of the one true "
              "God — a plural of majesty. Also used of pagan gods, angels or judges.", 'BDB, abridged'),
    'H7225': ("Beginning, first; the first or choicest part, as of firstfruits. In Genesis 1:1, the "
              "absolute beginning of time and of creation.", 'BDB, abridged'),
    'H1254': ("To create, shape, form. In the Qal its subject is always God: divine activity that "
              "brings into being what did not exist before.", 'BDB, abridged'),
    'G0025': ("To love: to value, esteem and act in goodwill toward someone; to prize something. "
              "Used of God’s love for the world, and of love for God and neighbour.", 'Abbott-Smith, abridged'),
    'H3068': ("The covenant name of the God of Israel, read aloud as Adonai (“Lord”) and printed "
              "LORD in small capitals; linked with “I AM” (Exod 3:14).", 'BDB, abridged'),
    'G2222': ("Life — natural life, and above all in John the life that belongs to God and is "
              "given through the Son: eternal life.", 'Abbott-Smith, abridged'),
    'G5457': ("Light, as opposed to darkness; figuratively the truth and holiness of God made "
              "known, and the one who makes it known.", 'Abbott-Smith, abridged'),
    'G4653': ("Darkness; figuratively the realm of ignorance and evil that stands opposed to the "
              "light of God.", 'Abbott-Smith, abridged'),
    'H0216': ("Light — daylight, the light of the luminaries, and figuratively life, prosperity "
              "and the presence of God.", 'BDB, abridged'),
    'H7473': ("To pasture, tend or shepherd a flock; as a participle, “shepherd” — an image of a "
              "king’s care for his people, and of God’s.", 'BDB, abridged'),
}


def strip_html(s):
    s = re.sub(r'<br\s*/?>', ' ', s or '')
    s = re.sub(r'<[^>]+>', '', s)
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


def excerpt(s, n=230):
    s = s.strip()
    if len(s) <= n:
        return s
    cut = s[:n]
    cut = cut[: cut.rfind(' ')].rstrip(',;:')
    return cut + '…'


lex = {}
conc = {}
for sid in sorted(s for s in sids if s):
    e = lex_entry(sid)
    if not e:
        continue
    raw = e.get('def', '')
    lemma_line = ''
    if sid.startswith('G'):
        first = raw.split('<br>')[0]
        if '<b>' in first:
            lemma_line = strip_html(first)
    if sid in CURATED:
        d, src = CURATED[sid]
    else:
        prose = strip_html(raw)
        numbered = bool(re.match(r'^\s*1\)', prose)) or raw.startswith('<b>' + e['lemma']) or 'Form of' in prose
        if not numbered and prose and len(prose) < 600 and not prose.startswith('This name'):
            d, src = excerpt(prose), 'Lexicon'
        else:
            d, src = excerpt(e.get('strongsDef') or prose), "Strong's"
        if d:
            d = d[0].upper() + d[1:]
    lex[sid] = {
        'lemma': e['lemma'], 'translit': e['translit'], 'pos': e['pos'], 'gloss': e['gloss'],
        'line': lemma_line, 'def': d, 'src': src,
    }
    refs = conc_entry(sid)
    dist = [0] * 66
    for r in refs:
        dist[r // 1_000_000 - 1] += 1
    conc[base_sid(sid)] = {'n': len(refs), 'd': dist}

out = {
    'books': BOOKS,
    'passages': passages,
    'orig': extra_orig,
    'lex': lex,
    'conc': conc,
    'rend': rend_out,
    'search': search,
}
with open(OUT, 'w', encoding='utf8') as f:
    f.write('/* Generated by extract-data.py from public/data/ (BSB, SBLGNT, WLC/Macula, STEPBible, Strong\'s). */\n')
    f.write('window.SCHOLAR_DATA = ')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(f'wrote {OUT}: {os.path.getsize(OUT)} bytes; lex={len(lex)} conc={len(conc)} rend={len(rend_out)} '
      f'extra orig={len(extra_orig)} love verses={len(hits)} facets={search["facets"][:4]}')
