# Changelog

All notable changes to **Liquid Paradox** are documented in this file.

## 1.5.0

### Added

- **Static-asset completions in `.liquid.json` sidecars.** Media keys now offer the same asset URLs as HTML attributes do. A key qualifies when its leaf is `src` or ends in `Src` / `_src`, and the offered kinds come from the qualifier: the leaf's own prefix (`videoSrc`, `thumbnailSrc`, `heroImageSrc`) or, for a bare `src`, the nearest ancestor object key, skipping array indices (`image.src`, `roles[].image.src`, `hero_video.src`). Image words (`image`, `img`, `thumbnail`, `photo`, `icon`, `logo`, `poster`, `banner`, …) offer images and video words (`video`, `clip`, `reel`, `trailer`, …) offer videos; the last recognized word wins, so `videoThumbnailSrc` is an image. A `src` under a key that says nothing about its kind (`awards[].src`, `phoneApp.src`) offers every kind rather than nothing, and keys that are not media sources at all — `alt`, `title`, `videoUrl` — stay quiet.
- Parsing is error-tolerant, so a half-typed value (`"src": "/he`) or a trailing comma still resolves; accepting an item replaces the whole string value.
- Sidecars are now synced to the server (`documentSelector` gained a `**/*.liquid.json` pattern, plus a `workspaceContains` activation event). Every Liquid-analyzing handler — diagnostics, hover, go-to-definition — skips them, so opening a sidecar cannot produce spurious Liquid errors.
- Smoke coverage against the minified bundle: `image.src` offers only images, `video.src` only videos, `alt` offers nothing, and the sidecar publishes no diagnostics.

### Removed

- The `docs/` and `openspec/` directories and the `.claude/` / `.cursor/` OpenSpec command and skill files. They tracked the design process rather than the extension's behaviour and had drifted out of date; the README and CHANGELOG are now the only documentation. The README's pointer to `docs/completion-surfaces.md` is gone with it.

## 1.4.1

### Fixed

- **`Unknown prop` warnings for colons inside a prop value.** Render arguments were read with a bare `([\w-]+)\s*:` scan over the whole tag body, so any colon in a value looked like an argument name. A Tailwind variant class — `customClass: 'absolute bottom-2 group-odd:left-2 group-even:right-2'` — produced `Unknown prop 'group-odd'` and `Unknown prop 'group-even'`; URLs (`'https://…'`), times (`'12:30'`) and filter arguments (`text: title | default: 'x'`) were affected the same way. Argument names are now recognized only at the head of a top-level comma-separated segment, with string literals and brackets respected, so a genuinely unknown prop is still reported while values are left alone.
- The same scan drove which arguments render-arg completion considered already supplied, so a colon-bearing value could hide props that had not been written yet.

## 1.4.0

### Added

- **Static-asset completions in `src`, `srcset` and `poster`.** The server indexes the image, video, and audio files under the site's asset directory and offers them as root-relative URLs (`src/assets/img/team.webp` → `/img/team.webp`) whenever the cursor sits in one of those attribute values. Candidates are filtered to what the element accepts: images for `<img src|srcset>` and any `poster`, videos for `<video src>`, audio + video containers for `<audio src>`, and for `<source>` the kind is taken from the parent element (`<picture>` → images, `<video>` → videos, `<audio>` → audio + video, anything else → all). Accepting an item replaces the URL token under the cursor rather than inserting at it, so retyping a path narrows in place and a `srcset` candidate's `, 2x` descriptor survives.
- The asset directory is read from `staticAssetsPlugin({ assetsDir })` in the vite config, falling back to `<srcRoot>/assets`. Non-media files and dotfiles (`.DS_Store`, `.gitkeep`) are skipped, and the asset count is included in the `[config]` startup log. A watcher on the asset tree keeps the index current as files are added, changed, or removed.
- Smoke coverage for the new surface: the post-build LSP check now asserts that `<img src="">` offers only images, `<video src="">` only videos, and that items carry a value-replacing `textEdit` — verified against the minified bundle.

## 1.3.1

### Fixed

- **Nothing that depended on parsing worked in the published extension.** `tokenize` classified liquidjs tokens with `t.constructor.name === 'TagToken'`, but the production bundle is minified and esbuild renames those bundled classes — so every token fell through to the `html` branch. The parsed document became one undifferentiated HTML blob, which silently disabled `{% render %}` argument completions, variable/scope completions, `.liquid.json` variables, hover, go-to-definition, and all diagnostics. Only the string-scanning surfaces (tag names, filters, path completions) kept working, which is why the extension looked half-alive. Token classification now branches on liquidjs's numeric `TokenKind`.
- The client build copied `../server/dist/server.cjs` while `pnpm -r build` was still writing it, so the packaged `.vsix` could ship a server bundle one build old. The root `build` script now builds the server, smoke-tests it, then builds the client, in sequence.

