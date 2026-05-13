import type { AstNode, RootNode } from './ast.js';
import type { Binding, LiquidType } from '../types.js';

const ASSIGN_DEFAULT_RE = /^\s*([\w-]+)\s*=\s*([\w-]+)\s*\|\s*default\s*:\s*(.+?)\s*$/;

export function extractComponentProps(_source: string, root: RootNode, componentPath: string): Binding[] {
  const out: Binding[] = [];
  for (const child of root.children) {
    if (child.kind === 'html' && /^\s*$/.test(child.text)) continue;
    if (child.kind !== 'tag' || child.name !== 'assign') break;

    const match = child.args.match(ASSIGN_DEFAULT_RE);
    if (!match) continue;
    const [, , rhs, def] = match;
    const propName = rhs!;
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
