export interface LiquidOperatorInfo {
  name: string;
  description: string;
}

export const LIQUID_OPERATORS: readonly LiquidOperatorInfo[] = Object.freeze([
  { name: 'and', description: 'Logical AND. True when both operands are truthy.' },
  { name: 'or', description: 'Logical OR. True when either operand is truthy.' },
  { name: '==', description: 'Equality comparison.' },
  { name: '!=', description: 'Inequality comparison.' },
  { name: '>', description: 'Greater than.' },
  { name: '<', description: 'Less than.' },
  { name: '>=', description: 'Greater than or equal.' },
  { name: '<=', description: 'Less than or equal.' },
  {
    name: 'contains',
    description: 'Substring or array-membership check. `"hello" contains "ell"` and `arr contains "x"`.',
  },
]);
