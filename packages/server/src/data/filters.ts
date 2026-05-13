import type { LiquidType } from '../types.js';

export interface FilterInfo {
  name: string;
  signature: string;
  description: string;
  docsUrl: string;
  returnType: LiquidType | null;
}

const STRING: LiquidType = { kind: 'string' };
const NUMBER: LiquidType = { kind: 'number' };

function f(
  name: string,
  signature: string,
  description: string,
  returnType: LiquidType | null,
): [string, FilterInfo] {
  return [name, { name, signature, description, docsUrl: `https://liquidjs.com/filters/${name}.html`, returnType }];
}

export const FILTERS: Readonly<Record<string, FilterInfo>> = Object.freeze(
  Object.fromEntries([
    // Math
    f('abs', 'abs', 'Absolute value.', NUMBER),
    f('at_least', 'at_least(min)', 'Returns the larger of input and min.', NUMBER),
    f('at_most', 'at_most(max)', 'Returns the smaller of input and max.', NUMBER),
    f('ceil', 'ceil', 'Round up to the nearest integer.', NUMBER),
    f('divided_by', 'divided_by(divisor)', 'Divide input by divisor.', NUMBER),
    f('floor', 'floor', 'Round down to the nearest integer.', NUMBER),
    f('minus', 'minus(operand)', 'Subtract operand from input.', NUMBER),
    f('modulo', 'modulo(operand)', 'Remainder of input divided by operand.', NUMBER),
    f('plus', 'plus(operand)', 'Add operand to input.', NUMBER),
    f('round', 'round(places?)', 'Round to N decimal places (default 0).', NUMBER),
    f('times', 'times(operand)', 'Multiply input by operand.', NUMBER),
    // String
    f('append', 'append(suffix)', 'Append suffix to input.', STRING),
    f('capitalize', 'capitalize', 'Uppercase the first character.', STRING),
    f('downcase', 'downcase', 'Lowercase all characters.', STRING),
    f('upcase', 'upcase', 'Uppercase all characters.', STRING),
    f('lstrip', 'lstrip', 'Strip leading whitespace.', STRING),
    f('rstrip', 'rstrip', 'Strip trailing whitespace.', STRING),
    f('strip', 'strip', 'Strip leading and trailing whitespace.', STRING),
    f('newline_to_br', 'newline_to_br', 'Replace newlines with <br>.', STRING),
    f('prepend', 'prepend(prefix)', 'Prepend prefix to input.', STRING),
    f('remove', 'remove(substring)', 'Remove every occurrence of substring.', STRING),
    f('remove_first', 'remove_first(substring)', 'Remove the first occurrence of substring.', STRING),
    f('replace', 'replace(from, to)', 'Replace every occurrence of `from` with `to`.', STRING),
    f('replace_first', 'replace_first(from, to)', 'Replace the first occurrence of `from` with `to`.', STRING),
    f('slice', 'slice(start, length?)', 'Substring starting at `start` (negative counts from end).', null),
    f('split', 'split(separator)', 'Split string into an array on separator.', { kind: 'array', element: STRING }),
    f('truncate', 'truncate(length, ellipsis?)', 'Truncate to length characters.', STRING),
    f('truncatewords', 'truncatewords(count, ellipsis?)', 'Truncate to N words.', STRING),
    f('url_decode', 'url_decode', 'Percent-decode the input.', STRING),
    f('url_encode', 'url_encode', 'Percent-encode the input.', STRING),
    f('escape', 'escape', 'HTML-escape the input.', STRING),
    f('escape_once', 'escape_once', 'HTML-escape only un-escaped characters.', STRING),
    f('strip_html', 'strip_html', 'Remove HTML tags.', STRING),
    f('strip_newlines', 'strip_newlines', 'Remove newline characters.', STRING),
    // Array
    f('compact', 'compact', 'Remove nil entries from an array.', null),
    f('concat', 'concat(other)', 'Append `other` array to input.', null),
    f('first', 'first', 'First element of an array.', null),
    f('last', 'last', 'Last element of an array.', null),
    f('join', 'join(separator?)', 'Join array elements with separator (default " ").', STRING),
    f('map', 'map(key)', 'Pluck `key` from each element.', null),
    f('reverse', 'reverse', 'Reverse the array.', null),
    f('size', 'size', 'Length of array or string.', NUMBER),
    f('sort', 'sort(key?)', 'Sort an array (case-sensitive).', null),
    f('sort_natural', 'sort_natural(key?)', 'Sort an array (case-insensitive).', null),
    f('uniq', 'uniq', 'Remove duplicates.', null),
    f('where', 'where(key, value?)', 'Filter array to elements whose `key` equals `value`.', null),
    // Date / misc
    f('date', 'date(format)', 'Format a date (strftime).', STRING),
    f('default', 'default(fallback)', 'Use fallback when input is nil/false/empty.', null),
    f('json', 'json', 'Serialize value as JSON string.', STRING),
  ]),
);

export function isKnownFilter(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(FILTERS, name);
}

export function getFilterInfo(name: string): FilterInfo | undefined {
  return FILTERS[name];
}

export function getFilterReturnType(name: string): LiquidType {
  const info = FILTERS[name];
  if (!info || info.returnType === null) return { kind: 'unknown' };
  return info.returnType;
}
