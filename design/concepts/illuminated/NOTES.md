# Concept: Illuminated

## The concept in five sentences
1. The screen is a codex leaf: a warm vellum page laid on a slightly darker desk by day, and the same page by candlelight at night, with a faint warm glow falling from above.
2. Colour follows the old scribal division of labour: iron-gall ink for the text, vermilion (rubrication) for verse numbers, headings and chapter marks, lapis blue for the original languages, and gold leaf only for ornament.
3. Each chapter opens with one illuminated initial (a gold letter on a lapis ground framed in gold leaf), and the same initial is the app's mark. That is the page's single moment of display; everything else stays quiet.
4. Hovering, tapping or focusing an English word lays a thin wash of gold behind it and every word tied to the same original, then sets a card under the word that reads like a marginal gloss: the Greek or Hebrew word large, then its form, lexical entry, Septuagint equivalent and a short definition.
5. Typography comes first. EB Garamond at 22px with a 1.7 line height sets the reading text on a 640px (about 68-character) measure, Gentium Book Plus carries the polytonic Greek and transliteration, and Frank Ruhl Libre carries the pointed Hebrew.

## Colour tokens
Every text token is WCAG AA (at least 4.5:1) on `--page` and `--card` in both themes. I computed the ratios with the WCAG formula; they are listed below. `--gilt` is for ornament only and is never used for text.

