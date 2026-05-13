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

  // ----- New behaviors locked in by fix-liquid-completion-triggers -----

  it('cursor immediately after `{%` (no trailing space) returns tag names', () => {
    const items = provideCompletions(model('{%'), { line: 0, character: 2 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('if');
    expect(labels).toContain('for');
    expect(labels).toContain('assign');
  });

  it('cursor immediately after `{%-` returns tag names', () => {
    const items = provideCompletions(model('{%-'), { line: 0, character: 3 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('if');
  });

  it('cursor inside auto-closed `{% %}` (cursor at 2) returns tag names', () => {
    const items = provideCompletions(model('{% %}'), { line: 0, character: 2 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('if');
    expect(labels).toContain('for');
  });

  it('cursor immediately after `{{` (no JSON, no scope) returns built-in literals and pipe sentinel', () => {
    const items = provideCompletions(model('{{'), { line: 0, character: 2 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('nil');
    expect(labels).toContain('null');
    expect(labels).toContain('true');
    expect(labels).toContain('false');
    expect(labels).toContain('empty');
    expect(labels).toContain('blank');
    expect(labels).toContain('|');
  });

  it('cursor immediately after `{{-` returns built-in literals and pipe sentinel', () => {
    const items = provideCompletions(model('{{-'), { line: 0, character: 3 }, ctx());
    expect(items.map((i) => i.label)).toContain('nil');
  });

  it('cursor inside auto-closed `{{ }}` (cursor at 2) returns built-ins and JSON keys when available', () => {
    const m = model('{{ }}', { json: { path: '/x/page.liquid.json', text: '{"title":"Hi"}' } });
    const items = provideCompletions(m, { line: 0, character: 2 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('title');
    expect(labels).toContain('nil');
  });

  it('cursor at `{{ x|` (no space before pipe) returns filters', () => {
    const items = provideCompletions(model('{{ x|'), { line: 0, character: 5 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('upcase');
    expect(labels).toContain('size');
  });

  it('cursor at `{% for x ` returns the `in` keyword first', () => {
    const items = provideCompletions(model('{% for x '), { line: 0, character: 9 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels[0]).toBe('in');
    expect(labels).toContain('reversed');
  });

  it('cursor at `{% if ` returns operators and in-scope variables', () => {
    const m = model('{% if ', { json: { path: '/x/page.liquid.json', text: '{"title":"Hi"}' } });
    const items = provideCompletions(m, { line: 0, character: 6 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('and');
    expect(labels).toContain('or');
    expect(labels).toContain('==');
    expect(labels).toContain('contains');
    expect(labels).toContain('title');
  });

  it('cursor at `{{co` returns paradox kind keywords with leading-space padding', () => {
    const items = provideCompletions(model('{{co'), { line: 0, character: 4 }, ctx());
    const labels = items.map((i) => i.label).sort();
    expect(labels).toEqual(['attribute', 'component', 'data', 'snippet']);
    const component = items.find((i) => i.label === 'component');
    expect(component?.kind).toBe('Keyword');
    expect(component?.detail).toBe('paradox tag');
    expect(component?.insertText).toBe(' component:');
  });

  it('cursor at `{{component:` (no value yet) returns paradox value placeholder', () => {
    const items = provideCompletions(model('{{component:'), { line: 0, character: 12 }, ctx());
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]!.detail).toMatch(/paradox/i);
  });

  it('manual-invoke outside any Liquid construct returns empty', () => {
    const items = provideCompletions(model('<h1>Hello</h1>'), { line: 0, character: 5 }, ctx(), 'invoked');
    expect(items).toEqual([]);
  });

  it('manual-invoke at empty `{% %}` (offset 3) returns tag names', () => {
    const items = provideCompletions(model('{% %}'), { line: 0, character: 3 }, ctx(), 'invoked');
    const labels = items.map((i) => i.label);
    expect(labels).toContain('if');
  });

  // Regression: when VS Code's single-char `{` -> `}` autoclose fires before
  // the `{%` -> `%}` pair, the document state is `{%}` with cursor at offset 2.
  // The naive backward scan finds `%}` first and bails. The pre-check in
  // bucketCursor fixes this — completions must still fire.
  it('cursor at offset 2 in `{%}` returns tag names (autoclose race regression)', () => {
    const items = provideCompletions(model('{%}'), { line: 0, character: 2 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('if');
    expect(labels).toContain('for');
    expect(labels).toContain('assign');
  });

  it('cursor at offset 2 in `{{}` returns built-in literals (autoclose race regression)', () => {
    const items = provideCompletions(model('{{}'), { line: 0, character: 2 }, ctx());
    const labels = items.map((i) => i.label);
    expect(labels).toContain('nil');
    expect(labels).toContain('|');
  });
});

describe('provideCompletions — auto whitespace padding', () => {
  function ifItem(items: ReturnType<typeof provideCompletions>) {
    return items.find((i) => i.label === 'if');
  }
  function nilItem(items: ReturnType<typeof provideCompletions>) {
    return items.find((i) => i.label === 'nil');
  }

  it('empty `{%%}` body — tag name inserts with both leading and trailing space', () => {
    const items = provideCompletions(model('{%%}'), { line: 0, character: 2 }, ctx());
    expect(ifItem(items)?.insertText).toBe(' if ');
  });

  it('body ` ` with tight close `{% %}` — tag name inserts trailing space only', () => {
    const items = provideCompletions(model('{% %}'), { line: 0, character: 3 }, ctx());
    expect(ifItem(items)?.insertText).toBe('if ');
  });

  it('body `` with spaced close `{% %}` (cursor 2) — tag name inserts leading space only', () => {
    const items = provideCompletions(model('{% %}'), { line: 0, character: 2 }, ctx());
    expect(ifItem(items)?.insertText).toBe(' if');
  });

  it('body ` ` with spaced close `{%  %}` — tag name uses plain label (no insertText override)', () => {
    const items = provideCompletions(model('{%  %}'), { line: 0, character: 3 }, ctx());
    // When no padding is needed and the item has no explicit insertText,
    // VS Code falls back to the label, which is the desired behavior.
    expect(ifItem(items)?.label).toBe('if');
    expect(ifItem(items)?.insertText).toBeUndefined();
  });

  it('empty `{{}}` body — built-in literal inserts with both leading and trailing space', () => {
    const items = provideCompletions(model('{{}}'), { line: 0, character: 2 }, ctx());
    expect(nilItem(items)?.insertText).toBe(' nil ');
  });

  it('empty `{{}}` body — pipe sentinel keeps its own ` | ` insertText (no double padding)', () => {
    const items = provideCompletions(model('{{}}'), { line: 0, character: 2 }, ctx());
    const pipe = items.find((i) => i.label === '|');
    expect(pipe?.insertText).toBe(' | ');
  });

  it('partial word at tight delimiters `{%i%}` — trailing space added (no extra leading)', () => {
    const items = provideCompletions(model('{%i%}'), { line: 0, character: 3 }, ctx());
    // body before partial word `i` is '', so leading space is also added.
    expect(ifItem(items)?.insertText).toBe(' if ');
  });

  it('partial word with leading space `{% i%}` — only trailing space added', () => {
    const items = provideCompletions(model('{% i%}'), { line: 0, character: 4 }, ctx());
    expect(ifItem(items)?.insertText).toBe('if ');
  });

  it('whitespace-trimming open `{%-%}` (cursor right after `{%-`) — padding applied around tag name', () => {
    const items = provideCompletions(model('{%-%}'), { line: 0, character: 3 }, ctx());
    expect(ifItem(items)?.insertText).toBe(' if ');
  });

  it('whitespace-trimming close `-%}` (cursor right after `{%`) — trailing space added before `-%}`', () => {
    // bucketCursor will resolve open = `{%` (length 2) at offset 0, so body is empty.
    // The close `-%}` must still trigger trailing padding.
    const items = provideCompletions(model('{%-%}'), { line: 0, character: 2 }, ctx());
    expect(ifItem(items)?.insertText).toBe(' if ');
  });

  it('paradox kind at `{{co` adds leading space only (value uses its own format after `:`)', () => {
    const items = provideCompletions(model('{{co'), { line: 0, character: 4 }, ctx());
    const component = items.find((i) => i.label === 'component');
    expect(component?.insertText).toBe(' component:');
  });

  it('render-args region does NOT get padded', () => {
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
            ],
          ],
        ]),
      }),
    );
    const typeItem = items.find((i) => i.label === 'type');
    // No insertText override means the label is inserted verbatim.
    expect(typeItem?.insertText).toBeUndefined();
  });

  it('string-render-path region does NOT get padded', () => {
    const items = provideCompletions(
      model('{% render "'),
      { line: 0, character: 11 },
      ctx({ fileIndex: fullIndex }),
    );
    const button = items.find((i) => i.label === 'button');
    expect(button?.insertText).toBeUndefined();
  });
});
