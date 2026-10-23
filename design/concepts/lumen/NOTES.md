# Lumen: light through stained glass

## The concept in five sentences

Lumen treats the page like the floor of a nave at dusk: a deep indigo night (or warm limestone in
Daylight) where coloured light falls through glass onto the text. Every chapter opens under a small
leaded **lancet window**. Its quarry-glass mosaic is generated per book, and its gold medallion holds
the chapter number, casting a faint beam of lapis, gold and ruby across the title. The reading
column stays calm and typographic: Literata at 21px with generous leading, no underlines at rest, and
quiet gold verse numbers. When you touch a word it is *lit*: it glows gold, every English word tied to
the same original word lights with it, and a card opens directly beneath the line. In that card the
Greek (lapis) or Hebrew (ruby) word appears large and glows briefly as it is revealed. Jewel colours
always carry meaning: **lapis = Greek / New Testament**, **ruby = Hebrew / Old Testament**,
**gold = light / attention / "you are here"**. Decoration is limited to the window and the light it
casts.

Files: `index.html` (shell), `lumen.css` (tokens + components), `lumen.js` (rendering + interaction),
`lexicon.js` (placeholder definitions, real occurrence counts, Robinson/OSHB parsers, Greek
transliteration, search sample), `shoot.mjs` (Playwright screenshots + interaction checks), `shots/`.

## Demo states (deterministic, combinable)

| URL | State |
|---|---|
| *(none)* | follows the OS theme; John 1:1–5, reading mode |
| `?theme=dark` / `?theme=light` | force Night / Daylight |
| `?demo=hover` | card pinned on "Word" (John 1:1) |
| `?demo=hover-ot` | Genesis 1 + Psalm 23; card on "God" (Gen 1:1), with Hebrew and its Septuagint Greek |
| `?demo=phrase` / `?demo=phrase-ot` | multi-word link: "the beginning" → ἀρχῇ / "In the beginning" → בְּ + רֵאשִׁית |
| `?demo=interlinear` / `?demo=interlinear-ot` | interlinear (the OT variant turns on the Septuagint line) |
| `?demo=search` | search panel open for "love" |
| `?demo=books`, `?demo=translations` | passage picker / translation picker (with "NIV · Connect") |
| `?demo=supplied`, `?demo=note` (+`passage=ot`) | translator-supplied word card / footnote card |

Demo states render without entrance motion (`.demo-still`). Motion resumes on the first pointer or key
event. `html[data-ready="1"]` marks the moment a state is fully rendered.

## Colour tokens

All colours are CSS custom properties on `:root[data-theme=…]`. Text pairs were checked with a WCAG
script, and the lowest pair in each theme is noted below. All pairs pass AA (4.5:1).

