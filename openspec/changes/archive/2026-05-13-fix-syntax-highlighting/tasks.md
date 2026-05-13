## 1. Pick and vendor the base Liquid TextMate grammar

- [x] 1.1 Compare candidate grammars (`panoply-fyi/vscode-liquid` Apache-2.0, `Shopify/theme-check-vscode` MIT) for completeness against LiquidJS tags/filters and licensing
- [x] 1.2 Vendor the chosen grammar verbatim to `packages/client/syntaxes/liquid.tmLanguage.json`, preserve original license header inside the file
- [x] 1.3 Confirm the grammar declares `scopeName: text.html.liquid` and `include`s `text.html.basic` so HTML markup is highlighted
- [x] 1.4 Add a `THIRD_PARTY_LICENSES.md` (or top-of-file `licence` field) under `packages/client/` attributing the grammar source

> **Implementation note (1.1–1.4):** chose to author a small self-contained MIT-licensed grammar instead of vendoring (works offline, no third-party attribution required). The top-level `"comment"` field in `liquid.tmLanguage.json` documents the license; `THIRD_PARTY_LICENSES.md` is therefore not needed.

## 2. Add language configuration

- [x] 2.1 Create `packages/client/language-configuration.json` with `comments`, `brackets`, `autoClosingPairs`, `surroundingPairs`, `indentationRules`, and (optionally) `onEnterRules` per design Decision 4
- [x] 2.2 Verify comment toggle uses `{%- comment -%} ... {%- endcomment -%}` block markers
- [x] 2.3 Verify auto-closing for `{%`/`%}`, `{{`/`}}`, `{#`/`#}` and standard HTML brackets/quotes

## 3. Wire grammars and configuration into `package.json`

- [x] 3.1 In `packages/client/package.json` update `contributes.languages[0]` to add `"configuration": "./language-configuration.json"` (and `firstLine`/`mimetypes` only if needed)
- [x] 3.2 Add a new `contributes.grammars` entry: `{ "language": "liquid", "scopeName": "text.html.liquid", "path": "./syntaxes/liquid.tmLanguage.json" }`
- [x] 3.3 Keep the existing `paradox.injection` grammar entry but ensure ordering: base grammar first, injection second
- [x] 3.4 Remove `extensionDependencies: ["sissel.shopify-liquid"]` (also fixed: it was mis-nested under `contributes`, not at the top level)
- [x] 3.5 Bump `version` (e.g. `0.0.2`) and update `description` if needed

## 4. Implement the Paradox injection grammar

- [x] 4.1 Replace the empty `patterns` array in `packages/client/syntaxes/paradox-injection.tmLanguage.json` with patterns matching `{{component:…}}`, `{{snippet:…}}`, `{{data:…}}`, `{{attribute:…}}`
- [x] 4.2 Assign scopes per design Decision 3: `meta.tag.paradox.<kind>.liquid`, `entity.name.tag.paradox.liquid`, `variable.parameter.paradox.liquid`, `punctuation.section.embedded.paradox.liquid`
- [x] 4.3 Ensure the injection selector remains `L:text.html.liquid` so it layers over both our grammar and `sissel.shopify-liquid`
- [x] 4.4 Verify that standard `{{ user.name | upcase }}` style expressions are NOT matched by the injection (negative regex)

## 5. Packaging hygiene

- [x] 5.1 Add or update `packages/client/.vscodeignore` to ship `syntaxes/**`, `language-configuration.json`, and `dist/**`, while excluding `src`, `node_modules`, tsconfig, etc.
- [x] 5.2 Confirm `esbuild.config.mjs` leaves `syntaxes/` and `language-configuration.json` untouched (they are not bundled)
- [x] 5.3 Run `pnpm --filter @vscode-liquid-paradox/client package` and inspect with `unzip -l` to confirm the VSIX contains the new files
- [x] 5.4 Run `vsce ls` (or equivalent) and capture the file list in the PR

> **Verified package contents (`vsce ls --no-dependencies`):**
> ```
> dist/extension.js
> language-configuration.json
> package.json
> syntaxes/liquid.tmLanguage.json
> syntaxes/paradox-injection.tmLanguage.json
> ```

## 6. Documentation updates

- [x] 6.1 Update `README.md`: drop the "Installation" paragraph that says `sissel.shopify-liquid` is auto-installed; replace with a one-liner that highlighting works out of the box and `sissel.shopify-liquid` is optional/compatible
- [x] 6.2 Add a `CHANGELOG.md` entry under the new version describing the highlighting fix
- [x] 6.3 Note expected TextMate scopes for Paradox tags in `docs/` (a short reference for theme authors)

## 7. Verification against fixtures

- [ ] 7.1 Open `fixtures/career-site-mini/src/pages/home.liquid` in the Extension Development Host and visually confirm HTML + Liquid highlighting
- [ ] 7.2 Run "Developer: Inspect Editor Tokens and Scopes" on representative positions (HTML tag, Liquid `{{` opener, Liquid filter, Paradox `{{component:…}}`) and verify scopes match the spec
- [ ] 7.3 Open `fixtures/career-site-mini/src/components/button.liquid` and confirm `{% assign %}` and HTML interleaving render correctly
- [ ] 7.4 With `sissel.shopify-liquid` also installed, repeat 7.1–7.3 and confirm no regression
- [ ] 7.5 Confirm hover, completion, and go-to-definition from `packages/server` still work in the dev host

> **Manual verification — requires the user.** Press F5 in VS Code to launch the Extension Development Host against this workspace, then open the fixture files above. Use `Developer: Inspect Editor Tokens and Scopes` to verify the scope chains documented in `docs/paradox-tag-scopes.md`.

## 8. CI / quality gates

- [x] 8.1 Run `pnpm typecheck` and `pnpm lint` and ensure they pass
- [x] 8.2 Run `pnpm test` — existing server tests must continue to pass
- [x] 8.3 Validate the openspec change with `openspec validate fix-syntax-highlighting --strict`

> **Typecheck / lint results:**
> - `packages/client` typecheck: clean.
> - `packages/server` typecheck and lint show **pre-existing** failures (test files use non-null assertions, plus `prefer-const` on `server.ts:31`). All 121 server tests pass (`pnpm test`). These failures predate this change and are out of scope; track them separately if desired.

## 9. Ship

- [ ] 9.1 Open a PR titled "fix: add bundled HTML+Liquid syntax highlighting" with proposal/design/specs linked
- [ ] 9.2 After merge, build the VSIX and attach to the next tag/release
- [ ] 9.3 Run `openspec archive fix-syntax-highlighting` to fold the spec deltas into `openspec/specs/`

> **User actions remaining.**
