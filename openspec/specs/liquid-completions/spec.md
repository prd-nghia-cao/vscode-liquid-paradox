# liquid-completions

## Purpose

Define what completion items the Liquid Paradox LSP produces for every cursor position inside a `.liquid` document — `{% … %}` tag bodies, `{{ … }}` output expressions, pipe-and-filter regions, Paradox-shaped outputs, `render` / `include` / `layout` string-literal paths, dotted property access, and render kwargs. This capability also pins the `completionProvider.triggerCharacters` set advertised at LSP initialization and the auto-closing-pair contract on the client side, so that completions reliably fire on the keystrokes authors actually type (`{`, `%`, `}`, `|`, `"`, `'`, `.`, `,`, `:`, `-`, `<space>`) without being defeated by editor auto-insertion of closing delimiters.

## Requirements

### Requirement: LSP server SHALL advertise an expanded trigger-character set for Liquid completions

The server's `InitializeResult.capabilities.completionProvider.triggerCharacters` MUST include at minimum: `{`, `%`, `}`, `|`, `"`, `'`, `.`, `,`, `:`, `-`, ` ` (single space). The list MAY include additional characters but MUST NOT omit any of these.

#### Scenario: Initialization advertises all required trigger characters

- **WHEN** the language client sends an `initialize` request
- **THEN** the server's response sets `completionProvider.triggerCharacters` to an array containing every character in `{ % } | " ' . , : - <space>`

#### Scenario: Typing a space inside an open tag re-triggers completions

- **WHEN** the user has typed `{% for x ` in a `.liquid` document and the editor sends a completion request with trigger character `' '`
- **THEN** the server responds with a non-empty list that includes the keyword `in`

### Requirement: Tag-name completions SHALL appear immediately after an open `{%` or `{%-` delimiter

When the cursor is positioned immediately after `{%` or `{%-` (with no intervening non-whitespace token in the same tag body), `provideCompletions` MUST return a list of LiquidJS tag names sourced from `packages/server/src/data/tags.ts`. The list MUST include at minimum: `if`, `unless`, `for`, `case`, `when`, `else`, `elsif`, `endif`, `endfor`, `endcase`, `endunless`, `assign`, `capture`, `endcapture`, `render`, `include`, `layout`, `comment`, `endcomment`, `tablerow`, `endtablerow`, `liquid`, `raw`, `endraw`, `cycle`, `decrement`, `increment`, `echo`, `paginate`, `endpaginate`, `break`, `continue`. Each item MUST set `kind: 'Keyword'` and `detail: 'tag'`.

#### Scenario: Cursor immediately after `{%` returns tag completions

- **WHEN** the document text is `{%` and the completion position is at line 0, character 2
- **THEN** the response contains an item with `label: 'if'`, `kind: 'Keyword'`, and `detail: 'tag'`
- **AND** the response contains an item with `label: 'for'`
- **AND** the response contains an item with `label: 'assign'`

#### Scenario: Cursor immediately after `{%-` returns tag completions

- **WHEN** the document text is `{%-` and the completion position is at line 0, character 3
- **THEN** the response contains an item with `label: 'if'` and `kind: 'Keyword'`

#### Scenario: Auto-inserted `%}` does not suppress tag completions

- **WHEN** the document text is `{% %}` (auto-closed) and the completion position is at line 0, character 2
- **THEN** the response contains tag completions including `if`, `for`, and `assign`

#### Scenario: Partial tag-name prefix filters the list client-side

- **WHEN** the document text is `{% if` and the completion position is at line 0, character 5
- **THEN** the response contains at minimum the items `if` and `endif`, and the client is responsible for filtering

### Requirement: Output-expression completions SHALL appear immediately after an open `{{` or `{{-` delimiter

When the cursor is positioned immediately after `{{` or `{{-`, `provideCompletions` MUST return a non-empty list composed of: (a) all in-scope variable bindings from `model.scopeByOffset(offset)`, (b) Liquid built-in literals `nil`, `null`, `true`, `false`, `empty`, `blank`, and (c) a sentinel pipe item that re-triggers filter completions.

