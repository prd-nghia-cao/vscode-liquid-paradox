import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize.js';
import { buildAst } from './ast.js';
import { extractComponentProps } from './propBlock.js';

function props(src: string) {
  const { tokens } = tokenize(src);
  const { root } = buildAst(tokens);
  return extractComponentProps(src, root, '/abs/components/button.liquid');
}

describe('extractComponentProps', () => {
  it('extracts props from top-of-file assign-default lines (RHS = prop name)', () => {
    const src = `{% assign type = type | default: 'primary' %}
{% assign text = text | default: 'Learn more' %}
<button>{{ text }}</button>`;
    const out = props(src);
    expect(out.map((p) => p.name)).toEqual(['type', 'text']);
    expect(out[0].type).toEqual({ kind: 'string' });
    expect(out[0].origin).toMatchObject({
      kind: 'componentProp',
      componentPath: '/abs/components/button.liquid',
      defaultValue: "'primary'",
    });
  });

  it('treats LHS aliases correctly: prop name = RHS, NOT LHS', () => {
    const src = `{% assign customClass = class | default: '' %}`;
    const out = props(src);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('class');
  });

  it('stops scanning at the first non-assign top-level node', () => {
    const src = `{% assign a = a | default: '' %}
<div>hi</div>
{% assign b = b | default: '' %}`;
    const out = props(src);
    expect(out.map((p) => p.name)).toEqual(['a']);
  });

  it('skips assigns that do not fit the default-pattern (no `| default:`)', () => {
    const src = `{% assign tag = 'button' %}
{% assign x = y | default: '' %}`;
    const out = props(src);
    expect(out.map((p) => p.name)).toEqual(['y']);
  });

  it('skips assigns whose RHS is not a bare identifier', () => {
    const src = `{% assign x = "literal" | default: '' %}
{% assign y = a.b | default: '' %}`;
    const out = props(src);
    expect(out).toHaveLength(0);
  });

  it('infers literal type from default value', () => {
    const src = `{% assign a = a | default: 'x' %}
{% assign b = b | default: 42 %}
{% assign c = c | default: true %}
{% assign d = d | default: false %}`;
    const out = props(src);
    expect(out.map((p) => ({ n: p.name, k: p.type.kind }))).toEqual([
      { n: 'a', k: 'string' },
      { n: 'b', k: 'number' },
      { n: 'c', k: 'boolean' },
      { n: 'd', k: 'boolean' },
    ]);
  });
});
