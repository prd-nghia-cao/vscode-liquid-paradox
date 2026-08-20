import * as ts from 'typescript';
import * as path from 'node:path';

export interface ResolvedPaths {
  pagesDir: string;
  layoutsDir: string;
  partialsDir: string;
  componentsDir: string;
  /** Static asset root, from `staticAssetsPlugin({ assetsDir })`. */
  assetsDir: string;
}

export type ViteConfigResult = { ok: true; paths: ResolvedPaths } | { ok: false; reason: string };

/** The options `pageDiscoveryPlugin()` declares (`assetsDir` comes from another plugin). */
type PageDiscoveryKey = 'pagesDir' | 'layoutsDir' | 'partialsDir' | 'componentsDir';

const KNOWN_KEYS: PageDiscoveryKey[] = ['pagesDir', 'layoutsDir', 'partialsDir', 'componentsDir'];

/**
 * `pageDiscoveryPlugin()` only declares the directories a given site actually
 * uses — `componentsDir`, for instance, is frequently omitted even when a
 * `src/components` directory exists. Any option that is absent is therefore
 * derived by convention: `<parent of the declared dirs>/<name>`, e.g. a config
 * declaring only `pagesDir: 'src/pages'` yields `src/layouts`, `src/partials`,
 * and `src/components`. Non-existent fallbacks are harmless — `buildFileIndex`
 * skips directories it cannot read.
 */
const CONVENTIONAL_DIR_NAMES: Record<PageDiscoveryKey, string> = {
  pagesDir: 'pages',
  layoutsDir: 'layouts',
  partialsDir: 'partials',
  componentsDir: 'components',
};

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
  let assetsCall: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'pageDiscoveryPlugin') {
        call = node;
        return;
      }
      if (node.expression.text === 'staticAssetsPlugin') {
        assetsCall = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!call) return { ok: false, reason: 'no pageDiscoveryPlugin() call found' };
  const arg = call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    return { ok: false, reason: 'pageDiscoveryPlugin() called without an object-literal options argument' };
  }

  const collected: Partial<Record<PageDiscoveryKey, string>> = {};
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    let key: string | undefined;
    if (ts.isIdentifier(prop.name)) key = prop.name.text;
    else if (ts.isStringLiteral(prop.name)) key = prop.name.text;
    if (!key || !KNOWN_KEYS.includes(key as PageDiscoveryKey)) continue;
    if (!ts.isStringLiteral(prop.initializer)) {
      return { ok: false, reason: `'${key}' must be a string literal` };
    }
    collected[key as PageDiscoveryKey] = prop.initializer.text;
  }

  const declared = KNOWN_KEYS.filter((k) => collected[k]);
  if (declared.length === 0) {
    return {
      ok: false,
      reason: 'pageDiscoveryPlugin() declares none of pagesDir/layoutsDir/partialsDir/componentsDir',
    };
  }

  // All declared directories are expected to be siblings; use the first one's
  // parent as the source root that missing directories are derived from.
  const srcRoot = path.dirname(path.resolve(repoRoot, collected[declared[0]!]!));

  const resolve = (k: PageDiscoveryKey): string =>
    collected[k] ? path.resolve(repoRoot, collected[k]!) : path.join(srcRoot, CONVENTIONAL_DIR_NAMES[k]);

  return {
    ok: true,
    paths: {
      pagesDir: resolve('pagesDir'),
      layoutsDir: resolve('layoutsDir'),
      partialsDir: resolve('partialsDir'),
      componentsDir: resolve('componentsDir'),
      assetsDir: resolveAssetsDir(assetsCall, repoRoot, srcRoot),
    },
  };
}

/**
 * `staticAssetsPlugin({ assetsDir: 'src/assets' })` declares the static asset
 * root. The option is optional (the plugin defaults to `src/assets`) and the
 * whole plugin may be absent, so both fall back to `<srcRoot>/assets` — a
 * non-existent directory simply yields an empty asset index.
 */
function resolveAssetsDir(assetsCall: ts.CallExpression | undefined, repoRoot: string, srcRoot: string): string {
  const fallback = path.join(srcRoot, 'assets');
  const arg = assetsCall?.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return fallback;
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
    if (key !== 'assetsDir') continue;
    if (!ts.isStringLiteral(prop.initializer)) return fallback;
    return path.resolve(repoRoot, prop.initializer.text);
  }
  return fallback;
}
