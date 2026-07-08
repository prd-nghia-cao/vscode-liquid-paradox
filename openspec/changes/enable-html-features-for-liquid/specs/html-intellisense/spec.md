## ADDED Requirements

### Requirement: HTML tag, attribute, and attribute-value completions in HTML regions

The extension SHALL provide HTML completions — element/tag names, attribute names, and attribute values — inside the HTML regions of a `.liquid` document, sourced from the HTML5 data set by an embedded HTML language service. The items MUST be returned as native LSP completion items so that their text edits and snippet insertions behave exactly as they do in a `.html` document.

#### Scenario: Tag-name completion after `<`

- **WHEN** the cursor is in an HTML region of a `.liquid` file and the user types `<di`
- **THEN** the completion list includes `div` (and other matching HTML elements), and accepting `div` inserts a `<div>` start tag

#### Scenario: Attribute-name completion inside an open tag

- **WHEN** the cursor is inside an open start tag in an HTML region (e.g. `<a |>`) and the user types `hre`
- **THEN** the completion list includes the `href` attribute, and accepting it inserts `href="$0"` with the cursor placed inside the quotes

#### Scenario: Attribute-value completion

- **WHEN** the cursor is inside an attribute value whose attribute has a known value set (e.g. `<input type="|">`)
- **THEN** the completion list offers the valid values for that attribute (e.g. `text`, `checkbox`, `radio`, …)

#### Scenario: HTML completions work where Liquid completions previously returned nothing

- **WHEN** the cursor sits in plain HTML body text of a `.liquid` file (a position the LSP classifies as the `text` region) and the user requests completions while typing a tag or attribute
- **THEN** HTML completions are offered instead of an empty list

### Requirement: HTML language features SHALL NOT activate inside Liquid regions

HTML completions, hover, auto-closing tags, and linked editing MUST be confined to HTML regions. Inside `{% … %}`, `{{ … }}`, `{# … #}`, and `{% comment %} … {% endcomment %}` regions the HTML language service MUST stay silent and the Liquid language server remains authoritative.

#### Scenario: No HTML completions inside a tag delimiter

- **WHEN** the cursor is between `{%` and `%}` (e.g. after typing `{% if `) and the user types `div`
- **THEN** no HTML tag/attribute completions are offered; only the Liquid continuation completions appear

#### Scenario: No HTML completions inside an output expression

- **WHEN** the cursor is between `{{` and `}}` and the user types `a`
- **THEN** no HTML tag/attribute completions are offered; the Liquid output completions (variables, literals, pipe sentinel) appear

#### Scenario: No HTML completions inside a Liquid comment

- **WHEN** the cursor is inside a `{# … #}` inline comment or a `{% comment %} … {% endcomment %}` block
- **THEN** the HTML language service offers no completions, hover, auto-close, or linked editing for that position

#### Scenario: Liquid completions remain unchanged

- **WHEN** the cursor is in any Liquid region after this change ships
- **THEN** the Liquid completions, hover, and diagnostics behave exactly as before, with no HTML items mixed in

### Requirement: Auto-closing tags in HTML regions

Completing a start tag in an HTML region SHALL insert the matching end tag. When the user types the `>` that closes a start tag (or types `/` to self-close) at a position in an HTML region, the editor MUST insert the corresponding closing tag and place the cursor between the tags.

#### Scenario: Typing `>` closes the tag

- **WHEN** the cursor is in an HTML region and the user types `<section>`
- **THEN** the editor inserts `</section>` immediately after the cursor, leaving the cursor positioned between `<section>` and `</section>`

#### Scenario: No auto-close inside a Liquid region

- **WHEN** the user types `>` inside a Liquid tag such that the buffer reads `{% if count > 0 %}`
- **THEN** no closing HTML tag is inserted

### Requirement: Tag-pair linked editing (rename) in HTML regions

The extension SHALL provide linked editing for HTML tag pairs in HTML regions, advertised via the LSP `linkedEditingRangeProvider` capability. Editing the name of a start tag MUST update the matching end tag, and editing the end tag MUST update the start tag. Linked-editing ranges MUST NOT extend into Liquid regions.

#### Scenario: Renaming a start tag updates its end tag

- **WHEN** the cursor is on the tag name of `<section>` whose matching `</section>` exists in an HTML region, and the user edits the name to `article`
- **THEN** the matching end tag is simultaneously updated to `</article>`

#### Scenario: Linked editing is unavailable inside Liquid regions

- **WHEN** the cursor is inside a `{% … %}` or `{{ … }}` region
- **THEN** the server returns no linked-editing ranges for that position

### Requirement: HTML element and attribute hover in HTML regions

The extension SHALL show standard HTML documentation when the user hovers an HTML element or attribute in an HTML region. Hover inside Liquid regions MUST continue to return the existing Liquid hover.

#### Scenario: Hover on an HTML element

- **WHEN** the user hovers the `input` element name in an HTML region of a `.liquid` file
- **THEN** the hover shows the standard HTML documentation for the `<input>` element

#### Scenario: Hover inside a Liquid region is unchanged

- **WHEN** the user hovers a variable inside `{{ … }}`
- **THEN** the existing Liquid hover is shown, not HTML documentation

### Requirement: Server advertises HTML trigger characters and linked-editing capability

The language server's `InitializeResult` SHALL advertise the completion trigger characters required for HTML in addition to the existing Liquid set, and SHALL advertise the linked-editing capability.

#### Scenario: Initialization advertises HTML trigger characters

- **WHEN** the language client sends an `initialize` request
- **THEN** the server's `completionProvider.triggerCharacters` array contains `<`, `=`, and `/` in addition to the previously advertised Liquid trigger characters (`{`, `%`, `}`, `|`, `"`, `'`, `.`, `,`, `:`, `-`, `<space>`)

#### Scenario: Initialization advertises linked editing

- **WHEN** the language client sends an `initialize` request
- **THEN** the server's response advertises `linkedEditingRangeProvider`

### Requirement: HTML IntelliSense is documented

The README and the completion-surfaces documentation SHALL describe the HTML IntelliSense surfaces and the rule that HTML features fire only in HTML regions, not inside Liquid delimiters.

#### Scenario: README enumerates HTML IntelliSense

- **WHEN** a reader scans the Features section of `README.md`
- **THEN** they find that HTML tag/attribute/value completions, hover, auto-closing tags, and tag-pair rename are available in the HTML regions of `.liquid` files

#### Scenario: Completion-surfaces doc records the HTML region

- **WHEN** a reader opens `docs/completion-surfaces.md`
- **THEN** the HTML region is listed alongside the Liquid regions, noting that it is served by the embedded HTML language service and stays silent inside Liquid delimiters
