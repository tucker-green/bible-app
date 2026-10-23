# App state & routing — API for other components

All global UI state lives in `src/app/state.ts` as [@preact/signals](https://preactjs.com/guide/v10/signals/).
Read `signal.value` inside a component to subscribe; write `signal.value = …` or call the actions
below. Importing `state.ts` has no side effects; `main.tsx` calls `initState()` (applies theme /
font scale to `<html>`, persists changes) and `startRouter()`.

## Signals

| signal | type | notes |
|---|---|---|
| `meta` | `DataMeta \| null` | `public/data/meta.json` once loaded (`metaError` on failure) |
| `translations` | `computed<TranslationMeta[]>` | picker order: meta.json order (KJV first), then remote ones |
| `remoteTranslations` | `TranslationMeta[]` | runtime translations (NIV…) — use `registerRemoteTranslation` |
| `route` | `Route` | parsed hash, set by the router: `read`, `about`, `search`, `word`, `person`, `place`, `lineage`, `compare`, `study`, `notfound` (see `Route` in router.ts) |
| `passage` | `{ tr, ref: VerseRef }` | the chapter being read (kept while on `#/about` or `#/search`) |
| `theme` | `'light' \| 'dark' \| 'system'` | persisted in localStorage `rootword:theme` (index.html applies it before first paint) |
| `readingMode` | `'reading' \| 'interlinear'` | persisted `rootword:mode` |
| `fontScale` | `number` (0.8–2) | reading text size multiplier → CSS `--font-scale`; persisted `rootword:fontScale`; the UI steps through `FONT_SCALES` = 0.9 / 1 / 1.15 / 1.3 / 1.6 / 2 |
| `settings` | `Settings` | reader preferences, persisted as JSON in `rootword:settings` (see below) |
| `activeWord` | `WordRef \| null` | word under the pointer / keyboard focus (card shown as tooltip) |
| `pinnedWord` | `WordRef \| null` | word whose card is pinned (dialog / bottom sheet); wins over `activeWord` |
| `searchOpen` | `boolean` | the search panel is open |
| `searchQuery` | `string` | text of the header search field (two-way) |
| `settingsOpen` / `settingsSection` | `boolean` / `string \| null` | settings sheet open, optional section to scroll to (e.g. `"niv"`) |
| `toastMessage` | `string \| null` | current toast (use `showToast`) |
| `liveMessage` | `string` | polite live region text (use `announce`) |
| `verseSheet` | `{ key, verse } \| null` | the open verse sheet (`key` = "TR/BOOK/CHAPTER"); `openVerseSheet(key, v)` / `closeVerseSheet()` |
| `listeningVerse` | `number \| null` | verse being read aloud — the reader highlights it (`.verse.is-listening`) and keeps it in view |
| `panel` / `panelAnchor` | `'books' \| 'translations' \| 'display' \| null` | header / toolbar panel; `openPanel(id, triggerEl)`, `togglePanel`, `closePanel` (focus returns to `panelAnchor.current` when it would otherwise be lost, unless an arrival focus is pending) |
| `arrival` | `{ key, verse?, at } \| null` | keyboard focus to move once a navigation lands: `focusOnArrival(tr, ref)` (the passage and translation pickers call it) → the reader focuses the target verse number, else `#chapter-title` |
| `chromeHidden` | `boolean` | compact top bar (and landscape toolbar) slid away while reading; mirrored to `<html data-chrome>` |

`WordRef = { key: "TR/BOOK/CHAPTER", unit: number, via: 'hover' | 'focus' | 'click' | 'touch' | 'keyboard' }`
— `unit` is the index of the word unit in the reader's chapter model (the `data-u` attribute).

## Common tasks

**Navigate to a reference**

```ts
import { navigate, setTranslation, goToHash } from '../app/state';
navigate({ book: 'JHN', chapter: 3, verse: 16 });          // current translation; scrolls to + highlights 3:16
navigate({ book: 'PSA', chapter: 23 }, 'BSB');              // another translation
navigate(ref, tr, { replace: true });                       // without a history entry
setTranslation('WEB');                                      // same chapter, other translation, same verse on screen
// or build links: href={refToHash(tr, ref)} from src/lib/reference.ts
```

Routes: `#/{TR}/{BOOK}/{CHAPTER}[/{VERSE}[-{END}]]`, `#/about`, `#/search?q=…&tr=…`, and the page
routes below (`parseRoute` / `routeToHash` in `router.ts`). Unknown translations fall back to the KJV;
a translation id in the wrong case (`#/bsb/…`, `&tr=web`) is simply corrected.

`goToHash` never pushes past a bottom sheet's Back marker (`history.state.rwSheet`, see
shell/sheet.ts): it replaces that entry, so Back after following a link from a sheet goes straight
back to the page (in-app `<a href="#/…">` clicks made while a sheet is open are routed through it).

