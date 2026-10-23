# Rootword design system

Status: adopted. Winner: **Illuminated**, with grafts from Scholar and Lumen.
Implementation files: `src/styles/tokens.css` (custom properties, both themes) and
`src/styles/base.css` (fonts, reset, focus, motion, shared primitives). Import once from
`src/main.tsx`:

```ts
import './styles/base.css'; // pulls in tokens.css and every @fontsource face
```

Every CSS snippet in this document was rendered against the real `base.css` (Vite build +
Chromium) to produce `design/screenshots/system-*.png`. Contrast ratios below are computed from
`tokens.css` itself.

---

## 1. Verdict

Three concepts were captured with Playwright in identical states (desktop 1440x900 default /
`?demo=hover` / `hover-ot` / `interlinear` / `search`, each light and dark; phone 390x844 default
and hover). None of the 36 captures logged a console error or failed request. Screenshots:
`design/screenshots/<concept>-<state>.png`.

### Scores (1-10; weights favour readability, card clarity and beauty)

| criterion | weight | Illuminated | Scholar | Lumen |
|---|---:|---:|---:|---:|
| Beauty and originality | 1.5 | **9** | 6 | 8 |
| Long-form readability | 2 | 8 | **9** | 8 |
| Word card clarity and usefulness | 2 | 8 | **9** | 8 |
| Interlinear elegance | 1 | **9** | 7 | 8 |
| Mobile | 1 | 7 | 7 | **8** |
| Dark theme | 1 | **9** | 7 | **9** |
| Accessibility (incl. measured contrast) | 1 | **8** | 7 | 7 |
| Feasibility in Preact | 1 | 7 | **9** | 7 |
| **Weighted mean** | | **8.14** | 7.81 | 7.90 |

