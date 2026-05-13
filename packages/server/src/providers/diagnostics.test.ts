import { describe, it, expect } from 'vitest';
import { provideDiagnostics } from './diagnostics.js';
import { analyzeDocument } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import type { Binding } from '../types.js';

const fullIndex: FileIndex = {
  components: new Map([['button', { absPath: '/c/button.liquid', mtime: 0 }]]),
  partials: new Map([['foot', { absPath: '/p/foot.liquid', mtime: 0 }]]),
  layouts: new Map([['main', { absPath: '/l/main.liquid', mtime: 0 }]]),
};

function diag(
  src: string,
  opts: {
    json?: { path: string; text: string };
    pathFeaturesEnabled?: boolean;
    componentProps?: Map<string, Binding[]>;
  } = {},
) {
  const model = analyzeDocument({
    uri: 'file:///abs/x.liquid',
    text: src,
    jsonCompanion: opts.json,
    isComponent: false,
    componentLookup: () => undefined,
  });
  return provideDiagnostics(model, {
    fileIndex: fullIndex,
    pathFeaturesEnabled: opts.pathFeaturesEnabled ?? true,
    lookupComponentProps: (k) => opts.componentProps?.get(k),
  });
}

describe('provideDiagnostics', () => {
  it('flags unknown tags', () => {
    const ds = diag('{% flarp %}');
    expect(ds.some((d) => /unknown tag.*flarp/i.test(d.message))).toBe(true);
    expect(ds[0].severity).toBe('error');
  });

  it('flags unknown filters', () => {
    const ds = diag('{{ x | flooble }}');
    expect(ds.some((d) => /unknown filter.*flooble/i.test(d.message))).toBe(true);
  });

  it('flags unresolved render path', () => {
    const ds = diag('{% render "components/missing" %}');
    expect(ds.some((d) => /unresolved render/i.test(d.message))).toBe(true);
  });

  it('flags unresolved layout path', () => {
    const ds = diag('{% layout "ghost" %}');
    expect(ds.some((d) => /unresolved layout/i.test(d.message))).toBe(true);
  });

  it('does NOT flag render/layout when pathFeaturesEnabled is false', () => {
    const ds = diag('{% render "missing" %}{% layout "ghost" %}', { pathFeaturesEnabled: false });
    expect(ds.every((d) => !/unresolved/i.test(d.message))).toBe(true);
  });

  it('flags unbalanced if', () => {
    const ds = diag('{% if x %}hi');
    expect(ds.some((d) => /unclosed/i.test(d.message))).toBe(true);
  });

  it('flags unknown variable as warning', () => {
    const ds = diag('{{ doesNotExist }}');
    const v = ds.find((d) => /unknown variable/i.test(d.message));
    expect(v?.severity).toBe('warning');
  });

  it('does NOT flag a variable from .liquid.json', () => {
    const ds = diag('{{ title }}', { json: { path: '/abs/x.liquid.json', text: '{"title":"Hi"}' } });
    expect(ds.find((d) => /unknown variable/i.test(d.message))).toBeUndefined();
  });

  it('flags unknown component prop in render', () => {
    const ds = diag('{% render "button", what: 1 %}', {
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
                defaultValue: "''",
                declRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              },
            },
          ],
        ],
      ]),
    });
    expect(ds.some((d) => /unknown prop.*what/i.test(d.message))).toBe(true);
  });

  it('does NOT flag prop validation on partials', () => {
    const ds = diag('{% render "foot", what: 1 %}');
    expect(ds.every((d) => !/unknown prop/i.test(d.message))).toBe(true);
  });

  it('skips variable analysis inside paradox tags', () => {
    const ds = diag('{{component:Hero}}');
    expect(ds.every((d) => !/unknown variable/i.test(d.message))).toBe(true);
  });
});
