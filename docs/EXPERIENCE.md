# Rootword — experience spec: mobile, touch, accessibility, feedback, motion

Owner's brief: *hyper mobile friendly* — think through everything from "hovering" on a touchscreen
to how it looks on every screen size; accessibility features; audible and haptic feedback;
animations and effects. This document is binding for every UI change. The visual language is
Scholar (design/concepts/scholar/); this spec decides behaviour.

Guiding rule: **interaction follows the input, layout follows the space.** Use
`(pointer: coarse)` / `(hover: hover)` and live pointer events (`pointerType`) to choose the
interaction model; use container width to choose layout. Never assume phone = touch or
desktop = mouse (iPad + trackpad, touch laptops, foldables, phones with keyboards).

---

## 1. Screen sizes and layout

Design and test at all of these. Nothing may overflow horizontally, overlap, or clip at any of them.

| class | widths (CSS px) | devices | layout |
|---|---|---|---|
| tiny | 280–359 | Galaxy Fold (folded), iPhone SE 1st gen | single column, 16–17px text, 16px gutters, bottom toolbar, compact chapter header |
| phone | 360–599 | most phones portrait | single column, bottom toolbar, card = bottom sheet |
| phone-landscape | height ≤ 500 | phones on their side | header and toolbar auto-hide while reading; sheet max 85% height, side-anchored if width ≥ 700 |
| tablet | 600–1023 | iPad mini/Air portrait, foldables open, split view | wider measure (≤ 70ch), top header, rails as drawers |
| laptop | 1024–1439 | iPad landscape, laptops | reading column + contents rail; reading key in a drawer |
| desktop | 1440–1919 | desktops | both rails (Scholar) |
| wide | ≥ 1920 | big monitors, 4K at 150% | max content width, larger type step, optional side-by-side compare |

- Measure 60–72 characters for reading text at every size; text size steps scale with the
  viewport but are always overridable by the user (Settings → Text size, up to 200%).
- Use `100dvh`/`svh` not `100vh`; respect `env(safe-area-inset-*)` (notches, home indicator,
  rounded corners) for the header, bottom toolbar and bottom sheet.
- Phones: a **bottom toolbar** within thumb reach (Books · Translation · Search · Reading/Interlinear ·
  Aa display settings). The top bar shows only "John 1 · KJV" and hides on scroll down, reappears
  on scroll up or at the top. Toolbar items ≥ 44×44px with labels.
- On-screen keyboard: search uses the VisualViewport API so results stay visible above the keyboard;
  no layout jump when the keyboard opens.
- Long chapters (Ps 119): `content-visibility: auto` on verse blocks / paragraphs, no layout thrash,
  60 fps scroll on a mid-range Android.
- Print stylesheet: clean text, verse numbers, no chrome.

## 2. The word interaction on touch ("hover" without a mouse)

Mouse (hover-capable, fine pointer): hover after ~100 ms intent → card below the word; move into
the card without it closing; click pins; Esc closes.

Touch:
1. **Tap a word** → the word is selected and the card opens as a **bottom sheet at peek height**
   (~45% of the viewport). The page scrolls just enough that the tapped word sits above the sheet —
   the sheet must never hide the word you tapped.
2. **Tap another word** while the sheet is open → the sheet content swaps in place (fast cross-fade,
   no close/reopen), with a selection haptic tick.
3. **Press-and-slide scrubbing** — the true touch equivalent of hovering: long-press a word
   (~300 ms, haptic "engage") enters scrub mode; sliding the finger across the text moves the
   selection word to word, updating the sheet live, with a light haptic tick (and optional soft
   sound) for each new word. A small **loupe** floats above the finger showing the English word
   and its Greek/Hebrew, because the finger hides the text. Lifting the finger keeps the last word
   selected. Scrolling is suppressed only while scrubbing (`touch-action` + pointer capture).
   The first time, a one-line coach mark teaches it ("Tip: press and slide across words").
