import { describe, it, expect } from 'vitest';
import type { LiquidType, Binding, Scope, Range, ParadoxTag, Dependencies, VariableOrigin } from './types.js';

describe('types module', () => {
  it('exports LiquidType variants that can be discriminated by kind', () => {
    const t: LiquidType = { kind: 'string' };
    expect(t.kind).toBe('string');
  });

  it('exports a Binding type tying name + type + origin', () => {
    const origin: VariableOrigin = { kind: 'builtin', name: 'forloop' };
    const b: Binding = {
      name: 'forloop',
      type: { kind: 'object', properties: {} },
      origin
    };
    expect(b.name).toBe('forloop');
  });

  it('exports a Scope linked-list shape', () => {
    const s: Scope = { parent: null, bindings: new Map() };
    expect(s.bindings.size).toBe(0);
  });

  it('exports Range as LSP-compatible { start, end }', () => {
    const r: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    expect(r.start.line).toBe(0);
  });

  it('exports ParadoxTag with four kinds', () => {
    const p: ParadoxTag = {
      kind: 'component',
      value: 'Hero',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
    };
    expect(p.kind).toBe('component');
  });

  it('exports Dependencies with optional companions and renderedFiles array', () => {
    const d: Dependencies = { renderedFiles: [] };
    expect(d.renderedFiles).toEqual([]);
  });
});