| Token | Daylight | Night | Use |
|---|---|---|---|
| `--bg` | `#f5f1e8` limestone | `#0a0d1c` night indigo | page |
| `--bg-2` | `#ede7da` | `#11152b` | recessed areas |
| `--panel-solid` | `#fffdf8` | `#151a36` | cards, sheets |
| `--panel` | `rgba(255,253,248,.965)` | `rgba(19,24,51,.955)` | glass popovers (with blur) |
| `--panel-border` | `rgba(43,38,92,.13)` | `rgba(173,186,255,.16)` | 1px borders |
| `--hairline` | `rgba(43,38,92,.10)` | `rgba(173,186,255,.11)` | dividers |
| `--ink` | `#1c1a35` (14.9:1) | `#ece9f7` (16.2:1) | body text |
| `--ink-2` | `#45425f` (8.5:1) | `#c4c1dd` (11.1:1) | secondary text, definitions |
| `--ink-3` | `#625f7c` (5.4:1) | `#9d9bbd` (7.2:1) | labels, meta |
| `--ink-sup` | `#5c5975` (5.9:1) | `#a9a6c8` (8.3:1) | supplied words (italic) |
| `--lapis` / `--lapis-ink` | `#2a4cb0` | `#8fb0ff` / `#a9c1ff` | Greek, NT, links, focus |
| `--ruby` / `--ruby-ink` | `#a51f3d` / `#9c1d3a` | `#ff8fa3` / `#ffadbb` | Hebrew, OT |
| `--gold` | `#8a5a00` (5.3:1, text-safe) | `#f0c46c` | verse numbers, section heads |
| `--gold-fill` | `#d9a43c` | `#e3ad48` | ticks, active chips, rules |
| `--lapis-soft` / `--ruby-soft` / `--gold-soft` | 8–16% tints | 12–14% tints | chips, card washes |
| `--lit-bg` / `--lit-bg-strong` | gold 26% / 40% | gold 17% / 28% | lit word / active word |
| `--lit-line` | `#b07a0c` | `#f0c46c` | 2px underline of a lit word |
| `--lit-ink` | `#1c1a35` | `#fff5df` | lit word text (11.8:1 / 9.3:1) |
| `--lit-glow` | none | `0 0 14px rgba(240,196,108,.55)` | text glow of lit words (Night only) |
| `--echo-line` | gold 75% | gold 60% | dotted underline: same lemma elsewhere |
| `--came` | ink 16% | periwinkle 18% | interlinear "lead came" under each English unit |
| `--lead` / `--frame` | `#2b2840` / `#cfc6b3` | `#05060f` / `#2a2f52` | window leading / stone frame |
| `--focus` | `#2a4cb0` | `#a9c1ff` | 2px focus ring, 2px offset |
| `--chart-ot` / `--chart-nt` | `#a51f3d` / `#2a4cb0` | `#e0506e` / `#5a82ee` | search distribution strip (validated for CVD) |
| `--pool-a/b/c`, `--beam-*` | 8–16% lapis/ruby/gold | 8–16% | the light pools and the chapter beam |

Glass colours for the windows are fixed three-stop ramps (dark, mid, light): lapis
`#1b3594 #3f6ae6 #a7c0ff`, ruby `#7d1027 #d23a58 #ffa4b4`, gold `#a5680c #eab045 #fff0c2`,
emerald `#0b5a45 #22a07a #a6f2d6`, violet `#2e1f7a #6a4ee0 #cfc2ff`. Each book gets three of them
(John: lapis/ruby/gold, Genesis: emerald/lapis/gold, Psalms: ruby/violet/gold).

## Type

| Role | Face | Size / line-height |
|---|---|---|
| Reading text | Literata (variable, optical size auto) | 21px / 1.8 desktop; 19px / 1.75 at ≤720px; measure 34em (~66 ch) |
| Chapter title | Literata 340, opsz 72 | 60px / 1 (44px mobile; ×0.7 in interlinear) |
| Chapter subtitle | Literata italic | 16px, flanked by gold hairlines |
| Overline, section heads, labels | UI sans (Inter → system-ui), 600–700, caps, +0.14–0.22em | 11–13px |
| Verse numbers | UI sans 650, tabular, gold, raised .62em | 0.56em of the text |
| Greek | Gentium Book Plus | card hero 44px; interlinear 20px; inline 1.04em |
| Hebrew | Frank Ruhl Libre 500, RTL, isolated | card hero 50px; interlinear 23px; cantillation stripped, vowels kept |
| Transliteration | Gentium Book Plus italic | 18px in the card |
| UI controls | UI sans 600 | 13–14px |

Scale (rem): .6875 · .75 · .8125 · .875 · 1 · 1.125 · 1.3125 (reading) · 2 · 3.75.
The divine name renders in small caps (`LORD` → <span style="font-variant:small-caps">Lord</span>).
Italics are reserved for supplied words, the superscription and subtitles.

## Space, shape, elevation

- Spacing: 4px base. Steps are 4, 8, 12, 16, 24, 32, 48, 64 and 96px. The page grid is
  `1fr | minmax(0, 42rem) | 1fr`, and the right margin holds the sticky reading key at ≥1240px.
- Radii: 6 (chips, kbd), 10 (controls), 16 (cards, popovers), 22 (mobile sheets), pill (999).
- Header: 64px (56 mobile), translucent `--bar-bg` with blur(16px). Its bottom edge is a 1px
  lapis → ruby → gold strip at 45% (a band of leaded glass).
- Cards: solid `--panel-solid` with a 140px wash of the language colour at the top. The 1px glass
  edge is a gradient border (accent → hairline → gold) drawn with a mask. Shadow is `--shadow-card`
  (in Night it includes a faint lapis halo).

