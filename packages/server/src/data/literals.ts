export interface LiquidLiteralInfo {
  name: string;
  description: string;
}

export const LIQUID_BUILTIN_LITERALS: readonly LiquidLiteralInfo[] = Object.freeze([
  { name: 'nil', description: 'Liquid nil literal. Equivalent to `null`.' },
  { name: 'null', description: 'Alias for `nil`.' },
  { name: 'true', description: 'Boolean true.' },
  { name: 'false', description: 'Boolean false.' },
  {
    name: 'empty',
    description: 'Matches any empty string, array, or object. Useful in comparisons (`x == empty`).',
  },
  {
    name: 'blank',
    description: 'Matches nil, false, empty string, or whitespace-only string.',
  },
]);
