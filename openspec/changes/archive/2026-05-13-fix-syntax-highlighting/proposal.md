## Why

Opening a `.liquid` file in the Liquid Paradox extension currently shows plain, uncolored text — neither the HTML markup nor the Liquid tags/filters/variables are highlighted. The extension delegates highlighting to `sissel.shopify-liquid` via `extensionDependencies`, but at the same time declares the `liquid` language id itself with no grammar or `language-configuration.json` of its own. The result is a conflicting/undefined language registration and (especially in the Extension Development Host) an unstyled buffer, which makes the extension feel broken before any IntelliSense feature even runs.

## What Changes

- Ship a self-contained TextMate grammar for `.liquid` files that highlights HTML structure (tags, attributes, entities) and Liquid syntax (`{% ... %}`, `{{ ... }}`, tags, filters, strings, numbers, operators, comments).
- Add a `language-configuration.json` providing comment markers (`{# … #}` / `{%- comment -%} … {%- endcomment -%}`), bracket pairs, auto-closing pairs, surrounding pairs, indentation rules, and word/auto-indent settings for the `liquid` language.
- Replace the empty `paradox-injection.tmLanguage.json` with a real injection grammar that styles the Paradox backend tags (`{{component:…}}`, `{{snippet:…}}`, `{{data:…}}`, `{{attribute:…}}`) on top of the base Liquid grammar.
- Remove the hard `extensionDependencies` on `sissel.shopify-liquid` so highlighting works out of the box without a second extension; document `sissel.shopify-liquid` as optional/coexisting instead.
- **BREAKING (dev workflow)**: contributors who relied on `sissel.shopify-liquid` being auto-installed must instead rely on the bundled grammar; no consumer-facing breakage.

## Capabilities

### New Capabilities
- `syntax-highlighting`: covers the language registration, base HTML+Liquid TextMate grammar, language configuration, and the Paradox-tags injection grammar that together provide colorization and editor affordances (brackets, comments, indent) for `.liquid` documents.

### Modified Capabilities
<!-- No existing specs in openspec/specs/ — leaving empty. -->

## Impact

- `packages/client/package.json`: contributes `grammars`, `languages` (with `configuration`), and drops `extensionDependencies`.
- `packages/client/syntaxes/`: adds `liquid.tmLanguage.json` (base grammar) and rewrites `paradox-injection.tmLanguage.json` with real patterns.
- `packages/client/language-configuration.json`: new file.
- `packages/client/esbuild.config.mjs` and the VSIX packaging step: must include `syntaxes/` and `language-configuration.json` in the published artifact.
- `README.md`: update install/requirements section to drop the `sissel.shopify-liquid` dependency statement.
- No changes to `packages/server` runtime behavior; LSP features continue to operate on documents with `languageId === 'liquid'`.
- Third-party grammar sources must be vetted for license compatibility (MIT/Apache/BSD); attribution recorded in the grammar file header if required.
