import type { ComponentChildren } from 'preact';
import { preloadPage } from '../../app/pages';
import { formatReference } from '../../lib/reference';
import type { VerseRef } from '../../lib/types';
import type { DefNode } from './definition';
import { defRuns } from './defRuns';

interface RefHandlers {
  /** Link target for a verse reference (a reading route). */
  hrefFor: (ref: VerseRef) => string;
  /** Called when a reference is followed (e.g. to close the card). */
  onRef?: (ref: VerseRef) => void;
}

/**
 * Render parsed definition nodes (see definition.ts). Only <b>, <i>, <br>, verse-reference links,
 * Strong's-number links (to #/word/{id}) and lang-tagged Greek / Hebrew spans are ever produced; text
 * goes through Preact (escaped).
 */
export function DefText({ nodes, hrefFor, onRef }: { nodes: DefNode[] } & RefHandlers) {
  return <>{renderNodes(nodes, { hrefFor, onRef })}</>;
}

function renderText(text: string, key: number, inLink: boolean): ComponentChildren {
  const runs = defRuns(text);
  if (runs.length === 1 && runs[0].t === 'text') return runs[0].v;
  return runs.map((r, j) => {
    const k = `${key}.${j}`;
    if (r.t === 'text') return r.v;
    if (r.t === 'strongs' && inLink) return r.label; // never an <a> inside an <a>
    if (r.t === 'orig') {
      return (
        <span key={k} lang={r.lang} dir={r.lang === 'he' ? 'rtl' : undefined}>
          {r.v}
        </span>
      );
    }
    return (
      <a key={k} class="sn" href={`#/word/${r.id}`} onPointerEnter={() => preloadPage('word')} onFocus={() => preloadPage('word')}>
        {r.label}
      </a>
    );
  });
}

function renderNodes(nodes: DefNode[], h: RefHandlers, inLink = false): ComponentChildren[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return renderText(n.v, i, inLink);
      case 'br':
        return <br key={i} />;
      case 'b':
        return <b key={i}>{renderNodes(n.c, h, inLink)}</b>;
      case 'i':
        return <i key={i}>{renderNodes(n.c, h, inLink)}</i>;
      case 'ref':
        return (
          <a key={i} class="ref" href={h.hrefFor(n.ref)} title={formatReference(n.ref)} onClick={() => h.onRef?.(n.ref)}>
            {renderNodes(n.c, h, true)}
          </a>
        );
    }
  });
}