4. **Sheet gestures**: drag handle; drag/swipe up → full height (definition, occurrences, word
   study link); drag/swipe down → dismiss; velocity-aware spring; tap the dimmed area or the ×
   to close; Android back / Esc closes. Content scrolls inside the full sheet without fighting the
   drag (only drag-to-dismiss when the inner scroll is at top).
5. **Tap a verse number** → verse action sheet: cross references, highlight (colours), note,
   bookmark, copy, share, compare translations, listen from here.
6. **Swipe left/right** on the reading area changes chapter only with clear horizontal intent
   (≥ 64 px, angle < 25°, not while scrubbing or selecting text); an edge affordance previews
   "John 2 →". Can be turned off in Settings. Browser back/forward swipe must keep working.
7. Native text selection stays available for copying (long-press on whitespace or via
   "Copy" in the verse sheet); words inside the reader use long-press for scrubbing instead.
8. No double-tap-zoom delay (`touch-action: manipulation`), and pinch-zoom is never disabled.
9. Hit-testing: word targets are small, so taps resolve to the nearest word unit within ~8 px,
   and line-height on touch is generous (≥ 1.75).
10. Names (people/places) and cross-reference markers follow the same tap → sheet model.

## 3. Feedback: haptic, audible, visual

Centralise in `src/lib/feedback.ts`: `feedback('select' | 'engage' | 'tick' | 'pin' | 'success' | 'error' | 'page')`,
which fans out to haptics, sound and an optional visual pulse according to the user's settings.

- **Haptics** (Settings → Haptics, default **on** on touch devices):
  - Android/Chrome: `navigator.vibrate` with very short patterns (tick 6–8 ms, select 10 ms,
    engage 15 ms, success [10,40,10], error [30,60,30]).
  - iOS Safari has no Vibration API: on iOS 18+ use the native switch trick (a visually hidden
    `<input type="checkbox" switch>` toggled via its `<label>` produces the system selection haptic).
    Feature-detect; fail silently elsewhere.
  - Never vibrate continuously; throttle ticks to ≤ 1 per 40 ms while scrubbing.
- **Sound** (Settings → Sound effects, default **off**; volume slider): tiny synthesized Web Audio
  sounds — a soft wood "tick" for word changes while scrubbing, a low chime when pinning a word,
  a paper "turn" for chapter changes. No audio files needed. AudioContext created lazily on the
  first user gesture.
- **Pronunciation** (always available): a speaker button on the word card uses `speechSynthesis`
  (Greek `el-GR`, Hebrew `he-IL`) to say the word; label it "Modern pronunciation" and fall back
  to speaking the transliteration with an English voice if no voice exists. Hide the button when
  speech synthesis is unavailable.
- **Listen mode**: read the chapter aloud (English TTS), verse by verse, highlighting and
  auto-scrolling to the current verse; play/pause, previous/next verse, speed 0.75–1.5×; Media
  Session metadata ("John 1 — KJV") where supported; stops on navigation.
- **Visual**: every action gets an immediate visual response (pressed states within 50 ms, a toast
  for copy/share/bookmark, inline errors).

## 4. Accessibility (WCAG 2.2 AA minimum)

- Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI and focus indicators, in light AND dark.
- **Screen readers**: the chapter reads naturally as prose (verse numbers announced, headings as
  headings, no word-by-word chatter). Word study is reachable without a mouse via a roving
  tabindex inside the text (Tab enters the reader at the first word unit, ←/→ moves word to word,
  ↑/↓ moves verse to verse, Enter/Space opens the card, Esc closes and returns focus), and via
  "Study this verse" in the verse sheet, which lists every word with its original as a plain list.
  Card content is announced through a polite live region; the pinned card / sheet is a labelled
  dialog with focus trap and focus return.
- Landmarks (`header`, `nav`, `main`, `aside`, `footer`), skip link to the text, logical heading
  order, `lang` attributes on Greek (`grc`) and Hebrew (`he`) spans, `dir="rtl"` for Hebrew.