## The key interaction

**At rest.** Linked words carry no decoration. Hovering a word gives it a soft gold tint, and the
cursor shows that it can be clicked. Words supplied by the translators (TokenInfo `i: 1`, KJV italics)
are italic in `--ink-sup` with no hover tint. Focusing one gives a hairline underline, and its card
explains why the word was supplied.

**Units.** Consecutive English tokens with an identical link set form one unit. So "the beginning"
is a single span that is lit, focused and announced as one (`box-decoration-break: clone` keeps it
whole across a line break). Punctuation ends a unit.

**Lighting.** Opening a word sets three classes:
- `active`: the word itself, with the strong tint and, in Night, a glow;
- `lit`: every unit linked to any of the same original word ids (e.g. Gen 1:3 "light" … "and");
- `echo`: a dotted gold underline under units elsewhere in view with the same Strong's number
  (λόγος ×3, θεόν/θεὸς ×3). This is skipped for very common words (more than 5,000 occurrences, such
  as ὁ and καί).

**Hover intent.** The card opens 120ms after the pointer enters a word, or 40ms when moving between
words while a card is open. It closes 280ms after the pointer leaves both the word and the card, so the
pointer can travel into the card. A click or tap *pins* the card; a second click, Esc or a click
outside closes it.

**Placement (desktop/tablet).** The card goes directly **below the line being read**, never over it:
12px under the word's last line box, with a notch pointing at the word's centre. It is left-aligned
near the word and clamped 12px from the viewport edges.
- A hover card that does not fit below flips **above** the word's first line.
- A card the reader asked for (click, Enter, tap) scrolls the page just enough to fit below, as long
  as the word stays below the header.
- If neither works, the card takes the larger side and scrolls inside (`max-height`).

**Card anatomy, top to bottom:**
1. Language gem and label (GREEK, HEBREW), reference, Strong's chip, close button.
2. The original word in large type, glowing as it is revealed. Hebrew sits on the right, RTL;
   prefixes such as בְּ and הַ are set at 62% opacity.
3. Transliteration, and *as “English phrase”*, plus "· N English words" for multi-word links.
4. Morpheme or word breakdown chips when several originals are linked (בְּ *in · preposition* +
   רֵאשִׁית *beginning · noun*). The main morpheme is outlined.
