import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize.js';
import { buildAst } from './ast.js';
import { runParadoxPrepass } from './paradoxPrepass.js';

function run(src: string) {
  const { tokens } = tokenize(src);
  const { root } = buildAst(tokens);
  return runParadoxPrepass(root);
}

describe('runParadoxPrepass', () => {
  it('detects the four kinds', () => {
    const { tags } = run('{{component:Hero}}{{snippet:abc}}{{data:job.title}}{{attribute:className}}');
    expect(tags.map((t) => t.kind)).toEqual(['component', 'snippet', 'data', 'attribute']);
    expect(tags.map((t) => t.value)).toEqual(['Hero', 'abc', 'job.title', 'className']);
  });

  it('tolerates whitespace around kind and value', () => {
    const { tags } = run('{{ component : Hero }}');
    expect(tags).toHaveLength(1);
    expect(tags[0].kind).toBe('component');
    expect(tags[0].value).toBe('Hero');
  });

  it('does NOT match normal output expressions', () => {
    const { tags } = run('{{ name }}{{ user.email }}{{ items | size }}');
    expect(tags).toEqual([]);
  });

  it('does NOT match unknown kinds', () => {
    const { tags } = run('{{widget:foo}}');
    expect(tags).toEqual([]);
  });

  it('exposes a paradoxOutputRanges set whose entries map by start offset', () => {
    const { paradoxOutputRanges, tags } = run('hi {{component:Hero}}');
    expect(paradoxOutputRanges.size).toBe(1);
    expect([...paradoxOutputRanges][0]).toBe(`${tags[0].range.start.line}:${tags[0].range.start.character}`);
  });
});