**Keeping the place** (`src/app/place.ts`): every reading history entry remembers the first verse on
screen and its offset below the header in `history.state.rwPos` — written while scrolling (throttled),
before in-app navigations and on `pagehide`, and restored by the reader when the entry is shown again
(Back / Forward, reload, coming back from a page). `setTranslation` hands the place on to the new
entry. Changes that reflow the text (`setFontScale`, `updateSettings` with a layout / font / spacing /
interlinear-line key, the Reading ↔ Interlinear switch) keep the first visible word where it was
(`readerHooks.beforeReflow`; the reader re-checks over a few frames because long chapters lay out
lazily with `content-visibility`).

**Open search with a query**

```ts
import { openSearch, closeSearch, searchQuery, searchOpen, searchKeys, SEARCH_INPUT_ID } from '../app/state';
openSearch('G3056');           // sets searchQuery, opens the panel, closes any word card
closeSearch();                 // also leaves a #/search route
```

The header owns the search `<input id={SEARCH_INPUT_ID}>` (on phones it expands over the header
while `searchOpen`). The search panel (`src/components/search/SearchPanel.tsx`, `id="search-panel"`)
renders the results for `searchQuery.value` and can take over keys typed in the field:

```ts
searchKeys.handler = (e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') { /* move selection */ e.preventDefault(); return true; }
  return false; // default: Enter on a reference ("jn 3:16") navigates, Esc closes
};
```

Give the panel root `id="search-panel"` (and `data-keep-word`): while `searchOpen`, the header closes
the search on a pointer press or keyboard focus outside `.search` / `#search-panel` /
`[data-search-keep]`, and `data-keep-word` keeps clicks inside it from closing a pinned word card.

**Register a remote translation** (e.g. NIV via API.Bible, see `src/lib/providers/apibible.ts`)

```ts
import { registerRemoteTranslation, unregisterRemoteTranslation } from '../app/state';
import { createApiBibleTextSource } from '../lib/providers/apibible';
registerRemoteTranslation(
  { id: 'NIV', name: 'New International Version', abbr: 'NIV', year: '2011', license: '© Biblica',
    alignment: 'bridged', description: '…', source: 'https://api.bible', remote: true },
  createApiBibleTextSource(/* key, bible id … */),
);
unregisterRemoteTranslation('NIV');
```

The translation appears in the picker (after the bundled ones; the "NIV — Connect" row disappears
once an `NIV` is registered) and `#/NIV/…` routes load through the registered source. Register it
synchronously at startup (before `render` in `main.tsx`, e.g. from a saved key) — otherwise a
`#/NIV/…` link opened cold falls back to the KJV once `meta.json` has loaded.

**Read / write settings**

```ts
import { settings, updateSettings, DEFAULT_SETTINGS, theme, setTheme, cycleTheme,
         fontScale, setFontScale, FONT_SCALES, readingMode, setReadingMode } from '../app/state';
settings.value.hoverCards;                // read (subscribes when used in a component)
updateSettings({ markRelated: false });   // write (persisted automatically)
setTheme('dark'); setFontScale(1.1); setReadingMode('interlinear');
```

