/**
 * "Your data" — where personal study lives and how to move it: Export (a JSON file), Import (with a
 * preview and a choice between merging and replacing) and Delete everything (confirmed). Shows a
 * warning when this browser isn't saving (storage disabled / full / data from a newer Rootword).
 */
import { useRef, useState } from 'preact/hooks';
import { announce, showToast } from '../../app/state';
import {
  applyStudyImport,
  clearAll,
  exportStudy,
  readStudyFile,
  studyCounts,
  studyFileName,
  studyStatus,
} from '../../app/study';
import type { ImportMode, ParsedImport } from '../../app/study';
import { feedback } from '../../lib/feedback';
import { StudyIcon } from './icons';
import { describeCounts, friendlyDate, plural } from './model';
import { StudyDialog } from './StudyDialog';

const STATUS_TEXT = {
  unavailable: 'This browser isn’t letting Rootword save (storage is turned off, e.g. in some private windows). What you add now disappears when this tab closes — export a copy to keep it.',
  full: 'This browser’s storage is full, so recent changes aren’t saved. Export a copy, then free some space (or delete old notes).',
  newer: 'Your study was saved by a newer version of Rootword. Reload the page to update — until then, changes here won’t be saved.',
} as const;

/** Import a file and say what happened (exported for the empty states' "Import a backup" link). */
export function useImporter() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; parsed: ParsedImport } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = () => {
    setError(null);
    input.current?.click();
  };
  const onFile = async (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    const res = await readStudyFile(file);
    if (!res.ok) {
      setError(res.error);
      feedback('error');
      announce(res.error);
      return;
    }
    setError(null);
    setPending({ name: file.name, parsed: res.value });
  };
  const apply = (mode: ImportMode) => {
    if (!pending) return;
    const s = applyStudyImport(pending.parsed, mode);
    setPending(null);
    feedback('success');
    const what = s.added.total ? describeCounts(s.added) : 'nothing new';
    const extra = [s.combined ? `${plural(s.combined, 'note')} combined` : '', s.kept ? `${s.kept} kept as you had ${s.kept === 1 ? 'it' : 'them'}` : '']
      .filter(Boolean)
      .join('; ');
    const msg = mode === 'replace' ? `Replaced with ${describeCounts(pending.parsed.counts)}` : `Imported ${what}${extra ? ` (${extra})` : ''}`;
    showToast(msg, 4200);
  };

  const fileInput = (
    <input ref={input} type="file" accept="application/json,.json" hidden aria-label="Choose a Rootword study file" onChange={onFile} />
  );

  const have = studyCounts.value.total;
  const p = pending?.parsed;
  const dialog = (
    <StudyDialog
      open={Boolean(pending)}
      id="ms-import"
      title="Import study notes?"
      onClose={() => setPending(null)}
      actions={
        <>
          <button type="button" class="ms-btn ms-btn--primary" data-autofocus onClick={() => apply('merge')}>
            {have ? 'Merge with mine' : 'Import'}
          </button>
          {have > 0 && (
            <button type="button" class="ms-btn ms-btn--quiet-danger" onClick={() => apply('replace')}>
              Replace mine
            </button>
          )}
          <button type="button" class="ms-btn" onClick={() => setPending(null)}>
            Cancel
          </button>
        </>
      }
    >
      {p && (
        <>
          <p>
            <b class="ms-dlg__file">{pending!.name}</b> has {describeCounts(p.counts)}
            {p.exported ? `, exported ${friendlyDate(p.exported)}` : ''}.
          </p>
          {p.skipped > 0 && <p class="ms-dlg__warn">{plural(p.skipped, 'entry', 'entries')} in it couldn’t be read and will be skipped.</p>}
          {have > 0 && (
            <p>
              <b>Merge</b> keeps everything you have here and adds what’s new. Where a verse has a different highlight or bookmark here, yours stays; two different notes on one verse are kept together.{' '}
              <b>Replace</b> deletes your {describeCounts(studyCounts.value)} first.
            </p>
          )}
        </>
      )}
    </StudyDialog>
  );
  return { choose, fileInput, dialog, error, clearError: () => setError(null) };
}

export function DataTools() {
  const counts = studyCounts.value;
  const status = studyStatus.value;
  const imp = useImporter();
  const [confirmClear, setConfirmClear] = useState(false);

  const doExport = () => {
    exportStudy();
    feedback('success');
    showToast(`Saved ${studyFileName()} — ${describeCounts(counts)}`, 4200);
  };
  const doClear = () => {
    const n = counts.total;
    clearAll();
    setConfirmClear(false);
    feedback('success');
    showToast(`Deleted ${plural(n, 'item')} from this browser`);
  };

  return (
    <section class="ms-data" id="ms-data" aria-labelledby="ms-data-title" tabIndex={-1}>
      <h2 class="eyebrow rail__title" id="ms-data-title">
        Your data
      </h2>
      <p class="ms-data__where">
        <StudyIcon name="shield" />
        <span>
          Kept only in this browser on this device — never sent anywhere. Clearing your browser’s site data deletes it, so export a copy now and then.
        </span>
      </p>
      {status !== 'ok' && (
        <p class="ms-data__warn" role="alert">
          {STATUS_TEXT[status]}
        </p>
      )}
      <div class="ms-data__acts">
        <button type="button" class="ms-btn" onClick={doExport} disabled={counts.total === 0} aria-describedby="ms-export-hint">
          <StudyIcon name="download" />
          <span>Export a copy</span>
        </button>
        <span class="sr-only" id="ms-export-hint">
          Downloads a JSON file you can import on another device or browser.
        </span>
        <button type="button" class="ms-btn" onClick={imp.choose}>
          <StudyIcon name="upload" />
          <span>Import…</span>
        </button>
        {imp.fileInput}
        {counts.total > 0 && (
          <button type="button" class="ms-btn ms-btn--quiet-danger" onClick={() => setConfirmClear(true)}>
            <StudyIcon name="trash" />
            <span>Delete everything…</span>
          </button>
        )}
      </div>
      {imp.error && (
        <p class="ms-data__err" role="alert">
          {imp.error}
        </p>
      )}
      {imp.dialog}
      <StudyDialog
        open={confirmClear}
        id="ms-clear"
        alert
        title="Delete all your study?"
        onClose={() => setConfirmClear(false)}
        actions={
          <>
            <button type="button" class="ms-btn" data-autofocus onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button type="button" class="ms-btn" onClick={doExport}>
              <StudyIcon name="download" />
              <span>Export a copy first</span>
            </button>
            <button type="button" class="ms-btn ms-btn--danger" onClick={doClear}>
              Delete everything
            </button>
          </>
        }
      >
        <p>
          This removes {describeCounts(counts)} from this browser. It can’t be undone — export a copy first if you might want them back.
        </p>
      </StudyDialog>
    </section>
  );
}
