import { describe, it, expect } from 'vitest';
import { Tokenizer, TokenKind } from 'liquidjs';
import { tokenize } from './tokenize.js';

describe('liquidjs token-kind contract', () => {
  // `tokenize` classifies tokens by liquidjs's numeric `kind` rather than by
  // `constructor.name`, because minification renames the bundled classes and
  // would send every token down the `html` branch. If liquidjs ever stops
  // stamping `kind`, this fails here instead of only in the production bundle.
  it('stamps every top-level token with a numeric TokenKind', () => {
    const raw = new Tokenizer('{% assign a = 1 %}<p>x</p>{{ y }}').readTopLevelTokens();
    const kinds = raw.map((t) => (t as unknown as { kind?: number }).kind);
    expect(kinds).toEqual([TokenKind.Tag, TokenKind.HTML, TokenKind.Output]);
  });

  it('classifies tags and outputs without relying on class names', () => {
    const { tokens } = tokenize('{% assign a = 1 %}<p>x</p>{{ y }}');
    expect(tokens.map((t) => t.kind)).toEqual(['tag', 'html', 'output']);
  });
});

describe('tokenize', () => {
  it('returns a flat token stream for a simple template', () => {
    const { tokens, errors } = tokenize('hello {{ name }} world');
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.kind)).toEqual(['html', 'output', 'html']);
    expect(tokens[1]).toMatchObject({ kind: 'output', content: 'name' });
  });

  it('captures tag tokens with name + args', () => {
    const { tokens } = tokenize('{% assign x = 1 %}');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: 'tag', name: 'assign', args: 'x = 1' });
  });

  it('records 0-based line/character ranges', () => {
    const { tokens } = tokenize('a\n{{ x }}');
    const output = tokens.find((t) => t.kind === 'output');
    expect(output?.range.start.line).toBe(1);
    expect(output?.range.start.character).toBe(0);
  });

  it('does not throw on an unclosed output expression', () => {
    const { tokens, errors } = tokenize('hello {{ name ');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/unclosed|closed|expected/i);
    expect(tokens.some((t) => t.kind === 'html')).toBe(true);
  });

  it('does not throw on a mismatched tag delimiter', () => {
    const { errors } = tokenize('{% if x %');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('treats {{ component:Hero }} as a normal output token (paradox prepass runs later)', () => {
    const { tokens, errors } = tokenize('{{component:Hero}}');
    expect(errors).toEqual([]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: 'output', content: 'component:Hero' });
  });
});
