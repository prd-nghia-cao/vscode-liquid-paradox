# vscode-liquid-paradox — Design Spec

**Date:** 2026-05-13
**Status:** Approved for implementation planning
**Target consumer:** [local-career-site](../../../../local-career-site) and similar LiquidJS + Paradox static-site projects

## 1. Goal

Build a VS Code extension that provides full IntelliSense for `.liquid` files in LiquidJS-based static-site projects that target the Paradox by Workday platform. The extension covers the standard LiquidJS surface plus the project-specific conventions used in this codebase: sibling `.liquid.json` data files, `pageDiscoveryPlugin` directory structure, the `assign-default` component-prop pattern, and Paradox backend tags.

## 2. Non-goals

The following are explicitly out of scope for v1 and must not be added without a follow-up design:

- Embedded Liquid in HTML / JS / TS files — `.liquid` files only.
- Formatting (Prettier integration / format-on-save).
- Snippet contributions.
- Rename refactoring, code actions, quick fixes.
- Semantic-tokens highlighting (placeholder reserved; not implemented).
- Multi-root workspace ergonomics beyond what falls out of LSP defaults.
- Marketplace publishing automation.
- Type-checking filter argument types.
- Diagnostic for "missing required component prop" — the assign-default pattern has no required/optional distinction in v1.

## 3. Feature inventory

### 3.1 Completions

| Trigger context                                                         | Suggestions                                                                                                                                                                                                                                                                                                              | VS Code icon / detail                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| After `{%` or `{%-`                                                     | All LiquidJS tags including closing forms (`if`, `endif`, `for`, `endfor`, `assign`, `capture`, `endcapture`, `render`, `layout`, `include`, `case`, `when`, `endcase`, `unless`, `endunless`, `tablerow`, `endtablerow`, `cycle`, `increment`, `decrement`, `raw`, `endraw`, `comment`, `endcomment`, `liquid`, `echo`) | `Keyword`; detail = "tag"                                                                                             |
| After `{{` or inside `{% echo `, `{% assign x = `, etc.                 | Variables in scope (see §4)                                                                                                                                                                                                                                                                                              | `Variable`; detail = origin (`.liquid.json` key / loop var / assign / capture / prop / built-in)                      |
| After `\|` inside any expression                                        | All 40+ LiquidJS filters (math, string, html/uri, array, date, misc, base64, crypto categories)                                                                                                                                                                                                                          | `Function`; detail = signature like `date(format)`                                                                    |
| Inside `{% render "..." %}` path string                                 | `.liquid` files under `componentsDir` and `partialsDir` (recursive)                                                                                                                                                                                                                                                      | `Symbol.Module` for components, `Symbol.File` for partials; label = path relative to root dir, no `.liquid` extension |
| Inside `{% layout "..." %}` path string                                 | `.liquid` files under `layoutsDir` (recursive)                                                                                                                                                                                                                                                                           | `Symbol.File`; label = path relative to layouts dir, no `.liquid` extension                                           |
| After `{% render "components/X", ` (and after each `,` in the arg list) | Props parsed from `X.liquid`'s leading assign-default block                                                                                                                                                                                                                                                              | `Property`; detail = inferred type + default value                                                                    |
| After `{% render "partials/X", `                                        | **No prop completion** — partials have no declared prop interface; the caller may pass any kwargs                                                                                                                                                                                                                        | (no suggestions)                                                                                                      |

### 3.2 Hover

| Cursor over                    | Tooltip content                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| A tag name                     | Description + syntax example + link to https://liquidjs.com/tags/{name}.html                   |
| A filter name                  | Description + signature + example + link to https://liquidjs.com/filters/{name}.html           |
| A variable identifier          | Origin + inferred type. Example: `` `testimonials` — array, from `testimonials.liquid.json` `` |
| `{{component:...}}`            | "Render the component on Site Studio"                                                          |
| `{{snippet:...}}`              | "Render the snippet on Site Studio"                                                            |
| `{{data:...}}`                 | "Render the data for Site Studio"                                                              |
| `{{attribute:...}}`            | "Render the data for Site Studio"                                                              |
| `{% render "X" %}` path string | Resolved absolute path; markdown link to open                                                  |
| `{% layout "X" %}` path string | Resolved absolute path; markdown link to open                                                  |

### 3.3 Go-to-definition