| `Settings` key | default | meaning |
|---|---|---|
| `hoverCards` | `true` | open the word card on mouse hover (off: click / tap / Enter only) |
| `markRelated` | `true` | dotted underline on words with the same Strong's number while a word is active |
| `ilTranslit` / `ilGloss` | `true` / `false` | interlinear lines under the original |
| `layout` | `'auto'` | `'auto'` (paragraphs when the translation has them, else one verse per line), `'paragraphs'`, `'verses'` |
| `headings` | `true` | section headings (and the contents rail) |
| `morphCodes` | `true` | raw morphology codes (N-NSM) beside the plain-English parsing in the card |
| `readingFont` | `'literata'` | `'atkinson'` / `'opendyslexic'` load their fontsource CSS on demand (`loadReadingFont`) |
| `lineSpacing` / `letterSpacing` | `1` / `0` | multiplier / em, applied as `--line-spacing` / `--letter-spacing` on `<html>` |
| `justify`, `redLetter` | `false`, `true` | `<html data-justify>`, `<html data-red-letter>` |
| `highContrast` | `false` | with `prefers-contrast: more` → `<html data-contrast="more">` (theme.css / a11y.css) |
| `motion` | `'system'` | with `prefers-reduced-motion` → `<html data-motion="reduce\|full">`; use `reducedMotion()` / `scrollBehavior()` in code |
| `swipeChapters` | `true` | swipe left / right on the text changes chapter |
| `haptics`, `sound`, `soundVolume`, `listenRate` | | read by src/lib/feedback.ts and the listen bar |

`index.html` mirrors the same data attributes before first paint (no flash of the wrong motion /
contrast / font). Text size (`fontScale`) has six steps, `FONT_SCALES` = 90 … 200 %
(`stepFontScale(±1)`).

Other persisted keys: `rootword:theme`, `rootword:mode`, `rootword:fontScale`, `rootword:last`
(last chapter read). Use `src/app/storage.ts` (`readJson` / `writeJson`, exception-safe) for new ones.

**Open the settings sheet**: `openSettings('niv')` (the translation picker's "Connect" row does
this) / `closeSettings()`; the sheet component is `src/components/settings/SettingsSheet.tsx`.

**Other actions**: `closeWord()`, `showToast(message)`, `announce(message)`.

## Other app modules

