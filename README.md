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

Test suites:

```bash
pnpm test          # all packages
```

## Architecture

Two-package pnpm monorepo:
- `packages/client` - VS Code extension that spawns the language server
- `packages/server` - Node LSP server with all analysis logic (no `vscode` API imports)

The server uses the `liquidjs` tokenizer for parsing and the TypeScript Compiler API for reading `vite.config.ts`.
