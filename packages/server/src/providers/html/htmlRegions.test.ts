import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { liquidSpans, maskNonHtml, offsetInSpans } from './htmlRegions.js';
import { buildVirtualHtmlDocument, getHtmlContext, isInHtmlRegion } from './htmlService.js';

function cursor(withMarker: string): { text: string; offset: number } {
  const offset = withMarker.indexOf('|');
  return { text: withMarker.slice(0, offset) + withMarker.slice(offset + 1), offset };
}

let version = 0;
function inHtml(withMarker: string): boolean {
  const { text, offset } = cursor(withMarker);
  const ctx = getHtmlContext('file:///regions.liquid', ++version, text);
  return isInHtmlRegion(text, offset, ctx.spans);
}

const newlineOffsets = (s: string): number[] =>
  [...s].map((c, i) => (c === '\n' ? i : -1)).filter((i) => i >= 0);

describe('maskNonHtml', () => {
  it('preserves length and line-break positions', () => {
    const text = '<p>\n  {{ user.name }}\n  {% if x %}hi{% endif %}\n</p>\n';
    const masked = maskNonHtml(text);
    expect(masked.length).toBe(text.length);
    expect(newlineOffsets(masked)).toEqual(newlineOffsets(text));
  });

  it('blanks Liquid output/tag spans but keeps HTML', () => {
    expect(maskNonHtml('<p>{{ x }}</p>')).toBe('<p>' + ' '.repeat('{{ x }}'.length) + '</p>');
    const masked = maskNonHtml('<ul>{% for i in xs %}<li></li>{% endfor %}</ul>');
    expect(masked).toContain('<ul>');
    expect(masked).toContain('<li></li>');
    expect(masked).not.toContain('{%');
  });

  it('blanks {% comment %} bodies and {# #} inline comments', () => {
    expect(maskNonHtml('<a>{% comment %}<div>{% endcomment %}</a>')).not.toContain('<div>');
    expect(maskNonHtml('<a>{# secret <div> #}</a>')).not.toContain('<div>');
  });

  it('keeps {% raw %} bodies as HTML (rendered verbatim)', () => {
    expect(maskNonHtml('<a>{% raw %}<b></b>{% endraw %}</a>')).toContain('<b></b>');
  });
});

describe('liquidSpans / offsetInSpans', () => {
  it('reports offsets that fall inside a Liquid span', () => {
    const { text, offset } = cursor('<p>{{ |x }}</p>');
    expect(offsetInSpans(liquidSpans(text), offset)).toBe(true);
  });
});

describe('buildVirtualHtmlDocument', () => {
  it('maps every offset to the same position as the source', () => {
    const text = 'line0\n<p>{{ x }}</p>\nline2';
    const real = TextDocument.create('file:///r.liquid', 'liquid', 1, text);
    const virtual = buildVirtualHtmlDocument('file:///r.liquid', 1, text);
    expect(virtual.getText().length).toBe(text.length);
    for (const off of [0, 6, 9, 15, text.length]) {
      expect(virtual.positionAt(off)).toEqual(real.positionAt(off));
    }
  });
});

describe('isInHtmlRegion boundary classification', () => {
  it('is HTML in plain body and inside an open tag', () => {
    expect(inHtml('<div |>')).toBe(true);
    expect(inHtml('<p>te|xt</p>')).toBe(true);
  });

  it('is not HTML inside output, even right after {{', () => {
    expect(inHtml('<div>{{ |x }}</div>')).toBe(false);
    expect(inHtml('<div>{{|')).toBe(false);
  });

  it('is not HTML inside {% for %} (tag straddling HTML)', () => {
    expect(inHtml('<ul>{% for |x in xs %}<li>{{ x }}</li>{% endfor %}</ul>')).toBe(false);
  });

  it('is not HTML inside a {# #} inline comment', () => {
    expect(inHtml('<a>{# com|ment #}</a>')).toBe(false);
  });

  it('is not HTML inside a {% comment %} body', () => {
    expect(inHtml('<a>{% comment %}<di|v>{% endcomment %}</a>')).toBe(false);
  });

  it('resumes HTML after the closing %}', () => {
    expect(inHtml('{% if x %}|<div>')).toBe(true);
  });
});
