## ADDED Requirements

### Requirement: Language registration for Liquid files

The extension SHALL register a `liquid` language id bound to the `.liquid` file extension and a `language-configuration.json`, so that VS Code recognizes `.liquid` files and applies the configured editor behavior.

#### Scenario: Opening a `.liquid` file selects the Liquid language

- **WHEN** a user opens any file with the `.liquid` extension in a workspace with only the Liquid Paradox extension installed
- **THEN** the VS Code language mode indicator MUST display "Liquid" (or the aliased label) and the file MUST be associated with `languageId === 'liquid'`

#### Scenario: Bracket pairs and auto-closing pairs apply to Liquid delimiters

- **WHEN** the user types `{%`, `{{`, `{#`, `<`, `(`, `[`, `{`, `"`, or `'` inside a `.liquid` file
- **THEN** VS Code MUST auto-insert the matching closing delimiter (`%}`, `}}`, `#}`, `>`, `)`, `]`, `}`, `"`, `'`) at the cursor position

#### Scenario: Comment toggle uses the Liquid block comment syntax

- **WHEN** the user invokes "Toggle Block Comment" on a selection inside a `.liquid` file
- **THEN** VS Code MUST wrap the selection with `{%- comment -%}` and `{%- endcomment -%}` (or unwrap if already commented)

### Requirement: Base HTML + Liquid TextMate grammar bundled with the extension

The extension SHALL ship a TextMate grammar registered at `scopeName: text.html.liquid` and bound to the `liquid` language id, providing colorization for both HTML markup and Liquid syntax in `.liquid` files without requiring any other extension to be installed.

#### Scenario: Highlighting works without `sissel.shopify-liquid`

- **WHEN** a user installs only `vscode-liquid-paradox` and opens any `.liquid` file
- **THEN** HTML tags, attributes, attribute values, and entities MUST be highlighted with the appropriate scopes (`entity.name.tag.html`, `entity.other.attribute-name.html`, `string.quoted.double.html`, etc.)
- **AND** Liquid output expressions (`{{ ... }}`), Liquid tag blocks (`{% ... %}`), comment blocks (`{# ... #}`), strings, numbers, booleans, identifiers, and filter pipes MUST be highlighted with their standard Liquid scopes (`punctuation.section.embedded.liquid`, `keyword.control.liquid`, `support.function.filter.liquid`, etc.)

#### Scenario: Coexistence with `sissel.shopify-liquid`

- **WHEN** both `vscode-liquid-paradox` and `sissel.shopify-liquid` are installed
- **THEN** opening a `.liquid` file MUST still produce a colorized buffer with `text.html.liquid` as the resolved top-level scope
- **AND** the Paradox injection grammar MUST still apply (see "Paradox tag injection" requirement)

#### Scenario: Grammar ships in the packaged VSIX

- **WHEN** the extension is packaged with `vsce package`
- **THEN** the produced `.vsix` MUST include the `syntaxes/liquid.tmLanguage.json` and `language-configuration.json` files at the paths declared in `packages/client/package.json`

### Requirement: Paradox tag injection grammar

The extension SHALL contribute an injection grammar (scope `paradox.injection`, injection selector `L:text.html.liquid`) that styles Paradox backend tags layered on top of the base Liquid grammar.

#### Scenario: Component tag is highlighted as a Paradox tag

- **WHEN** a `.liquid` file contains `{{component:hero-banner attribute:title}}`
- **THEN** the substring `component` MUST receive a scope under `entity.name.tag.paradox.liquid` (or equivalent), and `hero-banner` MUST receive a scope under `meta.tag.paradox.component.liquid`

#### Scenario: Snippet, data, and attribute tags receive distinct scopes

- **WHEN** a `.liquid` file contains any of `{{snippet:name}}`, `{{data:path.to.value}}`, `{{attribute:title}}`
- **THEN** each kind MUST be assigned a distinct `meta.tag.paradox.<kind>.liquid` scope (`snippet`, `data`, `attribute`) so themes can target them independently

#### Scenario: Non-Paradox `{{ … }}` expressions are unaffected

- **WHEN** a `.liquid` file contains a standard Liquid output such as `{{ user.name | upcase }}`
- **THEN** the Paradox injection MUST NOT add Paradox-specific scopes to that expression; standard Liquid scopes MUST remain

### Requirement: No regression in Language Server features

The change SHALL NOT modify the contract between the client and the language server: documents reported to the server MUST continue to use `languageId === 'liquid'` and `.liquid` file paths.

#### Scenario: Existing LSP features continue to work after the grammar change

- **WHEN** a user opens a `.liquid` file under a workspace containing a valid `vite.config.ts` with `pageDiscoveryPlugin({...})`
- **THEN** hover, completion, go-to-definition, and diagnostics features defined by `packages/server` MUST continue to function unchanged

### Requirement: No hard dependency on `sissel.shopify-liquid`

The extension SHALL NOT declare `sissel.shopify-liquid` (or any other Liquid grammar provider) under `extensionDependencies`. Documentation SHALL describe `sissel.shopify-liquid` as optional rather than required.

#### Scenario: Fresh install with no other Liquid extension produces highlighting

- **WHEN** a user installs `vscode-liquid-paradox` into a VS Code profile that has never installed any Liquid extension
- **THEN** no marketplace prompt for `sissel.shopify-liquid` MUST appear during install
- **AND** `.liquid` files MUST still be highlighted (per the base grammar requirement above)
