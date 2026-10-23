# Concept "Scholar": a modern scholarly edition

## The concept in five sentences
1. Rootword reads like a well-made critical edition on a Swiss grid: one calm 680px text column in Literata, with a quiet left rail (chapter contents) and right rail (reading key, edition credits). There is a lot of white space and hairline rules, and nothing decorative.
2. The palette is ink-blue and graphite with one warm accent, cinnabar. The accent is used the way a rubricator uses red: for verse numbers, the chapter numeral, Strong's numbers and the word that is active now. It is used nowhere else.
3. The Greek and Hebrew are set as carefully as the English. Gentium Book Plus sets polytonic Greek and Frank Ruhl Libre sets pointed Hebrew (cantillation marks are stripped for legibility). Original-language text is always ink-blue, so the eye learns "blue = the original".
4. Hovering, tapping or pressing Enter on any English word opens a lexicon entry directly below it. It shows the word as written, its transliteration, Strong's number, lemma, plain-English parsing, gloss, how the BSB renders it, a short definition and where else it occurs. For the Old Testament the Hebrew and its Septuagint Greek sit side by side.
5. Interlinear mode turns the same text into a flowing reverse interlinear: English on top, the original beneath it, then optional transliteration, gloss, parsing and Strong's lines. A thin bracket shows when several English words render one original word.

## Files
| file | what |
|---|---|
| `index.html` | shell: masthead, rails, skip link, SVG icon sprite |
| `scholar.css` | all tokens and components (light + dark, responsive, reduced motion) |
| `fonts.css` | `@font-face` for the installed fontsource files (Literata Variable with an opsz axis, Gentium Book Plus, Frank Ruhl Libre) |
| `scholar.js` | rendering and interactions (vanilla ES module). Loads `../../sample.json` and `data.js` |
| `data.js` | snapshot of real `public/data/` made by `extract-data.py`: John 1:6–18, Gen 1:4–5, Ps 23:3–6 and the superscription (beyond sample.json), headings and paragraphs, lexicon digests, concordance distributions, BSB renderings and a canned "love" search |
| `extract-data.py` | regenerates `data.js` (`python3 design/concepts/scholar/extract-data.py` from the repo root) |
| `shoot.mjs` | Playwright screenshots of every demo state into `shots/`. Fails if a page logs an error or a 4xx |

### Demo URL params
`?theme=dark|light` · `?demo=hover` (card on "Word", John 1:1) · `?demo=hover-ot` (card on "God", Gen 1:1, Hebrew + LXX) ·
`?demo=interlinear` · `?demo=search` (results for "love") · `?demo=phrase` ("the beginning" → ἀρχῇ) · `?demo=focus`
(keyboard-opened card) · `?demo=books` · `?demo=translations` · `?demo=niv` (NIV connect panel) · `?passage=ot` ·
`?word=<orig id>` opens the card on any word (e.g. `?word=o010010010012` = בְּרֵאשִׁית, `?word=o190230010041` = רֹעִי).
Demos combine with commas: `?theme=dark&demo=interlinear,hover`.

## Colour tokens
Every text/background pair below was checked against WCAG AA. The lowest ratio is `--ink-3` on `--wash`, at 4.73:1 (light).