5. Facts: **Parsing** (plain language from Robinson/OSHB codes, e.g. "Noun · nominative masculine
   singular", "Verb · Qal sequential imperfect (wayyiqtol), 3rd masculine singular"), **Dictionary**
   form (λόγος, -ου, ὁ) and **Gloss**.
6. For Hebrew: a lapis **Septuagint** tile with the LXX form, its transliteration and Strong's number.
7. A definition excerpt, clamped to 3 lines.
8. A footer with "See all N occurrences →" and "N in this passage".

The main morpheme is chosen by part of speech: verb or noun, then adjective, then others, then
pronominal suffix, then prefix or article. The object marker אֵת comes last.

**Mobile (≤720px).** The card becomes a bottom sheet: full width, radius 22, grab handle, at most 72vh,
rising 24px on entry. The page scrolls so the tapped word sits just above the sheet. The header
collapses to wordmark + search + theme. Passage, translation, interlinear toggle and previous/next
chapter move to a floating bottom **dock**. Popovers become sheets, and search becomes full-screen.

**Keyboard and assistive technology.**
- The text is one tab stop (roving `tabindex`). ←/→ (and ↑/↓) move word by word, Home/End jump, and
  Enter or Space opens a pinned card.
- With a card open, the arrow keys walk it from word to word. Tab moves into the card's actions, Tab
  from the last action returns to the word, and Esc closes the card and restores focus.
- Words are `role="button"` with `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls="card"` and
  `aria-describedby="cardSum"`. The summary reads, for example: "λόγος, logos: “word”. Noun,
  nominative masculine singular. Strong’s G3056."
- Cards opened by keyboard or touch also announce that summary in a polite live region.
- Focus is shown everywhere as a 2px `--focus` ring.

**Motion.**
- Card entrance: 220ms fade and 6px slide.
- The original word's reveal: 900ms, blur(5px) → sharp with a 34px glow peaking at 45%, settling to the
  resting glow (Night only).
- Highlights: 180ms colour transitions.
- Under `prefers-reduced-motion: reduce` every animation and transition is 1ms and the reveal is
  removed (verified: `animation-name: none`).

## Interlinear

Each unit becomes an inline column, wrapping as ordinary flowing text. From top to bottom:
1. English (17px), underlined by a 1px **came** line, the lead strip that joins it to its original.
2. The original word: Greek in lapis, Hebrew in ruby, glowing faintly in Night.
3. Optional lines: Septuagint (OT, labelled LXX), transliteration, gloss (on by default) and raw
   parsing code.

Further rules:
- Punctuation attaches to the neighbouring English. Opening quotes attach to the next unit.
- Hebrew morphemes of one written word are joined (בְּרֵאשִׁית). Glosses that the source splits
  across morphemes are joined too ("he" + "makes.me.lie.down").
- An original word already shown earlier in the verse is shown again at 45% opacity, not repeated at
  full strength.
- Poetry keeps its line breaks.
- The chapter heading shrinks (window 46px, title ×0.7) so more of the text is in view.
- Hover, keyboard and card behaviour are identical to reading mode.

## Search glimpse

The search dropdown hangs from the header field (620px wide on desktop), and the page behind it
recedes (38% opacity, 1.5px blur). It contains:
- result counts and chips for All / Old Testament / New Testament;
- **Behind the English**: tiles for the original words that "love" translates (חֶסֶד, ἀγαπάω,
  ἀγάπη, אָהַב, φιλέω), each with a ruby or lapis edge, transliteration, gloss, Strong's number and
  count;
- **Where it appears**: a 66-bar distribution strip (OT ruby / NT lapis, 2px gaps, rounded ends,
  per-bar tooltip, direct label on the Psalms peak "mostly ḥesed");
- verse results with the matched word highlighted like a lit word and the original form beside the
  reference. John 21:15 is flagged "Two different verbs behind one English word".

The verse counts (618 verses / 710 matches, per book) and the lemma counts are real, computed from
the BSB USFX and SBLGNT/WLC in `.cache/sources/`. Other queries search the sample passages live.

## The lancet window (chapter heading)

The window is an inline SVG, 96×170 units, rendered at 70px wide (46px on mobile and in interlinear).
- Shape: an equilateral pointed arch with a 7px stone frame.
- Glass: a diamond quarry mosaic (15-unit cells). Each pane's colour is drawn from the book's three
  glass ramps by a seeded PRNG, with the secondary colour dominant above the springline.
- Border and leading: an 11-unit border band in the third colour. Leads are 0.85–3 units in `--lead`.
- Ornaments: an oculus with cross leads, and a pale-gold medallion holding the numeral in Literata 650
  `#3a2503`.
- Light: a sheen gradient over the glass. In Night, a `drop-shadow` glow in lapis and ruby. The beam
  below is a blurred, masked trapezoid in `--beam-*` colours, kept behind the text with
  `pointer-events: none`.

## Notes for the data pipeline and the real build

- Some LXX forms in `design/sample.json` carry typos (`ἀρξῇ` → ἀρχῇ, `ξλόης` → χλόης) and use oxia
  code points (U+1F79) instead of tonos. The concept normalises with NFC and patches the two typos
  for display. The pipeline should NFC-normalise Greek and check these Macula LXX values.
- Macula splits glosses across morphemes, e.g. "he" on the verb and "makes.me.lie.down" on the suffix.
  Join them per written word for display, and drop `(et)`, the object marker.
- LXX Strong's values sometimes lack a number (`ἀκατασκεύαστος|G`); the concept hides the chip.
- In the BSB sample, Ps 23:1 "is" and Gen 1:2 "was" are aligned to neighbouring Hebrew words. The
  concept shows them as supplied (their Macula glosses are bracketed: "[is]", "[was]") to demonstrate
  the KJV-italics style. In production, only `TokenInfo.i` should drive it.
- The default translation in the product is the KJV (CLAUDE.md). The concept shows BSB as active only
  because the sample data is BSB; KJV is listed first in the picker.
