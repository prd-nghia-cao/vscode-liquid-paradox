/**
 * Argument-list parsing for `{% render "x", a: 1, b: 2 %}`.
 *
 * A regex scan for `name:` over the raw tag body cannot do this: Tailwind class
 * strings (`'group-odd:left-2'`), URLs (`'https://…'`), and filter arguments
 * (`a | default: 'x'`) all contain colons that are not argument names. Argument
 * names are only recognized at the head of a top-level comma-separated segment,
 * with quotes and brackets respected.
 */

export interface RenderArg {
  name: string;
  /** Offset of the first character of `name` within the parsed text. */
  nameStart: number;
}

/**
 * Splits `text` on commas that are at bracket depth 0 and outside any string
 * literal. Liquid has no string escapes, so a quote always ends its literal.
 */
function splitTopLevel(text: string): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '[' || c === '(' || c === '{') {
      depth++;
    } else if (c === ']' || c === ')' || c === '}') {
      if (depth > 0) depth--;
    } else if (c === ',' && depth === 0) {
      segments.push({ start, end: i });
      start = i + 1;
    }
  }
  segments.push({ start, end: text.length });
  return segments;
}

/**
 * The named arguments in a render argument list. Segments that are not
 * `name: value` — the leading template path, or `with x as y` — are skipped.
 */
export function parseRenderArgs(text: string): RenderArg[] {
  const args: RenderArg[] = [];
  for (const seg of splitTopLevel(text)) {
    const body = text.slice(seg.start, seg.end);
    const m = body.match(/^\s*([\w-]+)\s*:/);
    if (!m) continue;
    args.push({ name: m[1]!, nameStart: seg.start + m[0].indexOf(m[1]!) });
  }
  return args;
}

/** Convenience wrapper over {@link parseRenderArgs} returning just the names. */
export function renderArgNames(text: string): string[] {
  return parseRenderArgs(text).map((a) => a.name);
}