### Added

- `pnpm smoke` (`packages/server/scripts/smoke-lsp.mjs`) drives the **minified** `dist/server.cjs` over a real LSP session — initialize, didOpen, completion — and asserts render-arg props, tag names, output-region items, and HTML attributes all come back. Unit tests import unminified TypeScript and cannot see minification damage; this runs as part of `pnpm build`.
- The server build now fails if the bundle compares `constructor.name` against a class-name literal, which is the signature of the bug above.
- A unit test pinning the liquidjs contract that `tokenize` now relies on (every top-level token carries a numeric `kind`).

## 1.3.0

### Removed

- **Tag-pair linked editing.** Renaming a start tag no longer renames its matching end tag. The `linkedEditingRangeProvider` capability and its `onLinkedEditingRange` handler are gone; together with the 1.2.0 removal of auto-closing tags, the extension no longer edits the buffer on your behalf. VS Code's built-in `"editor.linkedEditing"` remains available.

## 1.2.0

### Fixed

- `{% render "component", ` argument completions no longer silently disappear in real projects. `parseViteConfig` used to require all four of `pagesDir`, `layoutsDir`, `partialsDir`, and `componentsDir`; a config that omitted any of them (a common shape — `componentsDir` is often left out even when `src/components` exists) made the whole file index empty, which disabled render/layout path completion, go-to-definition, path diagnostics, and prop completion at once. Omitted options are now derived by convention from the declared ones, and only one declared directory is required.
- The vite config is now located at the workspace root _or_ one directory below it, and `.mts` / `.js` / `.mjs` / `.cjs` configs are accepted alongside `.ts`. Previously only `<workspaceRoot>/vite.config.ts` was read, so opening a parent folder disabled every path feature.
- Component props are collected from all top-level `{% assign x = x | default: … %}` tags instead of only the uninterrupted run at the top of the file, so props declared after some markup are no longer dropped. Duplicate declarations are reported once.
- `Unknown prop` warnings are suppressed for components that declare no `| default:` props at all — such a component says nothing about what it accepts, so every argument was previously flagged.

### Changed

- Render-arg completions insert `name: ` (ready for the value) and omit arguments already present in the tag.
- Config resolution outcome — including why path features are disabled and how many components/partials/layouts were indexed — is logged to the **Liquid Paradox** output channel on startup.

### Removed

- **HTML auto-closing tags.** Typing `<section>` no longer inserts `</section>`. The `liquid/tagClose` request and the client-side `onDidChangeTextDocument` listener that drove it are gone. Tag-pair linked editing is unaffected; VS Code's built-in `"html.autoClosingTags"` remains available.
- **Emmet defaults.** The extension no longer contributes `"emmet.includeLanguages": { "liquid": "html" }` via `configurationDefaults`. Add that setting to your own `settings.json` if you want Emmet in `.liquid` files.

## 1.1.0

### Added

- HTML IntelliSense inside the HTML regions of `.liquid` files, served by an embedded `vscode-html-languageservice` over a Liquid-masked virtual document:
  - Tag-name completions (after `<`), attribute-name completions, and attribute-value completions sourced from the HTML5 data set.
  - HTML element and attribute hover documentation.
  - Auto-closing tags — typing `<section>` inserts `</section>` with the cursor between the tags (driven by a `liquid/tagClose` request gated to HTML regions).
  - Tag-pair linked editing — renaming a start tag renames its matching end tag and vice versa (`linkedEditingRangeProvider`).
  - HTML features are confined to HTML regions; inside `{% … %}`, `{{ … }}`, `{# … #}`, and `{% comment %}` regions the Liquid LSP stays authoritative and HTML IntelliSense stays silent.
  - The server advertises the additional completion trigger characters `<`, `=`, `/` alongside the existing Liquid set. Emmet continues to work in HTML regions as before.

## 1.0.2

### Added

- Emmet abbreviation expansion is enabled by default for `.liquid` files. The extension now contributes `"emmet.includeLanguages": { "liquid": "html" }` via `configurationDefaults`, so abbreviations like `ul>li*3` and `.btn--primary` expand inside HTML regions of `.liquid` files without any user setup. Emmet stays silent inside `{% … %}` and `{{ … }}` regions — LSP completions remain authoritative there. Users can opt out by adding `"emmet.excludeLanguages": ["liquid"]` to their `settings.json`; any user-defined `emmet.includeLanguages` value continues to take precedence over the extension default. Coexistence with `sissel.shopify-liquid` is unaffected.

## 0.0.3

### Fixed

