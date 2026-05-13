# Completion surfaces

This document lists every place the Liquid Paradox LSP offers completions, what
triggers them, and what items they produce. Each surface is implemented in
`packages/server/src/providers/completion.ts` and gated by
`packages/server/src/providers/bucketCursor.ts`.

## Trigger characters

The LSP advertises the following `completionProvider.triggerCharacters`:

```
{ % } | " ' . , : - <space>
```

`'{'`, `'%'`, `'}'` cover the Liquid delimiters; `'|'` opens the filter list;
`'.'` opens dotted property completions; `'"'` / `"'"` open string-path
completions; `','` opens render-kwarg completions; `':'` triggers Paradox-kind
value completions; `'-'` handles the `{%-` / `{{-` whitespace-strip variants;
`' '` keeps completions alive as the user types through a multi-token tag body
(e.g. `{% for x in `).

## Cursor regions

`bucketCursor(text, offset)` classifies the cursor into one of:

| Region                  | Trigger                                                       | Items                                                                              |
|-------------------------|---------------------------------------------------------------|------------------------------------------------------------------------------------|
| `tag`                   | Cursor inside `{% … %}` with no tag name typed yet            | All Liquid tag names (`if`, `for`, `assign`, `render`, …)                          |
| `tag` (with tag name)   | Cursor inside `{% if … `, `{% for … `, `{% assign … `, etc.   | Per-tag continuation keywords + in-scope variables + operators (for conditionals)  |
| `tag-after-pipe`        | Cursor after `\|` inside `{% echo x \|` etc.                  | Filters from `data/filters.ts`                                                     |
| `output`                | Cursor inside `{{ … }}` (no Paradox prefix, no pipe yet)      | In-scope variables, built-in literals (`nil`, `null`, `true`, …), pipe sentinel    |
| `output-after-pipe`     | Cursor after `\|` inside `{{ x \|` (with or without space)    | Filters from `data/filters.ts`                                                     |
| `paradox-intent`        | Cursor after `{{` typing a lowercase word that prefixes a Paradox kind | The four Paradox kind keywords (`component`, `snippet`, `data`, `attribute`), each inserting `<kind>:` |
| `paradox-value-typing`  | Cursor immediately after `{{component:` (or other kind + `:`) | Placeholder value items (real values come from a future workspace index)           |
| `paradox-confirmed`     | Cursor inside `{{kind:value `, post-value whitespace          | `[]` (suppressed; the prepass would classify this position as a Paradox tag)       |
| `string-render-path`    | Cursor inside the string literal of `{% render "…`            | Component (`Module`) + partial (`File`) keys from the workspace index              |
| `string-include-path`   | Cursor inside the string literal of `{% include "…`           | Same as `string-render-path`                                                       |
| `string-layout-path`    | Cursor inside the string literal of `{% layout "…`            | Layout (`File`) keys from the workspace index                                      |
| `render-args`           | Cursor inside `{% render "name", `                            | Component props for the named component (`Property` kind, with type and default)   |
| `text`                  | Cursor in plain HTML / Liquid output                          | `[]`                                                                               |

## Dotted property access

When the cursor sits immediately after `<name>.<…>.` in either an `output` or
`tag` body that wants variables, `provideCompletions` walks the type of the
root binding and offers object keys.

## Trigger-kind handling

`provideCompletions` accepts an optional `triggerKind` parameter (LSP
`CompletionTriggerKind` mapped to `'invoked' | 'triggerCharacter' |
'forIncomplete'`). All three values are accepted; the fallback paths (literals
for `output`, tag names for empty `tag`, paradox kinds for `paradox-intent`)
ensure the response is never empty inside a Liquid construct regardless of how
the request was triggered.

## Per-tag continuation keywords

`packages/server/src/data/tagContinuations.ts` declares:

- `for` / `tablerow`: `in` (priority), `reversed`, `offset:`, `limit:`
- `render` / `include`: `with`, `for`, `as`
- `paginate`: `by`
- Conditional tags (`if`, `unless`, `elsif`, `when`, `case`): variables + the
  full operator list from `data/operators.ts`
- Expression tags (`assign`, `echo`): variables

## Pipe sentinel

Inside `{{ … }}` with no pipe yet, the completion list always contains an
explicit `|` item (`insertText: ' | '`). Accepting it inserts ` | ` and lets
the editor re-trigger the filter list. This guarantees discoverability of
filters even when the user has not memorized the pipe shortcut.

## Automatic whitespace padding

Inside `{% … %}` / `{{ … }}` / pipe / Paradox-intent regions, every completion
item is post-processed to add a single leading and/or trailing space when the
cursor is tight up against the open or close delimiter. This guarantees
canonical, idiomatic Liquid output:

| Document state    | Completion           | Result          |
|-------------------|----------------------|-----------------|
| `{%\|%}`          | `if`                 | `{% if %}`      |
| `{% \|%}`         | `if`                 | `{% if %}`      |
| `{%\| %}`         | `if`                 | `{% if %}`      |
| `{% \| %}`        | `if`                 | `{% if %}`      |
| `{%i\|%}`         | `if`                 | `{% if %}`      |
| `{% i\|%}`        | `if`                 | `{% if %}`      |
| `{{\|}}`          | `title`              | `{{ title }}`   |
| `{{co\|`          | `component`          | `{{ component:` |

Rules:

- **Leading space** is added when the cursor body (between the open delimiter
  and the start of the partial word being completed) is empty.
- **Trailing space** is added when the text immediately after the cursor
  begins with `%}`, `}}`, `-%}`, or `-}}` (i.e. a tight close delimiter).
- Items that ship their own whitespace (the pipe sentinel `insertText: ' | '`)
  opt out via the internal `noAutoPad` flag.
- String-literal regions (`string-render-path`, `string-include-path`,
  `string-layout-path`) and `render-args` are **not** padded — their items
  belong inside quotes or after a comma where added spaces would corrupt the
  source.
- Items with no explicit `insertText` and no padding needed remain
  `insertText: undefined`; VS Code then inserts the label verbatim.