| On                                          | Jumps to                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Variable identifier (JSON origin)           | Exact line/column of the key in the paired `.liquid.json`                                                          |
| Variable identifier (local origin)          | The `{% assign %}` / `{% capture %}` / `{% for %}` line that introduced it                                         |
| Variable identifier (component prop origin) | The `{% assign %}` line in the component file that declares the prop (when called from within a component context) |
| `{% render "X" %}` path                     | Target `.liquid` file (cursor at line 1)                                                                           |
| `{% layout "X" %}` path                     | Target layout `.liquid` file                                                                                       |
| Component prop name inside render args      | The `{% assign %}` line in the component file that declares it                                                     |

### 3.4 Diagnostics

| Rule                                                                                                                    | Severity | Source of truth                    |
| ----------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------- |
| Unknown tag                                                                                                             | Error    | Built-in tag table                 |
| Unknown filter                                                                                                          | Error    | Built-in filter table              |
| Unresolved `render` path                                                                                                | Error    | File index (components + partials) |
| Unresolved `layout` path                                                                                                | Error    | File index (layouts)               |
| Unbalanced tag (missing `endif`, `endfor`, `endcase`, `endcapture`, `endunless`, `endraw`, `endcomment`, `endtablerow`) | Error    | AST walk                           |
| Mismatched delimiters (e.g. unclosed `{{` or `{%`)                                                                      | Error    | Tokenizer error                    |
| Variable not in scope (not in any of the four origins)                                                                  | Warning  | Scope analyzer (§4)                |
| Unknown prop in `{% render "components/X", foo: ... %}`                                                                 | Warning  | Component prop block (§4.3)        |

## 4. Variable scope model

Every variable visible at a cursor position has exactly one origin. The analyzer maintains a scope stack while walking the AST and tags each identifier with its origin. A variable reference fires the "unknown variable" warning only when **none** of the four origins contain it.

### 4.1 Origin 1 — Sibling `.liquid.json` (pages and partials)

For `path/to/X.liquid`, the analyzer reads `path/to/X.liquid.json` if it exists. Top-level JSON keys become top-level variables in the template's root scope. Nested structure is preserved as a JSON-Schema-like type tree:

```jsonc
// testimonials.liquid.json
{ "testimonials": [{ "type": "quote", "quote": "...", "name": "..." }] }
```

The scope contains `testimonials: Array<{ type: string, quote: string, name: string }>`. This drives:

- Property-access completions: typing `item.` inside `{% for item in testimonials %}` suggests `type`, `quote`, `name`.
- Type-aware hover.
- Go-to-definition of the variable identifier to the JSON key.

**Type inference rules** for JSON values:

- Primitive leaf → its JS runtime type (`string`, `number`, `boolean`, `null`).
- Object → record with each key's inferred type.
- Array → element type = recursive merge of all element types, with keys present in only some elements marked optional. **Empty array** → element type `unknown` (suppresses property-access completions for the loop variable; no diagnostic).
- Mixed primitive/object arrays → union type.

Components and layouts have no `.liquid.json` companion — this origin is empty for those file types. **Layout files** see only built-ins (`content`) plus their own local declarations; variables from the calling page do **not** flow into the layout's scope in v1. Cross-template variable flow analysis is a v2 concern.

### 4.2 Origin 2 — Local declarations (every file)

The AST walker pushes new bindings onto the current scope when it encounters:

| Construct                                  | Binding                | Type                                                                                          |
| ------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------- |
| `{% assign name = expr %}`                 | `name`                 | Inferred from RHS expression                                                                  |
| `{% capture name %}...{% endcapture %}`    | `name`                 | `string`                                                                                      |
| `{% for x in collection %}...{% endfor %}` | `x` and `forloop`      | `x` = element type of `collection`; `forloop` = `{ index, index0, first, last, length, ... }` |
| `{% tablerow x in collection %}`           | `x` and `tablerowloop` | Same shape as `for` + `tablerowloop`                                                          |
| `{% increment x %}` / `{% decrement x %}`  | `x`                    | `number`                                                                                      |

Closing tags pop the scope. Inner declarations shadow outer ones for the duration of their block. RHS expression typing traces filter outputs via a small return-type table (e.g. `upcase` → `string`, `size` → `number`); unknown filter chains yield `unknown` (no diagnostic fires — only the "unknown variable" rule does).

### 4.3 Origin 3 — Component props (components/\*.liquid only)

For files under `componentsDir`, the analyzer extracts props from the leading `{% assign %}` block by walking top-level AST nodes until it hits a non-`assign` node. Each `{% assign LHS = RHS | default: DEFAULT %}` where **RHS is a bare identifier** is a prop:

