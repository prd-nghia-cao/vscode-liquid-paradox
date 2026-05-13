import * as ts from 'typescript';
import * as path from 'node:path';

export interface ResolvedPaths {
  pagesDir: string;
  layoutsDir: string;
  partialsDir: string;
  componentsDir: string;
}

export type ViteConfigResult = { ok: true; paths: ResolvedPaths } | { ok: false; reason: string };

const REQUIRED_KEYS: Array<keyof ResolvedPaths> = ['pagesDir', 'layoutsDir', 'partialsDir', 'componentsDir'];

export function parseViteConfig(source: string, repoRoot: string): ViteConfigResult {
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile('vite.config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  } catch (err) {
    return { ok: false, reason: 'failed to parse vite.config.ts: ' + String(err) };
  }

  const parseDiags: readonly ts.Diagnostic[] =
    (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseDiags.some((d) => d.category === ts.DiagnosticCategory.Error)) {
    return { ok: false, reason: 'syntax errors in vite.config.ts' };
  }

  let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'pageDiscoveryPlugin'
    ) {
      call = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!call) return { ok: false, reason: 'no pageDiscoveryPlugin() call found' };
  const arg = call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    return { ok: false, reason: 'pageDiscoveryPlugin() called without an object-literal options argument' };
  }

  const collected: Partial<Record<keyof ResolvedPaths, string>> = {};
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    let key: string | undefined;
    if (ts.isIdentifier(prop.name)) key = prop.name.text;
    else if (ts.isStringLiteral(prop.name)) key = prop.name.text;
    if (!key || !REQUIRED_KEYS.includes(key as keyof ResolvedPaths)) continue;
    if (!ts.isStringLiteral(prop.initializer)) {
      return { ok: false, reason: `'${key}' must be a string literal` };
    }
    collected[key as keyof ResolvedPaths] = prop.initializer.text;
  }

  for (const k of REQUIRED_KEYS) {
    if (!collected[k]) return { ok: false, reason: `missing required option '${k}'` };
  }

  return {
    ok: true,
    paths: {
      pagesDir: path.resolve(repoRoot, collected.pagesDir!),
      layoutsDir: path.resolve(repoRoot, collected.layoutsDir!),
      partialsDir: path.resolve(repoRoot, collected.partialsDir!),
      componentsDir: path.resolve(repoRoot, collected.componentsDir!),
    },
  };
}