#### Scenario: Cursor immediately after `{{` returns variables and built-ins

- **WHEN** the document text is `{{` with no JSON companion and the completion position is at line 0, character 2
- **THEN** the response contains at minimum items with labels `nil`, `null`, `true`, `false`, `empty`, `blank`
- **AND** the response contains an item with `label: '|'` whose `detail` is `'pipe to a filter'`

#### Scenario: Cursor immediately after `{{` with a JSON companion lists JSON keys

- **WHEN** the document text is `{{` and the companion JSON is `{"title":"Hi"}` and the completion position is at line 0, character 2
- **THEN** the response contains an item with `label: 'title'` and `kind: 'Variable'`
- **AND** the response also contains the built-in literals `nil`, `null`, `true`, `false`, `empty`, `blank`

#### Scenario: Auto-inserted `}}` does not suppress output completions

- **WHEN** the document text is `{{ }}` (auto-closed, leading space removed per design Decision 5) and the completion position is at line 0, character 2
- **THEN** the response is the same as for `{{` at offset 2

### Requirement: Filter completions SHALL appear after a pipe regardless of surrounding whitespace

`provideCompletions` MUST return the filter list from `packages/server/src/data/filters.ts` when the cursor is positioned immediately after a `|` character that belongs to an open `{{ … }}` or `{% … %}` expression. The detection MUST tolerate `|` with no preceding whitespace (`x|`), with a single space (`x |`), and with a trailing partial filter name (`x | up`).

#### Scenario: Pipe with no preceding space returns filters

- **WHEN** the document text is `{{ x|` and the completion position is at line 0, character 5
- **THEN** the response contains items with labels `upcase`, `downcase`, `size`, and `default`

#### Scenario: Pipe with preceding space returns filters

- **WHEN** the document text is `{{ x | ` and the completion position is at line 0, character 7
- **THEN** the response contains items with labels `upcase`, `downcase`, `size`, and `default`

### Requirement: Paradox kind completions SHALL appear when typing a Paradox-shaped output

`provideCompletions` MUST recognize the prefixes `{{component`, `{{snippet`, `{{data`, `{{attribute` — with optional `-` for whitespace-strip — and offer the four kind keywords with a trailing `:` insertion. After the kind keyword and `:`, the provider MUST return placeholder value items sourced from `packages/server/src/data/paradoxTags.ts` until a workspace-index source supersedes them.

#### Scenario: Typing `{{co` offers paradox kinds

- **WHEN** the document text is `{{co` and the completion position is at line 0, character 4
- **THEN** the response contains items with labels `component`, `snippet`, `data`, `attribute`, each with `kind: 'Keyword'` and `detail: 'paradox tag'`
- **AND** each item's `insertText` ends with `:`

#### Scenario: Typing `{{component:` offers paradox value placeholders

- **WHEN** the document text is `{{component:` and the completion position is at line 0, character 12
- **THEN** the response contains at least one item whose `detail` mentions "paradox" and whose `kind` is `Module` or `Variable`

#### Scenario: Confirmed paradox tag suppresses standard Liquid completions

- **WHEN** the document text is `{{component:Hero ` and the completion position is at line 0, character 17 (inside a Paradox tag the prepass has classified)
- **THEN** the response is the empty array

### Requirement: Render, include, and layout string-literal completions SHALL continue to work

`provideCompletions` MUST preserve the existing behavior of offering component, partial, and layout file keys inside the string literal of `{% render "…" %}`, `{% include "…" %}`, and `{% layout "…" %}` tags, based on `state.fileIndex`. Component targets MUST use `kind: 'Module'`, partials `kind: 'File'`, layouts `kind: 'File'`.

#### Scenario: Render string literal lists components and partials

