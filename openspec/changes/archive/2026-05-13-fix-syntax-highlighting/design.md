## Context

`vscode-liquid-paradox` is a two-package monorepo (`packages/client`, `packages/server`) that ships a VS Code extension providing IntelliSense for LiquidJS templates used by Workday's Paradox static-site projects. Today the client `package.json`:

- declares the `liquid` language (`id: liquid`, `extensions: ['.liquid']`) without a `configuration` field and without binding any grammar to that scope,
- contributes a single grammar `paradox.injection` (`./syntaxes/paradox-injection.tmLanguage.json`) that targets `text.html.liquid` but contains an empty `patterns` array,
- pins `sissel.shopify-liquid` as an `extensionDependencies` entry to provide the actual `text.html.liquid` grammar.

This works only when (a) `sissel.shopify-liquid` is genuinely installed, and (b) VS Code resolves the dual `liquid` language registration in our favor. In the Extension Development Host that auto-install does not happen, and even when both extensions are installed the empty injection adds no visible value. The user-facing symptom is "nothing is highlighted" — the file opens in plain text, masking every LSP feature the server actually does provide.

Constraints:
- LSP behavior in `packages/server` already treats documents by `languageId === 'liquid'`; the language id must stay `liquid`.
- The published VSIX must be self-sufficient. We do not want consumers to install a second extension.
- Grammars are licensed; whatever we bundle needs a compatible license and attribution.
- Esbuild bundles only the runtime JS; grammar/config files must be copied into `packages/client/dist` (or included in the VSIX `files` glob) so they ship with the extension.

Stakeholders: extension users (Paradox template authors), maintainers, and the LSP server which assumes `languageId === 'liquid'`.

## Goals / Non-Goals

**Goals:**
- HTML structure and Liquid syntax in `.liquid` files are colorized immediately after installing only `vscode-liquid-paradox`.
- Editor affordances on `.liquid` files: comment toggling, bracket matching, auto-closing of `{% %}`, `{{ }}`, `{# #}`, `"` and `'`, smart indent inside block tags.
- Paradox backend tags (`{{component:…}}`, `{{snippet:…}}`, `{{data:…}}`, `{{attribute:…}}`) receive distinct, predictable scopes so themes and the existing hover-only docs feature read consistently.
- Highlighting still works when `sissel.shopify-liquid` is installed alongside our extension (no scope or language-id conflicts).
- LSP features in `packages/server` continue to function unchanged.

**Non-Goals:**
- Embedded language support for CSS/JS inside `<style>` and `<script>` is a stretch goal, not required by this change.
- A full from-scratch Liquid grammar covering every Shopify-only tag (`section`, `form`, …). We scope to LiquidJS core + Paradox extensions.
- Semantic (server-driven) tokens via LSP — this change is purely TextMate-grammar based.
- Theming choices: we expose standard TextMate scopes and let user themes color them.

## Decisions

### Decision 1: Bundle our own base grammar instead of depending on `sissel.shopify-liquid`

