# Logos — Bible reader with Greek & Hebrew

Static website: read/search the Bible in several translations; hovering an English word shows the
Greek (NT) or Hebrew (OT) word behind it, with a definition. See docs/ARCHITECTURE.md.

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
- `npm run data:build [-- stage ...]` — regenerate public/data/ (stages: orig bsb lexicon concordance kjv bridged search meta validate)

## Conventions
- `src/lib/types.ts` is the contract for every generated JSON file. Change it only deliberately and
  update every producer/consumer in the same change.
- `src/lib/` is framework-free TypeScript; modules marked "shared" there are also imported by the
  Node pipeline (`scripts/`), so they must not touch the DOM or `window` at import time.
- Pipeline stages live in `scripts/data/<stage>.ts`, export `build<Stage>()`, read only from
  `.cache/sources/` or earlier stages' output in `public/data/`, and log a one-line summary.
- Generated data is committed (public/data/) so the site works without running the pipeline.
- TypeScript strict mode; no `any` without a comment saying why.
- Prefer small pure functions with unit tests in `tests/` mirroring `src/lib/` paths.
- UI: Preact function components + @preact/signals; CSS lives in `src/styles/` (design tokens as
  CSS custom properties) and per-component CSS files next to components.

## Licensing (must stay accurate in the About page and README)
BSB text: public domain. BSB↔Greek/Hebrew alignments: Clear-Bible/Biblica, CC BY 4.0.
SBLGNT: CC BY 4.0. WLC: public domain; Macula Hebrew: CC BY 4.0. STEPBible lexicons: CC BY 4.0.
Strong's dictionaries, KJV, WEB, ASV, YLT: public domain. NIV is copyrighted (Biblica) and is
never bundled — only fetched at runtime with the user's own API.Bible key.