- **Zoom & text**: works at 200% browser zoom and at 200% text size without horizontal scrolling
  (reflow at 320 CSS px). All sizes in rem/em; no fixed heights around text.
- **Settings → Reading**: text size (6 steps), line spacing, letter spacing, reading font
  (Literata · Atkinson Hyperlegible Next · OpenDyslexic), justify on/off, verse-per-line mode.
- `prefers-reduced-motion`: replace movement with ≤ 150 ms fades; no parallax, no springs,
  no auto-scrolling animations (jump instead). Also an in-app "Reduce motion" override.
- `prefers-contrast: more` and an in-app "High contrast" option: stronger borders, no tinted
  highlights (use outline + underline), heavier focus ring.
- `forced-colors: active` (Windows High Contrast): use system colours, highlight words with
  `Highlight`/`HighlightText` and outlines; never rely on background tints alone.
- Never encode meaning by colour alone: linked / related / approximate / supplied words also differ
  by underline style or text style; highlight colours have names.
- Targets ≥ 44×44 px on touch (24×24 minimum on fine pointers), with spacing.
- Errors and empty states are announced; loading states have `aria-busy`.
- Everything works with keyboard only, switch control (single-tap activation), and voice control
  (visible labels match accessible names).

## 5. Motion & effects

Motion explains, never decorates. Animate only `transform` and `opacity` (plus `clip-path` where
cheap). All motion tokens live in `src/styles/theme.css` (`--ease-out`, `--ease-spring`,
`--dur-1` 120 ms, `--dur-2` 200 ms, `--dur-3` 320 ms).

- Word focus: the accent underline "draws" left→right (scaleX) in 120 ms; related words' dotted
  underlines fade in 80 ms later.
- Card: appears from its anchor (scale 0.97→1, 4 px rise, 180 ms, spring); content swap = 120 ms
  cross-fade; Greek/Hebrew word fades up last (stagger 40 ms) — the "root revealed" moment.
- Bottom sheet: physics-based (drag follows finger 1:1, release with velocity → spring to the
  nearest detent: peek / full / closed).
- Interlinear toggle: FLIP — words keep their positions while lines open up and the originals
  fade in beneath with a short stagger (≤ 300 ms total for the visible screen only).
- Chapter change: View Transitions API where supported (slide in the swipe/arrow direction,
  cross-fade fallback); the chapter numeral morphs.
- Scrub loupe: follows the finger with a slight lag-free transform; scales in on engage.
- Skeletons: subtle shimmer while loading; never a layout shift when content arrives (reserve space).
- Toasts slide up from the toolbar; haptic + toast for copy/bookmark/share.
- Reduced motion collapses all of the above to fades or instant changes.

## 6. Installable & offline (PWA)

Web app manifest (name Rootword, Scholar colours for light/dark, maskable icons), standalone display,
service worker: precache the app shell; cache-first for data chapters already read, lexicon chunks
and fonts; offline banner when a chapter isn't cached; "Download for offline" per book in Settings
(optional). Update flow: "A new version is ready — Refresh" toast.

## 7. QA matrix (Playwright, must pass before publish)

Viewports: 280×653 (Fold), 320×568 (SE 1), 375×667 (SE 3), 393×852 (iPhone 15), 430×932
(Pro Max), 412×915 (Pixel 7), 852×393 (phone landscape), 744×1133 (iPad mini), 820×1180
(iPad Air), 1366×1024 (iPad Pro landscape), 1280×800, 1440×900, 1920×1080, 2560×1440.
Each in light and dark; touch emulation (`hasTouch`, `isMobile`) for phones/tablets; plus
reduced-motion, forced-colors, 200% text size. Checks: no horizontal overflow
(`scrollWidth <= innerWidth`), no overlapping fixed elements, tap → sheet does not cover the
tapped word, scrubbing updates the card, all axe-core checks pass (`@axe-core/playwright`),
focus order sane, every control reachable by keyboard.
