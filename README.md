# Rootword

**Read the Bible in English and see the Greek or Hebrew behind every word.**

Rootword is a static website for reading and searching the Bible in several English translations.
Hover over a word (or tap it on a phone) and the original word appears beneath it: the Greek of the
New Testament, or the Hebrew of the Old Testament together with the Greek word the Septuagint used
for it. Each card gives the transliteration, the dictionary form, the Strong's number, the grammar
in plain English and a definition.

There is no server and no account. The whole Bible, the original-language texts, lexicons, cross
references and search indexes are pre-built JSON files that the browser fetches a chapter at a time.
The site works offline once installed.

---

## Features

**Reading**
- KJV by default; BSB, WEB, ASV and YLT bundled, and the NIV with your own API.Bible key (see below).
- **Word cards.** Hover, click, tap or press Enter on any word to see the original word, its
  transliteration, lemma, Strong's number, parsing in plain English (raw morphology codes optional),
  gloss, how this translation usually renders it, a definition, and how often it occurs (with a
  spark chart). Other words in the chapter with the same Strong's number are underlined. Words the
  KJV supplied (printed in italics) are marked as having nothing behind them.
- **Old Testament.** The Hebrew (or Aramaic) word, plus its Septuagint Greek equivalent.
- **Pronunciation.** A speaker button reads the Greek or Hebrew word aloud with the device's own
  voices (modern pronunciation).
- **Interlinear mode.** The original word, transliteration and an optional gloss under every English
  word.
- **Red letter.** The words of Jesus in red, in every translation (it can be turned off).
- **Section headings** and a chapter contents rail; verse-per-line or paragraph layout.
- **Listen mode.** Reads the chapter aloud verse by verse, highlighting and following the current
  verse, with play/pause, previous/next and 0.75–1.5× speed.

**Study**
- **Verse actions** (tap a verse number): cross references, highlight in five named colours, a note,
  bookmark, copy, share, listen from here, compare translations, and "Study this verse" (every word
  with its original as a plain list, the screen-reader-friendly word study).
- **Cross references.** About 340,000 from OpenBible.info, ranked by votes, in a side rail on wide
  screens and in the verse sheet.
- **Word study pages** (`#/word/G3056`): full lexicon entry, how each translation renders the word,
  where it occurs (by book and section), its inflected forms, the Septuagint bridge between Hebrew
  and Greek words (for example λόγος and דָּבָר), related words, and every occurrence.
- **People and places.** Names in the text show who or what they are in the word card (with family
  links), and have their own pages (`#/person/p0057`, Abraham) listing their names in Hebrew and
  Greek, family, and every mention.
- **Family trees** (`#/lineage/p0057`): ancestors and descendants as a zoomable tree or an outline,
  and a path finder between two people (for example Abraham to David).
- **Compare** two or three translations side by side (`#/compare/KJV,BSB/JHN/1`). Pointing at a word
  lights up the words in the other columns that render the same original word.
- **Search** across a whole translation: words, `"exact phrases"`, `faith OR hope`, `faith -works`,
  `bless*`, Strong's numbers (`G26`, `H430`), Greek or Hebrew words (`λόγος`), references
  (`Rom 8:28`, `jn 3:16`, `1 Cor 13`), names (`Abraham`), and filters (`light in:John`). Results are
  grouped by book and can be filtered to the Old or New Testament or to one book.
- **My study** (`#/study`): all your highlights, notes and bookmarks in Bible order, with export to a
  file and import. These are kept only in your browser.

**Phones, tablets and accessibility**
- Phones get a bottom toolbar within thumb reach, and a top bar that hides while you read.
- Tapping a word opens a bottom sheet that never covers the word you tapped. Pressing and then sliding
  your finger across the text moves word by word, the touch equivalent of hovering, with a loupe above
  your finger. Swipe left or right to change chapter.
- Optional haptic feedback, and optional soft sound effects (off by default).
- Full keyboard use, screen-reader support and WCAG 2.2 AA (see below).
- Light, dark or system theme, remembered per browser with no flash on load. Text size from 90% to
  200%; Literata, Atkinson Hyperlegible Next or OpenDyslexic; line and letter spacing; justify.
  Reduce motion and high contrast settings.
- An installable PWA. Every chapter you have read opens offline, and Settings → Offline downloads
  whole books.

## Translations

The KJV opens first and is the fallback whenever a linked or saved translation is unavailable.

