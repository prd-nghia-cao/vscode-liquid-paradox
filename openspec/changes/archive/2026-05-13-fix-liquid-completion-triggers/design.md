## Context

`packages/server/src/providers/completion.ts` already implements an `onCompletion` flow keyed off heuristic text scans (`detectTagOpeningContext`, `detectStringLiteralContext`, `detectRenderArgContext`, `isAfterPipe`, `isInExpressionContext`). The unit tests in `completion.test.ts` exercise this with inputs like `'{% '` and `'{{ '` — always with a trailing space — and pass. In live editing, the situation differs in three subtle ways:

1. `packages/client/language-configuration.json` declares `autoClosingPairs` of `{ "open": "{%", "close": " %}" }` and `{ "open": "{{", "close": " }}" }` (note the leading space inside the closer). After the user types `{%`, the document buffer becomes `{% %}` with the cursor at offset 2. The body the user is editing is *empty*, sandwiched between the open delimiter and a synthetically-inserted space + close delimiter.
2. `completionProvider.triggerCharacters` is `['{', '%', '|', '"', "'", '.', ',']`. The trigger character `{` fires once on the first keystroke (when only `{` exists, so `detectTagOpeningContext` returns `null` and we yield an empty list). For the *second* `{` or for `%`, the trigger fires again, but at that moment we are inside a body that is at most 0–1 chars long and the existing detectors expect non-trivial content. We never re-trigger as the user continues to type letters into the body, so the user sees zero items the first time, then nothing further until they manually invoke completion (Ctrl+Space).
3. `provideCompletions` returns `[]` for `{{ }}` at root when there is no `.liquid.json` companion and no `assign`/`for`/`capture` in scope. The user perceives this as "completions are broken". They are not — there genuinely are no in-scope variables — but the UX is indistinguishable from a bug, and we control the LSP, so we should always offer *something* useful (filters, builtins, snippet expansions).

The server already passes `paradoxOutputRanges` through the model; the completion provider must avoid recommending standard Liquid items only when the cursor is *inside* a Paradox output the prepass has confirmed. Partially typed `{{component` should still see Paradox-kind completions before being suppressed.

The language client (`packages/client/src/extension.ts`) and the `paradox.injection` TextMate grammar are unaffected. The server already runs in dev via `packages/server/dist/server.cjs` and is wired through `vscode-languageclient`.

Stakeholders: Paradox template authors (primary), maintainers of `packages/server`, and the LSP `completionProvider` capability surface exposed to VS Code.

## Goals / Non-Goals

**Goals:**
- Typing `{%` produces an immediate list of Liquid tag names (`if`, `for`, `assign`, `render`, `layout`, `comment`, `case`, `unless`, `capture`, `tablerow`, `liquid`, `cycle`, `include`, `echo`, `decrement`, `increment`, `paginate`, `raw`, `break`, `continue`, `else`, `elsif`).
- Typing `{{` produces an immediate list of in-scope variables, falling back to Liquid built-ins (`forloop`, `tablerowloop`, `nil`, `null`, `empty`, `blank`, `true`, `false`) and a `|` snippet that drops the user into the filter list.
- Typing `|` inside `{% … %}` or `{{ … }}` produces the filter list, regardless of whether there is a space before the pipe.
- Typing `:` after `{{component`, `{{snippet`, `{{data`, `{{attribute` produces a Paradox-value list (page IDs, snippet keys, data fields, attribute names — initially a placeholder while indexing matures).
- Typing the first letter of a tag inside `{% … %}` (e.g. `{%a` or `{% a`) filters tag names without the editor needing a separate Ctrl+Space.
- The `autoClosingPairs` injected leading space (`{% %}`, `{{ }}`) does not prevent any of the above.

