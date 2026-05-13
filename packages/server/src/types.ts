export type LiquidType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'unknown' }
  | { kind: 'array'; element: LiquidType }
  | { kind: 'object'; properties: Record<string, { type: LiquidType; optional: boolean }> }
  | { kind: 'union'; variants: LiquidType[] };

export interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export type VariableOrigin =
  | { kind: 'json'; jsonPath: string; jsonKeyRange: Range }
  | {
      kind: 'local';
      tag: 'assign' | 'capture' | 'for' | 'tablerow' | 'increment' | 'decrement';
      declRange: Range;
    }
  | { kind: 'componentProp'; componentPath: string; defaultValue: string; declRange: Range }
  | { kind: 'builtin'; name: 'forloop' | 'tablerowloop' | 'content' };

export interface Binding {
  name: string;
  type: LiquidType;
  origin: VariableOrigin;
}

export interface Scope {
  parent: Scope | null;
  bindings: Map<string, Binding>;
}

export interface ParadoxTag {
  kind: 'component' | 'snippet' | 'data' | 'attribute';
  value: string;
  range: Range;
}

export interface Dependencies {
  jsonCompanion?: string;
  renderedFiles: string[];
  layoutFile?: string;
}