| Translation | Year | Licence | How each English word is linked to the Greek / Hebrew |
|---|---|---|---|
| **KJV** King James Version (default) | 1769 | Public domain | **Strong's-tagged.** The CrossWire KJV carries Strong's numbers on its words; each is linked to the original word with that number in the same verse. Words found only in the Textus Receptus keep their lexicon entry. |
| **BSB** Berean Standard Bible | 2022 | Public domain | **Hand-aligned.** Clear-Bible/Biblica's manual alignment points every English word at the exact SBLGNT / WLC word(s). This is the most precise alignment. |
| **WEB** World English Bible | 2000 | Public domain | **Approximate.** Words are matched automatically to the BSB words of the same verse and inherit their links. |
| **ASV** American Standard Version | 1901 | Public domain | **Approximate**, through the BSB as above. |
| **YLT** Young's Literal Translation | 1898 | Public domain | **Approximate**, through the BSB as above. |
| **NIV** New International Version | 2011 | © Biblica, **never bundled** | **Approximate.** Fetched at runtime from API.Bible with *your own* key, then matched through the BSB in your browser. |

New Testament words link to the SBL Greek New Testament. Old Testament words link to the Westminster
Leningrad Codex, with the Septuagint-equivalent Greek word from Macula Hebrew.

### Reading the NIV with your API.Bible key

The NIV is copyrighted, so Rootword never includes it. To read it:

1. Get a free key from [API.Bible](https://scripture.api.bible) (sign up and create an app).
2. In your app at api.bible, add **New International Version** to the app's Bibles (otherwise the
   key cannot read it, and Settings says so).
3. In Rootword open **Settings → Translations**, paste the key and connect.
4. Choose the NIV in the translation picker.

The key is stored only in your browser (localStorage) and is sent only to API.Bible. Its word links
are approximate, and it is marked as such. Nothing about the key is ever built into the site, its
tests or its data.

Privacy: Rootword has no accounts and no analytics of its own. When you read an API.Bible
translation, API.Bible's required Fair Use Management System reports each chapter shown to
fums.api.bible with a random device ID (kept in your browser) and a session ID; no key or personal
data is sent.

## Data sources and licences

