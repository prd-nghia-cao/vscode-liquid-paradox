import { describe, it, expect } from 'vitest';
import { inferLiquidType, inferTopLevelBindings } from './jsonSchema.js';

describe('inferLiquidType', () => {
  it('returns primitive kinds for leaves', () => {
    expect(inferLiquidType('hi')).toEqual({ kind: 'string' });
    expect(inferLiquidType(42)).toEqual({ kind: 'number' });
    expect(inferLiquidType(true)).toEqual({ kind: 'boolean' });
    expect(inferLiquidType(null)).toEqual({ kind: 'null' });
  });

  it('treats empty array as array<unknown>', () => {
    expect(inferLiquidType([])).toEqual({ kind: 'array', element: { kind: 'unknown' } });
  });

  it('merges array element shapes, marking partial keys optional', () => {
    const t = inferLiquidType([
      { type: 'quote', quote: 'hi', name: 'Rob' },
      { type: 'video', video_url: 'u', name: 'Will' },
    ]);
    expect(t.kind).toBe('array');
    if (t.kind === 'array' && t.element.kind === 'object') {
      const p = t.element.properties;
      expect(p.type).toEqual({ type: { kind: 'string' }, optional: false });
      expect(p.name).toEqual({ type: { kind: 'string' }, optional: false });
      expect(p.quote).toEqual({ type: { kind: 'string' }, optional: true });
      expect(p.video_url).toEqual({ type: { kind: 'string' }, optional: true });
    }
  });

  it('produces a union for mixed primitive/object arrays', () => {
    const t = inferLiquidType(['a', { x: 1 }]);
    expect(t.kind).toBe('array');
    if (t.kind === 'array') {
      expect(t.element.kind).toBe('union');
    }
  });

  it('preserves nested object shape', () => {
    const t = inferLiquidType({ user: { name: 'Rob', age: 30 } });
    expect(t).toEqual({
      kind: 'object',
      properties: {
        user: {
          optional: false,
          type: {
            kind: 'object',
            properties: {
              name: { optional: false, type: { kind: 'string' } },
              age: { optional: false, type: { kind: 'number' } },
            },
          },
        },
      },
    });
  });
});

describe('inferTopLevelBindings', () => {
  it('returns a binding per top-level key with json origin', () => {
    const bindings = inferTopLevelBindings('/abs/path/file.liquid.json', {
      title: 'Home',
      items: [{ a: 1 }],
    });
    const names = bindings.map((b) => b.name).sort();
    expect(names).toEqual(['items', 'title']);
    expect(bindings.find((b) => b.name === 'title')?.type).toEqual({ kind: 'string' });
    expect(bindings.find((b) => b.name === 'title')?.origin).toMatchObject({
      kind: 'json',
      jsonPath: '/abs/path/file.liquid.json',
    });
  });

  it('returns [] for non-object root', () => {
    expect(inferTopLevelBindings('/p.json', [])).toEqual([]);
    expect(inferTopLevelBindings('/p.json', 'hi')).toEqual([]);
  });
});
