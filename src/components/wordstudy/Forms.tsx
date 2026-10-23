/**
 * "Forms": the inflected forms as they occur (WordStudy.forms, top 40) with counts and plain-English
 * parsing (src/lib/morph.ts describeMorph); raw codes beside it when Settings → "Morphology codes" is on.
 */
import { useMemo, useState } from 'preact/hooks';
import { settings } from '../../app/state';
import type { MorphLang } from '../../lib/morph';
import type { WordStudy } from '../../lib/types';
import { fmt, formTable, pct } from './model';

const FIRST = 10;

export function Forms({ study, lang, word }: { study: WordStudy; lang: MorphLang; word: string }) {
  const { rows, shared } = useMemo(() => formTable(study, lang), [study, lang]);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST);
  const codes = settings.value.morphCodes;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const hebrew = lang !== 'grc';
  const tableId = `ws-forms-${study.id}`;
  const listed = rows.reduce((n, r) => n + r.count, 0);
  return (
    <div class="ws-forms">
      <table class="ws-table ws-forms__table" id={tableId}>
        <caption class="sr-only">Forms of {word} as they occur, most frequent first</caption>
        <thead>
          <tr>
            <th scope="col">Form</th>
            <th scope="col">
              Parsing
              {shared.length > 0 && <span class="ws-th-note"> · every form: {shared.join(', ').toLowerCase()}</span>}
            </th>
            <th scope="col" class="num">
              Count
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={`${r.text}|${r.code}`}>
              <th scope="row" class="ws-form">
                <span lang={hebrew ? (lang === 'arc' ? 'arc' : 'he') : 'grc'} dir={hebrew ? 'rtl' : undefined}>
                  {r.text}
                </span>
              </th>
              <td class="ws-parse">
                <span class={r.ok ? '' : 'ws-parse--na'}>{r.parsing}</span>
                {codes && r.code && <code class="ws-code">{r.code}</code>}
              </td>
              <td class="num">
                <span class="ws-count tnum">{fmt(r.count)}</span>
                <span class="ws-mini" aria-hidden="true" title={pct(r.count, study.total)}>
                  <span style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="ws-forms__foot">
        {rows.length > FIRST && (
          <button type="button" class="btn-quiet" aria-expanded={all} aria-controls={tableId} onClick={() => setAll(!all)}>
            {all ? `Show the top ${FIRST}` : `Show all ${rows.length} forms`}
          </button>
        )}
        <p class="ws-note">
          {rows.length >= 40
            ? `The 40 most frequent forms, ${fmt(listed)} of ${fmt(study.total)} occurrences.`
            : `Every form, ${fmt(listed)} occurrences.`}
          {hebrew && ' Hebrew forms are the whole written word, with any prefixes and suffixes; the parsing is of this word.'}
        </p>
      </div>
    </div>
  );
}
