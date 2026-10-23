# Rootword — Architecture

A static website (Vite + Preact + TypeScript). There is no server: all Bible text, original-language
data, lexicons and search corpora are pre-built JSON files under `public/data/`, fetched on demand
chapter by chapter. Hash routing (`#/BSB/JHN/3/16`) lets the build run from any static host.

```
scripts/
  fetch-sources.mjs        download raw datasets into .cache/sources/   (npm run data:fetch)
  build-data.ts            orchestrates every stage below                (npm run data:build)
  data/
    common.ts              shared helpers: paths, TSV/XML readers, Strong's normalisation, JSON writers
    orig.ts                SBLGNT + WLC/Macula -> public/data/orig/{BOOK}/{C}.json
    bsb.ts                 BSB tokens + manual alignments + headings -> public/data/text/BSB/...
    kjv.ts                 KJV with Strong's -> text/KJV/... (links by Strong's within the verse)
    bridged.ts             WEB / ASV / YLT -> text/{TR}/... aligned through the BSB (src/lib/align)
    lexicon.ts             STEPBible TBESG/TBESH + Strong's -> public/data/lex/{G|H}/{NNN}.json
    concordance.ts         Strong's -> verse list -> public/data/conc/{G|H}/{NNN}.json
    search.ts              plain-text corpora -> public/data/search/{TR}.json
    meta.ts                public/data/meta.json (books, verse counts, translations, credits)
src/
  lib/                     framework-free logic, shared by app and pipeline where noted
    types.ts               data contracts (THE source of truth for every JSON file)
    books.ts               canon, names, aliases
    tokenize.ts            word segmentation (shared with pipeline)
    align/                 bridge alignment: any English text -> original words via the BSB (shared)
    reference.ts           "jn 3:16", "1 Cor 13", "Ps 23:1-4" -> VerseRef
    data.ts                cached loaders for meta / chapters / lexicon / concordance
    greek.ts               Greek transliteration + normalisation
    morph.ts               Robinson (Greek) and OSHB (Hebrew) morphology codes -> readable parsing
    search/                search engine (runs in a Web Worker) + query parser
    providers/apibible.ts  optional runtime translations (e.g. NIV) via the user's API.Bible key
  components/              Preact UI
  styles/                  design tokens + global CSS
tests/                     Vitest unit tests
e2e/                       Playwright end-to-end tests
```

## Translations

The KJV is the default translation (first in `meta.json` and in the picker).

| id  | alignment | how the Greek/Hebrew link is made |
|-----|-----------|------------------------------------|
| KJV (default) | strongs | CrossWire KJV carries Strong's numbers on each English word; linked to the original word in the same verse with that number (TR-only words keep their Strong's for lexicon lookup). |
| BSB | manual    | Clear-Bible's hand-made BSB↔SBLGNT/WLC alignment: every English word points at the exact original word(s). |
| WEB, ASV, YLT | bridged | Automatic: each word is matched to the BSB word(s) of the same verse and inherits their links, using a translation table learned from the BSB and KJV alignments. Shown as approximate. |
| NIV (and others) | bridged, remote | Copyrighted; not bundled. Users with an API.Bible key can read them; the same bridge alignment runs in the browser. |

## Original languages

New Testament words link to the SBLGNT Greek. Old Testament words link to the Hebrew (and Aramaic)
of the Westminster Leningrad Codex; the word card also shows the Septuagint-equivalent Greek word
from Macula Hebrew, so the OT still gets a Greek word under the English one.
