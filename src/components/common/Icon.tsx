/** Inline stroke icons (24px grid, 1.6px round strokes, currentColor). Always decorative: aria-hidden. */
const PATHS = {
  chev: <path d="M7 10l5 5 5-5" />,
  left: <path d="M14.5 6l-6 6 6 6" />,
  right: <path d="M9.5 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </>
  ),
  system: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </>
  ),
  text: <path d="M4 6h16M4 10.5h16M4 15h16M4 19.5h10" />,
  inter: (
    <>
      <path d="M4 5.5h6M14 5.5h6M4 12.5h6M14 12.5h6" />
      <path d="M4 8.5h6M14 8.5h6M4 15.5h6M14 15.5h6" stroke-width="1" opacity=".55" />
      <path d="M4 19.5h6" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  arrow: <path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" />,
  key: (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="M10.5 12.5L19 4M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5l9 16H3z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </>
  ),
  retry: <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  book: <path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h9.5" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, class: cls = '' }: { name: IconName; class?: string }) {
  return (
    <svg class={`icon ${cls}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** The Rootword mark: a Literata R reversed out of ink-blue, with a cinnabar rule beneath it. */
export function BrandMark({ class: cls = 'brand__mark' }: { class?: string }) {
  return (
    <svg class={cls} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect class="m-bg" width="28" height="28" rx="5" />
      <text class="m-r" x="14" y="19.4" text-anchor="middle">
        R
      </text>
      <rect class="m-bar" x="8.6" y="22.3" width="10.8" height="1.8" rx=".5" />
    </svg>
  );
}
