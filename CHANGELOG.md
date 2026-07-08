# Changelog

All notable changes to **Liquid Paradox** are documented in this file.

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
- Automatic leading/trailing-space padding for completion items inserted inside `{% … %}` / `{{ … }}` / pipe / Paradox-intent regions. Accepting a completion when the cursor is tight up against the open or close delimiter now produces canonical Liquid (`{% if %}`, `{{ title }}`, `{{ component:`) instead of `{%if%}` / `{{title}}` / `{{component:`. The pipe sentinel keeps its own ` | ` insertText and opts out of double-padding; string-literal and `render-args` regions are excluded since added spaces would corrupt their syntax.
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