- **WHEN** the document text is `{% render "` and the file index contains a component `button` and a partial `foot`, and the completion position is at line 0, character 11
- **THEN** the response contains an item `label: 'button', kind: 'Module', detail: 'component'`
- **AND** the response contains an item `label: 'foot', kind: 'File', detail: 'partial'`

#### Scenario: Layout string literal lists only layouts

- **WHEN** the document text is `{% layout "` and the file index contains a layout `main`, and the completion position is at line 0, character 11
- **THEN** the response contains exactly one item with `label: 'main', kind: 'File', detail: 'layout'`

### Requirement: Manual-invoke completions SHALL never return an empty list inside a Liquid construct

When `provideCompletions` receives a completion request with `triggerKind === Invoked` (LSP value `1`) and the cursor is inside any of `{% … %}`, `{{ … }}`, a `render`/`include`/`layout` string literal, or a render kwargs comma list, the response MUST contain at least one item. Outside of those contexts, the response MAY be empty.

#### Scenario: Manual invoke at empty `{% %}` returns tag names

- **WHEN** the document text is `{% %}`, the completion position is at line 0, character 3, and the trigger kind is `Invoked`
- **THEN** the response is non-empty and contains tag-name items

#### Scenario: Manual invoke at empty `{{ }}` returns variables, built-ins, or the pipe sentinel

- **WHEN** the document text is `{{ }}`, the completion position is at line 0, character 3, and the trigger kind is `Invoked`, with no JSON companion and no assigned variables
- **THEN** the response is non-empty and contains the built-in literals `nil` and `true`

#### Scenario: Manual invoke outside any Liquid construct returns an empty list

- **WHEN** the document text is `<h1>Hello</h1>`, the completion position is at line 0, character 5, and the trigger kind is `Invoked`
- **THEN** the response is an empty array

### Requirement: Per-tag continuation completions SHALL be offered inside common block tags

Inside the body of `{% if … %}`, `{% unless … %}`, `{% elsif … %}`, `{% for … %}`, `{% case … %}`, `{% when … %}`, `{% assign … %}`, `{% capture … %}`, `provideCompletions` MUST offer context-appropriate items in addition to in-scope variables.

- After `{% for <name> ` (no `in` yet), the keyword `in` MUST appear first.
- After `{% for <name> in <expr> `, the keywords `reversed`, `offset:`, and `limit:` MUST appear.
- After `{% if `, `{% unless `, `{% elsif `, `{% when `, the operators `and`, `or`, `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains` MUST appear, in addition to in-scope variables.
- After `{% assign <name> = `, the operator list and variables MUST appear.

#### Scenario: After `{% for x `, the `in` keyword leads the list

- **WHEN** the document text is `{% for x ` and the completion position is at line 0, character 9
- **THEN** the response's first item has `label: 'in'` and `kind: 'Keyword'`

#### Scenario: Inside `{% if`, operators are offered alongside variables

- **WHEN** the document text is `{% if ` with a JSON companion `{"title":"Hi"}` and the completion position is at line 0, character 6
- **THEN** the response contains items with labels `title` (kind `Variable`) AND `and`, `or`, `==`, `contains` (kind `Keyword`)

### Requirement: Auto-closing pairs SHALL produce minimum-valid Liquid delimiters without leading whitespace

`packages/client/language-configuration.json` MUST declare auto-closing pairs for `{%`, `{{`, and `{#` whose `close` value is `%}`, `}}`, and `#}` respectively, with no leading space. The `surroundingPairs` entries MUST mirror the open/close exactly.

#### Scenario: Typing `{%` inserts `%}` without a leading space

- **WHEN** the user types `{` followed by `%` in an empty `.liquid` document
- **THEN** the resulting buffer is `{%%}` with the cursor positioned between `{%` and `%}`

#### Scenario: Typing `{{` inserts `}}` without a leading space

- **WHEN** the user types `{` followed by `{` in an empty `.liquid` document
- **THEN** the resulting buffer is `{{}}` with the cursor positioned between `{{` and `}}`
