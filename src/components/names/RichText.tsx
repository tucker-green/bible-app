/**
 * Renders parsed TIPNR summary nodes (src/components/word/definition.ts: only <b>, <i>, <br> and
 * verse references survive parsing; text is escaped by Preact). Hebrew and Greek runs get their
 * lang (and dir) so they take the right font and voice; references are links into the reader.
 */
import type { ComponentChildren } from 'preact';
import { formatReference, refToHash } from '../../lib/reference';
import type { DefNode } from '../word/definition';
import { scriptRuns } from './model';

export function LangText({ text }: { text: string }) {
  const runs = scriptRuns(text);
  if (runs.length === 1 && !runs[0].lang) return <>{text}</>;
  return (
    <>
      {runs.map((r, i) =>
        r.lang ? (
          <span key={i} lang={r.lang} dir={r.lang === 'he' ? 'rtl' : undefined} class={`rt-${r.lang}`}>
            {r.text}
          </span>
        ) : (
          r.text
        ),
      )}
    </>
  );
}

export function RichText({ nodes, tr, onRef }: { nodes: DefNode[]; tr: string; onRef?: () => void }) {
  return <>{render(nodes, tr, onRef)}</>;
}

function render(nodes: DefNode[], tr: string, onRef?: () => void): ComponentChildren[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <LangText key={i} text={n.v} />;
      case 'br':
        return <br key={i} />;
      case 'b':
        return <b key={i}>{render(n.c, tr, onRef)}</b>;
      case 'i':
        return <i key={i}>{render(n.c, tr, onRef)}</i>;
      case 'ref':
        return (
          <a key={i} class="ref" href={refToHash(tr, n.ref)} title={formatReference(n.ref)} onClick={onRef}>
            {render(n.c, tr, onRef)}
          </a>
        );
    }
  });
}
