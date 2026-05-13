import { describe, it, expect } from 'vitest';
import { createDepGraph } from './depGraph.js';

describe('DepGraph', () => {
  it('returns dependents of a JSON companion path', () => {
    const g = createDepGraph();
    g.set('file:///p/home.liquid', {
      jsonCompanion: '/p/home.liquid.json',
      renderedFiles: [],
      layoutFile: undefined,
    });
    expect(g.dependentsOfJson('/p/home.liquid.json')).toEqual(['file:///p/home.liquid']);
    expect(g.dependentsOfJson('/p/other.liquid.json')).toEqual([]);
  });

  it('returns dependents of a render key', () => {
    const g = createDepGraph();
    g.set('file:///p/a.liquid', { renderedFiles: ['components/button'], layoutFile: undefined });
    g.set('file:///p/b.liquid', { renderedFiles: ['components/button', 'partials/foot'], layoutFile: undefined });
    expect(g.dependentsOfRenderKey('components/button').sort()).toEqual(['file:///p/a.liquid', 'file:///p/b.liquid']);
    expect(g.dependentsOfRenderKey('partials/foot')).toEqual(['file:///p/b.liquid']);
  });

  it('returns dependents of a layout key', () => {
    const g = createDepGraph();
    g.set('file:///p/x.liquid', { renderedFiles: [], layoutFile: 'main' });
    expect(g.dependentsOfLayoutKey('main')).toEqual(['file:///p/x.liquid']);
  });

  it('set() overwrites previous deps for the URI', () => {
    const g = createDepGraph();
    g.set('file:///a.liquid', { renderedFiles: ['old'], layoutFile: undefined });
    g.set('file:///a.liquid', { renderedFiles: ['new'], layoutFile: undefined });
    expect(g.dependentsOfRenderKey('old')).toEqual([]);
    expect(g.dependentsOfRenderKey('new')).toEqual(['file:///a.liquid']);
  });

  it('remove() drops the entry from all inverse maps', () => {
    const g = createDepGraph();
    g.set('file:///a.liquid', { renderedFiles: ['x'], layoutFile: 'y', jsonCompanion: '/a.json' });
    g.remove('file:///a.liquid');
    expect(g.dependentsOfRenderKey('x')).toEqual([]);
    expect(g.dependentsOfLayoutKey('y')).toEqual([]);
    expect(g.dependentsOfJson('/a.json')).toEqual([]);
  });
});