**Non-Goals:**
- Semantic completion driven by liquidjs runtime introspection.
- Snippet bodies that auto-insert end tags or block wrappers (covered by `editor.suggestOnTriggerCharacters` + future "tag snippet" work, tracked separately).
- Completion across `render` boundaries (i.e. surfacing the *callee's* props as completions in the *caller* — already exists for `{% render "x", `, not changing here).
- Trigger or fix completion inside `<style>` / `<script>` embedded blocks (deferred with the syntax-highlighting non-goal).
- Resolving Paradox identifier values (component names, snippet keys) — this change ships the surface; data sources can be added incrementally.

## Decisions

### Decision 1: Expand `completionProvider.triggerCharacters` to `['{', '%', '}', '|', '"', "'", '.', ',', ':', '-', ' ']`

Add `'}'` so completions can refresh as the user moves past the closing delimiter, `':'` for Paradox tags, `'-'` for `{%-` / `{{-` whitespace-strip forms, and `' '` so completion re-triggers after a token (e.g. `{% if `, `{% for x in `). Keep the existing entries.

Rationale: The cost of an extra completion request is one in-process call to `provideCompletions`, which already does a cheap text-prefix scan. The user benefit is that completions stay alive throughout a `{% … %}` body instead of only at the open delimiter.

Alternatives considered:
- Rely on `editor.suggestOnTriggerCharacters` plus VS Code's word-completion default. Rejected: that yields a generic word list and never offers tag/filter metadata.
- Mark every alphanumeric character as a trigger. Rejected: spammy, ignores user-disabled auto-suggest, and the LSP spec discourages alphanumerics in `triggerCharacters`.

### Decision 2: Make all detectors anchor on the cursor offset, not the absolute string contents

The current `detectTagOpeningContext`, `isAfterPipe`, and `isInExpressionContext` already slice `text.slice(0, offset)` — that part is correct. What changes is:
- `detectTagOpeningContext` will also accept the case where the prefix ends in `{%-?` followed by an optional space and an optional word fragment (currently handled), AND the case where the *suffix* immediately after the cursor is ` %}` (auto-inserted close). The suffix check is `text.slice(offset, offset + 3) === ' %}'` and is informational only — we do not require it; we just no longer get confused by the unmatched close at higher offsets.
- `isInExpressionContext` will switch from "compare `lastIndexOf('{{')` vs `lastIndexOf('}}')`" to "walk backwards from `offset` looking for the nearest `{{`, `{%`, `}}`, `%}` and bucket the cursor into `output`, `tag`, `text`, or `paradox` regions". This is O(n) on the prefix length but typically scans only a few hundred chars before bailing.

Rationale: A pure-prefix view ignores the auto-inserted closer that lives *after* the cursor; a backward walk over the prefix is robust regardless of the suffix and is symmetric to how `paradoxOutputRanges` is built.

Alternatives considered:
- Use the existing AST + `paradoxOutputRanges` to bucket the cursor. Rejected for the *open delimiter* case because typing `{%` with no `%}` yet often makes liquidjs's tokenizer emit a `TokenizeError` for the rest of the file, dropping the in-progress tag from the AST. We need a syntax-error-tolerant detector for the cursor.
- Maintain a separate streaming parser. Rejected: overkill; a backward scan from the cursor is sufficient.

### Decision 3: Always return at least one useful list inside `{% … %}` and `{{ … }}`

Concrete fallback order:

For `{% <empty> %}` or `{% <prefix>`:
1. Tag names from `data/tags.ts` filtered by the word prefix.

For `{% <tag-name> <expr>`:
1. Per-tag continuation keywords (e.g. `if` → operators + variables; `for` → `var`, `in`, `reversed`, `offset:`, `limit:`; `assign` → variable-name placeholder then `=`).
2. In-scope variables (already implemented).
3. Liquid operators (`and`, `or`, `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`).

For `{{ <empty> }}` or `{{ <prefix>`:
1. In-scope variables (already implemented).
2. Liquid built-ins (`forloop` only when inside a `for` body — already handled by scope; `nil`, `null`, `empty`, `blank`, `true`, `false` always).
3. A single sentinel `|` item with `insertText: " | "` that immediately re-triggers and offers filters. Rejected variant: insert nothing — too easy to miss.

For `{{ <expr> |`:
1. Filters from `data/filters.ts`. Already implemented; verify pipe regex tolerates `|` with no leading space.

For `{{component:`, `{{snippet:`, `{{data:`, `{{attribute:`:
1. A static placeholder set sourced from `data/paradoxTags.ts`. Phase-2 (out of scope here) wires this to the workspace index.

Rationale: We control the trigger surface, so we should make sure each surface yields *something* — empty completion lists are indistinguishable from "extension broken" to users.

Alternatives considered:
- Keep returning `[]` when there are no in-scope variables. Rejected: that is the bug we are fixing.
- Auto-insert tag bodies as snippets (`{% if ${1} %}${2}{% endif %}`). Promising but interacts with `language-configuration.json` indentation rules; deferred to a follow-up change.

### Decision 4: Treat `paradoxOutputRanges` as authoritative *only after* the kind keyword + `:` is present

`runParadoxPrepass` only marks an output as Paradox once the regex `^(component|snippet|data|attribute):…$` matches the full body. Today `isInsideParadoxTag` short-circuits the entire completion to `[]`. We will:

1. Keep that short-circuit when the cursor sits inside a *confirmed* paradox output (the existing check).
2. Add an "early intent" detector that recognizes prefixes `{{component`, `{{snippet`, `{{data`, `{{attribute` (no colon yet) and offers the four kind keywords as completions, even though no kind has been confirmed.
3. After `:`, switch to the kind-specific value list.

Rationale: Without (2), users see no help when typing `{{co` because the prepass hasn't matched yet, but standard Liquid completion isn't appropriate either. We need a third state: "looks like a paradox tag, suggest kinds".

Alternatives considered:
- Inline paradox-kind detection inside the existing `isInExpressionContext`. Rejected: muddies that helper.

### Decision 5: Drop the leading space in `autoClosingPairs` for `{%`/`{{`

Change `language-configuration.json`:
- `{ "open": "{%", "close": " %}" }` → `{ "open": "{%", "close": "%}" }`
- `{ "open": "{{", "close": " }}" }` → `{ "open": "{{", "close": "}}" }`

Then add `surroundingPairs` and the existing `brackets` declarations unchanged. The leading space was originally for visual padding but it (a) makes the typed text immediately *look* finished even before any content is written, and (b) interacts badly with subsequent `:` / variable typing because the auto-inserted space lives at the cursor position.

Rationale: VS Code's snippet expansion (and our own filter snippet from Decision 3) can insert spaces explicitly when they belong. Auto-closing should produce minimum-syntactically-valid pairs.

Trade-off: Users who relied on the leading space will need to re-type a space. Acceptable: the population is small, and the previous behavior was a recent addition.

Alternatives considered:
- Keep the leading space and have completion logic treat the inserted space transparently. Rejected: too easy to regress; better to fix at source.

### Decision 6: Honor `CompletionContext.triggerKind`

The LSP's `CompletionParams.context.triggerKind` distinguishes manual (`Invoked = 1`), trigger-char (`TriggerCharacter = 2`), and incomplete-completions (`TriggerForIncompleteCompletions = 3`). On `Invoked`, the user explicitly asked for completion (Ctrl+Space) — we should *never* return `[]` in that case. On `TriggerCharacter`, returning `[]` is acceptable when there is genuinely no list. We will plumb the trigger kind through `provideCompletions` (optional parameter; tests default to `Invoked`) and use it to force a "best-effort" path that prefers any non-empty fallback.

Rationale: Aligns our behavior with VS Code's expectations and removes accidental empty lists for the Ctrl+Space user.

### Decision 7: Keep `completion.test.ts` as the source of truth, and pin new behaviors with new cases

We will not delete or weaken existing tests. New cases:
- `'{%'` at offset 2 → returns tag names (no trailing space).
- `'{{'` at offset 2 → returns at least the built-in scope plus the `|` sentinel.
- `'{% if '` at offset 6 → returns variables + operators.
- `'{% for x '` at offset 9 → returns `in` first.
- `'{{ x|'` at offset 5 → returns filters (no space before pipe).
- `'{{co'` at offset 4 → returns paradox kinds (`component`, `snippet`, `data`, `attribute`).
- `'{{component:'` at offset 12 → returns paradox-value placeholders.
- Invoked completion at offset 0 of an empty document → returns `[]` (no false positives outside a Liquid construct).

## Risks / Trade-offs

- **Risk**: Adding `' '` and `'}'` to `triggerCharacters` could create noisy completion popups in plain HTML regions of a `.liquid` file. → **Mitigation**: The detectors gate all returns by "are we inside a Liquid construct?" — if not, return `[]`. Adding trigger characters is safe as long as the body of `provideCompletions` is conservative.
- **Risk**: The backward-scan detector mis-buckets a position when the document contains nested or malformed delimiters (`{% if {{ x }} %}`). → **Mitigation**: Liquid does not legally nest output inside tags; treat the *innermost* opening delimiter as the cursor's home and document the heuristic. Add fixtures for malformed cases.
- **Risk**: Dropping the leading space in `autoClosingPairs` regresses users who liked it. → **Mitigation**: Document the change in `CHANGELOG.md`; offer a settings-driven re-enable in a later change if requested.
- **Risk**: Static paradox-value placeholders confuse users who expect real component names. → **Mitigation**: Label items clearly (`detail: 'paradox kind — placeholder, real values populated by workspace index'`) and track the index work as a follow-up.
- **Risk**: Completion latency under typing if `triggerCharacters` expands. → **Mitigation**: `provideCompletions` is synchronous and operates on the existing analyzed model; no extra I/O. Benchmark in `completion.test.ts` if needed.
- **Risk**: The fallback `|` sentinel inserts ` | ` which trips `isAfterPipe` immediately, looping. → **Mitigation**: Mark the inserted text with a `commitCharacters` boundary, and treat the post-insert position as a new manual trigger.

## Migration Plan

1. Land server changes (Decisions 1–4, 6, 7) in one commit. Tests pass, no client changes required to verify in dev host.
2. Land `language-configuration.json` change (Decision 5) in a second commit; bump `packages/client/package.json` patch version.
3. Rebuild both packages, repackage the VSIX, manual-verify with `fixtures/career-site-mini/`.
4. Update `CHANGELOG.md` and the `docs/` reference for completion surfaces.
5. Rollback: each commit is independently revertable. The server change is the high-value half; revert only Decision 5 if the auto-close change proves controversial.

## Open Questions

- Should `paginate` and `liquid` tags get bespoke continuation completions, or is the generic operator+variables fallback sufficient for v1? Leaning toward generic for v1; revisit after dogfooding.
- Should the `|` sentinel item appear at the top or bottom of the `{{` completion list? Top makes filters discoverable; bottom is less intrusive. Default: top, with a low `sortText` priority.
- Do we want to gate built-ins (`nil`, `null`, etc.) behind a setting? Not for v1; they are universally valid in Liquid.
- Is there a need to register `completionItem.resolve` for documentation? Today we inline `documentation`; if the lists grow, resolve-lazy may help. Out of scope.
