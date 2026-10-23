/**
 * Form controls for the settings sheet (Scholar style; settings.css). Every control has a visible
 * label that is also its accessible name (voice control), hints are aria-describedby, and every
 * target is at least 44 px tall.
 *
 * Other sections rendered inside the sheet (e.g. OfflineSection) can use these too.
 */
import type { ComponentChildren } from 'preact';

/** A titled section of the sheet (the sheet title is the <h2>; sections are <h3>). */
export function Section({ id, title, lede, children }: { id: string; title: string; lede?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="st-sec" id={`st-${id}`} data-sec={id} aria-labelledby={`st-${id}-h`}>
      <h3 class="st-sec__title" id={`st-${id}-h`} tabIndex={-1}>
        {title}
      </h3>
      {lede && <p class="st-sec__lede">{lede}</p>}
      {children}
    </section>
  );
}

/** On/off switch row: label (+ hint) on the left, the switch on the right; `children` go under it. */
export function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
  children,
}: {
  id: string;
  label: string;
  hint?: ComponentChildren;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  children?: ComponentChildren;
}) {
  const lbl = `${id}-l`;
  const hintId = `${id}-d`;
  return (
    <div class={`st-row${disabled ? ' is-disabled' : ''}`}>
      <label class="st-switch" for={id}>
        <span class="st-row__txt">
          <span class="st-row__lbl" id={lbl}>
            {label}
          </span>
          {hint && (
            <span class="st-row__hint" id={hintId}>
              {hint}
            </span>
          )}
        </span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-labelledby={lbl}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="st-switch__track" aria-hidden="true" />
      </label>
      {children}
    </div>
  );
}

export interface SegOption<T> {
  value: T;
  label: ComponentChildren;
  /** Accessible name when `label` is not plain text (must contain the visible text). */
  aria?: string;
  class?: string;
}

/** Radio group shown as a segmented control (or, with `stack`, as a list of cards). */
export function Segmented<T extends string | number>({
  name,
  legend,
  hint,
  options,
  value,
  onChange,
  stack = false,
  class: cls = '',
}: {
  name: string;
  legend: string;
  hint?: ComponentChildren;
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  stack?: boolean;
  class?: string;
}) {
  const hintId = `${name}-d`;
  return (
    <fieldset class={`st-field ${cls}`.trim()} aria-describedby={hint ? hintId : undefined}>
      <legend class="st-field__lbl">{legend}</legend>
      <div class={stack ? 'st-cards' : 'st-seg'} style={stack ? undefined : { '--cols': String(options.length) }}>
        {options.map((o) => (
          <label key={String(o.value)} class={`st-opt ${o.class ?? ''}`.trim()}>
            <input type="radio" name={name} value={String(o.value)} checked={o.value === value} aria-label={o.aria} onChange={() => onChange(o.value)} />
            <span class="st-opt__face">{o.label}</span>
          </label>
        ))}
      </div>
      {hint && (
        <p class="st-field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </fieldset>
  );
}

/** Small secondary button ("Try it"). */
export function TryButton({ onClick, label = 'Try it', describedBy, disabled }: { onClick: () => void; label?: string; describedBy?: string; disabled?: boolean }) {
  return (
    <button type="button" class="st-btn st-btn--quiet st-try" onClick={onClick} aria-describedby={describedBy} disabled={disabled}>
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.5v13l10-6.5z" />
      </svg>
      {label}
    </button>
  );
}
