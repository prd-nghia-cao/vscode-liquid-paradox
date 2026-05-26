## Why

`.liquid` files are HTML documents with templating embedded — yet Emmet (VS Code's built-in HTML/CSS abbreviation expander) does not activate for the `liquid` language, so authors lose ergonomic shortcuts like `ul>li*3`, `div.card>h2{Title}+p`, and `.btn--primary`. Every other Liquid extension we coexist with relies on the user manually adding `"emmet.includeLanguages": { "liquid": "html" }` to their settings; users keep filing this as a defect because they expect it to "just work" given that we ship the HTML grammar embedded in our `liquid` grammar.

## What Changes

- The extension contributes a default configuration that maps the `liquid` language to `html` for Emmet, enabling abbreviation expansion and Emmet completions inside `.liquid` files out of the box.
- Emmet activates only inside HTML regions of the document — inside `{% … %}` / `{{ … }}` / `{# … #}` Liquid constructs, our existing LSP completions remain authoritative and Emmet must not interfere.
- README documents that Emmet is enabled by default and how users can opt out via `emmet.excludeLanguages` if desired.

## Capabilities

### New Capabilities

- `liquid-emmet`: Default Emmet activation for `.liquid` files via `configurationDefaults` in the extension manifest, including the rule that Emmet only fires in HTML regions (not inside Liquid delimiters).

### Modified Capabilities

_None — this is purely additive editor integration; existing `syntax-highlighting` scopes and `liquid-completions` provider behavior are unchanged._

## Impact

- `packages/client/package.json` — adds a `contributes.configurationDefaults` block setting `emmet.includeLanguages` for `liquid`.
- `README.md` — short note under Features that Emmet works out of the box.
- No server-side code changes; no new runtime dependencies; no impact on VSIX size beyond a few manifest bytes.
- User-overridable: any value the user sets in their own `settings.json` for `emmet.includeLanguages` continues to win, per VS Code's `configurationDefaults` precedence rules.