| token | role | vellum (light) | candlelight (dark) |
|---|---|---|---|
| `--bg` | desk behind the page, chrome | `#ece2cc` | `#15110d` |
| `--page` | the leaf (reading surface) | `#f7f0e1` | `#1d1711` |
| `--card` | word card, popovers, inputs | `#fffaf0` | `#28201a` |
| `--ink` | body text | `#2a2017` (14.1:1) | `#efe3ca` (14.0:1) |
| `--ink-2` | secondary text | `#5b4935` (7.6:1) | `#cbb898` (9.2:1) |
| `--ink-3` | tertiary / labels / supplied words | `#6f5c45` (5.6:1) | `#ad9a7c` (6.5:1) |
| `--rubric` | verse numbers, rubrics, links, "on" state | `#a2311c` (6.2:1) | `#ef8466` (6.9:1) |
| `--gilt` | gold leaf: rules, fleurons, dotted "kin" underline | `#b8903f` | `#c9a45a` |
| `--gilt-2` | highlight in gold gradients | `#dcbd6e` | `#e7c97f` |
| `--gilt-ink` | gold that must be read (eyebrows, POS, Strong's) | `#7f5d1c` (5.3:1) | `#dcbc72` (9.7:1) |
| `--lapis` | original-language text in interlinear and search, focus ring | `#2f4987` (7.6:1) | `#a3b8ee` (9.0:1) |
| `--lapis-ground` / `-2` | ground of illuminated initials | `#213a74` / `#34559d` | `#1a2c58` / `#2a4482` |
| `--gold-leaf` | initial frame (gradient) | `135deg #f1dc9c → #c99a3f → #f4e2a8 → #a8802f` | same |
| `--rule` / `--rule-strong` | hairlines / control borders | `#e0d2b2` / `#cbb68a` | `#372c20` / `#57462f` |
| `--hl` | gold wash behind linked words | `rgba(214,166,58,.27)` | `rgba(222,176,82,.22)` |
| `--hl-soft` | hover preview, row hover | `rgba(214,166,58,.15)` | `rgba(222,176,82,.12)` |
| `--focus` | focus ring (2px, offset 2px) | `#2f4987` | `#e8c56c` |

Texture: the page carries an SVG `feTurbulence` grain plus two soft radial mottles. It is blended with `multiply` (light) or `soft-light` (dark) at low opacity, and it never sits behind the card.

## Type
| use | family | size / line height | notes |
|---|---|---|---|
| reading text | EB Garamond 400 | 22px / 1.7 (phone 19px / 1.66) | ragged right, `text-wrap: pretty`, last two words of a paragraph bound together |
| verse number | EB Garamond 600 | 0.56em, raised 0.6em, line-height 0 | `--rubric`, lining figures; verse 1 is replaced by the initial |
| illuminated initial | EB Garamond 600 | 3 lines (3.85em × 3.95em box); poetry uses a raised 1.95em box | gold gradient letter on lapis, white penwork hairline |
| book title | EB Garamond 500 | 60px / 1.02 (phone 44px) | eyebrow in all small caps with 0.22em tracking, in `--gilt-ink` |
| native title | Gentium italic 20px / Frank Ruhl 24px | | `Κατὰ Ἰωάννην`, `בְּרֵאשִׁית` |
| rubric (section heading) | EB Garamond 500 italic | 21px | `--rubric`, ¶ mark, parallel refs at 15px italic `--ink-3` |
| minor heading | EB Garamond 600, all small caps | 17px, 0.16em tracking | e.g. "The First Day" |
| LORD | small caps | | rendered "Lord" with `font-variant-caps: small-caps` |
| card headword | Gentium 44px / Frank Ruhl 500 48px | 1.12 | prefixes and suffixes shown in `--ink-3` |
| transliteration | Gentium italic | 17.6px | scholarly forms (ʾĕlōhîm, archē) |
| labels | EB Garamond 500, all small caps | 13–17px, 0.12–0.18em tracking | `--ink-3` or `--gilt-ink` |
| UI controls | EB Garamond | 16–19px | translation tabs in small caps |

## Spacing and shape
- 4px base scale: 4, 8, 12, 16, 24, 32, 48, 64, 96 (`--s1` … `--s9`).
- Folio on desktop is 1120px wide. Padding is 48 top, 104 inner and 272 outer: the outer margin is wider, as on a codex leaf, and holds the marginalia. Text column is 640px.
- Radii: 6px controls, 3px page, 999px pills. Shadows are warm (`rgba(70,46,14,…)`): one tight and one long, soft one.
- Chrome: a 68px masthead and a sticky 52px toolbar, closed by a ruled double line (gold hairline over ink hairline).
- Breakpoints: below 1240px the margins narrow. Below 1100px the marginalia move into the page above the colophon, in two columns. At 640px and below the phone layout applies.

## Key interaction details
**Linking model.** Consecutive English tokens with the *same* set of original words become one interactive unit, so "the beginning" → ἀρχῇ and "He makes me lie down" → יַרְבִּיצֵנִי highlight, open and stack as one phrase. Tokens that share *some* originals are highlighted with the anchor. Punctuation stays outside units.

**Highlight states.**
- Hover preview: `--hl-soft` wash.
- Linked (same original word): `--hl` wash, cloned across line breaks.
- Anchor (the word you're on): the wash plus a 1.5px vermilion underline.
- Kin (same Strong's elsewhere on the page, e.g. the other two λόγος): a 2px dotted gold underline.
- Supplied words (no original): `--ink-3`, not interactive. This is explained in the Reading key.

**Word card ("gloss").**
- Size and placement: 400px wide, placed 12px below the word with a caret at the word's centre and clamped to the viewport. It never covers the line being read.
- Flipping: if it does not fit below but fits above the sticky toolbar, it flips above (caret at the bottom). If neither fits, a hovered card takes the roomier side, and a pinned card goes below and scrolls just enough to show it, without pushing the word under the toolbar.
- Contents, top to bottom: reference and English phrase; headword (multi-morpheme Hebrew words shown whole, with prefixes dimmed); transliteration and part of speech; morpheme or word tabs when one English phrase maps to several originals (בְּ + רֵאשִׁית, οὐδὲ + ἕν), with the content word chosen by default; Meaning, Form (plain-language parsing from Robinson / OSHB codes), Lexicon (lemma, translit, Strong's pill), Septuagint (OT); a three-line definition with a rubricated first letter; "See all N verses" (real concordance count) and "N× on this page".
- Timing: opens after 140ms of hover (60ms when moving between words with a card already open), and closes 280ms after the pointer leaves both word and card. A click or tap pins it, and clicking the anchor again closes it.
- Phones (640px and below): the card becomes a bottom sheet (18px top radius, grab handle, at most 68vh, scrolls internally). The page scrolls if needed so the word stays visible above the sheet.

**Keyboard and assistive tech.**
- The passage is one Tab stop: a roving tabindex across units. ←/→ (and ↑/↓) move word to word, Home and End jump to the ends, Enter or Space opens and closes, and Esc closes and returns focus to the word.
- While a card is open, the arrow keys carry it along word by word, so you can read through a verse with the gloss beside you.
- The card is a non-modal `role="dialog"` placed right after the text in DOM order, so Tab moves into it.
- Each word is `role="button"` with `aria-haspopup="dialog"` and `aria-expanded`, and gets `aria-describedby="gloss"` while open. A polite live region announces "Word: Greek λόγος, logos. Noun, nominative masculine singular. Means word. Strong's G3056."
- Focus ring: 2px `--focus`.
- `prefers-reduced-motion` removes the card and sheet entrance animations and all transitions. `forced-colors` maps highlights to `Highlight`.

**Interlinear.**
- Each unit becomes a centred stack: the English, then a gold hairline, then the original in lapis (Greek 0.86em, Hebrew 1.02em, RTL), then an optional italic gloss at 0.64em.
- Punctuation folds into the neighbouring stack. The Glosses switch hides the third row.
- Hover and the card work the same as in reading mode. The anchor is marked by a vermilion bottom rule instead of an underline.

**Search glimpse (`?demo=search`).** Built from real BSB data snapshotted from `public/data`:
- the verse count with word forms, scope chips (OT/NT counts) and an exact-word toggle (331);
- a 66-book distribution ribbon (OT bars gold, NT vermilion, the top book in each testament labelled, hover tooltips, `role="img"` summary);
- "Behind the English": the Hebrew and Greek words the BSB translates as *love* (חֶסֶד 188, אָהֵב 184, ἀγαπάω 131 …) as one-tap original-language searches;
- the best matches, with the original word set under each hit. John 21:15 shows ἀγαπᾷς and φιλῶ side by side.

**Translations.**
- Desktop: small-caps tabs as a radiogroup (BSB, KJV, WEB, ASV, YLT) plus a dashed "NIV · connect" entry that opens an API.Bible key popover. Phone: the tabs collapse into a "BSB ▾" sheet listing each translation's alignment quality.
- The mockup only carries BSB text. Picking another translation shows a notice and keeps the BSB.

## Files and demo states
- `index.html`, `illuminated.css`, `illuminated.js`: the mockup. It loads `../../sample.json` and fonts from `../../../node_modules/@fontsource/*`, and makes no network requests.
- `data.js`: the snapshot produced by `snapshot.py` from `public/data`. It holds lexicon entries, concordance verse counts and the "love" search for the sample words.
- `shoot.mjs`: renders every state into `shots/` and runs the interaction checks. Serve the repo root first, then run `BASE=http://localhost:8765 node design/concepts/illuminated/shoot.mjs`.
- URL parameters: `?theme=dark|light`, `?demo=hover|hover-ot|interlinear|search|books|niv` (comma-separate to combine, e.g. `?demo=interlinear,hover-ot`), `?passage=ot`.

## Carrying it into the real app
- Tokens map one-to-one onto `src/styles/` custom properties. Keep `--gilt` out of text, and keep `--hl` translucent so it works on any surface.
- The definitions for λόγος, ἀρχή, θεός, אֱלֹהִים, רֵאשִׁית and בָּרָא are hand-written placeholders. Other words show the Strong's definition, which is sometimes awkward (e.g. ἄνθρωπος), so a curated short definition per lemma would lift the card.
- The sample has no truly unlinked words. The "supplied" style is defined, shown in the Reading key and rendered by the code path, but no passage in the sample shows it.
