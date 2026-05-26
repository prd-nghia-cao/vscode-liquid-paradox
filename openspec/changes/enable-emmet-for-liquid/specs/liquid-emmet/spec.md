## ADDED Requirements

### Requirement: Emmet abbreviation expansion in `.liquid` files

The extension SHALL ship a default configuration that registers the `liquid` language with Emmet so that authors can expand HTML abbreviations inside `.liquid` documents without modifying their user settings. The default MUST be expressed via the extension manifest's `contributes.configurationDefaults` so that user-level overrides in `settings.json` continue to take precedence.

#### Scenario: First-time use after installation

- **WHEN** a user with no prior `emmet.includeLanguages` setting opens a `.liquid` file, types `ul>li*3` on an empty line inside the HTML body, and presses `Tab`
- **THEN** the editor expands the abbreviation into `<ul>\n  <li></li>\n  <li></li>\n  <li></li>\n</ul>` exactly as it would in a `.html` buffer

#### Scenario: Emmet completions appear in the suggestion list

- **WHEN** the user types `.btn--primary` in an HTML region of a `.liquid` file and the completion widget is open
- **THEN** an Emmet entry showing the expanded markup (`<div class="btn btn--primary"></div>`) is offered in the suggestion list

#### Scenario: User override wins

- **WHEN** a user has `"emmet.includeLanguages": { "liquid": "xml" }` in their `settings.json`
- **THEN** opening a `.liquid` file uses `xml` syntax for Emmet (the user value), not the extension's `html` default

#### Scenario: Opt-out via `emmet.excludeLanguages`

- **WHEN** a user adds `"emmet.excludeLanguages": ["liquid"]` to their `settings.json`
- **THEN** Emmet does not fire in `.liquid` files even though the extension contributes `liquid: html` as a default

### Requirement: Emmet must not fire inside Liquid delimiters

Emmet activation SHALL be limited to HTML regions of the document. Inside `{% … %}`, `{{ … }}`, and `{# … #}` regions the language server's completion provider remains authoritative and Emmet expansion MUST stay silent so that abbreviation operators (`>`, `+`, `*`, `.`) cannot corrupt Liquid syntax.

#### Scenario: Cursor inside a tag delimiter

- **WHEN** the cursor is positioned between `{%` and `%}` (e.g. immediately after typing `{% if `) and the user types `div.card`
- **THEN** no Emmet expansion occurs on `Tab`; the LSP-provided continuation completions (`==`, `!=`, `contains`, …) remain the only suggestions

#### Scenario: Cursor inside an output expression

- **WHEN** the cursor is positioned between `{{` and `}}` and the user types `ul>li`
- **THEN** the Emmet expansion menu does not appear, and pressing `Tab` does not transform the abbreviation into HTML markup

#### Scenario: Cursor crosses from HTML into a Liquid delimiter

- **WHEN** the user types `<div>{%` and then continues typing inside the now-open Liquid tag
- **THEN** Emmet stays inactive for the remainder of the Liquid region and resumes activation only after the closing `%}`

### Requirement: Default mapping is additive across coexisting extensions

The default contributed by this extension SHALL coexist with any other Liquid-aware extension that contributes the same `emmet.includeLanguages` mapping. Installing this extension alongside `sissel.shopify-liquid` (or any extension that also maps `liquid: html`) MUST NOT raise warnings, duplicate Emmet entries, or otherwise disturb the user's setting surface.

#### Scenario: Coexistence with sissel.shopify-liquid

- **WHEN** both this extension and `sissel.shopify-liquid` are installed and the user opens a `.liquid` file with no user-level `emmet.includeLanguages` setting
- **THEN** Emmet activates exactly once with `html` syntax, and the effective merged setting contains a single `liquid: html` entry

### Requirement: Documented default with opt-out path

The README SHALL document that Emmet is enabled by default for `.liquid` files and reference the standard `emmet.excludeLanguages` opt-out so users can discover the behavior without reading the manifest.

#### Scenario: README enumerates Emmet support

- **WHEN** a reader scans the Features section of `README.md`
- **THEN** they find a bullet stating that Emmet abbreviation expansion is enabled for `.liquid` out of the box

#### Scenario: README points to the opt-out mechanism

- **WHEN** a reader wants to disable Emmet inside `.liquid`
- **THEN** the README tells them to add `"emmet.excludeLanguages": ["liquid"]` to their settings
