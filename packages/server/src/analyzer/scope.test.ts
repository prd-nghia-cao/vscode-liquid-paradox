import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize.js';
import { buildAst } from './ast.js';
import { buildScopeTable } from './scope.js';
import type { Binding } from '../types.js';

function build(src: string, rootBindings: Binding[] = []) {
  const { tokens } = tokenize(src);
  const { root } = buildAst(tokens);
  return buildScopeTable(src, root, rootBindings);
}

describe('buildScopeTable', () => {
  it('exposes root JSON bindings at any offset', () => {
    const json: Binding = {
      name: 'title',
      type: { kind: 'string' },
      origin: {
        kind: 'json',
        jsonPath: '/x.json',
        jsonKeyRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    };
    const { scopeAt } = build('{{ title }}', [json]);
    expect(scopeAt(5).get('title')?.type).toEqual({ kind: 'string' });
  });

  it('records an assign binding within its lexical region', () => {
    const src = '{% assign greeting = "hi" %}{{ greeting }}';
    const { scopeAt } = build(src);
    expect(scopeAt(src.indexOf('greeting }}')).get('greeting')?.type).toEqual({ kind: 'string' });
  });

  it('infers assign RHS type from a filter chain via filters table', () => {
    const src = '{% assign n = title | size %}{{ n }}';
    const { scopeAt } = build(src);
    expect(scopeAt(src.indexOf('n }}')).get('n')?.type).toEqual({ kind: 'number' });
  });

  it('pushes a for binding plus forloop inside the loop, pops them after', () => {
    const itemsBinding: Binding = {
      name: 'items',
      type: {
        kind: 'array',
        element: { kind: 'object', properties: { name: { type: { kind: 'string' }, optional: false } } },
      },
      origin: {
        kind: 'json',
        jsonPath: '/x.json',
        jsonKeyRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    };
    const src = '{% for item in items %}{{ item.name }}{% endfor %}{{ item }}';
    const { scopeAt } = build(src, [itemsBinding]);
    const inside = src.indexOf('item.name');
    const after = src.lastIndexOf('item }}');
    expect(scopeAt(inside).get('item')?.type).toEqual({
      kind: 'object',
      properties: { name: { type: { kind: 'string' }, optional: false } },
    });
    expect(scopeAt(inside).get('forloop')?.type.kind).toBe('object');
    expect(scopeAt(after).get('item')).toBeUndefined();
    expect(scopeAt(after).get('forloop')).toBeUndefined();
  });

  it('infers tablerow x like for', () => {
    const itemsBinding: Binding = {
      name: 'items',
      type: { kind: 'array', element: { kind: 'string' } },
      origin: {
        kind: 'json',
        jsonPath: '/x.json',
        jsonKeyRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    };
    const src = '{% tablerow cell in items %}{{ cell }}{% endtablerow %}';
    const { scopeAt } = build(src, [itemsBinding]);
    expect(scopeAt(src.indexOf('cell }}')).get('cell')?.type).toEqual({ kind: 'string' });
    expect(scopeAt(src.indexOf('cell }}')).get('tablerowloop')?.type.kind).toBe('object');
  });

  it('capture binds the variable as string', () => {
    const src = '{% capture greet %}hi{% endcapture %}{{ greet }}';
    const { scopeAt } = build(src);
    expect(scopeAt(src.indexOf('greet }}')).get('greet')?.type).toEqual({ kind: 'string' });
  });

  it('increment/decrement binds as number', () => {
    const src = '{% increment cnt %}{{ cnt }}';
    const { scopeAt } = build(src);
    expect(scopeAt(src.indexOf('cnt }}')).get('cnt')?.type).toEqual({ kind: 'number' });
  });

  it('inner declarations shadow outer ones', () => {
    const src = '{% assign x = "outer" %}{% for x in items %}{{ x }}{% endfor %}{{ x }}';
    const itemsBinding: Binding = {
      name: 'items',
      type: { kind: 'array', element: { kind: 'number' } },
      origin: {
        kind: 'json',
        jsonPath: '/x.json',
        jsonKeyRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    };
    const { scopeAt } = build(src, [itemsBinding]);
    expect(scopeAt(src.indexOf('x }}{% endfor')).get('x')?.type).toEqual({ kind: 'number' });
    expect(scopeAt(src.lastIndexOf('x }}')).get('x')?.type).toEqual({ kind: 'string' });
  });
});
