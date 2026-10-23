/**
 * Settings sections: Appearance, Reading, Word study, Feedback, Accessibility, About.
 * Every control writes through the app state API (src/app/state.ts) and applies immediately;
 * settings are persisted by initState().
 */
import { useState } from 'preact/hooks';
import {
  closeSettings,
  effectiveTheme,
  FONT_SCALES,
  fontScale,
  meta,
  setFontScale,
  setTheme,
  settings,
  theme,
  updateSettings,
} from '../../app/state';
import type { Settings, Theme } from '../../app/state';
import { feedback, hapticsSupport, playTestSound, soundSupported, testHaptic } from '../../lib/feedback';
import { useMedia } from '../common/hooks';
import { formatRate } from '../listen/ListenBar';
import { LISTEN_RATES, clampRate, setListenRate } from '../listen/listen';
import { UiIcon } from '../shell/icons';
import { Section, Segmented, SwitchRow, TryButton } from './controls';
import type { SegOption } from './controls';

/* ------------------------------------------------------------------------ */
/* Appearance                                                                */
/* ------------------------------------------------------------------------ */

export function AppearanceSection() {
  const t = theme.value;
  const dark = useMedia('(prefers-color-scheme: dark)');
  const options: SegOption<Theme>[] = [
    { value: 'light', label: [<UiIcon key="i" name="sun" />, 'Light'] },
    { value: 'dark', label: [<UiIcon key="i" name="moon" />, 'Dark'] },
    { value: 'system', label: [<UiIcon key="i" name="system" />, 'Match system'] },
  ];
  return (
    <Section id="appearance" title="Appearance">
      <Segmented
        name="st-theme"
        legend="Theme"
        options={options}
        value={t}
        onChange={(v) => {
          setTheme(v);
          feedback('select');
        }}
        hint={t === 'system' ? `Following your device — ${dark ? 'dark' : 'light'} right now.` : `Always ${effectiveTheme(t)}, whatever your device uses.`}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                   */
/* ------------------------------------------------------------------------ */

const FONTS: [Settings['readingFont'], string, string][] = [
  ['literata', 'Literata', 'The Scholar reading face: calm, bookish, made for long reading'],
  ['atkinson', 'Atkinson Hyperlegible Next', 'Distinct letter shapes for low vision'],
  ['opendyslexic', 'OpenDyslexic', 'Weighted letters some dyslexic readers prefer'],
];

const LINE_SPACING: [number, string][] = [
  [0.9, 'Snug'],
  [1, 'Normal'],
  [1.2, 'Roomy'],
  [1.4, 'Airy'],
];

const LETTER_SPACING: [number, string][] = [
  [0, 'Normal'],
  [0.04, 'Wide'],
  [0.08, 'Wider'],
];

const LAYOUTS: [Settings['layout'], string][] = [
  ['auto', 'Auto'],
  ['paragraphs', 'Paragraphs'],
  ['verses', 'Verse per line'],
];

/** Snap a stored number to the nearest offered option (values set elsewhere, e.g. the Aa panel). */
function nearest(list: readonly number[], n: number): number {
  return list.reduce((b, x) => (Math.abs(x - n) < Math.abs(b - n) ? x : b), list[0]);
}

export function ReadingSection() {
  const s = settings.value;
  const scale = nearest(FONT_SCALES, fontScale.value);
  return (
    <Section id="reading" title="Reading">
      <figure class="st-preview" aria-label="Preview of the reading text">
        <p class="st-preview__text">
          <sup class="st-preview__vn" aria-hidden="true">
            12
          </sup>
          Then spake Jesus again unto them, saying, <span class="st-preview__wj">I am the light of the world: he that followeth me shall not walk in darkness, but shall have the light of life.</span>
        </p>
        <figcaption class="st-preview__cap">John 8:12 · preview</figcaption>
      </figure>

      <Segmented
        name="st-size"
        legend="Text size"
        class="st-size"
        options={FONT_SCALES.map((f, i) => ({
          value: f,
          label: [
            <span key="a" class="st-size__a" style={{ fontSize: `${13 + i * 2.6}px` }} aria-hidden="true">
              A
            </span>,
            <span key="p" class="st-size__pct tnum">
              {Math.round(f * 100)}%
            </span>,
          ],
        }))}
        value={scale}
        onChange={(v) => setFontScale(v)}
        hint="Also in the Aa panel. 200% keeps the text in one column, without sideways scrolling."
      />

      <Segmented
        name="st-font"
        legend="Reading font"
        stack
        class="st-fonts"
        options={FONTS.map(([v, name, hint]) => ({
          value: v,
          class: `st-font st-font--${v}`,
          label: [
            <span key="n" class="st-font__name">
              {name}
            </span>,
            <span key="h" class="st-font__hint">
              {hint}
            </span>,
          ],
        }))}
        value={s.readingFont}
        onChange={(v) => updateSettings({ readingFont: v })}
      />

      <div class="st-pair">
        <Segmented
          name="st-lines"
          legend="Line spacing"
          options={LINE_SPACING.map(([v, label]) => ({
            value: v,
            label: [
              <span key="g" class={`st-lines st-lines--${label.toLowerCase()}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>,
              label,
            ],
          }))}
          value={nearest(
            LINE_SPACING.map((x) => x[0]),
            s.lineSpacing,
          )}
          onChange={(v) => updateSettings({ lineSpacing: v })}
        />
        <Segmented
          name="st-letters"
          legend="Letter spacing"
          options={LETTER_SPACING.map(([v, label]) => ({
            value: v,
            label: <span style={{ letterSpacing: `${v}em` }}>{label}</span>,
          }))}
          value={nearest(
            LETTER_SPACING.map((x) => x[0]),
            s.letterSpacing,
          )}
          onChange={(v) => updateSettings({ letterSpacing: v })}
        />
      </div>

      <Segmented
        name="st-layout"
        legend="Layout"
        options={LAYOUTS.map(([v, label]) => ({ value: v, label }))}
        value={s.layout}
        onChange={(v) => updateSettings({ layout: v })}
        hint="Auto sets paragraphs when the translation has them (BSB, NIV) and one verse per line otherwise (KJV)."
      />

      <div class="st-rows">
        <SwitchRow id="st-justify" label="Justify text" hint="Even right margin, with hyphenation" checked={s.justify} onChange={(v) => updateSettings({ justify: v })} />
        <SwitchRow
          id="st-headings"
          label="Section headings"
          hint="Headings in the text and the chapter contents"
          checked={s.headings}
          onChange={(v) => updateSettings({ headings: v })}
        />
        <SwitchRow
          id="st-redletter"
          label="Words of Jesus in red"
          hint="Where the translation marks them"
          checked={s.redLetter}
          onChange={(v) => updateSettings({ redLetter: v })}
        />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------------ */
/* Word study                                                                */
/* ------------------------------------------------------------------------ */

export function WordStudySection() {
  const s = settings.value;
  return (
    <Section id="word" title="Word study">
      <div class="st-rows">
        <SwitchRow
          id="st-hover"
          label="Open word cards on hover"
          hint="With a mouse or trackpad. When off, click, tap or press Enter on a word."
          checked={s.hoverCards}
          onChange={(v) => updateSettings({ hoverCards: v })}
        />
        <SwitchRow
          id="st-related"
          label="Mark related words"
          hint="A dotted underline on other words with the same Strong’s number"
          checked={s.markRelated}
          onChange={(v) => updateSettings({ markRelated: v })}
        />
        <SwitchRow
          id="st-morph"
          label="Show morphology codes"
          hint="Raw codes such as N-NSM beside the plain-English grammar"
          checked={s.morphCodes}
          onChange={(v) => updateSettings({ morphCodes: v })}
        />
      </div>
      <p class="st-field__lbl st-sub" id="st-il-lbl">
        Interlinear lines
      </p>
      <div class="st-rows" role="group" aria-labelledby="st-il-lbl">
        <SwitchRow
          id="st-il-translit"
          label="Transliteration"
          hint="How the Greek or Hebrew word sounds, in Latin letters"
          checked={s.ilTranslit}
          onChange={(v) => updateSettings({ ilTranslit: v })}
        />
        <SwitchRow id="st-il-gloss" label="Gloss" hint="A short English meaning under each word" checked={s.ilGloss} onChange={(v) => updateSettings({ ilGloss: v })} />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------------ */
/* Feedback                                                                  */
/* ------------------------------------------------------------------------ */

export function FeedbackSection() {
  const s = settings.value;
  const [hapticMsg, setHapticMsg] = useState('');
  const [soundMsg, setSoundMsg] = useState('');
  const support = hapticsSupport();
  const canSound = soundSupported();
  const vol = Math.round((Number.isFinite(s.soundVolume) ? s.soundVolume : 0.6) * 100);
  const hapticHint =
    support === 'vibrate'
      ? 'A short tap when you select, pin or slide across words'
      : support === 'ios-switch'
        ? 'Uses the iPhone’s selection tick (iOS 18 or later)'
        : 'This browser can’t make haptic feedback (most computers can’t); the setting applies on phones.';
  const rate = clampRate(s.listenRate);
  const rates = [...new Set([...LISTEN_RATES, rate])].sort((a, b) => a - b);

  return (
    <Section id="feedback" title="Feedback">
      <div class="st-rows">
        <SwitchRow id="st-haptics" label="Haptics" hint={hapticHint} checked={s.haptics} onChange={(v) => updateSettings({ haptics: v })}>
          <div class="st-row__extra">
            <TryButton
              describedBy="st-haptics-msg"
              onClick={() => {
                const ok = testHaptic();
                setHapticMsg(ok ? 'Did you feel it? (Silent mode can mute it on iPhone.)' : 'No haptics on this device.');
              }}
            />
            <span class="st-note" id="st-haptics-msg" role="status">
              {hapticMsg}
            </span>
          </div>
        </SwitchRow>

        <SwitchRow
          id="st-sound"
          label="Sound effects"
          hint={canSound ? 'Soft synthesized ticks, a chime when you pin a word, a page turn' : 'This browser has no Web Audio, so sound effects are unavailable.'}
          checked={s.sound}
          disabled={!canSound}
          onChange={(v) => updateSettings({ sound: v })}
        >
          <div class="st-row__extra st-volume">
            <label class="st-volume__lbl" for="st-volume">
              Volume
            </label>
            <input
              id="st-volume"
              type="range"
              min={0}
              max={100}
              step={5}
              value={vol}
              disabled={!canSound}
              aria-valuetext={`${vol}%`}
              style={{ '--pct': `${vol}%` }}
              onInput={(e) => updateSettings({ soundVolume: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
            />
            <output class="st-volume__val tnum" for="st-volume" aria-hidden="true">
              {vol}%
            </output>
            <TryButton
              describedBy="st-sound-msg"
              disabled={!canSound}
              onClick={() => {
                const ok = playTestSound('pin', vol / 100);
                setSoundMsg(ok ? (s.sound ? '' : 'That’s the pin chime. Turn sound effects on to hear it while reading.') : 'Sound is unavailable in this browser.');
              }}
            />
            <span class="st-note" id="st-sound-msg" role="status">
              {soundMsg}
            </span>
          </div>
        </SwitchRow>
      </div>

      <Segmented
        name="st-rate"
        legend="Listen speed"
        options={rates.map((r) => ({ value: r, label: formatRate(r) }))}
        value={rate}
        onChange={(v) => setListenRate(v)}
        hint="How fast Listen mode reads the chapter aloud."
      />
    </Section>
  );
}

/* ------------------------------------------------------------------------ */
/* Accessibility                                                             */
/* ------------------------------------------------------------------------ */

export function AccessibilitySection() {
  const s = settings.value;
  const osContrast = useMedia('(prefers-contrast: more)');
  const osReduce = useMedia('(prefers-reduced-motion: reduce)');
  const motionHint =
    s.motion === 'system'
      ? `Your device ${osReduce ? 'asks for reduced motion, so movement becomes short fades' : 'allows full motion'}.`
      : s.motion === 'reduce'
        ? 'Movement becomes short fades; nothing slides or springs.'
        : 'Sheets spring, chapters slide, words reveal — even if your device asks for less motion.';
  return (
    <Section id="accessibility" title="Accessibility">
      <div class="st-rows">
        <SwitchRow
          id="st-contrast"
          label="High contrast"
          hint={osContrast ? 'On because your device asks for more contrast.' : 'Stronger lines and outlines instead of tints'}
          checked={s.highContrast || osContrast}
          disabled={osContrast}
          onChange={(v) => updateSettings({ highContrast: v })}
        />
      </div>
      <Segmented
        name="st-motion"
        legend="Motion"
        options={[
          { value: 'system' as const, label: 'Match system' },
          { value: 'reduce' as const, label: 'Reduce' },
          { value: 'full' as const, label: 'Full' },
        ]}
        value={s.motion}
        onChange={(v) => updateSettings({ motion: v })}
        hint={motionHint}
      />
      <div class="st-rows">
        <SwitchRow
          id="st-swipe"
          label="Swipe to change chapter"
          hint="Swipe left or right across the text on a touch screen"
          checked={s.swipeChapters}
          onChange={(v) => updateSettings({ swipeChapters: v })}
        />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------------ */
/* About                                                                     */
/* ------------------------------------------------------------------------ */

export function AboutSection() {
  const m = meta.value;
  return (
    <Section id="about" title="About & credits">
      <a class="st-link" href="#/about" onClick={() => closeSettings()}>
        <UiIcon name="info" />
        <span>
          <span class="st-link__t">About Rootword &amp; full credits</span>
          <small>Texts, lexicons, alignments and their licences</small>
        </span>
        <UiIcon name="arrow" />
      </a>
      <p class="st-fine">
        Settings are saved in this browser only.{m?.version ? ` Data version ${m.version}.` : ''}
      </p>
    </Section>
  );
}