- **`src/app/remote.ts`** — API.Bible translations (NIV…): `initRemoteTranslations()` (startup, from
  the saved connection), `connectApiBible(key)` → the Bibles the key can read, `saveApiBibles(key, …)`,
  `removeApiBible(tr)`, `disconnectApiBible()`; `apiBibleConnection` (never render its key);
  `remoteProblem` (the last chapter that failed: `{ tr, book, chapter, message }`, shown in Settings and
  in the reader's error notice); `explainApiBibleError(err, { what, tr })` (plain-English message).
- **`src/app/study.ts`** — highlights, notes, bookmarks: signals `highlights`, `notes`, `bookmarks`,
  `studyStatus`; actions `setHighlight(key, colour | null)`, `setNote(key, text | null)`,
  `toggleBookmark(key, tr, label?)`, `setBookmarkLabel`, `verseKey(book, chapter, verse)`; export / import (`serializeStudy`, `migrateStudy`,
  `mergeStudy`, `applyStudyImport`). Notes: `MAX_NOTE_LENGTH` for typing, `MAX_STORED_NOTE_LENGTH`
  (twice that) for what loading and merging keep — a merged note is never cut on the next load.
- **Cross references** (`src/components/xrefs/`): `<XrefRail>` (the desktop rail block following the
  reading verse, `useReadingVerse`), `<XrefSection>` in the verse sheet, `followXref()` /
  `goBackXref()` (history-aware, with the "Back to John 3:16" chip `<XrefBack>`),
  `focusVerseAfterRender(tr, ref)`.
- **Search** (`src/components/search/`): the header field is the combobox (`role="combobox"`,
  `aria-activedescendant` from the `searchCombo` signal); `SearchPanel` owns the listbox and drives it
  through `searchKeys.handler`. Esc closes the search and leaves focus on the field (or the search
  button where the field hides) — never on `<body>`.

## Reader internals (for features that touch the text)

- `src/components/reader/model.ts` — `buildChapterModel(text, orig, { alignment, tr })` → units
  (consecutive tokens with the same links), `linkedUnits`, `relatedUnits`, `unitOrigWords`.
- `src/components/reader/render.ts` — the chapter as one HTML string (`<span class="w" data-u>` per
  unit, `<span class="verse" id="v16">` per verse). Rendered once per chapter/mode.
- `src/components/reader/interaction.ts` — `ReaderController`: one delegated listener set on the
  prose element (hover intent, click/tap, roving tabindex, ←/→ ↑/↓ Home/End, Enter, Esc) and the
  imperative word-state classes (`is-active`, `is-linked`, `is-kin`, `is-open`).
- `src/components/word/` — card model, placement math, definition whitelist renderer, `WordCard`.
- The last render timing is on `window.__rootwordRender` and `<html data-render-ms>`.

## Page routes

Each page is code-split (`src/app/pages.tsx` loads it on first visit and shows a skeleton meanwhile)
and default-exports a component that receives the parsed route params (keep the default export and
the props interface). The routed page is wrapped in `RouteBoundary` (App.tsx): a render error shows a
notice in `<main>` and the next route change renders afresh, so the shell never goes blank. Frame
every page with `<PageLayout>`
(`src/components/layout/PageLayout.tsx`: eyebrow, the page's only `<h1>`, lede, back link, document
title, optional `wide` column and `aside` rail).

| route | file | props |
|---|---|---|
| `#/word/{strongsId}` | `src/pages/WordStudyPage.tsx` | `{ id }` — normalised Strong's ("G3056", "H0871a") |
| `#/person/{id}` · `#/place/{id}` | `src/pages/EntityPage.tsx` | `{ kind: 'person' \| 'place', id }` — lower-case entity id ("p0685") |
| `#/lineage/{id}` | `src/pages/LineagePage.tsx` | `{ id }` — person entity id |
| `#/compare/{TR1},{TR2}[,{TR3}]/{BOOK}/{CH}[/{VERSE}]` | `src/pages/ComparePage.tsx` | `{ trs, book, chapter, verse? }` — 2–3 distinct upper-cased ids |
| `#/study` | `src/pages/MyStudyPage.tsx` | none |

Build links with `routeToHash(route)` or `compareHash(trs, book, chapter, verse?)` (router.ts);
`preloadPage('word' | 'entity' | 'lineage' | 'compare' | 'study')` warms a module (the word card's
"Word study →" link does this on hover). Entry points already wired: the word card footer
("Word study →"), the verse sheet ("Compare", Strong's numbers in "Study this verse"), the translation
picker ("Compare side by side"), the Aa panel ("My study", "All settings", "About").

## Verse sheet (src/components/verse/)

Tap / click / Enter on a verse number (`<span class="vn" data-vn role="button">`, part of the reader's
roving focus: ↑/↓ move verse to verse) → `openVerseSheet(key, verse)` → `VerseSheet.tsx`: a bottom
sheet on phones / touch, a right-docked panel on desktop, always a labelled modal dialog (focus
trap, Esc / back button close, focus returns to the verse number). It builds Copy, Share
(`navigator.share`, else the link is copied), Listen from here (`startListening(verse)`), Bookmark
(`bookmarks` in study.ts), Compare (link) and "Study this verse" (every word with its original — the
screen-reader-friendly word study). Section slots, rendered in this order, all with props
`VerseSectionProps = { book, chapter, verse, tr }` (`verse/types.ts`):

| slot | file | owner |
|---|---|---|
| Highlight | `HighlightSection.tsx` (five named swatches writing `highlights`) | personal study |
| Note | `NoteSection.tsx` (a `<NoteEditor>`: autosaving plain-text note) | personal study |
| Cross references | `XrefSection.tsx` (the verse's cross references, grouped, with previews; following one keeps a way back) | cross references |
| Compare translations | `CompareSection.tsx` (the verse in every translation with its alignment meter; a translation without the verse says so and links to the chapter) | compare |

A section renders `<section class="vs-sec" aria-labelledby>` with an `<h3 class="vs-sec__title">`
(the sheet title is the `<h2>`), or `null`.

## Word card slots (src/components/word/)

- `<SpeakButton text lang translit size/>` beside the headword (Greek or Hebrew) and beside the
  Septuagint word (OT).
- `<EntitySection book chapter origIndices/>` (`EntitySection.tsx`: people / place chips with their
  family, linking to the entity pages) inside every card between the facts and the definition;
  `origIndices` = the unit's `OrigChapter.words` indices (`[]` for supplied / lexicon-only words).
- Card kinds (`cardModel.ts`): `linked`, `lexicon` (KJV Strong's tag with no word in the critical text:
  the Textus Receptus note), `supplied`, and `unavailable` (the chapter's Greek / Hebrew didn't load:
  says so, with "Try again", which refetches it and reopens the word).
- The hover / focus card is `role="tooltip"`; opened by keyboard focus it is `inert` (no Tab stops) and
  the word does not point at it with `aria-describedby` (the live region announces a one-line summary).
  Pinned (click / tap / Enter) it is a `dialog` with reachable links and buttons.
- Definitions (`DefText.tsx`): whitelisted `<b>`, `<i>`, `<br>`, verse links, plus Strong's numbers linked
  to their word studies and Greek / Hebrew runs tagged `lang="grc"` / `lang="he" dir="rtl"`
  (`defRuns.ts`). Entries written for Rootword (Hebrew prefixes / suffixes, `LexEntry.src`) are
  labelled as such (never as a STEPBible / BDB definition).
- Footer: "Word study →" (`#/word/{id}`) next to "See all occurrences".

## Reader decorations (applied imperatively; the chapter HTML is never rebuilt for them)

- Highlights / notes / bookmarks: `decorateVerses()` (reader/decorate.ts) follows the study.ts
  signals — `.verse[data-hl="yellow|green|blue|pink|purple"]` (tint + a per-colour underline style),
  a ribbon / note glyph before the verse number and its accessible name ("Verse 16, highlighted
  yellow, bookmarked, has a note").
- Red letter: `TextVerse.wj` ranges → `class="wj"` on the covered units and plain text (model.ts /
  render.ts); coloured only while `<html data-red-letter="on">`.
- Listen mode: `listeningVerse` → `.verse.is-listening` and scroll into view (jump under reduced motion).
- After every chapter render the reader dispatches `window` event `rootword:rendered`
  (`detail: { key }`) — used by the View Transition wrapper (src/app/transitions.ts).

## Shell, touch and motion helpers

- Bottom dock (App.tsx): `<ListenBar/>` stacked above the phone `<Toolbar/>` (fixed at the bottom
  on every size). Its height is `--dock-h` on `<html>`; keep fixed UI clear of it.
- `<html>` state for CSS: `data-chrome="hidden|shown"`, `data-keyboard="open|closed"` (with
  `--vv-h` / `--kb-h` from the VisualViewport API), `class="has-sheet"` (word sheet open,
  `--sheet-visible` = visible sheet height), `class="is-scrubbing"`, `data-vt` (during a View
  Transition), `data-motion`, `data-contrast`, `data-font`, `data-justify`, `data-red-letter`.
- Sheets: `useSheet(ref, { open, onClose, peek, initial, enabled })` + `useBackClose(open, onClose)`
  (src/components/shell/sheet.ts) give any bottom sheet the peek / full / closed detents, the
  velocity-aware spring, inner-scroll handoff and Android-back closing. Use the `.sheet-handle`
  markup with `{...api.handleProps}`.
- Icons beyond common/Icon.tsx: `UiIcon` (src/components/shell/icons.tsx).
- Feedback calls (src/lib/feedback.ts): `select` (tap a word / verse number, swap words), `pin`
  (click / Enter pins a card), `engage` (scrub starts), `tick` (each new word while scrubbing,
  ≤ 1 per 40 ms), `page` (chapter change, from the router wrapper), `success` / `error` (copy,
  share, bookmark, highlight).
- Motion tokens: `--ease-out`, `--ease-spring`, `--dur-1/2/3`, `--stagger` (theme.css); motion
  rules and View Transition keyframes live in src/styles/motion.css.

## QA

The docs/EXPERIENCE.md §7 matrix runs as Playwright tests: `npx playwright test --project=qa`
(e2e/qa/: every viewport × light/dark with touch emulation, axe on every screen, reduced motion,
forced colours, high contrast, 200% text, keyboard reachability); feature flows are in
e2e/features/ (`--project=features`). The older standalone runner is still there:
`node tests/ui/qa/run-qa.mjs --url http://127.0.0.1:PORT/ [--save-key design/screenshots]
[--only iphone15,desktop,modes]` runs the docs/EXPERIENCE.md §7 matrix against a server you start
(layout, tap → sheet, scrubbing, verse sheet, swipe, keyboard, View Transitions, axe, reduced
motion, forced colours, high contrast, 200% text, Psalm 119 timings).
