/**
 * The settings sheet (src/app/README.md: openSettings(section) / closeSettings(), settingsOpen,
 * settingsSection). A labelled modal dialog either way:
 *
 *  - phones (< 720 px wide): a bottom sheet with peek / full / closed detents, spring, drag handle,
 *    inner-scroll handoff and Android-back closing (shell/sheet.ts);
 *  - wider screens: a side sheet docked at the right, full height; ≥ 1024 px it gets a contents rail.
 *
 * Sections: Appearance · Reading · Word study · Feedback · Accessibility · Translations (API.Bible
 * for the NIV; openSettings('niv')) · Offline (OfflineSection.tsx) · About & credits. Every change
 * applies at once and is remembered (initState persists settings). Focus moves into the sheet, Tab
 * is trapped, Esc / × / the scrim close it and focus returns to what opened it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { apiBibleConnection } from '../../app/remote';
import { closeSettings, loadReadingFont, panelAnchor, scrollBehavior, settingsOpen, settingsSection } from '../../app/state';
import { trapTab, useWindowSize } from '../common/hooks';
import { UiIcon } from '../shell/icons';
import { useBackClose, useSheet, useSheetClass } from '../shell/sheet';
import { Section } from './controls';
import { OfflineSection } from './OfflineSection';
import { AboutSection, AccessibilitySection, AppearanceSection, FeedbackSection, ReadingSection, WordStudySection } from './sections';
import { KEY_INPUT_ID, TranslationsSection } from './TranslationsSection';
import './settings.css';

/** Sections in order; `aliases` are accepted by openSettings(section). */
export const SETTINGS_SECTIONS: { id: string; label: string; aliases?: string[] }[] = [
  { id: 'appearance', label: 'Appearance', aliases: ['theme'] },
  { id: 'reading', label: 'Reading', aliases: ['text', 'font'] },
  { id: 'word', label: 'Word study', aliases: ['wordstudy', 'words'] },
  { id: 'feedback', label: 'Feedback', aliases: ['haptics', 'sound', 'listen'] },
  { id: 'accessibility', label: 'Accessibility', aliases: ['a11y', 'motion', 'contrast'] },
  { id: 'translations', label: 'Translations', aliases: ['niv', 'apibible', 'api'] },
  { id: 'offline', label: 'Offline', aliases: ['pwa', 'install'] },
  { id: 'about', label: 'About' },
];

/** Section id for an openSettings() argument (null for unknown / none). */
export function resolveSection(s: string | null | undefined): string | null {
  if (!s) return null;
  const k = s.toLowerCase();
  return SETTINGS_SECTIONS.find((x) => x.id === k || x.aliases?.includes(k))?.id ?? null;
}

