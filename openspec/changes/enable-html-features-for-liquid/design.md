## Context

A `.liquid` file is highlighted as HTML — the extension ships a `text.html.liquid` TextMate grammar that injects `text.html.basic`, and the grammar declares `embeddedLanguages: { "text.html.basic": "html" }`. That mapping (plus the recently added Emmet default) gives token-level HTML treatment and abbreviation expansion, but it does **not** route IntelliSense: VS Code's HTML language service lives in the built-in `html-language-features` extension, whose providers are registered for `documentSelector` `html` / `handlebars` / `razor`. They never see a `liquid` document, so tag/attribute completion, element hover, auto-closing tags, and tag-pair rename are all absent in the HTML body of a `.liquid` file.

Current state in our LSP server (`packages/server`):

- `analyzer/tokenize.ts` already segments a document into `html` / `output` / `tag` tokens, each with a source `range`. HTML regions are therefore already identifiable.
- `providers/bucketCursor.ts` classifies a cursor offset into Liquid sub-regions or `text` (plain HTML).
- `providers/completion.ts` returns `[]` for the `text` region; `providers/hover.ts` returns Liquid hovers only.
- The server runs on `vscode-languageserver` v9 and uses `vscode-languageserver-textdocument`'s `TextDocument`. It bundles to `dist/server.cjs` via esbuild. It imports no `vscode` API (all editor glue lives in the thin client).

The missing piece is an IntelliSense engine for the HTML regions. `vscode-html-languageservice` (the same library `html-language-features` is built on, current v5.6.2) exposes exactly the surface we need against a `TextDocument`: `parseHTMLDocument`, `doComplete`, `doHover`, `doTagComplete` (returns the auto-close snippet), and `findLinkedEditingRanges`.

## Goals / Non-Goals

**Goals:**

- HTML tag-name, attribute-name, and attribute-value completions appear in the HTML regions of a `.liquid` file, matching what a `.html` buffer offers.
- HTML element/attribute hover documentation appears in HTML regions.
- Auto-closing tags: finishing a start tag inserts the matching end tag.
- Tag-pair linked editing: renaming a start tag renames its end tag and vice versa.
- All of the above are strictly confined to HTML regions; inside `{% … %}`, `{{ … }}`, `{# … #}`, and `{% comment %}` blocks the Liquid LSP stays authoritative and HTML features stay silent.
- The implementation lives entirely in the server (consistent with the "client is thin, no analysis" architecture) plus minimal client glue for the keystroke-driven auto-close request.

**Non-Goals:**

- HTML document/range formatting (chosen out of scope — masking Liquid to whitespace makes whole-document HTML formatting unsafe, and it would fight Prettier/liquid formatters).
- HTML validation/diagnostics. Diagnostics remain Liquid-only.
- Embedded CSS-in-`<style>` and JS-in-`<script>` IntelliSense.
- File-path attribute-value completion (`href`, `src`) via `doComplete2` + `DocumentContext`. Deferred; can be a follow-up.
- Liquid-aware HTML understanding (e.g., treating `{% if %}` wrappers as conditional markup). HTML and Liquid are analyzed independently per region.

## Decisions

### D1. Embed `vscode-html-languageservice` in the existing LSP server

Three approaches were considered:

1. **Embed the HTML language service in our server (chosen).** Add `vscode-html-languageservice` as a server dependency and delegate HTML-region requests to it. This is the pattern used by Vue/Vetur, Astro, and Shopify's Liquid tooling. It gives full control, keeps all analysis in the server, and reuses the document/region infrastructure we already have.
2. **Reuse the built-in `html-language-features`.** Rejected: its providers are bound to the `html`/`handlebars`/`razor` language IDs with no supported extension point to serve a third-party `liquid` document. The grammar `embeddedLanguages` mapping only drives token-level editor features, not completion/hover/rename providers.
3. **Do the HTML analysis in the client with the editor's `vscode` HTML APIs.** Rejected: it violates the established "client is a thin transport, server owns all analysis" boundary and there is no public `vscode` API that exposes the HTML service to extensions.

### D2. Serve a Liquid-masked virtual HTML document with offset parity

The HTML service must not see Liquid syntax (`{{ x | filter }}`, `{% if %}`) or it will mis-parse tags and offer nonsense. We build a **virtual HTML document**: take the original text and replace every non-HTML span with spaces, preserving newlines so that **every character offset and line/column position is identical** between the real document and the virtual one. No position remapping is needed in either direction.

- A single `htmlRegions(text)` helper (built on `analyzer/tokenize.ts`) returns the set of HTML spans. Everything outside those spans — `output` tokens, `tag` tokens, `{# … #}` inline comments, and `{% comment %} … {% endcomment %}` bodies — is masked.
- The same region set is the **single source of truth** for gating (D3): a request is "in HTML" iff its offset falls inside an HTML span.
- The parsed `HTMLDocument` is cached per `(uri, document version)` to avoid re-parsing on every keystroke, mirroring `html-language-features`.

Masking (rather than extracting/concatenating HTML fragments) is chosen because it keeps positions trivially correct and lets the HTML parser still see surrounding tag structure (e.g. a `<ul>` whose `<li>`s straddle a `{% for %}` still parses, because only the `{% for %}` characters are blanked).

### D3. Region gating from one source of truth

Each request handler first asks "is the cursor offset inside an HTML region?":

