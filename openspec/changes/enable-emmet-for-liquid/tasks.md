## 1. Manifest contribution

- [x] 1.1 Add a top-level `contributes.configurationDefaults` block to `packages/client/package.json` that sets `"emmet.includeLanguages": { "liquid": "html" }`.
- [x] 1.2 Confirm the existing `contributes.languages` and `contributes.grammars` entries still validate after the edit (run `pnpm --filter vscode-liquid-paradox package` and check the `vsce` output for warnings).

## 2. Documentation

- [x] 2.1 Add a bullet under the Features section of `README.md` stating that Emmet abbreviation expansion is enabled out of the box for `.liquid` files.
- [x] 2.2 Document the opt-out path in `README.md`: a user can disable Emmet for Liquid by adding `"emmet.excludeLanguages": ["liquid"]` to their `settings.json`.
- [x] 2.3 Append an entry to `CHANGELOG.md` under a new `## <next-version>` section noting that Emmet is enabled by default.

## 3. Manual verification in the Extension Dev Host

- [ ] 3.1 Launch the Extension Dev Host (F5) against the `fixtures/career-site-mini` workspace.
- [ ] 3.2 Open `src/partials/testimonials.liquid` (or any `.liquid` file) and confirm typing `ul>li*3` followed by `Tab` expands to the canonical Emmet HTML output.
- [ ] 3.3 Position the cursor inside `{% if x %}` and confirm typing `div.card` followed by `Tab` does NOT expand — LSP completions remain authoritative.
- [ ] 3.4 Position the cursor inside `{{ … }}` and confirm Emmet stays silent.
- [ ] 3.5 Add `"emmet.includeLanguages": { "liquid": "xml" }` to the dev host's user `settings.json`, reload, and confirm the user override takes effect.
- [ ] 3.6 Remove the override, add `"emmet.excludeLanguages": ["liquid"]`, reload, and confirm Emmet no longer fires anywhere in `.liquid` files.

## 4. Coexistence check

- [ ] 4.1 With the dev host running, install `sissel.shopify-liquid` from the marketplace into the dev host profile.
- [ ] 4.2 Open the same `.liquid` file and confirm Emmet still expands exactly once (no duplicate menu entries, no warnings in the Extensions output panel).
- [ ] 4.3 Uninstall `sissel.shopify-liquid` from the dev host profile to leave it clean for the next iteration.

## 5. Package and release readiness

- [x] 5.1 Run `pnpm --filter @vscode-liquid-paradox/server build && pnpm --filter vscode-liquid-paradox build && pnpm --filter vscode-liquid-paradox package` and confirm a fresh VSIX is produced without warnings.
- [ ] 5.2 Install the produced VSIX into a clean VS Code profile (`code --install-extension packages/client/vscode-liquid-paradox-*.vsix --profile-temp` or similar) and re-run the spot-check from 3.2 to confirm Emmet works on a real installation.
- [x] 5.3 Bump `version` in `packages/client/package.json` to the value referenced in the new `CHANGELOG.md` heading.

## 6. Archive the change

- [x] 6.1 After all manual checks pass, run `openspec validate enable-emmet-for-liquid` and ensure no errors are reported.
- [ ] 6.2 Run `/opsx:archive` (or `openspec archive enable-emmet-for-liquid`) to move the change into `openspec/changes/archive/` and merge `specs/liquid-emmet/spec.md` into `openspec/specs/`.
