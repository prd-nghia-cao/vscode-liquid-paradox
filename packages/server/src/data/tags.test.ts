import { describe, it, expect } from 'vitest';
import { TAGS, isKnownTag, getTagInfo, isClosingTag, getOpeningForClosing, isRenderTag } from './tags.js';

describe('tag table', () => {
  it('exposes all LiquidJS standard tags including closing forms', () => {
    const names = Object.keys(TAGS);
    for (const expected of [
      'if',
      'endif',
      'unless',
      'endunless',
      'for',
      'endfor',
      'case',
      'when',
      'else',
      'endcase',
      'assign',
      'capture',
      'endcapture',
      'render',
      'include',
      'layout',
      'tablerow',
      'endtablerow',
      'cycle',
      'increment',
      'decrement',
      'raw',
      'endraw',
      'comment',
      'endcomment',
      'liquid',
      'echo',
      'break',
      'continue',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('isKnownTag returns true for known tags and false for unknown', () => {
    expect(isKnownTag('if')).toBe(true);
    expect(isKnownTag('endif')).toBe(true);
    expect(isKnownTag('flarp')).toBe(false);
  });

  it('getTagInfo returns description + syntax + docsUrl', () => {
    const info = getTagInfo('for');
    expect(info?.description).toMatch(/iterate/i);
    expect(info?.syntax).toContain('{% for');
    expect(info?.docsUrl).toBe('https://liquidjs.com/tags/for.html');
  });

  it('knows the Paradox renderKeep tag and treats it as a render tag', () => {
    expect(isKnownTag('renderKeep')).toBe(true);
    expect(getTagInfo('renderKeep')?.docsUrl).toBe('https://liquidjs.com/tags/render.html');
    expect(isRenderTag('render')).toBe(true);
    expect(isRenderTag('renderKeep')).toBe(true);
    expect(isRenderTag('include')).toBe(false);
  });

  it('knows the Paradox platform block and has no LiquidJS docs link for it', () => {
    expect(isKnownTag('platform')).toBe(true);
    expect(getOpeningForClosing('endplatform')).toBe('platform');
    expect(getTagInfo('platform')?.docsUrl).toBeUndefined();
  });

  it('classifies closing tags', () => {
    expect(isClosingTag('endif')).toBe(true);
    expect(isClosingTag('if')).toBe(false);
    expect(getOpeningForClosing('endif')).toBe('if');
    expect(getOpeningForClosing('endcapture')).toBe('capture');
    expect(getOpeningForClosing('if')).toBeUndefined();
  });
});
