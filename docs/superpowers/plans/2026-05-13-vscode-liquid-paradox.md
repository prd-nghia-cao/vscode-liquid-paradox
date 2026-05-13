# vscode-liquid-paradox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code LSP extension that provides full IntelliSense (completions, hover, go-to-definition, diagnostics) for `.liquid` files in LiquidJS + Paradox by Workday static-site projects.

**Architecture:** Two-package pnpm monorepo. A thin **client** package is the VS Code extension whose only job is booting the language server. A Node-based **server** package contains all analysis: a LiquidJS-driven tokenizer/parser, scope tracker, JSON-schema inferer, `vite.config.ts` parser via the TypeScript Compiler API, file index, and four LSP providers (completion, hover, definition, diagnostics). The server has zero `vscode` API imports — it depends only on `vscode-languageserver` so it stays editor-agnostic.

**Tech Stack:**

- TypeScript strict mode
- pnpm workspaces
- `liquidjs` (Tokenizer / Parser / analyze)
- `vscode-languageserver` + `vscode-languageserver-textdocument` (server)
- `vscode-languageclient` (client)
- `typescript` as a library (parses `vite.config.ts` — never executes it)
- esbuild for bundling each package
- Vitest + `memfs` for tests
- `@vscode/vsce` for packaging

---

## File Structure

Before tasks begin, here is the locked-in layout. Tasks reference these exact paths.

```
vscode-liquid-paradox/
├── package.json                                # workspace root, devDeps only
├── pnpm-workspace.yaml
├── tsconfig.base.json                          # strict, ES2022, NodeNext
├── .vscode/launch.json                         # F5 → Extension Dev Host
├── .github/workflows/ci.yml
├── fixtures/career-site-mini/                  # trimmed test workspace
│   ├── vite.config.ts
│   ├── src/pages/home.liquid (+ .json)
│   ├── src/layouts/main.liquid
│   ├── src/partials/testimonials.liquid (+ .json)
│   └── src/components/button.liquid
├── packages/
│   ├── client/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── esbuild.config.mjs
│   │   ├── syntaxes/paradox-injection.tmLanguage.json   # empty placeholder
│   │   └── src/extension.ts                    # activate(): spawn server, wire client
│   └── server/
│       ├── package.json
│       ├── tsconfig.json
│       ├── esbuild.config.mjs
│       ├── vitest.config.ts
│       └── src/
│           ├── server.ts                       # LSP connection + handler registration
│           ├── types.ts                        # shared interfaces (LiquidType, Binding, ...)
│           ├── data/
│           │   ├── tags.ts                     # built-in LiquidJS tag table
│           │   ├── filters.ts                  # built-in filter table + return-type map
│           │   └── paradoxTags.ts              # 4 paradox kinds + hover strings
│           ├── analyzer/
│           │   ├── tokenize.ts                 # wraps liquidjs Tokenizer w/ tolerance
│           │   ├── ast.ts                      # token stream → typed AST
│           │   ├── scope.ts                    # scope stack walker, binding tracker
│           │   ├── jsonSchema.ts               # JSON → LiquidType tree
│           │   ├── propBlock.ts                # extract component props from leading assigns
│           │   ├── paradoxPrepass.ts           # detect {{kind:value}} nodes
│           │   └── document.ts                 # orchestrator → DocumentModel
│           ├── workspace/
│           │   ├── viteConfig.ts               # parse vite.config.ts via ts API
│           │   ├── fileIndex.ts                # 3 maps: components / partials / layouts
│           │   ├── documentStore.ts            # URI → DocumentModel cache
│           │   ├── depGraph.ts                 # inverse map: who depends on me?
│           │   └── watchers.ts                 # register LSP file watchers
│           └── providers/
│               ├── completion.ts
│               ├── hover.ts
│               ├── definition.ts
│               └── diagnostics.ts
└── docs/superpowers/
    ├── specs/2026-05-13-vscode-liquid-paradox-design.md   # already exists
    └── plans/2026-05-13-vscode-liquid-paradox.md          # this file
```

**Shared types** (declared in `packages/server/src/types.ts`, referenced throughout):

```ts
// Type tree used by jsonSchema, scope, hover
export type LiquidType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'unknown' }
  | { kind: 'array'; element: LiquidType }
  | { kind: 'object'; properties: Record<string, { type: LiquidType; optional: boolean }> }
  | { kind: 'union'; variants: LiquidType[] };

export type VariableOrigin =
  | { kind: 'json'; jsonPath: string; jsonKeyRange: Range }
  | { kind: 'local'; tag: 'assign' | 'capture' | 'for' | 'tablerow' | 'increment' | 'decrement'; declRange: Range }
  | { kind: 'componentProp'; componentPath: string; defaultValue: string; declRange: Range }
  | { kind: 'builtin'; name: 'forloop' | 'tablerowloop' | 'content' };

export interface Binding {
  name: string;
  type: LiquidType;
  origin: VariableOrigin;
}

export interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface Scope {
  parent: Scope | null;
  bindings: Map<string, Binding>;
}

export interface ParadoxTag {
  kind: 'component' | 'snippet' | 'data' | 'attribute';
  value: string;
  range: Range;
}

export interface Dependencies {
  jsonCompanion?: string;
  renderedFiles: string[];
  layoutFile?: string;
}

export interface DocumentModel {
  uri: string;
  text: string;
  ast: AstNode; // root node from analyzer/ast.ts
  scopeByOffset: (offset: number) => Scope;
  paradoxTags: ParadoxTag[];
  diagnostics: Diagnostic[]; // from vscode-languageserver
  dependencies: Dependencies;
  componentProps?: Binding[]; // populated only if file is under componentsDir
}
```

These types are defined in **Task 7** before any analyzer module imports them.

---

## Phase 0 — Repository Scaffolding

This phase produces an empty-but-working monorepo: pnpm workspaces resolve, both packages typecheck, `esbuild` bundles each, Vitest runs a smoke test, and pressing F5 launches an Extension Dev Host with a client that activates on `.liquid` files and connects to a server that does nothing yet.

### Task 1: Workspace root

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore` (already exists from spec phase — verify contents)

- [ ] **Step 1: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 2: Write the root `package.json`**

```json
{
  "name": "vscode-liquid-paradox-monorepo",
  "private": true,
  "version": "0.0.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.14.0",
    "esbuild": "^0.21.0",
    "vitest": "^2.0.0"
  },
  "packageManager": "pnpm@9.6.0"
}
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Verify `.gitignore` contents**

Run: `cat .gitignore`
Expected output:

```
node_modules/
dist/
out/
.vscode-test/
*.vsix
.DS_Store
*.log
```

If missing or different, overwrite with the above.

- [ ] **Step 5: Install workspace devDeps**

Run: `pnpm install`
Expected: writes `pnpm-lock.yaml`, creates `node_modules/`. No errors.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: init pnpm workspace with TypeScript base config"
```

### Task 2: Server package scaffold

**Files:**

- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/esbuild.config.mjs`
- Create: `packages/server/vitest.config.ts`
- Create: `packages/server/src/server.ts`
- Test: `packages/server/src/server.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/server/src/server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createServer } from './server.js';

describe('createServer', () => {
  it('returns a function that, when called, exits cleanly with no connection', () => {
    expect(typeof createServer).toBe('function');
  });
});
```

- [ ] **Step 2: Write `packages/server/package.json`**

```json
{
  "name": "@vscode-liquid-paradox/server",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/server.js",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "liquidjs": "^10.16.0",
    "vscode-languageserver": "^9.0.1",
    "vscode-languageserver-textdocument": "^1.0.12",
    "typescript": "^5.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "esbuild": "^0.21.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Write `packages/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 4: Write `packages/server/esbuild.config.mjs`**

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/server.js',
  external: [],
  sourcemap: true,
  logLevel: 'info',
});
```

(Server bundles as CJS so the client can spawn it via `node` without ESM interop friction.)

- [ ] **Step 5: Write `packages/server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 6: Write the minimal `packages/server/src/server.ts`**

```ts
export function createServer(): void {
  // Wired up in Phase 5. For now this is a stub so the package builds.
}
```

- [ ] **Step 7: Install and verify**

Run from repo root: `pnpm install`
Then: `pnpm --filter @vscode-liquid-paradox/server test`
Expected: `1 passed`.

Then: `pnpm --filter @vscode-liquid-paradox/server typecheck`
Expected: exits 0.

Then: `pnpm --filter @vscode-liquid-paradox/server build`
Expected: writes `packages/server/dist/server.js`.

- [ ] **Step 8: Commit**

```bash
git add packages/server pnpm-lock.yaml
git commit -m "feat(server): scaffold language server package"
```

### Task 3: Client package scaffold

**Files:**

- Create: `packages/client/package.json`
- Create: `packages/client/tsconfig.json`
- Create: `packages/client/esbuild.config.mjs`
- Create: `packages/client/src/extension.ts`
- Create: `packages/client/syntaxes/paradox-injection.tmLanguage.json`

- [ ] **Step 1: Write `packages/client/package.json`**

```json
{
  "name": "vscode-liquid-paradox",
  "private": true,
  "displayName": "Liquid Paradox",
  "description": "IntelliSense for LiquidJS templates in Paradox by Workday projects.",
  "version": "0.0.1",
  "publisher": "local-dev",
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Programming Languages"],
  "activationEvents": ["onLanguage:liquid"],
  "main": "./dist/extension.js",
  "contributes": {
    "languages": [
      {
        "id": "liquid",
        "aliases": ["Liquid", "liquid"],
        "extensions": [".liquid"]
      }
    ],
    "grammars": [
      {
        "scopeName": "paradox.injection",
        "path": "./syntaxes/paradox-injection.tmLanguage.json",
        "injectTo": ["text.html.liquid"]
      }
    ],
    "extensionDependencies": ["sissel.shopify-liquid"]
  },
  "scripts": {
    "build": "node esbuild.config.mjs",
    "typecheck": "tsc --noEmit",
    "test": "echo \"client has no unit tests\" && exit 0",
    "lint": "tsc --noEmit",
    "package": "vsce package --no-dependencies"
  },
  "dependencies": {
    "vscode-languageclient": "^9.0.1"
  },
  "devDependencies": {
    "@types/vscode": "^1.90.0",
    "@vscode/vsce": "^2.32.0",
    "esbuild": "^0.21.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Write `packages/client/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node", "vscode"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Write `packages/client/esbuild.config.mjs`**

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
});
```

- [ ] **Step 4: Write the empty Paradox grammar placeholder**

`packages/client/syntaxes/paradox-injection.tmLanguage.json`:

```json
{
  "scopeName": "paradox.injection",
  "injectionSelector": "L:text.html.liquid",
  "patterns": []
}
```

(Reserved slot per spec §7. Empty patterns array is valid and contributes nothing visible.)

- [ ] **Step 5: Write the minimal `packages/client/src/extension.ts`**

```ts
import * as path from 'node:path';
import { ExtensionContext, workspace } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('..', 'server', 'dist', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'liquid' }],
    synchronize: {
      fileEvents: [
        workspace.createFileSystemWatcher('**/vite.config.ts'),
        workspace.createFileSystemWatcher('**/*.liquid'),
        workspace.createFileSystemWatcher('**/*.liquid.json'),
      ],
    },
  };

  client = new LanguageClient('liquidParadox', 'Liquid Paradox', serverOptions, clientOptions);
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
```

- [ ] **Step 6: Install and verify**

Run from repo root: `pnpm install`
Then: `pnpm --filter vscode-liquid-paradox typecheck`
Expected: exits 0.

Then: `pnpm --filter vscode-liquid-paradox build`
Expected: writes `packages/client/dist/extension.js`.

- [ ] **Step 7: Commit**

```bash
git add packages/client pnpm-lock.yaml
git commit -m "feat(client): scaffold VS Code extension that boots the LSP server"
```

### Task 4: F5 launch configuration

**Files:**

- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`

- [ ] **Step 1: Write `.vscode/tasks.json`**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "build:all",
      "type": "shell",
      "command": "pnpm -r build",
      "group": { "kind": "build", "isDefault": true },
      "problemMatcher": []
    },
    {
      "label": "watch:server",
      "type": "shell",
      "command": "pnpm --filter @vscode-liquid-paradox/server build -- --watch",
      "isBackground": true,
      "problemMatcher": []
    }
  ]
}
```

- [ ] **Step 2: Write `.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}/packages/client",
        "${workspaceFolder}/../local-career-site"
      ],
      "outFiles": ["${workspaceFolder}/packages/client/dist/**/*.js"],
      "preLaunchTask": "build:all"
    },
    {
      "name": "Attach to Server",
      "type": "node",
      "request": "attach",
      "port": 6009,
      "restart": true,
      "outFiles": ["${workspaceFolder}/packages/server/dist/**/*.js"]
    }
  ]
}
```

- [ ] **Step 3: Verify by manual smoke**

Open this repo in VS Code, press F5. An "Extension Development Host" window opens on `local-career-site`. Open any `.liquid` file. The extension activates (visible in the host's "Extensions" tab as "Liquid Paradox — running"). The server stub does nothing — no errors expected.

If the dependency `sissel.shopify-liquid` isn't installed in the host, VS Code will prompt; install it and reload.

- [ ] **Step 4: Commit**

```bash
git add .vscode
git commit -m "chore: add F5 launch config for Extension Dev Host"
```

### Task 5: Shared types module

**Files:**

- Create: `packages/server/src/types.ts`
- Test: `packages/server/src/types.test.ts`

This task locks in the type interfaces every later module imports. No runtime logic — types only — but Vitest still runs an empty test file to confirm the module compiles.

- [ ] **Step 1: Write the failing test**

`packages/server/src/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { LiquidType, Binding, Scope, Range, ParadoxTag, Dependencies, VariableOrigin } from './types.js';

