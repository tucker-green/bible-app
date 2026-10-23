import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import type { DefNode } from '../../src/components/word/definition';
import { decodeEntities, defToText, parseDefinition, parseRefId, splitDefinitionHead } from '../../src/components/word/definition';
import { DefText } from '../../src/components/word/DefText';

/** Every node type must be one of the whitelisted kinds, recursively. */
function allowedOnly(nodes: DefNode[]): boolean {
  return nodes.every((n) => {
    if (n.t === 'text' || n.t === 'br') return true;
    if (n.t === 'b' || n.t === 'i' || n.t === 'ref') return allowedOnly(n.c);
    return false;
  });
}

function renderHtml(def: string): string {
  const el = document.createElement('div');
  render(h(DefText, { nodes: parseDefinition(def), hrefFor: (r) => `#/KJV/${r.book}/${r.chapter}/${r.verse ?? ''}` }), el);
  return el.innerHTML;
}

describe('definition whitelist parser', () => {
  it('keeps <b>, <i>, <br> and verse references', () => {
    const nodes = parseDefinition('<b>λόγος</b>, -ου, ὁ<br>a <i>word</i>: <span class="ref" data-ref="JHN.1.1">John 1:1</span>');
    expect(nodes).toEqual([
      { t: 'b', c: [{ t: 'text', v: 'λόγος' }] },
      { t: 'text', v: ', -ου, ὁ' },
      { t: 'br' },
      { t: 'text', v: 'a ' },
      { t: 'i', c: [{ t: 'text', v: 'word' }] },
      { t: 'text', v: ': ' },
      { t: 'ref', id: 'JHN.1.1', ref: { book: 'JHN', chapter: 1, verse: 1 }, c: [{ t: 'text', v: 'John 1:1' }] },
    ]);
  });

  it('decodes entities into plain text', () => {
    expect(parseDefinition('a &amp; b &lt;c&gt; &quot;q&quot; &#955;&#x3BF;')).toEqual([{ t: 'text', v: 'a & b <c> "q" λο' }]);
    expect(decodeEntities('&bogus; &#0; &#xD800;')).toBe('&bogus; &#0; &#xD800;');
  });

  it('drops scripts, event handlers and unknown tags', () => {
    const hostile = [
      '<script>alert(1)</script>safe',
      '<img src=x onerror="alert(1)">safe',
      '<b onclick="alert(1)" style="x">safe</b>',
      '<a href="javascript:alert(1)">safe</a>',
      '<iframe src="https://evil.example"></iframe>safe',
      '<svg><script>alert(1)</script></svg>safe',
      '<span class="ref" data-ref="javascript:alert(1)">safe</span>',
      '<span class="ref" data-ref="JHN.99.1">safe</span>',
      '<span class="evil" onmouseover="alert(1)">safe</span>',
      '<style>body{display:none}</style>safe',
      '<<b>>safe',
      '</b></i></span>safe',
      '<b><i>safe',
      '<scr<script>ipt>alert(1)</script>safe',
    ];
    for (const s of hostile) {
      const nodes = parseDefinition(s);
      expect(allowedOnly(nodes), s).toBe(true);
      expect(defToText(nodes), s).toContain('safe');
      expect(defToText(nodes), s).not.toMatch(/alert\(1\)(?!.*safe)|javascript:|onerror|onclick/);
      const html = renderHtml(s);
      expect(html, s).not.toMatch(/<(script|img|iframe|svg|style|a href="javascript)/i);
      expect(html, s).not.toMatch(/\son\w+=/i);
    }
  });

  it('renders only whitelisted markup (text is escaped)', () => {
    const html = renderHtml('x <b>y</b><br>&lt;img src=x onerror=1&gt; <span class="ref" data-ref="MAT.5.43">Matt 5:43</span>');
    expect(html).toContain('<b>y</b><br>');
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
    expect(html).toContain('<a class="ref" href="#/KJV/MAT/5/43"');
  });

  it('treats invalid refs as plain text', () => {
    const nodes = parseDefinition('<span class="ref" data-ref="XYZ.1.1">see</span> and <span class="ref" data-ref="GEN.51.1">no</span>');
    expect(nodes).toEqual([{ t: 'text', v: 'see and no' }]);
  });

  it('validates reference ids', () => {
    expect(parseRefId('1CO.14.19')).toEqual({ book: '1CO', chapter: 14, verse: 19 });
    expect(parseRefId('GEN.50')).toEqual({ book: 'GEN', chapter: 50 });
    expect(parseRefId('GEN.51.1')).toBeNull();
    expect(parseRefId('JHN.1.0')).toBeNull();
    expect(parseRefId('../../x')).toBeNull();
  });

  it('trims leading and trailing breaks and empty formatting', () => {
    expect(parseDefinition('<br><b></b>x<br><br>')).toEqual([{ t: 'text', v: 'x' }]);
  });
});

describe('definition heading', () => {
  it('lifts a compact Abbott-Smith heading out of the body', () => {
    const nodes = parseDefinition('<b>λόγος</b>, -ου, ὁ (λέγω)<br>I. Of that by which…');
    const { head, body } = splitDefinitionHead(nodes, 'λόγος');
    expect(defToText(head!)).toBe('λόγος, -ου, ὁ (λέγω)');
    expect(defToText(body)).toBe('I. Of that by which…');
  });

  it('leaves definitions without a matching heading alone', () => {
    const nodes = parseDefinition('1) first, beginning<br>1a) beginning');
    expect(splitDefinitionHead(nodes, 'רֵאשִׁית')).toEqual({ head: null, body: nodes });
    const long = parseDefinition('<b>θεός</b>, -οῦ, ὁ, ἡ (Acts 19:37 only), late voc., θεέ (Matt 27:46; cf. Deut 3:24)<br>rest');
    expect(splitDefinitionHead(long, 'θεός').head).toBeNull();
  });
});
