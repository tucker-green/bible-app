/**
 * "How it's translated": the English renderings in each bundled translation (LexEntry.renderings,
 * top 6 per translation) as labelled horizontal bars. Bar length = share of the word's occurrences.
 */
import type { RenderingGroup } from './model';
import { fmt, pct } from './model';

export function Renderings({ groups, total }: { groups: RenderingGroup[]; total: number }) {
  return (
    <div class={`ws-rend${groups.length > 1 ? ' is-multi' : ''}`}>
      {groups.map((g) => {
        const top = g.rows[0]?.[1] ?? 1;
        const base = Math.max(total, top, 1);
        const capId = `ws-rend-${g.tr}`;
        return (
          <figure class="ws-rend__tr" key={g.tr} aria-labelledby={capId}>
            <figcaption class="ws-rend__cap" id={capId}>
              <span class="ws-rend__abbr">{g.tr}</span>
              <span class="ws-rend__name">{g.name}</span>
            </figcaption>
            <ol class="ws-bars">
              {g.rows.map(([w, n]) => (
                <li class="ws-bar" key={w}>
                  <span class="ws-bar__label">{w}</span>
                  <span class="ws-bar__n tnum">
                    {fmt(n)}
                    <span class="sr-only"> times{total > 0 ? `, ${pct(n, total)} of occurrences` : ''}</span>
                  </span>
                  <span class="ws-bar__track" aria-hidden="true">
                    <span class="ws-bar__fill" style={{ width: `${Math.max(1.5, Math.min(100, (n / base) * 100))}%` }} />
                  </span>
                </li>
              ))}
            </ol>
          </figure>
        );
      })}
    </div>
  );
}
