/**
 * The compare page's sticky translation bar: one head per column, aligned with the columns below
 * (same grid template). Each head is the column's translation chooser — a native <select> laid over
 * the visible "KJV  King James ▾" face, so phones get their own picker and keyboards / screen
 * readers a real combobox — with the column's alignment meter and, at three columns, a remove
 * button. "Add a translation" appends a third column. A column that is loading or failed says so in
 * its head (with "Try again").
 *
 * The NIV (and other API.Bible translations) appear once connected; until then the list offers
 * "Connect the NIV…", which opens Settings → Translations.
 */
import { openSettings } from '../../app/state';
import type { TranslationMeta } from '../../lib/types';
import { Icon } from '../common/Icon';
import { Meter } from '../common/Meter';
import { shortName } from '../common/alignment';
import { UiIcon } from '../shell/icons';
import { MAX_COLUMNS, MIN_COLUMNS } from './model';

export type ColumnStatus = 'loading' | 'ready' | 'error';

export interface CompareBarProps {
  trs: readonly string[];
  status: readonly ColumnStatus[];
  list: readonly TranslationMeta[];
  onSet: (index: number, id: string) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onRetry: () => void;
}

const CONNECT = '__connect';
const REMOVE = '__remove';

export function CompareBar({ trs, status, list, onSet, onRemove, onAdd, onRetry }: CompareBarProps) {
  const hasNiv = list.some((t) => t.id.toUpperCase() === 'NIV');
  const canRemove = trs.length > MIN_COLUMNS;
  const canAdd = trs.length < MAX_COLUMNS && list.some((t) => !trs.includes(t.id));
  const bundled = list.filter((t) => !t.remote);
  const remote = list.filter((t) => t.remote);

  return (
    <div class={`cmp-bar${canAdd ? ' has-add' : ''}`} role="group" aria-label="Translations side by side">
      <div class="cmp-bar__cols">
        {trs.map((tr, i) => {
          const t = list.find((x) => x.id === tr);
          const abbr = t?.abbr ?? tr;
          const st = status[i] ?? 'loading';
          const onChange = (e: Event) => {
            const sel = e.currentTarget as HTMLSelectElement;
            const v = sel.value;
            sel.value = tr; // the page re-renders with the new choice; actions leave it as it was
            if (v === CONNECT) openSettings('niv');
            else if (v === REMOVE) onRemove(i);
            else if (v !== tr) onSet(i, v);
          };
          return (
            <div class={`cmp-head is-${st}`} key={`${i}-${tr}`} data-col={i}>
              <div class="cmp-pick">
                <span class="cmp-pick__face" aria-hidden="true">
                  <span class="cmp-pick__abbr">{abbr}</span>
                  <span class="cmp-pick__name">{t ? shortName(t.name) : ''}</span>
                  <Icon name="chev" class="cmp-pick__chev" />
                </span>
                <select class="cmp-pick__sel" aria-label={`${abbr}: translation in column ${i + 1}`} value={tr} onChange={onChange}>
                  {bundled.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.abbr} — {x.name}
                    </option>
                  ))}
                  {remote.length > 0 && (
                    <optgroup label="Through your API.Bible key">
                      {remote.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.abbr} — {x.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {!t && (
                    <option value={tr} disabled>
                      {tr}
                    </option>
                  )}
                  {(!hasNiv || canRemove) && (
                    <optgroup label="More">
                      {!hasNiv && <option value={CONNECT}>NIV — connect your API.Bible key…</option>}
                      {canRemove && <option value={REMOVE}>Remove this column</option>}
                    </optgroup>
                  )}
                </select>
              </div>
              {st === 'ready' && t && (
                <span class="cmp-head__meter">
                  <Meter kind={t.alignment} />
                </span>
              )}
              {st === 'loading' && (
                <span class="cmp-head__state" role="status">
                  Loading…
                </span>
              )}
              {st === 'error' && (
                <span class="cmp-head__state cmp-head__state--err" role="alert">
                  Didn’t load ·{' '}
                  <button type="button" class="link-btn" onClick={onRetry}>
                    Try again
                  </button>
                </span>
              )}
              {canRemove && (
                <button type="button" class="cmp-head__x" aria-label={`Remove the ${abbr} column`} title={`Remove the ${abbr}`} onClick={() => onRemove(i)}>
                  <UiIcon name="close" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {canAdd && (
        <button type="button" class="cmp-add" onClick={onAdd} aria-label="Add a translation column">
          <UiIcon name="plus" />
          <span class="cmp-add__txt">Add</span>
        </button>
      )}
    </div>
  );
}
