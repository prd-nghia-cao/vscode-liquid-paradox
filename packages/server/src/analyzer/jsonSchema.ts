import type { Binding, LiquidType, Range } from '../types.js';

export function inferLiquidType(value: unknown): LiquidType {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return { kind: 'string' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (Array.isArray(value)) return inferArrayType(value);
  if (typeof value === 'object') return inferObjectType(value as Record<string, unknown>);
  return { kind: 'unknown' };
}

function inferObjectType(obj: Record<string, unknown>): LiquidType {
  const properties: Record<string, { type: LiquidType; optional: boolean }> = {};
  for (const [key, val] of Object.entries(obj)) {
    properties[key] = { type: inferLiquidType(val), optional: false };
  }
  return { kind: 'object', properties };
}

function inferArrayType(arr: unknown[]): LiquidType {
  if (arr.length === 0) return { kind: 'array', element: { kind: 'unknown' } };
  const elementTypes = arr.map(inferLiquidType);
  return { kind: 'array', element: mergeTypes(elementTypes) };
}

export function mergeTypes(types: LiquidType[]): LiquidType {
  if (types.length === 0) return { kind: 'unknown' };
  if (types.length === 1) return types[0]!;

  const allObjects = types.every((t) => t.kind === 'object');
  if (allObjects) {
    return mergeObjectTypes(types as Array<Extract<LiquidType, { kind: 'object' }>>);
  }

  const seen = new Map<string, LiquidType>();
  for (const t of types) {
    const key = JSON.stringify(t);
    if (!seen.has(key)) seen.set(key, t);
  }
  const variants = [...seen.values()];
  if (variants.length === 1) return variants[0]!;
  return { kind: 'union', variants };
}

function mergeObjectTypes(objs: Array<Extract<LiquidType, { kind: 'object' }>>): LiquidType {
  const allKeys = new Set<string>();
  for (const o of objs) for (const k of Object.keys(o.properties)) allKeys.add(k);

  const properties: Record<string, { type: LiquidType; optional: boolean }> = {};
  for (const key of allKeys) {
    const presentTypes: LiquidType[] = [];
    let optional = false;
    for (const o of objs) {
      const p = o.properties[key];
      if (p) {
        presentTypes.push(p.type);
      } else {
        optional = true;
      }
    }
    properties[key] = { type: mergeTypes(presentTypes), optional };
  }
  return { kind: 'object', properties };
}

export function inferTopLevelBindings(jsonPath: string, root: unknown): Binding[] {
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return [];
  const obj = root as Record<string, unknown>;
  const bindings: Binding[] = [];
  for (const [key, value] of Object.entries(obj)) {
    bindings.push({
      name: key,
      type: inferLiquidType(value),
      origin: { kind: 'json', jsonPath, jsonKeyRange: ZERO_RANGE },
    });
  }
  return bindings;
}

const ZERO_RANGE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
