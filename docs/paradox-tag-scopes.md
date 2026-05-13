# Paradox Tag TextMate Scopes

The Liquid Paradox extension ships an injection grammar (`paradox.injection`) that adds distinct TextMate scopes to Paradox backend tags layered on top of the standard `text.html.liquid` grammar. Theme authors can target these scopes to color the tags consistently.

## Scopes

| Tag form                 | Container scope                         | Tag-name scope                     | Argument-key scope                |
| ------------------------ | --------------------------------------- | ---------------------------------- | --------------------------------- |
| `{{component:NAME …}}`   | `meta.tag.paradox.component.liquid`     | `entity.name.tag.paradox.liquid`   | `variable.parameter.paradox.liquid` |
| `{{snippet:NAME …}}`     | `meta.tag.paradox.snippet.liquid`       | `entity.name.tag.paradox.liquid`   | `variable.parameter.paradox.liquid` |
| `{{data:PATH …}}`        | `meta.tag.paradox.data.liquid`          | `entity.name.tag.paradox.liquid`   | `variable.parameter.paradox.liquid` |
| `{{attribute:KEY …}}`    | `meta.tag.paradox.attribute.liquid`     | `entity.name.tag.paradox.liquid`   | `variable.parameter.paradox.liquid` |

Additional shared scopes inside any Paradox tag:

- `punctuation.section.embedded.begin.paradox.liquid` — opening `{{`
- `punctuation.section.embedded.end.paradox.liquid` — closing `}}`
- `punctuation.separator.key-value.paradox.liquid` — the `:` that separates a key and its value
- `string.quoted.double.paradox.liquid` / `string.quoted.single.paradox.liquid` — quoted argument values
- `constant.numeric.paradox.liquid` — numeric argument values
- `variable.other.paradox.liquid` — unquoted argument values such as a component or snippet identifier

## Example

```liquid
{{component:hero-banner title:"Welcome" align:center}}
```

| Substring        | Scope chain (top → bottom)                                        |
| ---------------- | ----------------------------------------------------------------- |
| `{{`             | `text.html.liquid` → `paradox.injection` → `meta.tag.paradox.component.liquid` → `punctuation.section.embedded.begin.paradox.liquid` |
| `component`      | `entity.name.tag.paradox.liquid`                                  |
| `:`              | `punctuation.separator.key-value.paradox.liquid`                  |
| `hero-banner`    | `variable.other.paradox.liquid`                                   |
| `title`          | `variable.parameter.paradox.liquid`                               |
| `"Welcome"`      | `string.quoted.double.paradox.liquid`                             |
| `}}`             | `punctuation.section.embedded.end.paradox.liquid`                 |

## Inspecting scopes in VS Code

Use the command **"Developer: Inspect Editor Tokens and Scopes"** and place the cursor on a Paradox tag to verify the scope chain matches the table above.

## Coexistence with `sissel.shopify-liquid`

The injection selector `L:text.html.liquid` matches both the Liquid Paradox base grammar and the `sissel.shopify-liquid` grammar, so the Paradox scopes apply identically regardless of which Liquid grammar VS Code resolves at runtime.
