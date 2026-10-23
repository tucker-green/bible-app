/**
 * Scrub loupe (docs/EXPERIENCE.md §2.3, §5): while pressing and sliding across the text, a small
 * lens floats above the finger with the English word and its Greek / Hebrew — the finger hides the
 * text itself. It follows the finger with transforms only and scales in on engage. Decorative for
 * assistive tech (the sheet and the live region carry the content).
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ChapterModel } from '../reader/model';
import { unitOrigWords } from '../reader/model';
import { scrub } from './scrub';
import './loupe.css';

/** Original-language text for a unit, with its lang / dir attributes. */
export function unitOriginal(model: ChapterModel, unitId: number): { text: string; lang?: string; dir?: 'rtl' } {
  const u = model.units[unitId];
  if (!u) return { text: '' };
  if (u.kind === 'linked' && model.orig) {
    const text = unitOrigWords(model.orig, u.links)
      .map((s) => s.text)
      .join(' ');
    return model.orig.lang === 'hbo' ? { text, lang: 'he', dir: 'rtl' } : { text, lang: 'grc' };
  }
  if (u.kind === 'lexicon') {
    const form = u.forms.join(' ');
    return form ? { text: form, lang: 'grc' } : { text: u.strongs.join(' ') };
  }
  return { text: '' };
}

export function Loupe({ model }: { model: ChapterModel | null }) {
  const s = scrub.value;
  const ref = useRef<HTMLDivElement>(null);
  const active = Boolean(s && model && s.key === model.key && model.units[s.unit]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !s) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const x = Math.min(Math.max(s.x - w / 2, 8), vw - w - 8);
    const y = Math.max(8, s.y - h - 44);
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  });

  if (!active || !s || !model) return null;
  const u = model.units[s.unit];
  const orig = unitOriginal(model, s.unit);
  return (
    <div class="loupe is-on" ref={ref} aria-hidden="true">
      <div class="loupe__lens">
        <span class="loupe__en">{u.text}</span>
        {orig.text ? (
          <span class="loupe__or" lang={orig.lang} dir={orig.dir}>
            {orig.text}
          </span>
        ) : (
          <span class="loupe__none">{u.kind === 'supplied' ? 'supplied' : '—'}</span>
        )}
      </div>
    </div>
  );
}
