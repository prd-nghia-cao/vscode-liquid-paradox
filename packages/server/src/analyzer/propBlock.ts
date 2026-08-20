import type { AstNode, RootNode } from './ast.js';
import type { Binding, LiquidType } from '../types.js';

const ASSIGN_DEFAULT_RE = /^\s*([\w-]+)\s*=\s*([\w-]+)\s*\|\s*default\s*:\s*(.+?)\s*$/;

/**
 * Collects a component's props: every top-level `{% assign x = x | default: … %}`
 * in the file, not just the leading run. Components commonly declare a first
 * batch of props, emit some markup, then declare more, so stopping at the first
 * non-assign node would silently drop the later ones.
 */
export function extractComponentProps(_source: string, root: RootNode, componentPath: string): Binding[] {
  const out: Binding[] = [];
  const seen = new Set<string>();
  for (const child of root.children) {
    if (child.kind !== 'tag' || child.name !== 'assign') continue;

    const match = child.args.match(ASSIGN_DEFAULT_RE);
    if (!match) continue;
    const [, , rhs, def] = match;
    const propName = rhs!;
    if (seen.has(propName)) continue;
    seen.add(propName);
    out.push({
      name: propName,
      type: literalType(def!),
      origin: {
        kind: 'componentProp',
        componentPath,
        defaultValue: def!,
        declRange: child.range,
      },
    });
  }
  return out;
}

function literalType(literal: string): LiquidType {
  const trimmed = literal.trim();
  if (/^".*"$|^'.*'$/.test(trimmed)) return { kind: 'string' };
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { kind: 'number' };
  if (trimmed === 'true' || trimmed === 'false') return { kind: 'boolean' };
  if (trimmed === 'nil' || trimmed === 'null') return { kind: 'null' };
  return { kind: 'unknown' };
}

export type ComponentPropMap = Map<string, Binding>;
export function bindingsToMap(bindings: Binding[]): ComponentPropMap {
  return new Map(bindings.map((b) => [b.name, b]));
}
