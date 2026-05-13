import { describe, it, expect } from 'vitest';
import { provideDefinition } from './definition.js';
import { analyzeDocument } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';

const idx: FileIndex = {
  components: new Map([['button', { absPath: '/c/button.liquid', mtime: 0 }]]),
  partials: new Map(),
  layouts: new Map([['main', { absPath: '/l/main.liquid', mtime: 0 }]]),
};

function m(src: string, json?: { path: string; text: string }) {
  return analyzeDocument({
    uri: 'file:///abs/x.liquid',
    text: src,
    jsonCompanion: json,
    isComponent: false,
    componentLookup: () => undefined,
  });
}

describe('provideDefinition', () => {
  it('JSON-origin variable jumps to its key in the .liquid.json', () => {
    const json = '{\n  "title": "Hi"\n}';
    const d = provideDefinition(
      m('{{ title }}', { path: '/abs/x.liquid.json', text: json }),
      { line: 0, character: 4 },
      { fileIndex: idx },
    );
    expect(d?.uri).toBe('file:///abs/x.liquid.json');
    expect(d?.range.start.line).toBe(1);
  });

  it('local assign variable jumps to its declaration', () => {
    const src = '{% assign greeting = "hi" %}{{ greeting }}';
    const d = provideDefinition(m(src), { line: 0, character: src.indexOf('greeting }}') + 2 }, { fileIndex: idx });
    expect(d?.uri).toBe('file:///abs/x.liquid');
    expect(d?.range.start.character).toBeGreaterThanOrEqual(0);
  });

  it('render "button" jumps to button.liquid line 0', () => {
    const src = '{% render "button" %}';
    const d = provideDefinition(m(src), { line: 0, character: 13 }, { fileIndex: idx });
    expect(d?.uri).toBe('file:///c/button.liquid');
    expect(d?.range.start).toEqual({ line: 0, character: 0 });
  });

  it('layout "main" jumps to main.liquid', () => {
    const src = '{% layout "main" %}';
    const d = provideDefinition(m(src), { line: 0, character: 12 }, { fileIndex: idx });
    expect(d?.uri).toBe('file:///l/main.liquid');
  });

  it('paradox tag returns null', () => {
    const src = '{{component:Hero}}';
    expect(provideDefinition(m(src), { line: 0, character: 5 }, { fileIndex: idx })).toBeNull();
  });
});