export function SettingsSheet() {
  const open = settingsOpen.value;
  const size = useWindowSize();
  const isSheet = size.width < 720;
  const rail = size.width >= 1024;
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  /** Until this time, scroll events come from our own scrolling (to a section): the spy keeps its choice. */
  const spyHold = useRef(0);
  const target = resolveSection(settingsSection.value);
  const [active, setActive] = useState<string>(target ?? SETTINGS_SECTIONS[0].id);

  const close = () => closeSettings();
  const api = useSheet(ref, {
    open: open && isSheet,
    enabled: isSheet,
    onClose: close,
    peek: 0.72,
    initial: target ? 'full' : 'peek',
    scroller: () => bodyRef.current,
  });
  useBackClose(open && isSheet, close);
  useSheetClass(open && isSheet);
  const dismiss = () => (isSheet ? api.close() : close());

  // Previews of the reading fonts in their own faces.
  useEffect(() => {
    if (!open) return;
    void loadReadingFont('atkinson');
    void loadReadingFont('opendyslexic');
  }, [open]);

  // Remember what opened the sheet; give focus back on close.
  useLayoutEffect(() => {
    if (!open) return;
    const a = document.activeElement as HTMLElement | null;
    returnTo.current = a && a !== document.body && !ref.current?.contains(a) ? a : panelAnchor.current;
    return () => {
      const el = returnTo.current;
      const active = document.activeElement;
      const inside = !active || active === document.body || !active.isConnected || ref.current?.contains(active);
      if (inside && el?.isConnected) requestAnimationFrame(() => el.focus({ preventScroll: true }));
    };
  }, [open]);

  // Focus in, scrolled to the requested section (openSettings('niv') → the API.Bible key field).
  useEffect(() => {
    if (!open) return;
    const id = resolveSection(settingsSection.peek());
    const raf = requestAnimationFrame(() => {
      const body = bodyRef.current;
      const sec = id ? body?.querySelector<HTMLElement>(`#st-${id}`) : null;
      if (body && sec) {
        spyHold.current = Date.now() + 300;
        body.scrollTop = sec.offsetTop + 1; // just past the section rule
        setActive(id!);
      }
      const keyInput = id === 'translations' && !apiBibleConnection.peek() ? document.getElementById(KEY_INPUT_ID) : null;
      const focusTarget = keyInput ?? (sec ? sec.querySelector<HTMLElement>('.st-sec__title') : null) ?? ref.current;
      focusTarget?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, settingsSection.value]);

  // Scroll spy: the section at the top of the scroller is "current" in the contents.
  useEffect(() => {
    const body = bodyRef.current;
    if (!open || !body) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (Date.now() < spyHold.current) return;
        const secs = [...body.querySelectorAll<HTMLElement>('.st-sec')];
        if (!secs.length) return;
        // the last section that starts above a line a third of the way down the scroller
        const line = body.scrollTop + Math.min(body.clientHeight / 3, 240);
        let cur = secs[0].dataset.sec!;
        for (const s of secs) if (s.offsetTop <= line) cur = s.dataset.sec!;
        setActive(cur);
      });
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      body.removeEventListener('scroll', onScroll);
    };
  }, [open, isSheet, rail]);

  // Keep the current chip in view in the horizontal contents (phones / tablets).
  useEffect(() => {
    const nav = navRef.current;
    if (!open || !nav || rail) return;
    const chip = nav.querySelector<HTMLElement>(`[data-go="${active}"]`);
    if (!chip) return;
    const l = chip.offsetLeft - 16;
    const r = chip.offsetLeft + chip.offsetWidth + 16 - nav.clientWidth;
    if (nav.scrollLeft > l) nav.scrollLeft = l;
    else if (nav.scrollLeft < r) nav.scrollLeft = r;
  }, [active, open, rail]);

  if (!open) return null;

  const go = (id: string) => {
    const body = bodyRef.current;
    const sec = body?.querySelector<HTMLElement>(`#st-${id}`);
    if (!body || !sec) return;
    if (isSheet && api.detent !== 'full') api.setDetent('full');
    const behavior = scrollBehavior();
    spyHold.current = Date.now() + (behavior === 'smooth' ? 900 : 300);
    if (typeof body.scrollTo === 'function') body.scrollTo({ top: sec.offsetTop + 1, behavior });
    else body.scrollTop = sec.offsetTop + 1;
    setActive(id);
    sec.querySelector<HTMLElement>('.st-sec__title')?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
      return;
    }
    if (ref.current) trapTab(e, ref.current);
  };

  const cls = ['st-sheet', isSheet ? 'is-sheet' : 'is-side', rail ? 'has-rail' : '', isSheet && api.detent === 'full' ? 'is-full' : ''].filter(Boolean).join(' ');
  const nav = (
    <nav class={rail ? 'st-rail' : 'st-chips'} aria-label="Settings sections" ref={navRef}>
      {rail && <p class="eyebrow st-rail__eyebrow">On this sheet</p>}
      <ul>
        {SETTINGS_SECTIONS.map((s) => (
          <li key={s.id}>
            <button type="button" data-go={s.id} aria-current={active === s.id ? 'true' : undefined} onClick={() => go(s.id)}>
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <>
      <div class="st-scrim" aria-hidden="true" onClick={dismiss} />
      <div
        ref={ref}
        class={cls}
        role="dialog"
        aria-modal="true"
        aria-labelledby="st-title"
        tabIndex={-1}
        data-keep-word
        onKeyDown={onKeyDown}
        onWheel={(e) => {
          if (isSheet && api.detent !== 'full' && e.deltaY > 0) api.setDetent('full');
        }}
      >
        {isSheet && (
          <div class="sheet-handle st-handle" aria-hidden="true" {...api.handleProps}>
            <span />
          </div>
        )}
        <div class="st-head">
          <div>
            <p class="eyebrow">Rootword</p>
            <h2 class="st-title" id="st-title">
              Settings
            </h2>
          </div>
          <button type="button" class="st-close" aria-label="Close settings" onClick={dismiss}>
            <UiIcon name="close" />
          </button>
        </div>
        {!rail && nav}
        <div class="st-main">
          {rail && nav}
          <div class="st-body" ref={bodyRef}>
            <AppearanceSection />
            <ReadingSection />
            <WordStudySection />
            <FeedbackSection />
            <AccessibilitySection />
            <TranslationsSection />
            <Section id="offline" title="Offline">
              <OfflineSection />
            </Section>
            <AboutSection />
          </div>
        </div>
      </div>
    </>
  );
}
