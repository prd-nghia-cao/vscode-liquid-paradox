export const COMPLETION_TRIGGER_CHARACTERS: readonly string[] = Object.freeze([
  '{',
  '%',
  '}',
  '|',
  '"',
  "'",
  '.',
  ',',
  ':',
  '-',
  ' ',
  // HTML IntelliSense trigger characters (HTML regions of `.liquid` files):
  // `<` opens tag-name completion, `=` opens attribute-value completion, and
  // `/` drives auto-closing / self-closing tags.
  '<',
  '=',
  '/',
]);
