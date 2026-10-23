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
| `route` | `Route` | parsed hash (`read` / `about` / `search` / `notfound`), set by the router |
| `passage` | `{ tr, ref: VerseRef }` | the chapter being read (kept while on `#/about` or `#/search`) |
| `theme` | `'light' \| 'dark' \| 'system'` | persisted in localStorage `rootword:theme` (index.html applies it before first paint) |
| `readingMode` | `'reading' \| 'interlinear'` | persisted `rootword:mode` |
| `fontScale` | `number` (0.8–1.5) | reading text size multiplier → CSS `--font-scale`; persisted `rootword:fontScale` |
| `settings` | `Settings` | reader preferences, persisted as JSON in `rootword:settings` (see below) |
| `activeWord` | `WordRef \| null` | word under the pointer / keyboard focus (card shown as tooltip) |
| `pinnedWord` | `WordRef \| null` | word whose card is pinned (dialog / bottom sheet); wins over `activeWord` |
| `searchOpen` | `boolean` | the search panel is open |
| `searchQuery` | `string` | text of the header search field (two-way) |
| `settingsOpen` / `settingsSection` | `boolean` / `string \| null` | settings sheet open, optional section to scroll to (e.g. `"niv"`) |
| `toastMessage` | `string \| null` | current toast (use `showToast`) |
| `liveMessage` | `string` | polite live region text (use `announce`) |

`WordRef = { key: "TR/BOOK/CHAPTER", unit: number, via: 'hover' | 'focus' | 'click' | 'touch' | 'keyboard' }`
— `unit` is the index of the word unit in the reader's chapter model (the `data-u` attribute).

## Common tasks

**Navigate to a reference**

```ts
import { navigate, setTranslation, goToHash } from '../app/state';
navigate({ book: 'JHN', chapter: 3, verse: 16 });          // current translation; scrolls to + highlights 3:16
navigate({ book: 'PSA', chapter: 23 }, 'BSB');              // another translation
navigate(ref, tr, { replace: true });                       // without a history entry
setTranslation('WEB');                                      // same chapter, other translation
// or build links: href={refToHash(tr, ref)} from src/lib/reference.ts
```

Routes: `#/{TR}/{BOOK}/{CHAPTER}[/{VERSE}[-{END}]]`, `#/about`, `#/search?q=…&tr=…`
(`parseRoute` / `routeToHash` in `router.ts`). Unknown translations fall back to the KJV.

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

Other persisted keys: `rootword:theme`, `rootword:mode`, `rootword:fontScale`, `rootword:last`
(last chapter read). Use `src/app/storage.ts` (`readJson` / `writeJson`, exception-safe) for new ones.

**Open the settings sheet**: `openSettings('niv')` (the translation picker's "Connect" row does
this) / `closeSettings()`; the sheet component is `src/components/settings/SettingsSheet.tsx`.

**Other actions**: `closeWord()`, `showToast(message)`, `announce(message)`.

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
