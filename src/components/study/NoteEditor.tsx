/**
 * A note on one verse: a roomy plain-text textarea that saves as you type (debounced) and when you
 * leave it, with a character count and a two-step Delete. Used by the verse sheet (NoteSection) and
 * the My study page. Remount it per verse (key={verseKey}) — a pending save is flushed on unmount.
 *
 * feedback('success') + a polite announcement when a changed note is saved on leaving the field
 * (not on every autosave while typing, which would buzz constantly).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { announce, showToast } from '../../app/state';
import { MAX_NOTE_LENGTH, notes, setNote } from '../../app/study';
import { feedback } from '../../lib/feedback';
import { friendlyDate } from './model';
import { StudyIcon } from './icons';

/** Autosave delay while typing. */
export const AUTOSAVE_MS = 700;

export interface NoteEditorProps {
  /** Verse key "JHN.3.16". */
  vkey: string;
  /** "John 3:16" — for labels. */
  refLabel: string;
  /** Unique id prefix for the label / hint ids. */
  idBase: string;
  /** Visible label (the verse sheet uses its section heading instead: pass labelledBy). */
  labelledBy?: string;
  autoFocus?: boolean;
  /** Shows a "Done" button (My study page inline editing). */
  onDone?: () => void;
  /** After the note was deleted. */
  onDeleted?: () => void;
  /** Initial rows before the field grows with its content. */
  rows?: number;
}

type Status = 'idle' | 'typing' | 'saved';

export function NoteEditor({ vkey, refLabel, idBase, labelledBy, autoFocus, onDone, onDeleted, rows = 4 }: NoteEditorProps) {
  const stored = notes.value[vkey];
  const [text, setText] = useState(stored?.text ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const [confirming, setConfirming] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const keepBtn = useRef<HTMLButtonElement>(null);
  const delBtn = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(text);
  const dirty = useRef(false);
  /** The text when the field gained focus — decides whether leaving it counts as a save. */
  const atFocus = useRef<string | null>(null);
  latest.current = text;

  // Another tab / an import changed the note while we aren't editing it: show the new text.
  useEffect(() => {
    if (dirty.current || document.activeElement === area.current) return;
    setText(stored?.text ?? '');
  }, [stored?.text]);

  // Two-step delete: focus "Keep it" when asked, back to "Delete note" when cancelled.
  useEffect(() => {
    if (confirming) keepBtn.current?.focus();
    else if (wasConfirming.current) delBtn.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const save = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!dirty.current) return;
    dirty.current = false;
    setNote(vkey, latest.current);
    setStatus('saved');
  };

  // Flush on unmount (sheet closed, verse changed, tab switched).
  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => area.current?.focus({ preventScroll: false }));
    return () => {
      if (dirty.current) {
        clearTimeout(timer.current);
        dirty.current = false;
        setNote(vkey, latest.current);
      }
    };
  }, []);

  const onInput = (e: Event) => {
    const v = (e.currentTarget as HTMLTextAreaElement).value;
    setText(v);
    latest.current = v;
    dirty.current = true;
    setStatus('typing');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, AUTOSAVE_MS);
  };

  const onFocus = () => {
    atFocus.current = latest.current;
  };

  /** Save now; if the text changed since the field was focused, confirm it (once). */
  const commit = () => {
    save();
    const before = atFocus.current;
    atFocus.current = null;
    if (before !== null && before.trim() !== latest.current.trim()) {
      feedback('success');
      announce(latest.current.trim() ? `Note on ${refLabel} saved` : `Note on ${refLabel} removed`);
    }
  };
  // (iOS doesn't move focus to a tapped button, so "Done" commits explicitly too)
  const onBlur = commit;

  const doDelete = () => {
    clearTimeout(timer.current);
    dirty.current = false;
    setNote(vkey, null);
    setText('');
    latest.current = '';
    atFocus.current = null;
    wasConfirming.current = false;
    setConfirming(false);
    setStatus('idle');
    feedback('success');
    showToast(`Note on ${refLabel} deleted`);
    if (onDeleted) onDeleted();
    else requestAnimationFrame(() => area.current?.focus());
  };

  const len = text.length;
  const near = len > MAX_NOTE_LENGTH * 0.9;
  const has = Boolean(text.trim()) || Boolean(stored);
  const saved = notes.value[vkey];
  const statusText = status === 'typing' ? 'Saving…' : saved ? `Saved ${friendlyDate(saved.updated)}` : 'Saves as you type';

  return (
    <div class="ms-note">
      <textarea
        ref={area}
        id={`${idBase}-text`}
        class="ms-note__area"
        rows={rows}
        maxLength={Math.max(MAX_NOTE_LENGTH, stored?.text.length ?? 0)}
        value={text}
        placeholder={`Write a note on ${refLabel}…`}
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : `Note on ${refLabel}`}
        aria-describedby={`${idBase}-status ${idBase}-count`}
        spellcheck
        onInput={onInput}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => {
          // Ctrl / ⌘ + Enter: save and finish.
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            area.current?.blur();
            onDone?.();
          }
        }}
      />
      <div class="ms-note__foot">
        <span class="ms-note__status" id={`${idBase}-status`}>
          {saved && status !== 'typing' ? <StudyIcon name="check" class="ms-note__ok" /> : null}
          {statusText}
          <span class="ms-note__where"> · only in this browser</span>
        </span>
        <span class={`ms-note__count tnum${near ? ' is-near' : ''}`} id={`${idBase}-count`}>
          {len.toLocaleString('en')} / {MAX_NOTE_LENGTH.toLocaleString('en')}
          <span class="sr-only"> characters</span>
        </span>
      </div>
      {(has || onDone) && (
        <div class="ms-note__acts">
          {confirming ? (
            <div class="ms-note__confirm" role="group" aria-label={`Delete the note on ${refLabel}?`}>
              <span class="ms-note__q">Delete this note?</span>
              <button type="button" class="ms-btn ms-btn--danger ms-btn--sm" onClick={doDelete}>
                Delete
              </button>
              <button type="button" class="ms-btn ms-btn--sm" ref={keepBtn} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          ) : (
            <>
              {has && (
                <button type="button" class="ms-btn ms-btn--quiet-danger ms-btn--sm" ref={delBtn} onClick={() => setConfirming(true)}>
                  <StudyIcon name="trash" />
                  <span>Delete note</span>
                </button>
              )}
              {onDone && (
                <button
                  type="button"
                  class="ms-btn ms-btn--primary ms-btn--sm"
                  onClick={() => {
                    commit();
                    onDone();
                  }}
                >
                  Done
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
