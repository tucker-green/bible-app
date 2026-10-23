/**
 * "Meaning": the full lexicon definition through the word card's whitelist renderer
 * (word/definition.ts + word/DefText.tsx), then Strong's definition, KJV usage and derivation with
 * the Strong's numbers in them linked to their own word studies.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { preloadPage } from '../../app/pages';
import { refToHash } from '../../lib/reference';
import type { LexEntry } from '../../lib/types';
import { DefText } from '../word/DefText';
import { defToText, parseDefinition, splitDefinitionHead } from '../word/definition';
import { LangText } from '../search/parts';
import { lexSource, splitStrongs, wordHash } from './model';

/** Text with its Strong's numbers ("from G25 (ἀγαπάω)") linked to their word studies. */
export function StrongsText({ text }: { text: string }) {
  return (
    <>
      {splitStrongs(text).map((p, i) =>
        p.t === 'text' ? (
          <LangText key={i} text={p.v} />
        ) : (
          <a key={i} class="ws-sn-link" href={wordHash(p.id)} onPointerEnter={() => preloadPage('word')}>
            {p.label}
          </a>
        ),
      )}
    </>
  );
}

/** Long definitions are clamped to about this many lines until "Read the full entry". */
const CLAMP_CHARS = 700;

export function Meaning({ entry, tr, lang }: { entry: LexEntry; tr: string; lang: 'grc' | 'hbo' }) {
  const { head, body } = useMemo(() => {
    const nodes = entry.def ? parseDefinition(entry.def) : [];
    return splitDefinitionHead(nodes, entry.lemma);
  }, [entry]);
  const long = useMemo(() => defToText(body).length > CLAMP_CHARS, [body]);
  const [open, setOpen] = useState(false);
  const txt = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(long);
  useLayoutEffect(() => {
    const el = txt.current;
    if (!el || open) return;
    // jsdom has no layout (scrollHeight 0): fall back to the length estimate.
    if (el.clientHeight > 0) setOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [body, open]);
  const htmlLang = lang === 'grc' ? 'grc' : 'he';
  const facts: [string, string][] = [];
  if (entry.strongsDef) facts.push(['Strong’s definition', entry.strongsDef]);
  if (entry.kjv) facts.push(['KJV usage', entry.kjv]);
  if (entry.deriv) facts.push(['Derivation', entry.deriv]);

  return (
    <div class="ws-meaning">
      {body.length > 0 ? (
        <div class="ws-def">
          {head && (
            <p class="ws-def__head" lang={htmlLang} dir={lang === 'hbo' ? 'rtl' : undefined}>
              <DefText nodes={head} hrefFor={(ref) => refToHash(tr, ref)} />
            </p>
          )}
          <div ref={txt} id={`ws-def-${entry.id}`} class={`ws-def__txt${long && !open ? ' is-clamped' : ''}`}>
            <DefText nodes={body} hrefFor={(ref) => refToHash(tr, ref)} />
          </div>
          {long && (overflows || open) && (
            <button type="button" class="link-btn ws-def__more" aria-expanded={open} aria-controls={`ws-def-${entry.id}`} onClick={() => setOpen(!open)}>
              {open ? 'Show less' : 'Read the full entry'}
            </button>
          )}
          <p class="ws-src">{lexSource(entry)}</p>
        </div>
      ) : (
        !entry.strongsDef && <p class="ws-empty">No dictionary definition for this word.</p>
      )}
      {facts.length > 0 && (
        <dl class="ws-facts-dl">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                <StrongsText text={v} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {facts.length > 0 && <p class="ws-src">Strong’s Exhaustive Concordance (public domain)</p>}
    </div>
  );
}
