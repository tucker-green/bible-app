/**
 * Extra stroke icons for the toolbar, the "Aa" panel and the verse sheet, drawn on the same grid as
 * src/components/common/Icon.tsx (24px, 1.6px round strokes, currentColor, class "icon").
 * Always decorative (aria-hidden): every control that uses one has a visible text label or an
 * aria-label.
 */
const PATHS = {
  books: (
    <>
      <path d="M12 6.5c-1.8-1.4-4.4-2-7.5-2v13c3.1 0 5.7.6 7.5 2 1.8-1.4 4.4-2 7.5-2v-13c-3.1 0-5.7.6-7.5 2z" />
      <path d="M12 6.5v13" />
    </>
  ),
  translation: (
    <>
      <path d="M3.5 6h9M8 4v2M10.5 6c-.6 3.6-3 6.4-6.5 8M5.6 9.3c1.1 2 2.8 3.6 5 4.6" />
      <path d="M12.5 20l3.6-8.5h.8L20.5 20M13.9 16.8h5.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  reading: <path d="M4 6h16M4 10.5h16M4 15h16M4 19.5h10" />,
  interlinear: (
    <>
      <path d="M4 5.5h6M14 5.5h6M4 12.5h6M14 12.5h6" />
      <path d="M4 8.5h6M14 8.5h6M4 15.5h6M14 15.5h6" stroke-width="1" opacity=".55" />
      <path d="M4 19.5h6" />
    </>
  ),
  aa: (
    <>
      <path d="M2.8 18.5L7.6 6h.8l4.8 12.5M4.6 14h7" />
      <path d="M20.6 12.2v6.3M20.6 15.3a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" />
    </>
  ),
  bookmark: <path d="M7 4.5h10v15.2l-5-3.6-5 3.6z" />,
  bookmarkFill: <path d="M7 4.5h10v15.2l-5-3.6-5 3.6z" fill="currentColor" />,
  note: (
    <>
      <path d="M5 4.5h14v10.5l-4.5 4.5H5z" />
      <path d="M14.5 19.5V15H19M8.5 9h7M8.5 12h4.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  share: (
    <>
      <path d="M12 3.8v11M8 7.5l4-3.7 4 3.7" />
      <path d="M8.5 10.5H6.5a1.5 1.5 0 0 0-1.5 1.5v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-2" />
    </>
  ),
  listen: (
    <>
      <path d="M4.5 14.5v-2a7.5 7.5 0 0 1 15 0v2" />
      <rect x="4.5" y="14" width="3.5" height="6" rx="1.2" />
      <rect x="16" y="14" width="3.5" height="6" rx="1.2" />
    </>
  ),
  compare: (
    <>
      <rect x="3.5" y="4.5" width="7" height="15" rx="1.5" />
      <rect x="13.5" y="4.5" width="7" height="15" rx="1.5" />
      <path d="M5.8 8.5h2.4M5.8 11.5h2.4M15.8 8.5h2.4M15.8 11.5h2.4" />
    </>
  ),
  study: (
    <>
      <path d="M5 5.5h3M5 12h3M5 18.5h3" />
      <path d="M11 5.5h8M11 12h8M11 18.5h8" />
    </>
  ),
  highlight: (
    <>
      <path d="M14.5 4.5l5 5-8 8H6.5v-5z" />
      <path d="M4 20.5h16" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  arrow: <path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" />,
  left: <path d="M14.5 6l-6 6 6 6" />,
  right: <path d="M9.5 6l6 6-6 6" />,
  minus: <path d="M6 12h12" />,
  plus: <path d="M6 12h12M12 6v12" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  system: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </>
  ),
  words: (
    <>
      <path d="M4 6.5h7M4 10.5h5" />
      <path d="M14 6.5h6M14 10.5h4" stroke-width="1" opacity=".6" />
      <path d="M4 15.5h7M4 19.5h5" />
      <path d="M14 15.5h6M14 19.5h4" stroke-width="1" opacity=".6" />
    </>
  ),
} as const;

export type UiIconName = keyof typeof PATHS;

export function UiIcon({ name, class: cls = '' }: { name: UiIconName; class?: string }) {
  return (
    <svg class={`icon ${cls}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
