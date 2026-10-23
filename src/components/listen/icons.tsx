/**
 * Media icons for Listen mode and the pronounce button, drawn on the same 24px grid with the same
 * 1.6px round strokes as src/components/common/Icon.tsx (Scholar). Filled glyphs (play / pause /
 * skip) use currentColor fills so they stay legible at small sizes. Always decorative.
 */
const PATHS = {
  play: <path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.1-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z" class="fill" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.8" height="14" rx="1" class="fill" />
      <rect x="13.7" y="5" width="3.8" height="14" rx="1" class="fill" />
    </>
  ),
  prev: (
    <>
      <path d="M6.5 5.5v13" />
      <path d="M18 6.3v11.4a.7.7 0 0 1-1.1.6L9.6 12.6a.7.7 0 0 1 0-1.2l7.3-5.7a.7.7 0 0 1 1.1.6z" class="fill" />
    </>
  ),
  next: (
    <>
      <path d="M17.5 5.5v13" />
      <path d="M6 6.3v11.4a.7.7 0 0 0 1.1.6l7.3-5.7a.7.7 0 0 0 0-1.2L7.1 5.7A.7.7 0 0 0 6 6.3z" class="fill" />
    </>
  ),
  replay: (
    <>
      <path d="M5 12a7 7 0 1 0 2.05-4.95" />
      <path d="M5 4.5V8h3.5" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  headphones: (
    <>
      <path d="M4.5 15.5v-3a7.5 7.5 0 0 1 15 0v3" />
      <rect x="3.8" y="14" width="4" height="6" rx="1.4" />
      <rect x="16.2" y="14" width="4" height="6" rx="1.4" />
    </>
  ),
  speaker: (
    <>
      <path d="M4.5 9.6h3.2l4.3-3.6v12l-4.3-3.6H4.5z" />
      <path class="wave wave-1" d="M15.2 9.4a3.6 3.6 0 0 1 0 5.2" />
      <path class="wave wave-2" d="M17.8 6.9a7.2 7.2 0 0 1 0 10.2" />
    </>
  ),
} as const;

export type MediaIconName = keyof typeof PATHS;

export function MediaIcon({ name, class: cls = '' }: { name: MediaIconName; class?: string }) {
  return (
    <svg class={`icon micon micon--${name} ${cls}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
