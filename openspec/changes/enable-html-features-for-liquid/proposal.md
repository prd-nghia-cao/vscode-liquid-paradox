## Why

`.liquid` files are HTML documents with templating woven in, but the editor gives them almost no HTML IntelliSense. VS Code's HTML language features (tag/attribute/value completions, element hover docs, auto-closing tags, tag-pair rename) are bound to `languageId: html` and never fire for `liquid`, so authors editing the HTML body of a `.liquid` file get only Emmet abbreviations and our Liquid completions — none of the standard "type `<` and pick a tag", "type a space inside a tag and pick an attribute", or "close the tag automatically" affordances they get in a plain `.html` file. We already ship the HTML grammar embedded in `liquid`; the IntelliSense layer is the missing piece.

## What Changes

- The language server embeds VS Code's `vscode-html-languageservice` and serves HTML IntelliSense for the **HTML regions** of `.liquid` documents — the same regions where Emmet is allowed and where our Liquid LSP currently returns nothing.
- New completion surfaces in HTML regions: tag-name completions (after `<`), attribute-name completions (inside an open tag), and attribute-value completions (after `=` / inside quotes), sourced from the HTML5 data set.
- New hover: hovering an HTML element or attribute in an HTML region shows the standard HTML documentation.
- New auto-closing tags: typing `>` to finish a start tag (or `</`) inserts the matching close tag, exactly as in `.html`.
- New tag-pair linked editing (rename): editing a start-tag name updates the matching end-tag name, and vice versa.
- HTML features are strictly **region-gated**: inside `{% … %}`, `{{ … }}`, and `{# … #}` the existing Liquid LSP stays authoritative and the HTML service stays silent, so HTML completions can never corrupt Liquid syntax.
- The server advertises the extra completion trigger characters HTML needs (`<`, `=`, `/`) in addition to the existing Liquid set, and declares the new `linkedEditingRange` capability.

## Capabilities

### New Capabilities

- `html-intellisense`: HTML language-service-backed IntelliSense (tag / attribute / attribute-value completions, element & attribute hover, auto-closing tags, and tag-pair linked editing) for the HTML regions of `.liquid` documents, served by an embedded `vscode-html-languageservice` over a Liquid-masked virtual document and gated so it never activates inside Liquid delimiters.

### Modified Capabilities

_None. `liquid-completions` is unchanged — Liquid-construct completions and the existing trigger-character contract still hold (the spec already permits additional trigger characters, so adding `<`, `=`, `/` does not alter its requirements). `syntax-highlighting` is untouched._

## Impact

- `packages/server/package.json` — adds a runtime dependency on `vscode-html-languageservice`.
- `packages/server/src/providers/` — new HTML provider module that builds the masked virtual HTML document and delegates completion/hover to the HTML service; `completion.ts` dispatch in the `text` region changes from "return `[]`" to "return HTML items".
- `packages/server/src/server.ts` & `serverCapabilities.ts` — registers `linkedEditingRangeProvider`, wires the auto-close-tag and linked-editing handlers, and extends `completionProvider.triggerCharacters` with `<`, `=`, `/`.
- `packages/client/src/extension.ts` & `package.json` — adds the `linkedEditingRange` document-selector wiring if needed and the auto-close-tag client glue; no new client runtime deps beyond what `vscode-languageclient` already provides.
- `README.md` / `docs/completion-surfaces.md` — document the new HTML IntelliSense surfaces and the HTML-vs-Liquid region boundary.
- VSIX size grows by the `vscode-html-languageservice` bundle (tens of KB, bundled by esbuild). No change to syntax highlighting, Emmet, or existing Liquid features.
