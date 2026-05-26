# Liquid Paradox

VS Code IntelliSense for LiquidJS templates in Paradox by Workday static-site projects.

## Features

- Tag-name completions inside `{% … %}` (immediately after typing `{%`, `{%-`, or any partial tag name)
- Variable, built-in literal, and pipe-sentinel completions inside `{{ … }}`
- Filter completions after `|` (with or without surrounding whitespace)
- Per-tag continuation keywords (`{% for x in `, `{% render … with `, `{% if x ` + operators, …)
- Paradox-kind completions inside `{{component:…}}`, `{{snippet:…}}`, `{{data:…}}`, `{{attribute:…}}` — type `{{co` to see the four kinds
- Component / partial / layout path completions inside `{% render "" %}`, `{% include "" %}`, `{% layout "" %}`
- Component prop completions after `{% render "name", `
- Hover documentation linking to https://liquidjs.com
- Go-to-definition for variables, `{% render %}`, and `{% layout %}`
- Diagnostics for unknown tags/filters, unresolved paths, unbalanced blocks, and unknown component props
- Sibling `.liquid.json` data files surfaced as typed variables
- Paradox backend tags (`{{component:...}}`, `{{snippet:...}}`, `{{data:...}}`, `{{attribute:...}}`) with hover-only docs
- Emmet abbreviation expansion enabled out of the box inside HTML regions of `.liquid` files (`ul>li*3`, `.btn--primary`, BEM, etc.). Emmet stays silent inside `{% … %}` and `{{ … }}` so LSP completions remain authoritative. To opt out, add `"emmet.excludeLanguages": ["liquid"]` to your `settings.json`.

See `docs/completion-surfaces.md` for the full matrix of completion regions and what each one offers.

## Installation

Syntax highlighting works out of the box — the extension ships its own HTML + Liquid TextMate grammar and language configuration, so no companion extension is required. [`sissel.shopify-liquid`](https://marketplace.visualstudio.com/items?itemName=sissel.shopify-liquid) is optional and remains compatible if you already have it installed; the Paradox-tag injection grammar layers cleanly on top of either base grammar.

## Requirements

Your workspace must contain `vite.config.ts` with a `pageDiscoveryPlugin({ pagesDir, layoutsDir, partialsDir, componentsDir })` call. Without it, path-related features (render/layout completion, go-to-definition, unresolved-path diagnostics, component prop validation) silently disable; all other features still work.

## Development

```bash
pnpm install
pnpm --filter @vscode-liquid-paradox/server build
# Press F5 in VS Code to launch the Extension Dev Host
```

Test suites:

```bash
pnpm test          # all packages
```

## Architecture

Two-package pnpm monorepo:
- `packages/client` - VS Code extension that spawns the language server
- `packages/server` - Node LSP server with all analysis logic (no `vscode` API imports)

The server uses the `liquidjs` tokenizer for parsing and the TypeScript Compiler API for reading `vite.config.ts`.
