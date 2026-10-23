# Rootword — Bible reader with Greek & Hebrew

Static website: read/search the Bible in several translations; hovering an English word shows the
Greek (NT) or Hebrew (OT) word behind it, with a definition. See docs/ARCHITECTURE.md.

**The app is named Rootword** (owner's choice): use it for the wordmark, page title, README and About page.
Never call it "Logos" (that is an existing Bible software brand).

**The design is "Scholar"** (owner's choice; see design/concepts/scholar/ and its NOTES.md): an
editorial, critical-edition look. It must ship with BOTH a light and a dark theme of equal polish,
a theme toggle (light / dark / follow system) that is remembered per browser, and no flash of the
wrong theme on load. Grafts from other concepts are fine only where they fit Scholar's language.

**Hyper mobile-friendly and accessible** (owner's brief): docs/EXPERIENCE.md is binding for every UI
change — screen-size matrix, the touch model (tap → bottom sheet, press-and-slide scrubbing as the
touch version of hover), haptic + audible feedback (src/lib/feedback.ts), pronunciation and
listen mode, WCAG 2.2 AA, reduced motion / high contrast / forced colours, motion tokens, PWA.

**The KJV is the default translation** (owner's decision): it opens first, is listed first in
`meta.json` and every translation picker, and is the fallback whenever a saved/linked translation is
unavailable. Its Greek/Hebrew links (via the KJV's own Strong's tags) therefore get the most
scrutiny: every tagged KJV word should resolve to an original word or at least a lexicon entry.
The BSB (hand-aligned word for word) is offered second as the most precise alignment.

## Commands
- `npm run dev` — Vite dev server
- `npm run build` — typecheck + production build to dist/
- `npm test` — Vitest unit tests (tests/)
- `npm run e2e` — Playwright tests (e2e/); Chromium is preinstalled at /opt/pw-browsers
- `npm run data:fetch` — download raw sources to .cache/sources/ (Node fetch needs `NODE_USE_ENV_PROXY=1` behind a proxy)
- `npm run data:build [-- stage ...]` — regenerate public/data/ (stages: orig bsb kjv bridged redletter concordance lexicon xrefs names wordstudy search meta validate)

## Conventions
- `src/lib/types.ts` is the contract for every generated JSON file. Change it only deliberately and
  update every producer/consumer in the same change.
- `src/lib/` is framework-free TypeScript; modules marked "shared" there are also imported by the
  Node pipeline (`scripts/`), so they must not touch the DOM or `window` at import time.
- Pipeline stages live in `scripts/data/<stage>.ts`, export `build<Stage>()`, read only from
  `.cache/sources/` or earlier stages' output in `public/data/`, and log a one-line summary.
- Generated data (public/data/) is NOT committed (it is ~100 MB and changes wholesale on every rebuild).
  Run `npm run data` once after cloning; CI runs it on every deploy (raw sources cached between runs).
- Never put API keys in the repo, the build, tests or fixtures. Runtime keys (API.Bible for the NIV)
  are typed by the user into Settings and stored only in their browser (localStorage); tests use
  obviously fake keys like `test-key`.
- TypeScript strict mode; no `any` without a comment saying why.
- Prefer small pure functions with unit tests in `tests/` mirroring `src/lib/` paths.
- UI: Preact function components + @preact/signals; CSS lives in `src/styles/` (design tokens as
  CSS custom properties) and per-component CSS files next to components.

## Licensing (must stay accurate in the About page and README)
BSB text: public domain. BSB↔Greek/Hebrew alignments: Clear-Bible/Biblica, CC BY 4.0.
SBLGNT: CC BY 4.0. WLC: public domain; Macula Hebrew: CC BY 4.0. STEPBible lexicons: CC BY 4.0.
Strong's dictionaries, KJV (incl. the OSIS red-letter markup), WEB, ASV, YLT: public domain.
Cross references: OpenBible.info, CC BY. People & places (TIPNR): STEPBible, CC BY 4.0.
NIV is copyrighted (Biblica) and is never bundled — only fetched at runtime with the user's own
API.Bible key.
