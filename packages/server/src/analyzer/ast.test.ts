import { describe, it, expect } from 'vitest';
import { buildAst } from './ast.js';
import { tokenize } from './tokenize.js';

function parse(src: string) {
  const { tokens, errors: tokErrors } = tokenize(src);
  const ast = buildAst(tokens);
  return { ast, tokErrors, errors: ast.errors };
}

describe('buildAst', () => {
  it('produces a root node with children for a flat template', () => {
    const { ast } = parse('hello {{ name }}!');
    expect(ast.root.children).toHaveLength(3);
    expect(ast.root.children[0].kind).toBe('html');
    expect(ast.root.children[1].kind).toBe('output');
  });

  it('nests if blocks with their endif', () => {
    const { ast, errors } = parse('{% if x %}A{% endif %}');
    expect(errors).toEqual([]);
    expect(ast.root.children).toHaveLength(1);
    const ifNode = ast.root.children[0];
    expect(ifNode.kind).toBe('block');
    if (ifNode.kind === 'block') {
      expect(ifNode.openName).toBe('if');
      expect(ifNode.branches[0].body).toHaveLength(1);
      expect(ifNode.branches[0].body[0].kind).toBe('html');
    }
  });

  it('supports elsif / else branches inside if', () => {
    const { ast } = parse('{% if x %}A{% elsif y %}B{% else %}C{% endif %}');
    const ifNode = ast.root.children[0];
    expect(ifNode.kind).toBe('block');
    if (ifNode.kind === 'block') {
      expect(ifNode.branches.map((b) => b.name)).toEqual(['if', 'elsif', 'else']);
    }
  });

  it('nests for blocks and records the binding info', () => {
    const { ast } = parse('{% for item in items %}{{ item }}{% endfor %}');
    const forNode = ast.root.children[0];
    expect(forNode.kind).toBe('block');
    if (forNode.kind === 'block') {
      expect(forNode.openName).toBe('for');
      expect(forNode.openArgs).toBe('item in items');
    }
  });

  it('reports an unbalanced open tag', () => {
    const { errors } = parse('{% if x %}hello');
    expect(errors.some((e) => /unclosed.*if/i.test(e.message))).toBe(true);
  });

  it('reports an unexpected closing tag', () => {
    const { errors } = parse('hello {% endif %}');
    expect(errors.some((e) => /unexpected.*endif/i.test(e.message))).toBe(true);
  });

  it('reports a mismatched closing tag', () => {
    const { errors } = parse('{% if x %}A{% endfor %}');
    expect(errors.some((e) => /mismatched|unexpected/i.test(e.message))).toBe(true);
  });

  it('treats unknown tags as leaf nodes without crashing', () => {
    const { ast } = parse('{% flarp %}');
    expect(ast.root.children).toHaveLength(1);
    expect(ast.root.children[0].kind).toBe('tag');
  });
});