**Winner: Illuminated.** The owner asked for styling that is creative *and makes sense*.
Illuminated is the only concept whose decoration carries meaning in every component: the scribe's
division of labour (ink = text, vermilion = structure and "you are here", lapis = the original
languages, gold = ornament) explains the whole interface. Its reading page looks like a book
rather than an app; its word card reads like a marginal gloss; its candlelight dark theme is
designed rather than inverted. Its two weaknesses relative to Scholar (a less information-rich card
and Garamond's small x-height on low-DPI screens) are closed by grafts below: Scholar's card
information architecture and Literata as an optional reading face.

### Critique (concrete flaws seen in the captures and CSS)

**Illuminated** (`illuminated-*.png`)
- Wordmark says "Logos", which CLAUDE.md forbids. Fixed here: `R` initial + "ootword".
- Translation tabs list BSB first; the KJV must be first and default.
- No `prefers-color-scheme` support: dark only via `?theme=dark` / JS. Fixed in `tokens.css`.
- Card: no language label (Greek / Hebrew) and the Strong's number is buried in the Lexicon row;
  the Septuagint is one easy-to-miss row; the headword and the Lexicon row repeat λόγος.
- All-small-caps labels at 13px (about 6px glyph height) are too small; raised to a 15px minimum.
- Gilt dotted "kin" underline is 2.61:1 on vellum (fails 1.4.11 as a sole indicator). New `--kin`
  token is 3.67:1.
- Control borders (`--rule-strong`, 1.75:1 on page) do not identify inputs (1.4.11). New `--edge`
  token at >= 3.6:1 for inputs, switches and checkboxes.
- Phone: two header rows eat about 110px; the translation picker hides behind "BSB ▾"; no
  thumb-reach chapter navigation; marginalia are dumped below the text.
- Demo passage switcher sits in the toolbar (mock-up chrome, drop it).
- Grain texture, gold-gradient initial and folio margins are more CSS than the rivals, but all
  static, so the cost is low.

**Scholar** (`scholar-*.png`)
- Competent but generic: Inter UI, segmented controls and a navy primary button read as a SaaS
  documentation site; nothing says "Bible" except the text.
- Card is the most complete (lemma, parsing + raw code, gloss, renderings with counts, definition
  with source, sparkline) but about 400px tall; it covers three or four lines of text below the
  word, and the raw `N-NSM` / `Ncmpa` codes are noise for lay readers.
- Checkbox borders `--rule-2` are 1.51:1 (light) / 1.71:1 (dark): fail 1.4.11.
- 10-11px uppercase sans labels in the card and Show bar.
- Inter and JetBrains Mono are not npm dependencies (system fallback only).
- Phone: no previous/next chapter control; the sheet's top edge clips the line after the word.
- Strengths worth taking: the OT | NT | chapters book picker, the translation list with
  alignment-strength meter, section headings with verse ranges, the two-column search panel
  ("Behind the English" facets + results), and Literata's screen readability.

**Lumen** (`lumen-*.png`)
- The lancet window per chapter is genuinely original, but it is the only themed element; the rest
  is a generic Inter-pill UI with translucent glass and gradient borders.
- Card definition is clamped with a mid-word ellipsis ("God's..."), which looks broken.
- Hebrew card puts transliteration at the left and the headword at the right edge: correct RTL
  instinct, but the eye has to cross the card.
- Gold-fill ticks on active chips are 2.00:1 on limestone (1.4.11).
- Phone dock overlaps the colophon credits (no bottom padding reserved).
- Backdrop blur behind popovers costs on low-end phones and reduces legibility of what is behind.
- Strengths worth taking: the Septuagint as a tinted band inside the Hebrew card, the phone dock,
  interlinear "Beneath each word" chips, dimmed repeats, skipping kin marks for very common words,
  the supplied-word explanation card, and the "two different words behind one English word" flag.

### Grafts adopted

| from | graft | where in this spec |
|---|---|---|
| Scholar | Strong's pill and language tag in the card header; definition source line; "KJV" usage row (`LexEntry.kjv`) | §6.6 |
| Scholar | Book picker as OT and NT grids with a chapter grid, plus a "Go to" reference field | §6.2 |
| Scholar | Translation list with alignment meter (●●● hand-aligned, ●●○ Strong's-tagged, ●○○ approximate) and NIV "Connect" row expanding inline | §6.3 |
| Scholar | Section heading with verse range; "In this chapter" contents in the margin | §6.4 |
| Scholar | Two-column search panel at >= 1100px, lemma tag on each hit, query hints | §6.9 |
| Scholar | Literata as an optional reading face (Settings) | §5.2, §6.10 |
| Lumen | Septuagint band in the Hebrew card | §6.6 |
| Lumen | Floating bottom dock on phones (with reserved padding) | §6.1 |
| Lumen | Interlinear "Beneath each word" chips; repeated originals dimmed | §6.8 |
| Lumen | No kin underline for very common lemmas | §6.5 |
| Lumen | Supplied-word note card; supplied words italic | §6.5, §6.6 |
| Lumen | "Two different words behind one English word" flag in search | §6.9 |
| Lumen | Content-morpheme selection rule; gloss joining; NFC normalisation | §6.6, §8 |

Not adopted: Lumen's glass blur and lancet window (identity clash with the codex), Scholar's sans UI
and raw codes by default (codes are a Settings option).

---

## 2. Principles

1. **The page is a codex leaf.** Vellum page on a darker desk by day; the same page by candlelight
   at night. Text first: one calm column, generous leading, no chrome inside the text.
2. **Colour means one thing each.** Ink for text. Rubric (vermilion) for structure and the active
   word: verse numbers, headings, chapter label, links, the anchor underline, primary buttons.
   Lapis for Greek and Hebrew outside the card headword (interlinear, search, Septuagint).
   Gold wash for "linked to the word you are on". Gilt for ornament only, never text.
3. **One moment of display per chapter**: the illuminated initial. Everything else stays quiet.
4. **At rest the text is plain.** Links reveal themselves on hover, focus or tap, never with
   permanent underlines.
5. **The card never covers the line being read.** It sits below the word (above when it must), or
   as a bottom sheet on phones.
6. **Never colour alone.** Every state also changes shape (underline style, badge, icon, words).

---

## 3. Colour

All values live in `tokens.css`. Light = vellum; dark = candlelight. Dark applies with
`<html data-theme="dark">`, or when the OS prefers dark and `data-theme="light"` is not set.
Settings "System" removes the attribute.

### 3.1 Tokens

| token | role | vellum | candlelight |
|---|---|---|---|
| `--bg` | desk behind the page; chrome | `#ece2cc` | `#15110d` |
| `--page` | reading surface (the leaf) | `#f7f0e1` | `#1d1711` |
| `--card` | word card, popovers, panels, inputs on chrome | `#fffaf0` | `#28201a` |
| `--sunken` | fields inside cards, recessed areas | `#f1e8d5` | `#221b14` |
| `--ink` | body text | `#2a2017` | `#efe3ca` |
| `--ink-2` | secondary text, definitions, superscriptions | `#5b4935` | `#cbb898` |
| `--ink-3` | labels, meta, supplied words, placeholders | `#6f5c45` | `#ad9a7c` |
| `--ink-inverse` | text on rubric / ink fills | `#fffaf0` | `#1d1711` |
| `--rubric` / `--rubric-hover` | vermilion: structure, active word, links, primary | `#a2311c` / `#8a2815` | `#ef8466` / `#f59b80` |
| `--lapis` | Greek/Hebrew outside the headword; focus (light) | `#2f4987` | `#a3b8ee` |
| `--lapis-wash` | Septuagint band | lapis 8% | lapis 10% |
| `--lapis-ground` / `-2` | ground of initials and the brand mark | `#213a74` / `#34559d` | `#1a2c58` / `#2a4482` |
| `--gilt` / `--gilt-2` | ornament: hairlines, fleurons, bezants | `#b8903f` / `#dcbd6e` | `#c9a45a` / `#e7c97f` |
| `--gilt-ink` | gold that must be read: eyebrow, POS, Strong's pill | `#7f5d1c` | `#dcbc72` |
| `--gold-leaf`, `--gold-letter` | gradients for initial frame and letter | fixed | fixed |
| `--verdigris` | success / "Connected" | `#3d6a4a` | `#9cc9a5` |
| `--danger` | errors (= rubric; always with icon and words) | rubric | rubric |
| `--rule` | hairlines between rows | `#e0d2b2` | `#372c20` |
| `--rule-strong` | panel and chip borders (decorative) | `#cbb68a` | `#57462f` |
| `--edge` | borders that identify a control | `#8f7a57` | `#8a7553` |
| `--hl` | gold wash: linked words | `rgb(214 166 58 / .27)` | `rgb(222 176 82 / .22)` |
| `--hl-soft` | hover preview, row hover | `rgb(214 166 58 / .15)` | `rgb(222 176 82 / .12)` |
| `--kin` | dotted underline: same lemma elsewhere | `#9c762a` | `#c9a45a` |
| `--approx` | dashed underline: approximate link | = `--ink-3` | = `--ink-3` |
| `--focus` | focus ring | `#2f4987` | `#e8c56c` |
| `--selection` | `::selection` | lapis 20% | lapis 28% |
| `--chart-ot` / `--chart-nt` / `--chart-zero` | distribution ribbon | gilt-ink / rubric / rule-strong | same mapping |
| `--overlay` | scrim behind modal sheets | ink 32% | black 50% |
| `--glow`, `--grain-image`, `--grain-opacity`, `--grain-blend` | page atmosphere | warm white glow, multiply grain | amber glow, soft-light grain |

### 3.2 Contrast (computed from `tokens.css`; WCAG 2.x)

Text needs 4.5:1; non-text indicators (1.4.11) need 3:1. Translucent washes are composited over
the surface they sit on. No pair fails.

| foreground | background | use | vellum | candlelight |
|---|---|---|---|---|
| `--ink` | `--page` | body text | 14.05:1 | 13.96:1 |
| `--ink` | `--card` | card text | 15.32:1 | 12.59:1 |
| `--ink-2` | `--page` | secondary text, superscription | 7.56:1 | 9.17:1 |
| `--ink-2` | `--card` | definition in card | 8.24:1 | 8.27:1 |
| `--ink-3` | `--page` | labels, supplied words, refs | 5.62:1 | 6.50:1 |
| `--ink-3` | `--card` | card labels (dt), source line | 6.13:1 | 5.86:1 |
| `--ink-3` | `--bg` | chrome labels on the desk | 4.96:1 | 6.88:1 |
| `--ink-3` | `--sunken` | placeholder in fields | 5.24:1 | 6.23:1 |
| `--rubric` | `--page` | verse numbers, rubrics, chapter label | 6.18:1 | 6.90:1 |
| `--rubric` | `--card` | card reference, links | 6.75:1 | 6.22:1 |
| `--rubric` | `--bg` | active translation tab | 5.45:1 | 7.30:1 |
| `--gilt-ink` | `--page` | eyebrow, native title | 5.31:1 | 9.70:1 |
| `--gilt-ink` | `--card` | part of speech, Strong's pill | 5.79:1 | 8.75:1 |
| `--lapis` | `--page` | Greek/Hebrew in interlinear, search | 7.64:1 | 9.00:1 |
| `--lapis` | `--lapis-wash` over `--card` | Septuagint word in its band | 7.34:1 | 6.68:1 |
| `--ink-3` | `--lapis-wash` over `--card` | Septuagint label | 5.41:1 | 4.83:1 |
| `--ink` | `--hl` over `--page` | linked word on gold wash | 11.79:1 | 8.82:1 |
| `--lapis` | `--hl` over `--page` | linked original in interlinear | 6.41:1 | 5.69:1 |
| `--ink-inverse` | `--rubric` | primary button text | 6.75:1 | 6.90:1 |
| `--page` | `--ink` | selected chip text | 14.05:1 | 13.96:1 |
| `--verdigris` | `--card` | "Connected" status | 6.01:1 | 8.62:1 |
| `--edge` | `--card` | input / switch boundary (non-text) | 3.97:1 | 3.62:1 |
| `--edge` | `--page` | input boundary on page (non-text) | 3.64:1 | 4.02:1 |
| `--kin` | `--page` | kin dotted underline (non-text) | 3.67:1 | 7.56:1 |
| `--rubric` | `--hl` over `--page` | anchor underline on wash (non-text) | 5.19:1 | 4.36:1 |
| `--focus` | `--page` | focus ring (non-text) | 7.64:1 | 10.68:1 |
| `--focus` | `--card` | focus ring in card (non-text) | 8.33:1 | 9.63:1 |
| `--focus` | `--bg` | focus ring on chrome (non-text) | 6.73:1 | 11.30:1 |
| `--gilt` | `--page` | ornament only: never text, never a sole indicator | 2.61:1 | 7.56:1 |

Rules: `--gilt` never carries text or meaning on its own. `--rule-strong` borders are decorative;
anything the user must recognise as a field or toggle uses `--edge`. Errors use `--danger` plus an
icon and words.

---

## 4. Typography

### 4.1 Families (all bundled via @fontsource; no runtime network)

| token | face | weights loaded | used for |
|---|---|---|---|
| `--f-ui` | EB Garamond | 400, 500, 600, italic 400/500 | the house face: chrome, card, labels, titles |
| `--f-read` | EB Garamond (default) or Literata Variable (`data-face="literata"`) | Literata opsz + wght axes | reading column (`.para`, `.line`, superscription, search hit text) |
| `--f-greek` | Gentium Book Plus | 400, italic 400, 700 | all Greek (`lang="grc"`) |
| `--f-hebrew` | Frank Ruhl Libre | 400, 500 | all Hebrew/Aramaic (`lang="hbo"` / `lang="arc"`, `dir="rtl"`) |
| `--f-translit` | Gentium Book Plus italic | | transliteration (ʾĕlōhîm, archē) |
| `--f-mono` | system monospace | | raw morphology codes only (Settings option) |

Language markup is mandatory: `base.css` selects the Greek and Hebrew faces by `:lang()`, so a
Greek word without `lang="grc"` renders in Garamond's Greek. Hebrew: `lang="hbo" dir="rtl"` on the
element itself (isolated, so it never reorders the English line). Aramaic words (OrigChapter
`aramaic`) use `lang="arc"`. Strip cantillation, keep vowel points (the data already does).

Literata is imported but downloads only when chosen (font files load on first use).

### 4.2 Scale

| role | spec |
|---|---|
| Reading text | `--fs-body` 22px / `--lh-body` 1.7, measure `--measure` 40rem (about 68 characters). Phone 19px / 1.66. Literata: 20px / 1.72 (phone 18 / 1.68). Settings size S/M/L/XL multiplies by 0.9 / 1 / 1.1 / 1.22 via `data-size`. Ragged right, `text-wrap: pretty`, `hanging-punctuation: first`, old-style figures. |
| Book title | EB Garamond 500, `--fs-title` 60px / 1.02 (phone 44px) |
| Eyebrow | `.eyebrow`: 17px all small caps, 0.22em tracking, `--gilt-ink` ("The Gospel according to") |
| Native title | Gentium italic 20px (Greek) / Frank Ruhl 24px (Hebrew), `--gilt-ink` |
| Chapter label | 17px 600 all small caps, 0.24em, `--rubric`, between 84px gilt hairlines |
| Section heading (rubric) | EB Garamond 500 italic 21px, `--rubric`, "¶" mark, verse range right-aligned 15px lining `--ink-3` |
| Minor heading | 17px 600 all small caps, 0.16em |
| Verse number | 0.56em 600, lining tabular, `--rubric`, raised 0.6em, `line-height: 0` |
| Superscription | `--f-read` italic, 0.82 x body, `--ink-2` |
| Card headword | Gentium 44px / Frank Ruhl 500 48px (sheet 38 / 41.6px) |
| Card meaning | 20px 500; facts 17px; labels 15px all small caps `--ink-3`; definition 17px / 1.42 `--ink-2` |
| UI controls | 17px (`--fs-ui`); meta 15px (`--fs-small`); pills 13px lining (`--fs-micro`) |
| Interlinear | English 1em of body; original 0.86em (Hebrew 1.02em) `--lapis`; transliteration 0.6em; gloss 0.64em italic `--ink-3` |

All-small-caps text is never set below 15px. Numbers in UI use lining figures (`.lining`,
`.tnum`); the reading text keeps old-style figures.

**Divine name.** Source "LORD" / "GOD" (all caps, length > 1) renders as
`<span class="sc">Lord</span>` (L + small caps), in text, headings and search results.

---

## 5. Space, layout, shape, motion

### 5.1 Spacing
4px base: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32, `--s7` 48, `--s8` 64,
`--s9` 96. Page gutter `--gutter` 32px (phone 16px).

### 5.2 Layout and breakpoints

- **Desktop (> 1240px)**: masthead 68px (scrolls away) + sticky toolbar 52px, closed by
  `.rule-double`. Stage padding 24px 32px 96px. Folio `.surface-folio`, max 1120px, padding
  48px 272px 64px 104px (narrow inner margin, wide outer margin holding the marginalia). Text column
  640px.
- **1101-1240px**: folio padding 48 / 248 / 64 / 80.
- **641-1100px**: folio max 780px, padding 48px; marginalia move below the colophon in two columns.
- **<= 900px**: translation tabs collapse into a "KJV ▾" button; search field becomes an icon that
  expands over the masthead.
- **<= 640px (phone)**: one sticky 56px header (brand, search, settings); the toolbar is replaced by
  the bottom dock; the folio loses border and shadow and runs edge to edge with 16px padding; the
  word card becomes a bottom sheet; popovers become sheets; search is full-screen.

`--sticky-h` is the height pinned at the top while reading (toolbar on desktop, header on phones);
card placement and `scroll-padding-top` use it.

### 5.3 Radii
`--r-xs` 3px (folio, wash), `--r-sm` 4px (chapter cells, kbd), `--r` 6px (controls, word card),
`--r-panel` 8px (popovers, search panel), `--r-sheet` 18px (top of sheets), `--r-pill` 999px.

### 5.4 Elevation (warm umber shadows; black in candlelight)
`--shadow-1` (tight), `--shadow-card` (word card and popovers: inset highlight + 3px + long soft),
`--shadow-panel` (search, dock), `--shadow-folio` (the leaf), `--shadow-sheet` (upward).
Nothing else casts a shadow.

### 5.5 Motion
| what | duration | easing |
|---|---|---|
| highlight washes, hovers | `--dur-1` 140ms | `--ease` |
| card entrance (5px rise / drop when flipped, fade) | `--dur-2` 180ms | `--ease-out` |
| sheet entrance (40px), dock hide/show, settings drawer | `--dur-3` 220ms | `--ease-out` |
| card hover-intent open | 140ms after pointer enters; 60ms when moving between words with a card open | |
| card hover close | 280ms after the pointer leaves both word and card | |

Keyframes in `base.css`: `rw-rise-in`, `rw-drop-in`, `rw-sheet-in`, `rw-fade-in`, `rw-pulse`.
`prefers-reduced-motion: reduce` collapses all animations and transitions to 1ms (end events still
fire). The first paint of a chapter or demo state has no entrance animation.

### 5.6 Stacking
`--z-chrome` 30, `--z-card` 40, `--z-panel` 45, `--z-popover` 50, `--z-dock` 55, `--z-sheet` 60,
`--z-toast` 80, `--z-tip` 90.

### 5.7 Icons
24px viewBox, 1.5px round strokes, `currentColor` (base.css sets SVG defaults). Set: chevrons,
search, close, sliders (settings), sun / candle (theme), list ("See all"), interlinear (stacked
lines), key (NIV), book. Icons are `aria-hidden="true"`; buttons carry `aria-label`.

---

## 6. Components

Shared primitives in `base.css`: `.surface-folio`, `.surface-card`, `.btn` (`--primary`,
`--quiet`), `.link-btn`, `.icon-btn`, `.chip` (selected via `aria-pressed|checked|selected`),
`.pill` (`--dashed`), `.input` (`aria-invalid`), `.switch` (`<input type="checkbox"
role="switch">`), `kbd`, `.fleuron`, `.rule-gilt`, `.rule-double`, `.label-sc`, `.eyebrow`, `.sc`,
`.translit`, `.grc`, `.hbo`, `.lining`, `.tnum`, `.mono`, `.truncate`, `.clamp-3`, `.sr-only`,
`.skip-link`, `.scroll-lock`, `.skeleton-line`, `.no-print`, and the word-state classes (§6.5).
Component CSS lives next to each component.

### 6.1 Header, toolbar and phone dock

**Masthead (desktop, 68px, `--bg`)**: grid `auto auto 1fr auto`, gap 24px, max 1200px.
1. Brand: the `R` initial (gold letter on lapis, gold-leaf frame) + "ootword", EB Garamond 500
   28px; `aria-label="Rootword"`. Links to the last-read chapter.
2. Passage navigation: `‹` icon button, passage button "John 1 ▾" (40px, `--card`, `--rule-strong`
   border, 19px) opening the passage sheet (§6.2), `›` icon button.
3. Search field (max 460px, right-aligned): `.input` on `--card`, search icon, placeholder
   "Search a word, phrase, λόγος, H430 or Jn 3:16", `kbd /` hint.
4. Settings (sliders icon) and theme toggle (sun in vellum, candle in candlelight).

**Toolbar (sticky, 52px)**: translation tabs (§6.3) left; right: "Interlinear" `.switch`. Closed by
`.rule-double`. When the masthead has scrolled out of view, a compact "John 1 ▾" passage button
fades in at the toolbar's start.

```css
.brand { display: inline-flex; align-items: center; gap: 2px; font-size: 1.75rem; font-weight: 500; color: var(--ink); text-decoration: none; }
.brand__initial {
  display: inline-grid; place-items: center; width: 38px; height: 38px; margin-right: 3px;
  border: 2px solid transparent; border-radius: 2px;
  background: radial-gradient(circle at 50% 42%, var(--lapis-ground-2), var(--lapis-ground) 72%) padding-box,
              var(--gold-leaf) border-box;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25);
}
.brand__initial span {
  font-size: 1.9rem; font-weight: 600; line-height: 1; padding-top: 0.08em;
  background: var(--gold-letter); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.tab { position: relative; height: 36px; padding: 0 var(--s3); color: var(--ink-2); font-size: 1.0625rem; font-weight: 600;
       font-variant-caps: all-small-caps; letter-spacing: 0.12em; }
.tab[aria-checked='true'] { color: var(--rubric); }
.tab[aria-checked='true']::after { content: ''; position: absolute; left: var(--s3); right: var(--s3); bottom: 3px; height: 2px;
                                    background: var(--rubric); border-radius: 2px; }
```

**Phone header (56px, sticky)**: brand (initial + "ootword"), search icon, settings icon. Theme
lives in Settings.

**Phone dock** (Lumen graft): fixed pill, centred, 60px, bottom 12px + safe area, `--card`,
`--rule-strong` border, `--shadow-panel`. Slots: `‹` previous chapter, passage pill "John 1"
(filled `--ink`, text `--page`, opens the passage sheet), translation "KJV" (rubric small caps,
opens the translation sheet), interlinear toggle (icon, `aria-pressed`), `›` next chapter. It
slides away (`translateY(140%)`, 220ms) while scrolling down more than 24px and returns on scroll up,
at the end of the chapter, or on focus inside it; it is hidden while a sheet is open. The stage
reserves `padding-bottom: calc(var(--dock-h) + 36px + env(safe-area-inset-bottom))` so it never
covers the colophon (Lumen's bug).

```css
.dock { position: fixed; left: 50%; bottom: calc(12px + env(safe-area-inset-bottom)); transform: translateX(-50%);
        z-index: var(--z-dock); display: flex; align-items: center; gap: 2px; height: var(--dock-h); padding: 0 6px;
        background: var(--card); border: 1px solid var(--rule-strong); border-radius: var(--r-pill); box-shadow: var(--shadow-panel);
        transition: transform var(--dur-3) var(--ease-out); }
.dock.is-away { transform: translate(-50%, 140%); }
.dock__passage { white-space: nowrap; height: 44px; padding: 0 var(--s4); border-radius: var(--r-pill);
                 background: var(--ink); color: var(--page); font-size: 1.125rem; font-weight: 500; }
.dock__tr { height: 44px; padding: 0 var(--s3); font-weight: 600; font-variant-caps: all-small-caps; letter-spacing: 0.12em;
            color: var(--rubric); font-size: 1.0625rem; }
```

Keyboard shortcuts (not while typing): `/` search, `g` passage picker, `i` interlinear, `[` / `]`
previous / next chapter, `?` shortcut list. Hints appear in the Reading key.

### 6.2 Passage picker (book and chapter grid sheet)

Desktop: popover (`.surface-card`, `--r-panel`, `--shadow-panel`) anchored under the passage
button, 720px wide, max-height 80vh, scrolls internally.

1. **Go to** field at the top (`.input`, autofocus): accepts any reference `reference.ts` parses
   ("jn 3:16", "1 Cor 13", "Ps 23"). Enter navigates; an unparseable entry shows "No such passage"
   in `--ink-3` under the field.
2. Two columns, **Old Testament** | **New Testament** (`.label-sc` headings with counts 39 / 27).
   Each is a 4-column grid of `BookInfo.short` names (30px rows, 15-17px, left-aligned). Genre
   groups start on a new row with 8px extra gap: Law, History, Wisdom, Major Prophets, Minor
   Prophets | Gospels and Acts, Paul's Letters, General Letters, Revelation (group name in each
   cell's `title`).
3. Choosing a book reveals its **chapter grid** under both columns: `repeat(auto-fill, minmax(36px,
   1fr))`, 32px cells, `--rule` border, lining figures. Single-chapter books (OBA, PHM, 2JN, 3JN,
   JUD) navigate immediately.
4. States: current book = filled `--rubric` with `--ink-inverse` text; current chapter =
   `--rubric` 1px border + inset ring + rubric text; hover = `--hl-soft`.
5. Keyboard: arrow keys move within a grid (roving tabindex), Enter selects, Esc closes and returns
   focus to the passage button. `role="dialog"` with `aria-label="Choose a passage"`; grids are
   `role="grid"` or plain button lists with `aria-current="true"` on the current item.

Phone: bottom sheet (92vh, `--r-sheet`, grab handle). Go-to field, segmented OT / NT, genre groups
with visible `.label-sc` labels, 4-column grid; choosing a book slides to the chapter grid (6
columns, 44px cells) with "‹ Books" back.

### 6.3 Translation picker (incl. NIV connect)

Order is fixed: **KJV** (default) first, then BSB, WEB, ASV, YLT, then remote translations.

**Desktop tabs** (`role="radiogroup"`, each `role="radio"`): small-caps abbreviations; selected =
rubric text + 2px rubric bar. Tooltip on hover/focus: "King James Version · 1769 · Strong's-tagged".
NIV not yet connected appears as `NIV connect` (`.tab--connect`: abbreviation in `--ink-3`,
"connect" in italic `--gilt-ink` with a dashed `--edge` underline) and opens the connect panel;
once connected it is an ordinary tab.

**Translation list** (popover on desktop from "All translations", the "KJV ▾" button at <= 900px, a
sheet on phones): rows of 56px:

| column | content |
|---|---|
| abbreviation | rubric small caps 18px |
| name | "King James Version" 17px `--ink`; second line "1769 · Public domain" 15px italic `--ink-3` |
| link quality | meter of three 6px dots (filled `--ink-2`, empty `--rule-strong`) **plus a word**: ●●● Hand-aligned (BSB), ●●○ Strong's-tagged (KJV), ●○○ Approximate (WEB, ASV, YLT, NIV) |
| current | check icon in `--rubric` |

Below a "With your own key" `.label-sc` separator: the **NIV row**.

| NIV state | presentation |
|---|---|
| not connected | "New International Version" + "© Biblica · read it with your own free API.Bible key" + `btn--quiet` "Connect". Activating expands the row inline (no navigation). |
| connect form | paragraph: "The NIV is under copyright, so Rootword never bundles it. Paste a free API.Bible key and it opens like any other translation. Its word links are matched through the BSB, so they are marked approximate." · label `API.BIBLE KEY` · `.input` (placeholder "paste your key", `autocomplete="off"`, `spellcheck="false"`) · `btn--primary` "Connect NIV" · `btn--quiet` "Not now" · link "Get a free key at scripture.api.bible ↗" · note "Stored only in this browser." |
| checking | primary button shows a small spinner and "Checking…", input `aria-busy="true"`, both disabled |
| error | input `aria-invalid="true"` (rubric inset bar); message under it with a warning icon, `role="alert"`: 401/403 "API.Bible refused that key. Check it and try again." · 429 "This key has hit API.Bible's rate limit. Try again in a minute." · network "Couldn't reach API.Bible. Are you offline?" |
| connected | verdigris dot + "Connected" (words, not just colour); meter ●○○ Approximate; selecting it loads the NIV. Settings offers "Remove key". |

While reading the NIV, the chapter foot shows the copyright line API.Bible returns, and the
approximate notice (§6.4) is shown under the chapter label. Tests use the fake key `test-key`.

### 6.4 Reading column

Order inside `.reading` (max `--measure`): title block, optional approximate notice, sections
(heading + paragraphs), chapter navigation, colophon. The folio's outer margin holds the
marginalia.

**Title block** (centred): `.eyebrow` (traditional title, e.g. "The Gospel according to", "The
First Book of Moses, called"; fallback "The Book of"), book title, native title (Greek for NT,
Hebrew for OT, from a static 66-entry map; optional), chapter label "Chapter 1" between gilt
hairlines. Psalms: title "Psalm 23", eyebrow "The Book of Psalms", no chapter label. Interlinear:
title at 46px.

**Approximate notice** (bridged translations only): one line, 15px italic `--ink-3`, centred under
the chapter label: "≈ Word links in the WEB are matched through the BSB and may be approximate."
with "How links work" linking to About.

**Section heading** (`TextChapter.headings`): `<h2 class="rubric">` with ¶ mark, the title in its
own span (a flex gap would otherwise split text around inline small caps), verse range on the right
computed up to the next heading. Headings `clear: both` so they never wrap around an initial.

```css
.rubric { clear: both; margin: var(--s5) 0 var(--s3); color: var(--rubric); font-size: var(--fs-h-rubric); font-weight: 500;
          font-style: italic; line-height: 1.3; display: flex; align-items: baseline; gap: var(--s3); }
.rubric__mark { font-style: normal; font-weight: 400; }
.rubric__text { min-width: 0; }
.rubric__range { margin-left: auto; white-space: nowrap; font-style: normal; font-size: var(--fs-small); color: var(--ink-3); font-variant-numeric: lining-nums; }
```

```html
<h2 class="rubric"><span class="rubric__mark" aria-hidden="true">¶</span><span class="rubric__text">The <span class="sc">Lord</span> Is My Shepherd</span><span class="rubric__range">23:1–6</span></h2>
```

**Paragraphs** (`TextChapter.paras`; verse 1 implied): `.para`, no space between paragraphs, 1.4em
first-line indent except after a heading and after the paragraph holding the initial.

**Verse per line**: used when `paras` is absent (the traditional KJV setting) and selectable in
Settings. Each verse is a block with its number hanging in the left margin.

```css
.para, .line, .verse-line { margin: 0; font-family: var(--f-read); font-size: var(--fs-body); line-height: var(--lh-body);
  hanging-punctuation: first; font-variant-numeric: oldstyle-nums proportional-nums; }
.para { text-wrap: pretty; }
.para + .para { text-indent: 1.4em; }
.rubric + .para, .para--initial + .para { text-indent: 0; }
.vn { position: relative; top: -0.6em; margin: 0 0.16em 0 0.06em; font-size: 0.56em; line-height: 0; font-weight: 600;
      color: var(--rubric); font-variant-numeric: lining-nums tabular-nums; user-select: none; }
.verse-line { position: relative; padding-left: 1.5em; }
.verse-line > .vn { position: absolute; left: 0; top: 0.95em; width: 1.9em; text-align: right; } /* em of the 0.56em numeral: about 1.05em of text */
```

Verse numbers: `<span class="vn" id="v16"><span class="sr-only">Verse </span>16</span>`. Verse 1's
number is visually replaced by the initial but stays in the DOM as `sr-only` text.

**Illuminated initial** (one per chapter, reading mode only): the first letter of verse 1 on a lapis
ground in a gold-leaf frame with two gold bezants. Prose (paragraph layout): floated, three lines
tall. Verse-per-line, poetry, or a chapter that opens with a superscription: the **raised** form,
inline, two lines tall. Skip the initial when the first character is not a letter (quotation marks,
numerals) and in interlinear mode. The first unit carries `aria-label` with the whole word; the
initial and the remaining letters are `aria-hidden`.

```css
.initial {
  float: left; position: relative; display: grid; place-items: center;
  width: 3.85em; height: 3.95em; margin: 0.36em 0.62em 0.05em 0;
  border: 3px solid transparent;
  background:
    repeating-linear-gradient(45deg, rgb(231 204 133 / 0.16) 0 1px, transparent 1px 10px) padding-box,
    repeating-linear-gradient(-45deg, rgb(231 204 133 / 0.16) 0 1px, transparent 1px 10px) padding-box,
    radial-gradient(circle at 50% 42%, var(--lapis-ground-2), var(--lapis-ground) 72%) padding-box,
    var(--gold-leaf) border-box;
  box-shadow: inset 0 0 0 3px var(--lapis-ground), inset 0 0 0 4px rgb(255 255 255 / 0.28),
              0 1px 2px rgb(var(--shadow-rgb) / 0.25);
}
.initial::before, .initial::after { content: ''; position: absolute; width: 7px; height: 7px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fbeec4, #d2a64a 55%, #8f6b25); }
.initial::before { top: -9px; left: -9px; }
.initial::after { bottom: -9px; right: -9px; }
.initial__letter { font-family: var(--f-ui); font-size: 3.4em; line-height: 1; font-weight: 600; padding-top: 0.1em;
  background: var(--gold-letter); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 1px 0 rgb(10 18 45 / 0.55)); }
.initial--raised { float: none; display: inline-grid; vertical-align: -0.32em; width: 1.95em; height: 1.95em;
  margin: 0 0.32em 0 0; border-width: 2px; }
.initial--raised .initial__letter { font-size: 1.55em; }
.w.is-linked .initial, .w.is-anchor .initial { box-shadow: inset 0 0 0 3px var(--lapis-ground),
  inset 0 0 0 4px rgb(255 255 255 / 0.28), 0 0 0 5px var(--hl); }
```

```html
<p class="para para--initial"><span class="w" data-o="0 1" aria-label="In"><span class="initial" aria-hidden="true"><span class="initial__letter">I</span></span><span aria-hidden="true">n</span></span><span class="vn sr-only">Verse 1</span> the …</p>
```

**Psalm superscription** (`TextChapter.superscription`): before verse 1, `.superscription`
(`--f-read` italic, 0.82 x body, `--ink-2`, 12px below). Its tokens are linked like verse tokens
(`OW.verse = 0`; the card's reference reads "Psalm 23 title").

**Poetry**: the contract has no line structure yet. Until it does, poetic books (JOB, PSA, PRO, ECC,
SNG, LAM) default to verse-per-line. If line data is added later: `.line` with a 1.6em hanging
indent and `.line--2` at 3.2em.

**Chapter navigation**: "‹ Luke 24" · `.fleuron--small` · "John 2 ›", 17px 600 all small caps,
`--ink-2`, hover rubric on `--hl-soft`. Prefetch the next chapter on idle (`prefetchChapter`).

**Colophon**: 14px italic `--ink-3`, centred: the current translation's licence, the original text
edition and licence, alignment credit, lexicon credit (from `meta.credits`), then "About and
credits".

**Marginalia** (outer margin at > 1100px; two columns below the colophon at 641-1100px; a "Notes
on this chapter" disclosure after the colophon on phones):
1. *In this chapter*: the section headings with verse numbers; click scrolls to the verse.
2. *Words of note*: up to 7 content lemmas by count in the chapter (skip articles, conjunctions,
   prepositions, particles and pronouns by morphology POS): lemma (Greek 20px / Hebrew 21.6px),
   gloss italic `--ink-2`, count `N×` rubric. Hovering a row marks all its occurrences `.is-kin`;
   clicking opens the card on the first occurrence.
3. *Reading key*: live swatches using the real classes (`.w.is-linked`, `.w.is-kin`,
   `.w.w--approx.is-anchor`, `.w-supplied`) and the keyboard legend.

```css
.marginalia__title { display: flex; align-items: center; gap: var(--s2); margin: 0 0 var(--s2); color: var(--gilt-ink);
  font-size: var(--fs-ui); font-weight: 500; font-variant-caps: all-small-caps; letter-spacing: 0.18em; }
.marginalia__title::before { content: ''; width: 14px; height: 1px; background: var(--gilt); }
.notes { border-left: 1px solid color-mix(in srgb, var(--gilt) 30%, transparent); }
.note { width: 100%; display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; gap: var(--s2);
        padding: 3px var(--s2) 3px var(--s3); text-align: left; border-radius: 0 4px 4px 0; }
.note:hover { background: var(--hl-soft); }
.note__n { color: var(--rubric); font-size: var(--fs-small); font-weight: 600; font-variant-numeric: lining-nums; }
```

### 6.5 Word linking model and word states

**Units.** Consecutive `WordToken`s with the identical link set (and the same `info.i` / `info.c`
class) separated only by spaces become one interactive unit: "the beginning" → ἀρχῇ, "He makes me
lie down" → יַרְבִּיצֵנִי. Punctuation stays outside units. Build link sets with
`linkIndex(text)` / `tokensLinkedTo()` and kin sets with `relatedTokens()` from `src/lib/data.ts`.

**States** (classes from `base.css`; dynamic ones toggled imperatively on the affected nodes):

| state (task name) | when | style |
|---|---|---|
| rest | linked unit, nothing open | plain text; `cursor: pointer` |
| preview (linked-hover) | pointer over a unit before the card opens, or over another unit while a card is pinned (`.is-preview`, `:hover` on hover-capable devices only) | `--hl-soft` wash |
| linked | the unit's links intersect the open word's links (`.is-linked`), across line breaks (`box-decoration-break: clone`) | `--hl` wash |
| anchor | the unit the card belongs to (`.is-anchor`) | wash + 1.5px `--rubric` underline, offset 0.24em |
| related (kin) | same Strong's base elsewhere in view, not linked (`.is-kin`) | 2px dotted `--kin` underline. Not applied to articles, conjunctions, prepositions, particles, or lemmas with > 5,000 occurrences |
| unlinked | a plain string token | ordinary text; not focusable; no hover |
| supplied | `info.i = 1` (KJV italics) (`.w-supplied`) | italic `--ink-3`; hover or focus shows the supplied note card; never washed |
| lexicon-only | `links = []` with `info.s` (KJV Strong's absent from SBLGNT) (`.w--lexonly`) | interactive like a linked unit; the card shows the lexicon entry and the Textus Receptus note; no other words are washed |
| approximate | bridged token with `info.c < 1` (`.w--approx`) | nothing at rest; anchor underline **dashed**; card shows an "≈ approximate" badge. `c < 0.5` adds `.w--weak`: linked wash drops to `--hl-soft`, kin suppressed |
| focused | roving keyboard focus | 2px `--focus` ring, offset 2px, plus the preview wash; Enter opens |

`forced-colors`: linked/anchor map to `Highlight`/`HighlightText`; kin to `CanvasText`.

### 6.6 Word card ("the gloss")

`.surface-card` (inner gilt ruling), 400px wide (`--card-w`), max-height `calc(100vh - var(--sticky-h)
- 24px)` with internal scroll, 7px caret. `role="dialog"`, `aria-modal="false"`,
`aria-labelledby` = headword id.

**Greek card (NT), top to bottom**

```
┌─────────────────────────────────────────────────────┐
│ JOHN 1:1  “Word”                   GREEK  (G3056)  ✕ │ ref (rubric small caps) · English unit (italic ink-2) · language (.label-sc) · Strong's .pill · close
│ λόγος   logos                                        │ headword 44px Gentium (surface form) · transliteration italic 17.6px
│         NOUN                                         │ part of speech, gilt-ink small caps
│ [οὐδὲ not] + [ἕν one]                                │ word/morpheme tabs, only when the unit links several originals
│ ──────────────── ◆ ────────────────                  │ .rule-gilt
│ MEANING   word                                       │ contextual gloss (OW.gloss), 20px 500
│ FORM      Noun · nominative masculine singular       │ describeMorph(...).long; raw code in .mono only if Settings says so
│ LEXICON   λόγος logos                                │ LexEntry.lemma + translit (+ LexEntry.gloss if it differs)
│ KJV       word 218, saying 50, account 8, …          │ LexEntry.kjv, one line, full text when the card is expanded
│ A word that expresses a thought: a saying, message…  │ LexEntry.def (sanitised), 3 lines, rubric first letter; "More" expands
│ Abbott-Smith (abridged) via STEPBible · SBLGNT       │ source line, 13px italic ink-3
│ ≡ See all 318 verses ›                3× in this chapter │ concordance count · occurrences in this chapter
└─────────────────────────────────────────────────────┘
```

**Hebrew card (OT)**: identical, plus:
- Header tag "HEBREW" (or "ARAMAIC" when `isAramaic()`); headword Frank Ruhl 500 48px,
  `lang="hbo" dir="rtl"`, left edge aligned with the other rows. A multi-morpheme written word shows
  whole (`wordGroup()`), morphemes not selected in `--ink-3` (`.wc__aux`).
- **Septuagint band** directly under the headword (when `Word.lxx`): `--lapis-wash` ground, 2px
  lapis left rule, label "SEPTUAGINT", the Greek form 24px `--lapis`, its transliteration, Strong's
  pill (hidden when the Strong's is empty or only "G"). This is the Greek word "below" an OT word.
- Reference shows the Hebrew numbering when it differs: "Malachi 4:1 (Heb. 3:19)" from `OW.ref`.
- Source line: "BDB (abridged) via STEPBible · WLC".

```css
.wc { position: absolute; z-index: var(--z-card); width: var(--card-w); max-width: calc(100vw - 24px);
      max-height: calc(100vh - var(--sticky-h) - 24px); overflow-y: auto; font-size: 1rem;
      animation: rw-rise-in var(--dur-2) var(--ease-out); }
.wc.is-above { animation-name: rw-drop-in; }
.wc__caret { position: absolute; top: -7px; left: var(--caret-x, 48px); width: 13px; height: 13px; background: var(--card);
  border-left: 1px solid var(--rule-strong); border-top: 1px solid var(--rule-strong);
  transform: translateX(-50%) rotate(45deg); border-top-left-radius: 2px; }
.wc.is-above .wc__caret { top: auto; bottom: -7px; border: 0; border-right: 1px solid var(--rule-strong);
  border-bottom: 1px solid var(--rule-strong); border-radius: 0 0 2px 0; }
.wc__inner { position: relative; z-index: 1; padding: 14px 24px 12px; }
.wc__top { display: flex; align-items: baseline; gap: var(--s2); }
.wc__ref { color: var(--rubric); font-weight: 600; font-variant-caps: all-small-caps; letter-spacing: 0.12em; font-variant-numeric: lining-nums; }
.wc__en { color: var(--ink-2); font-style: italic; font-size: 1.0625rem; min-width: 0; }
.wc__tags { margin-left: auto; display: inline-flex; align-items: baseline; gap: var(--s2); }
.wc__close { width: 30px; height: 30px; margin: -6px -12px 0 -4px; align-self: flex-start; }
.wc__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--s3); margin-top: 2px; }
.wc__word { font-size: var(--fs-headword); line-height: 1.12; color: var(--ink); }
.wc__word:lang(hbo), .wc__word:lang(arc) { font-size: var(--fs-headword-he); font-weight: 500; line-height: 1.25; }
.wc__aux { color: var(--ink-3); }
.wc__sub { display: flex; flex-direction: column; line-height: 1.25; }
.wc__sub .translit { font-size: 1.1rem; color: var(--ink-2); }
.wc__pos { color: var(--gilt-ink); font-weight: 600; font-variant-caps: all-small-caps; letter-spacing: 0.12em; }
.wc__lxx { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 var(--s3); margin-top: var(--s2); padding: 6px var(--s3) 7px;
  border-radius: var(--r-sm); background: var(--lapis-wash); border-left: 2px solid color-mix(in srgb, var(--lapis) 55%, transparent); }
.wc__lxx-word { font-size: 1.5rem; color: var(--lapis); line-height: 1.2; }
.wc__lxx .pill { margin-left: auto; }
.wc__rule { margin: 10px 0 8px; }
.wc__facts { display: grid; gap: 3px; }
.wc__facts > div { display: grid; grid-template-columns: 84px 1fr; gap: var(--s3); align-items: baseline; }
.wc__facts dt { color: var(--ink-3); font-size: var(--fs-small); font-weight: 500; font-variant-caps: all-small-caps; letter-spacing: 0.12em; }
.wc__facts dd { font-size: 1.0625rem; line-height: 1.4; min-width: 0; }
.wc__meaning { font-size: var(--fs-meaning) !important; font-weight: 500; line-height: 1.25 !important; }
.wc__def { margin-top: var(--s2); color: var(--ink-2); font-size: 1.0625rem; line-height: 1.42; }
.wc__def::first-letter { color: var(--rubric); font-weight: 600; }
.wc__src { margin-top: 2px; color: var(--ink-3); font-size: var(--fs-micro); font-style: italic; }
.wc__foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); margin-top: var(--s2);
  padding-top: var(--s2); border-top: 1px solid var(--rule); }
.wc__here { color: var(--ink-3); font-size: var(--fs-small); font-style: italic; }
```

Markup skeleton (Greek; the Hebrew card adds `.wc__lxx` after `.wc__head`):

```html
<div class="wc surface-card" role="dialog" aria-modal="false" aria-labelledby="wc-head" id="word-card">
  <span class="wc__caret" aria-hidden="true"></span>
  <span class="wc__handle" aria-hidden="true"></span>
  <div class="wc__inner">
    <header class="wc__top">
      <span class="wc__ref">John 1:1</span><span class="wc__en">“Word”</span>
      <span class="wc__tags"><span class="label-sc">Greek</span><button class="pill" aria-label="Strong's G3056: search all occurrences">G3056</button></span>
      <button class="icon-btn wc__close" aria-label="Close word card">…</button>
    </header>
    <div class="wc__head">
      <p class="wc__word" lang="grc" id="wc-head">λόγος</p>
      <p class="wc__sub"><span class="translit">logos</span><span class="wc__pos">noun</span></p>
    </div>
    <div class="rule-gilt wc__rule" aria-hidden="true"></div>
    <dl class="wc__facts">…</dl>
    <p class="wc__def clamp-3">…</p>
    <p class="wc__src">Abbott-Smith (abridged) via STEPBible · SBLGNT</p>
    <footer class="wc__foot"><a class="link-btn" href="#/search?q=G3056">See all 318 verses ›</a><span class="wc__here">3× in this chapter</span></footer>
  </div>
</div>
```

**Data mapping**

| part | source |
|---|---|
| reference | book `short` + `OW.verse` (0 → "title"); `OW.ref` in parentheses when set |
| English | the unit's text |
| language | `Word.lang`: grc → Greek, hbo → Hebrew, arc → Aramaic; edition from `OrigChapter.edition` in the source line |
| Strong's pill | `Word.strongs` shown without zero padding (G3056, H430); activates a Strong's search |
| headword | `OW.text` (surface form in this verse; Hebrew: the whole written word via `wordGroup`) |
| transliteration | `OW.translit`, else `transliterate(text)` for Greek, else `LexEntry.translit` |
| part of speech | `describeMorph(OW.morph, lang).pos`, else `LexEntry.pos` |
| tabs | one per linked original word (Greek) or morpheme (Hebrew); default = content word: verb or noun, then adjective, then others, then pronominal suffix, then prefix or article; the object marker אֵת last |
| meaning | `OW.gloss`, with morpheme glosses of one written word joined and dots turned to spaces ("makes.me.lie.down" → "makes me lie down"), "(et)" dropped |
| form | `describeMorph(...).long`; if `ok` is false show "—" (never the raw code by default). Optional: parts with a `MORPH_GLOSSARY` entry get a dotted underline and a one-line explanation tooltip |
| lexicon | `LexEntry.lemma` (+ `translit`, + `gloss` when it differs from the meaning) |
| KJV | `LexEntry.kjv`; omit the row when absent |
| definition | `LexEntry.def` (allowed HTML only: b, i, br, span.ref); fallback `LexEntry.strongsDef`; clamp 3 lines with a "More" `.link-btn` when overflowing (no mid-word ellipsis) |
| See all N verses | `(await loadConcordance(baseStrongs(id))).length`; until loaded, "See all verses ›" |
| N× in this chapter | count of `OrigChapter.words` with the same base Strong's |
| Septuagint | `Word.lxx` (`parseLxx`); NFC-normalise the form |

**Variants**
- *Supplied word* (KJV italics): 320px mini card. Header: reference, “is”, dashed pill
  "supplied". Body: "The translators added *is* so the English reads naturally; no Hebrew word
  stands behind it. The KJV prints such words in italics."
- *Approximate*: dashed pill "≈ approximate" in the header; above the footer, 15px italic `--ink-3`:
  "Matched through the BSB. The WEB has no hand-made alignment, so this link may be imprecise
  (confidence: high | medium | low)" for c >= 0.8 | >= 0.5 | < 0.5.
- *Lexicon-only* (KJV Strong's with no SBLGNT word): headword = `info.o` form if present, else
  `LexEntry.lemma`; form from `info.m`; note: "This word is in the Greek text the KJV translated
  (the Textus Receptus) but not in the SBL Greek New Testament." No "N× in this chapter".
- *Several originals for one English word*: tabs (`role="tablist"`, 44px min height, selected =
  `--hl` + gilt border); headword shows all, the selected one in `--ink`.
- *Missing lexicon entry*: definition area reads "No lexicon entry for H0871a." in `--ink-3`.
- *Loading*: everything from `OrigChapter` renders at once; definition, KJV row and counts show
  `.skeleton-line`s until `loadLexEntry` / `loadConcordance` resolve.

### 6.7 Card placement and behaviour

**Placement (viewport > 640px)**: the card is absolutely positioned inside `.reading`
(`position: relative`), so it scrolls with the text.

```ts
// rects: word.getClientRects(); use the rect under the pointer for wrapped phrases, else the last one.
function placeCard(card: HTMLElement, word: HTMLElement, pointerY?: number, pinned = false) {
  const rects = [...word.getClientRects()];
  const r = (pointerY != null && rects.find((x) => pointerY >= x.top && pointerY <= x.bottom)) || rects[rects.length - 1];
  const host = card.offsetParent!.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  // bottom edge of whatever chrome is pinned right now (masthead + toolbar at the top of the page, toolbar alone later)
  const top = document.querySelector('[data-sticky-chrome]')?.getBoundingClientRect().bottom ?? 0;
  const cw = card.offsetWidth, ch = card.offsetHeight, gap = 12;
  const cx = r.left + r.width / 2;
  const left = Math.min(Math.max(cx - 48, 12), vw - cw - 12);           // word sits near the card's left, clamped 12px
  const below = vh - r.bottom - gap, above = r.top - top - gap;
  let placeAbove = ch > below && ch <= above;                           // flip only when above fits
  if (!placeAbove && ch > below && !pinned) placeAbove = above > below;  // hover card: take the roomier side (it scrolls inside)
  card.classList.toggle('is-above', placeAbove);
  card.style.left = `${left - host.left}px`;
  card.style.top = placeAbove ? `${r.top - gap - ch - host.top}px` : `${r.bottom + gap - host.top}px`;
  card.style.setProperty('--caret-x', `${Math.min(Math.max(cx - left, 18), cw - 18)}px`);
  // pinned and no room: stay below and scroll the page by the minimum so the card fits,
  // never pushing the word under the sticky chrome.
  if (pinned && !placeAbove && ch > below) window.scrollBy({ top: Math.min(ch - below + gap, r.top - top - gap) });
}
```

Rules: the card never covers the line it belongs to; caret at the word's centre, clamped 18px from
the card's edges; reposition on resize (`ResizeObserver` on `.reading`) and after fonts load.

**Behaviour**
- *Hover* (only when `matchMedia('(hover: hover) and (pointer: fine)')` and Settings "Open on
  hover" is on): open 140ms after the pointer enters a unit (60ms when moving between units with a
  card open); close 280ms after the pointer leaves both unit and card, so the pointer can travel
  into the card. Scrolling closes an unpinned card.
- *Pin*: click, tap or Enter/Space pins the card (close button visible, `aria-expanded="true"` on
  the unit). Clicking the anchor again, clicking outside, or Esc closes it; Esc returns focus to
  the unit. Clicking another unit moves the pinned card there.
- *Keyboard*: the passage is **one Tab stop** (roving tabindex on units, including supplied words).
  ←/→ previous/next unit; ↑/↓ first unit of the previous/next verse; Home/End first/last unit of the
  chapter. With a card open, ←/→ carry it along word by word. The card is rendered right after the
  passage in DOM order, so Tab moves into it; Shift+Tab from its first control returns to the unit.
- *ARIA*: to keep browse-mode reading quiet, units have no role at rest; the roving-focused unit gets
  `role="button"`, `aria-haspopup="dialog"`, `aria-controls="word-card"`, `aria-expanded`. While
  open, the anchor has `aria-describedby` pointing at an `sr-only` summary; cards opened by keyboard
  or touch also send it to a polite live region: "λόγος, logos. Greek noun, nominative masculine
  singular. Means word. Strong's G3056."
- *Touch, wider than 640px*: tap opens a pinned popover card (no hover).
- *Phones (<= 640px)*: bottom sheet (`.wc--sheet`): full width, max 68vh, `--r-sheet` top corners,
  grab handle, internal scroll, safe-area padding, `rw-sheet-in`. After it renders, scroll so the
  tapped word sits at least 16px above the sheet's top. Tapping another word swaps the content
  (120ms cross-fade). Close by ✕, Esc, swipe down on the handle, or tapping outside the sheet. No
  scrim (the text stays readable above). The dock hides while the sheet is open.

```css
.wc--sheet { position: fixed; left: 0; right: 0; bottom: 0; top: auto; width: auto; max-width: none; max-height: 68vh;
  overflow-y: auto; overscroll-behavior: contain; border-radius: var(--r-sheet) var(--r-sheet) 0 0; border-bottom: 0;
  padding-bottom: env(safe-area-inset-bottom); box-shadow: var(--shadow-sheet); z-index: var(--z-sheet);
  animation: rw-sheet-in var(--dur-3) var(--ease-out); }
.wc--sheet::after { inset: 6px 6px 0; border-bottom: 0; border-radius: 13px 13px 0 0; }
.wc--sheet .wc__caret { display: none; }
.wc__handle { display: none; }
.wc--sheet .wc__handle { display: block; width: 40px; height: 4px; margin: 10px auto 0; border-radius: 4px; background: var(--rule-strong); }
.wc--sheet .wc__inner { padding: 8px 22px 22px; }
```

### 6.8 Interlinear

Toggled by the toolbar switch (phone: dock icon; shortcut `i`). A chip row appears at the top of
the folio: "Beneath each word: [Greek | Hebrew] [Transliteration] [Gloss] [Form] [Septuagint]"
(`.chip`, `aria-pressed`; defaults original + gloss; Septuagint only offered in the OT); choices
persist per browser.

- Each unit becomes a centred stack: English; a gilt hairline as wide as the English phrase; the
  original (`--lapis`, Greek 0.86em, Hebrew 1.02em RTL); optional transliteration, gloss (italic
  `--ink-3` 0.64em), form (`.mono` 0.6em) and Septuagint lines.
- Punctuation attaches to the preceding English; an opening quotation mark to the next unit.
- Hebrew morphemes of one written word are joined; morpheme glosses joined (§6.6).
- An original word already shown earlier in the same verse is shown again at 45% opacity.
- Supplied words: English italic, "—" in `--ink-3` beneath. Unlinked words: English only, the
  original line left empty so baselines stay aligned.
- Verse numbers are small rubric numerals at the top of their own stack.
- Headings, paragraph breaks and verse-per-line structure are kept; the initial is suppressed; the
  title shrinks to 46px.
- Hover, keyboard and card behaviour are identical to reading mode. The anchor is an inset 2px rubric
  bar under the stack; kin is a 75% `--kin` bar; linked is the wash.

```css
.para--il { line-height: 1.2; text-indent: 0 !important; }
.il { display: inline-flex; flex-direction: column; align-items: center; vertical-align: top;
      margin: 0 0.06em 0.85em 0; padding: 0.12em 0.22em 0.18em; border-radius: 5px; }
.il__en { white-space: nowrap; line-height: 1.3; }
.il__or { margin-top: 0.22em; padding-top: 0.2em; min-width: 100%; text-align: center; white-space: nowrap;
          border-top: 1px solid color-mix(in srgb, var(--gilt) 45%, transparent); color: var(--lapis); font-size: 0.86em; line-height: 1.35; }
.il__or:lang(hbo) { font-size: 1.02em; line-height: 1.3; }
.il__or.is-repeat { opacity: 0.45; }
.il__tr { font-size: 0.6em; color: var(--ink-2); white-space: nowrap; }
.il__gl { margin-top: 0.08em; color: var(--ink-3); font-size: 0.64em; font-style: italic; line-height: 1.2; white-space: nowrap; }
.il.w.is-linked, .il.w.is-preview { box-shadow: none; }
.il.w.is-anchor { text-decoration: none; box-shadow: inset 0 -2px 0 var(--rubric); }
.il.w.is-kin:not(.is-linked) { text-decoration: none; box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--kin) 75%, transparent); }
.il .vn { top: 0; font-size: 0.62em; line-height: 1.9; }
```

### 6.9 Search panel and results

Opens from the search field (desktop: a panel hanging under the field, right-aligned to the
masthead, 760px wide, max-height `min(78vh, 760px)`, `.surface-card` with `--r-panel` and
`--shadow-panel`; phone: full screen with a sticky bar "‹ [query] ✕").

1. **Count line**: "**648** verses *contain* love, loving, loved, loves *or 2 more forms*" (28px
   lining number) and the translation searched.
2. **Scope chips**: Whole Bible / Old Testament / New Testament / This book, each with a count;
   "Exact word" `.switch` with its count.
3. **Distribution ribbon**: 66 bars (OT `--chart-ot`, NT `--chart-nt`, empty books a 1px
   `--chart-zero` tick), Malachi | Matthew divider, the top book in each testament labelled with its
   count, axis labels in small caps. `role="img"` with an `aria-label` summary ("Most in Psalms
   (162) and John (39)"); bar `title` tooltips; clicking a bar filters to that book.
4. **Behind the English** (`.label-sc`, note "search the original word instead"): chips of the
   lemmas the hits translate: original (Greek/Hebrew 18-21px), transliteration italic, count pill.
   Activating one runs a Strong's search.
5. **Results**: reference (rubric small caps) with the lemma tag(s) right-aligned (`--lapis`,
   "ἀγαπάω ×2"); the verse in `--f-read` 18px; hits on the `--hl` wash, and in manual / Strong's
   translations the original form set under each hit (`--lapis` 13px; omitted for bridged
   translations). When one verse's hits map to different lemmas, flag it in `--gilt-ink` italic:
   "Two different words behind one English word" (John 21:15 ἀγαπάω / φιλέω).
6. **Footer**: "Show all N verses ›" (full results page in the folio, 50 per page) and key hints
   (↑ ↓ move, ↵ open, esc close).

At >= 1100px the body becomes two columns: Behind the English as a 240px facet list (lemma, gloss,
Strong's, count with a thin bar) on the left, results on the right (Scholar graft).

**Query types**: words and "quoted phrases"; references ("jn 3:16" puts "Go to John 3:16 ↵" as the
first row); Strong's ("G3056", "H430"); Greek/Hebrew lemmas or transliterations (autocomplete from
`lex/index.json`).

**States**: empty query: hints "Try λόγος · H430 · Jn 3:16 · "living water"" and recent searches;
first search in a translation: "Preparing the KJV search index…" with an indeterminate gilt bar;
no results: "No verses contain “xyzzy” in the KJV." + suggestions (other translation, original
word); error: notice with "Try again".

### 6.10 Settings sheet

Desktop: drawer from the right, 400px, full height, `.surface-card` without the inner ruling, with
`--overlay` scrim; focus trapped; Esc closes. Phone: bottom sheet 92vh. Groups with `.label-sc`
headings, rows 48px:

- **Appearance**: Theme (System / Vellum / Candlelight; segmented); Reading face (EB Garamond /
  Literata, each option set in its own face); Text size (S M L XL with a one-line preview).
- **Reading**: Layout (Paragraphs / Verse per line); Section headings; Verse numbers; Illuminated
  initials; Words of note in the margin.
- **Original languages**: Open word card on hover (off = click or tap only); Transliteration;
  Morphology codes; Mark related words (kin).
- **NIV and other API.Bible translations**: status (Connected / Not connected), key field (masked,
  "Show" toggle), Connect / Remove key, note "Stored only in this browser. Sent only to
  api.scripture.api.bible."
- **Data**: data version and date from `meta.json`; "Clear downloaded data".
- Footer: "About and credits", "Keyboard shortcuts".

Theme / face / size are attributes on `<html>`: `data-theme` (absent = System), `data-face`,
`data-size`. Apply them before first paint (inline script in `index.html`) to avoid a flash; also
set `<meta name="color-scheme" content="light dark">` and `theme-color` (#ece2cc / #15110d).

### 6.11 About and credits page

Route `#/about`, rendered in the folio with the reading typography, no marginalia:
title block (eyebrow "About", title "Rootword"); rubric sections:
1. *What Rootword is*: one paragraph.
2. *How the links are made*: the translations table (abbreviation, name, year, licence, meter and
   explanation: hand-aligned by Clear Bible; KJV's own Strong's tags; approximate through the BSB).
3. *The original texts*: SBLGNT; WLC with Macula Hebrew; the Septuagint equivalents.
4. *Credits and licences*: every `meta.credits` entry as a ruled list: name (`--ink`), licence in
   small caps (`--gilt-ink`), link, note in italic. Licensing statements must match CLAUDE.md.
5. *The NIV*: copyrighted by Biblica, never bundled, fetched only with the reader's own key.
6. *Privacy*: no accounts, no tracking; the key stays in this browser.
7. *Version*: data version and generation date.

### 6.12 Empty, loading and error states

| situation | presentation |
|---|---|
| chapter loading | title block renders at once from `books.ts`; after 150ms (never for cached chapters) six `.skeleton-line`s of varying width in the text column |
| card loading | see §6.6; skeleton lines in the definition area |
| chapter failed | `.notice` in the text column: warning icon, "This chapter didn't load." + `btn` "Try again" |
| offline | the same notice: "You're offline. Chapters you've opened before still work." |
| translation lacks the book / remote failure | notice, then fall back to the KJV with a toast "Showing the KJV instead" |
| unknown route / reference | folio titled "Not found" with the Go-to field and suggestions |
| search empty / none / error | §6.9 |
| NIV states | §6.3 |
| transient confirmation | toast: `--ink` pill with `--page` text, bottom centre (above the dock on phones), 2.4s, `role="status"` |

```css
.notice { display: flex; gap: var(--s3); align-items: flex-start; margin: 0 0 var(--s5); padding: var(--s3) var(--s4);
  border: 1px solid var(--rule-strong); border-left: 3px solid var(--danger); border-radius: var(--r-sm);
  background: var(--card); color: var(--ink-2); font-size: var(--fs-small); }
.toast { position: fixed; left: 50%; bottom: calc(var(--s6) + env(safe-area-inset-bottom)); transform: translateX(-50%);
  z-index: var(--z-toast); padding: var(--s2) var(--s4); border-radius: var(--r-pill); background: var(--ink); color: var(--page);
  animation: rw-rise-in var(--dur-2) var(--ease-out); }
```

---

## 7. Implementation notes (Preact)

- Render a chapter once per (translation, book, chapter). Never re-render it on hover: after
  render, build `Map<origIndex, HTMLElement[]>` and `Map<strongsBase, HTMLElement[]>` from the units'
  `data-o` / `data-s` attributes and toggle `.is-preview / .is-linked / .is-anchor / .is-kin`
  imperatively. Keep the open-card state in one signal (`{ unit, pinned, tab }`).
- Delegate `pointerover` / `pointerout` / `click` / `keydown` on `.reading`.
- Only `base.css` is global. Component CSS uses tokens only; no raw colours except the fixed
  gradients already in tokens.
- Toggle `.scroll-lock` on `<body>` for full-screen search and modal sheets.
- Prefer `color-mix()` over new tokens for one-off tints (supported by the browsers we target).
- The specimen used to validate this spec lives only in the build scratchpad; its renders are
  `design/screenshots/system-*.png`.

## 8. Data notes surfaced by the concepts

- NFC-normalise Greek (Macula LXX values use oxia U+1F79 and carry typos such as `ἀρξῇ` for ἀρχῇ,
  `ξλόης` for χλόης).
- LXX Strong's values can be just "G": hide the pill.
- Macula splits glosses across morphemes ("he" + "makes.me.lie.down"); join per written word for
  display and drop "(et)".
- Contract gaps (no change made): `TextChapter` has no poetry line structure (BSB has q1/q2 lines),
  no parallel references for headings, and no per-chapter copyright line for remote translations.

## 9. Screenshot index (`design/screenshots/`)

- `<concept>-desktop-{default,hover,hover-ot,interlinear,search}.png` (vellum / light)
- `<concept>-desktop-dark-{default,hover,hover-ot,interlinear,search}.png`
- `<concept>-mobile-{default,hover}.png` (390x844 at 2x)
- `system-light.png`, `system-dark.png` (full-page specimen built from `base.css`: chrome, title
  block, initial, word states, Greek and Hebrew cards, supplied and approximate cards, interlinear,
  controls), `system-os-dark.png` (no `data-theme`, OS dark), `system-literata.png`,
  `system-mobile-sheet.png`, `system-mobile-dock.png`.
