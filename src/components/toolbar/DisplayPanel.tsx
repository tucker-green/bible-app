/**
 * The "Aa" panel: quick display settings (theme, text size up to 200%, reading font, line spacing,
 * justify, red letter) and the ways into the rest of the app (My study, Settings, About).
 * Opened from the header's Aa button or the phone toolbar (panel signal 'display'); a popover on
 * desktop, a bottom sheet on phones. Every choice applies immediately and is remembered.
 */
import type { ComponentChildren } from 'preact';
import {
  closePanel,
  FONT_SCALES,
  fontScale,
  openSettings,
  panel,
  panelAnchor,
  setTheme,
  settings,
  stepFontScale,
  theme,
  updateSettings,
} from '../../app/state';
import type { Settings, Theme } from '../../app/state';
import { Popover } from '../common/Popover';
import { UiIcon } from '../shell/icons';
import type { UiIconName } from '../shell/icons';
import './display.css';

const THEMES: [Theme, string, UiIconName][] = [
  ['light', 'Light', 'sun'],
  ['dark', 'Dark', 'moon'],
  ['system', 'System', 'system'],
];

const FONTS: [Settings['readingFont'], string, string][] = [
  ['literata', 'Literata', 'The Scholar reading face'],
  ['atkinson', 'Atkinson Hyperlegible', 'Distinct letter shapes for low vision'],
  ['opendyslexic', 'OpenDyslexic', 'Weighted letters some dyslexic readers prefer'],
];

const SPACING: [number, string][] = [
  [0.9, 'Snug'],
  [1, 'Normal'],
  [1.2, 'Roomy'],
];

function Choice<T extends string | number>({
  name,
  value,
  current,
  onPick,
  children,
  class: cls = '',
}: {
  name: string;
  value: T;
  current: T;
  onPick: (v: T) => void;
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <label class={`dp-choice ${cls}`.trim()}>
      <input type="radio" name={name} value={String(value)} checked={value === current} onChange={() => onPick(value)} />
      <span class="dp-choice__face">{children}</span>
    </label>
  );
}

function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="dp-switch">
      <span class="dp-switch__txt">
        <span class="dp-switch__lbl">{label}</span>
        {hint && <span class="dp-switch__hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span class="dp-switch__track" aria-hidden="true" />
    </label>
  );
}

export function DisplayPanel() {
  const open = panel.value === 'display';
  const s = settings.value;
  const t = theme.value;
  const scale = fontScale.value;
  const pct = Math.round(scale * 100);
  const minS = FONT_SCALES[0];
  const maxS = FONT_SCALES[FONT_SCALES.length - 1];
  const nearest = (n: number) => SPACING.reduce((b, x) => (Math.abs(x[0] - n) < Math.abs(b[0] - n) ? x : b))[0];

  return (
    <Popover open={open} onClose={closePanel} anchor={panelAnchor} label="Display" class="dp" align="right" initialFocus="input:checked">
      <div class="dp__body">
        <fieldset class="dp-group">
          <legend class="eyebrow">Theme</legend>
          <div class="dp-seg">
            {THEMES.map(([v, label, icon]) => (
              <Choice key={v} name="dp-theme" value={v} current={t} onPick={setTheme}>
                <UiIcon name={icon} />
                {label}
              </Choice>
            ))}
          </div>
        </fieldset>

        <div class="dp-group" role="group" aria-labelledby="dp-size-lbl">
          <p class="eyebrow" id="dp-size-lbl">
            Text size
          </p>
          <div class="dp-size">
            <button type="button" class="dp-size__btn" onClick={() => stepFontScale(-1)} disabled={scale <= minS + 0.001} aria-label="Smaller text">
              <span class="dp-a dp-a--sm" aria-hidden="true">
                A
              </span>
              <UiIcon name="minus" />
            </button>
            <output class="dp-size__val tnum" aria-live="polite" aria-label={`Text size ${pct}%`}>
              {pct}%
            </output>
            <button type="button" class="dp-size__btn" onClick={() => stepFontScale(1)} disabled={scale >= maxS - 0.001} aria-label="Larger text">
              <span class="dp-a dp-a--lg" aria-hidden="true">
                A
              </span>
              <UiIcon name="plus" />
            </button>
          </div>
          <div class="dp-steps" aria-hidden="true">
            {FONT_SCALES.map((f) => (
              <i key={f} class={f <= scale + 0.001 ? 'on' : ''} />
            ))}
          </div>
        </div>

        <fieldset class="dp-group">
          <legend class="eyebrow">Reading font</legend>
          <div class="dp-fonts">
            {FONTS.map(([v, label, hint]) => (
              <Choice key={v} name="dp-font" value={v} current={s.readingFont} onPick={(f) => updateSettings({ readingFont: f })} class={`dp-font dp-font--${v}`}>
                <span class="dp-font__name">{label}</span>
                <span class="dp-font__hint">{hint}</span>
              </Choice>
            ))}
          </div>
        </fieldset>

        <fieldset class="dp-group">
          <legend class="eyebrow">Line spacing</legend>
          <div class="dp-seg">
            {SPACING.map(([v, label]) => (
              <Choice key={v} name="dp-spacing" value={v} current={nearest(s.lineSpacing)} onPick={(n) => updateSettings({ lineSpacing: n })}>
                <span class={`dp-lines dp-lines--${label.toLowerCase()}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {label}
              </Choice>
            ))}
          </div>
        </fieldset>

        <div class="dp-group dp-switches">
          <Switch label="Justify text" checked={s.justify} onChange={(v) => updateSettings({ justify: v })} />
          <Switch label="Words of Jesus in red" hint="Where the translation marks them" checked={s.redLetter} onChange={(v) => updateSettings({ redLetter: v })} />
        </div>
      </div>

      <nav class="dp-links" aria-label="More">
        <a href="#/study" onClick={closePanel}>
          <UiIcon name="study" />
          <span>My study</span>
          <small>Highlights, notes & bookmarks</small>
        </a>
        <button
          type="button"
          onClick={() => {
            closePanel();
            openSettings();
          }}
        >
          <UiIcon name="settings" />
          <span>All settings</span>
          <small>Motion, contrast, haptics, sound…</small>
        </button>
        <a href="#/about" onClick={closePanel}>
          <UiIcon name="info" />
          <span>About Rootword</span>
          <small>Sources & credits</small>
        </a>
      </nav>
    </Popover>
  );
}
