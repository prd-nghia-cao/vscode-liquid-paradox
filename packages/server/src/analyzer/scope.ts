import type { AstNode, BlockBranch, RootNode } from './ast.js';
import type { Binding, LiquidType, Range, Scope } from '../types.js';
import { getFilterReturnType } from '../data/filters.js';

const FORLOOP_TYPE: LiquidType = {
  kind: 'object',
  properties: {
    index: { type: { kind: 'number' }, optional: false },
    index0: { type: { kind: 'number' }, optional: false },
    rindex: { type: { kind: 'number' }, optional: false },
    rindex0: { type: { kind: 'number' }, optional: false },
    first: { type: { kind: 'boolean' }, optional: false },
    last: { type: { kind: 'boolean' }, optional: false },
    length: { type: { kind: 'number' }, optional: false },
  },
};

const TABLEROWLOOP_TYPE: LiquidType = {
  kind: 'object',
  properties: {
    index: { type: { kind: 'number' }, optional: false },
    index0: { type: { kind: 'number' }, optional: false },
    col: { type: { kind: 'number' }, optional: false },
    col0: { type: { kind: 'number' }, optional: false },
    first: { type: { kind: 'boolean' }, optional: false },
    last: { type: { kind: 'boolean' }, optional: false },
    length: { type: { kind: 'number' }, optional: false },
  },
};

export interface ScopeTable {
  scopeAt(offset: number): Map<string, Binding>;
}

interface ScopeRegion {
  start: number;
  end: number;
  bindings: Map<string, Binding>;
  parent: ScopeRegion | null;
}

export function buildScopeTable(source: string, root: RootNode, rootBindings: Binding[]): ScopeTable {
  const offsets = lineColumnIndex(source);
  const offsetOf = (line: number, character: number): number => (offsets[line] ?? 0) + character;

  const rootRegion: ScopeRegion = {
    start: 0,
    end: source.length,
    bindings: new Map(rootBindings.map((b) => [b.name, b])),
    parent: null,
  };

  const regions: ScopeRegion[] = [rootRegion];

  function walk(children: AstNode[], regionStart: number, regionEnd: number, parent: ScopeRegion): void {
    let cursor = regionStart;
    const current: ScopeRegion = {
      start: regionStart,
      end: regionEnd,
      bindings: new Map(),
      parent,
    };
    regions.push(current);

    for (const node of children) {
      const nodeStart = offsetOf(node.range.start.line, node.range.start.character);
      const nodeEnd = offsetOf(node.range.end.line, node.range.end.character);

      if (node.kind === 'tag') {
        if (node.name === 'assign') {
          const parsed = parseAssign(node.args);
          if (parsed) {
            const t = inferAssignType(parsed.rhs, current);
            current.bindings.set(parsed.name, {
              name: parsed.name,
              type: t,
              origin: { kind: 'local', tag: 'assign', declRange: node.range },
            });
          }
        } else if (node.name === 'increment' || node.name === 'decrement') {
          const trimmed = node.args.trim();
          if (/^[\w-]+$/.test(trimmed)) {
            current.bindings.set(trimmed, {
              name: trimmed,
              type: { kind: 'number' },
              origin: { kind: 'local', tag: node.name, declRange: node.range },
            });
          }
        }
      } else if (node.kind === 'block') {
        if (node.openName === 'for') {
          const parsed = parseForArgs(node.openArgs);
          if (parsed) {
            const collectionType = lookupExpressionType(parsed.collection, current);
            const elemType = collectionType.kind === 'array' ? collectionType.element : { kind: 'unknown' as const };
            const childStart = nodeStart;
            const childEnd = nodeEnd;
            const inner: ScopeRegion = {
              start: childStart,
              end: childEnd,
              bindings: new Map([
                [
                  parsed.varName,
                  {
                    name: parsed.varName,
                    type: elemType,
                    origin: { kind: 'local', tag: 'for', declRange: node.range },
                  },
                ],
                [
                  'forloop',
                  {
                    name: 'forloop',
                    type: FORLOOP_TYPE,
                    origin: { kind: 'builtin', name: 'forloop' },
                  },
                ],
              ]),
              parent: current,
            };
            regions.push(inner);
            for (const branch of node.branches) {
              walkBranch(branch, inner);
            }
            cursor = childEnd;
            continue;
          }
        } else if (node.openName === 'tablerow') {
          const parsed = parseForArgs(node.openArgs);
          if (parsed) {
            const collectionType = lookupExpressionType(parsed.collection, current);
            const elemType = collectionType.kind === 'array' ? collectionType.element : { kind: 'unknown' as const };
            const inner: ScopeRegion = {
              start: nodeStart,
              end: nodeEnd,
              bindings: new Map([
                [
                  parsed.varName,
                  {
                    name: parsed.varName,
                    type: elemType,
                    origin: { kind: 'local', tag: 'tablerow', declRange: node.range },
                  },
                ],
                [
                  'tablerowloop',
                  {
                    name: 'tablerowloop',
                    type: TABLEROWLOOP_TYPE,
                    origin: { kind: 'builtin', name: 'tablerowloop' },
                  },
                ],
              ]),
              parent: current,
            };
            regions.push(inner);
            for (const branch of node.branches) {
              walkBranch(branch, inner);
            }
            continue;
          }
        } else if (node.openName === 'capture') {
          const captureName = node.openArgs.trim();
          if (/^[\w-]+$/.test(captureName)) {
            current.bindings.set(captureName, {
              name: captureName,
              type: { kind: 'string' },
              origin: { kind: 'local', tag: 'capture', declRange: node.range },
            });
          }
        }
        for (const branch of node.branches) {
          walkBranch(branch, current);
        }
      }

      cursor = nodeEnd;
    }
  }

  function walkBranch(branch: BlockBranch, parent: ScopeRegion): void {
    if (branch.body.length === 0) return;
    const first = branch.body[0]!;
    const last = branch.body[branch.body.length - 1]!;
    const start = offsetOf(first.range.start.line, first.range.start.character);
    const end = offsetOf(last.range.end.line, last.range.end.character);
    walk(branch.body, start, end, parent);
  }

  walk(root.children, 0, source.length, rootRegion);

  return {
    scopeAt(offset: number): Map<string, Binding> {
      let best: ScopeRegion = rootRegion;
      for (const r of regions) {
        if (offset >= r.start && offset <= r.end && spanLength(r) <= spanLength(best)) {
          best = r;
        }
      }
      const chain: ScopeRegion[] = [];
      for (let c: ScopeRegion | null = best; c; c = c.parent) chain.unshift(c);
      const merged = new Map<string, Binding>();
      for (const r of chain) {
        for (const [k, v] of r.bindings) merged.set(k, v);
      }
      return merged;
    },
  };
}

