import { describe, it, expect } from 'vitest';
import { FILTERS, isKnownFilter, getFilterInfo, getFilterReturnType } from './filters.js';

describe('filter table', () => {
  it('exposes the LiquidJS standard library across all categories', () => {
    const names = Object.keys(FILTERS);
    for (const expected of [
      'abs',
      'at_least',
      'at_most',
      'ceil',
      'divided_by',
      'floor',
      'minus',
      'modulo',
      'plus',
      'round',
      'times',
      'append',
      'capitalize',
      'downcase',
      'upcase',
      'lstrip',
      'rstrip',
      'strip',
      'newline_to_br',
      'prepend',
      'remove',
      'remove_first',
      'replace',
      'replace_first',
      'slice',
      'split',
      'truncate',
      'truncatewords',
      'url_decode',
      'url_encode',
      'escape',
      'escape_once',
      'strip_html',
      'strip_newlines',
      'compact',
      'concat',
      'first',
      'join',
      'last',
      'map',
      'reverse',
      'size',
      'sort',
      'sort_natural',
      'uniq',
      'where',
      'date',
      'default',
      'json',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('returns filter info with docsUrl', () => {
    const info = getFilterInfo('upcase');
    expect(info?.signature).toBe('upcase');
    expect(info?.docsUrl).toBe('https://liquidjs.com/filters/upcase.html');
    expect(info?.description).toMatch(/upper/i);
  });

  it('encodes static return types when known', () => {
    expect(getFilterReturnType('upcase')).toEqual({ kind: 'string' });
    expect(getFilterReturnType('size')).toEqual({ kind: 'number' });
    expect(getFilterReturnType('first')).toEqual({ kind: 'unknown' });
    expect(getFilterReturnType('default')).toEqual({ kind: 'unknown' });
    expect(getFilterReturnType('not_a_filter')).toEqual({ kind: 'unknown' });
  });

  it('isKnownFilter is strict', () => {
    expect(isKnownFilter('upcase')).toBe(true);
    expect(isKnownFilter('Upcase')).toBe(false);
    expect(isKnownFilter('made_up_filter')).toBe(false);
  });
});
