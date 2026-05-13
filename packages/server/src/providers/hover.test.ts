import { describe, it, expect } from 'vitest';
import { provideHover } from './hover.js';
import { analyzeDocument } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';

const idx: FileIndex = {
  components: new Map([['button', { absPath: '/c/button.liquid', mtime: 0 }]]),
  partials: new Map(),
  layouts: new Map([['main', { absPath: '/l/main.liquid', mtime: 0 }]]),
};

function m(src: string, json?: { path: string; text: string }) {
  return analyzeDocument({
    uri: 'file:///p/x.liquid',
    text: src,
    jsonCompanion: json,
    isComponent: false,
    componentLookup: () => undefined,
  });
}

describe('provideHover', () => {
  it('hover over a tag name → tag docs', () => {
    const src = '{% for x in xs %}{% endfor %}';
    const h = provideHover(m(src), { line: 0, character: 4 }, { fileIndex: idx });
    expect(h?.markdown).toMatch(/for/i);
    expect(h?.markdown).toMatch(/liquidjs\.com\/tags\/for\.html/);
  });

  it('hover over a filter name → filter docs', () => {
    const src = '{{ x | upcase }}';
    const h = provideHover(m(src), { line: 0, character: 9 }, { fileIndex: idx });
    expect(h?.markdown).toMatch(/upper/i);
  });

  it('hover over a variable → origin + type', () => {
    const src = '{{ title }}';
    const h = provideHover(
      m(src, { path: '/p/x.liquid.json', text: '{"title":"Hi"}' }),
      { line: 0, character: 5 },
      { fileIndex: idx },
    );
    expect(h?.markdown).toMatch(/string/);
    expect(h?.markdown).toMatch(/\.liquid\.json/);
  });

  it('hover over a paradox tag returns the exact spec wording', () => {
    expect(provideHover(m('{{component:Hero}}'), { line: 0, character: 5 }, { fileIndex: idx })?.markdown).toBe(
      'Render the component on Site Studio',
    );
    expect(provideHover(m('{{snippet:abc}}'), { line: 0, character: 5 }, { fileIndex: idx })?.markdown).toBe(
      'Render the snippet on Site Studio',
    );
    expect(provideHover(m('{{data:job.title}}'), { line: 0, character: 5 }, { fileIndex: idx })?.markdown).toBe(
      'Render the data for Site Studio',
    );
    expect(provideHover(m('{{attribute:cls}}'), { line: 0, character: 5 }, { fileIndex: idx })?.markdown).toBe(
      'Render the data for Site Studio',
    );
  });

  it('hover over a render path → resolved absolute path with markdown link', () => {
    const src = '{% render "button" %}';
    const h = provideHover(m(src), { line: 0, character: 15 }, { fileIndex: idx });
    expect(h?.markdown).toMatch(/\/c\/button\.liquid/);
    expect(h?.markdown).toContain('](file:///c/button.liquid)');
  });

  it('hover over a layout path → resolved absolute path', () => {
    const src = '{% layout "main" %}';
    const h = provideHover(m(src), { line: 0, character: 12 }, { fileIndex: idx });
    expect(h?.markdown).toMatch(/\/l\/main\.liquid/);
  });
});
