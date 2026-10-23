/**
 * Settings → Translations: "Connect API.Bible (for the NIV)".
 *
 * The reader pastes their own API.Bible key → GET /bibles?language=eng lists the English Bibles on
 * their plan (the NIV preselected) → they choose which to add → each becomes a remote translation
 * (src/app/remote.ts) with approximate (bridged) word links. The key is kept only in localStorage
 * "rootword:apibible" and sent only to API.Bible; it is never rendered back or logged.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  apiBibleConnection,
  APIBIBLE_HOME_URL,
  APIBIBLE_SIGNUP_URL,
  compactCopyright,
  connectApiBible,
  disconnectApiBible,
  explainApiBibleError,
  remoteProblem,
  removeApiBible,
  saveApiBibles,
} from '../../app/remote';
import type { BibleChoice } from '../../app/remote';
import { announce, closeSettings, navigate, passage } from '../../app/state';
import { feedback } from '../../lib/feedback';
import { ApiBibleError } from '../../lib/providers/apibible';
import { formatChapter } from '../../lib/reference';
import { Icon } from '../common/Icon';
import { Meter } from '../common/Meter';
import { Section } from './controls';

type Phase = 'form' | 'connecting' | 'choose' | 'saving';

/** Message for a failed connect (GET /bibles). */
export function connectError(err: unknown): string {
  if (err instanceof ApiBibleError && err.kind === 'forbidden') {
    return 'API.Bible refused that key (HTTP 403). Check that you copied the whole key and that your app at api.bible is active.';
  }
  return explainApiBibleError(err, { what: 'the list of Bibles', tr: 'the list of Bibles' });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const KEY_INPUT_ID = 'st-api-key';

export function TranslationsSection() {
  const conn = apiBibleConnection.value;
  const problem = remoteProblem.value;
  const [phase, setPhase] = useState<Phase>('form');
  const [editingKey, setEditingKey] = useState(false);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<BibleChoice[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState('');
  const [filter, setFilter] = useState('');
  const [done, setDone] = useState<{ text: string; read?: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listTop = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (confirmOff) confirmRef.current?.focus();
  }, [confirmOff]);

  const { tr: curTr, ref } = passage.value;
  const chapterLabel = formatChapter(ref.book, ref.chapter);

  /** GET /bibles with `key`, then show the choice list. */
  const listFor = async (key: string, fromForm: boolean) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setPhase('connecting');
    setError(null);
    setDone(null);
    try {
      const list = await connectApiBible(key, { signal: ac.signal });
      if (ac.signal.aborted) return;
      if (!list.length) {
        setError('Your API.Bible plan has no English Bibles yet. Add some (the NIV, for example) to your app at api.bible, then try again.');
        setPhase('form');
        feedback('error');
        return;
      }
      setChoices(list);
      setChecked(new Set(list.filter((c) => c.checked).map((c) => c.bible.id)));
      setPendingKey(key.trim());
      setFilter('');
      setPhase('choose');
      feedback('success');
      announce(`${fromForm ? 'Key accepted. ' : ''}${plural(list.length, 'English Bible')} on your plan. Choose which to add.`);
      requestAnimationFrame(() => listTop.current?.focus({ preventScroll: false }));
    } catch (err) {
      if (ac.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      setError(connectError(err));
      setPhase('form');
      feedback('error');
      if (fromForm) requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onConnect = (e: Event) => {
    e.preventDefault();
    if (phase === 'connecting') return;
    const k = draft.trim();
    if (!k) {
      setError('Paste your API.Bible key first.');
      inputRef.current?.focus();
      return;
    }
    void listFor(k, true);
  };

  const onSave = async () => {
    const chosen = choices.filter((c) => checked.has(c.bible.id) && !c.bundled);
    setPhase('saving');
    setError(null);
    try {
      const r = await saveApiBibles(pendingKey, chosen);
      setPhase('form');
      setEditingKey(false);
      setDraft('');
      setShow(false);
      setConfirmOff(false);
      const names = r.added.map((b) => b.abbr);
      let text = names.length ? `Added the ${names.join(', the ')}.` : r.kept.length ? 'Saved.' : 'Key saved. No Bibles added.';
      if (r.skipped.length) text += ` Not added: ${r.skipped.map((s) => s.message).join(' ')}`;
      const read = r.added[0]?.abbr ?? (r.kept.length && !r.kept.some((b) => b.abbr === curTr) ? r.kept[0].abbr : undefined);
      setDone({ text, read });
      announce(text);
      feedback(r.skipped.length && !names.length ? 'error' : 'success');
    } catch (err) {
      setError(connectError(err));
      setPhase('choose');
      feedback('error');
    }
  };

  const cancelChoose = () => {
    abort.current?.abort();
    setPhase('form');
    setError(null);
  };

  const readIn = (abbr: string) => {
    closeSettings();
    navigate({ book: ref.book, chapter: ref.chapter }, abbr);
  };

  /* ---- views ---------------------------------------------------------- */

  const keyForm = (
    <form class="st-key" onSubmit={onConnect} noValidate>
      {!conn && (
        <ol class="st-steps">
          <li>
            Create a free account and an app at{' '}
            <a href={APIBIBLE_SIGNUP_URL} target="_blank" rel="noopener noreferrer">
              api.bible<span class="sr-only"> (opens in a new tab)</span>
            </a>
            .
          </li>
          <li>Add the New International Version to the Bibles your app may use.</li>
          <li>Copy the app’s API key and paste it here.</li>
        </ol>
      )}
      <label class="st-field__lbl" for={KEY_INPUT_ID}>
        {conn ? 'New API.Bible key' : 'API.Bible key'}
      </label>
      <div class={`st-key__row${error ? ' is-invalid' : ''}`}>
        <div class="st-key__field">
          <input
            ref={inputRef}
            id={KEY_INPUT_ID}
            class="st-input st-input--key"
            type={show ? 'text' : 'password'}
            value={draft}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellcheck={false}
            data-1p-ignore
            data-lpignore="true"
            placeholder="Paste your key"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={`st-key-help${error ? ' st-key-err' : ''}`}
            onInput={(e) => {
              setDraft((e.currentTarget as HTMLInputElement).value);
              if (error) setError(null);
            }}
          />
          <button type="button" class="st-key__show" aria-pressed={show} aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <button type="submit" class="st-btn st-btn--primary" aria-disabled={phase === 'connecting' ? 'true' : undefined}>
          {phase === 'connecting' ? (
            <>
              <span class="st-spin" aria-hidden="true" /> Checking…
            </>
          ) : (
            'Connect'
          )}
        </button>
      </div>
      {error && (
        <p class="st-error" id="st-key-err" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      )}
      <p class="st-field__hint" id="st-key-help">
        Your key is stored only in this browser and sent only to API.Bible. Disconnect removes it.
      </p>
      {conn && (
        <button
          type="button"
          class="st-btn st-btn--quiet"
          onClick={() => {
            abort.current?.abort();
            setEditingKey(false);
            setDraft('');
            setError(null);
            setPhase('form');
          }}
        >
          Keep the current key
        </button>
      )}
    </form>
  );

  const shown = filter.trim()
    ? choices.filter((c) => `${c.tr} ${c.name} ${c.bible.abbreviation} ${c.bible.description ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : choices;
  const nChosen = choices.filter((c) => checked.has(c.bible.id) && !c.bundled).length;
  const hasNiv = choices.some((c) => c.isNiv);
  const chooser = (
    <div class="st-choose" aria-busy={phase === 'saving' ? 'true' : undefined}>
      <div class="st-choose__head" ref={listTop} tabIndex={-1}>
        <p class="st-ok">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          {conn && pendingKey === conn.key ? 'Your Bibles from API.Bible' : 'Your key works.'}
        </p>
        <p class="st-sec__lede">
          {plural(choices.length, 'English Bible')} on your plan. Choose the ones to read in Rootword.
        </p>
      </div>
      {!hasNiv && (
        <p class="st-info" role="note">
          <Icon name="info" />
          <span>
            The NIV isn’t on your API.Bible plan. In your app at{' '}
            <a href={APIBIBLE_HOME_URL} target="_blank" rel="noopener noreferrer">
              api.bible<span class="sr-only"> (opens in a new tab)</span>
            </a>
            , add “New International Version” to its Bibles, then{' '}
            <button type="button" class="link-btn" onClick={() => void listFor(pendingKey, false)}>
              check again
            </button>
            .
          </span>
        </p>
      )}
      {choices.length > 8 && (
        <div class="st-filter">
          <label class="sr-only" for="st-bible-filter">
            Filter Bibles
          </label>
          <input
            id="st-bible-filter"
            class="st-input"
            type="search"
            placeholder="Filter by name or abbreviation"
            value={filter}
            onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
      )}
      <fieldset class="st-bibles">
        <legend class="sr-only">English Bibles on your API.Bible plan</legend>
        <ul>
          {shown.map((c) => {
            const id = `st-bible-${c.bible.id.replace(/[^A-Za-z0-9_-]/g, '')}`;
            const note = [c.year, c.bundled ? 'already in Rootword, with better word links' : c.added ? 'added' : ''].filter(Boolean).join(' · ');
            return (
              <li key={c.bible.id}>
                <label class={`st-bible${c.bundled ? ' is-bundled' : ''}`} for={id}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={!c.bundled && checked.has(c.bible.id)}
                    disabled={c.bundled || phase === 'saving'}
                    aria-describedby={note ? `${id}-d` : undefined}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if ((e.currentTarget as HTMLInputElement).checked) next.add(c.bible.id);
                      else next.delete(c.bible.id);
                      setChecked(next);
                    }}
                  />
                  <span class="st-bible__abbr">{c.tr}</span>
                  <span class="st-bible__name">
                    {c.name}
                    {note && <small id={`${id}-d`}>{note}</small>}
                  </span>
                </label>
              </li>
            );
          })}
          {!shown.length && <li class="st-fine">No Bible matches “{filter}”.</li>}
        </ul>
      </fieldset>
      {error && (
        <p class="st-error" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      )}
      <div class="st-actions">
        <button
          type="button"
          class="st-btn st-btn--primary"
          aria-disabled={phase === 'saving' || (!conn && nChosen === 0) ? 'true' : undefined}
          onClick={() => {
            if (phase === 'saving' || (!conn && nChosen === 0)) return;
            void onSave();
          }}
        >
          {phase === 'saving' ? (
            <>
              <span class="st-spin" aria-hidden="true" /> Saving…
            </>
          ) : conn ? (
            'Save'
          ) : nChosen ? (
            `Add ${plural(nChosen, 'Bible')}`
          ) : (
            'Add Bibles'
          )}
        </button>
        <button type="button" class="st-btn st-btn--quiet" onClick={cancelChoose}>
          Cancel
        </button>
      </div>
    </div>
  );

  const connected = conn && (
    <div class="st-conn">
      <p class="st-ok">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        Connected to API.Bible · key saved in this browser
      </p>
      {done && (
        <div class="st-done" role="status">
          <span>{done.text}</span>
          {done.read && (
            <button type="button" class="st-btn st-btn--primary" onClick={() => readIn(done.read!)}>
              Read {chapterLabel} in the {done.read}
            </button>
          )}
        </div>
      )}
      {conn.bibles.length ? (
        <ul class="st-remotes" aria-label="Bibles from API.Bible">
          {conn.bibles.map((b) => (
            <li key={b.abbr} class="st-remote">
              <span class="st-bible__abbr">{b.abbr}</span>
              <span class="st-bible__name">
                {b.name}
                <small>{[b.year, compactCopyright(b.copyright)].filter(Boolean).join(' · ')}</small>
                <span class="st-remote__via">
                  <Meter kind="bridged" /> <span aria-hidden="true">·</span> via API.Bible
                </span>
              </span>
              <span class="st-remote__acts">
                {b.abbr !== curTr && b.abbr !== done?.read && (
                  <button type="button" class="st-btn st-btn--quiet st-btn--sm" aria-label={`Read ${chapterLabel} in the ${b.abbr}`} onClick={() => readIn(b.abbr)}>
                    Read
                  </button>
                )}
                <button
                  type="button"
                  class="st-btn st-btn--quiet st-btn--sm"
                  aria-label={`Remove the ${b.abbr}`}
                  onClick={() => {
                    removeApiBible(b.abbr);
                    setDone(null);
                    announce(`Removed the ${b.abbr}.`);
                    feedback('success');
                  }}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="st-fine">No Bibles added yet.</p>
      )}
      {problem && conn.bibles.some((b) => b.abbr === problem.tr) && (
        <p class="st-error" role="note">
          <Icon name="alert" />
          <span>
            {problem.message}
          </span>
        </p>
      )}
      {error && (
        <p class="st-error" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      )}
      <div class="st-actions">
        <button type="button" class="st-btn st-btn--quiet" aria-disabled={phase === 'connecting' ? 'true' : undefined} onClick={() => phase !== 'connecting' && void listFor(conn.key, false)}>
          {phase === 'connecting' ? (
            <>
              <span class="st-spin" aria-hidden="true" /> Checking…
            </>
          ) : (
            'Add or remove Bibles'
          )}
        </button>
        <button
          type="button"
          class="st-btn st-btn--quiet"
          onClick={() => {
            setEditingKey(true);
            setError(null);
            setDone(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          Change key
        </button>
        {!confirmOff ? (
          <button type="button" class="st-btn st-btn--quiet st-btn--danger" onClick={() => setConfirmOff(true)}>
            Disconnect
          </button>
        ) : (
          <span class="st-confirm" role="group" aria-label="Confirm disconnect">
            <span>Forget the key and remove {conn.bibles.length === 1 ? `the ${conn.bibles[0].abbr}` : 'these Bibles'}?</span>
            <button
              type="button"
              class="st-btn st-btn--danger-solid"
              ref={confirmRef}
              onClick={() => {
                disconnectApiBible();
                setConfirmOff(false);
                setDone(null);
                setPhase('form');
                announce('Disconnected from API.Bible. The key was removed from this browser.');
                feedback('success');
              }}
            >
              Disconnect
            </button>
            <button type="button" class="st-btn st-btn--quiet" onClick={() => setConfirmOff(false)}>
              Keep
            </button>
          </span>
        )}
      </div>
    </div>
  );

  const choosing = phase === 'choose' || phase === 'saving';
  return (
    <Section
      id="translations"
      title="Translations"
      lede={
        !conn && !choosing ? (
          <>
            <strong>Connect API.Bible for the NIV.</strong> The NIV is copyrighted (© Biblica), so Rootword never bundles it. With your own free API.Bible key, this
            browser fetches each chapter straight from API.Bible. Greek and Hebrew links are matched automatically, so they are approximate.
          </>
        ) : undefined
      }
    >
      {choosing ? chooser : conn && !editingKey ? connected : keyForm}
      <p class="st-fine st-trs-note">
        <Meter kind="bridged" /> — word links matched automatically through the BSB, not by hand. The KJV opens first and is used whenever an API.Bible
        translation is unavailable.
      </p>
    </Section>
  );
}
