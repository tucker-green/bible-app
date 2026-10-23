/**
 * Runs of a definition's plain text (pure, unit-tested): Strong's numbers to link to their word
 * studies ("H3068G", "G25"), Greek and Hebrew to tag with their language (so screen readers switch
 * voice and the right typeface / direction applies), and English. Used by DefText for every text node
 * the whitelist parser (definition.ts) produced — the card, the word-study page and entity pages.
 */
import { scriptRuns } from '../search/model';
import { splitStrongs } from '../wordstudy/model';

export type DefRun =
  | { t: 'text'; v: string }
  | { t: 'orig'; v: string; lang: 'grc' | 'he' }
  | { t: 'strongs'; id: string; label: string };

export function defRuns(text: string): DefRun[] {
  const out: DefRun[] = [];
  for (const p of splitStrongs(text)) {
    if (p.t === 'id') {
      out.push({ t: 'strongs', id: p.id, label: p.label });
      continue;
    }
    for (const r of scriptRuns(p.v)) out.push(r.lang ? { t: 'orig', v: r.text, lang: r.lang } : { t: 'text', v: r.text });
  }
  return out;
}
