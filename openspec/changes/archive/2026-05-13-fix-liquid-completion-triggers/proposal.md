## Why

Typing `{%` or `{{` in a `.liquid` file is the single most common entry point into LiquidJS authoring, yet the extension shows nothing — no tag list after `{%`, no variable/filter list after `{{`. The LSP server already implements `completion`, but a combination of trigger-character coverage, auto-closing-pair interference, an over-narrow expression-context detector, and the absence of static fallbacks (filters, common Liquid operators, snippet-like tag bodies) means real users see an empty list at exactly the moments completion is most useful. This makes the extension feel broken even though `provideCompletions` exists.

## What Changes

- Make the completion trigger-character set reliable: register the second character of every Liquid delimiter (`{`, `%`, `}`) and `:` (for Paradox kinds), and re-trigger inside open expressions after whitespace via a small "manual-invoke is always honored" path.
- Make `provideCompletions` resilient to the auto-closing pair side-effect: when `language-configuration.json` inserts ` %}` / ` }}` after the cursor, the open-tag detector must still classify the cursor as "inside a `{% %}` / `{{ }}` body" and offer the correct list (tag names, filters, variables, operators).
- Inside `{% … %}`: after the tag name, always suggest the tag's expected continuation — keywords (`in`, `with`, `as`, `reversed`, `offset:`, `limit:`), operators (`and`, `or`, `==`, `!=`, etc.), local + JSON-companion variables, and component/partial/layout string completions where applicable.
- Inside `{{ … }}`: always suggest in-scope variables, then a pipe-friendly filter list once `|` is typed. Add a small built-in scope (`forloop`, `tablerowloop`, `nil`, `empty`, `blank`, `true`, `false`) so the list is never empty even at the root of a fresh file.
- Add Paradox kind completions for `{{component:`, `{{snippet:`, `{{data:`, `{{attribute:` so authors can discover them once they type `:` after `{{`.
- Keep `paradoxOutputRanges` suppressing standard Liquid completions inside a confirmed Paradox tag, but only after the kind keyword + `:` is parsed — not for partial input like `{{co`.
- **BREAKING (developer-facing only)**: `provideCompletions` signature gains an optional `triggerKind` parameter and the LSP `completionProvider.triggerCharacters` list changes; downstream tests must update fixtures.

## Capabilities

### New Capabilities
- `liquid-completions`: covers what completion items are produced for every position inside `{% … %}`, `{{ … }}`, Paradox tags, render/layout/include string paths, and dotted property access, including the trigger characters and behavior expected from the LSP `completionProvider` capability.

### Modified Capabilities
<!-- syntax-highlighting was introduced by the prior change but is not yet archived under openspec/specs/; nothing to modify here. -->

## Impact

- `packages/server/src/server.ts`: extend `completionProvider.triggerCharacters` and pass through `context.triggerKind` to `provideCompletions`.
- `packages/server/src/providers/completion.ts`: rewrite the `detectTagOpeningContext`, `isInExpressionContext`, and `isAfterPipe` helpers to honor cursor position relative to an auto-inserted closing delimiter, and add fallback static lists (Liquid keywords, operators, Paradox kinds, common built-ins).
- `packages/server/src/providers/completion.test.ts`: add cases for cursors immediately after `{%`, `{{`, after `{%-`, after `{{-`, after a pipe with no preceding space, after `{%- if` (keyword vs variable), and inside `{{component:`.
- `packages/server/src/data/`: introduce (or extend) tables for Liquid operators, Paradox kinds, and per-tag continuation keywords.
- `packages/client/language-configuration.json`: revisit the auto-closing-pair entries that currently insert a leading space (` %}` / ` }}`). Either drop the leading space or have completion logic treat the inserted space transparently — pick one and document the choice in `design.md`.
- No changes to grammar files; this is purely an LSP-side fix.
- Documentation: update `README.md` / `docs/` with the supported completion surfaces so users know what to expect.
