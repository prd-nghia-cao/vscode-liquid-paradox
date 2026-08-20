import { describe, it, expect } from 'vitest';
import { getHtmlContext, getHtmlService, isInHtmlRegion } from './htmlService.js';

let version = 0;
function setup(withMarker: string) {
  const offset = withMarker.indexOf('|');
  const text = withMarker.slice(0, offset) + withMarker.slice(offset + 1);
  const ctx = getHtmlContext('file:///service.liquid', ++version, text);
  const position = ctx.virtualDoc.positionAt(offset);
  return { text, offset, position, ctx };
}

function completionLabels(withMarker: string): string[] {
  const { ctx, position } = setup(withMarker);
  return getHtmlService()
    .doComplete(ctx.virtualDoc, position, ctx.htmlDoc)
    .items.map((i) => i.label);
}

function inHtmlRegion(withMarker: string): boolean {
  const { text, offset, ctx } = setup(withMarker);
  return isInHtmlRegion(text, offset, ctx.spans);
}

describe('HTML completions in HTML regions', () => {
  it('offers tag names after <', () => {
    expect(completionLabels('<di|')).toContain('div');
  });

  it('offers attribute names inside an open tag', () => {
    expect(completionLabels('<a hre|>')).toContain('href');
  });

  it('offers attribute values for known attributes', () => {
    expect(completionLabels('<input type="|">')).toContain('text');
  });
});

describe('HTML features are gated out of Liquid regions', () => {
  it('is silent inside {% … %}', () => {
    expect(inHtmlRegion('{% if di|v %}')).toBe(false);
  });

  it('is silent inside {{ … }}', () => {
    expect(inHtmlRegion('{{ a|}}')).toBe(false);
  });

  it('is silent inside {# … #}', () => {
    expect(inHtmlRegion('<a>{# a| #}</a>')).toBe(false);
  });

  it('is active in the HTML body', () => {
    expect(inHtmlRegion('<di|v>')).toBe(true);
  });
});

describe('HTML hover', () => {
  it('returns documentation for an HTML element', () => {
    const { ctx, position } = setup('<inp|ut>');
    const hover = getHtmlService().doHover(ctx.virtualDoc, position, ctx.htmlDoc);
    expect(hover).toBeTruthy();
    expect(JSON.stringify(hover).toLowerCase()).toContain('input');
  });

  it('is gated off inside {{ … }} so Liquid hover stays authoritative', () => {
    expect(inHtmlRegion('{{ ti|tle }}')).toBe(false);
  });
});

describe('HTML region gating', () => {
  it('rejects a position inside a Liquid tag', () => {
    expect(inHtmlRegion('{% if a >| 1 %}')).toBe(false);
  });

  it('rejects a position inside a Liquid tag body', () => {
    expect(inHtmlRegion('{% ren|der x %}')).toBe(false);
  });
});