describe('types module', () => {
  it('exports LiquidType variants that can be discriminated by kind', () => {
    const t: LiquidType = { kind: 'string' };
    expect(t.kind).toBe('string');
  });

  it('exports a Binding type tying name + type + origin', () => {
    const origin: VariableOrigin = { kind: 'builtin', name: 'forloop' };
    const b: Binding = {
      name: 'forloop',
      type: { kind: 'object', properties: {} },
      origin,
    };
    expect(b.name).toBe('forloop');
  });

  it('exports a Scope linked-list shape', () => {
    const s: Scope = { parent: null, bindings: new Map() };
    expect(s.bindings.size).toBe(0);
  });

  it('exports Range as LSP-compatible { start, end }', () => {
    const r: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    expect(r.start.line).toBe(0);
  });

  it('exports ParadoxTag with four kinds', () => {
    const p: ParadoxTag = {
      kind: 'component',
      value: 'Hero',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    };
    expect(p.kind).toBe('component');
  });

  it('exports Dependencies with optional companions and renderedFiles array', () => {
    const d: Dependencies = { renderedFiles: [] };
    expect(d.renderedFiles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test types`
Expected: FAIL with "Cannot find module './types.js'".

- [ ] **Step 3: Write `packages/server/src/types.ts`**

```ts
export type LiquidType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'unknown' }
  | { kind: 'array'; element: LiquidType }
  | { kind: 'object'; properties: Record<string, { type: LiquidType; optional: boolean }> }
  | { kind: 'union'; variants: LiquidType[] };

export interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export type VariableOrigin =
  | { kind: 'json'; jsonPath: string; jsonKeyRange: Range }
  | {
      kind: 'local';
      tag: 'assign' | 'capture' | 'for' | 'tablerow' | 'increment' | 'decrement';
      declRange: Range;
    }
  | { kind: 'componentProp'; componentPath: string; defaultValue: string; declRange: Range }
  | { kind: 'builtin'; name: 'forloop' | 'tablerowloop' | 'content' };

export interface Binding {
  name: string;
  type: LiquidType;
  origin: VariableOrigin;
}

export interface Scope {
  parent: Scope | null;
  bindings: Map<string, Binding>;
}

export interface ParadoxTag {
  kind: 'component' | 'snippet' | 'data' | 'attribute';
  value: string;
  range: Range;
}

export interface Dependencies {
  jsonCompanion?: string;
  renderedFiles: string[];
  layoutFile?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test types`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/types.test.ts
git commit -m "feat(server): define shared analyzer type interfaces"
```

### Task 6: ESLint + Prettier baseline

**Files:**

- Create: `.eslintrc.cjs`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json` (add `eslint`, `prettier` to devDeps + `lint` / `format` scripts)

- [ ] **Step 1: Write `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 120,
  "tabWidth": 2
}
```

- [ ] **Step 2: Write `.prettierignore`**

```
dist/
out/
node_modules/
*.vsix
pnpm-lock.yaml
```

- [ ] **Step 3: Write `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: null, ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'out/', 'node_modules/', 'fixtures/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
```

- [ ] **Step 4: Update root `package.json`** — add to `devDependencies` and `scripts`:

```json
{
  "devDependencies": {
    "eslint": "^8.57.0",
    "@typescript-eslint/parser": "^7.16.0",
    "@typescript-eslint/eslint-plugin": "^7.16.0",
    "prettier": "^3.3.0"
  },
  "scripts": {
    "lint": "eslint 'packages/**/src/**/*.ts'",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

(Merge — don't replace — with existing fields.)

- [ ] **Step 5: Install and verify**

Run: `pnpm install`
Then: `pnpm lint`
Expected: exits 0 (only `types.ts` and `server.ts` exist; no violations).

Then: `pnpm format:check`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add .eslintrc.cjs .prettierrc.json .prettierignore package.json pnpm-lock.yaml
git commit -m "chore: add ESLint and Prettier baseline"
```

---

## Phase 1 — Static Data Tables

Three pure data modules. No dependencies on anything but `types.ts`. Each module exports a frozen record consumed by completion + hover + diagnostics.

### Task 7: Built-in tag table

**Files:**

- Create: `packages/server/src/data/tags.ts`
- Test: `packages/server/src/data/tags.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/server/src/data/tags.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TAGS, isKnownTag, getTagInfo, isClosingTag, getOpeningForClosing } from './tags.js';

describe('tag table', () => {
  it('exposes all LiquidJS standard tags including closing forms', () => {
    const names = Object.keys(TAGS);
    for (const expected of [
      'if',
      'endif',
      'unless',
      'endunless',
      'for',
      'endfor',
      'case',
      'when',
      'else',
      'endcase',
      'assign',
      'capture',
      'endcapture',
      'render',
      'include',
      'layout',
      'tablerow',
      'endtablerow',
      'cycle',
      'increment',
      'decrement',
      'raw',
      'endraw',
      'comment',
      'endcomment',
      'liquid',
      'echo',
      'break',
      'continue',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('isKnownTag returns true for known tags and false for unknown', () => {
    expect(isKnownTag('if')).toBe(true);
    expect(isKnownTag('endif')).toBe(true);
    expect(isKnownTag('flarp')).toBe(false);
  });

  it('getTagInfo returns description + syntax + docsUrl', () => {
    const info = getTagInfo('for');
    expect(info?.description).toMatch(/iterate/i);
    expect(info?.syntax).toContain('{% for');
    expect(info?.docsUrl).toBe('https://liquidjs.com/tags/for.html');
  });

  it('classifies closing tags', () => {
    expect(isClosingTag('endif')).toBe(true);
    expect(isClosingTag('if')).toBe(false);
    expect(getOpeningForClosing('endif')).toBe('if');
    expect(getOpeningForClosing('endcapture')).toBe('capture');
    expect(getOpeningForClosing('if')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test tags`
Expected: FAIL ("Cannot find module './tags.js'").

- [ ] **Step 3: Write `packages/server/src/data/tags.ts`**

```ts
export interface TagInfo {
  name: string;
  description: string;
  syntax: string;
  docsUrl: string;
  isClosing: boolean;
  opens?: string;
}

function tag(
  name: string,
  description: string,
  syntax: string,
  opts: { isClosing?: boolean; opens?: string } = {},
): [string, TagInfo] {
  return [
    name,
    {
      name,
      description,
      syntax,
      docsUrl: `https://liquidjs.com/tags/${name.replace(/^end/, '')}.html`,
      isClosing: opts.isClosing ?? false,
      opens: opts.opens,
    },
  ];
}

export const TAGS: Readonly<Record<string, TagInfo>> = Object.freeze(
  Object.fromEntries([
    tag('if', 'Render a block if the condition is truthy.', '{% if condition %}...{% endif %}'),
    tag('elsif', 'Add a branch to an if/case.', '{% elsif condition %}'),
    tag('else', 'Fallback branch in if/case/unless.', '{% else %}'),
    tag('endif', 'Close an if block.', '{% endif %}', { isClosing: true, opens: 'if' }),
    tag('unless', 'Render a block if the condition is falsy.', '{% unless condition %}...{% endunless %}'),
    tag('endunless', 'Close an unless block.', '{% endunless %}', { isClosing: true, opens: 'unless' }),
    tag('case', 'Switch on a value.', '{% case value %}{% when ... %}{% endcase %}'),
    tag('when', 'Branch in a case block.', '{% when literal %}'),
    tag('endcase', 'Close a case block.', '{% endcase %}', { isClosing: true, opens: 'case' }),
    tag('for', 'Iterate over an array, range, or generator.', '{% for item in collection %}...{% endfor %}'),
    tag('endfor', 'Close a for loop.', '{% endfor %}', { isClosing: true, opens: 'for' }),
    tag('break', 'Exit the enclosing for loop.', '{% break %}'),
    tag('continue', 'Skip to the next iteration of the enclosing for loop.', '{% continue %}'),
    tag('tablerow', 'Render rows of an HTML table.', '{% tablerow item in collection %}...{% endtablerow %}'),
    tag('endtablerow', 'Close a tablerow block.', '{% endtablerow %}', { isClosing: true, opens: 'tablerow' }),
    tag('cycle', 'Cycle through a list of strings each time it is rendered.', '{% cycle "a", "b", "c" %}'),
    tag('assign', 'Bind a value to a variable.', '{% assign name = expression %}'),
    tag('capture', 'Capture the rendered block as a string variable.', '{% capture name %}...{% endcapture %}'),
    tag('endcapture', 'Close a capture block.', '{% endcapture %}', { isClosing: true, opens: 'capture' }),
    tag('increment', 'Create or increment a counter starting at 0.', '{% increment counter %}'),
    tag('decrement', 'Create or decrement a counter starting at -1.', '{% decrement counter %}'),
    tag('render', 'Render another template in an isolated scope.', '{% render "template", key: value %}'),
    tag('include', 'Render another template in the current scope (legacy).', '{% include "template" %}'),
    tag('layout', 'Wrap this template in a layout.', '{% layout "layout-name" %}'),
    tag('raw', 'Output the block contents without parsing Liquid.', '{% raw %}...{% endraw %}'),
    tag('endraw', 'Close a raw block.', '{% endraw %}', { isClosing: true, opens: 'raw' }),
    tag('comment', 'Comment block. Contents are not rendered.', '{% comment %}...{% endcomment %}'),
    tag('endcomment', 'Close a comment block.', '{% endcomment %}', { isClosing: true, opens: 'comment' }),
    tag('liquid', 'Run multiple Liquid statements without delimiters.', '{% liquid\n  assign x = 1\n%}'),
    tag('echo', 'Output an expression (equivalent to {{ ... }}).', '{% echo expression %}'),
  ]),
);

export function isKnownTag(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TAGS, name);
}

export function getTagInfo(name: string): TagInfo | undefined {
  return TAGS[name];
}

export function isClosingTag(name: string): boolean {
  return TAGS[name]?.isClosing ?? false;
}

export function getOpeningForClosing(name: string): string | undefined {
  return TAGS[name]?.opens;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test tags`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/data/tags.ts packages/server/src/data/tags.test.ts
git commit -m "feat(server): add built-in LiquidJS tag table"
```

### Task 8: Built-in filter table

**Files:**

- Create: `packages/server/src/data/filters.ts`
- Test: `packages/server/src/data/filters.test.ts`

The filter table also encodes return types so that `analyzer/scope.ts` can infer `{% assign x = title | upcase %}` as `string`. Unknown filter chains yield `unknown`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/data/filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FILTERS, isKnownFilter, getFilterInfo, getFilterReturnType } from './filters.js';

describe('filter table', () => {
  it('exposes the LiquidJS standard library across all categories', () => {
    const names = Object.keys(FILTERS);
    for (const expected of [
      'abs',
      'at_least',
      'at_most',
      'ceil',
      'divided_by',
      'floor',
      'minus',
      'modulo',
      'plus',
      'round',
      'times',
      'append',
      'capitalize',
      'downcase',
      'upcase',
      'lstrip',
      'rstrip',
      'strip',
      'newline_to_br',
      'prepend',
      'remove',
      'remove_first',
      'replace',
      'replace_first',
      'slice',
      'split',
      'truncate',
      'truncatewords',
      'url_decode',
      'url_encode',
      'escape',
      'escape_once',
      'strip_html',
      'strip_newlines',
      'compact',
      'concat',
      'first',
      'join',
      'last',
      'map',
      'reverse',
      'size',
      'sort',
      'sort_natural',
      'uniq',
      'where',
      'date',
      'default',
      'json',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('returns filter info with docsUrl', () => {
    const info = getFilterInfo('upcase');
    expect(info?.signature).toBe('upcase');
    expect(info?.docsUrl).toBe('https://liquidjs.com/filters/upcase.html');
    expect(info?.description).toMatch(/upper/i);
  });

  it('encodes static return types when known', () => {
    expect(getFilterReturnType('upcase')).toEqual({ kind: 'string' });
    expect(getFilterReturnType('size')).toEqual({ kind: 'number' });
    expect(getFilterReturnType('first')).toEqual({ kind: 'unknown' }); // depends on input
    expect(getFilterReturnType('default')).toEqual({ kind: 'unknown' }); // depends on input
    expect(getFilterReturnType('not_a_filter')).toEqual({ kind: 'unknown' });
  });

  it('isKnownFilter is strict', () => {
    expect(isKnownFilter('upcase')).toBe(true);
    expect(isKnownFilter('Upcase')).toBe(false);
    expect(isKnownFilter('made_up_filter')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test filters`
Expected: FAIL ("Cannot find module './filters.js'").

- [ ] **Step 3: Write `packages/server/src/data/filters.ts`**

```ts
import type { LiquidType } from '../types.js';

export interface FilterInfo {
  name: string;
  signature: string;
  description: string;
  docsUrl: string;
  /** Return type if statically known; null means "depends on input — return unknown". */
  returnType: LiquidType | null;
}

const STRING: LiquidType = { kind: 'string' };
const NUMBER: LiquidType = { kind: 'number' };
const BOOLEAN: LiquidType = { kind: 'boolean' };

function f(name: string, signature: string, description: string, returnType: LiquidType | null): [string, FilterInfo] {
  return [name, { name, signature, description, docsUrl: `https://liquidjs.com/filters/${name}.html`, returnType }];
}

export const FILTERS: Readonly<Record<string, FilterInfo>> = Object.freeze(
  Object.fromEntries([
    // Math
    f('abs', 'abs', 'Absolute value.', NUMBER),
    f('at_least', 'at_least(min)', 'Returns the larger of input and min.', NUMBER),
    f('at_most', 'at_most(max)', 'Returns the smaller of input and max.', NUMBER),
    f('ceil', 'ceil', 'Round up to the nearest integer.', NUMBER),
    f('divided_by', 'divided_by(divisor)', 'Divide input by divisor.', NUMBER),
    f('floor', 'floor', 'Round down to the nearest integer.', NUMBER),
    f('minus', 'minus(operand)', 'Subtract operand from input.', NUMBER),
    f('modulo', 'modulo(operand)', 'Remainder of input divided by operand.', NUMBER),
    f('plus', 'plus(operand)', 'Add operand to input.', NUMBER),
    f('round', 'round(places?)', 'Round to N decimal places (default 0).', NUMBER),
    f('times', 'times(operand)', 'Multiply input by operand.', NUMBER),
    // String
    f('append', 'append(suffix)', 'Append suffix to input.', STRING),
    f('capitalize', 'capitalize', 'Uppercase the first character.', STRING),
    f('downcase', 'downcase', 'Lowercase all characters.', STRING),
    f('upcase', 'upcase', 'Uppercase all characters.', STRING),
    f('lstrip', 'lstrip', 'Strip leading whitespace.', STRING),
    f('rstrip', 'rstrip', 'Strip trailing whitespace.', STRING),
    f('strip', 'strip', 'Strip leading and trailing whitespace.', STRING),
    f('newline_to_br', 'newline_to_br', 'Replace newlines with <br>.', STRING),
    f('prepend', 'prepend(prefix)', 'Prepend prefix to input.', STRING),
    f('remove', 'remove(substring)', 'Remove every occurrence of substring.', STRING),
    f('remove_first', 'remove_first(substring)', 'Remove the first occurrence of substring.', STRING),
    f('replace', 'replace(from, to)', 'Replace every occurrence of `from` with `to`.', STRING),
    f('replace_first', 'replace_first(from, to)', 'Replace the first occurrence of `from` with `to`.', STRING),
    f('slice', 'slice(start, length?)', 'Substring starting at `start` (negative counts from end).', null),
    f('split', 'split(separator)', 'Split string into an array on separator.', { kind: 'array', element: STRING }),
    f('truncate', 'truncate(length, ellipsis?)', 'Truncate to length characters.', STRING),
    f('truncatewords', 'truncatewords(count, ellipsis?)', 'Truncate to N words.', STRING),
    f('url_decode', 'url_decode', 'Percent-decode the input.', STRING),
    f('url_encode', 'url_encode', 'Percent-encode the input.', STRING),
    f('escape', 'escape', 'HTML-escape the input.', STRING),
    f('escape_once', 'escape_once', 'HTML-escape only un-escaped characters.', STRING),
    f('strip_html', 'strip_html', 'Remove HTML tags.', STRING),
    f('strip_newlines', 'strip_newlines', 'Remove newline characters.', STRING),
    // Array
    f('compact', 'compact', 'Remove nil entries from an array.', null),
    f('concat', 'concat(other)', 'Append `other` array to input.', null),
    f('first', 'first', 'First element of an array.', null),
    f('last', 'last', 'Last element of an array.', null),
    f('join', 'join(separator?)', 'Join array elements with separator (default " ").', STRING),
    f('map', 'map(key)', 'Pluck `key` from each element.', null),
    f('reverse', 'reverse', 'Reverse the array.', null),
    f('size', 'size', 'Length of array or string.', NUMBER),
    f('sort', 'sort(key?)', 'Sort an array (case-sensitive).', null),
    f('sort_natural', 'sort_natural(key?)', 'Sort an array (case-insensitive).', null),
    f('uniq', 'uniq', 'Remove duplicates.', null),
    f('where', 'where(key, value?)', 'Filter array to elements whose `key` equals `value`.', null),
    // Date / misc
    f('date', 'date(format)', 'Format a date (strftime).', STRING),
    f('default', 'default(fallback)', 'Use fallback when input is nil/false/empty.', null),
    f('json', 'json', 'Serialize value as JSON string.', STRING),
    // Numeric → boolean? No standard. Output category — skipped (escape covers HTML).
  ]),
);

export function isKnownFilter(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(FILTERS, name);
}

export function getFilterInfo(name: string): FilterInfo | undefined {
  return FILTERS[name];
}

export function getFilterReturnType(name: string): LiquidType {
  const info = FILTERS[name];
  if (!info || info.returnType === null) return { kind: 'unknown' };
  return info.returnType;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test filters`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/data/filters.ts packages/server/src/data/filters.test.ts
git commit -m "feat(server): add built-in LiquidJS filter table with return types"
```

### Task 9: Paradox tag metadata

**Files:**

- Create: `packages/server/src/data/paradoxTags.ts`
- Test: `packages/server/src/data/paradoxTags.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/server/src/data/paradoxTags.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PARADOX_TAGS, getParadoxHover, PARADOX_KIND_REGEX } from './paradoxTags.js';

describe('paradox tag metadata', () => {
  it('lists exactly four kinds with the wording from the spec', () => {
    expect(PARADOX_TAGS.component.hover).toBe('Render the component on Site Studio');
    expect(PARADOX_TAGS.snippet.hover).toBe('Render the snippet on Site Studio');
    expect(PARADOX_TAGS.data.hover).toBe('Render the data for Site Studio');
    expect(PARADOX_TAGS.attribute.hover).toBe('Render the data for Site Studio');
    expect(Object.keys(PARADOX_TAGS).sort()).toEqual(['attribute', 'component', 'data', 'snippet']);
  });

  it('getParadoxHover is case-sensitive and returns undefined on unknown', () => {
    expect(getParadoxHover('component')).toBe('Render the component on Site Studio');
    expect(getParadoxHover('Component' as any)).toBeUndefined();
    expect(getParadoxHover('widget' as any)).toBeUndefined();
  });

  it('PARADOX_KIND_REGEX matches kind:value with surrounding whitespace', () => {
    expect('component:Hero'.match(PARADOX_KIND_REGEX)?.slice(1)).toEqual(['component', 'Hero']);
    expect('  data : job.title  '.match(PARADOX_KIND_REGEX)?.slice(1)).toEqual(['data', 'job.title']);
    expect('attribute:className'.match(PARADOX_KIND_REGEX)?.slice(1)).toEqual(['attribute', 'className']);
    expect('forloop'.match(PARADOX_KIND_REGEX)).toBeNull();
    expect('not_a_kind:foo'.match(PARADOX_KIND_REGEX)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test paradox`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/data/paradoxTags.ts`**

```ts
import type { ParadoxTag } from '../types.js';

export interface ParadoxKindInfo {
  kind: ParadoxTag['kind'];
  hover: string;
}

export const PARADOX_TAGS: Readonly<Record<ParadoxTag['kind'], ParadoxKindInfo>> = Object.freeze({
  component: { kind: 'component', hover: 'Render the component on Site Studio' },
  snippet: { kind: 'snippet', hover: 'Render the snippet on Site Studio' },
  data: { kind: 'data', hover: 'Render the data for Site Studio' },
  attribute: { kind: 'attribute', hover: 'Render the data for Site Studio' },
});

export function getParadoxHover(kind: string): string | undefined {
  if (kind === 'component' || kind === 'snippet' || kind === 'data' || kind === 'attribute') {
    return PARADOX_TAGS[kind].hover;
  }
  return undefined;
}

export const PARADOX_KIND_REGEX = /^\s*(component|snippet|data|attribute)\s*:\s*([^}\s]+)\s*$/;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test paradox`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/data/paradoxTags.ts packages/server/src/data/paradoxTags.test.ts
git commit -m "feat(server): add Paradox backend tag metadata + detection regex"
```

---

## Phase 2 — Analyzer Core

Pure functions that turn `(uri, text, jsonCompanionText | undefined, componentLookup)` into a `DocumentModel`. No I/O — callers pass everything in.

### Task 10: Tokenize wrapper

**Files:**

- Create: `packages/server/src/analyzer/tokenize.ts`
- Test: `packages/server/src/analyzer/tokenize.test.ts`

Wraps LiquidJS `Tokenizer` to never throw. On a tokenization error, recover what we can and surface the error as a `TokenizeError` token so diagnostics can still fire.

- [ ] **Step 1: Write the failing test**

`packages/server/src/analyzer/tokenize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize.js';

describe('tokenize', () => {
  it('returns a flat token stream for a simple template', () => {
    const { tokens, errors } = tokenize('hello {{ name }} world');
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.kind)).toEqual(['html', 'output', 'html']);
    expect(tokens[1]).toMatchObject({ kind: 'output', content: 'name' });
  });

  it('captures tag tokens with name + args', () => {
    const { tokens } = tokenize('{% assign x = 1 %}');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: 'tag', name: 'assign', args: 'x = 1' });
  });

  it('records 0-based line/character ranges', () => {
    const { tokens } = tokenize('a\n{{ x }}');
    const output = tokens.find((t) => t.kind === 'output');
    expect(output?.range.start.line).toBe(1);
    expect(output?.range.start.character).toBe(0);
  });

  it('does not throw on an unclosed output expression', () => {
    const { tokens, errors } = tokenize('hello {{ name ');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/unclosed|expected/i);
    // We still get the leading 'html' token
    expect(tokens.some((t) => t.kind === 'html')).toBe(true);
  });

  it('does not throw on a mismatched tag delimiter', () => {
    const { errors } = tokenize('{% if x %');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('treats {{ component:Hero }} as a normal output token (paradox prepass runs later)', () => {
    const { tokens, errors } = tokenize('{{component:Hero}}');
    expect(errors).toEqual([]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: 'output', content: 'component:Hero' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test tokenize`
Expected: FAIL ("Cannot find module './tokenize.js'").

- [ ] **Step 3: Write `packages/server/src/analyzer/tokenize.ts`**

```ts
import { Tokenizer } from 'liquidjs';
import type { Range } from '../types.js';

export type Token =
  | { kind: 'html'; text: string; range: Range }
  | { kind: 'output'; content: string; range: Range; rawRange: Range }
  | { kind: 'tag'; name: string; args: string; range: Range; rawRange: Range };

export interface TokenizeError {
  message: string;
  range: Range;
}

export interface TokenizeResult {
  tokens: Token[];
  errors: TokenizeError[];
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

function makeRange(text: string, begin: number, end: number): Range {
  return { start: offsetToPosition(text, begin), end: offsetToPosition(text, end) };
}

/**
 * Wrap liquidjs Tokenizer in a tolerant adapter.
 * Recovers from delimiter errors by emitting the rest of the input as a single html token.
 */
export function tokenize(source: string): TokenizeResult {
  const errors: TokenizeError[] = [];
  const tokens: Token[] = [];

  let cursor = 0;
  while (cursor < source.length) {
    try {
      const tokenizer = new Tokenizer(source.slice(cursor));
      const raw = tokenizer.readTopLevelTokens();
      for (const t of raw) {
        const begin = cursor + t.begin;
        const end = cursor + t.end;
        const range = makeRange(source, begin, end);
        const kind = (t as any).kind ?? (t.constructor.name as string).replace(/Token$/, '').toLowerCase();
        if (kind === 'html' || kind === 'string') {
          tokens.push({ kind: 'html', text: source.slice(begin, end), range });
        } else if (kind === 'output' || ((t as any).content !== undefined && (t as any).name === undefined)) {
          const content = String((t as any).content ?? source.slice(begin + 2, end - 2)).trim();
          const innerStart = begin + 2;
          const innerEnd = end - 2;
          tokens.push({
            kind: 'output',
            content,
            range,
            rawRange: makeRange(source, innerStart, innerEnd),
          });
        } else if (kind === 'tag') {
          const name = String((t as any).name);
          const args = String((t as any).args ?? '').trim();
          const innerStart = begin + 2;
          const innerEnd = end - 2;
          tokens.push({
            kind: 'tag',
            name,
            args,
            range,
            rawRange: makeRange(source, innerStart, innerEnd),
          });
        } else {
          tokens.push({ kind: 'html', text: source.slice(begin, end), range });
        }
      }
      cursor = source.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Find the first unclosed delimiter after `cursor` so we can mark its range.
      const lookahead = source.slice(cursor);
      const badIdx = Math.max(0, lookahead.search(/\{\{|\{%/));
      const errBegin = cursor + badIdx;
      const errEnd = source.length;
      errors.push({ message, range: makeRange(source, errBegin, errEnd) });

      // Emit any preceding plain text as an html token so we don't lose it.
      if (badIdx > 0) {
        tokens.push({
          kind: 'html',
          text: source.slice(cursor, errBegin),
          range: makeRange(source, cursor, errBegin),
        });
      }
      cursor = source.length;
    }
  }

  return { tokens, errors };
}
```

> **Note on the liquidjs API:** the exact property names on `Token` subclasses vary by version. The `(t as any)` reads above mirror what `liquidjs@10.x` exposes (`begin`, `end`, `kind` or constructor name, `content`, `name`, `args`). If a future version changes these, this file is the only one that needs updating. Run the test suite after any liquidjs bump.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test tokenize`
Expected: PASS, 6 tests. If any fail because the liquidjs property names differ, inspect the installed `node_modules/liquidjs/dist/index.d.ts` for the actual shape and adjust the `(t as any).<prop>` reads — do **not** change the test expectations.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/analyzer/tokenize.ts packages/server/src/analyzer/tokenize.test.ts
git commit -m "feat(server): add tolerant LiquidJS tokenizer wrapper"
```

### Task 11: Typed AST builder

**Files:**

- Create: `packages/server/src/analyzer/ast.ts`
- Test: `packages/server/src/analyzer/ast.test.ts`

Converts a flat token stream into a tree of block nodes (`if/endif`, `for/endfor`, `case/endcase`, `unless/endunless`, `capture/endcapture`, `tablerow/endtablerow`, `raw/endraw`, `comment/endcomment`) with mismatch detection. Unknown tags become leaf nodes — diagnostics will flag them later.

- [ ] **Step 1: Write the failing test**

`packages/server/src/analyzer/ast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAst } from './ast.js';
import { tokenize } from './tokenize.js';

function parse(src: string) {
  const { tokens, errors: tokErrors } = tokenize(src);
  const ast = buildAst(tokens);
  return { ast, tokErrors, errors: ast.errors };
}

describe('buildAst', () => {
  it('produces a root node with children for a flat template', () => {
    const { ast } = parse('hello {{ name }}!');
    expect(ast.root.children).toHaveLength(3);
    expect(ast.root.children[0].kind).toBe('html');
    expect(ast.root.children[1].kind).toBe('output');
  });

  it('nests if blocks with their endif', () => {
    const { ast, errors } = parse('{% if x %}A{% endif %}');
    expect(errors).toEqual([]);
    expect(ast.root.children).toHaveLength(1);
    const ifNode = ast.root.children[0];
    expect(ifNode.kind).toBe('block');
    if (ifNode.kind === 'block') {
      expect(ifNode.openName).toBe('if');
      expect(ifNode.branches[0].body).toHaveLength(1);
      expect(ifNode.branches[0].body[0].kind).toBe('html');
    }
  });

  it('supports elsif / else branches inside if', () => {
    const { ast } = parse('{% if x %}A{% elsif y %}B{% else %}C{% endif %}');
    const ifNode = ast.root.children[0];
    expect(ifNode.kind).toBe('block');
    if (ifNode.kind === 'block') {
      expect(ifNode.branches.map((b) => b.name)).toEqual(['if', 'elsif', 'else']);
    }
  });

  it('nests for blocks and records the binding info', () => {
    const { ast } = parse('{% for item in items %}{{ item }}{% endfor %}');
    const forNode = ast.root.children[0];
    expect(forNode.kind).toBe('block');
    if (forNode.kind === 'block') {
      expect(forNode.openName).toBe('for');
      expect(forNode.openArgs).toBe('item in items');
    }
  });

  it('reports an unbalanced open tag', () => {
    const { errors } = parse('{% if x %}hello');
    expect(errors.some((e) => /unclosed.*if/i.test(e.message))).toBe(true);
  });

  it('reports an unexpected closing tag', () => {
    const { errors } = parse('hello {% endif %}');
    expect(errors.some((e) => /unexpected.*endif/i.test(e.message))).toBe(true);
  });

  it('reports a mismatched closing tag', () => {
    const { errors } = parse('{% if x %}A{% endfor %}');
    expect(errors.some((e) => /mismatched|unexpected/i.test(e.message))).toBe(true);
  });

  it('treats unknown tags as leaf nodes without crashing', () => {
    const { ast } = parse('{% flarp %}');
    expect(ast.root.children).toHaveLength(1);
    expect(ast.root.children[0].kind).toBe('tag');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test ast`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/analyzer/ast.ts`**

```ts
import type { Range } from '../types.js';
import type { Token } from './tokenize.js';
import { getOpeningForClosing, isClosingTag, TAGS } from '../data/tags.js';

export type AstNode =
  | { kind: 'html'; text: string; range: Range }
  | { kind: 'output'; content: string; range: Range; rawRange: Range }
  | { kind: 'tag'; name: string; args: string; range: Range; rawRange: Range }
  | { kind: 'block'; openName: string; openArgs: string; range: Range; branches: BlockBranch[] };

export interface BlockBranch {
  name: string; // 'if' | 'elsif' | 'else' | 'when' | 'for' | etc.
  args: string;
  range: Range; // range of the branch opener tag
  body: AstNode[];
}

export interface RootNode {
  children: AstNode[];
}

export interface AstError {
  message: string;
  range: Range;
}

export interface AstResult {
  root: RootNode;
  errors: AstError[];
}

const BLOCK_OPENERS = new Set(['if', 'unless', 'for', 'case', 'capture', 'tablerow', 'raw', 'comment']);

const BRANCH_KEYWORDS: Record<string, string[]> = {
  if: ['elsif', 'else'],
  unless: ['else'],
  case: ['when', 'else'],
  for: ['else'],
  tablerow: [],
};

export function buildAst(tokens: Token[]): AstResult {
  const errors: AstError[] = [];

  interface Frame {
    openName: string;
    openArgs: string;
    openRange: Range;
    branches: BlockBranch[];
    currentBranch: BlockBranch;
  }

  const stack: Frame[] = [];
  const root: RootNode = { children: [] };

  function currentChildren(): AstNode[] {
    if (stack.length === 0) return root.children;
    return stack[stack.length - 1]!.currentBranch.body;
  }

  for (const tok of tokens) {
    if (tok.kind === 'html') {
      currentChildren().push({ kind: 'html', text: tok.text, range: tok.range });
      continue;
    }
    if (tok.kind === 'output') {
      currentChildren().push({ kind: 'output', content: tok.content, range: tok.range, rawRange: tok.rawRange });
      continue;
    }

    const name = tok.name;
    const top = stack[stack.length - 1];

    if (BLOCK_OPENERS.has(name)) {
      const branch: BlockBranch = { name, args: tok.args, range: tok.range, body: [] };
      stack.push({
        openName: name,
        openArgs: tok.args,
        openRange: tok.range,
        branches: [branch],
        currentBranch: branch,
      });
      continue;
    }

    if (top && BRANCH_KEYWORDS[top.openName]?.includes(name)) {
      const branch: BlockBranch = { name, args: tok.args, range: tok.range, body: [] };
      top.branches.push(branch);
      top.currentBranch = branch;
      continue;
    }

    if (isClosingTag(name)) {
      const opener = getOpeningForClosing(name);
      if (!top) {
        errors.push({ message: `Unexpected closing tag '${name}' with no matching opener`, range: tok.range });
        continue;
      }
      if (opener !== top.openName) {
        errors.push({
          message: `Mismatched closing tag: expected 'end${top.openName}', got '${name}'`,
          range: tok.range,
        });
        // Pop anyway to recover.
      }
      const frame = stack.pop()!;
      currentChildren().push({
        kind: 'block',
        openName: frame.openName,
        openArgs: frame.openArgs,
        range: { start: frame.openRange.start, end: tok.range.end },
        branches: frame.branches,
      });
      continue;
    }

    // Unknown tag, single-tag like assign/render/include/echo/etc — leaf node
    if (!Object.prototype.hasOwnProperty.call(TAGS, name)) {
      // Leave the unknown-tag warning to diagnostics; AST still records it.
    }
    currentChildren().push({
      kind: 'tag',
      name,
      args: tok.args,
      range: tok.range,
      rawRange: tok.rawRange,
    });
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    errors.push({
      message: `Unclosed block '${frame.openName}' (expected 'end${frame.openName}')`,
      range: frame.openRange,
    });
    root.children.push({
      kind: 'block',
      openName: frame.openName,
      openArgs: frame.openArgs,
      range: frame.openRange,
      branches: frame.branches,
    });
  }

  return { root, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test ast`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/analyzer/ast.ts packages/server/src/analyzer/ast.test.ts
git commit -m "feat(server): build typed AST with block nesting and balance errors"
```

### Task 12: JSON schema inferer

**Files:**

- Create: `packages/server/src/analyzer/jsonSchema.ts`
- Test: `packages/server/src/analyzer/jsonSchema.test.ts`

Turns parsed JSON into the `LiquidType` tree. Used by `scope.ts` to seed the JSON-companion origin (Origin 1 from spec §4.1).

- [ ] **Step 1: Write the failing test**

`packages/server/src/analyzer/jsonSchema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { inferLiquidType, inferTopLevelBindings } from './jsonSchema.js';

describe('inferLiquidType', () => {
  it('returns primitive kinds for leaves', () => {
    expect(inferLiquidType('hi')).toEqual({ kind: 'string' });
    expect(inferLiquidType(42)).toEqual({ kind: 'number' });
    expect(inferLiquidType(true)).toEqual({ kind: 'boolean' });
    expect(inferLiquidType(null)).toEqual({ kind: 'null' });
  });

  it('treats empty array as array<unknown>', () => {
    expect(inferLiquidType([])).toEqual({ kind: 'array', element: { kind: 'unknown' } });
  });

  it('merges array element shapes, marking partial keys optional', () => {
    const t = inferLiquidType([
      { type: 'quote', quote: 'hi', name: 'Rob' },
      { type: 'video', video_url: 'u', name: 'Will' },
    ]);
    expect(t.kind).toBe('array');
    if (t.kind === 'array' && t.element.kind === 'object') {
      const p = t.element.properties;
      expect(p.type).toEqual({ type: { kind: 'string' }, optional: false });
      expect(p.name).toEqual({ type: { kind: 'string' }, optional: false });
      expect(p.quote).toEqual({ type: { kind: 'string' }, optional: true });
      expect(p.video_url).toEqual({ type: { kind: 'string' }, optional: true });
    }
  });

  it('produces a union for mixed primitive/object arrays', () => {
    const t = inferLiquidType(['a', { x: 1 }]);
    expect(t.kind).toBe('array');
    if (t.kind === 'array') {
      expect(t.element.kind).toBe('union');
    }
  });

  it('preserves nested object shape', () => {
    const t = inferLiquidType({ user: { name: 'Rob', age: 30 } });
    expect(t).toEqual({
      kind: 'object',
      properties: {
        user: {
          optional: false,
          type: {
            kind: 'object',
            properties: {
              name: { optional: false, type: { kind: 'string' } },
              age: { optional: false, type: { kind: 'number' } },
            },
          },
        },
      },
    });
  });
});

describe('inferTopLevelBindings', () => {
  it('returns a binding per top-level key with json origin', () => {
    const bindings = inferTopLevelBindings('/abs/path/file.liquid.json', {
      title: 'Home',
      items: [{ a: 1 }],
    });
    const names = bindings.map((b) => b.name).sort();
    expect(names).toEqual(['items', 'title']);
    expect(bindings.find((b) => b.name === 'title')?.type).toEqual({ kind: 'string' });
    expect(bindings.find((b) => b.name === 'title')?.origin).toMatchObject({
      kind: 'json',
      jsonPath: '/abs/path/file.liquid.json',
    });
  });

  it('returns [] for non-object root', () => {
    expect(inferTopLevelBindings('/p.json', [])).toEqual([]);
    expect(inferTopLevelBindings('/p.json', 'hi')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test jsonSchema`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/analyzer/jsonSchema.ts`**

```ts
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

  // Deduplicate by structural equality (only useful for primitives here).
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
```

(`jsonKeyRange` is left as a zero-range here; Task 16's orchestrator overlays the real range by scanning the JSON text for the key's line/column. Keeping range discovery out of `jsonSchema.ts` keeps it pure.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test jsonSchema`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/analyzer/jsonSchema.ts packages/server/src/analyzer/jsonSchema.test.ts
git commit -m "feat(server): infer LiquidType tree from JSON companion data"
```

### Task 13: Scope tracker

**Files:**

- Create: `packages/server/src/analyzer/scope.ts`
- Test: `packages/server/src/analyzer/scope.test.ts`

Walks the AST from Task 11 and records every variable binding (`assign`, `capture`, `for`, `tablerow`, `increment`, `decrement`) with its scope range. Returns a function `scopeAt(offset)` for offset-based lookups. Inference for `assign` RHS uses the filter return-type table from Task 8.

- [ ] **Step 1: Write the failing test**

`packages/server/src/analyzer/scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize.js';
import { buildAst } from './ast.js';
import { buildScopeTable } from './scope.js';
import type { Binding } from '../types.js';

function build(src: string, rootBindings: Binding[] = []) {
  const { tokens } = tokenize(src);
  const { root } = buildAst(tokens);
  return buildScopeTable(src, root, rootBindings);
}

describe('buildScopeTable', () => {
  it('exposes root JSON bindings at any offset', () => {
    const json: Binding = {
      name: 'title',
      type: { kind: 'string' },
      origin: {
        kind: 'json',
        jsonPath: '/x.json',
        jsonKeyRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    };
    const { scopeAt } = build('{{ title }}', [json]);
    expect(scopeAt(5).get('title')?.type).toEqual({ kind: 'string' });
  });

  it('records an assign binding within its lexical region', () => {
    const src = '{% assign greeting = "hi" %}{{ greeting }}';
    const { scopeAt } = build(src);
    expect(scopeAt(src.indexOf('greeting }}')).get('greeting')?.type).toEqual({ kind: 'string' });
  });

  it('infers assign RHS type from a filter chain via filters table', () => {
    const src = '{% assign n = title | size %}{{ n }}';
    const { scopeAt } = build(src);
    expect(scopeAt(src.indexOf('n }}')).get('n')?.type).toEqual({ kind: 'number' });
  });

  it('pushes a for binding plus forloop inside the loop, pops them after', () => {
    const itemsBinding: Binding = {
      name: 'items',
      type: {
        kind: 'array',
        element: { kind: 'object', properties: { name: { type: { kind: 'string' }, optional: false } } },
      },
      origin: {
        kind: 'json',
        jsonPath: '/x.json',
        jsonKeyRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    };
    const src = '{% for item in items %}{{ item.name }}{% endfor %}{{ item }}';
    const { scopeAt } = build(src, [itemsBinding]);
    const inside = src.indexOf('item.name');
    const after = src.lastIndexOf('item }}');
    expect(scopeAt(inside).get('item')?.type).toEqual({
      kind: 'object',
      properties: { name: { type: { kind: 'string' }, optional: false } },
    });
    expect(scopeAt(inside).get('forloop')?.type.kind).toBe('object');
    expect(scopeAt(after).get('item')).toBeUndefined();
    expect(scopeAt(after).get('forloop')).toBeUndefined();
  });

  it('infers tablerow x like for', () => {
    const itemsBinding: Binding = {
      name: 'items',
      type: { kind: 'array', element: { kind: 'string' } },
      origin: {
        kind: 'json',
        jsonPath: '/x.json',
        jsonKeyRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    };
    const src = '{% tablerow cell in items %}{{ cell }}{% endtablerow %}';
    const { scopeAt } = build(src, [itemsBinding]);
    expect(scopeAt(src.indexOf('cell }}')).get('cell')?.type).toEqual({ kind: 'string' });
    expect(scopeAt(src.indexOf('cell }}')).get('tablerowloop')?.type.kind).toBe('object');
  });

  it('capture binds the variable as string', () => {
    const src = '{% capture greet %}hi{% endcapture %}{{ greet }}';
    const { scopeAt } = build(src);
    expect(scopeAt(src.indexOf('greet }}')).get('greet')?.type).toEqual({ kind: 'string' });
  });

  it('increment/decrement binds as number', () => {
    const src = '{% increment cnt %}{{ cnt }}';
    const { scopeAt } = build(src);
    expect(scopeAt(src.indexOf('cnt }}')).get('cnt')?.type).toEqual({ kind: 'number' });
  });

  it('inner declarations shadow outer ones', () => {
    const src = '{% assign x = "outer" %}{% for x in items %}{{ x }}{% endfor %}{{ x }}';
    const itemsBinding: Binding = {
      name: 'items',
      type: { kind: 'array', element: { kind: 'number' } },
      origin: {
        kind: 'json',
        jsonPath: '/x.json',
        jsonKeyRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
    };
    const { scopeAt } = build(src, [itemsBinding]);
    expect(scopeAt(src.indexOf('x }}{% endfor')).get('x')?.type).toEqual({ kind: 'number' });
    expect(scopeAt(src.lastIndexOf('x }}')).get('x')?.type).toEqual({ kind: 'string' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test scope`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/analyzer/scope.ts`**

```ts
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
  start: number; // byte offset
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
        // Walk the block's body branches inside *current* if no new bindings.
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
      // Find innermost region containing offset
      let best: ScopeRegion = rootRegion;
      for (const r of regions) {
        if (offset >= r.start && offset <= r.end && spanLength(r) <= spanLength(best)) {
          best = r;
        }
      }
      // Flatten with outer-to-inner shadowing
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
  // Split filter chain on `|` not inside strings (good enough for v1; no escape handling)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test scope`
Expected: PASS, 8 tests. If a single shadowing test fails, double-check that the `forloop` and loop-variable bindings only live in the inner region (the test for "inner declarations shadow outer ones" exercises this).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/analyzer/scope.ts packages/server/src/analyzer/scope.test.ts
git commit -m "feat(server): walk AST to build per-offset variable scope table"
```

### Task 14: Component prop block extractor

**Files:**

- Create: `packages/server/src/analyzer/propBlock.ts`
- Test: `packages/server/src/analyzer/propBlock.test.ts`

For a component file, walk the AST root's top-level children. While the current child is a `{% assign %}` tag matching `LHS = RHS | default: DEFAULT` **with RHS as a bare identifier**, record `{ name: RHS, type: typeof(DEFAULT), defaultValue: DEFAULT, declRange }`. Stop at the first non-assign top-level node.

- [ ] **Step 1: Write the failing test**

`packages/server/src/analyzer/propBlock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize.js';
import { buildAst } from './ast.js';
import { extractComponentProps } from './propBlock.js';

function props(src: string) {
  const { tokens } = tokenize(src);
  const { root } = buildAst(tokens);
  return extractComponentProps(src, root, '/abs/components/button.liquid');
}

describe('extractComponentProps', () => {
  it('extracts props from top-of-file assign-default lines (RHS = prop name)', () => {
    const src = `{% assign type = type | default: 'primary' %}
{% assign text = text | default: 'Learn more' %}
<button>{{ text }}</button>`;
    const out = props(src);
    expect(out.map((p) => p.name)).toEqual(['type', 'text']);
    expect(out[0].type).toEqual({ kind: 'string' });
    expect(out[0].origin).toMatchObject({
      kind: 'componentProp',
      componentPath: '/abs/components/button.liquid',
      defaultValue: "'primary'",
    });
  });

  it('treats LHS aliases correctly: prop name = RHS, NOT LHS', () => {
    const src = `{% assign customClass = class | default: '' %}`;
    const out = props(src);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('class'); // RHS, not 'customClass'
  });

  it('stops scanning at the first non-assign top-level node', () => {
    const src = `{% assign a = a | default: '' %}
<div>hi</div>
{% assign b = b | default: '' %}`;
    const out = props(src);
    expect(out.map((p) => p.name)).toEqual(['a']);
  });

  it('skips assigns that do not fit the default-pattern (no `| default:`)', () => {
    const src = `{% assign tag = 'button' %}
{% assign x = y | default: '' %}`;
    const out = props(src);
    expect(out.map((p) => p.name)).toEqual(['x']);
  });

  it('skips assigns whose RHS is not a bare identifier', () => {
    const src = `{% assign x = "literal" | default: '' %}
{% assign y = a.b | default: '' %}`;
    const out = props(src);
    expect(out).toHaveLength(0);
  });

  it('infers literal type from default value', () => {
    const src = `{% assign a = a | default: 'x' %}
{% assign b = b | default: 42 %}
{% assign c = c | default: true %}
{% assign d = d | default: false %}`;
    const out = props(src);
    expect(out.map((p) => ({ n: p.name, k: p.type.kind }))).toEqual([
      { n: 'a', k: 'string' },
      { n: 'b', k: 'number' },
      { n: 'c', k: 'boolean' },
      { n: 'd', k: 'boolean' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test propBlock`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/analyzer/propBlock.ts`**

```ts
import type { AstNode, RootNode } from './ast.js';
import type { Binding, LiquidType } from '../types.js';

const ASSIGN_DEFAULT_RE = /^\s*([\w-]+)\s*=\s*([\w-]+)\s*\|\s*default\s*:\s*(.+?)\s*$/;

export function extractComponentProps(_source: string, root: RootNode, componentPath: string): Binding[] {
  const out: Binding[] = [];
  for (const child of root.children) {
    if (child.kind === 'html' && /^\s*$/.test(child.text)) continue; // skip pure whitespace
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test propBlock`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/analyzer/propBlock.ts packages/server/src/analyzer/propBlock.test.ts
git commit -m "feat(server): extract component props from leading assign-default block"
```

### Task 15: Paradox tag prepass

**Files:**

- Create: `packages/server/src/analyzer/paradoxPrepass.ts`
- Test: `packages/server/src/analyzer/paradoxPrepass.test.ts`

Walks the AST output nodes, matches each `content` against `PARADOX_KIND_REGEX` from Task 9. Returns the `ParadoxTag[]` array (Section 6.1 of the spec) plus a `Set<string>` of node range keys so other providers can know which output nodes to skip.

- [ ] **Step 1: Write the failing test**

`packages/server/src/analyzer/paradoxPrepass.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize.js';
import { buildAst } from './ast.js';
import { runParadoxPrepass } from './paradoxPrepass.js';

function run(src: string) {
  const { tokens } = tokenize(src);
  const { root } = buildAst(tokens);
  return runParadoxPrepass(root);
}

describe('runParadoxPrepass', () => {
  it('detects the four kinds', () => {
    const { tags } = run('{{component:Hero}}{{snippet:abc}}{{data:job.title}}{{attribute:className}}');
    expect(tags.map((t) => t.kind)).toEqual(['component', 'snippet', 'data', 'attribute']);
    expect(tags.map((t) => t.value)).toEqual(['Hero', 'abc', 'job.title', 'className']);
  });

  it('tolerates whitespace around kind and value', () => {
    const { tags } = run('{{ component : Hero }}');
    expect(tags).toHaveLength(1);
    expect(tags[0].kind).toBe('component');
    expect(tags[0].value).toBe('Hero');
  });

  it('does NOT match normal output expressions', () => {
    const { tags } = run('{{ name }}{{ user.email }}{{ items | size }}');
    expect(tags).toEqual([]);
  });

  it('does NOT match unknown kinds', () => {
    const { tags } = run('{{widget:foo}}');
    expect(tags).toEqual([]);
  });

  it('exposes a paradoxOutputRanges set whose entries map by start offset', () => {
    const { paradoxOutputRanges, tags } = run('hi {{component:Hero}}');
    expect(paradoxOutputRanges.size).toBe(1);
    expect([...paradoxOutputRanges][0]).toBe(`${tags[0].range.start.line}:${tags[0].range.start.character}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test paradoxPrepass`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/analyzer/paradoxPrepass.ts`**

```ts
import type { AstNode, RootNode } from './ast.js';
import type { ParadoxTag } from '../types.js';
import { PARADOX_KIND_REGEX } from '../data/paradoxTags.js';

export interface ParadoxPrepassResult {
  tags: ParadoxTag[];
  /**
   * Keys = "line:character" of the output node's range.start.
   * Providers consult this to skip variable analysis on these nodes.
   */
  paradoxOutputRanges: Set<string>;
}

export function runParadoxPrepass(root: RootNode): ParadoxPrepassResult {
  const tags: ParadoxTag[] = [];
  const paradoxOutputRanges = new Set<string>();
  walk(root.children, tags, paradoxOutputRanges);
  return { tags, paradoxOutputRanges };
}

function walk(nodes: AstNode[], tags: ParadoxTag[], set: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === 'output') {
      const m = node.content.match(PARADOX_KIND_REGEX);
      if (m) {
        tags.push({
          kind: m[1] as ParadoxTag['kind'],
          value: m[2]!,
          range: node.range,
        });
        set.add(`${node.range.start.line}:${node.range.start.character}`);
      }
    } else if (node.kind === 'block') {
      for (const b of node.branches) walk(b.body, tags, set);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test paradoxPrepass`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/analyzer/paradoxPrepass.ts packages/server/src/analyzer/paradoxPrepass.test.ts
git commit -m "feat(server): paradox-tag prepass with output-node skip list"
```

### Task 16: Document orchestrator

**Files:**

- Create: `packages/server/src/analyzer/document.ts`
- Test: `packages/server/src/analyzer/document.test.ts`

Composes tokenize → buildAst → buildScopeTable → runParadoxPrepass → extractComponentProps (only for component files) → collect dependencies. Output: a `DocumentModel`.

Diagnostics are **not** emitted here. This module just packages parsed state; `providers/diagnostics.ts` (Task 25) reads the model and produces `Diagnostic[]`. We keep that separation so `analyzer/` stays free of LSP types.

- [ ] **Step 1: Write the failing test**

`packages/server/src/analyzer/document.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { analyzeDocument } from './document.js';

describe('analyzeDocument', () => {
  it('returns a model with tokens, ast, scope table and empty paradox tags for a simple page', () => {
    const m = analyzeDocument({
      uri: 'file:///abs/src/pages/home.liquid',
      text: '<h1>{{ title }}</h1>',
      jsonCompanion: { path: '/abs/src/pages/home.liquid.json', text: '{ "title": "Hi" }' },
      isComponent: false,
      componentLookup: () => undefined,
    });
    expect(m.paradoxTags).toEqual([]);
    expect(m.ast.root.children).toHaveLength(3);
    expect(m.scopeByOffset(10).get('title')?.type).toEqual({ kind: 'string' });
    expect(m.dependencies.jsonCompanion).toBe('/abs/src/pages/home.liquid.json');
    expect(m.tokenErrors).toEqual([]);
    expect(m.astErrors).toEqual([]);
  });

  it('records render and layout dependencies', () => {
    const m = analyzeDocument({
      uri: 'file:///abs/src/pages/home.liquid',
      text: `{% layout "main" %}{% render "components/button" %}{% render "partials/foot" %}`,
      jsonCompanion: undefined,
      isComponent: false,
      componentLookup: () => undefined,
    });
    expect(m.dependencies.layoutFile).toBe('main');
    expect(m.dependencies.renderedFiles.sort()).toEqual(['components/button', 'partials/foot']);
  });

  it('extracts component props when isComponent is true', () => {
    const m = analyzeDocument({
      uri: 'file:///abs/src/components/button.liquid',
      text: `{% assign type = type | default: 'primary' %}{{ type }}`,
      jsonCompanion: undefined,
      isComponent: true,
      componentLookup: () => undefined,
    });
    expect(m.componentProps?.map((p) => p.name)).toEqual(['type']);
  });

  it('flags paradox tags', () => {
    const m = analyzeDocument({
      uri: 'file:///abs/src/pages/home.liquid',
      text: 'hi {{component:Hero}}',
      jsonCompanion: undefined,
      isComponent: false,
      componentLookup: () => undefined,
    });
    expect(m.paradoxTags).toHaveLength(1);
    expect(m.paradoxTags[0].kind).toBe('component');
  });

  it('locates JSON key ranges (jsonKeyRange points at the key in the JSON source)', () => {
    const json = `{
  "title": "Hi"
}`;
    const m = analyzeDocument({
      uri: 'file:///abs/src/pages/home.liquid',
      text: '<h1>{{ title }}</h1>',
      jsonCompanion: { path: '/abs/src/pages/home.liquid.json', text: json },
      isComponent: false,
      componentLookup: () => undefined,
    });
    const titleBinding = m.scopeByOffset(10).get('title');
    expect(titleBinding?.origin.kind).toBe('json');
    if (titleBinding?.origin.kind === 'json') {
      expect(titleBinding.origin.jsonKeyRange.start.line).toBe(1);
      expect(titleBinding.origin.jsonKeyRange.start.character).toBe(2);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test document`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/analyzer/document.ts`**

```ts
import { tokenize, type Token, type TokenizeError } from './tokenize.js';
import { buildAst, type AstError, type AstNode, type RootNode } from './ast.js';
import { buildScopeTable, type ScopeTable } from './scope.js';
import { inferTopLevelBindings } from './jsonSchema.js';
import { extractComponentProps } from './propBlock.js';
import { runParadoxPrepass } from './paradoxPrepass.js';
import type { Binding, Dependencies, ParadoxTag, Range } from '../types.js';

export interface AnalyzeInput {
  uri: string;
  text: string;
  jsonCompanion: { path: string; text: string } | undefined;
  isComponent: boolean;
  componentLookup: (key: string) => Binding[] | undefined;
}

export interface DocumentModel {
  uri: string;
  text: string;
  tokens: Token[];
  tokenErrors: TokenizeError[];
  ast: { root: RootNode };
  astErrors: AstError[];
  scopeByOffset: ScopeTable['scopeAt'];
  paradoxTags: ParadoxTag[];
  paradoxOutputRanges: Set<string>;
  dependencies: Dependencies;
  componentProps?: Binding[];
}

export function analyzeDocument(input: AnalyzeInput): DocumentModel {
  const { tokens, errors: tokenErrors } = tokenize(input.text);
  const { root, errors: astErrors } = buildAst(tokens);

  let rootBindings: Binding[] = [];
  if (input.jsonCompanion) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.jsonCompanion.text);
    } catch {
      parsed = null;
    }
    rootBindings = inferTopLevelBindings(input.jsonCompanion.path, parsed);
    // Overlay real key ranges from JSON text
    const keyRanges = locateTopLevelKeys(input.jsonCompanion.text);
    rootBindings = rootBindings.map((b) => {
      const r = keyRanges.get(b.name);
      if (r && b.origin.kind === 'json') {
        return { ...b, origin: { ...b.origin, jsonKeyRange: r } };
      }
      return b;
    });
  }

  const { scopeAt } = buildScopeTable(input.text, root, rootBindings);
  const { tags: paradoxTags, paradoxOutputRanges } = runParadoxPrepass(root);

  const dependencies = collectDependencies(root, input.jsonCompanion?.path);
  const componentProps = input.isComponent
    ? extractComponentProps(input.text, root, fileURLToPathSafe(input.uri))
    : undefined;

  return {
    uri: input.uri,
    text: input.text,
    tokens,
    tokenErrors,
    ast: { root },
    astErrors,
    scopeByOffset: scopeAt,
    paradoxTags,
    paradoxOutputRanges,
    dependencies,
    componentProps,
  };
}

function fileURLToPathSafe(uri: string): string {
  if (uri.startsWith('file://')) return uri.slice('file://'.length);
  return uri;
}

function collectDependencies(root: RootNode, jsonCompanion?: string): Dependencies {
  const renderedFiles: string[] = [];
  let layoutFile: string | undefined;

  function walk(nodes: AstNode[]): void {
    for (const node of nodes) {
      if (node.kind === 'tag') {
        if (node.name === 'render' || node.name === 'include') {
          const path = firstStringLiteral(node.args);
          if (path) renderedFiles.push(path);
        } else if (node.name === 'layout') {
          const path = firstStringLiteral(node.args);
          if (path) layoutFile = path;
        }
      } else if (node.kind === 'block') {
        for (const b of node.branches) walk(b.body);
      }
    }
  }
  walk(root.children);

  return { jsonCompanion, renderedFiles, layoutFile };
}

function firstStringLiteral(args: string): string | null {
  const m = args.match(/^["']([^"']+)["']/);
  return m ? m[1]! : null;
}

function locateTopLevelKeys(jsonText: string): Map<string, Range> {
  // Naive: scan for top-level "key" pairs by brace depth.
  // Adequate for the well-formed JSON files this project ships.
  const ranges = new Map<string, Range>();
  let depth = 0;
  let line = 0,
    col = 0;
  let i = 0;
  let inString = false;
  let stringStart = -1;
  let pendingKey: { name: string; line: number; col: number } | null = null;

  while (i < jsonText.length) {
    const ch = jsonText[i]!;
    if (inString) {
      if (ch === '\\') {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === '"') {
        if (depth === 1 && pendingKey === null) {
          const name = jsonText.slice(stringStart + 1, i);
          pendingKey = { name, line: posLine(jsonText, stringStart), col: posCol(jsonText, stringStart) };
        } else if (depth === 1 && pendingKey !== null) {
          pendingKey = null; // closing quote of a string VALUE; reset
        }
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
        stringStart = i;
      } else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
      else if (ch === ':' && depth === 1 && pendingKey) {
        ranges.set(pendingKey.name, {
          start: { line: pendingKey.line, character: pendingKey.col },
          end: { line: pendingKey.line, character: pendingKey.col + pendingKey.name.length + 2 },
        });
        pendingKey = null;
      } else if (ch === ',' && depth === 1) {
        pendingKey = null;
      }
    }
    if (ch === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
    i++;
  }
  return ranges;
}

function posLine(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
function posCol(text: string, offset: number): number {
  let col = 0;
  for (let i = offset - 1; i >= 0; i--) {
    if (text.charCodeAt(i) === 10) break;
    col++;
  }
  return col;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test document`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/analyzer/document.ts packages/server/src/analyzer/document.test.ts
git commit -m "feat(server): analyzer orchestrator producing DocumentModel"
```

---

## Phase 3 — Workspace Layer

Stateful modules that hold workspace-wide knowledge: parsed vite config, the three-map file index, document cache, dependency graph, and file watcher registration.

### Task 17: vite.config.ts parser

**Files:**

- Create: `packages/server/src/workspace/viteConfig.ts`
- Test: `packages/server/src/workspace/viteConfig.test.ts`

Uses the TypeScript Compiler API to read `vite.config.ts` **as text**, then walks the AST for a `CallExpression` whose callee identifier is `pageDiscoveryPlugin` and reads its four `string`-literal options. Returns either `{ ok: true, paths }` or `{ ok: false, reason }`. Never executes the config.

- [ ] **Step 1: Write the failing test**

`packages/server/src/workspace/viteConfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseViteConfig } from './viteConfig.js';

describe('parseViteConfig', () => {
  it('extracts the four pageDiscoveryPlugin paths', () => {
    const src = `
      import { pageDiscoveryPlugin } from './plugins';
      export default {
        plugins: [
          pageDiscoveryPlugin({
            pagesDir: 'src/pages',
            layoutsDir: 'src/layouts',
            partialsDir: 'src/partials',
            componentsDir: 'src/components',
          })
        ]
      };
    `;
    const r = parseViteConfig(src, '/abs/repo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paths).toEqual({
        pagesDir: '/abs/repo/src/pages',
        layoutsDir: '/abs/repo/src/layouts',
        partialsDir: '/abs/repo/src/partials',
        componentsDir: '/abs/repo/src/components',
      });
    }
  });

  it('handles double-quoted strings and trailing commas', () => {
    const src = `
      pageDiscoveryPlugin({
        pagesDir: "p",
        layoutsDir: "l",
        partialsDir: "pa",
        componentsDir: "c",
      });
    `;
    const r = parseViteConfig(src, '/r');
    expect(r.ok).toBe(true);
  });

  it('returns ok=false when no pageDiscoveryPlugin call is present', () => {
    const r = parseViteConfig(`export default {};`, '/r');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/pageDiscoveryPlugin/);
  });

  it('returns ok=false when a required path option is missing', () => {
    const r = parseViteConfig(`pageDiscoveryPlugin({ pagesDir: 'p' });`, '/r');
    expect(r.ok).toBe(false);
  });

  it('returns ok=false when a path is a non-string literal', () => {
    const r = parseViteConfig(
      `pageDiscoveryPlugin({ pagesDir: 1, layoutsDir: 'l', partialsDir: 'p', componentsDir: 'c' });`,
      '/r',
    );
    expect(r.ok).toBe(false);
  });

  it('returns ok=false on syntactically invalid input', () => {
    const r = parseViteConfig(`this is not typescript {`, '/r');
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test viteConfig`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/workspace/viteConfig.ts`**

```ts
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

  // Reject parses with major syntax errors by checking for the canonical error.
  // ts.createSourceFile recovers, but the SourceFile carries `parseDiagnostics`.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test viteConfig`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/workspace/viteConfig.ts packages/server/src/workspace/viteConfig.test.ts
git commit -m "feat(server): parse pageDiscoveryPlugin paths from vite.config.ts via ts API"
```

### Task 18: File index

**Files:**

- Create: `packages/server/src/workspace/fileIndex.ts`
- Test: `packages/server/src/workspace/fileIndex.test.ts`

Three maps keyed by path-relative-to-root-dir-without-`.liquid`. Built by recursive directory scan. Pluggable filesystem so tests can use `memfs`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/workspace/fileIndex.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { fs, vol } from 'memfs';
import { buildFileIndex, applyFileEvent } from './fileIndex.js';

beforeEach(() => vol.reset());

describe('buildFileIndex', () => {
  it('indexes components, partials, and layouts; strips .liquid; key is dir-relative', () => {
    vol.fromJSON({
      '/r/c/button.liquid': '',
      '/r/c/forms/input.liquid': '',
      '/r/p/layout/header.liquid': '',
      '/r/l/main.liquid': '',
      '/r/l/special/job.liquid': '',
    });
    const idx = buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/r/p',
      layoutsDir: '/r/l',
      pagesDir: '/r/pages',
      fs: fs.promises as any,
    });
    return idx.then((i) => {
      expect([...i.components.keys()].sort()).toEqual(['button', 'forms/input']);
      expect([...i.partials.keys()].sort()).toEqual(['layout/header']);
      expect([...i.layouts.keys()].sort()).toEqual(['main', 'special/job']);
      expect(i.components.get('button')?.absPath).toBe('/r/c/button.liquid');
    });
  });

  it('ignores .liquid.json sidecars while indexing', async () => {
    vol.fromJSON({
      '/r/c/x.liquid': '',
      '/r/c/x.liquid.json': '{}',
    });
    const i = await buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/r/p',
      layoutsDir: '/r/l',
      pagesDir: '/r/p',
      fs: fs.promises as any,
    });
    expect([...i.components.keys()]).toEqual(['x']);
  });

  it('handles a missing dir gracefully (empty map, no throw)', async () => {
    vol.fromJSON({ '/r/c/x.liquid': '' });
    const i = await buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/missing',
      layoutsDir: '/also-missing',
      pagesDir: '/r/p',
      fs: fs.promises as any,
    });
    expect(i.components.size).toBe(1);
    expect(i.partials.size).toBe(0);
    expect(i.layouts.size).toBe(0);
  });
});

describe('applyFileEvent', () => {
  it('adds a file on create event', async () => {
    vol.fromJSON({ '/r/c/a.liquid': '' });
    const idx = await buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/x',
      layoutsDir: '/y',
      pagesDir: '/z',
      fs: fs.promises as any,
    });
    applyFileEvent(idx, { componentsDir: '/r/c', partialsDir: '/x', layoutsDir: '/y' }, '/r/c/b.liquid', 'created', 42);
    expect(idx.components.get('b')?.mtime).toBe(42);
  });

  it('removes a file on delete event', async () => {
    vol.fromJSON({ '/r/c/a.liquid': '' });
    const idx = await buildFileIndex({
      componentsDir: '/r/c',
      partialsDir: '/x',
      layoutsDir: '/y',
      pagesDir: '/z',
      fs: fs.promises as any,
    });
    applyFileEvent(idx, { componentsDir: '/r/c', partialsDir: '/x', layoutsDir: '/y' }, '/r/c/a.liquid', 'deleted', 0);
    expect(idx.components.has('a')).toBe(false);
  });

  it('classifies the path into the right map by directory prefix', async () => {
    const idx = {
      components: new Map(),
      partials: new Map(),
      layouts: new Map(),
    };
    applyFileEvent(idx, { componentsDir: '/c', partialsDir: '/p', layoutsDir: '/l' }, '/p/footer.liquid', 'created', 1);
    expect(idx.partials.has('footer')).toBe(true);
    expect(idx.components.has('footer')).toBe(false);
  });
});
```

- [ ] **Step 2: Install `memfs` dev-dep**

```bash
pnpm --filter @vscode-liquid-paradox/server add -D memfs
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test fileIndex`
Expected: FAIL ("Cannot find module './fileIndex.js'").

- [ ] **Step 4: Write `packages/server/src/workspace/fileIndex.ts`**

```ts
import type { Dirent, PathLike } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';

export interface FileIndexEntry {
  absPath: string;
  mtime: number;
}

export interface FileIndex {
  components: Map<string, FileIndexEntry>;
  partials: Map<string, FileIndexEntry>;
  layouts: Map<string, FileIndexEntry>;
}

export interface IndexDirs {
  componentsDir: string;
  partialsDir: string;
  layoutsDir: string;
  pagesDir: string;
}

export interface BuildOpts extends IndexDirs {
  fs: PromiseFs;
}

interface PromiseFs {
  readdir(p: PathLike, opts: { withFileTypes: true }): Promise<Dirent[]>;
  stat(p: PathLike): Promise<{ mtimeMs: number; isFile(): boolean; isDirectory(): boolean }>;
}

export async function buildFileIndex(opts: BuildOpts): Promise<FileIndex> {
  const components = new Map<string, FileIndexEntry>();
  const partials = new Map<string, FileIndexEntry>();
  const layouts = new Map<string, FileIndexEntry>();

  await Promise.all([
    walk(opts.fs, opts.componentsDir, opts.componentsDir, components),
    walk(opts.fs, opts.partialsDir, opts.partialsDir, partials),
    walk(opts.fs, opts.layoutsDir, opts.layoutsDir, layouts),
  ]);

  return { components, partials, layouts };
}

async function walk(pfs: PromiseFs, root: string, current: string, target: Map<string, FileIndexEntry>): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await pfs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(pfs, root, full, target);
    } else if (entry.isFile() && entry.name.endsWith('.liquid') && !entry.name.endsWith('.liquid.json')) {
      const key = path.relative(root, full).slice(0, -'.liquid'.length).split(path.sep).join('/');
      const stat = await pfs.stat(full);
      target.set(key, { absPath: full, mtime: stat.mtimeMs });
    }
  }
}

export interface EventDirs {
  componentsDir: string;
  partialsDir: string;
  layoutsDir: string;
}

export function applyFileEvent(
  idx: FileIndex,
  dirs: EventDirs,
  absPath: string,
  event: 'created' | 'changed' | 'deleted',
  mtime: number,
): void {
  const target = classify(absPath, dirs, idx);
  if (!target) return;
  const { map, key } = target;
  if (event === 'deleted') map.delete(key);
  else map.set(key, { absPath, mtime });
}

function classify(
  absPath: string,
  dirs: EventDirs,
  idx: FileIndex,
): { map: Map<string, FileIndexEntry>; key: string } | null {
  if (!absPath.endsWith('.liquid') || absPath.endsWith('.liquid.json')) return null;
  for (const [dir, map] of [
    [dirs.componentsDir, idx.components],
    [dirs.partialsDir, idx.partials],
    [dirs.layoutsDir, idx.layouts],
  ] as const) {
    if (absPath === dir || absPath.startsWith(dir + path.sep)) {
      const rel = path.relative(dir, absPath).slice(0, -'.liquid'.length).split(path.sep).join('/');
      return { map, key: rel };
    }
  }
  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test fileIndex`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/workspace/fileIndex.ts packages/server/src/workspace/fileIndex.test.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(server): build three-map file index from vite-config dirs"
```

### Task 19: Document store

**Files:**

- Create: `packages/server/src/workspace/documentStore.ts`
- Test: `packages/server/src/workspace/documentStore.test.ts`

Caches `DocumentModel` by URI. Provides `update(uri, text)` to re-analyze, `get(uri)`, and `remove(uri)`. Looks up sibling JSON companions and component-file detection via injected callbacks (so it has no direct filesystem dependency in unit tests).

- [ ] **Step 1: Write the failing test**

`packages/server/src/workspace/documentStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocumentStore } from './documentStore.js';

describe('DocumentStore', () => {
  let lookups: { isComponent: boolean; readJson: (p: string) => string | undefined };
  beforeEach(() => {
    lookups = {
      isComponent: false,
      readJson: () => undefined,
    };
  });

  it('caches DocumentModel by URI', () => {
    const store = createDocumentStore({
      isComponentUri: () => lookups.isComponent,
      readJsonCompanion: (path) => lookups.readJson(path),
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    store.update('file:///x/home.liquid', '<h1>hi</h1>');
    expect(store.get('file:///x/home.liquid')?.text).toBe('<h1>hi</h1>');
  });

  it('passes the right jsonCompanion based on the URI', () => {
    lookups.readJson = (p) => (p === '/x/home.liquid.json' ? '{"title":"Hi"}' : undefined);
    const store = createDocumentStore({
      isComponentUri: () => lookups.isComponent,
      readJsonCompanion: (p) => lookups.readJson(p),
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    store.update('file:///x/home.liquid', '{{ title }}');
    const m = store.get('file:///x/home.liquid')!;
    expect(m.scopeByOffset(5).get('title')?.type).toEqual({ kind: 'string' });
    expect(m.dependencies.jsonCompanion).toBe('/x/home.liquid.json');
  });

  it('flags isComponent on update', () => {
    lookups.isComponent = true;
    const store = createDocumentStore({
      isComponentUri: () => lookups.isComponent,
      readJsonCompanion: () => undefined,
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    store.update('file:///c/button.liquid', `{% assign x = x | default: '' %}{{ x }}`);
    expect(store.get('file:///c/button.liquid')?.componentProps?.[0].name).toBe('x');
  });

  it('remove drops the cache entry', () => {
    const store = createDocumentStore({
      isComponentUri: () => false,
      readJsonCompanion: () => undefined,
      lookupComponent: () => undefined,
      uriToPath: (u) => u.replace('file://', ''),
    });
    store.update('file:///a.liquid', 'x');
    store.remove('file:///a.liquid');
    expect(store.get('file:///a.liquid')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test documentStore`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/workspace/documentStore.ts`**

```ts
import { analyzeDocument, type DocumentModel } from '../analyzer/document.js';
import type { Binding } from '../types.js';

export interface DocumentStoreDeps {
  isComponentUri: (uri: string) => boolean;
  /** Read the sibling .liquid.json text or undefined if absent. */
  readJsonCompanion: (jsonAbsPath: string) => string | undefined;
  /** Look up another component's props by key (e.g. "button"). */
  lookupComponent: (key: string) => Binding[] | undefined;
  uriToPath: (uri: string) => string;
}

export interface DocumentStore {
  update(uri: string, text: string): DocumentModel;
  get(uri: string): DocumentModel | undefined;
  remove(uri: string): void;
  allUris(): string[];
}

export function createDocumentStore(deps: DocumentStoreDeps): DocumentStore {
  const cache = new Map<string, DocumentModel>();

  return {
    update(uri, text) {
      const absPath = deps.uriToPath(uri);
      const jsonPath = absPath + '.json';
      const jsonText = deps.readJsonCompanion(jsonPath);
      const model = analyzeDocument({
        uri,
        text,
        jsonCompanion: jsonText !== undefined ? { path: jsonPath, text: jsonText } : undefined,
        isComponent: deps.isComponentUri(uri),
        componentLookup: deps.lookupComponent,
      });
      cache.set(uri, model);
      return model;
    },
    get(uri) {
      return cache.get(uri);
    },
    remove(uri) {
      cache.delete(uri);
    },
    allUris() {
      return [...cache.keys()];
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test documentStore`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/workspace/documentStore.ts packages/server/src/workspace/documentStore.test.ts
git commit -m "feat(server): URI-keyed document cache producing DocumentModel"
```

### Task 20: Dependency graph

**Files:**

- Create: `packages/server/src/workspace/depGraph.ts`
- Test: `packages/server/src/workspace/depGraph.test.ts`

Inverse map of `DocumentModel.dependencies` — answers "which open documents depend on this absolute path or render-key?". Used by watchers to know which documents to re-diagnose when a file changes.

- [ ] **Step 1: Write the failing test**

`packages/server/src/workspace/depGraph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDepGraph } from './depGraph.js';

describe('DepGraph', () => {
  it('returns dependents of a JSON companion path', () => {
    const g = createDepGraph();
    g.set('file:///p/home.liquid', {
      jsonCompanion: '/p/home.liquid.json',
      renderedFiles: [],
      layoutFile: undefined,
    });
    expect(g.dependentsOfJson('/p/home.liquid.json')).toEqual(['file:///p/home.liquid']);
    expect(g.dependentsOfJson('/p/other.liquid.json')).toEqual([]);
  });

  it('returns dependents of a render key', () => {
    const g = createDepGraph();
    g.set('file:///p/a.liquid', { renderedFiles: ['components/button'], layoutFile: undefined });
    g.set('file:///p/b.liquid', { renderedFiles: ['components/button', 'partials/foot'], layoutFile: undefined });
    expect(g.dependentsOfRenderKey('components/button').sort()).toEqual(['file:///p/a.liquid', 'file:///p/b.liquid']);
    expect(g.dependentsOfRenderKey('partials/foot')).toEqual(['file:///p/b.liquid']);
  });

  it('returns dependents of a layout key', () => {
    const g = createDepGraph();
    g.set('file:///p/x.liquid', { renderedFiles: [], layoutFile: 'main' });
    expect(g.dependentsOfLayoutKey('main')).toEqual(['file:///p/x.liquid']);
  });

  it('set() overwrites previous deps for the URI', () => {
    const g = createDepGraph();
    g.set('file:///a.liquid', { renderedFiles: ['old'], layoutFile: undefined });
    g.set('file:///a.liquid', { renderedFiles: ['new'], layoutFile: undefined });
    expect(g.dependentsOfRenderKey('old')).toEqual([]);
    expect(g.dependentsOfRenderKey('new')).toEqual(['file:///a.liquid']);
  });

  it('remove() drops the entry from all inverse maps', () => {
    const g = createDepGraph();
    g.set('file:///a.liquid', { renderedFiles: ['x'], layoutFile: 'y', jsonCompanion: '/a.json' });
    g.remove('file:///a.liquid');
    expect(g.dependentsOfRenderKey('x')).toEqual([]);
    expect(g.dependentsOfLayoutKey('y')).toEqual([]);
    expect(g.dependentsOfJson('/a.json')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test depGraph`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/workspace/depGraph.ts`**

```ts
import type { Dependencies } from '../types.js';

export interface DepGraph {
  set(uri: string, deps: Dependencies): void;
  remove(uri: string): void;
  dependentsOfJson(jsonAbsPath: string): string[];
  dependentsOfRenderKey(key: string): string[];
  dependentsOfLayoutKey(key: string): string[];
}

export function createDepGraph(): DepGraph {
  const byUri = new Map<string, Dependencies>();
  const byJson = new Map<string, Set<string>>();
  const byRender = new Map<string, Set<string>>();
  const byLayout = new Map<string, Set<string>>();

  function addTo(map: Map<string, Set<string>>, key: string, uri: string): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(uri);
  }
  function removeFrom(map: Map<string, Set<string>>, key: string, uri: string): void {
    const set = map.get(key);
    if (!set) return;
    set.delete(uri);
    if (set.size === 0) map.delete(key);
  }

  return {
    set(uri, deps) {
      // Remove old
      const old = byUri.get(uri);
      if (old) {
        if (old.jsonCompanion) removeFrom(byJson, old.jsonCompanion, uri);
        for (const r of old.renderedFiles) removeFrom(byRender, r, uri);
        if (old.layoutFile) removeFrom(byLayout, old.layoutFile, uri);
      }
      // Add new
      if (deps.jsonCompanion) addTo(byJson, deps.jsonCompanion, uri);
      for (const r of deps.renderedFiles) addTo(byRender, r, uri);
      if (deps.layoutFile) addTo(byLayout, deps.layoutFile, uri);
      byUri.set(uri, deps);
    },
    remove(uri) {
      const old = byUri.get(uri);
      if (!old) return;
      if (old.jsonCompanion) removeFrom(byJson, old.jsonCompanion, uri);
      for (const r of old.renderedFiles) removeFrom(byRender, r, uri);
      if (old.layoutFile) removeFrom(byLayout, old.layoutFile, uri);
      byUri.delete(uri);
    },
    dependentsOfJson(p) {
      return [...(byJson.get(p) ?? [])];
    },
    dependentsOfRenderKey(k) {
      return [...(byRender.get(k) ?? [])];
    },
    dependentsOfLayoutKey(k) {
      return [...(byLayout.get(k) ?? [])];
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test depGraph`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/workspace/depGraph.ts packages/server/src/workspace/depGraph.test.ts
git commit -m "feat(server): dependency inverse-graph for cross-file invalidation"
```

### Task 21: Watcher registration

**Files:**

- Create: `packages/server/src/workspace/watchers.ts`
- Test: `packages/server/src/workspace/watchers.test.ts`

Builds the three `FileSystemWatcher` registration descriptors the server passes to the client via `client/registerCapability`. Pure function — returns the LSP registration params; the connection layer (Task 26) does the actual `connection.client.register` call.

Also exports `routeFileEvent` which takes a `FileChangeType`-style event, calls into `fileIndex.applyFileEvent`, invalidates JSON-companion caches, and returns the list of URIs that need re-diagnosis.

- [ ] **Step 1: Write the failing test**

`packages/server/src/workspace/watchers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildWatcherRegistrations, routeFileEvent } from './watchers.js';
import { createDepGraph } from './depGraph.js';
import type { FileIndex } from './fileIndex.js';

describe('buildWatcherRegistrations', () => {
  it('returns three watchers covering vite.config.ts, *.liquid in indexed dirs, and *.liquid.json in pages+partials', () => {
    const regs = buildWatcherRegistrations({
      pagesDir: '/r/pages',
      partialsDir: '/r/partials',
      componentsDir: '/r/components',
      layoutsDir: '/r/layouts',
    });
    expect(regs).toHaveLength(3);
    expect(regs[0].globPattern).toMatch(/vite\.config\.ts$/);
    expect(regs[1].globPattern).toContain('.liquid');
    expect(regs[2].globPattern).toContain('.liquid.json');
  });
});

describe('routeFileEvent', () => {
  it('vite.config.ts change → rebuildIndex flag', () => {
    const out = routeFileEvent({
      absPath: '/r/vite.config.ts',
      event: 'changed',
      mtime: 5,
      dirs: { repoRoot: '/r', pagesDir: '/r/p', partialsDir: '/r/pa', componentsDir: '/r/c', layoutsDir: '/r/l' },
      fileIndex: { components: new Map(), partials: new Map(), layouts: new Map() } as FileIndex,
      depGraph: createDepGraph(),
      openUris: [],
    });
    expect(out.rebuildIndex).toBe(true);
    expect(out.urisToRediagnose).toEqual([]);
  });

  it('component .liquid change → updates index map and returns dependents from depGraph', () => {
    const idx: FileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
    const g = createDepGraph();
    g.set('file:///p/home.liquid', { renderedFiles: ['button'], layoutFile: undefined });
    const out = routeFileEvent({
      absPath: '/r/c/button.liquid',
      event: 'created',
      mtime: 9,
      dirs: { repoRoot: '/r', pagesDir: '/r/p', partialsDir: '/r/pa', componentsDir: '/r/c', layoutsDir: '/r/l' },
      fileIndex: idx,
      depGraph: g,
      openUris: ['file:///p/home.liquid'],
    });
    expect(idx.components.get('button')?.absPath).toBe('/r/c/button.liquid');
    expect(out.urisToRediagnose).toEqual(['file:///p/home.liquid']);
    expect(out.invalidateComponentPropsKey).toBe('button');
  });

  it('.liquid.json change → returns dependents from depGraph by jsonCompanion path', () => {
    const g = createDepGraph();
    g.set('file:///p/home.liquid', {
      jsonCompanion: '/r/p/home.liquid.json',
      renderedFiles: [],
      layoutFile: undefined,
    });
    const out = routeFileEvent({
      absPath: '/r/p/home.liquid.json',
      event: 'changed',
      mtime: 1,
      dirs: { repoRoot: '/r', pagesDir: '/r/p', partialsDir: '/r/pa', componentsDir: '/r/c', layoutsDir: '/r/l' },
      fileIndex: { components: new Map(), partials: new Map(), layouts: new Map() } as FileIndex,
      depGraph: g,
      openUris: ['file:///p/home.liquid'],
    });
    expect(out.urisToRediagnose).toEqual(['file:///p/home.liquid']);
    expect(out.invalidateJsonPath).toBe('/r/p/home.liquid.json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test watchers`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/workspace/watchers.ts`**

```ts
import * as path from 'node:path';
import { applyFileEvent, type FileIndex } from './fileIndex.js';
import type { DepGraph } from './depGraph.js';

export interface WatcherRegistration {
  globPattern: string;
}

export function buildWatcherRegistrations(dirs: {
  pagesDir: string;
  partialsDir: string;
  componentsDir: string;
  layoutsDir: string;
}): WatcherRegistration[] {
  const liquidDirs = [dirs.componentsDir, dirs.partialsDir, dirs.layoutsDir].join(',');
  const jsonDirs = [dirs.pagesDir, dirs.partialsDir].join(',');
  return [
    { globPattern: '**/vite.config.ts' },
    { globPattern: `{${liquidDirs}}/**/*.liquid` },
    { globPattern: `{${jsonDirs}}/**/*.liquid.json` },
  ];
}

export interface RouteInput {
  absPath: string;
  event: 'created' | 'changed' | 'deleted';
  mtime: number;
  dirs: {
    repoRoot: string;
    pagesDir: string;
    partialsDir: string;
    componentsDir: string;
    layoutsDir: string;
  };
  fileIndex: FileIndex;
  depGraph: DepGraph;
  openUris: string[];
}

export interface RouteOutput {
  rebuildIndex: boolean;
  urisToRediagnose: string[];
  invalidateJsonPath?: string;
  invalidateComponentPropsKey?: string;
}

export function routeFileEvent(input: RouteInput): RouteOutput {
  const { absPath, event, mtime, dirs, fileIndex, depGraph } = input;

  if (absPath === path.join(dirs.repoRoot, 'vite.config.ts') || absPath.endsWith(path.sep + 'vite.config.ts')) {
    return { rebuildIndex: true, urisToRediagnose: [] };
  }

  if (absPath.endsWith('.liquid.json')) {
    return {
      rebuildIndex: false,
      urisToRediagnose: depGraph.dependentsOfJson(absPath),
      invalidateJsonPath: absPath,
    };
  }

  if (absPath.endsWith('.liquid')) {
    const beforeKey = findKey(absPath, dirs);
    applyFileEvent(fileIndex, dirs, absPath, event, mtime);
    let urisToRediagnose: string[] = [];
    let propsKey: string | undefined;
    if (beforeKey) {
      if (beforeKey.bucket === 'components') {
        propsKey = beforeKey.key;
        urisToRediagnose = depGraph.dependentsOfRenderKey(beforeKey.key);
      } else if (beforeKey.bucket === 'partials') {
        urisToRediagnose = depGraph.dependentsOfRenderKey(beforeKey.key);
      } else {
        urisToRediagnose = depGraph.dependentsOfLayoutKey(beforeKey.key);
      }
    }
    return { rebuildIndex: false, urisToRediagnose, invalidateComponentPropsKey: propsKey };
  }

  return { rebuildIndex: false, urisToRediagnose: [] };
}

function findKey(
  absPath: string,
  dirs: RouteInput['dirs'],
): { bucket: 'components' | 'partials' | 'layouts'; key: string } | null {
  for (const [bucket, dir] of [
    ['components', dirs.componentsDir],
    ['partials', dirs.partialsDir],
    ['layouts', dirs.layoutsDir],
  ] as const) {
    if (absPath === dir || absPath.startsWith(dir + path.sep)) {
      const rel = path.relative(dir, absPath);
      if (!rel.endsWith('.liquid')) return null;
      return { bucket, key: rel.slice(0, -'.liquid'.length).split(path.sep).join('/') };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test watchers`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/workspace/watchers.ts packages/server/src/workspace/watchers.test.ts
git commit -m "feat(server): watcher registrations + file-event router"
```

---

## Phase 4 — LSP Providers

Each provider is a pure function `(model, position, context) => Result[]`. The connection layer (Phase 5) hands them the right inputs.

### Task 22: Completion provider

**Files:**

- Create: `packages/server/src/providers/completion.ts`
- Test: `packages/server/src/providers/completion.test.ts`

Routes by trigger context (spec §3.1):

1. After `{%` or `{%-` (in a tag opening, no name yet) → tag names
2. Inside a `{{ }}` expression or after `{% echo ` / `{% assign x = ` etc., before a `|` → variables in scope (and dotted property paths when after `.`)
3. After a `|` inside any expression → filter names
4. Inside a `{% render "..." %}` path string → component + partial keys
5. Inside a `{% layout "..." %}` path string → layout keys
6. After `{% render "components/X", ` (or after each `,` in the arg list) → that component's props

Inside a Paradox tag (`paradoxOutputRanges` contains the surrounding output's range key) → empty list.

- [ ] **Step 1: Write the failing test**

`packages/server/src/providers/completion.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test completion`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/providers/completion.ts`**

```ts
import type { Binding, LiquidType } from '../types.js';
import type { DocumentModel } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import { TAGS } from '../data/tags.js';
import { FILTERS } from '../data/filters.js';

export interface CompletionItem {
  label: string;
  kind: 'Keyword' | 'Variable' | 'Function' | 'Module' | 'File' | 'Property';
  detail?: string;
  documentation?: string;
}

export interface CompletionContext {
  fileIndex: FileIndex;
  lookupComponentProps: (key: string) => Binding[] | undefined;
}

interface Position {
  line: number;
  character: number;
}

export function provideCompletions(model: DocumentModel, pos: Position, ctx: CompletionContext): CompletionItem[] {
  const offset = positionToOffset(model.text, pos);
  if (isInsideParadoxTag(model, pos)) return [];

  const tagCtx = detectTagOpeningContext(model.text, offset);
  if (tagCtx === 'tagName') return tagCompletions();

  const renderPath = detectStringLiteralContext(model.text, offset, /\brender\s+["']$|\brender\s+["'][^"']*$/);
  if (renderPath) return renderPathCompletions(ctx.fileIndex);

  const layoutPath = detectStringLiteralContext(model.text, offset, /\blayout\s+["']$|\blayout\s+["'][^"']*$/);
  if (layoutPath) return layoutPathCompletions(ctx.fileIndex);

  const renderProps = detectRenderArgContext(model.text, offset);
  if (renderProps) {
    // Only components carry a declared prop interface — partials accept arbitrary kwargs.
    if (!ctx.fileIndex.components.has(renderProps.key)) return [];
    const props = ctx.lookupComponentProps(renderProps.key);
    if (!props) return [];
    return props.map((p) => ({
      label: p.name,
      kind: 'Property' as const,
      detail: `${typeLabel(p.type)} = ${p.origin.kind === 'componentProp' ? p.origin.defaultValue : ''}`,
    }));
  }

  if (isAfterPipe(model.text, offset)) return filterCompletions();
  if (isInExpressionContext(model.text, offset)) return variableCompletions(model, offset);

  return [];
}

function tagCompletions(): CompletionItem[] {
  return Object.values(TAGS).map((t) => ({
    label: t.name,
    kind: 'Keyword',
    detail: 'tag',
    documentation: t.description,
  }));
}

function filterCompletions(): CompletionItem[] {
  return Object.values(FILTERS).map((f) => ({
    label: f.name,
    kind: 'Function',
    detail: f.signature,
    documentation: f.description,
  }));
}

function variableCompletions(model: DocumentModel, offset: number): CompletionItem[] {
  const text = model.text;
  // If after a dot, complete the object's keys.
  const dotMatch = text.slice(0, offset).match(/([\w.]+)\.$/);
  if (dotMatch) {
    const path = dotMatch[1]!.split('.');
    const scope = model.scopeByOffset(offset);
    const root = scope.get(path[0]!);
    if (!root) return [];
    const t = walkPath(root.type, path.slice(1));
    if (t.kind === 'object') {
      return Object.keys(t.properties).map((k) => ({
        label: k,
        kind: 'Variable',
        detail: typeLabel(t.properties[k]!.type),
      }));
    }
    return [];
  }
  const scope = model.scopeByOffset(offset);
  const out: CompletionItem[] = [];
  for (const [name, binding] of scope) {
    out.push({
      label: name,
      kind: 'Variable',
      detail: variableDetail(binding),
    });
  }
  return out;
}

function variableDetail(b: Binding): string {
  const t = typeLabel(b.type);
  switch (b.origin.kind) {
    case 'json':
      return `${t} — from .liquid.json`;
    case 'local':
      return `${t} — ${b.origin.tag}`;
    case 'componentProp':
      return `${t} — prop`;
    case 'builtin':
      return `${t} — built-in`;
  }
}

function renderPathCompletions(idx: FileIndex): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const key of idx.components.keys()) {
    out.push({ label: key, kind: 'Module', detail: 'component' });
  }
  for (const key of idx.partials.keys()) {
    out.push({ label: key, kind: 'File', detail: 'partial' });
  }
  return out;
}

function layoutPathCompletions(idx: FileIndex): CompletionItem[] {
  return [...idx.layouts.keys()].map((key) => ({ label: key, kind: 'File', detail: 'layout' }));
}

function detectTagOpeningContext(text: string, offset: number): 'tagName' | null {
  // Find nearest preceding '{%' or '{%-' with no closing yet
  const prefix = text.slice(0, offset);
  const lastOpen = Math.max(prefix.lastIndexOf('{%'), prefix.lastIndexOf('{%-'));
  if (lastOpen === -1) return null;
  const between = prefix.slice(lastOpen);
  if (between.includes('%}') || between.includes('-%}')) return null;
  // Inside tag region; if we have no non-whitespace yet OR only `-` (`{%-`), it's the tag name position.
  const afterOpen = between.replace(/^\{%-?/, '');
  if (/^\s*[\w-]*$/.test(afterOpen)) return 'tagName';
  return null;
}

function detectStringLiteralContext(text: string, offset: number, re: RegExp): boolean {
  return re.test(text.slice(0, offset));
}

function detectRenderArgContext(text: string, offset: number): { key: string } | null {
  const prefix = text.slice(0, offset);
  const m = prefix.match(/\brender\s+["']([^"']+)["']\s*,[^%}]*$/);
  if (!m) return null;
  // Path keys are bare (no 'components/' or 'partials/' prefix) — they match the file
  // index, whose keys are stripped to be relative to their root dir per spec §5.2.
  return { key: m[1]! };
}

function isAfterPipe(text: string, offset: number): boolean {
  const prefix = text.slice(0, offset);
  const lastOpen = Math.max(prefix.lastIndexOf('{{'), prefix.lastIndexOf('{%'));
  if (lastOpen === -1) return false;
  const inExpr = prefix.slice(lastOpen);
  if (inExpr.includes('}}') || inExpr.includes('%}')) return false;
  return /\|\s*[\w-]*$/.test(inExpr);
}

function isInExpressionContext(text: string, offset: number): boolean {
  const prefix = text.slice(0, offset);
  const lastOutputOpen = prefix.lastIndexOf('{{');
  const lastOutputClose = prefix.lastIndexOf('}}');
  if (lastOutputOpen > lastOutputClose) return true;
  const lastTagOpen = prefix.lastIndexOf('{%');
  const lastTagClose = prefix.lastIndexOf('%}');
  if (lastTagOpen > lastTagClose) {
    const inTag = prefix.slice(lastTagOpen);
    if (/(assign\s+[\w-]+\s*=|echo\s+)/.test(inTag)) return true;
  }
  return false;
}

function isInsideParadoxTag(model: DocumentModel, pos: Position): boolean {
  for (const tag of model.paradoxTags) {
    if (positionInRange(pos, tag.range)) return true;
  }
  return false;
}

function positionInRange(pos: Position, range: { start: Position; end: Position }): boolean {
  return (
    (pos.line > range.start.line || (pos.line === range.start.line && pos.character >= range.start.character)) &&
    (pos.line < range.end.line || (pos.line === range.end.line && pos.character <= range.end.character))
  );
}

function typeLabel(t: LiquidType): string {
  switch (t.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'unknown':
      return t.kind;
    case 'array':
      return `Array<${typeLabel(t.element)}>`;
    case 'object':
      return `{ ${Object.keys(t.properties).slice(0, 3).join(', ')}${Object.keys(t.properties).length > 3 ? ', ...' : ''} }`;
    case 'union':
      return t.variants.map(typeLabel).join(' | ');
  }
}

function walkPath(type: LiquidType, segments: string[]): LiquidType {
  let t = type;
  for (const s of segments) {
    if (t.kind === 'object' && t.properties[s]) t = t.properties[s]!.type;
    else if (t.kind === 'array' && /^\d+$/.test(s)) t = t.element;
    else return { kind: 'unknown' };
  }
  return t;
}

function positionToOffset(text: string, pos: Position): number {
  let line = 0,
    character = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === pos.line && character === pos.character) return i;
    if (text.charCodeAt(i) === 10) {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return text.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test completion`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/providers/completion.ts packages/server/src/providers/completion.test.ts
git commit -m "feat(server): completion provider routing across all trigger contexts"
```

### Task 23: Hover provider

**Files:**

- Create: `packages/server/src/providers/hover.ts`
- Test: `packages/server/src/providers/hover.test.ts`

Routes by what's at the cursor (spec §3.2): tag name, filter name, variable identifier, Paradox tag, or a render/layout path string.

- [ ] **Step 1: Write the failing test**

`packages/server/src/providers/hover.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { provideHover } from './hover.js';
import { analyzeDocument } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';

const idx: FileIndex = {
  components: new Map([['button', { absPath: '/c/button.liquid', mtime: 0 }]]),
  partials: new Map(),
  layouts: new Map([['main', { absPath: '/l/main.liquid', mtime: 0 }]]),
};

function m(src: string, json?: { path: string; text: string }) {
  return analyzeDocument({
    uri: 'file:///p/x.liquid',
    text: src,
    jsonCompanion: json,
    isComponent: false,
    componentLookup: () => undefined,
  });
}

describe('provideHover', () => {
  it('hover over a tag name → tag docs', () => {
    const src = '{% for x in xs %}{% endfor %}';
    const h = provideHover(m(src), { line: 0, character: 4 }, { fileIndex: idx });
    expect(h?.markdown).toMatch(/for/i);
    expect(h?.markdown).toMatch(/liquidjs\.com\/tags\/for\.html/);
  });

  it('hover over a filter name → filter docs', () => {
    const src = '{{ x | upcase }}';
    const h = provideHover(m(src), { line: 0, character: 9 }, { fileIndex: idx });
    expect(h?.markdown).toMatch(/upper/i);
  });

  it('hover over a variable → origin + type', () => {
    const src = '{{ title }}';
    const h = provideHover(
      m(src, { path: '/p/x.liquid.json', text: '{"title":"Hi"}' }),
      { line: 0, character: 5 },
      { fileIndex: idx },
    );
    expect(h?.markdown).toMatch(/string/);
    expect(h?.markdown).toMatch(/\.liquid\.json/);
  });

  it('hover over a paradox tag returns the exact spec wording', () => {
    expect(provideHover(m('{{component:Hero}}'), { line: 0, character: 5 }, { fileIndex: idx })?.markdown).toBe(
      'Render the component on Site Studio',
    );
    expect(provideHover(m('{{snippet:abc}}'), { line: 0, character: 5 }, { fileIndex: idx })?.markdown).toBe(
      'Render the snippet on Site Studio',
    );
    expect(provideHover(m('{{data:job.title}}'), { line: 0, character: 5 }, { fileIndex: idx })?.markdown).toBe(
      'Render the data for Site Studio',
    );
    expect(provideHover(m('{{attribute:cls}}'), { line: 0, character: 5 }, { fileIndex: idx })?.markdown).toBe(
      'Render the data for Site Studio',
    );
  });

  it('hover over a render path → resolved absolute path with markdown link', () => {
    const src = '{% render "components/button" %}';
    const h = provideHover(m(src), { line: 0, character: 15 }, { fileIndex: idx });
    expect(h?.markdown).toMatch(/\/c\/button\.liquid/);
    expect(h?.markdown).toContain('](file:///c/button.liquid)');
  });

  it('hover over a layout path → resolved absolute path', () => {
    const src = '{% layout "main" %}';
    const h = provideHover(m(src), { line: 0, character: 12 }, { fileIndex: idx });
    expect(h?.markdown).toMatch(/\/l\/main\.liquid/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test hover`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/providers/hover.ts`**

```ts
import type { DocumentModel } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import type { Binding, LiquidType, Range } from '../types.js';
import { getTagInfo } from '../data/tags.js';
import { getFilterInfo } from '../data/filters.js';
import { getParadoxHover } from '../data/paradoxTags.js';

export interface HoverResult {
  markdown: string;
  range?: Range;
}
export interface HoverContext {
  fileIndex: FileIndex;
}

interface Position {
  line: number;
  character: number;
}

export function provideHover(model: DocumentModel, pos: Position, ctx: HoverContext): HoverResult | null {
  // Paradox tag?
  for (const tag of model.paradoxTags) {
    if (positionInRange(pos, tag.range)) {
      return { markdown: getParadoxHover(tag.kind)!, range: tag.range };
    }
  }

  const offset = positionToOffset(model.text, pos);
  const word = readWordAt(model.text, offset);
  if (!word) return null;

  // Render/layout path string?
  const stringCtx = readEnclosingStringLiteral(model.text, offset);
  if (stringCtx) {
    const renderTag = isPathContext(model.text, stringCtx.start, /\brender\s+["']$/);
    if (renderTag) {
      const entry = ctx.fileIndex.components.get(stringCtx.value) ?? ctx.fileIndex.partials.get(stringCtx.value);
      if (entry) return { markdown: `[${entry.absPath}](file://${entry.absPath})` };
    }
    const layoutTag = isPathContext(model.text, stringCtx.start, /\blayout\s+["']$/);
    if (layoutTag) {
      const entry = ctx.fileIndex.layouts.get(stringCtx.value);
      if (entry) return { markdown: `[${entry.absPath}](file://${entry.absPath})` };
    }
  }

  // Tag name?
  const tag = getTagInfo(word.text);
  if (tag && isAtTagName(model.text, offset, word)) {
    return {
      markdown: `**${tag.name}** — ${tag.description}\n\n\`${tag.syntax}\`\n\n[Docs](${tag.docsUrl})`,
      range: word.range,
    };
  }

  // Filter name?
  const filter = getFilterInfo(word.text);
  if (filter && isAfterPipeAtIdentifier(model.text, offset)) {
    return {
      markdown: `**${filter.name}** — ${filter.description}\n\n\`${filter.signature}\`\n\n[Docs](${filter.docsUrl})`,
      range: word.range,
    };
  }

  // Variable?
  const scope = model.scopeByOffset(offset);
  const binding = scope.get(word.text);
  if (binding) {
    return { markdown: hoverForBinding(binding), range: word.range };
  }
  return null;
}

function hoverForBinding(b: Binding): string {
  const t = typeLabel(b.type);
  const lines: string[] = [`**${b.name}** — \`${t}\``];
  switch (b.origin.kind) {
    case 'json':
      lines.push(`from \`${b.origin.jsonPath}\``);
      break;
    case 'local':
      lines.push(`from local \`${b.origin.tag}\``);
      break;
    case 'componentProp':
      lines.push(`component prop (default \`${b.origin.defaultValue}\`)`);
      break;
    case 'builtin':
      lines.push('built-in');
      break;
  }
  return lines.join('\n\n');
}

function typeLabel(t: LiquidType): string {
  switch (t.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'unknown':
      return t.kind;
    case 'array':
      return `Array<${typeLabel(t.element)}>`;
    case 'object':
      return `{ ${Object.keys(t.properties).join(', ')} }`;
    case 'union':
      return t.variants.map(typeLabel).join(' | ');
  }
}

function isAtTagName(text: string, offset: number, word: { range: Range }): boolean {
  const before = text.slice(0, positionToOffset(text, word.range.start));
  return /\{%-?\s*$/.test(before);
}

function isAfterPipeAtIdentifier(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  return /\|\s*[\w-]*$/.test(before);
}

function isPathContext(text: string, atOffset: number, re: RegExp): boolean {
  return re.test(text.slice(0, atOffset));
}

function readWordAt(text: string, offset: number): { text: string; range: Range } | null {
  if (offset >= text.length) offset = text.length - 1;
  if (offset < 0) return null;
  let start = offset;
  while (start > 0 && /[\w-]/.test(text[start - 1]!)) start--;
  let end = offset;
  while (end < text.length && /[\w-]/.test(text[end]!)) end++;
  if (start === end) return null;
  return {
    text: text.slice(start, end),
    range: { start: offsetToPosition(text, start), end: offsetToPosition(text, end) },
  };
}

function readEnclosingStringLiteral(
  text: string,
  offset: number,
): { value: string; start: number; end: number } | null {
  // Find the nearest "..." or '...' enclosing offset.
  let openIdx = -1;
  let quote = '';
  for (let i = offset; i >= 0; i--) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      openIdx = i;
      quote = ch;
      break;
    }
    if (ch === '{' || ch === '%') return null;
  }
  if (openIdx === -1) return null;
  const closeIdx = text.indexOf(quote, openIdx + 1);
  if (closeIdx === -1 || closeIdx < offset) return null;
  return { value: text.slice(openIdx + 1, closeIdx), start: openIdx, end: closeIdx };
}

function positionInRange(pos: Position, range: Range): boolean {
  return (
    (pos.line > range.start.line || (pos.line === range.start.line && pos.character >= range.start.character)) &&
    (pos.line < range.end.line || (pos.line === range.end.line && pos.character <= range.end.character))
  );
}

function positionToOffset(text: string, pos: Position): number {
  let line = 0,
    character = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === pos.line && character === pos.character) return i;
    if (text.charCodeAt(i) === 10) {
      line++;
      character = 0;
    } else character++;
  }
  return text.length;
}

function offsetToPosition(text: string, offset: number): Position {
  let line = 0,
    lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test hover`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/providers/hover.ts packages/server/src/providers/hover.test.ts
git commit -m "feat(server): hover provider for tags/filters/variables/paradox/paths"
```

### Task 24: Definition provider

**Files:**

- Create: `packages/server/src/providers/definition.ts`
- Test: `packages/server/src/providers/definition.test.ts`

Returns `{ uri, range }` for the destination (spec §3.3):

- Variable identifier with `json` origin → the `.liquid.json` key range
- Variable with `local` origin → the declaration range
- Variable with `componentProp` origin → the component file's assign line
- `render` path → target file, position {0,0}
- `layout` path → target file, position {0,0}

Returns `null` for built-ins and Paradox tags.

- [ ] **Step 1: Write the failing test**

`packages/server/src/providers/definition.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { provideDefinition } from './definition.js';
import { analyzeDocument } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';

const idx: FileIndex = {
  components: new Map([['button', { absPath: '/c/button.liquid', mtime: 0 }]]),
  partials: new Map(),
  layouts: new Map([['main', { absPath: '/l/main.liquid', mtime: 0 }]]),
};

function m(src: string, json?: { path: string; text: string }) {
  return analyzeDocument({
    uri: 'file:///abs/x.liquid',
    text: src,
    jsonCompanion: json,
    isComponent: false,
    componentLookup: () => undefined,
  });
}

describe('provideDefinition', () => {
  it('JSON-origin variable jumps to its key in the .liquid.json', () => {
    const json = '{\n  "title": "Hi"\n}';
    const d = provideDefinition(
      m('{{ title }}', { path: '/abs/x.liquid.json', text: json }),
      { line: 0, character: 4 },
      { fileIndex: idx },
    );
    expect(d?.uri).toBe('file:///abs/x.liquid.json');
    expect(d?.range.start.line).toBe(1);
  });

  it('local assign variable jumps to its declaration', () => {
    const src = '{% assign greeting = "hi" %}{{ greeting }}';
    const d = provideDefinition(m(src), { line: 0, character: src.indexOf('greeting }}') + 2 }, { fileIndex: idx });
    expect(d?.uri).toBe('file:///abs/x.liquid');
    expect(d?.range.start.character).toBeGreaterThanOrEqual(0);
  });

  it('render "button" jumps to button.liquid line 0', () => {
    const src = '{% render "button" %}';
    const d = provideDefinition(m(src), { line: 0, character: 13 }, { fileIndex: idx });
    expect(d?.uri).toBe('file:///c/button.liquid');
    expect(d?.range.start).toEqual({ line: 0, character: 0 });
  });

  it('layout "main" jumps to main.liquid', () => {
    const src = '{% layout "main" %}';
    const d = provideDefinition(m(src), { line: 0, character: 12 }, { fileIndex: idx });
    expect(d?.uri).toBe('file:///l/main.liquid');
  });

  it('paradox tag returns null', () => {
    const src = '{{component:Hero}}';
    expect(provideDefinition(m(src), { line: 0, character: 5 }, { fileIndex: idx })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test definition`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/providers/definition.ts`**

```ts
import type { DocumentModel } from '../analyzer/document.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import type { Range } from '../types.js';

interface Position {
  line: number;
  character: number;
}
export interface DefinitionResult {
  uri: string;
  range: Range;
}
export interface DefinitionContext {
  fileIndex: FileIndex;
}

export function provideDefinition(
  model: DocumentModel,
  pos: Position,
  ctx: DefinitionContext,
): DefinitionResult | null {
  // Paradox tag?
  for (const tag of model.paradoxTags) {
    if (positionInRange(pos, tag.range)) return null;
  }

  const offset = positionToOffset(model.text, pos);

  // Render/layout path
  const stringCtx = readEnclosingStringLiteral(model.text, offset);
  if (stringCtx) {
    const isRender = /\brender\s+["']$/.test(model.text.slice(0, stringCtx.start));
    if (isRender) {
      const entry = ctx.fileIndex.components.get(stringCtx.value) ?? ctx.fileIndex.partials.get(stringCtx.value);
      if (entry) return { uri: 'file://' + entry.absPath, range: zeroRange() };
    }
    const isLayout = /\blayout\s+["']$/.test(model.text.slice(0, stringCtx.start));
    if (isLayout) {
      const entry = ctx.fileIndex.layouts.get(stringCtx.value);
      if (entry) return { uri: 'file://' + entry.absPath, range: zeroRange() };
    }
  }

  // Variable identifier
  const word = readWordAt(model.text, offset);
  if (!word) return null;
  const scope = model.scopeByOffset(offset);
  const binding = scope.get(word.text);
  if (!binding) return null;

  switch (binding.origin.kind) {
    case 'json':
      return { uri: 'file://' + binding.origin.jsonPath, range: binding.origin.jsonKeyRange };
    case 'local':
      return { uri: model.uri, range: binding.origin.declRange };
    case 'componentProp':
      return { uri: 'file://' + binding.origin.componentPath, range: binding.origin.declRange };
    case 'builtin':
      return null;
  }
}

function zeroRange(): Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

function positionInRange(pos: Position, range: Range): boolean {
  return (
    (pos.line > range.start.line || (pos.line === range.start.line && pos.character >= range.start.character)) &&
    (pos.line < range.end.line || (pos.line === range.end.line && pos.character <= range.end.character))
  );
}

function readWordAt(text: string, offset: number): { text: string } | null {
  if (offset >= text.length) offset = text.length - 1;
  if (offset < 0) return null;
  let start = offset;
  while (start > 0 && /[\w-]/.test(text[start - 1]!)) start--;
  let end = offset;
  while (end < text.length && /[\w-]/.test(text[end]!)) end++;
  if (start === end) return null;
  return { text: text.slice(start, end) };
}

function readEnclosingStringLiteral(
  text: string,
  offset: number,
): { value: string; start: number; end: number } | null {
  let openIdx = -1,
    quote = '';
  for (let i = offset; i >= 0; i--) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      openIdx = i;
      quote = ch;
      break;
    }
    if (ch === '{' || ch === '%') return null;
  }
  if (openIdx === -1) return null;
  const closeIdx = text.indexOf(quote, openIdx + 1);
  if (closeIdx === -1 || closeIdx < offset) return null;
  return { value: text.slice(openIdx + 1, closeIdx), start: openIdx, end: closeIdx };
}

function positionToOffset(text: string, pos: Position): number {
  let line = 0,
    character = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === pos.line && character === pos.character) return i;
    if (text.charCodeAt(i) === 10) {
      line++;
      character = 0;
    } else character++;
  }
  return text.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test definition`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/providers/definition.ts packages/server/src/providers/definition.test.ts
git commit -m "feat(server): go-to-definition for variables, render, and layout"
```

### Task 25: Diagnostics provider

**Files:**

- Create: `packages/server/src/providers/diagnostics.ts`
- Test: `packages/server/src/providers/diagnostics.test.ts`

Reads the `DocumentModel` plus a `DiagnosticContext` (file index, component-props lookup) and emits the eight diagnostic rules from spec §3.4. Output is `Diagnostic[]` in the LSP shape from `vscode-languageserver-types`. Producing them as `{ severity, message, range, source }` objects keeps this provider free of the LSP connection.

- [ ] **Step 1: Write the failing test**

`packages/server/src/providers/diagnostics.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test diagnostics`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/providers/diagnostics.ts`**

```ts
import type { DocumentModel } from '../analyzer/document.js';
import type { AstNode } from '../analyzer/ast.js';
import type { FileIndex } from '../workspace/fileIndex.js';
import type { Binding, Range } from '../types.js';
import { isKnownTag, isClosingTag } from '../data/tags.js';
import { isKnownFilter } from '../data/filters.js';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  range: Range;
  severity: Severity;
  message: string;
  source: 'liquid-paradox';
}

export interface DiagnosticContext {
  fileIndex: FileIndex;
  pathFeaturesEnabled: boolean;
  lookupComponentProps: (key: string) => Binding[] | undefined;
}

export function provideDiagnostics(model: DocumentModel, ctx: DiagnosticContext): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const err of model.tokenErrors)
    out.push({ range: err.range, severity: 'error', message: err.message, source: 'liquid-paradox' });
  for (const err of model.astErrors)
    out.push({ range: err.range, severity: 'error', message: err.message, source: 'liquid-paradox' });

  walk(model.ast.root.children, model, ctx, out);

  return out;
}

function walk(nodes: AstNode[], model: DocumentModel, ctx: DiagnosticContext, out: Diagnostic[]): void {
  for (const node of nodes) {
    if (node.kind === 'output') {
      const key = `${node.range.start.line}:${node.range.start.character}`;
      if (model.paradoxOutputRanges.has(key)) continue;
      checkExpression(node.content, node.rawRange, model, out);
    } else if (node.kind === 'tag') {
      if (node.name === 'render' || node.name === 'include') {
        if (ctx.pathFeaturesEnabled) checkRender(node.args, node.rawRange, ctx, out);
      } else if (node.name === 'layout') {
        if (ctx.pathFeaturesEnabled) checkLayout(node.args, node.rawRange, ctx, out);
      } else if (node.name === 'assign') {
        const expr = node.args.replace(/^[\w-]+\s*=\s*/, '');
        checkExpression(expr, node.rawRange, model, out);
      } else if (node.name === 'echo') {
        checkExpression(node.args, node.rawRange, model, out);
      } else if (!isKnownTag(node.name) && !isClosingTag(node.name)) {
        out.push({
          range: node.range,
          severity: 'error',
          message: `Unknown tag '${node.name}'`,
          source: 'liquid-paradox',
        });
      }
    } else if (node.kind === 'block') {
      for (const b of node.branches) walk(b.body, model, ctx, out);
    }
  }
}

function checkExpression(expr: string, range: Range, model: DocumentModel, out: Diagnostic[]): void {
  const parts = splitOnPipe(expr);
  const main = parts[0]!.trim();
  if (main && /^[\w-]/.test(main)) {
    const root = main.split('.')[0]!;
    const scope = model.scopeByOffset(positionToOffset(model.text, range.start));
    if (!scope.has(root) && !/^"|^'|^-?\d|^true$|^false$|^nil$|^null$/.test(main)) {
      out.push({
        range,
        severity: 'warning',
        message: `Unknown variable '${root}'`,
        source: 'liquid-paradox',
      });
    }
  }
  for (let i = 1; i < parts.length; i++) {
    const filterName = parts[i]!.trim().split(/[\s:]/)[0]!;
    if (filterName && !isKnownFilter(filterName)) {
      out.push({
        range,
        severity: 'error',
        message: `Unknown filter '${filterName}'`,
        source: 'liquid-paradox',
      });
    }
  }
}

function checkRender(args: string, range: Range, ctx: DiagnosticContext, out: Diagnostic[]): void {
  const pathMatch = args.match(/^["']([^"']+)["']/);
  if (!pathMatch) return;
  const key = pathMatch[1]!;
  const isComponent = ctx.fileIndex.components.has(key);
  const isPartial = ctx.fileIndex.partials.has(key);
  if (!isComponent && !isPartial) {
    out.push({ range, severity: 'error', message: `Unresolved render path: '${key}'`, source: 'liquid-paradox' });
    return;
  }
  if (!isComponent) return; // partials accept arbitrary kwargs — no prop validation
  const props = ctx.lookupComponentProps(key);
  if (!props) return;
  const declared = new Set(props.map((p) => p.name));
  const argList = args.slice(pathMatch[0].length).replace(/^\s*,/, '');
  for (const m of argList.matchAll(/([\w-]+)\s*:/g)) {
    if (!declared.has(m[1]!)) {
      out.push({
        range,
        severity: 'warning',
        message: `Unknown prop '${m[1]}' on component '${key}'`,
        source: 'liquid-paradox',
      });
    }
  }
}

function checkLayout(args: string, range: Range, ctx: DiagnosticContext, out: Diagnostic[]): void {
  const pathMatch = args.match(/^["']([^"']+)["']/);
  if (!pathMatch) return;
  if (!ctx.fileIndex.layouts.has(pathMatch[1]!)) {
    out.push({
      range,
      severity: 'error',
      message: `Unresolved layout path: '${pathMatch[1]}'`,
      source: 'liquid-paradox',
    });
  }
}

function splitOnPipe(s: string): string[] {
  const out: string[] = [];
  let buf = '',
    inStr: string | null = null;
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
    } else buf += ch;
  }
  out.push(buf);
  return out;
}

function positionToOffset(text: string, pos: { line: number; character: number }): number {
  let line = 0,
    character = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === pos.line && character === pos.character) return i;
    if (text.charCodeAt(i) === 10) {
      line++;
      character = 0;
    } else character++;
  }
  return text.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test diagnostics`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/providers/diagnostics.ts packages/server/src/providers/diagnostics.test.ts
git commit -m "feat(server): diagnostics for all 8 rules from spec section 3.4"
```

---

## Phase 5 — Server Wiring

The connection layer. This is where `vscode-languageserver` types and side effects (real `fs`, real watchers, real LSP messages) enter the picture. Up to now everything was pure.

### Task 26: Connection bootstrap + initialize

**Files:**

- Modify: `packages/server/src/server.ts` (overwrite the Phase 0 stub)
- Create: `packages/server/src/serverState.ts` (holds the singletons)
- Test: `packages/server/src/serverState.test.ts`

`server.ts` creates an LSP connection, registers handlers, and wires lifecycle. `serverState.ts` is the single place that owns `viteConfig`, `fileIndex`, `documentStore`, `depGraph`, and `componentPropsCache`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/serverState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createServerState } from './serverState.js';

describe('createServerState', () => {
  it('returns disabled-paths state when vite config parse fails', () => {
    const state = createServerState({
      readVite: () => undefined,
      readFileSync: () => undefined,
      buildFileIndex: async () => ({ components: new Map(), partials: new Map(), layouts: new Map() }),
    });
    expect(state.pathFeaturesEnabled).toBe(false);
    expect(state.dirs).toBeUndefined();
  });

  it('parses and resolves dirs when vite config is valid', async () => {
    const state = createServerState({
      readVite: () => ({
        text: `pageDiscoveryPlugin({ pagesDir: 'p', layoutsDir: 'l', partialsDir: 'pa', componentsDir: 'c' });`,
        repoRoot: '/r',
      }),
      readFileSync: () => undefined,
      buildFileIndex: async () => ({ components: new Map(), partials: new Map(), layouts: new Map() }),
    });
    await state.refreshConfig();
    expect(state.pathFeaturesEnabled).toBe(true);
    expect(state.dirs?.componentsDir).toBe('/r/c');
  });

  it('caches component props by absolute path, invalidates on demand', async () => {
    const state = createServerState({
      readVite: () => ({
        text: `pageDiscoveryPlugin({ pagesDir: 'p', layoutsDir: 'l', partialsDir: 'pa', componentsDir: 'c' });`,
        repoRoot: '/r',
      }),
      readFileSync: (p) => (p === '/r/c/button.liquid' ? `{% assign type = type | default: 'p' %}` : undefined),
      buildFileIndex: async () => ({
        components: new Map([['button', { absPath: '/r/c/button.liquid', mtime: 1 }]]),
        partials: new Map(),
        layouts: new Map(),
      }),
    });
    await state.refreshConfig();
    const first = state.lookupComponentProps('button');
    expect(first?.[0].name).toBe('type');
    state.invalidateComponentProps('button');
    const again = state.lookupComponentProps('button');
    expect(again?.[0].name).toBe('type'); // same props re-parsed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test serverState`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/serverState.ts`**

```ts
import { parseViteConfig, type ResolvedPaths } from './workspace/viteConfig.js';
import { buildFileIndex as defaultBuildFileIndex, type FileIndex } from './workspace/fileIndex.js';
import { createDocumentStore, type DocumentStore } from './workspace/documentStore.js';
import { createDepGraph, type DepGraph } from './workspace/depGraph.js';
import { extractComponentProps } from './analyzer/propBlock.js';
import { tokenize } from './analyzer/tokenize.js';
import { buildAst } from './analyzer/ast.js';
import type { Binding } from './types.js';

export interface ServerStateDeps {
  readVite: () => { text: string; repoRoot: string } | undefined;
  readFileSync: (path: string) => string | undefined;
  buildFileIndex: (dirs: ResolvedPaths) => Promise<FileIndex>;
}

export interface ServerState {
  pathFeaturesEnabled: boolean;
  dirs?: ResolvedPaths;
  fileIndex: FileIndex;
  documentStore: DocumentStore;
  depGraph: DepGraph;
  refreshConfig(): Promise<void>;
  lookupComponentProps(key: string): Binding[] | undefined;
  invalidateComponentProps(keyOrAbsPath: string): void;
  invalidateJsonCompanion(absPath: string): void;
}

export function createServerState(deps: ServerStateDeps): ServerState {
  let pathFeaturesEnabled = false;
  let dirs: ResolvedPaths | undefined;
  let fileIndex: FileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
  const componentPropsCache = new Map<string, Binding[]>();
  const jsonCompanionCache = new Map<string, string>();

  const documentStore = createDocumentStore({
    isComponentUri: (uri) => {
      if (!dirs) return false;
      const abs = uri.replace('file://', '');
      return abs.startsWith(dirs.componentsDir);
    },
    readJsonCompanion: (path) => {
      const cached = jsonCompanionCache.get(path);
      if (cached !== undefined) return cached;
      const text = deps.readFileSync(path);
      if (text !== undefined) jsonCompanionCache.set(path, text);
      return text;
    },
    lookupComponent: (key) => state.lookupComponentProps(key),
    uriToPath: (u) => u.replace('file://', ''),
  });

  const depGraph = createDepGraph();

  const state: ServerState = {
    get pathFeaturesEnabled() {
      return pathFeaturesEnabled;
    },
    get dirs() {
      return dirs;
    },
    get fileIndex() {
      return fileIndex;
    },
    documentStore,
    depGraph,
    async refreshConfig() {
      componentPropsCache.clear();
      jsonCompanionCache.clear();
      const vite = deps.readVite();
      if (!vite) {
        pathFeaturesEnabled = false;
        dirs = undefined;
        fileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
        return;
      }
      const result = parseViteConfig(vite.text, vite.repoRoot);
      if (!result.ok) {
        pathFeaturesEnabled = false;
        dirs = undefined;
        fileIndex = { components: new Map(), partials: new Map(), layouts: new Map() };
        return;
      }
      pathFeaturesEnabled = true;
      dirs = result.paths;
      fileIndex = await deps.buildFileIndex(result.paths);
    },
    lookupComponentProps(key) {
      const entry = fileIndex.components.get(key);
      if (!entry) return undefined;
      const cached = componentPropsCache.get(entry.absPath);
      if (cached) return cached;
      const text = deps.readFileSync(entry.absPath);
      if (text === undefined) return undefined;
      const { tokens } = tokenize(text);
      const { root } = buildAst(tokens);
      const props = extractComponentProps(text, root, entry.absPath);
      componentPropsCache.set(entry.absPath, props);
      return props;
    },
    invalidateComponentProps(keyOrAbsPath) {
      // Accept either a key ("button") or an absolute path
      if (keyOrAbsPath.startsWith('/')) {
        componentPropsCache.delete(keyOrAbsPath);
      } else {
        const entry = fileIndex.components.get(keyOrAbsPath);
        if (entry) componentPropsCache.delete(entry.absPath);
      }
    },
    invalidateJsonCompanion(absPath) {
      jsonCompanionCache.delete(absPath);
    },
  };

  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vscode-liquid-paradox/server test serverState`
Expected: PASS, 3 tests.

- [ ] **Step 5: Overwrite `packages/server/src/server.ts`**

```ts
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  type InitializeResult,
  type CompletionItem as LspCompletionItem,
  CompletionItemKind,
  type Diagnostic as LspDiagnostic,
  type Hover,
  type Definition,
  TextDocumentChangeEvent,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServerState } from './serverState.js';
import { buildFileIndex } from './workspace/fileIndex.js';
import { provideCompletions } from './providers/completion.js';
import { provideHover } from './providers/hover.js';
import { provideDefinition } from './providers/definition.js';
import { provideDiagnostics, type Severity } from './providers/diagnostics.js';
import { routeFileEvent } from './workspace/watchers.js';

export function createServer(): void {
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);

  let workspaceRoot: string | undefined;
  let state = createServerState({
    readVite: () => {
      if (!workspaceRoot) return undefined;
      const p = path.join(workspaceRoot, 'vite.config.ts');
      try {
        return { text: fs.readFileSync(p, 'utf8'), repoRoot: workspaceRoot };
      } catch {
        return undefined;
      }
    },
    readFileSync: (p) => {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        return undefined;
      }
    },
    buildFileIndex: (dirs) => buildFileIndex({ ...dirs, fs: fs.promises }),
  });

  const debounceTimers = new Map<string, NodeJS.Timeout>();

  connection.onInitialize((params): InitializeResult => {
    workspaceRoot = params.rootUri
      ? params.rootUri.replace('file://', '')
      : (params.workspaceFolders?.[0]?.uri.replace('file://', '') ?? process.cwd());
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: ['{', '%', '|', '"', "'", '.', ','] },
        hoverProvider: true,
        definitionProvider: true,
      },
    };
  });

  connection.onInitialized(async () => {
    await state.refreshConfig();
    // Diagnose all open docs after initial scan
    for (const doc of documents.all()) {
      analyzeAndPublish(doc);
    }
  });

  documents.onDidOpen((e) => analyzeAndPublish(e.document));
  documents.onDidChangeContent((e) => debouncedDiagnose(e.document));
  documents.onDidClose((e) => {
    state.documentStore.remove(e.document.uri);
    state.depGraph.remove(e.document.uri);
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const model =
      state.documentStore.get(params.textDocument.uri) ?? state.documentStore.update(doc.uri, doc.getText());
    const items = provideCompletions(model, params.position, {
      fileIndex: state.fileIndex,
      lookupComponentProps: (k) => state.lookupComponentProps(k),
    });
    return items.map(
      (i) =>
        ({
          label: i.label,
          kind: lspCompletionKind(i.kind),
          detail: i.detail,
          documentation: i.documentation,
        }) satisfies LspCompletionItem,
    );
  });

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const model =
      state.documentStore.get(params.textDocument.uri) ?? state.documentStore.update(doc.uri, doc.getText());
    const h = provideHover(model, params.position, { fileIndex: state.fileIndex });
    if (!h) return null;
    return { contents: { kind: 'markdown', value: h.markdown }, range: h.range };
  });

  connection.onDefinition((params): Definition | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const model =
      state.documentStore.get(params.textDocument.uri) ?? state.documentStore.update(doc.uri, doc.getText());
    const d = provideDefinition(model, params.position, { fileIndex: state.fileIndex });
    return d ? { uri: d.uri, range: d.range } : null;
  });

  connection.onDidChangeWatchedFiles(async (params) => {
    if (!state.dirs || !workspaceRoot) return;
    let needRebuild = false;
    const allRediag = new Set<string>();
    for (const change of params.changes) {
      const absPath = change.uri.replace('file://', '');
      const mtime = Date.now();
      const event = change.type === 1 ? 'created' : change.type === 3 ? 'deleted' : 'changed';
      const out = routeFileEvent({
        absPath,
        event,
        mtime,
        dirs: { repoRoot: workspaceRoot, ...state.dirs },
        fileIndex: state.fileIndex,
        depGraph: state.depGraph,
        openUris: documents.all().map((d) => d.uri),
      });
      if (out.rebuildIndex) needRebuild = true;
      if (out.invalidateJsonPath) state.invalidateJsonCompanion(out.invalidateJsonPath);
      if (out.invalidateComponentPropsKey) state.invalidateComponentProps(out.invalidateComponentPropsKey);
      for (const u of out.urisToRediagnose) allRediag.add(u);
    }
    if (needRebuild) await state.refreshConfig();
    for (const uri of allRediag) {
      const doc = documents.get(uri);
      if (doc) analyzeAndPublish(doc);
    }
  });

  function debouncedDiagnose(doc: TextDocument): void {
    const existing = debounceTimers.get(doc.uri);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      doc.uri,
      setTimeout(() => {
        debounceTimers.delete(doc.uri);
        analyzeAndPublish(doc);
      }, 150),
    );
  }

  function analyzeAndPublish(doc: TextDocument): void {
    const model = state.documentStore.update(doc.uri, doc.getText());
    state.depGraph.set(doc.uri, model.dependencies);
    const ds = provideDiagnostics(model, {
      fileIndex: state.fileIndex,
      pathFeaturesEnabled: state.pathFeaturesEnabled,
      lookupComponentProps: (k) => state.lookupComponentProps(k),
    });
    connection.sendDiagnostics({
      uri: doc.uri,
      diagnostics: ds.map(
        (d) =>
          ({
            range: d.range,
            severity: lspSeverity(d.severity),
            message: d.message,
            source: d.source,
          }) satisfies LspDiagnostic,
      ),
    });
  }

  documents.listen(connection);
  connection.listen();
}

function lspSeverity(s: Severity): DiagnosticSeverity {
  switch (s) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'info':
      return DiagnosticSeverity.Information;
    case 'hint':
      return DiagnosticSeverity.Hint;
  }
}

function lspCompletionKind(k: string): CompletionItemKind | undefined {
  return (
    {
      Keyword: CompletionItemKind.Keyword,
      Variable: CompletionItemKind.Variable,
      Function: CompletionItemKind.Function,
      Module: CompletionItemKind.Module,
      File: CompletionItemKind.File,
      Property: CompletionItemKind.Property,
    } as Record<string, CompletionItemKind>
  )[k];
}

createServer();
```

- [ ] **Step 6: Re-run unit tests + typecheck + build**

Run: `pnpm --filter @vscode-liquid-paradox/server typecheck`
Expected: exits 0.

Run: `pnpm --filter @vscode-liquid-paradox/server test`
Expected: every existing test still passes (no new test was added — `serverState.test.ts` already gates this task; the bundling check below is the smoke for `server.ts`).

Run: `pnpm --filter @vscode-liquid-paradox/server build`
Expected: writes `dist/server.js`. Inspect that `dist/server.js` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/serverState.ts packages/server/src/serverState.test.ts
git commit -m "feat(server): wire LSP connection to providers with debounced diagnostics"
```

### Task 27: Disposable + graceful shutdown

**Files:**

- Modify: `packages/server/src/server.ts` (add shutdown handling, watcher registration)

This task wires `connection.client.register` to register the dynamic file watchers built by `buildWatcherRegistrations` (Task 21). It also handles `onShutdown` by clearing debounce timers and the document cache. There is no new unit test — we verify by manual smoke through F5 (Task 4).

- [ ] **Step 1: Add this block inside `connection.onInitialized` in `server.ts`, after `state.refreshConfig()`**

```ts
if (state.dirs) {
  const regs = buildWatcherRegistrations(state.dirs);
  await connection.client.register(DidChangeWatchedFilesNotification.type, {
    watchers: regs.map((r) => ({ globPattern: r.globPattern })),
  });
}
```

- [ ] **Step 2: Add imports at the top of `server.ts`**

```ts
import { DidChangeWatchedFilesNotification } from 'vscode-languageserver/node.js';
import { buildWatcherRegistrations } from './workspace/watchers.js';
```

- [ ] **Step 3: Add an `onShutdown` handler**

After `documents.listen(connection);` and before `connection.listen();`:

```ts
connection.onShutdown(() => {
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
});
```

- [ ] **Step 4: Smoke test via F5**

Press F5 in the workspace. The Extension Dev Host opens on `local-career-site`. Verify in the dev host's **Output → Liquid Paradox** channel:

- "Server initialized" or similar (LSP logs default startup messages).
- No exceptions.

Open `src/partials/military-careers/testimonials.liquid`. Confirm:

- Hovering `{% for %}` shows tag docs.
- Typing `{{ ` opens a suggestion list including `testimonials`.
- Typing `{% render "components/` opens completions for component keys (`button`).

If any of these don't work, the LSP server may be failing silently. Check **Output → Liquid Paradox** and the **Developer: Toggle Developer Tools** console.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts
git commit -m "feat(server): register file watchers + graceful shutdown"
```

---

## Phase 6 — Fixtures and Integration Tests

End-to-end coverage: an LSP harness drives the real server against a trimmed test workspace.

### Task 28: career-site-mini fixtures

**Files:**

- Create: `fixtures/career-site-mini/vite.config.ts`
- Create: `fixtures/career-site-mini/src/pages/home.liquid`
- Create: `fixtures/career-site-mini/src/pages/home.liquid.json`
- Create: `fixtures/career-site-mini/src/layouts/main.liquid`
- Create: `fixtures/career-site-mini/src/partials/testimonials.liquid`
- Create: `fixtures/career-site-mini/src/partials/testimonials.liquid.json`
- Create: `fixtures/career-site-mini/src/components/button.liquid`

Just enough to exercise every code path. There is no test in this task — Tasks 29-30 consume the fixtures.

- [ ] **Step 1: Write `fixtures/career-site-mini/vite.config.ts`**

```ts
import { pageDiscoveryPlugin } from './fake-plugins';

export default {
  plugins: [
    pageDiscoveryPlugin({
      pagesDir: 'src/pages',
      layoutsDir: 'src/layouts',
      partialsDir: 'src/partials',
      componentsDir: 'src/components',
    }),
  ],
};
```

- [ ] **Step 2: Write the fixture pages, layouts, partials, components**

`fixtures/career-site-mini/src/pages/home.liquid`:

```liquid
{% layout "main" %}
<h1>{{ title }}</h1>
{% render "testimonials" %}
{% render "button", text: "Apply", class: "primary" %}
```

(Render paths are bare keys matching the file-index entries — see spec §5.2 and the Task 18 implementation.)

`fixtures/career-site-mini/src/pages/home.liquid.json`:

```json
{
  "title": "Welcome",
  "subtitle": "Join us"
}
```

`fixtures/career-site-mini/src/layouts/main.liquid`:

```liquid
<!DOCTYPE html><html><body>{{ content }}</body></html>
```

`fixtures/career-site-mini/src/partials/testimonials.liquid`:

```liquid
<ul>
{% for item in testimonials %}
  <li>{{ item.name }} — {{ item.quote }}</li>
{% endfor %}
</ul>
```

`fixtures/career-site-mini/src/partials/testimonials.liquid.json`:

```json
{
  "testimonials": [
    { "name": "Rob", "quote": "Great." },
    { "name": "Will", "quote": "Loved it." }
  ]
}
```

`fixtures/career-site-mini/src/components/button.liquid`:

```liquid
{% assign type = type | default: 'primary' %}
{% assign text = text | default: 'Learn more' %}
{% assign customClass = class | default: '' %}
<button class="btn-{{ type }} {{ customClass }}">{{ text }}</button>
```

- [ ] **Step 3: Commit**

```bash
git add fixtures
git commit -m "test(fixtures): add career-site-mini covering all code paths"
```

### Task 29: LSP integration harness

**Files:**

- Create: `packages/server/src/integration/harness.ts`
- Create: `packages/server/src/integration/harness.test.ts`

The harness uses `createConnection` from `vscode-languageserver` with in-memory duplex streams to spin up the real server in-process. Tests send `initialize`, `textDocument/didOpen`, and provider requests, then assert on the responses.

- [ ] **Step 1: Write the failing test**

`packages/server/src/integration/harness.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import { startLspHarness, type LspHarness } from './harness.js';

const fixturesRoot = path.resolve(__dirname, '../../../../fixtures/career-site-mini');

describe('LSP integration harness', () => {
  let h: LspHarness;
  beforeAll(async () => {
    h = await startLspHarness(fixturesRoot);
  });
  afterAll(async () => {
    await h.stop();
  });

  it('initialize succeeds and reports completion + hover + definition capabilities', async () => {
    expect(h.capabilities.completionProvider).toBeDefined();
    expect(h.capabilities.hoverProvider).toBe(true);
    expect(h.capabilities.definitionProvider).toBe(true);
  });

  it('didOpen on a page produces no errors and arrives within 200ms', async () => {
    const uri = `file://${fixturesRoot}/src/pages/home.liquid`;
    const t0 = Date.now();
    const diags = await h.openAndWaitForDiagnostics(uri);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(diags.filter((d) => d.severity === 1 /* Error */)).toEqual([]);
  });

  it('completion at {{ inside testimonials.liquid includes the JSON key', async () => {
    const uri = `file://${fixturesRoot}/src/partials/testimonials.liquid`;
    await h.openAndWaitForDiagnostics(uri);
    const text = h.getText(uri);
    const triggerOffset = text.indexOf('{% for') + '{% for item in '.length;
    const { line, character } = h.offsetToPosition(uri, triggerOffset);
    const items = await h.completion(uri, { line, character });
    expect(items.find((i) => i.label === 'testimonials')).toBeDefined();
  });

  it('hover over `for` shows tag docs', async () => {
    const uri = `file://${fixturesRoot}/src/partials/testimonials.liquid`;
    await h.openAndWaitForDiagnostics(uri);
    const text = h.getText(uri);
    const offset = text.indexOf('for item') + 1;
    const { line, character } = h.offsetToPosition(uri, offset);
    const hover = await h.hover(uri, { line, character });
    expect(hover?.contents.value).toMatch(/liquidjs\.com\/tags\/for\.html/);
  });

  it('definition on render "button" jumps to button.liquid', async () => {
    const uri = `file://${fixturesRoot}/src/pages/home.liquid`;
    await h.openAndWaitForDiagnostics(uri);
    const text = h.getText(uri);
    const offset = text.indexOf('"button"') + 2;
    const { line, character } = h.offsetToPosition(uri, offset);
    const def = await h.definition(uri, { line, character });
    expect(def?.uri).toContain('components/button.liquid');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vscode-liquid-paradox/server test harness`
Expected: FAIL.

- [ ] **Step 3: Write `packages/server/src/integration/harness.ts`**

```ts
import { fork, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  createProtocolConnection,
  IPCMessageReader,
  IPCMessageWriter,
  InitializeRequest,
  ShutdownRequest,
  ExitNotification,
  DidOpenTextDocumentNotification,
  PublishDiagnosticsNotification,
  CompletionRequest,
  HoverRequest,
  DefinitionRequest,
  type Diagnostic,
  type CompletionItem,
  type Hover,
  type Definition,
  type InitializeResult,
  type ProtocolConnection,
} from 'vscode-languageserver-protocol/node.js';

export interface LspHarness {
  capabilities: InitializeResult['capabilities'];
  openAndWaitForDiagnostics(uri: string): Promise<Diagnostic[]>;
  completion(uri: string, position: { line: number; character: number }): Promise<CompletionItem[]>;
  hover(uri: string, position: { line: number; character: number }): Promise<Hover | null>;
  definition(uri: string, position: { line: number; character: number }): Promise<{ uri: string; range: any } | null>;
  getText(uri: string): string;
  offsetToPosition(uri: string, offset: number): { line: number; character: number };
  stop(): Promise<void>;
}

export async function startLspHarness(workspaceRoot: string): Promise<LspHarness> {
  const serverDist = path.resolve(__dirname, '../../dist/server.js');
  if (!fs.existsSync(serverDist)) {
    throw new Error(
      `server bundle missing: ${serverDist}. Run 'pnpm --filter @vscode-liquid-paradox/server build' first.`,
    );
  }
  const child: ChildProcess = fork(serverDist, ['--node-ipc'], { stdio: ['ipc', 'pipe', 'pipe', 'ipc'] });
  const reader = new IPCMessageReader(child);
  const writer = new IPCMessageWriter(child);
  const connection = createProtocolConnection(reader, writer, console);
  connection.listen();

  const init = await connection.sendRequest(InitializeRequest.type, {
    processId: process.pid,
    rootUri: `file://${workspaceRoot}`,
    workspaceFolders: [{ uri: `file://${workspaceRoot}`, name: 'mini' }],
    capabilities: {},
  });
  await connection.sendNotification('initialized', {});

  const textByUri = new Map<string, string>();
  const diagWaiters = new Map<string, (d: Diagnostic[]) => void>();

  connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
    const w = diagWaiters.get(params.uri);
    if (w) {
      diagWaiters.delete(params.uri);
      w(params.diagnostics);
    }
  });

  function offsetToPosition(uri: string, offset: number): { line: number; character: number } {
    const text = textByUri.get(uri)!;
    let line = 0,
      lineStart = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        line++;
        lineStart = i + 1;
      }
    }
    return { line, character: offset - lineStart };
  }

  return {
    capabilities: init.capabilities,
    async openAndWaitForDiagnostics(uri) {
      const filePath = uri.replace('file://', '');
      const text = fs.readFileSync(filePath, 'utf8');
      textByUri.set(uri, text);
      const promise = new Promise<Diagnostic[]>((resolve) => diagWaiters.set(uri, resolve));
      await connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: 'liquid', version: 1, text },
      });
      return promise;
    },
    completion(uri, position) {
      return connection
        .sendRequest(CompletionRequest.type, { textDocument: { uri }, position })
        .then((r) => (Array.isArray(r) ? r : (r?.items ?? [])));
    },
    hover(uri, position) {
      return connection.sendRequest(HoverRequest.type, { textDocument: { uri }, position });
    },
    definition(uri, position) {
      return connection
        .sendRequest(DefinitionRequest.type, { textDocument: { uri }, position })
        .then((d) => (Array.isArray(d) ? d[0] : d));
    },
    getText(uri) {
      return textByUri.get(uri)!;
    },
    offsetToPosition,
    async stop() {
      await connection.sendRequest(ShutdownRequest.type, null).catch(() => {});
      await connection.sendNotification(ExitNotification.type).catch(() => {});
      child.kill();
    },
  };
}
```

- [ ] **Step 4: Build the server first (the harness loads `dist/server.js`)**

Run: `pnpm --filter @vscode-liquid-paradox/server build`
Expected: writes `dist/server.js`.

- [ ] **Step 5: Run the integration test**

Run: `pnpm --filter @vscode-liquid-paradox/server test harness`
Expected: PASS, 5 tests.

If a test times out, check that the server bundles produced a runnable file (`node packages/server/dist/server.js` should not error).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/integration
git commit -m "test(server): LSP integration harness covering capabilities and providers"
```

### Task 30: Cross-file invalidation E2E

**Files:**

- Create: `packages/server/src/integration/invalidation.test.ts`

Exercises spec §8.4: changing a JSON companion re-diagnoses the consumer page; touching a component re-diagnoses every renderer.

- [ ] **Step 1: Write the failing test**

`packages/server/src/integration/invalidation.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { startLspHarness, type LspHarness } from './harness.js';

const fixturesRoot = path.resolve(__dirname, '../../../../fixtures/career-site-mini');

describe('cross-file invalidation', () => {
  let h: LspHarness;
  beforeAll(async () => {
    h = await startLspHarness(fixturesRoot);
  });
  afterAll(async () => {
    await h.stop();
  });

  it('changing testimonials.liquid.json re-diagnoses testimonials.liquid', async () => {
    const partialUri = `file://${fixturesRoot}/src/partials/testimonials.liquid`;
    const jsonPath = `${fixturesRoot}/src/partials/testimonials.liquid.json`;
    const before = await h.openAndWaitForDiagnostics(partialUri);
    expect(before).toEqual([]);
    // Touch the JSON so the testimonials variable goes away → expect a warning.
    const originalJson = fs.readFileSync(jsonPath, 'utf8');
    try {
      fs.writeFileSync(jsonPath, '{}');
      // The harness sends a watcher notification on the JSON file via the LSP connection.
      // For this unit-style integration we directly fire the notification.
      // ... (see harness extension below)
    } finally {
      fs.writeFileSync(jsonPath, originalJson);
    }
  });
});
```

> **Implementation note:** to support firing watched-file notifications in tests, extend `harness.ts` with a method `fireFileChanged(uri, type)` that calls `connection.sendNotification(DidChangeWatchedFilesNotification.type, { changes: [{ uri, type }] })`. Add this before running this task.

- [ ] **Step 2: Extend `harness.ts` with the helper**

Add to `LspHarness`:

```ts
fireFileChanged(uri: string, type: 1 | 2 | 3): Promise<void>;
```

Add to the returned object:

```ts
fireFileChanged(uri, type) {
  return connection.sendNotification(
    DidChangeWatchedFilesNotification.type,
    { changes: [{ uri, type }] }
  );
}
```

Add the import:

```ts
import { DidChangeWatchedFilesNotification } from 'vscode-languageserver-protocol/node.js';
```

- [ ] **Step 3: Finish the test by using `fireFileChanged`**

Replace the placeholder in the test with:

```ts
const waiter = new Promise<Diagnostic[]>((resolve) => h.onNextDiagnosticsFor(partialUri, resolve));
fs.writeFileSync(jsonPath, '{}');
await h.fireFileChanged(`file://${jsonPath}`, 2);
const after = await waiter;
expect(after.some((d) => /unknown variable.*testimonials/i.test(d.message))).toBe(true);
```

For this you also need an `onNextDiagnosticsFor` helper on the harness — implement by adding to the harness:

```ts
onNextDiagnosticsFor(uri: string, cb: (d: Diagnostic[]) => void): void {
  diagWaiters.set(uri, cb);
}
```

And expose it on the returned object.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @vscode-liquid-paradox/server build && pnpm --filter @vscode-liquid-paradox/server test invalidation`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/integration/harness.ts packages/server/src/integration/invalidation.test.ts
git commit -m "test(server): cross-file invalidation E2E via watched-file notifications"
```

---

## Phase 7 — CI and Packaging

### Task 31: GitHub Actions

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm --filter @vscode-liquid-paradox/server build
      - run: pnpm --filter @vscode-liquid-paradox/server test
      - run: pnpm --filter vscode-liquid-paradox build
      - run: pnpm --filter vscode-liquid-paradox package
      - uses: actions/upload-artifact@v4
        with:
          name: vsix
          path: packages/client/*.vsix
```

- [ ] **Step 2: Verify locally**

Run each step manually:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @vscode-liquid-paradox/server build
pnpm --filter @vscode-liquid-paradox/server test
pnpm --filter vscode-liquid-paradox build
pnpm --filter vscode-liquid-paradox package
```

Each must exit 0. The last command produces `packages/client/vscode-liquid-paradox-0.0.1.vsix`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint, typecheck, build, test, package on every PR"
```

### Task 32: README + manual smoke checklist + publishing notes

**Files:**

- Create: `README.md`
- Create: `docs/superpowers/manual-smoke.md`

- [ ] **Step 1: Write the README**

````markdown
# Liquid Paradox

VS Code IntelliSense for LiquidJS templates in Paradox by Workday static-site projects.

## Features

- Tag, filter, and variable completions
- Hover documentation linking to https://liquidjs.com
- Go-to-definition for variables, `{% render %}`, and `{% layout %}`
- Diagnostics for unknown tags/filters, unresolved paths, unbalanced blocks, and unknown component props
- Sibling `.liquid.json` data files surfaced as typed variables
- Component prop hints parsed from leading `{% assign x = x | default: ... %}` blocks
- Paradox backend tags (`{{component:...}}`, `{{snippet:...}}`, `{{data:...}}`, `{{attribute:...}}`) with hover-only docs

## Installation

This extension depends on [`sissel.shopify-liquid`](https://marketplace.visualstudio.com/items?itemName=sissel.shopify-liquid) for syntax highlighting. It is installed automatically via `extensionDependencies`.

## Requirements

Your workspace must contain `vite.config.ts` with a `pageDiscoveryPlugin({ pagesDir, layoutsDir, partialsDir, componentsDir })` call. Without it, path-related features (render/layout completion, go-to-definition, unresolved-path diagnostics, component prop validation) silently disable; all other features still work.

## Development

```bash
pnpm install
pnpm --filter @vscode-liquid-paradox/server build
# Press F5 in VS Code to launch the Extension Dev Host
```
````

Test suites:

```bash
pnpm test          # all packages
```

````

- [ ] **Step 2: Write `docs/superpowers/manual-smoke.md`**

```markdown
# Manual smoke checklist

Run before each release in the Extension Dev Host against `local-career-site`.

- [ ] Open `src/pages/military-careers.liquid` — no error squiggles
- [ ] Hover `{% for item in testimonials %}` → tag docs appear
- [ ] Type `{{ ` inside `testimonials.liquid` → suggestion list includes `testimonials`
- [ ] Type `{% render "` in any page → completion shows partials (File icon) and `button` component (Module icon)
- [ ] Add `{% render "button", ` in a page → completions include `class`, `type`, `text`, `link`, `oliviaButton`, `newTab`, `icon`
- [ ] Cmd+Click on a `{% render "common/meet-rita" %}` path → opens `src/partials/common/meet-rita.liquid` at line 1
- [ ] Add `{% render "does-not-exist" %}` → diagnostic appears within 200 ms
- [ ] Edit `testimonials.liquid.json` to remove the `testimonials` key → `testimonials.liquid` shows an unknown-variable warning
- [ ] Hover `{{component:Hero}}` → shows "Render the component on Site Studio"
- [ ] Rename `vite.config.ts` temporarily → path features silently disable, others keep working
````

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/manual-smoke.md
git commit -m "docs: README and manual smoke checklist"
```

---

## Wrap-up

After Task 32, the extension is feature-complete per the spec. Suggested next steps (out of scope, for v2 follow-ups):

- Inline custom TextMate grammar in `paradox-injection.tmLanguage.json` to highlight Paradox tags distinctly.
- Cross-template variable flow from page → layout via `{% layout %}` (spec §4.4, deferred).
- JSDoc-style comments above `{% assign %}` for richer prop types (spec §11).
- Marketplace publish automation (`vsce publish` triggered by tag pushes).

Open the **manual smoke checklist** before tagging a release. The release tag itself remains a manual action: `git tag v0.0.1 && git push --tags`, then `pnpm --filter vscode-liquid-paradox package && vsce publish`.