| Source | Used for | Licence |
|---|---|---|
| [Berean Standard Bible](https://berean.bible) | BSB text, headings, paragraphs | Public domain |
| [Clear-Bible Alignments](https://github.com/Clear-Bible/Alignments) (Clear Bible / Biblica) | BSB ↔ Greek/Hebrew word alignment, SBLGNT and WLC token lists | **CC BY 4.0** |
| [SBL Greek New Testament](https://sblgnt.com) (Society of Biblical Literature, Logos Bible Software) | Greek New Testament | **CC BY 4.0** |
| [Westminster Leningrad Codex](https://tanach.us) | Hebrew and Aramaic Old Testament | Public domain |
| [Macula Hebrew](https://github.com/Clear-Bible/macula-hebrew) (Clear Bible) | Hebrew lemmas, morphology, transliteration, glosses, Septuagint equivalents | **CC BY 4.0** |
| [STEPBible TBESG / TBESH](https://github.com/STEPBible/STEPBible-Data) (Tyndale House, Cambridge) | Greek and Hebrew lexicons | **CC BY 4.0** |
| [STEPBible TIPNR](https://github.com/STEPBible/STEPBible-Data) (Tyndale House, Cambridge) | People, places and family links | **CC BY 4.0** |
| [OpenBible.info cross references](https://www.openbible.info/labs/cross-references/) | Cross references and their votes | **CC BY** |
| [Strong's dictionaries](https://github.com/openscriptures/strongs) (OpenScriptures) | Strong's Greek and Hebrew definitions | Public domain |
| [KJV with Strong's numbers](https://crosswire.org) (CrossWire) | KJV text and its Strong's tags | Public domain |
| KJV red-letter markup (eBible.org, via [open-bibles](https://github.com/seven1m/open-bibles)) | Words of Jesus | Public domain |
| [open-bibles](https://github.com/seven1m/open-bibles) | WEB and ASV texts | Public domain |
| Young's Literal Translation 1898, via [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases) | YLT text | Public domain |

Material under CC BY 4.0 is used under [that licence](https://creativecommons.org/licenses/by/4.0/)
with attribution. Changes: the data were converted to Rootword's compact JSON format, and cantillation
marks were removed from the Hebrew; the STEPBible Greek definitions (Abbott-Smith) were edited and abridged (bibliographies
and apparatus brackets removed, sub-senses folded together), and short entries for Hebrew prefixes and
suffixes were written for Rootword (and labelled "Rootword" in the app); cross references with no
or negative votes (and self-references) were dropped, the rest capped at 40 per verse, and the ESV's
3 John 1:15 mapped to 1:14; the TIPNR summaries and articles were merged; morphology is shown in plain
English. The About page (`#/about`) shows the same credits in the app. The
fonts (Literata, Inter, Gentium Book Plus, Frank Ruhl Libre, EB Garamond, Atkinson Hyperlegible Next,
OpenDyslexic) are under the SIL Open Font Licence, via Fontsource.

## Run it locally

Requires Node.js 22.

```sh
npm install
npm run data      # downloads about 300 MB of open data into .cache/sources/ and builds public/data/ (a few minutes)
npm run dev       # http://localhost:5173
```

`npm run data` runs `data:fetch` then `data:build`. Behind an HTTP proxy, Node's fetch needs
`NODE_USE_ENV_PROXY=1`. Downloads are cached, so later runs only rebuild. One stage at a time:
`npm run data:build -- kjv search` (stages: `orig bsb kjv bridged concordance lexicon search meta validate`).
The generated `public/data/` (about 200 MB) is not committed.

`npm run build` type-checks and builds the static site into `dist/`, and `npm run preview` serves it.
The build uses relative paths and hash routing (`#/KJV/JHN/3/16`), so `dist/` works from any static
host or sub-path.

## Tests

```sh
npm test                                  # unit tests (Vitest + jsdom, tests/)
npm run e2e                               # Playwright: builds the site, serves it with vite preview, runs e2e/
npx playwright test --project=features    # end-to-end feature tests only
npx playwright test --project=qa          # the QA matrix only
SHOTS=1 npx playwright test --project=shots   # recapture design/screenshots/final-*.png
```

- **Unit tests** cover the data pipeline, alignment, morphology, references, search engine, study
  storage, feedback, speech and the UI models and components.
- **End-to-end feature tests** (`e2e/features/`) cover the default route; word cards with mouse,
  keyboard and touch (tap → sheet, press-and-slide scrubbing, swipe); the verse sheet (cross
  references, highlight, note, bookmark → My study); compare; word study; people and lineage; search;
  settings (theme with no flash, fonts, high contrast, 200% text); red letter; interlinear; listen
  mode (with a stand-in speech engine); About credits; and the PWA (service worker, a chapter you have read opening while really offline). Every
  test fails on any console error.
- **The QA matrix** (`e2e/qa/`) runs the docs/EXPERIENCE.md §7 matrix: 14 viewports from 280 px
  (Galaxy Fold) to 2560 px, each in light and dark, with touch emulation on phones and tablets. It
  checks for horizontal overflow, overlapping fixed layers, the sheet covering the tapped word,
  scrubbing, target sizes and axe-core (WCAG 2.2 AA) on every screen. It also covers reduced motion,
  forced colours, high contrast, 200% text at 320 px and keyboard reachability.

Playwright uses its bundled Chromium, or `/opt/pw-browsers/chromium-*` / `PW_CHROME` if that is
missing. To test a server you already run: `E2E_BASE_URL=http://127.0.0.1:5173/ npx playwright test`.

## Deploy (GitHub Pages)

The included workflow `.github/workflows/deploy.yml` builds the data and the site on pushes to `main`
(and `claude/**` branches) and on pull requests, caching the raw sources between runs. It runs the unit
tests and deploys **only pushes to `main`** to GitHub Pages. One-time setup: in the repository go to **Settings → Pages → Build and
deployment → Source** and choose **GitHub Actions**. No secrets are needed.

## Accessibility and mobile

The binding spec is [docs/EXPERIENCE.md](docs/EXPERIENCE.md). In short:
- **WCAG 2.2 AA** in light and dark. There are landmarks, a skip link and logical headings. Greek and
  Hebrew are marked `lang="grc"` / `lang="he"` (with `dir="rtl"`). Card content is announced politely.
  Pinned cards and sheets are labelled dialogs, and focus returns to where it was when they close.
- **Keyboard:** Tab into the text, ←/→ word by word, ↑/↓ verse by verse, Enter opens the card or the
  verse actions, Esc closes them. `/` searches, and ←/→ outside the text change chapter.
- **Touch:** targets of at least 44 px, no double-tap delay, and pinch-zoom is never disabled. Sheets
  have peek, full and closed detents and close with the Android back gesture. The layout respects
  safe areas and the on-screen keyboard.
- **Preferences:** follows `prefers-reduced-motion`, `prefers-contrast` and `forced-colors`. There are
  in-app Reduce motion and High contrast switches. Meaning is never carried by colour alone: each
  highlight colour has its own underline style and a name.

## Project layout

```
scripts/        data pipeline (fetch-sources.mjs, build-data.ts, data/<stage>.ts)
src/lib/        framework-free logic (types.ts is the data contract; search engine, alignment, morphology…)
src/app/        app state (signals), router, personal study storage
src/components/ Preact UI (reader, word card, verse sheet, search, settings, compare, names, …)
src/pages/      code-split pages (word study, person/place, lineage, compare, my study)
tests/          Vitest unit tests
e2e/            Playwright feature tests, QA matrix and screenshot capture
docs/           ARCHITECTURE.md, EXPERIENCE.md, ROADMAP.md
```

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (data flow and contracts) and
[src/app/README.md](src/app/README.md) (state, routes and extension points).

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Next up (v1.1) are "then and now" place maps: the ancient
site and the modern place for every place name.
