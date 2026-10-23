/**
 * Translation picker: meta.json order (KJV first), each with year, licence and an alignment meter;
 * runtime translations (e.g. NIV) after a rule, or an "NIV — Connect" row that opens Settings.
 */
import type { RefObject } from 'preact';
import { openSettings, passage, setTranslation, translations } from '../../app/state';
import { Icon } from '../common/Icon';
import { Meter } from '../common/Meter';
import { Popover } from '../common/Popover';

export function TranslationPicker({ open, onClose, anchor }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement> }) {
  const list = translations.value;
  const cur = passage.value.tr;
  const bundled = list.filter((t) => !t.remote);
  const remote = list.filter((t) => t.remote);
  const hasNiv = remote.some((t) => t.id.toUpperCase() === 'NIV');

  const choose = (id: string) => {
    onClose();
    if (id !== cur) setTranslation(id);
  };

  const row = (t: (typeof list)[number]) => (
    <button
      key={t.id}
      type="button"
      role="radio"
      aria-checked={t.id === cur}
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
      <div role="radiogroup" aria-label="Translation">
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
    </Popover>
  );
}
