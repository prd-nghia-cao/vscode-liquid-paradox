## 1. Dependency and HTML service scaffolding

- [x] 1.1 Add `vscode-html-languageservice` (^5.6.0) to `dependencies` in `packages/server/package.json` and run `pnpm install`.
- [x] 1.2 Add `packages/server/src/providers/html/htmlService.ts` that lazily creates a single `getLanguageService()` instance and caches the parsed `HTMLDocument` keyed by `(uri, document version)`.
- [x] 1.3 Confirm esbuild bundles the new dependency by running `pnpm --filter @vscode-liquid-paradox/server build` and checking `dist/server.cjs` is produced without warnings.

## 2. HTML region map and masked virtual document

- [x] 2.1 Add `packages/server/src/providers/html/htmlRegions.ts` exporting `htmlRegions(text)` that returns the HTML spans by reusing `analyzer/tokenize.ts`, masking `output` and `tag` tokens, `{# … #}` inline comments, and `{% comment %} … {% endcomment %}` bodies.
- [x] 2.2 Add `buildVirtualHtmlDocument(uri, version, text)` that returns a `TextDocument` whose non-HTML spans are replaced by spaces with all newlines preserved (1:1 offset/position parity with the source).
- [x] 2.3 Add `isInHtmlRegion(text, offset)` built on the same region map, used to gate every HTML request.
- [x] 2.4 Write `htmlRegions.test.ts`: assert the virtual doc has identical length and line breaks to the source, that a known offset maps to the same line/character in both, that Liquid spans are blanked, and that boundary offsets (`<div {{`, tag straddling `{% for %}`, cursor inside `{# #}`) classify correctly.

## 3. Completion integration

- [x] 3.1 In `packages/server/src/server.ts` `onCompletion`, when `isInHtmlRegion` is true, return `htmlService.doComplete(virtualDoc, pos, htmlDoc)` as native LSP `CompletionItem`s (preserving `textEdit`/snippet `insertText`) and skip the internal Liquid shaping.
- [x] 3.2 Keep the existing Liquid path unchanged for all non-HTML regions (regions are mutually exclusive; no per-position merge).
- [x] 3.3 Add a server/provider test covering tag-name (`<di`), attribute-name (`<a hre`), and attribute-value (`<input type="`) completions in an HTML region, and asserting an empty/Liquid-only result inside `{% %}`, `{{ }}`, and `{# #}`.

## 4. Hover integration

- [x] 4.1 In `onHover`, when `isInHtmlRegion` is true, return `htmlService.doHover(virtualDoc, pos, htmlDoc)`; otherwise return the existing Liquid hover.
- [x] 4.2 Add a test asserting HTML element hover in an HTML region and unchanged Liquid hover inside `{{ … }}`.

## 5. Auto-closing tags

- [x] 5.1 Add a server request handler for a custom `liquid/tagClose` request that runs `htmlService.doTagComplete(virtualDoc, pos, htmlDoc)` only when `isInHtmlRegion` is true and returns the snippet string or `null`.
- [x] 5.2 In `packages/client/src/extension.ts`, register an `onDidChangeTextDocument` listener scoped to `language: liquid` that, on insertion of `>` or `/`, sends `liquid/tagClose` and applies the returned snippet via `editor.insertSnippet`.
- [x] 5.3 Add a server test asserting `doTagComplete` returns a close snippet for `<section>` in an HTML region and `null` for `>` typed inside `{% if a > 1 %}`.

## 6. Tag-pair linked editing

- [x] 6.1 In `server.ts` `onInitialize`, advertise `linkedEditingRangeProvider: true`.
- [x] 6.2 Register `connection.languages.onLinkedEditingRange` returning `htmlService.findLinkedEditingRanges(virtualDoc, pos, htmlDoc)` when `isInHtmlRegion` is true, else `null`.
- [x] 6.3 Add a test asserting matched start/end ranges for `<section>…</section>` in an HTML region and `null` inside `{% … %}` / `{{ … }}`.

## 7. Trigger characters and capabilities

- [x] 7.1 Extend `COMPLETION_TRIGGER_CHARACTERS` in `packages/server/src/serverCapabilities.ts` with `<`, `=`, `/`.
- [x] 7.2 Update `serverCapabilities.test.ts` to assert the new characters are present and the existing Liquid characters are retained.
- [x] 7.3 Update `server.ts` `InitializeResult` if needed and confirm `serverState`/capabilities tests still pass.

## 8. Documentation

- [x] 8.1 Add a Features bullet to `README.md` describing HTML IntelliSense (tag/attribute/value completions, hover, auto-close, tag-pair rename) in HTML regions of `.liquid` files, and that HTML features stay silent inside Liquid delimiters.
- [x] 8.2 Add the HTML region to `docs/completion-surfaces.md`, noting it is served by the embedded HTML language service.
- [x] 8.3 Append a `## <next-version>` entry to `CHANGELOG.md` under Added for HTML IntelliSense.
- [x] 8.4 Bump `version` in `packages/client/package.json` to match the new `CHANGELOG.md` heading.

## 9. Build, typecheck, lint, and package

- [x] 9.1 Run `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test`, and `pnpm lint`; fix any failures.
- [x] 9.2 Run `pnpm --filter @vscode-liquid-paradox/server build && pnpm --filter vscode-liquid-paradox build && pnpm --filter vscode-liquid-paradox package` and confirm a warning-free VSIX is produced.

## 10. Manual verification in the Extension Dev Host

- [ ] 10.1 Launch the Extension Dev Host (F5) against `fixtures/career-site-mini` and open a `.liquid` file.
- [ ] 10.2 In HTML body, confirm `<di` offers `div`, `<a hre` offers `href`, and `<input type="` offers value completions.
- [ ] 10.3 Confirm typing `<section>` auto-inserts `</section>` with the cursor between the tags.
- [ ] 10.4 Confirm renaming a start tag updates its matching end tag (linked editing).
- [ ] 10.5 Confirm HTML element hover works in HTML body and Liquid hover is unchanged inside `{{ … }}`.
- [ ] 10.6 Confirm no HTML completions, hover, auto-close, or linked editing fire inside `{% … %}`, `{{ … }}`, or `{# … #}`, and that Liquid completions/diagnostics are unchanged.
- [ ] 10.7 Confirm Emmet abbreviation expansion still works in HTML regions alongside the new HTML completions.

## 11. Validate and archive

- [x] 11.1 Run `openspec validate enable-html-features-for-liquid` and resolve any errors.
- [ ] 11.2 After all checks pass, run `/opsx:archive` (or `openspec archive enable-html-features-for-liquid`) to merge `specs/html-intellisense/spec.md` into `openspec/specs/` and move the change to `openspec/changes/archive/`.
