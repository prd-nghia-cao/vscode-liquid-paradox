import { describe, it, expect } from 'vitest';
import { provideCompletions } from './completion.js';
import { analyzeDocument } from '../analyzer/document.js';
import type { Binding } from '../types.js';
import type { FileIndex } from '../workspace/fileIndex.js';

function model(src: string, opts: { isComponent?: boolean; json?: { path: string; text: string } } = {}) {
  return analyzeDocument({
    uri: 'file:///x/page.liquid',
    text: src,
    jsonCompanion: opts.json,
    isComponent: opts.isComponent ?? false,
    componentLookup: () => undefined,
  });
}

const emptyIndex: FileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
const fullIndex: FileIndex = {
  components: new Map([
    ['button', { absPath: '/c/button.liquid', mtime: 0 }],
    ['forms/input', { absPath: '/c/forms/input.liquid', mtime: 0 }],
  ]),
  partials: new Map([['foot', { absPath: '/p/foot.liquid', mtime: 0 }]]),
  layouts: new Map([['main', { absPath: '/l/main.liquid', mtime: 0 }]]),
};

function ctx(extras: { fileIndex?: FileIndex; componentProps?: Map<string, Binding[]> } = {}) {
  return {
    fileIndex: extras.fileIndex ?? emptyIndex,
    lookupComponentProps: (key: string) => extras.componentProps?.get(key),
  };
}

describe('provideCompletions', () => {
  it('after {% returns tag names', () => {
    const src = '{% ';
    const items = provideCompletions(model(src), { line: 0, character: 3 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('if');
    expect(labels).toContain('for');
    expect(labels).toContain('render');
  });

  it('after {{ returns variables in scope including JSON keys', () => {
    const src = '{{ ';
    const m = model(src, { json: { path: '/x/page.liquid.json', text: '{"title":"Hi"}' } });
    const items = provideCompletions(m, { line: 0, character: 3 }, ctx());
    expect(items.find((i) => i.label === 'title')).toBeDefined();
  });

  it('inside dotted property access suggests object keys', () => {
    const src = '{{ user.';
    const m = model(src, { json: { path: '/x/page.liquid.json', text: '{"user":{"name":"R"}}' } });
    const items = provideCompletions(m, { line: 0, character: 8 }, ctx());
    expect(items.map((i) => i.label)).toEqual(['name']);
  });

  it('after a pipe returns filters', () => {
    const items = provideCompletions(model('{{ x | '), { line: 0, character: 7 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('upcase');
    expect(labels).toContain('size');
  });

  it('inside {% render "..." returns component keys (Module icon) and partial keys (File icon)', () => {
    const src = '{% render "';
    const items = provideCompletions(model(src), { line: 0, character: 11 }, ctx({ fileIndex: fullIndex }));
    const buttons = items.find((i) => i.label === 'button');
    const foot = items.find((i) => i.label === 'foot');
    expect(buttons?.kind).toBe('Module');
    expect(foot?.kind).toBe('File');
  });

  it('inside {% layout "..." returns only layouts', () => {
    const src = '{% layout "';
    const items = provideCompletions(model(src), { line: 0, character: 11 }, ctx({ fileIndex: fullIndex }));
    expect(items.map((i) => i.label)).toEqual(['main']);
  });

  it('after a render arg comma on a component target, suggests component props', () => {
    const src = '{% render "button", ';
    const items = provideCompletions(
      model(src),
      { line: 0, character: src.length },
      ctx({
        fileIndex: fullIndex,
        componentProps: new Map([
          [
            'button',
            [
              {
                name: 'type',
                type: { kind: 'string' },
                origin: {
                  kind: 'componentProp',
                  componentPath: '/c/button.liquid',
                  defaultValue: "'primary'",
                  declRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                },
              },
              {
                name: 'class',
                type: { kind: 'string' },
                origin: {
                  kind: 'componentProp',
                  componentPath: '/c/button.liquid',
                  defaultValue: "''",
                  declRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                },
              },
            ],
          ],
        ]),
      }),
    );
    expect(items.map((i) => i.label).sort()).toEqual(['class', 'type']);
    expect(items[0].detail).toMatch(/string/);
  });

  it('partial targets return no prop completion (caller passes arbitrary kwargs)', () => {
    const src = '{% render "foot", ';
    const items = provideCompletions(model(src), { line: 0, character: src.length }, ctx({ fileIndex: fullIndex }));
    expect(items).toEqual([]);
  });

  it('inside a paradox tag returns no completions', () => {
    const src = '{{component:Hero ';
    const m = model(src);
    const items = provideCompletions(m, { line: 0, character: src.length }, ctx());
    expect(items).toEqual([]);
  });
});
