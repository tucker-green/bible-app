import type { ComponentChildren } from 'preact';
import { formatReference } from '../../lib/reference';
import type { VerseRef } from '../../lib/types';
import type { DefNode } from './definition';

interface RefHandlers {
  /** Link target for a verse reference (a reading route). */
  hrefFor: (ref: VerseRef) => string;
  /** Called when a reference is followed (e.g. to close the card). */
  onRef?: (ref: VerseRef) => void;
}

/**
 * Render parsed definition nodes (see definition.ts). Only <b>, <i>, <br> and verse-reference
 * links are ever produced; text goes through Preact (escaped).
 */
export function DefText({ nodes, hrefFor, onRef }: { nodes: DefNode[] } & RefHandlers) {
  return <>{renderNodes(nodes, { hrefFor, onRef })}</>;
}

function renderNodes(nodes: DefNode[], h: RefHandlers): ComponentChildren[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.v;
      case 'br':
        return <br key={i} />;
      case 'b':
        return <b key={i}>{renderNodes(n.c, h)}</b>;
      case 'i':
        return <i key={i}>{renderNodes(n.c, h)}</i>;
      case 'ref':
        return (
          <a key={i} class="ref" href={h.hrefFor(n.ref)} title={formatReference(n.ref)} onClick={() => h.onRef?.(n.ref)}>
            {renderNodes(n.c, h)}
          </a>
        );
    }
  });
}
