import { Tokenizer } from 'liquidjs';
import type { Range } from '../types.js';

export type Token =
  | { kind: 'html'; text: string; range: Range }
  | { kind: 'output'; content: string; range: Range; rawRange: Range }
  | { kind: 'tag'; name: string; args: string; range: Range; rawRange: Range };

export interface TokenizeError {
  message: string;
  range: Range;
}

export interface TokenizeResult {
  tokens: Token[];
  errors: TokenizeError[];
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

function makeRange(text: string, begin: number, end: number): Range {
  return { start: offsetToPosition(text, begin), end: offsetToPosition(text, end) };
}

export function tokenize(source: string): TokenizeResult {
  const errors: TokenizeError[] = [];
  const tokens: Token[] = [];

  let cursor = 0;
  while (cursor < source.length) {
    try {
      const tokenizer = new Tokenizer(source.slice(cursor));
      const raw = tokenizer.readTopLevelTokens();
      for (const t of raw) {
        const begin = cursor + t.begin;
        const end = cursor + t.end;
        const range = makeRange(source, begin, end);
        const ctorName = t.constructor.name;

        if (ctorName === 'TagToken') {
          const name = String((t as unknown as { name?: string }).name);
          const args = String((t as unknown as { args?: string }).args ?? '').trim();
          const innerStart = begin + 2;
          const innerEnd = end - 2;
          tokens.push({
            kind: 'tag',
            name,
            args,
            range,
            rawRange: makeRange(source, innerStart, innerEnd),
          });
        } else if (ctorName === 'OutputToken') {
          const contentRange = (t as unknown as { contentRange?: [number, number] }).contentRange;
          const content = contentRange
            ? source.slice(cursor + contentRange[0], cursor + contentRange[1]).trim()
            : source.slice(begin + 2, end - 2).trim();
          const innerStart = begin + 2;
          const innerEnd = end - 2;
          tokens.push({
            kind: 'output',
            content,
            range,
            rawRange: makeRange(source, innerStart, innerEnd),
          });
        } else {
          tokens.push({ kind: 'html', text: source.slice(begin, end), range });
        }
      }
      cursor = source.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lookahead = source.slice(cursor);
      const badIdx = Math.max(0, lookahead.search(/\{\{|\{%/));
      const errBegin = cursor + badIdx;
      const errEnd = source.length;
      errors.push({ message, range: makeRange(source, errBegin, errEnd) });

      if (badIdx > 0) {
        tokens.push({
          kind: 'html',
          text: source.slice(cursor, errBegin),
          range: makeRange(source, cursor, errBegin),
        });
      }
      cursor = source.length;
    }
  }

  return { tokens, errors };
}