| token | light | dark | used for |
|---|---|---|---|
| `--paper` | `#fafaf7` | `#0f1217` | page background |
| `--surface` | `#ffffff` | `#161a21` | card, popovers |
| `--sunken` | `#f2f2ee` | `#0b0d11` | search field, segmented controls, card footer, facets |
| `--ink` | `#171c26` | `#e8e5de` | body text (16.3:1 / 14.9:1) |
| `--ink-2` | `#434b5a` | `#bac0ca` | secondary text, definitions |
| `--ink-3` | `#5f6877` | `#959dab` | labels, meta, transliteration (≥ 4.7:1 everywhere it's used) |
| `--rule` | `#e4e4df` | `#252b34` | hairlines |
| `--rule-2` | `#cdcec8` | `#353d49` | stronger rules, interlinear phrase bracket, checkboxes |
| `--blue` | `#1d3b72` | `#a9c2ef` | **ink-blue**: Greek/Hebrew text, active word text, primary buttons |
| `--blue-ui` | `#284f95` | `#c4d5f6` | hover on primary buttons |
| `--wash` | `#e5ecf7` | `#1b2945` | word highlight background |
| `--wash-2` | `#d3def1` | `#253a61` | selection, kin outline in interlinear |
| `--accent` | `#b0401b` | `#f0916b` | **cinnabar**: verse numbers, chapter numeral, Strong's, active-word underline, search hits |
| `--accent-wash` | `#f8e8df` | `#3a2219` | search-hit background |
| `--focus` | `#2b5fcf` | `#8fb0f2` | focus rings |

Dark mode is applied by `:root[data-theme="dark"]`, and by `prefers-color-scheme: dark` unless `data-theme="light"` is set.

## Type
Families:
- `--font-text`: Literata Variable (optical sizing on).
- `--font-ui`: Inter, falling back to the system UI font. Inter is installed on this machine but is not an npm dependency yet; the real app should bundle `@fontsource-variable/inter` or accept the fallback.
- `--font-greek`: Gentium Book Plus.
- `--font-hebrew`: Frank Ruhl Libre (weights 400, 500, 700).
- `--font-code`: JetBrains Mono, falling back to ui-monospace. Used only for raw morphology codes.

| role | spec |
|---|---|
| Chapter title | Literata 400, 60px (46 at tablet, 42 on phones), opsz 72, −0.025em; chapter numeral weight 250 in `--accent` |
| Reading text | Literata 20px / 1.72 (18.5 / 1.68 on phones), measure 34em (≈ 66 characters) |
| Verse number | Inter 650, 0.56em, tabular, `--accent`, raised 0.62em; never separated from its first word |
| Section heading | Inter 600, 13.5px, hairline above, verse range right-aligned in tabular `--ink-3` |
| Eyebrow / label | Inter 600, 11px, uppercase, +0.12em tracking |
| UI | Inter 13.5px (buttons 500, active 600); meta 12.5px |
| Card headword | Gentium 38px / Frank Ruhl 500 40px; LXX Gentium 30px in `--blue` |
| Card facts | Inter 13px; labels 10px uppercase +0.12em; gloss Literata 600 14px |
| Card definition | Literata 14px / 1.55, clamped to 3 lines, with source line in Inter 11px |
| Interlinear | English Literata 18px · original Gentium 19px / Frank Ruhl 22px in `--blue` · transliteration Literata italic 12.5px · gloss Inter 11.5px · parsing mono 10.5px |
| Divine name | "LORD" / "GOD" (YHWH) set as L + `all-small-caps`, as in printed Bibles |

## Spacing, radius, elevation
- 4px base: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 24 · `--s-6` 32 · `--s-7` 48 · `--s-8` 64 · `--s-9` 96.
- Page grid: rails `170–210px` | text `≤ 680px` | rails `190–230px`. Column gap is `clamp(32px, 5vw, 72px)`. Header height is 60px (56 on phones).
- Section spacing: 48px above a section heading (32 on phones), 16px below. Paragraphs are indented 1.4em with no extra space between them.
- Radius: 6px for controls, 10px for the card and popovers, 16px at the top of the bottom sheet.
- Elevation: the card and popovers use `--shadow` (three soft layers). Segmented selections use `--shadow-sm`. Nothing else casts a shadow.

## Breakpoints
- **≤ 1240px**: the left rail is hidden.
- **≤ 980px**: the right rail is hidden, and the Reading/Interlinear switch moves under the chapter title.
- **≤ 760px**: the search field collapses to an icon (when opened it becomes a full-width field over the header), and the wordmark collapses to the mark.
- **≤ 640px**: the word card becomes a bottom sheet, and search becomes a full-screen panel with original-word facets as a horizontal chip scroller.

## Key interaction details
- **Groups.** Consecutive English words linked to exactly the same original word(s) form one target, e.g. "the beginning" → ἀρχῇ or "In the beginning" → בְּרֵאשִׁית. They highlight as one continuous wash (`box-decoration-break: clone` so it survives line wraps), and the card's top line quotes the whole phrase.
- **Highlighting.**
  - Resting text is plain, so you can simply read it.
  - Hover gives `--wash` plus ink-blue text.
  - The active word adds a 2px cinnabar underline.
  - Every other English word linked to the *same original word* gets the same active treatment.
  - Other words from the *same lexeme* in view (same Strong's) get a dotted ink-blue underline (in interlinear mode, a hairline box). In John 1:1, hovering "Word" also marks the other λόγος.
- **Supplied words** (no original behind them: KJV italics or BSB's rare unlinked words) are set in italic `--ink-3`. They have no hover and are not focusable. The BSB passages shown here contain none, so the style appears only in the reading key.
- **Card placement.**
  - The card opens 10px below the line under the hovered rect (the rect under the pointer for wrapped phrases). The notch points at the word, clamped to 18px from the card's edges, and the card is clamped 16px inside the viewport.
  - If the card won't fit below and does fit above (under the header), it flips above and the notch moves to the bottom. It never covers the line being read.
  - Size: 432px wide, about 400px tall.
- **Timing.** The card opens 80ms after hover (0ms when moving between words while a card is open). It closes 240ms after the pointer leaves both the word and the card, so the pointer can travel into it. Click pins it (a close button appears). Clicking outside or pressing Esc closes it.
- **Keyboard.**
  - Each word group is `tabindex=0`, `role=button`, `aria-haspopup=dialog`; ← / → step between words.
  - Enter or Space opens the card and moves focus into it (`role=dialog`, labelled by the headword). Esc closes it and returns focus to the word.
  - While open, the word has `aria-describedby` pointing to a screen-reader summary, and the same summary goes to a polite live region.
  - `/` focuses search.
- **Phones.** A tap opens a bottom sheet (max 74vh, drag handle, close button). The page scrolls so the tapped word stays visible above the sheet.
- **Interlinear.** Each group is a column unit: English, then original (ink-blue), then optional lines. Punctuation sticks to the neighbouring English. Multi-word groups get a thin bracket that spans the English phrase. Hebrew is set right-to-left inside its unit but aligned to the unit's start. The Show bar toggles Greek/Hebrew, transliteration, gloss, parsing and Strong's.
- **Card anatomy** (top to bottom):
  1. "“English phrase” · ref · LANGUAGE · EDITION"
  2. Headword with transliteration and Strong's, or, for the OT, a Hebrew | Septuagint split with each side's Strong's.
  3. A morpheme strip for Hebrew words with prefixes or suffixes (בְּ in · prep. + רֵאשִׁית beginning · noun).
  4. Facts: Lemma, Parsing (plain English plus the raw code), Gloss (contextual, plus the dictionary gloss), Rendered (top BSB renderings with counts).
  5. A 3-line definition with its source.
  6. Footer: total verses, count in this book, and a sparkline across the testament with this book in cinnabar; "See all occurrences".
- **Search.**
  - The panel opens under the field. It shows the verse count, the forms matched, and a 66-book distribution chart (OT graphite, NT ink-blue, the top peaks labelled).
  - A "Behind the English" facet column lists the Greek/Hebrew words the English term translates, with counts. For "love": חֶסֶד, אָהֵב, ἀγαπάω, ἀγάπη, אַהֲבָה, φιλέω…
  - Results come sorted by relevance with OT/NT tabs. Each hit shows its reference, the original lemma(s) behind the hits, and the verse with the hits marked in cinnabar.
- **Translation picker.** The KJV is listed first, as the owner requires. Each entry shows the strength of its Greek/Hebrew link with a three-dot meter (hand-aligned ●●●, Strong's-tagged ●●○, approximate ●○○). NIV is a separate "Connect" row that expands an API.Bible key panel ("never bundled; stored only in this browser").
- **Motion.** Cards rise 3px and fade in over 140ms; the sheet slides up over 220ms. All motion is removed under `prefers-reduced-motion`.

## Notes for the real implementation
- Parsing is generated from the morphology codes: Robinson codes for Greek, OSHB-style codes for Hebrew. The mini parsers in `scholar.js` (`parseGreek`, `parseHebrew`) show the wording; the real app should use `src/lib/morph.ts`.
- Greek transliteration of surface forms is generated (SBL style). Hebrew transliteration comes from Macula, falling back to the lexicon when Macula has none.
- Strong's numbers are shown without zero padding (G746, H430) but stored padded.