- **Completion** (`onCompletion`): in an HTML region, return `htmlService.doComplete(virtualDoc, pos, htmlDoc)` as **native LSP `CompletionItem`s** (preserving their `textEdit`/snippet `insertText`), bypassing the internal Liquid `CompletionItem` shaping. In a Liquid region, behavior is unchanged. Regions are mutually exclusive, so there is no per-position merge between HTML and Liquid items.
- **Hover** (`onHover`): HTML hover in HTML regions, Liquid hover in Liquid regions.
- Emmet is unaffected — it remains a client/editor-level contributor and continues to add abbreviation entries in HTML regions exactly as it does in `.html`.

### D4. Auto-closing tags via a custom request + thin client middleware

Auto-close is keystroke-driven, not completion-driven, so we follow the exact mechanism `html-language-features` uses:

- The client registers an `onDidChangeTextDocument` listener scoped to `language: liquid`. When the last edit inserts `>` or `/`, it sends a custom request (`liquid/tagClose`) with the document URI and position to the server.
- The server runs `htmlService.doTagComplete(virtualDoc, pos, htmlDoc)` **only if the position is in an HTML region**, and returns the snippet string (e.g. `$0</div>`) or `null`.
- The client inserts the returned snippet via `editor.insertSnippet`.

This is preferred over abusing completion trigger characters because it produces the canonical cursor-placement snippet and matches user expectation from `.html`. Gating ensures typing `>` inside `{% if a > 1 %}` never injects a close tag.

### D5. Tag-pair linked editing via the standard LSP capability

The server advertises `linkedEditingRangeProvider: true` and handles `connection.languages.onLinkedEditingRange`, returning `htmlService.findLinkedEditingRanges(virtualDoc, pos, htmlDoc)` when the position is in an HTML region (else `null`). `vscode-languageclient` v9 wires linked editing automatically once the capability is advertised, so no extra client code is required. Because ranges come from the masked virtual document, they can never extend into a Liquid region.

### D6. Extend trigger characters additively

`serverCapabilities.ts` gains `<`, `=`, `/` so attribute and tag completions fire on the keystrokes HTML authors use. `"`, `'`, and `<space>` are already advertised and are reused for attribute-value completions. The existing Liquid trigger set is unchanged, satisfying the `liquid-completions` contract (which already permits additional characters). The completion handler routes by region, so a shared trigger character (e.g. `"`) does the right thing depending on where the cursor is.

### D7. Native HTML completion items, not the internal shape

HTML-region completions are returned as the `CompletionList` the HTML service produces, preserving `textEdit` ranges and snippet `insertText` (e.g. attribute completion inserting `class="$0"`). They are not funneled through the internal `CompletionItem` interface used for Liquid items, which has no `textEdit` field. This keeps HTML behavior identical to a real `.html` buffer.

## Risks / Trade-offs

- **Offset drift between real and virtual documents** → Equal-length whitespace masking with preserved newlines guarantees 1:1 positions; unit tests assert that masking leaves length and line breaks unchanged and that a known offset maps to the same line/character in both documents.
- **HTML features leaking at a Liquid boundary** (e.g. cursor exactly at `<div {{`) → Gating uses the tokenizer-derived region map; a boundary offset resolves to its enclosing token. Fixtures cover Liquid embedded inside tags and tags straddling `{% for %}`.
- **Completions firing inside `{# … #}` or `{% comment %}`** → These spans are masked and excluded from the HTML region set, so the service sees whitespace there and offers nothing.
- **Auto-close double-insert or conflict with Emmet / language-configuration pairs** → `autoClosingPairs` in `language-configuration.json` only pairs the `<`/`>` characters, not full tag closure; the `liquid/tagClose` snippet is the sole tag-closer and is region-gated. A manual smoke test verifies a single, correct close tag.
- **Bundling `vscode-html-languageservice` into `server.cjs`** → It is pure JS with no native deps. However, the library ships a UMD `main` and an ESM `module` entry; esbuild on `platform: node` defaults to the UMD `main`, whose internal modules are pulled in via factory-injected `require('./parser/…')` calls that esbuild leaves as runtime requires — the bundle then crashes at load with `Cannot find module './parser/htmlScanner'`. The fix is `mainFields: ['module', 'main']` in `packages/server/esbuild.config.mjs` so the ESM build (static imports) is inlined. A post-build assertion fails the build loudly if any unbundled relative `require('./parser|services|languageFacts/…')` reappears, and the build task verifies a working VSIX.
- **Per-keystroke parse cost** → `parseHTMLDocument` is cached by document version; only completion/hover/linked-edit/tag-close requests parse, and only on cache miss.
- **Coupling to the HTML service's behavior** → Acceptable and intentional; we explicitly want parity with VS Code's own HTML experience, and the same library backs it.

## Migration Plan

1. Add the dependency and implement the server-side HTML provider + region helper behind the existing request handlers (no behavior change in Liquid regions).
2. Add the client `liquid/tagClose` middleware and the `linkedEditingRange` capability.
3. Bundle, bump the client `version`, and update `CHANGELOG.md`, `README.md`, and `docs/completion-surfaces.md`.

The change is purely additive and stateless — no settings migration. **Rollback** is a straight revert of the change; uninstalling/downgrading restores the prior behavior with no residue (no user settings are written).

## Open Questions

- Should we expose an opt-out setting (e.g. `liquidParadox.html.suggest: false`) for users who only want Liquid + Emmet? Proposed default: HTML IntelliSense on, opt-out deferred unless requested.
- Should auto-close also special-case void/self-closing elements beyond what `doTagComplete` returns by default? Default: rely on the library's behavior.
- Future enhancement: wire `doComplete2` + a `DocumentContext` so `href`/`src` attribute values offer workspace path completions (reusing our existing file index).