- Prop name = `RHS` (the value read from the caller's scope)
- Inferred type = literal type of `DEFAULT`
- Default value = `DEFAULT` (used in completion detail and hover)

`LHS` is just the in-file alias. Example from `components/button.liquid`:

```liquid
{% assign customClass = class | default: '' %}
```

→ exposes prop `class: string` (alias `customClass` inside the file, but callers pass `class:`). Assigns that don't fit the pattern are not surfaced as props (they're treated as ordinary local computations).

### 4.4 Origin 4 — Built-in globals

Always in scope: `forloop` (inside `for`), `tablerowloop` (inside `tablerow`), `content` (inside layout files). No other globals in v1.

## 5. Path resolution & vite-config integration

### 5.1 Reading `vite.config.ts`

On server startup the server looks for `vite.config.ts` at the workspace root. It parses the file using the **TypeScript Compiler API** (`ts.createSourceFile`) — never executes it. It walks the AST for a `CallExpression` whose callee identifier is `pageDiscoveryPlugin` and extracts the four string-literal options:

```ts
pageDiscoveryPlugin({
  pagesDir: 'src/pages',
  layoutsDir: 'src/layouts',
  partialsDir: 'src/partials',
  componentsDir: 'src/components',
  // ...
});
```

Paths are resolved relative to the workspace root.

**Silent disable.** If `vite.config.ts` is missing, fails to parse, or contains no `pageDiscoveryPlugin` call with these four options, the server logs a debug message and disables the following features only:

- `render`/`layout` path completions.
- `render`/`layout` go-to-definition.
- Unresolved-path diagnostics.
- Component prop completions and the unknown-prop diagnostic (since component lookup depends on `componentsDir`).

All other features (tag/filter completion, variable analysis, hover, sibling `.liquid.json` lookup) continue working.

A `FileSystemWatcher` on `vite.config.ts` re-runs extraction on save; if any path changes, the file index is rebuilt from scratch.

### 5.2 The file index

Three in-memory maps, populated by recursive directory scans on startup:

```ts
type FileIndex = {
  components: Map<string, ComponentEntry>; // key: "button" or "forms/input"
  partials: Map<string, PartialEntry>; // key: "layout/header"
  layouts: Map<string, LayoutEntry>; // key: "layout" or "job-details-layout"
};
```

Keys are paths **relative to their root dir, with the `.liquid` extension stripped** — matching the format users write in `render` and `layout` string arguments.

Each entry stores `{ absPath, mtime, props? }` (`props` lazily populated on first need for components, undefined for the other two). Watchers handle file create/rename/delete by updating the relevant map without a full rescan.

### 5.3 Path resolution

For `{% render "X" %}`:

1. Look up `X` in **both** the `components` and `partials` maps.
2. If found in either, success. (If found in both — which shouldn't happen because root dirs don't overlap — components win.)
3. Otherwise emit `Unresolved render path: "X"` diagnostic at the string literal's range.

For `{% layout "X" %}`:

1. Look up `X` in the `layouts` map.
2. If not found, emit `Unresolved layout path: "X"` diagnostic.

Path completions inside the string filter the relevant map's keys against the user's typed prefix; component vs partial entries get distinct icons (`Symbol.Module` vs `Symbol.File`).

## 6. Paradox backend tags

### 6.1 Detection

Paradox tags look like `{{component:Hero}}`, `{{snippet:abc-123}}`, `{{data:job.title}}`, `{{attribute:className}}` — output braces containing a `kind:value` pair separated by a colon (invalid syntax in standard LiquidJS expressions).

The analyzer runs a pre-pass over each output node's raw text with this regex:

```
^\s*(component|snippet|data|attribute)\s*:\s*([^}\s]+)\s*$
```

A match flags the node as a Paradox tag with `{ kind, value, range }`. Standard variable analysis is **skipped** for that node so we don't get spurious "unknown variable" warnings.

### 6.2 Hover content

Static lookup, exact wording per spec:

| Kind        | Hover content                         |
| ----------- | ------------------------------------- |
| `component` | "Render the component on Site Studio" |
| `snippet`   | "Render the snippet on Site Studio"   |
| `data`      | "Render the data for Site Studio"     |
| `attribute` | "Render the data for Site Studio"     |

Rendered as a single-line markdown block.

### 6.3 No other features

No completions, no diagnostics (other than the implicit one of the surrounding output being well-formed), no go-to-definition. Inside a Paradox tag the variable / filter completion handlers return empty results — they detect the surrounding node was flagged by the pre-pass.

