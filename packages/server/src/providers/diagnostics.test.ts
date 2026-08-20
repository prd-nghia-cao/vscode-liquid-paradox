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

/** Component props named `names`, all declared as optional strings. */
function buttonProps(names: string[]): Binding[] {
  return names.map((name) => ({
    name,
    type: { kind: 'string' as const },
    origin: {
      kind: 'componentProp' as const,
      componentPath: '/c/button.liquid',
      defaultValue: "''",
      declRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    },
  }));
}

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

  it('does NOT treat colons inside prop values as prop names', () => {
    // Reported case: Tailwind variant classes (`group-odd:left-2`), dotted
    // values, and filter arguments all contain colons inside a value.
    const src = [
      `{% render 'button',`,
      `  text: 'Watch Video',`,
      `  link: item.video.src,`,
      `  type: 'primary',`,
      `  customClass: 'absolute bottom-2 group-odd:left-2 group-even:right-2 video-iframe-trigger'`,
      `%}`,
    ].join('\n');
    const ds = diag(src, {
      componentProps: new Map([['button', buttonProps(['text', 'link', 'type', 'customClass'])]]),
    });
    expect(ds.filter((d) => /unknown prop/i.test(d.message))).toEqual([]);
  });

  it('still flags a genuinely unknown prop alongside a colon-bearing value', () => {
    const src = `{% render "button", customClass: 'group-odd:left-2', nope: 1 %}`;
    const ds = diag(src, { componentProps: new Map([['button', buttonProps(['customClass'])]]) });
    const unknown = ds.filter((d) => /unknown prop/i.test(d.message));
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.message).toMatch(/'nope'/);
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