- Completions now appear immediately after typing `{%` or `{{`. Previously the LSP returned an empty list at those positions whenever there were no in-scope variables, making the extension feel broken on fresh files. The cursor-context detector was rewritten to walk backwards from the cursor (tolerant of the auto-inserted closing delimiter), and the provider now always offers a useful list inside any Liquid construct.
- Removed the conflicting single-character `{` → `}` auto-closing pair. VS Code commits to single-char pairs before it can see the second character of a multi-char open, so the previous configuration caused `{%` to expand to `{%}` (cursor at offset 2, bogus `%}` close) instead of `{%%}`. With the single-char pair removed, typing `{%` now produces `{%%}` (the intended shape) and the `%` trigger character fires completions on the very first keystroke. As a defense in depth, `bucketCursor` also short-circuits to the matching open when the two characters immediately before the cursor are `{%`, `{{`, `{%-`, or `{{-`, even if the buffer is in the legacy `{%}` shape.

### Added

- Tag-name completions inside `{% … %}` even with no trailing space (`{%`, `{%-`, `{%a`, etc.).
- Built-in literal completions inside `{{ … }}`: `nil`, `null`, `true`, `false`, `empty`, `blank`.
- A pipe sentinel inside `{{ … }}` (`|` item with `insertText: ' | '`) that drops the user into the filter list.
- Per-tag continuation keywords: `in`, `reversed`, `offset:`, `limit:` for `for` / `tablerow`; `with`, `for`, `as` for `render` / `include`; `by` for `paginate`; the full operator list (`and`, `or`, `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`) for `if` / `unless` / `elsif` / `when` / `case`.
- Paradox-kind completions: typing `{{co` offers the four Paradox kinds (`component`, `snippet`, `data`, `attribute`); typing `{{component:` offers a value placeholder (real values will be wired to the workspace index in a future change).
- Trigger-character coverage for `:`, `-`, `}`, and `<space>` — completions stay alive as the user types through multi-token tag bodies.
- Automatic leading/trailing-space padding for completion items inserted inside `{% … %}` / `{{ … }}` / pipe / Paradox-intent regions. Accepting a completion when the cursor is tight up against the open or close delimiter now produces canonical Liquid (`{% if %}`, `{{ title }}`, `{{ component:`) instead of `{%if%}` / `{{title}}` / `{{component:`. The pipe sentinel keeps its own `|` insertText and opts out of double-padding; string-literal and `render-args` regions are excluded since added spaces would corrupt their syntax.
- `docs/completion-surfaces.md` documenting every completion surface, its trigger, and its expected items.

### Changed

- **BREAKING (editor UX)**: `language-configuration.json` no longer inserts a leading space when auto-closing `{%`, `{{`, `{#`. Typing `{%` now yields `{%%}` (cursor between) instead of `{% %}`. Authors who relied on the padded form will need to type the space explicitly, which avoids the previous interaction problem where the auto-inserted space sat between the cursor and any subsequently typed content.

## 0.0.2

### Fixed

- `.liquid` files now have proper HTML + Liquid syntax highlighting out of the box. Previously the extension declared the `liquid` language without binding a grammar and shipped an empty Paradox injection, leaving buffers uncolored unless a separate Liquid extension was installed.

### Added

- Self-contained TextMate grammar (`syntaxes/liquid.tmLanguage.json`) registered at `scopeName: text.html.liquid` and bound to the `liquid` language. HTML markup is highlighted via the bundled `text.html.basic` include; Liquid tags (`{% ... %}`), output expressions (`{{ ... }}`), comments (`{# ... #}`, `{% comment %} … {% endcomment %}`), strings, numbers, constants, operators, filters, and identifiers receive standard Liquid scopes.
- `language-configuration.json` providing block-comment markers (`{%- comment -%} … {%- endcomment -%}`), bracket pairs for `{% %}` / `{{ }}` / `{# #}` / HTML, auto-closing pairs, surrounding pairs, indentation rules, on-enter rules for block tags, and folding markers.
- Paradox tag injection grammar with patterns for `{{component:…}}`, `{{snippet:…}}`, `{{data:…}}`, `{{attribute:…}}`. Each kind receives a distinct `meta.tag.paradox.<kind>.liquid` scope; argument keys receive `variable.parameter.paradox.liquid`. Layered via `injectionSelector: L:text.html.liquid` so it composes with our base grammar or `sissel.shopify-liquid` when both are installed.
- The template path inside `{% render "…" %}`, `{% include "…" %}`, and `{% layout "…" %}` is scoped as `markup.underline.link.path.liquid` so themes render it as an underlined link, hinting that the path is navigable (matches the existing go-to-definition support).
- `docs/paradox-tag-scopes.md` referencing the TextMate scopes for theme authors.

### Removed

- `extensionDependencies: ["sissel.shopify-liquid"]` (it was also mis-nested under `contributes` in the previous manifest). Installing Liquid Paradox no longer requires any other Liquid extension; coexistence with `sissel.shopify-liquid` is documented and supported.

## 0.0.1

- Initial private release with LSP-based IntelliSense (completions, hover, go-to-definition, diagnostics) for Paradox Liquid projects.