function spanLength(r: ScopeRegion): number {
  return r.end - r.start;
}

function lineColumnIndex(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

function parseAssign(args: string): { name: string; rhs: string } | null {
  const match = args.match(/^\s*([\w-]+)\s*=\s*(.+?)\s*$/);
  if (!match) return null;
  return { name: match[1]!, rhs: match[2]! };
}

function parseForArgs(args: string): { varName: string; collection: string } | null {
  const match = args.match(/^\s*([\w-]+)\s+in\s+(.+?)(?:\s+(?:reversed|offset:|limit:).*)?$/);
  if (!match) return null;
  return { varName: match[1]!, collection: match[2]!.trim() };
}

function inferAssignType(rhs: string, scope: ScopeRegion): LiquidType {
  const parts = splitOnPipe(rhs);
  let currentType = lookupExpressionType(parts[0]!.trim(), scope);
  for (let i = 1; i < parts.length; i++) {
    const filterName = parts[i]!.trim().split(/[\s:]/)[0]!;
    currentType = getFilterReturnType(filterName);
  }
  return currentType;
}

function splitOnPipe(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inStr: string | null = null;
  for (const ch of s) {
    if (inStr) {
      buf += ch;
      if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
    } else if (ch === '|') {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out;
}

function lookupExpressionType(expr: string, scope: ScopeRegion): LiquidType {
  expr = expr.trim();
  if (/^"[^"]*"$/.test(expr) || /^'[^']*'$/.test(expr)) return { kind: 'string' };
  if (/^-?\d+(\.\d+)?$/.test(expr)) return { kind: 'number' };
  if (expr === 'true' || expr === 'false') return { kind: 'boolean' };
  if (expr === 'nil' || expr === 'null') return { kind: 'null' };

  const root = expr.split('.')[0]!;
  for (let c: ScopeRegion | null = scope; c; c = c.parent) {
    const b = c.bindings.get(root);
    if (b) {
      if (root === expr) return b.type;
      return walkPath(b.type, expr.split('.').slice(1));
    }
  }
  return { kind: 'unknown' };
}

function walkPath(type: LiquidType, path: string[]): LiquidType {
  let t = type;
  for (const seg of path) {
    if (t.kind === 'object' && t.properties[seg]) {
      t = t.properties[seg]!.type;
    } else {
      return { kind: 'unknown' };
    }
  }
  return t;
}
