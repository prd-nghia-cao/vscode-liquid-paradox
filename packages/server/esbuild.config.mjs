import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const dev = process.env.NODE_ENV === 'development';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Prefer each dependency's ESM (`module`) entry over its CommonJS/UMD `main`.
  // vscode-html-languageservice ships a UMD `main` whose internal modules are
  // pulled in via a factory-injected `require('./parser/...')`; esbuild leaves
  // those as runtime requires, so the bundle fails at load with
  // "Cannot find module './parser/htmlScanner'". Its ESM build uses static
  // imports that esbuild can fully inline.
  mainFields: ['module', 'main'],
  outfile: 'dist/server.cjs',
  external: [],
  minify: !dev,
  sourcemap: dev,
  logLevel: 'info',
});

// Defense-in-depth: fail the build loudly if any dependency's internal modules
// were left as runtime relative requires instead of being inlined. This is the
// signature of the vscode-html-languageservice UMD-vs-ESM bundling bug
// ("Cannot find module './parser/htmlScanner'") that `mainFields` above fixes.
const bundle = await readFile('dist/server.cjs', 'utf8');
const unbundled = bundle.match(/require\d*\(\s*["']\.\/(parser|services|languageFacts)\/[^"']+["']\)/);
if (unbundled) {
  throw new Error(
    `Bundle contains an unbundled relative require (${unbundled[0]}). ` +
      'The HTML language service was not fully inlined — check esbuild `mainFields`.',
  );
}

// Defense-in-depth: minification renames bundled classes, so any `constructor.name`
// comparison against a dependency's class name silently stops matching in the
// production build. That once collapsed every Liquid token into an `html` token,
// disabling props, scope, and diagnostics while the unminified build passed all
// unit tests. Branch on stable data (e.g. liquidjs's numeric `TokenKind`) instead.
const ctorNameCheck = bundle.match(/constructor\s*\.\s*name\s*={2,3}\s*["'][A-Z]/);
if (ctorNameCheck) {
  throw new Error(
    `Bundle compares constructor.name against a class-name literal (${ctorNameCheck[0]}). ` +
      'Minification renames bundled classes — branch on a stable value instead.',
  );
}
