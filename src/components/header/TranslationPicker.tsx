/**
 * Translation picker: meta.json order (KJV first), each with year, licence and an alignment meter;
 * runtime translations (e.g. NIV) after a rule, or an "NIV — Connect" row that opens Settings;
 * then "Compare side by side", which opens #/compare with this translation and the next one at the
 * verse being read.
 *
 * The rows are a radio group with one Tab stop (the current translation): ↑/↓ (and ←/→, Home/End)
 * move between them, Enter or Space chooses.
 */
import type { RefObject } from 'preact';
import { compareHash } from '../../app/router';
import { openSettings, passage, route, setTranslation, translations } from '../../app/state';
import { verseAtReadingLine } from '../xrefs/readingVerse';
import { Icon } from '../common/Icon';
import { UiIcon } from '../shell/icons';
import { Meter } from '../common/Meter';
import { Popover } from '../common/Popover';

export function TranslationPicker({ open, onClose, anchor }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement> }) {
  const list = translations.value;
  const cur = passage.value.tr;
  const bundled = list.filter((t) => !t.remote);
  const remote = list.filter((t) => t.remote);
  const hasNiv = remote.some((t) => t.id.toUpperCase() === 'NIV');

  const { ref } = passage.value;
  const partner = cur === 'KJV' ? (list.find((t) => t.id === 'BSB')?.id ?? list.find((t) => t.id !== cur)?.id) : 'KJV';
  // The verse being read (the reading line), so the compare page opens where the reader is.
  const reading = open && route.value.name === 'read' && typeof window !== 'undefined' && window.scrollY > 4 ? verseAtReadingLine() : null;
  const compareTo = partner ? compareHash([cur, partner], ref.book, ref.chapter, reading ?? ref.verse) : null;

  // Focus goes back to the trigger (closePanel): the reader keeps its place in the text, and moving
  // focus into the text (e.g. to the title) would scroll it away.
  const choose = (id: string) => {
    onClose();
    if (id !== cur) setTranslation(id);
  };

  /** Arrow keys move focus between the rows (one Tab stop); Enter / Space choose. */
  const onGroupKey = (e: KeyboardEvent) => {
    const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const step: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    let j = i;
    if (e.key in step) j = (i + step[e.key] + rows.length) % rows.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = rows.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    rows.forEach((r, k) => (r.tabIndex = k === j ? 0 : -1));
    rows[j].focus();
  };

  const row = (t: (typeof list)[number]) => (
    <button
      key={t.id}
      type="button"
      role="radio"
      aria-checked={t.id === cur}
      tabIndex={t.id === cur ? 0 : -1}
      class={`tr-item${t.remote ? ' tr-item--remote' : ''}`}
      onClick={() => choose(t.id)}
    >
      <span class="tr-item__abbr">{t.abbr}</span>
      <span class="tr-item__name">
        {t.name}
        <small>
          {t.year}
          {t.license ? ` · ${t.license.charAt(0).toLowerCase()}${t.license.slice(1)}` : ''}
        </small>
      </span>
      <span class="tr-item__align">
        <Meter kind={t.alignment} />
      </span>
    </button>
  );

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} label="Choose a translation" class="tr-menu" initialFocus='[aria-checked="true"]'>
      <div class="tr-menu__head" aria-hidden="true">
        <span class="eyebrow">Translation</span>
        <span class="eyebrow">Link to the original</span>
      </div>
      <div role="radiogroup" aria-label="Translation" onKeyDown={onGroupKey}>
        {bundled.map(row)}
        {remote.length > 0 && <hr />}
        {remote.map(row)}
      </div>
      {!hasNiv && (
        <>
          <hr />
          <button
            type="button"
            class="tr-item tr-item--connect"
            onClick={() => {
              onClose();
              openSettings('niv');
            }}
          >
            <span class="tr-item__abbr">NIV</span>
            <span class="tr-item__name">
              New International Version
              <small>© Biblica · read with your own API.Bible key</small>
            </span>
            <span class="connect">
              Connect <Icon name="arrow" />
            </span>
          </button>
        </>
      )}
      {compareTo && (
        <>
          <hr />
          <a class="tr-item tr-item--compare" href={compareTo} onClick={onClose}>
            <span class="tr-item__abbr" aria-hidden="true">
              <UiIcon name="compare" />
            </span>
            <span class="tr-item__name">
              Compare side by side
              <small>
                {cur} and {partner}, verse by verse
              </small>
            </span>
            <span class="connect">
              Open <Icon name="arrow" />
            </span>
          </a>
        </>
      )}
    </Popover>
  );
}
