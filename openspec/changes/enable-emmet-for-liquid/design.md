## Context

VS Code's Emmet engine is built into the editor and activates based on the document's `languageId`. By default it fires for `html`, `css`, `scss`, `less`, `jsx-tags`, etc., but not for `liquid`. To extend Emmet to a custom language, VS Code exposes the `emmet.includeLanguages` setting, which maps language IDs to a known Emmet syntax. Once mapped, Emmet's expansion (`Tab`), wrap-with-abbreviation, and the in-suggestion abbreviation entries all start working for that language.

The extension already:
- Registers `liquid` as a language bound to `.liquid` (`packages/client/package.json`).
- Ships a TextMate grammar at scope `text.html.liquid` whose root injects `text.html.basic`, so HTML structure inside a `.liquid` file is already recognized by the editor.
- Provides LSP completions inside `{% … %}` / `{{ … }}` regions via the language server.

What is missing is a single mapping: tell Emmet that `liquid` is an HTML-flavored language. VS Code provides `contributes.configurationDefaults` in `package.json` — this lets an extension ship default values for any user setting. Defaults from extensions sit below explicit user `settings.json` values in the precedence order, so a user can still opt out without us blocking them.

The Emmet engine itself walks the embedded scopes inside a document and refuses to expand abbreviations inside non-HTML scopes (e.g. it does not fire inside `string.quoted` or `comment` regions). Because our grammar tags Liquid delimiters with their own scopes (`meta.tag.liquid`, `punctuation.section.embedded.liquid`, etc.), Emmet will naturally stay quiet inside `{% … %}` and `{{ … }}` regions where our LSP is authoritative.

## Goals / Non-Goals

**Goals:**

- Emmet abbreviation expansion fires inside HTML regions of `.liquid` files without any user setup.
- Behavior matches what users get in a `.html` buffer: tag completion, `>`/`+`/`*`/`{}` operators, snippets, BEM aliases, etc.
- The default is overridable: any user-level `emmet.includeLanguages` value continues to win.
- The change is self-contained in the client manifest and adds no runtime code.

**Non-Goals:**

- Inventing Liquid-specific Emmet snippets (e.g. `{%if}` shortcuts). Liquid-tag scaffolding stays the job of our LSP and is out of scope for this change.
- Activating Emmet inside `{% … %}` / `{{ … }}` regions. Those are LSP territory; we explicitly want Emmet silent there.
- Mapping any other custom languages (e.g. paradox-specific variants) — a future change can extend the map if needed.
- Adding settings UI or commands to toggle Emmet on/off; users do that through the standard `emmet.*` settings surface.

## Decisions

### D1. Use `contributes.configurationDefaults` instead of programmatic activation

Two approaches were considered for shipping the Emmet mapping:

1. **Declarative (chosen)** — add `contributes.configurationDefaults` to `packages/client/package.json`:
   ```json
   "contributes": {
     "configurationDefaults": {
       "emmet.includeLanguages": {
         "liquid": "html"
       }
     }
   }
   ```
2. **Programmatic** — in `extension.ts`, on activation, read the current `emmet.includeLanguages` value via `workspace.getConfiguration` and write a merged value back to `ConfigurationTarget.Global`.

The declarative form is preferred because it (a) requires zero runtime code, (b) is scoped to "default" precedence so it never overwrites the user's own setting, (c) is removed cleanly when the extension is uninstalled, and (d) is the same pattern used by `vscode-html-language-features` and other first-party extensions. The programmatic form would mutate user settings persistently, which is invasive and harder to undo.

### D2. Map `liquid` → `html` (not `text.html.basic`, not `liquid` itself)

Emmet's syntax names are language IDs (`html`, `css`, …), not TextMate scopes. The value must be an existing Emmet-supported syntax. `html` covers the full HTML5 abbreviation set including BEM (`div.card>h2.card__title`) and is what every other Liquid-flavored extension maps to. Alternatives like `xml` lose HTML-specific snippets and are not used.

### D3. Do not gate Emmet activation by cursor context

Emmet already declines to expand inside string-literal and comment scopes within an HTML document, and our grammar marks Liquid delimiter contents with their own scope names. So no custom guard is needed — relying on Emmet's scope-walking behavior keeps the implementation trivial. If a future regression appears (e.g. Emmet starts firing inside `{% if x %}`), we will address it with a scope-name tweak in the grammar, not by intercepting Emmet.

### D4. Document the default but do not advertise it as a feature flag

The change is mentioned in `README.md` under the existing Features list. No setting toggle is added to `package.json` `contributes.configuration` — users opt out via the standard `emmet.excludeLanguages` setting (an array of language IDs Emmet refuses to handle even if included). Adding a custom toggle would duplicate that surface area for no gain.

## Risks / Trade-offs

- **Risk:** Emmet expansions could leak into Liquid delimiter regions on unusual grammars (e.g. partial tag open at end of line).  
  **Mitigation:** Our grammar's delimiter scopes are stable and our test fixture (`fixtures/career-site-mini`) covers nested Liquid inside HTML. Manual smoke test in `tasks.md` exercises both regions.
- **Risk:** Users who deliberately disabled Emmet globally via `emmet.showExpandedAbbreviation: "never"` are unaffected (Emmet stays silent). Users who left it on default get a behavior change — they will see Emmet suggestions in `.liquid` where they previously did not.  
  **Mitigation:** Behavior change is the goal, and it matches user expectation for HTML-shaped files. The Changelog calls it out under Added so anyone surprised has a documented opt-out path (`emmet.excludeLanguages: ["liquid"]`).
- **Trade-off:** Coupling to VS Code's Emmet implementation. If VS Code ever changes how `configurationDefaults` interacts with `emmet.includeLanguages`, we inherit that behavior. Acceptable — the same coupling exists in every Liquid/Twig/Vue extension on the marketplace.
- **Risk:** Conflicts with `sissel.shopify-liquid` or other Liquid extensions that also contribute the same default.  
  **Mitigation:** VS Code merges `configurationDefaults` from all contributing extensions for object-valued settings like `emmet.includeLanguages`. Duplicate `liquid: html` entries collapse to a single mapping, so coexistence is safe.
