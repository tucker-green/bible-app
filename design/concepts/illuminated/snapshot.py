"""
Snapshot real lexicon / concordance / search data for the "illuminated" mockup.

Reads the generated site data in public/data/ (produced by `npm run data:build`) plus
design/sample.json, and writes design/concepts/illuminated/data.js, a small static
file the mockup loads with a <script> tag so it stays self-contained.

    python3 design/concepts/illuminated/snapshot.py      # from the repo root

Nothing here is used by the real app; it only freezes numbers so the mockup shows
true occurrence counts, lexicon glosses and search results instead of lorem ipsum.
"""
import json
import os
import re
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DATA = os.path.join(ROOT, 'public', 'data')
OUT = os.path.join(os.path.dirname(__file__), 'data.js')


def load(*parts):
    with open(os.path.join(DATA, *parts), encoding='utf8') as f:
        return json.load(f)


def norm(sid):
    m = re.match(r'^([GH])0*(\d+)([a-z]?)$', sid or '')
    if not m:
        return ''
    return f'{m.group(1)}{int(m.group(2)):04d}{m.group(3)}'


_lex_cache, _conc_cache = {}, {}


def lex(sid):
    lang, n = sid[0], int(re.sub(r'\D', '', sid))
    key = (lang, n // 100)
    if key not in _lex_cache:
        try:
            _lex_cache[key] = load('lex', lang, f'{n // 100:03d}.json')
        except FileNotFoundError:
            _lex_cache[key] = {}
    chunk = _lex_cache[key]
    return chunk.get(sid) or chunk.get(sid[:5])


def conc(sid):
    base = sid[:5]
    lang, n = base[0], int(base[1:])
    key = (lang, n // 100)
    if key not in _conc_cache:
        try:
            _conc_cache[key] = load('conc', lang, f'{n // 100:03d}.json')
        except FileNotFoundError:
            _conc_cache[key] = {}
    return len(_conc_cache[key].get(base, []))


def plain(html):
    t = re.sub(r'<br\s*/?>', ' ', html or '')
    t = re.sub(r'<[^>]+>', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def clip(text, n=190):
    text = text.strip()
    if len(text) <= n:
        return text
    cut = text[:n].rsplit(' ', 1)[0].rstrip(',;:')
    return cut + '…'


sample = json.load(open(os.path.join(ROOT, 'design', 'sample.json'), encoding='utf8'))
ids = set()
for w in sample['orig'].values():
    if w.get('strongs'):
        ids.add(norm(w['strongs']))
    if w.get('lxx') and '|' in w['lxx']:
        s = norm(w['lxx'].split('|')[1])
        if s:
            ids.add(s)

LEX = {}
for sid in sorted(ids):
    e = lex(sid)
    if not e:
        continue
    LEX[sid] = {
        'lemma': e['lemma'],
        'translit': e['translit'],
        'pos': e['pos'],
        'gloss': e['gloss'],
        'def': clip(plain(e.get('strongsDef') or e.get('def') or '')),
        'kjv': clip(plain(e.get('kjv') or ''), 120),
        'verses': conc(sid),
    }

# ---------------------------------------------------------------- search "love"
corpus = load('search', 'BSB.json')['verses']
meta = load('meta.json')
books = meta['books']
FORMS = re.compile(r"\b(love|loved|loves|loving|lovingly|lover|lovers)\b", re.I)
EXACT = re.compile(r"\blove\b", re.I)
per_book = Counter()
total_forms = total_exact = 0
form_counts = Counter()
for b, c, v, text in corpus:
    found = FORMS.findall(text)
    if found:
        total_forms += 1
        per_book[b] += 1
        for f in found:
            form_counts[f.lower()] += 1
    if EXACT.search(text):
        total_exact += 1

behind = Counter()
behind_form = {}
for bk in books:
    for ch in range(1, len(bk['verses']) + 1):
        try:
            t = load('text', 'BSB', bk['id'], f'{ch}.json')
            o = load('orig', bk['id'], f'{ch}.json')
        except FileNotFoundError:
            continue
        for verse in t['verses']:
            for tok in verse['t']:
                if isinstance(tok, list) and FORMS.fullmatch(tok[0]):
                    for i in tok[1]:
                        w = o['words'][i]
                        sid = norm(w[1])
                        if sid and w[3] not in ('Td', 'C', 'R') and not w[3].startswith('Sp'):
                            behind[sid[:5]] += 1
                            behind_form.setdefault(sid[:5], w[2])

top = []
for sid, n in behind.most_common(6):
    e = lex(sid) or {}
    top.append({'id': sid, 'lemma': e.get('lemma', behind_form[sid]), 'translit': e.get('translit', ''),
                'gloss': e.get('gloss', ''), 'n': n})

TOP_IDS = {x['id'] for x in top}
PICK = [('DEU', 6, 5), ('PSA', 136, 1), ('JHN', 3, 16), ('JHN', 21, 15), ('1CO', 13, 4), ('1JN', 4, 8)]
results = []
for bid, ch, vn in PICK:
    t = load('text', 'BSB', bid, f'{ch}.json')
    o = load('orig', bid, f'{ch}.json')
    verse = next(v for v in t['verses'] if v['v'] == vn)
    parts = []
    for tok in verse['t']:
        if isinstance(tok, str):
            parts.append(tok)
        elif FORMS.fullmatch(tok[0]):
            idx = [i for i in tok[1] if norm(o['words'][i][1])[:5] in TOP_IDS] or tok[1]
            w = o['words'][idx[0]]
            # show the whole written word (Hebrew prefixes/suffixes are separate morphemes)
            written = ''.join(x[0] for x in o['words'] if x[7] == w[7])
            written = re.sub('[\u0591-\u05AF\u05BD]', '', written)
            parts.append({'w': tok[0], 'o': written, 's': norm(w[1]), 'l': w[2]})
        else:
            parts.append(tok[0])
    # merge adjacent strings
    merged = []
    for p in parts:
        if isinstance(p, str) and merged and isinstance(merged[-1], str):
            merged[-1] += p
        else:
            merged.append(p)
    bk = next(b for b in books if b['id'] == bid)
    name = 'Psalm' if bid == 'PSA' else bk['name']
    results.append({'ref': f"{name} {ch}:{vn}", 'book': bid, 'parts': merged,
                    'lang': o['lang']})

SEARCH = {
    'query': 'love',
    'exact': total_exact,
    'forms': total_forms,
    'formCounts': dict(form_counts.most_common()),
    'perBook': [[b['id'], b['short'], b['testament'], per_book.get(b['num'], 0)] for b in books],
    'behind': top,
    'results': results,
}

with open(OUT, 'w', encoding='utf8') as f:
    f.write('/* Generated by snapshot.py from public/data — real lexicon, concordance and search numbers. */\n')
    f.write('window.ILLUM_DATA = ')
    json.dump({'lex': LEX, 'search': SEARCH}, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(f'wrote {OUT}: {len(LEX)} lexicon entries, love: {total_exact} exact / {total_forms} with forms')
print('behind:', [(x["lemma"], x["n"]) for x in top])
