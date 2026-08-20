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
- Static-asset completions inside media attribute values. Typing in `src`, `srcset`, or `poster` offers the image, video, and audio files found under the site's asset directory, as root-relative URLs (`src/assets/img/team.webp` → `/img/team.webp`), filtered to what the element accepts:

  | Element / attribute                   | Offers                   |
  | ------------------------------------- | ------------------------ |
  | `<img src>`, `<img srcset>`           | images                   |
  | any `poster`                          | images                   |
  | `<video src>`                         | videos                   |
  | `<audio src>`                         | audio + video containers |
  | `<source src\|srcset>` in `<picture>` | images                   |
  | `<source src\|srcset>` in `<video>`   | videos                   |
  | `<source src\|srcset>` in `<audio>`   | audio + video containers |
  | `<source src\|srcset>` elsewhere      | everything               |

  Accepting an item replaces the URL under the cursor, so retyping a path narrows in place; in a `srcset` list only the current candidate's URL is replaced, leaving `, 2x` descriptors intact. Assets are re-indexed as files are added, changed, or removed.

- The same asset completions inside `.liquid.json` sidecars, for keys that hold a media URL. A key qualifies when its leaf is `src` or ends in `Src`/`_src`; the offered kinds come from the leaf's own prefix (`videoSrc`, `thumbnailSrc`, `heroImageSrc`) or, for a bare `src`, from the nearest ancestor object key, skipping array indices:

  | Key                                                | Offers     |
  | -------------------------------------------------- | ---------- |
  | `image.src`, `thumbnailSrc`, `roles[].heroImg.src` | images     |
  | `video.src`, `videoSrc`, `heroVideo.src`           | videos     |
  | `videoThumbnailSrc` (last word wins)               | images     |
  | `awards[].src`, `phoneApp.src` (kind not implied)  | everything |
  | `alt`, `title`, `videoUrl` (not a media source)    | nothing    |

  Sidecars are parsed error-tolerantly, so a half-typed value still offers completions. They are never run through the Liquid analyzer, so opening one produces no Liquid diagnostics.

- HTML IntelliSense inside HTML regions of `.liquid` files: tag-name completions (after `<`), attribute-name and attribute-value completions, and HTML element/attribute hover docs. These are served by an embedded HTML language service and stay silent inside `{% … %}`, `{{ … }}`, `{# … #}`, and `{% comment %}` regions, where the Liquid LSP remains authoritative. The extension deliberately does not edit your buffer as you type: no auto-closing tags, no tag-pair linked editing, and no Emmet. Turn on VS Code's built-in `"html.autoClosingTags"`, `"editor.linkedEditing"`, or `"emmet.includeLanguages": { "liquid": "html" }` yourself if you want them.

## Installation

The extension is distributed as a `.vsix`. Build and install it with:

```bash
pnpm install
pnpm build
pnpm --filter vscode-liquid-paradox package
code --install-extension packages/client/vscode-liquid-paradox-<version>.vsix --force
```

Reload the window afterwards so the language server restarts from the new bundle.

Syntax highlighting works out of the box — the extension ships its own HTML + Liquid TextMate grammar and language configuration, so no companion extension is required. [`sissel.shopify-liquid`](https://marketplace.visualstudio.com/items?itemName=sissel.shopify-liquid) is optional and remains compatible if you already have it installed; the Paradox-tag injection grammar layers cleanly on top of either base grammar.

## Requirements

Your workspace must contain a vite config (`vite.config.ts`, `.mts`, `.js`, `.mjs`, or `.cjs`) with a `pageDiscoveryPlugin({ … })` call. It is looked up at the workspace root first, then one level down, so opening a parent folder still works.

The asset directory for `src`/`srcset`/`poster` completions comes from `staticAssetsPlugin({ assetsDir })`, falling back to `<srcRoot>/assets` when that plugin is absent or omits the option. URLs are emitted root-relative, matching how the plugin's dev middleware resolves request paths under that directory.

At least one of `pagesDir` / `layoutsDir` / `partialsDir` / `componentsDir` must be a string literal; any option you omit is derived by convention from the ones you declare (a config with only `pagesDir: 'src/pages'` resolves `src/layouts`, `src/partials`, and `src/components`). Without a usable config, path-related features (render/layout completion, go-to-definition, unresolved-path diagnostics, component prop completion and validation) disable; the reason is logged to the **Liquid Paradox** output channel and all other features still work.

## Development

```bash
pnpm install
pnpm --filter @vscode-liquid-paradox/server build
# Press F5 in VS Code to launch the Extension Dev Host
```

```bash
pnpm test          # unit tests, all packages
pnpm typecheck     # tsc --noEmit, all packages
pnpm lint          # eslint over packages/**/src
pnpm build         # server -> smoke -> client, in that order
pnpm smoke         # post-build LSP check against the minified bundle
```

`pnpm build` is deliberately sequential: the client build copies the server's finished `dist/server.cjs`, so building both in parallel could package a server bundle one build old.

`pnpm smoke` forks the **minified** `dist/server.cjs` and drives a real LSP session (initialize → didOpen → completion) against `fixtures/career-site-mini`, asserting that render-arg props, tag names, output-region items, HTML attributes, and asset completions all come back. Unit tests import unminified TypeScript and cannot see minification damage — a shipped bug where `constructor.name` comparisons broke under esbuild's renaming is what this exists to catch. The server build additionally fails outright if the bundle compares `constructor.name` against a class-name literal.

## Architecture

Two-package pnpm monorepo:

- `packages/client` - VS Code extension that spawns the language server
- `packages/server` - Node LSP server with all analysis logic (no `vscode` API imports)

The server uses the `liquidjs` tokenizer for parsing, the TypeScript Compiler API for reading `vite.config.ts`, `vscode-html-languageservice` for HTML regions, and `jsonc-parser` for `.liquid.json` sidecars. `packages/server/scripts/smoke-lsp.mjs` holds the post-build LSP check.
