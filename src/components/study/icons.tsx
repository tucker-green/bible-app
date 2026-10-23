/**
 * Icons used only by personal study (same 24px grid and stroke as shell/icons.tsx). Decorative:
 * every control that uses one also has a visible text label.
 */
const PATHS = {
  download: (
    <>
      <path d="M12 4.5v10.5" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4.5" />
      <path d="M7.5 9 12 4.5 16.5 9" />
      <path d="M5 19.5h14" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M9.5 7V5h5v2" />
      <path d="M7 7l.8 12.5h8.4L17 7" />
      <path d="M10.5 10.5v6M13.5 10.5v6" />
    </>
  ),
  pencil: (
    <>
      <path d="M15.5 5.5l3 3L9 18H6v-3z" />
      <path d="M13.5 7.5l3 3" />
    </>
  ),
  check: <path d="M5.5 12.5l4 4 9-9.5" />,
  erase: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M7 17 17 7" />
    </>
  ),
  shield: (
    <>
      <path d="M12 4l7 2.5v5c0 4.2-3 7.4-7 8.5-4-1.1-7-4.3-7-8.5v-5z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </>
  ),
} as const;

export type StudyIconName = keyof typeof PATHS;

export function StudyIcon({ name, class: cls = '' }: { name: StudyIconName; class?: string }) {
  return (
    <svg class={`icon ${cls}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
