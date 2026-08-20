import { describe, it, expect } from 'vitest';
import { parseRenderArgs, renderArgNames } from './renderArgs.js';

describe('renderArgNames', () => {
  it('reads plain name: value pairs', () => {
    expect(renderArgNames(`text: 'Apply', type: 'primary'`)).toEqual(['text', 'type']);
  });

  it('ignores colons inside string values', () => {
    // The reported bug: Tailwind variant classes look like argument names.
    const args = `customClass: 'absolute bottom-2 group-odd:left-2 group-even:right-2 video-iframe-trigger'`;
    expect(renderArgNames(args)).toEqual(['customClass']);
  });

  it('ignores colons in URLs and time-like strings', () => {
    expect(renderArgNames(`href: 'https://example.com/x', at: '12:30'`)).toEqual(['href', 'at']);
  });

  it('ignores filter arguments in a value', () => {
    expect(renderArgNames(`text: title | default: 'Untitled', type: 'primary'`)).toEqual(['text', 'type']);
  });

  it('ignores commas inside string values', () => {
    expect(renderArgNames(`customClass: 'a, b', type: 'x'`)).toEqual(['customClass', 'type']);
  });

  it('handles dotted and bracketed values', () => {
    expect(renderArgNames(`link: item.video.src, alt: items[0].label`)).toEqual(['link', 'alt']);
  });

  it('reads names across multiple lines', () => {
    const args = `
      text: 'Watch Video',
      link: item.video.src,
      customClass: 'group-odd:left-2'
    `;
    expect(renderArgNames(args)).toEqual(['text', 'link', 'customClass']);
  });

  it('skips segments that are not name: value', () => {
    expect(renderArgNames(`with item as row`)).toEqual([]);
    expect(renderArgNames(`'button', text: 'x'`)).toEqual(['text']);
  });

  it('returns nothing for an empty or trailing-comma list', () => {
    expect(renderArgNames('')).toEqual([]);
    expect(renderArgNames('text: 1, ')).toEqual(['text']);
  });

  it('tolerates an unterminated string literal', () => {
    // Mid-typing state: everything after the open quote is one string.
    expect(renderArgNames(`text: 'Watch, type: `)).toEqual(['text']);
  });
});

describe('parseRenderArgs', () => {
  it('reports the offset of each name', () => {
    const args = `text: 'a', type: 'b'`;
    expect(parseRenderArgs(args)).toEqual([
      { name: 'text', nameStart: 0 },
      { name: 'type', nameStart: args.indexOf('type') },
    ]);
  });
});
