import { tokenize } from '../../analyzer/tokenize.js';

/** A half-open `[start, end)` source offset span that is NOT HTML (Liquid). */
export interface Span {
  start: number;
  end: number;
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

function toOffset(lineStarts: number[], pos: { line: number; character: number }): number {
  const base = lineStarts[pos.line] ?? lineStarts[lineStarts.length - 1] ?? 0;
  return base + pos.character;
}

/**
 * Returns the source spans of a `.liquid` document that are NOT HTML and must
 * therefore be masked before the HTML language service sees the document:
 *
 * - `{{ … }}` output tokens and `{% … %}` tag tokens.
 * - The body of `{% comment %} … {% endcomment %}` blocks (the liquidjs
 *   tokenizer emits the block body as a plain HTML token, so it is masked here
 *   explicitly).
 * - `{# … #}` inline comments (the tokenizer lumps these into surrounding HTML
 *   text, so they are matched with a regex).
 *
 * `{% raw %} … {% endraw %}` bodies are intentionally left as HTML: their
 * contents are emitted verbatim as markup, so HTML IntelliSense is appropriate.
 */
export function liquidSpans(text: string): Span[] {
  const { tokens } = tokenize(text);
  const lineStarts = buildLineStarts(text);
  const spans: Span[] = [];
  let inComment = false;

  for (const tok of tokens) {
    const start = toOffset(lineStarts, tok.range.start);
    const end = toOffset(lineStarts, tok.range.end);
    if (tok.kind === 'tag') {
      spans.push({ start, end });
      if (tok.name === 'comment') inComment = true;
      else if (tok.name === 'endcomment') inComment = false;
    } else if (tok.kind === 'output') {
      spans.push({ start, end });
    } else if (inComment) {
      // HTML body sitting between {% comment %} and {% endcomment %}.
      spans.push({ start, end });
    }
  }

  for (const m of text.matchAll(/\{#[\s\S]*?#\}/g)) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }

  return coalesce(spans);
}

function coalesce(spans: Span[]): Span[] {
  if (spans.length <= 1) return spans;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]!;
    const cur = sorted[i]!;
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** True when `offset` falls inside one of the (Liquid) `spans`. */
export function offsetInSpans(spans: Span[], offset: number): boolean {
  for (const s of spans) {
    if (offset >= s.start && offset < s.end) return true;
  }
  return false;
}

/**
 * Replaces every non-HTML (Liquid) span with spaces, preserving line breaks so
 * that character offsets and line/column positions are identical between the
 * source and the returned virtual HTML text.
 */
export function maskNonHtml(text: string, spans: Span[] = liquidSpans(text)): string {
  if (spans.length === 0) return text;
  const chars = text.split('');
  for (const s of spans) {
    for (let i = s.start; i < s.end && i < chars.length; i++) {
      const code = chars[i]!.charCodeAt(0);
      if (code !== 10 /* \n */ && code !== 13 /* \r */) chars[i] = ' ';
    }
  }
  return chars.join('');
}
