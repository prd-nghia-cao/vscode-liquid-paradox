import { describe, it, expect } from 'vitest';
import { analyzeDocument } from './document.js';

describe('analyzeDocument', () => {
  it('returns a model with tokens, ast, scope table and empty paradox tags for a simple page', () => {
    const m = analyzeDocument({
      uri: 'file:///abs/src/pages/home.liquid',
      text: '<h1>{{ title }}</h1>',
      jsonCompanion: { path: '/abs/src/pages/home.liquid.json', text: '{ "title": "Hi" }' },
      isComponent: false,
      componentLookup: () => undefined,
    });
    expect(m.paradoxTags).toEqual([]);
    expect(m.ast.root.children).toHaveLength(3);
    expect(m.scopeByOffset(10).get('title')?.type).toEqual({ kind: 'string' });
    expect(m.dependencies.jsonCompanion).toBe('/abs/src/pages/home.liquid.json');
    expect(m.tokenErrors).toEqual([]);
    expect(m.astErrors).toEqual([]);
  });

  it('records render and layout dependencies', () => {
    const m = analyzeDocument({
      uri: 'file:///abs/src/pages/home.liquid',
      text: `{% layout "main" %}{% render "components/button" %}{% render "partials/foot" %}`,
      jsonCompanion: undefined,
      isComponent: false,
      componentLookup: () => undefined,
    });
    expect(m.dependencies.layoutFile).toBe('main');
    expect(m.dependencies.renderedFiles.sort()).toEqual(['components/button', 'partials/foot']);
  });

  it('extracts component props when isComponent is true', () => {
    const m = analyzeDocument({
      uri: 'file:///abs/src/components/button.liquid',
      text: `{% assign type = type | default: 'primary' %}{{ type }}`,
      jsonCompanion: undefined,
      isComponent: true,
      componentLookup: () => undefined,
    });
    expect(m.componentProps?.map((p) => p.name)).toEqual(['type']);
  });

  it('flags paradox tags', () => {
    const m = analyzeDocument({
      uri: 'file:///abs/src/pages/home.liquid',
      text: 'hi {{component:Hero}}',
      jsonCompanion: undefined,
      isComponent: false,
      componentLookup: () => undefined,
    });
    expect(m.paradoxTags).toHaveLength(1);
    expect(m.paradoxTags[0].kind).toBe('component');
  });

  it('locates JSON key ranges (jsonKeyRange points at the key in the JSON source)', () => {
    const json = `{
  "title": "Hi"
}`;
    const m = analyzeDocument({
      uri: 'file:///abs/src/pages/home.liquid',
      text: '<h1>{{ title }}</h1>',
      jsonCompanion: { path: '/abs/src/pages/home.liquid.json', text: json },
      isComponent: false,
      componentLookup: () => undefined,
    });
    const titleBinding = m.scopeByOffset(10).get('title');
    expect(titleBinding?.origin.kind).toBe('json');
    if (titleBinding?.origin.kind === 'json') {
      expect(titleBinding.origin.jsonKeyRange.start.line).toBe(1);
      expect(titleBinding.origin.jsonKeyRange.start.character).toBe(2);
    }
  });
});