Vendor a permissively licensed Liquid TextMate grammar into `packages/client/syntaxes/liquid.tmLanguage.json` with `scopeName: text.html.liquid` and register it against the `liquid` language id. We start from an MIT/Apache-licensed source (candidates: Panoply's `Better-Liquid-Tokenizer`, Shopify's `liquid` grammar in `theme-check-vscode`, or Microsoft's `vscode-html` reused as `text.html.basic` include). Whichever source we pick will be vendored verbatim with its license header preserved.

Rationale: `extensionDependencies` are not auto-installed in the Extension Development Host and add friction for marketplace users. Owning the grammar lets us guarantee behavior, fix bugs without coordinating upstream, and add Paradox extensions cleanly.

Alternatives considered:
- Keep `extensionDependencies: ["sissel.shopify-liquid"]` and document that contributors must install it in the dev host. Rejected: brittle, hides the root cause, and the dual language-id registration is still undefined behavior.
- Generate the grammar programmatically from `liquidjs` token definitions. Rejected: TextMate grammars are oblivious-regex; a static JSON is simpler and matches every other Liquid extension in the marketplace.

### Decision 2: Use a base grammar at `scopeName: text.html.liquid` with HTML included via `text.html.basic`

The base grammar's top-level pattern list `include`s `text.html.basic` (shipped with VS Code core) before/after Liquid-specific patterns, so HTML tags, attributes, and entities are colored without us re-implementing HTML.

Rationale: `text.html.basic` is bundled with every VS Code install, so this adds no extra dependency. The community Liquid grammars all use this pattern.

Alternatives considered:
- Embed `source.css`/`source.js` inside `<style>`/`<script>` blocks. Deferred — listed under Non-Goals; we can layer this in a future change without breaking the contract established here.

### Decision 3: Move Paradox tags into a separate injection grammar targeting `text.html.liquid`

Keep `paradox-injection.tmLanguage.json` (rewritten with real patterns) and target it at `L:text.html.liquid` so it layers cleanly over either our base grammar OR `sissel.shopify-liquid` when both are installed. Patterns: `{{component:…}}`, `{{snippet:…}}`, `{{data:…}}`, `{{attribute:…}}` and the colon-separated argument keys. Scopes follow the pattern `meta.tag.paradox.<kind>.liquid` plus `entity.name.tag.paradox.liquid`, `variable.parameter.paradox.liquid`, etc.

Rationale: an injection keeps the base grammar focused on standard Liquid and survives the coexistence scenario with `sissel.shopify-liquid` (Decision 5).

Alternatives considered:
- Inline the Paradox tag patterns into the base grammar. Rejected: would lose the layering benefit when `sissel.shopify-liquid` is present.

### Decision 4: Ship `language-configuration.json` alongside the language registration

Create `packages/client/language-configuration.json` covering:
- `comments`: line `null`, block `["{%- comment -%}", "{%- endcomment -%}"]` (and accept the non-trimming `{% comment %}` form via additional `blockComment` if VS Code allows; otherwise the standard form).
- `brackets`: `[["{%","%}"], ["{{","}}"], ["{#","#}"], ["<",">"], ["{","}"], ["[","]"], ["(",")"]]`.
- `autoClosingPairs` and `surroundingPairs`: same plus quotes.
- `indentationRules`: increase indent inside `{% if|for|unless|case|capture|tablerow|raw %}` and the HTML block-open regex from `vscode-html`'s configuration, decrease on the matching `{% end... %}` or `</...>`.
- `onEnterRules`: optional, for keeping `{% ... %}` block bodies indented one level.

Reference and register via `contributes.languages[0].configuration: "./language-configuration.json"`.

### Decision 5: Coexist with `sissel.shopify-liquid` rather than block it

Drop `extensionDependencies`. Do not declare a conflicting scope. Both extensions can register the `liquid` language; VS Code merges contributions. We document the recommended setup as "install only Liquid Paradox; `sissel.shopify-liquid` remains optional and compatible."

Rationale: removing the hard dep fixes the dev-host case; we still want to avoid breaking users who already have sissel installed.

Trade-off: when both are installed, VS Code may resolve the grammar to either extension based on activation order. Both grammars produce the same `text.html.liquid` scope, so the Paradox injection still works either way — but theme output may differ subtly. Acceptable given the alternative is forced uninstall.

### Decision 6: Package grammars/config without esbuild

Esbuild only bundles `extension.ts` → `dist/extension.js`. The grammar and language-configuration files must live at runtime paths referenced from `package.json`. Three options:

1. Reference them directly at their source path (`./syntaxes/...`, `./language-configuration.json`) and ensure `vsce package` ships them. This is the standard VS Code pattern.
2. Copy them to `./dist` during build.
3. Inline them into the JS bundle. Not viable for grammars.

We pick option 1. Update `packages/client/.vscodeignore` (create if missing) to exclude `node_modules`, `src`, tsconfig, etc., but to **include** `syntaxes/**` and `language-configuration.json`.

### Decision 7: No changes to the LSP server

The server already keys off `languageId === 'liquid'` and on the `.liquid` extension. Highlighting and configuration changes are purely declarative in `package.json` and static JSON, so the server contract is preserved.

## Risks / Trade-offs

- **Risk**: Vendored grammar license incompatible with our distribution → **Mitigation**: pick MIT/Apache/BSD source, preserve the license header in the JSON file (TextMate grammars allow a top-level `"comment"` or `"licence"` key), and add a `THIRD_PARTY_LICENSES.md` entry under `packages/client/`.
- **Risk**: Dual `liquid` language registration with `sissel.shopify-liquid` produces theme drift → **Mitigation**: keep scope name `text.html.liquid` identical so themes resolve scopes identically; document the coexistence behavior in README.
- **Risk**: Our `language-configuration.json` fights `sissel.shopify-liquid`'s configuration → **Mitigation**: VS Code lets only one extension's language configuration win deterministically by activation; since both configs target the same `liquid` language, drift is cosmetic (bracket pairs / comment shortcuts). Acceptable.
- **Risk**: Indentation rules clash with HTML auto-indent for mixed content → **Mitigation**: model regexes on `vscode-html`'s shipped `language-configuration.json` and add unit-style snapshot tests against `fixtures/career-site-mini/src/pages/home.liquid`.
- **Risk**: Grammar regressions break existing user files → **Mitigation**: add a small "scope inspection" QA checklist run via the `vscode.executeDocumentSymbolProvider` / "Inspect Editor Tokens and Scopes" command on each fixture file; document the expected scope chains.
- **Risk**: VSIX missing the grammar/config files at install time → **Mitigation**: explicit `files` field in `packages/client/package.json` and a verification step (`vsce ls`) added to the tasks list.

## Migration Plan

1. Land the grammar and `language-configuration.json` behind a feature-complete commit; `package.json` `contributes` updated atomically.
2. Bump `packages/client/package.json` version (e.g. `0.0.2`). Document the highlighting fix in `CHANGELOG.md` (create if missing).
3. Re-package the VSIX, install locally, smoke-test against the fixture project.
4. Rollback strategy: revert the commit; previous behavior (empty injection + `sissel.shopify-liquid` dep) is restored. Users who installed the new VSIX would not see highlighting but the LSP features still function.

## Open Questions

- Which third-party Liquid grammar should we vendor as the base? The likely candidates are `panoply-fyi/vscode-liquid` (Apache-2.0) and `Shopify/theme-check-vscode` (MIT). Decision deferred to implementation; both produce `text.html.liquid` and either is acceptable.
- Should we add a separate language id (e.g. `liquid-paradox`) instead of reusing `liquid`? Current plan: stay on `liquid` so the LSP and existing Liquid ecosystem continue to apply. Revisit only if dual-registration with `sissel.shopify-liquid` proves unresolvable in practice.
- Do we need to surface the Paradox tag scopes in a bundled color customization snippet so users immediately see them styled even on the default Dark+ theme? Tentatively no; we rely on standard `entity.name.tag` scopes that all major themes already color.