## 7. Syntax highlighting

The client `package.json` declares the `liquid` language ID but **does not contribute a TextMate grammar** in v1.

**Recommended companion:** [`sissel.shopify-liquid`](https://marketplace.visualstudio.com/items?itemName=sissel.shopify-liquid) — grammar-only, no competing diagnostics. The marketplace listing instructs users to install it alongside.

**Reserved customization slot:** `client/syntaxes/paradox-injection.tmLanguage.json` exists as an empty placeholder, wired up via:

```json
"contributes": {
  "grammars": [{
    "scopeName": "paradox.injection",
    "path": "./syntaxes/paradox-injection.tmLanguage.json",
    "injectTo": ["text.html.liquid"]
  }]
}
```

v1 ships the file empty (no scopes added). v2+ can fill it in to recolor Paradox tags or other custom decorations, with no breaking change for users.

## 8. Lifecycle, caching & file watching

### 8.1 Document lifecycle

| LSP event                | Action                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `textDocument/didOpen`   | Parse, build semantic model, push diagnostics. Cache by URI.                                 |
| `textDocument/didChange` | Re-parse the changed buffer; re-emit diagnostics through a **150 ms debounce** keyed by URI. |
| `textDocument/didSave`   | If the file is under `componentsDir`, refresh prop cache and re-diagnose dependents.         |
| `textDocument/didClose`  | Drop the cached document model; file-index entry remains.                                    |

### 8.2 Caches

| Cache                | Key                                  | Value                                             | Invalidated by                                                     |
| -------------------- | ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------ |
| Document model       | URI                                  | `{ ast, scopes, paradoxTags, diagnostics, deps }` | `didChange` for that URI                                           |
| JSON schema          | absolute `.liquid.json` path + mtime | type tree                                         | `.liquid.json` file change on disk                                 |
| Component prop block | absolute component path + mtime      | `Prop[]`                                          | Component file change on disk                                      |
| File index           | (global singleton)                   | three maps from §5.2                              | File create/rename/delete in indexed dirs; `vite.config.ts` change |
| Vite config          | (global singleton)                   | four resolved paths                               | `vite.config.ts` change                                            |

All caches use mtime-keyed entries so stale hits are impossible.

### 8.3 File watchers

Three watchers registered through LSP `client/registerCapability`:

1. **`vite.config.ts`** — re-extract config; if any path changed, rebuild the file index.
2. **`**/\*.liquid`** scoped to the three indexed dirs — update the corresponding file-index map. If a component changes, invalidate its prop cache and re-diagnose every open document that calls `{% render "components/X" %}`.
3. **`**/\*.liquid.json`** scoped to `pagesDir`and`partialsDir`— invalidate the JSON schema cache for that path. If the paired`.liquid` is open, re-diagnose it.

### 8.4 Cross-file invalidation

Each parsed document records its dependency set:

```ts
type Dependencies = {
  jsonCompanion?: string; // sibling .liquid.json
  renderedFiles: string[]; // every {% render "..." %} target
  layoutFile?: string; // {% layout "..." %} target
};
```

The server maintains an inverse map (`who depends on me?`). When a watched file changes, every consumer is re-diagnosed. No full workspace rescan is ever triggered after startup.

### 8.5 Initial workspace scan

On `initialize`:

1. Read `vite.config.ts` → resolve four directory paths (or silently disable path features).
2. Glob `**/*.liquid` under the three indexed dirs and record absolute paths + mtimes (no parsing yet).
3. Component prop blocks are parsed **lazily** on first need.

Target: under 1 s for a workspace with a few hundred templates.

### 8.6 Debouncing & cancellation

Diagnostic pushes go through a per-URI 150 ms debouncer. Completion / hover / definition requests honor LSP cancellation tokens — in-flight requests abort if the user keeps typing.

## 9. Repo layout & tooling

```
vscode-liquid-paradox/
├── package.json                       # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── client/                        # VS Code extension (thin)
│   │   ├── package.json
│   │   ├── src/extension.ts           # boots LSP server
│   │   ├── syntaxes/
│   │   │   └── paradox-injection.tmLanguage.json   # empty placeholder
│   │   └── tsconfig.json
│   └── server/                        # Language server (all logic)
│       ├── package.json
│       ├── src/
│       │   ├── server.ts              # LSP entry, connection init
│       │   ├── analyzer/              # tokenize, AST, scope, jsonSchema, propBlock
│       │   ├── providers/             # completion, hover, definition, diagnostics
│       │   ├── workspace/             # viteConfig, fileIndex, watchers
│       │   └── data/                  # built-in tag/filter/paradox metadata
│       └── tsconfig.json
├── fixtures/career-site-mini/         # trimmed copy for tests
├── docs/superpowers/specs/            # this document, plus future specs
└── .vscode/launch.json                # F5 launches Extension Dev Host
```

**Conventions:**

- TypeScript strict mode across both packages.
- esbuild bundles each package separately (no webpack).
- Vitest for unit + integration tests.
- `vsce package` builds the `.vsix`.
- `server/` imports zero `vscode` API code (keeps it editor-agnostic).

**Production dependencies (server):**

- `liquidjs` — `Tokenizer`, `Parser`, `analyze`, `Token`, `TagToken`
- `vscode-languageserver`
- `vscode-languageserver-textdocument`
- `typescript` — used as a library (`ts.createSourceFile`) to parse `vite.config.ts`

**Production dependencies (client):**

- `vscode-languageclient`

## 10. Testing strategy

### 10.1 Layer 1 — Unit tests (Vitest, server only)

Pure-functional analyzer pieces in isolation with `memfs` for filesystem. Modules and representative tests:

| Module                     | Test cases                                                       |
| -------------------------- | ---------------------------------------------------------------- |
| `analyzer/tokenize.ts`     | Standard tags, Paradox tags, nested expressions, malformed input |
| `analyzer/scope.ts`        | `assign`/`capture`/`for` push/pop, shadowing, `forloop` exposure |
| `analyzer/jsonSchema.ts`   | Primitives, nested objects, uniform vs mixed arrays, null leaves |
| `analyzer/propBlock.ts`    | LHS=RHS pattern, LHS≠RHS alias, non-prop assigns skipped         |
| `workspace/viteConfig.ts`  | Happy path, missing file, malformed TS, missing plugin call      |
| `providers/completion.ts`  | Each trigger context returns expected items                      |
| `providers/diagnostics.ts` | Each rule fires (and only fires) on its specific input           |

Coverage target: 90% line coverage on `analyzer/` and `providers/`.

### 10.2 Layer 2 — LSP integration tests

In-memory client+server pair using the `vscode-languageserver-protocol` test harness. Each provider gets a happy-path and an edge-case test:

- `textDocument/completion` at known cursor positions
- `textDocument/hover` over tag / filter / variable / Paradox tag
- `textDocument/definition` for each origin
- `textDocument/publishDiagnostics` arrives within 200 ms of `didChange`
- Simulated `workspace/didChangeWatchedFiles` invalidates the right caches

### 10.3 Layer 3 — Fixture-based end-to-end tests

`fixtures/career-site-mini/` holds a trimmed-down copy of representative templates (one page, one layout, one partial with `.liquid.json`, one component with the assign-default prop pattern, plus a stub `vite.config.ts`). Tests open these in the LSP harness and assert real-world behavior:

- Hovering `{{ item.name }}` inside `{% for item in testimonials %}` shows the type inferred from `testimonials.liquid.json`.
- Cmd+Click on `{% render "components/button" %}` resolves to the fixture's `button.liquid`.
- Typing `, ` after `{% render "components/button"` suggests `class`, `type`, `text`, `link`, `oliviaButton`, `newTab`, `icon`.
- An unresolved `{% render "components/does-not-exist" %}` raises a diagnostic.

### 10.4 Manual smoke checklist

Before each release, run a 5-minute checklist in the Extension Dev Host against the real `local-career-site` repo. Checklist lives in `docs/superpowers/manual-smoke.md` (created in implementation).

### 10.5 CI

GitHub Actions per PR:

- Lint (Prettier, ESLint)
- Typecheck (both packages)
- Unit tests
- Integration tests
- `vsce package` (verifies the `.vsix` builds)

No automated publishing in v1 — `vsce publish` is run manually until the extension is mature.

## 11. Open questions deferred to implementation

These were noted during design but require code-level investigation:

- Exact LiquidJS API for tokenizing without throwing on partial input (the analyzer needs to handle templates that are syntactically invalid during typing). May require wrapping `Tokenizer` calls in try/catch and falling back to a tolerant lexer for the broken segment.
- Whether `analyze` from LiquidJS gives us the AST shape we need, or whether we need to walk tokens manually.
- Whether the `assign-default` pattern detection should also recognize JSDoc-style comments above the assign for richer types (deferred to v2 explicitly).
